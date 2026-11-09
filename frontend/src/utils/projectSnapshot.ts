/**
 * IndexedDB snapshot of the current project (Phase 7).
 *
 * Purpose: protect unsaved work. The file-based autosave can only save in
 * place once the user has done a manual "Save As" in a Chromium browser —
 * before that (and on Firefox/Safari) autosave was inert, and a browser
 * refresh lost everything because appStore has no persistence. The autosave
 * timer now falls back to writing the full ProjectData here, and on startup
 * the app offers to recover it.
 *
 * IndexedDB (not localStorage) because datasets can be 100k+ rows — IDB
 * stores structured clones without a JSON.stringify size wall.
 */

const DB_NAME = 'geochem-snapshot';
const STORE_NAME = 'snapshots';
const KEY = 'latest';

export interface ProjectSnapshot {
    data: any; // ProjectData — typed loosely to avoid a store->util import cycle
    savedAt: string;
    projectName: string;
    rowCount: number;
}

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains(STORE_NAME)) {
                req.result.createObjectStore(STORE_NAME);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export async function saveSnapshot(projectData: any): Promise<void> {
    const db = await openDb();
    try {
        const snapshot: ProjectSnapshot = {
            data: projectData,
            savedAt: new Date().toISOString(),
            projectName: projectData?.metadata?.name ?? 'Untitled Project',
            rowCount: projectData?.metadata?.rowCount ?? 0,
        };
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put(snapshot, KEY);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } finally {
        db.close();
    }
}

export async function loadSnapshot(): Promise<ProjectSnapshot | null> {
    const db = await openDb();
    try {
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).get(KEY);
            req.onsuccess = () => resolve(req.result ?? null);
            req.onerror = () => reject(req.error);
        });
    } finally {
        db.close();
    }
}

export async function clearSnapshot(): Promise<void> {
    const db = await openDb();
    try {
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).delete(KEY);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } finally {
        db.close();
    }
}
