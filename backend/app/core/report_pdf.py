"""Report export (Phase 59): write report.html into the project's report/
folder and print it to PDF with a headless Chromium browser (Edge ships with
Windows; Chrome is used when installed). The browser gets a throwaway
profile so it never touches the user's own browser session.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from app.core import project_files as pf

PDF_TIMEOUT_S = 180


def find_browser() -> str | None:
    """Path of a Chromium browser that can print to PDF (GEOCHEM_BROWSER overrides)."""
    env = os.environ.get('GEOCHEM_BROWSER')
    if env:
        return env if Path(env).is_file() else None
    roots = [os.environ.get(k) for k in ('PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA')]
    candidates = [
        Path(r) / sub
        for r in roots if r
        for sub in ('Google/Chrome/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe')
    ]
    for c in candidates:
        if c.is_file():
            return str(c)
    for name in ('google-chrome', 'chromium', 'chromium-browser', 'chrome', 'msedge', 'microsoft-edge'):
        found = shutil.which(name)
        if found:
            return found
    return None


def html_to_pdf(html: Path, pdf: Path, browser: str | None = None) -> None:
    browser = browser or find_browser()
    if not browser:
        raise RuntimeError('No Chrome or Edge browser found to make the PDF')
    with tempfile.TemporaryDirectory(prefix='geochem-pdf-') as tmp:
        out = Path(tmp) / 'report.pdf'
        cmd = [
            browser, '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
            '--disable-extensions', f'--user-data-dir={Path(tmp) / "profile"}',
            '--no-pdf-header-footer', '--run-all-compositor-stages-before-draw',
            f'--print-to-pdf={out}', html.resolve().as_uri(),
        ]
        proc = subprocess.run(cmd, capture_output=True, timeout=PDF_TIMEOUT_S)
        if not out.is_file() or out.stat().st_size == 0:
            detail = proc.stderr.decode(errors='replace').strip().splitlines()[-1:] or ['no output']
            raise RuntimeError(f'The browser did not produce a PDF ({detail[0]})')
        pf.atomic_write(pdf, out.read_bytes())


def export_report(path: str, name: str, html: bytes, pdf: bool) -> dict:
    """Write <project>/report/<name>.html and, if asked, <name>.pdf."""
    html_info = pf.write_asset(path, 'report', f'{name}.html', html)
    result: dict = {'html': html_info['path'], 'pdf': None, 'pdfError': None}
    if pdf:
        pdf_path = pf.asset_path(path, 'report', f'{name}.pdf')
        try:
            html_to_pdf(Path(html_info['path']), pdf_path)
            result['pdf'] = str(pdf_path)
        except (RuntimeError, OSError, subprocess.TimeoutExpired) as e:
            result['pdfError'] = str(e)
    return result
