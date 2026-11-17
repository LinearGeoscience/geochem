"""App version and release notes.

The single source of truth is the `VERSION` file at the repository root
(`X.Y.Z`); `CHANGELOG.md` beside it holds the user-facing release notes, one
`## X.Y.Z - YYYY-MM-DD` section per release, newest first.
"""
from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
VERSION_FILE = REPO_ROOT / 'VERSION'
CHANGELOG_FILE = REPO_ROOT / 'CHANGELOG.md'

_SEMVER = re.compile(r'^v?(\d+)\.(\d+)\.(\d+)$')
_HEADING = re.compile(r'^##\s+\[?v?(\d+\.\d+\.\d+)\]?\s*(?:[-–—]\s*(.+?))?\s*$')


def parse_version(text: str) -> tuple[int, int, int] | None:
    m = _SEMVER.match((text or '').strip())
    return (int(m[1]), int(m[2]), int(m[3])) if m else None


def is_newer(candidate: str, current: str) -> bool:
    a, b = parse_version(candidate), parse_version(current)
    return bool(a and b and a > b)


def read_version() -> str:
    try:
        text = VERSION_FILE.read_text(encoding='utf-8').strip()
    except OSError:
        return '0.0.0'
    return text if parse_version(text) else '0.0.0'


def parse_changelog(text: str) -> list[dict]:
    """`## X.Y.Z - date` sections -> [{version, date, notes}] in file order."""
    entries: list[dict] = []
    current: dict | None = None
    for line in (text or '').splitlines():
        m = _HEADING.match(line)
        if m:
            current = {'version': m[1], 'date': (m[2] or '').strip(), 'lines': []}
            entries.append(current)
        elif line.startswith('## '):
            current = None   # an unversioned section ends the previous entry
        elif current is not None:
            current['lines'].append(line)
    return [{'version': e['version'], 'date': e['date'], 'notes': '\n'.join(e['lines']).strip()}
            for e in entries]


def read_changelog() -> list[dict]:
    try:
        return parse_changelog(CHANGELOG_FILE.read_text(encoding='utf-8'))
    except OSError:
        return []


def entries_newer_than(entries: list[dict], version: str, up_to: str | None = None) -> list[dict]:
    """Entries after `version` (and not after `up_to`), newest first."""
    out = [e for e in entries if is_newer(e['version'], version)
           and (up_to is None or not is_newer(e['version'], up_to))]
    return sorted(out, key=lambda e: parse_version(e['version']), reverse=True)


def is_dev_checkout() -> bool:
    """The full development repo (never the public copy) has the publish script."""
    return (REPO_ROOT / 'scripts' / 'publish_public.py').exists()
