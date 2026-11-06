"""Version info, update check and one-click update.

The update check reads two small files from the public repository (`VERSION`
and `CHANGELOG.md` on `main`); nothing about the user or their data is sent.
The result is cached for a few hours so repeated page loads don't refetch.

"Update now" starts `scripts/update-geochem.ps1` in its own console window.
That script stops the servers and the app window, fetches the new version,
installs changed dependencies and restarts GeoChem.
"""
from __future__ import annotations

import logging
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

from fastapi import APIRouter, HTTPException

from app.api.projects import guard
from app.core import version as v

logger = logging.getLogger(__name__)
router = APIRouter()

REPO = os.environ.get('GEOCHEM_UPDATE_REPO', 'LinearGeoscience/geochem')
RAW_BASE = f'https://raw.githubusercontent.com/{REPO}/main'
RELEASES_URL = f'https://github.com/{REPO}/releases'
CACHE_SECONDS = 6 * 3600
TIMEOUT_SECONDS = 6
UPDATE_SCRIPT = v.REPO_ROOT / 'scripts' / 'update-geochem.ps1'

_cache: dict = {'at': 0.0, 'result': None}


def _fetch(path: str) -> str:
    req = urllib.request.Request(f'{RAW_BASE}/{path}', headers={'User-Agent': 'GeoChem-update-check'})
    with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
        return resp.read().decode('utf-8', 'replace')


def _apply_blocker() -> str | None:
    """Why one-click update can't run here (None = it can)."""
    if sys.platform != 'win32':
        return 'One-click update is Windows only. Download the new version from GitHub.'
    if not UPDATE_SCRIPT.exists():
        return 'The updater script is missing. Download the new version from GitHub.'
    if v.is_dev_checkout():
        return 'This is a development copy; update it with git instead.'
    return None


@router.get('/version')
def get_version():
    """Installed version and its release notes."""
    current = v.read_version()
    entries = v.read_changelog()
    return {
        'version': current,
        'notes': next((e for e in entries if e['version'] == current), None),
        'changelog': entries,
        'releasesUrl': RELEASES_URL,
    }


@router.get('/updates/check')
def check_for_update(force: bool = False):
    """Compare the installed version with the latest published one."""
    now = time.time()
    cached = _cache['result']
    if not force and cached and now - _cache['at'] < CACHE_SECONDS and cached['current'] == v.read_version():
        return cached

    current = v.read_version()
    result = {
        'current': current, 'latest': None, 'updateAvailable': False, 'entries': [],
        'checkedAt': int(now), 'error': None, 'releasesUrl': RELEASES_URL,
        'canApply': False, 'applyBlocker': _apply_blocker(),
    }
    try:
        latest = _fetch('VERSION').strip()
        if not v.parse_version(latest):
            raise ValueError(f'unexpected version text {latest[:40]!r}')
        result['latest'] = latest
        if v.is_newer(latest, current):
            result['updateAvailable'] = True
            try:
                remote = v.parse_changelog(_fetch('CHANGELOG.md'))
            except Exception:   # notes are a nice-to-have; the version is what matters
                remote = []
            result['entries'] = v.entries_newer_than(remote, current, up_to=latest)
            result['canApply'] = result['applyBlocker'] is None
    except Exception as e:
        logger.info('Update check failed: %s', e)
        result['error'] = 'Could not reach GitHub to check for updates.'
        _cache.update(at=0.0, result=None)   # retry on the next request
        return result
    _cache.update(at=now, result=result)
    return result


@router.post('/updates/apply', dependencies=guard)
def apply_update():
    """Start the updater in its own window; it closes and restarts GeoChem."""
    blocker = _apply_blocker()
    if blocker:
        raise HTTPException(400, blocker)
    # Run a temp copy: the update rewrites the script file while it runs.
    tmp = os.path.join(tempfile.gettempdir(), 'geochem-update.ps1')
    shutil.copyfile(UPDATE_SCRIPT, tmp)
    # `start` gives the updater its own console, detached from the server process
    # tree it is about to stop.
    subprocess.Popen(
        ['cmd', '/c', 'start', 'GeoChem update', 'powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass',
         '-File', tmp, '-RepoRoot', str(v.REPO_ROOT), '-Restart', '-FromApp'],
        cwd=tempfile.gettempdir(),
        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
    )
    return {'started': True}
