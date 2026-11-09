"""Project files on disk (.chem projects, their folders, backups, recovery copies).

The browser cannot reopen a file from its name, so the local backend reads and
writes projects by full path. Layout of a project folder:

    <folder>/<name>.chem          the project (written only by Save)
    <folder>/.autosave/           <name>.autosave.chem (recovery copy) and
                                  <name>.bak1..3.chem (previous saves)
    <folder>/figures, exports, report

Writes are atomic (temp file + os.replace), so a failed save never damages the
previous copy. Unsaved projects autosave to <app dir>/recovery/<key>.chem.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import threading
from datetime import datetime, timezone
from pathlib import Path

PROJECT_EXTS = {'.chem', '.gcp', '.json'}
MAX_RECENTS = 15
BACKUPS = 3
AUTOSAVE_DIR = '.autosave'
PROJECT_SUBDIRS = ('figures', 'exports', 'report')

_lock = threading.Lock()


def app_dir() -> Path:
    """Per-user app data folder (GEOCHEM_HOME overrides, e.g. for tests)."""
    base = os.environ.get('GEOCHEM_HOME') or os.path.join(
        os.environ.get('LOCALAPPDATA') or os.path.expanduser('~'), 'GeoChem')
    p = Path(base)
    p.mkdir(parents=True, exist_ok=True)
    return p


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def project_path(path: str) -> Path:
    """Validate a project path: absolute, with a project extension."""
    if not path:
        raise ValueError('No path given')
    p = Path(path)
    if not p.is_absolute():
        raise ValueError(f'Not an absolute path: {path}')
    if p.suffix.lower() not in PROJECT_EXTS:
        raise ValueError(f'Not a project file: {p.name}')
    return p


def _hide(p: Path) -> None:
    """Best-effort hidden attribute for the .autosave folder on Windows."""
    if os.name == 'nt':
        try:
            import ctypes
            ctypes.windll.kernel32.SetFileAttributesW(str(p), 0x02)
        except Exception:
            pass


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f'.{path.name}.{os.getpid()}.tmp')
    try:
        with open(tmp, 'wb') as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            tmp.unlink(missing_ok=True)


def autosave_dir(project: Path) -> Path:
    return project.parent / AUTOSAVE_DIR


def recovery_path(project: Path | None, key: str | None) -> Path:
    if project is not None:
        return autosave_dir(project) / f'{project.stem}.autosave{project.suffix}'
    safe = re.sub(r'[^A-Za-z0-9_-]', '_', key or 'untitled')[:64] or 'untitled'
    return app_dir() / 'recovery' / f'{safe}.chem'


def backup_paths(project: Path) -> list[Path]:
    d = autosave_dir(project)
    return [d / f'{project.stem}.bak{i}{project.suffix}' for i in range(1, BACKUPS + 1)]


def _rotate_backups(project: Path) -> None:
    """Shift bak1..bakN up by one and copy the current file to bak1."""
    if not project.exists():
        return
    baks = backup_paths(project)
    baks[0].parent.mkdir(parents=True, exist_ok=True)
    _hide(baks[0].parent)
    for i in range(len(baks) - 1, 0, -1):
        if baks[i - 1].exists():
            os.replace(baks[i - 1], baks[i])
    shutil.copy2(project, baks[0])


def ensure_project_folders(project: Path) -> None:
    for sub in PROJECT_SUBDIRS:
        (project.parent / sub).mkdir(parents=True, exist_ok=True)


ASSET_EXTS = {'.png', '.svg', '.html', '.pdf', '.csv', '.xlsx', '.json', '.txt', '.kml', '.geojson'}


def asset_path(path: str, sub: str, name: str) -> Path:
    """<project folder>/<sub>/<name> for figures, exports and reports."""
    if sub not in PROJECT_SUBDIRS:
        raise ValueError(f'Unknown project folder: {sub}')
    clean = re.sub(r'[^\w .()+-]+', '_', name).strip(' .')
    if not clean or Path(clean).suffix.lower() not in ASSET_EXTS:
        raise ValueError(f'Not an allowed file name: {name}')
    return project_path(path).parent / sub / clean


def write_asset(path: str, sub: str, name: str, data: bytes) -> dict:
    p = asset_path(path, sub, name)
    atomic_write(p, data)
    return file_info(p)


def project_subfolder(path: str, sub: str | None) -> Path:
    folder = project_path(path).parent
    if sub is None:
        return folder
    if sub not in PROJECT_SUBDIRS:
        raise ValueError(f'Unknown project folder: {sub}')
    (folder / sub).mkdir(parents=True, exist_ok=True)
    return folder / sub


def save_project(path: str, data: bytes) -> dict:
    """Save: keep the previous versions, write atomically, drop the now-stale recovery copy."""
    p = project_path(path)
    with _lock:
        _rotate_backups(p)
        atomic_write(p, data)
        ensure_project_folders(p)
        recovery_path(p, None).unlink(missing_ok=True)
    return file_info(p)


def autosave(path: str | None, key: str | None, data: bytes) -> dict:
    p = project_path(path) if path else None
    target = recovery_path(p, key)
    with _lock:
        atomic_write(target, data)
        if p is not None:
            _hide(target.parent)
    return {'path': str(target), 'modified': _mtime(target)}


def _mtime(p: Path) -> str | None:
    return datetime.fromtimestamp(p.stat().st_mtime, timezone.utc).isoformat() if p.exists() else None


def file_info(p: Path) -> dict:
    return {'path': str(p), 'name': p.stem, 'folder': str(p.parent), 'modified': _mtime(p),
            'size': p.stat().st_size if p.exists() else 0}


def recovery_info(path: str | None, key: str | None) -> dict | None:
    """The recovery copy, if it is newer than the saved project."""
    p = project_path(path) if path else None
    r = recovery_path(p, key)
    if not r.exists():
        return None
    if p is not None and p.exists() and r.stat().st_mtime <= p.stat().st_mtime:
        return None
    return {'path': str(r), 'modified': _mtime(r)}


def read_project(path: str) -> bytes:
    p = project_path(path)
    if not p.exists():
        raise FileNotFoundError(str(p))
    return p.read_bytes()


def read_recovery(path: str | None, key: str | None) -> bytes:
    r = recovery_path(project_path(path) if path else None, key)
    if not r.exists():
        raise FileNotFoundError(str(r))
    return r.read_bytes()


def discard_recovery(path: str | None, key: str | None) -> None:
    recovery_path(project_path(path) if path else None, key).unlink(missing_ok=True)


def list_unsaved_recoveries() -> list[dict]:
    """Recovery copies of projects never saved to a file, newest first."""
    d = app_dir() / 'recovery'
    if not d.is_dir():
        return []
    items = [{'key': f.stem, 'modified': _mtime(f), 'size': f.stat().st_size}
             for f in d.glob('*.chem')]
    return sorted(items, key=lambda it: it['modified'] or '', reverse=True)


def project_folder_target(chosen: str) -> Path:
    """Save As into a project folder: <dir>/<name>.chem -> <dir>/<name>/<name>.chem
    (unless the chosen folder already carries the project's name)."""
    p = project_path(chosen)
    if p.parent.name.lower() == p.stem.lower():
        return p
    return p.parent / p.stem / p.name


# --- recent projects ------------------------------------------------------------

def _recents_file() -> Path:
    return app_dir() / 'recent-projects.json'


def list_recents() -> list[dict]:
    try:
        items = json.loads(_recents_file().read_text(encoding='utf-8'))
    except (OSError, ValueError):
        items = []
    out = []
    for it in items:
        if isinstance(it, dict) and it.get('path'):
            exists = Path(it['path']).exists()
            try:
                recovered = exists and recovery_info(it['path'], None) is not None
            except ValueError:
                recovered = False
            out.append({**it, 'exists': exists, 'hasRecovery': recovered})
    return out


def add_recent(path: str, name: str | None = None) -> list[dict]:
    p = project_path(path)
    with _lock:
        items = [it for it in list_recents() if os.path.normcase(it['path']) != os.path.normcase(str(p))]
        items.insert(0, {'path': str(p), 'name': name or p.stem, 'lastOpened': _now()})
        items = [{k: v for k, v in it.items() if k not in ('exists', 'hasRecovery')} for it in items[:MAX_RECENTS]]
        atomic_write(_recents_file(), json.dumps(items, indent=1).encode('utf-8'))
    return list_recents()


def remove_recent(path: str) -> list[dict]:
    with _lock:
        items = [{k: v for k, v in it.items() if k not in ('exists', 'hasRecovery')} for it in list_recents()
                 if os.path.normcase(it['path']) != os.path.normcase(path)]
        atomic_write(_recents_file(), json.dumps(items, indent=1).encode('utf-8'))
    return list_recents()
