/**
 * App version + update check (Phase 81). The backend compares the installed
 * VERSION with the one on GitHub and returns the release notes in between.
 * Session state only; the opt-out lives in uiStore (persisted).
 */
import { create } from 'zustand';
import { notify } from './notificationStore';

/** Version baked in at build time (repo-root VERSION); the backend's answer wins once loaded. */
export const BUILD_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '';

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
    /** How this copy updates: development repo (git by hand), git copy or zip copy (the updater) */
    install?: 'dev' | 'git' | 'zip';
    /** Why one-click update can't run here (null = it can) */
    updateBlocker?: string | null;
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

/** One line on the state of the last check, for the version menu. */
export function checkStatusText(check: UpdateCheck | null, checking: boolean): string {
    if (checking) return 'Checking GitHub…';
    if (!check) return 'Not checked yet';
    if (check.error) return check.error;
    if (check.updateAvailable) return `Version ${check.latest} is available`;
    return `Up to date (checked ${new Date(check.checkedAt * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;
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
    /** Check now and say the result in a notification (menu commands) */
    checkAndReport: () => Promise<void>;
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
            if (!r.ok) throw new Error(String(r.status));
            const check: UpdateCheck = await r.json();
            set({ check, checking: false });
            return check;
        } catch {
            // The GeoChem server didn't answer: say so instead of showing nothing
            const current = get().info?.version ?? BUILD_VERSION;
            const check: UpdateCheck = {
                current, latest: null, updateAvailable: false, entries: [], checkedAt: Math.floor(Date.now() / 1000),
                error: 'Could not check: the GeoChem server did not answer.', releasesUrl: 'https://github.com/LinearGeoscience/geochem/releases',
                canApply: false, applyBlocker: null,
            };
            set({ check, checking: false });
            return check;
        }
    },
    checkAndReport: async () => {
        const check = await get().checkForUpdate(true);
        if (!check) return;
        if (check.error) notify(check.error, 'warning');
        else if (check.updateAvailable) get().setDialog('update');
        else notify(`GeoChem ${check.current} is the latest version.`, 'success');
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
