/**
 * Project files by full path through the local backend (backend/app/api/projects.py):
 * open/save, recovery copies, recent projects and native Open/Save dialogs.
 * Falls back to browser file access when the backend is not reachable.
 */
const BASE = '/api/projects';
const HEADERS = { 'X-GeoChem-Client': '1' };

export interface DiskRecent {
    path: string;
    name: string;
    lastOpened: string;
    exists: boolean;
    /** An autosave newer than the saved file is waiting */
    hasRecovery?: boolean;
}

export interface UnsavedRecovery {
    key: string;
    modified: string;
    size: number;
}

export interface SavedFileInfo {
    path: string;
    name: string;
    folder: string;
    modified: string | null;
}

let available: { ok: boolean; at: number } | null = null;

/** Is the backend file service reachable? (cached; a failure is re-checked after 30 s) */
export async function projectFilesAvailable(): Promise<boolean> {
    if (available && (available.ok || Date.now() - available.at < 30_000)) return available.ok;
    try {
        const r = await fetch(`${BASE}/info`, { headers: HEADERS });
        available = { ok: r.ok, at: Date.now() };
    } catch {
        available = { ok: false, at: Date.now() };
    }
    return available.ok;
}

async function call(url: string, init: RequestInit = {}): Promise<Response> {
    const r = await fetch(url, { ...init, headers: { ...HEADERS, ...(init.headers ?? {}) } });
    if (!r.ok) {
        let detail = r.statusText;
        try { detail = (await r.json()).detail ?? detail; } catch { /* not JSON */ }
        const err = new Error(detail) as Error & { status?: number };
        err.status = r.status;
        throw err;
    }
    return r;
}

const q = (params: Record<string, string | null | undefined>) =>
    new URLSearchParams(Object.entries(params).filter(([, v]) => v != null) as [string, string][]).toString();

export async function openProjectFile(path: string): Promise<{ blob: Blob; recoveryModified: string | null }> {
    const r = await call(`${BASE}/open?${q({ path })}`);
    return { blob: await r.blob(), recoveryModified: r.headers.get('X-Recovery-Modified') };
}

export async function saveProjectFile(path: string, blob: Blob): Promise<SavedFileInfo> {
    const r = await call(`${BASE}/save?${q({ path })}`, { method: 'POST', body: blob, headers: { 'Content-Type': 'application/octet-stream' } });
    return r.json();
}

export async function autosaveProjectFile(path: string | null, key: string, blob: Blob): Promise<{ path: string; modified: string }> {
    const r = await call(`${BASE}/autosave?${q({ path, key: path ? null : key })}`, { method: 'POST', body: blob, headers: { 'Content-Type': 'application/octet-stream' } });
    return r.json();
}

export async function readRecoveryFile(path: string | null, key?: string): Promise<Blob> {
    return (await call(`${BASE}/recovery?${q({ path, key: path ? null : key })}`)).blob();
}

export async function discardRecoveryFile(path: string | null, key?: string): Promise<void> {
    await call(`${BASE}/recovery?${q({ path, key: path ? null : key })}`, { method: 'DELETE' });
}

/** Recovery copies of projects that were never saved to a file, newest first. */
export async function listUnsavedRecoveries(): Promise<UnsavedRecovery[]> {
    return (await call(`${BASE}/recovery/unsaved`)).json();
}

export async function listRecentFiles(): Promise<DiskRecent[]> {
    return (await call(`${BASE}/recents`)).json();
}

export async function addRecentFile(path: string, name?: string): Promise<DiskRecent[]> {
    const r = await call(`${BASE}/recents`, { method: 'POST', body: JSON.stringify({ path, name }), headers: { 'Content-Type': 'application/json' } });
    return r.json();
}

export async function removeRecentFile(path: string): Promise<DiskRecent[]> {
    return (await call(`${BASE}/recents?${q({ path })}`, { method: 'DELETE' })).json();
}

/** Native Open dialog on this computer; null when cancelled. */
export async function chooseProjectToOpen(initialDir?: string | null): Promise<string | null> {
    const r = await call(`${BASE}/dialog/open`, { method: 'POST', body: JSON.stringify({ initialDir }), headers: { 'Content-Type': 'application/json' } });
    return (await r.json()).path;
}

/** Native Save dialog; with projectFolder the file goes in <dir>/<name>/<name>.chem. Null when cancelled. */
export async function chooseProjectSavePath(suggestedName: string, initialDir?: string | null, projectFolder = true): Promise<string | null> {
    const r = await call(`${BASE}/dialog/save`, { method: 'POST', body: JSON.stringify({ initialDir, suggestedName, projectFolder }), headers: { 'Content-Type': 'application/json' } });
    return (await r.json()).path;
}

export type ProjectSubfolder = 'figures' | 'exports' | 'report';

/** Write a file into <project folder>/<sub>/<name> (overwrites). */
export async function writeProjectAsset(projectPath: string, sub: ProjectSubfolder, name: string, blob: Blob): Promise<SavedFileInfo> {
    const r = await call(`${BASE}/asset?${q({ path: projectPath, sub, name })}`, { method: 'POST', body: blob, headers: { 'Content-Type': 'application/octet-stream' } });
    return r.json();
}

export interface ReportExportResult {
    html: string;
    pdf: string | null;
    /** Why the PDF could not be made (no Chrome/Edge, timeout) */
    pdfError: string | null;
}

/** Write <project>/report/<name>.html and print it to <name>.pdf. */
export async function exportReportFiles(projectPath: string, name: string, html: Blob, pdf = true): Promise<ReportExportResult> {
    const r = await call(`${BASE}/report?${q({ path: projectPath, name, pdf: String(pdf) })}`, { method: 'POST', body: html, headers: { 'Content-Type': 'text/html' } });
    return r.json();
}

/** Show the project folder (or a subfolder) in the file explorer. */
export async function revealProjectFolder(projectPath: string, sub?: ProjectSubfolder): Promise<void> {
    await call(`${BASE}/reveal?${q({ path: projectPath, sub })}`, { method: 'POST' });
}

const lastSeparator =(path: string) => Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));

/** Folder of a full path (Windows or POSIX separators). */
export function folderOf(path: string): string {
    const i = lastSeparator(path);
    return i > 0 ? path.slice(0, i) : path;
}

/** Last two folders of a file's path, for compact lists ("…\Work\Prairie Downs"). */
export function shortFolder(path: string): string {
    const parts = folderOf(path).split(/[\\/]/).filter(Boolean);
    const sep = path.includes('\\') ? '\\' : '/';
    return parts.length > 2 ? `…${sep}${parts.slice(-2).join(sep)}` : folderOf(path);
}

/** File name without extension. */
export function stemOf(path: string): string {
    return path.slice(lastSeparator(path) + 1).replace(/\.[^.]+$/, '');
}
