/**
 * App version + update check (Phase 81). The backend compares the installed
 * VERSION with the one on GitHub and returns the release notes in between.
 * Session state only; the opt-out lives in uiStore (persisted).
 */
import { create } from 'zustand';

export interface ReleaseEntry {
    version: string;
    date: string;
    /** Markdown body of the CHANGELOG section (### headings, - bullets) */
    notes: string;
}

export interface VersionInfo {
    version: string;
    notes: ReleaseEntry | null;
    changelog: ReleaseEntry[];
    releasesUrl: string;
}

export interface UpdateCheck {
    current: string;
    latest: string | null;
    updateAvailable: boolean;
    /** Changelog entries newer than the installed version, newest first */
    entries: ReleaseEntry[];
    checkedAt: number;
    error: string | null;
    releasesUrl: string;
    canApply: boolean;
    applyBlocker: string | null;
}

interface UpdateState {
    info: VersionInfo | null;
    check: UpdateCheck | null;
    checking: boolean;
    applying: boolean;
    applyError: string | null;
    /** 'update' = what's new in the available update; 'current' = this version's notes */
    dialog: 'update' | 'current' | null;
    loadVersion: () => Promise<void>;
    checkForUpdate: (force?: boolean) => Promise<UpdateCheck | null>;
    applyUpdate: () => Promise<boolean>;
    setDialog: (dialog: 'update' | 'current' | null) => void;
}

export const useUpdateStore = create<UpdateState>()((set, get) => ({
    info: null,
    check: null,
    checking: false,
    applying: false,
    applyError: null,
    dialog: null,
    loadVersion: async () => {
        try {
            const r = await fetch('/api/version');
            if (r.ok) set({ info: await r.json() });
        } catch { /* backend not up yet: the version label just stays empty */ }
    },
    checkForUpdate: async (force = false) => {
        if (get().checking) return get().check;
        set({ checking: true });
        try {
            const r = await fetch(`/api/updates/check${force ? '?force=true' : ''}`);
            const check: UpdateCheck | null = r.ok ? await r.json() : null;
            set({ check, checking: false });
            return check;
        } catch {
            set({ checking: false });
            return null;
        }
    },
    applyUpdate: async () => {
        set({ applying: true, applyError: null });
        try {
            const r = await fetch('/api/updates/apply', { method: 'POST', headers: { 'X-GeoChem-Client': '1' } });
            if (!r.ok) {
                const body = await r.json().catch(() => ({}));
                set({ applying: false, applyError: body?.detail ?? `Update could not start (${r.status})` });
                return false;
            }
            return true;   // the updater closes this window; stay in "applying"
        } catch {
            set({ applying: false, applyError: 'Update could not start: the GeoChem server did not answer.' });
            return false;
        }
    },
    setDialog: (dialog) => set({ dialog }),
}));
