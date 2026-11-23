/**
 * Named versions of the modelling scene: the scene as it was at a moment,
 * kept under a name, to go back to. Saved in the project file. Going back
 * replaces the scene (one undo step); the versions themselves are outside
 * undo, as the report is.
 */
import { create } from 'zustand';
import { savedScene, type SavedScene } from '../features/model/inputs';
import { readScene, useModelStore } from './modelStore';

export interface SceneVersion {
    id: string;
    name: string;
    /** When it was kept (ISO) */
    date: string;
    scene: SavedScene;
    /** Where it came from, when not kept by hand: "Rebuild kit of Mine" */
    from?: string;
}

export const MAX_VERSIONS = 30;

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** What a version holds, in a line */
export function versionSummary(v: SceneVersion): string {
    const parts = [
        v.scene.models?.length ? plural(v.scene.models.length, 'model') : '',
        v.scene.surfaces.length ? plural(v.scene.surfaces.length, 'surface') : '',
    ].filter(Boolean);
    const day = v.date ? new Date(v.date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
    return [day, parts.join(', ') || 'an empty scene'].filter(Boolean).join(' · ');
}

interface VersionsState {
    versions: SceneVersion[];
    /** Keep the scene as it is now. Its id (null: there are as many as there can be) */
    keep: (name?: string) => string | null;
    /** Keep a scene from elsewhere (a rebuild kit read back) as a version */
    add: (name: string, scene: SavedScene, from?: string) => string | null;
    /** Make a version the scene. False: no such version */
    goBack: (id: string) => boolean;
    rename: (id: string, name: string) => void;
    remove: (id: string) => void;
    /** Replace them all (project open, new project) */
    setVersions: (saved: unknown) => void;
}

const freeName = (wanted: string, taken: readonly string[]) => {
    const base = wanted.trim() || 'Version';
    if (!taken.includes(base)) return base;
    for (let k = 2; ; k++) if (!taken.includes(`${base} (${k})`)) return `${base} (${k})`;
};

/** Saved versions in today's shape; anything unreadable is dropped */
export function readVersions(saved: unknown): SceneVersion[] {
    const out: SceneVersion[] = [];
    for (const raw of Array.isArray(saved) ? saved : []) {
        const v = raw as Partial<SceneVersion> | null;
        if (!v || typeof v.id !== 'string' || typeof v.name !== 'string' || !v.scene || out.some(x => x.id === v.id) || out.length >= MAX_VERSIONS) continue;
        // (Through the scene's own reader: an old version is brought up to date as an old project is)
        out.push({ id: v.id, name: v.name, date: typeof v.date === 'string' ? v.date : '', scene: savedScene(readScene(v.scene)), ...(typeof v.from === 'string' ? { from: v.from } : {}) });
    }
    return out;
}

export const useSceneVersions = create<VersionsState>()((set, get) => ({
    versions: [],
    keep: (name) => get().add(name ?? `Version ${get().versions.length + 1}`, savedScene(useModelStore.getState().scene)),
    add: (name, scene, from) => {
        const had = get().versions;
        if (had.length >= MAX_VERSIONS) return null;
        let n = had.length + 1;
        while (had.some(v => v.id === `v${n}`)) n++;
        const version: SceneVersion = { id: `v${n}`, name: freeName(name, had.map(v => v.name)), date: new Date().toISOString(), scene: JSON.parse(JSON.stringify(scene)) as SavedScene, ...(from ? { from } : {}) };
        set({ versions: [...had, version] });
        return version.id;
    },
    goBack: (id) => {
        const version = get().versions.find(v => v.id === id);
        if (!version) return false;
        useModelStore.getState().setScene(readScene(JSON.parse(JSON.stringify(version.scene))));
        return true;
    },
    rename: (id, name) => set(s => {
        const text = name.trim();
        if (!text || !s.versions.some(v => v.id === id)) return s;
        return { versions: s.versions.map(v => (v.id === id ? { ...v, name: freeName(text, s.versions.filter(x => x.id !== id).map(x => x.name)) } : v)) };
    }),
    remove: (id) => set(s => ({ versions: s.versions.filter(v => v.id !== id) })),
    setVersions: (saved) => set({ versions: readVersions(saved) }),
}));
