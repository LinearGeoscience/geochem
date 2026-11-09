"""Project files by full path: open/save, backups, recovery copies, recent
projects and native Open/Save dialogs (see app/core/project_files.py).

These endpoints touch the user's disk, so every request must come from the
app on this machine: it must carry the X-GeoChem-Client header (a cross-site
page cannot send it without a CORS preflight, which is refused) and any
Origin / X-Forwarded-For must be loopback (the Vite proxy listens on the LAN).
"""
from __future__ import annotations

import logging
import os
import subprocess
import sys
import threading
from ipaddress import ip_address
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel

from fastapi.concurrency import run_in_threadpool

from app.core import project_files as pf
from app.core import report_pdf

logger = logging.getLogger(__name__)
router = APIRouter()

CLIENT_HEADER = 'x-geochem-client'


def _is_loopback(host: str | None) -> bool:
    if not host:
        return False
    if host == 'localhost':
        return True
    try:
        ip = ip_address(host.strip('[]'))
    except ValueError:
        return False
    mapped = getattr(ip, 'ipv4_mapped', None)  # ::ffff:127.0.0.1 from a dual-stack proxy
    return ip.is_loopback or bool(mapped and mapped.is_loopback)


def local_client(request: Request) -> None:
    if request.headers.get(CLIENT_HEADER) != '1':
        raise HTTPException(403, 'Missing client header')
    origin = request.headers.get('origin')
    if origin and not _is_loopback(urlparse(origin).hostname):
        raise HTTPException(403, 'Project files are only available on this computer')
    fwd = request.headers.get('x-forwarded-for')
    if fwd and not all(_is_loopback(h.strip()) for h in fwd.split(',')):
        raise HTTPException(403, 'Project files are only available on this computer')
    if request.client and not _is_loopback(request.client.host):
        raise HTTPException(403, 'Project files are only available on this computer')


guard = [Depends(local_client)]


def _bad(e: Exception) -> HTTPException:
    if isinstance(e, FileNotFoundError):
        return HTTPException(404, f'File not found: {e}')
    if isinstance(e, ValueError):
        return HTTPException(400, str(e))
    if isinstance(e, PermissionError):
        return HTTPException(403, f'No permission: {e}')
    logger.exception('Project file operation failed')
    return HTTPException(500, str(e))


@router.get('/info', dependencies=guard)
def info():
    return {'available': True, 'appDir': str(pf.app_dir())}


@router.get('/open', dependencies=guard)
def open_project(path: str):
    try:
        data = pf.read_project(path)
        rec = pf.recovery_info(path, None)
    except Exception as e:
        raise _bad(e)
    headers = {'X-Project-Path': path}
    if rec:
        headers['X-Recovery-Modified'] = rec['modified']
    return Response(content=data, media_type='application/octet-stream', headers=headers)


@router.post('/save', dependencies=guard)
async def save_project(path: str, request: Request):
    data = await request.body()
    if not data:
        raise HTTPException(400, 'Empty project')
    try:
        info = pf.save_project(path, data)
    except Exception as e:
        raise _bad(e)
    logger.info('Saved project %s (%d bytes)', path, len(data))
    return info


@router.post('/autosave', dependencies=guard)
async def autosave(request: Request, path: str | None = None, key: str | None = None):
    data = await request.body()
    if not data:
        raise HTTPException(400, 'Empty project')
    try:
        return pf.autosave(path, key, data)
    except Exception as e:
        raise _bad(e)


@router.get('/recovery', dependencies=guard)
def recovery(path: str | None = None, key: str | None = None, check: bool = False):
    try:
        if check:
            return {'recovery': pf.recovery_info(path, key)}
        return Response(content=pf.read_recovery(path, key), media_type='application/octet-stream')
    except Exception as e:
        raise _bad(e)


@router.get('/recovery/unsaved', dependencies=guard)
def unsaved_recoveries():
    return pf.list_unsaved_recoveries()


@router.delete('/recovery', dependencies=guard)
def discard_recovery(path: str | None = None, key: str | None = None):
    try:
        pf.discard_recovery(path, key)
    except Exception as e:
        raise _bad(e)
    return {'ok': True}


class RecentIn(BaseModel):
    path: str
    name: str | None = None


@router.post('/asset', dependencies=guard)
async def write_asset(path: str, sub: str, name: str, request: Request):
    """Write a figure / export / report file into the project's folder."""
    try:
        info = pf.write_asset(path, sub, name, await request.body())
    except Exception as e:
        raise _bad(e)
    logger.info('Wrote %s', info['path'])
    return info


@router.post('/report', dependencies=guard)
async def export_report(path: str, name: str, request: Request, pdf: bool = True):
    """Write <project>/report/<name>.html and print it to <name>.pdf."""
    html = await request.body()
    try:
        result = await run_in_threadpool(report_pdf.export_report, path, name, html, pdf)
    except Exception as e:
        raise _bad(e)
    logger.info('Report exported: %s (pdf: %s)', result['html'], result['pdf'] or result['pdfError'])
    return result


@router.post('/reveal', dependencies=guard)
def reveal(path: str, sub: str | None = None):
    """Open the project folder (or one of its subfolders) in the file explorer."""
    try:
        folder = pf.project_subfolder(path, sub)
        if not folder.is_dir():
            raise FileNotFoundError(str(folder))
        if sys.platform == 'win32':
            os.startfile(folder)  # noqa: S606 - local single-user app
        else:
            subprocess.Popen(['open' if sys.platform == 'darwin' else 'xdg-open', str(folder)])
    except Exception as e:
        raise _bad(e)
    return {'path': str(folder)}


@router.get('/recents', dependencies=guard)
def recents():
    return pf.list_recents()


@router.post('/recents', dependencies=guard)
def add_recent(body: RecentIn):
    try:
        return pf.add_recent(body.path, body.name)
    except Exception as e:
        raise _bad(e)


@router.delete('/recents', dependencies=guard)
def remove_recent(path: str):
    return pf.remove_recent(path)


# --- native dialogs -----------------------------------------------------------------

class DialogIn(BaseModel):
    initialDir: str | None = None
    suggestedName: str | None = None
    projectFolder: bool = True


_dialog_lock = threading.Lock()
FILETYPES = [('GeoChem project', '*.chem'), ('All files', '*.*')]


def _run_dialog(kind: str, body: DialogIn) -> str:
    import tkinter as tk
    from tkinter import filedialog
    with _dialog_lock:
        root = tk.Tk()
        try:
            root.withdraw()
            root.attributes('-topmost', True)
            root.update()
            opts = {'parent': root, 'filetypes': FILETYPES}
            if body.initialDir:
                opts['initialdir'] = body.initialDir
            if kind == 'open':
                return filedialog.askopenfilename(title='Open GeoChem project', **opts) or ''
            return filedialog.asksaveasfilename(
                title='Save GeoChem project', defaultextension='.chem',
                initialfile=body.suggestedName or 'Untitled.chem', **opts) or ''
        finally:
            root.destroy()


@router.post('/dialog/open', dependencies=guard)
def dialog_open(body: DialogIn):
    try:
        path = _run_dialog('open', body)
    except Exception as e:
        raise _bad(e)
    return {'path': path or None}


@router.post('/dialog/save', dependencies=guard)
def dialog_save(body: DialogIn):
    try:
        chosen = _run_dialog('save', body)
        if not chosen:
            return {'path': None}
        target = pf.project_folder_target(chosen) if body.projectFolder else pf.project_path(chosen)
    except Exception as e:
        raise _bad(e)
    return {'path': str(target)}
