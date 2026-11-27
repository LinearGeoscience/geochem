/**
 * Drill tracking. The project's planned programs (named sets of
 * planner holes), the latest drilled holes read from Acquire, and how they
 * are tracked against each other (links set by hand, holes set active by
 * hand, lift / drift given). Saved with the project as `drillTracking`.
 *
 * `editingId` (the program the drillhole planner has open) is for the
 * browser session only.
 */
import { create } from 'zustand';
import type { Rates } from '../utils/drillholePlan';
import type { AcquireLiveSettings, LiveDrillData } from '../utils/drillTrackImport';
import type { ActiveOverride } from '../utils/drillTrackLinks';
import type { TrackRules } from '../utils/drillTrackSurveys';
import { defaultRules } from '../features/drilltracking/presets';
import type { PlannedProgram, ProgramHole } from '../utils/plannedPrograms';
import { useAppStore, type PlotInstance } from './appStore';

export interface TrackingSettings {
    /** The program the drilled holes are tracked against */
    programId: string | null;
    /** Drilled hole → planned key (programId/holeId), or null for "none" */
    manualLinks: Record<string, string | null>;
    activeOverride: Record<string, ActiveOverride>;
    /** Drilled hole → the lift / drift of its third projection (absent: the planned hole's) */
    custom: Record<string, Rates>;
    rules: TrackRules;
    /** How the drilled holes were last read from Acquire (SQL), for Refresh (null: not read from Acquire) */
    acquire: AcquireLiveSettings | null;
}

export interface SavedDrillTracking {
    version: 1;
    programs: PlannedProgram[];
    live: LiveDrillData | null;
    tracking: TrackingSettings;
    /** The Drill tracking page's 3D view */
    views: PlotInstance[];
}

const PROGRAM_COLORS = ['#e53935', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa', '#00897b'];

const emptyTracking = (): TrackingSettings => ({ programId: null, manualLinks: {}, activeOverride: {}, custom: {}, rules: defaultRules(), acquire: null });

interface DrillTrackingState {
    programs: PlannedProgram[];
    live: LiveDrillData | null;
    tracking: TrackingSettings;
    editingId: string | null;

    /** Adds a program (a free name is found); returns its id */
    addProgram: (name: string, source: PlannedProgram['source'], holes: ProgramHole[]) => string;
    renameProgram: (id: string, name: string) => void;
    setProgramColor: (id: string, color: string) => void;
    /** The program's holes, as the planner has them now */
    setProgramHoles: (id: string, holes: ProgramHole[]) => void;
    removeProgram: (id: string) => void;
    setEditing: (id: string | null) => void;
    setLive: (live: LiveDrillData | null) => void;
    setTracking: (patch: Partial<TrackingSettings>) => void;
    /** A drilled hole's planned hole by hand (null: none; undefined: back to matching) */
    setManualLink: (hole: string, key: string | null | undefined) => void;
    setActiveOverride: (hole: string, value: ActiveOverride | null) => void;
    setCustomRates: (hole: string, rates: Rates | null) => void;
    load: (saved: SavedDrillTracking | undefined | null) => void;
}

const freeName = (name: string, taken: readonly string[]) => {
    const base = name.trim() || 'Program';
    if (!taken.includes(base)) return base;
    for (let k = 2; ; k++) if (!taken.includes(`${base} (${k})`)) return `${base} (${k})`;
};

const now = () => new Date().toISOString();
let counter = 0;

export const useDrillTrackingStore = create<DrillTrackingState>()((set, get) => ({
    programs: [],
    live: null,
    tracking: emptyTracking(),
    editingId: null,

    addProgram: (name, source, holes) => {
        const had = get().programs;
        let id = `prog-${Date.now().toString(36)}-${(counter++).toString(36)}`;
        while (had.some(p => p.id === id)) id += 'x';
        const t = now();
        const program: PlannedProgram = {
            id, name: freeName(name, had.map(p => p.name)), color: PROGRAM_COLORS[had.length % PROGRAM_COLORS.length],
            source, created: t, changed: t, holes,
        };
        set(s => ({ programs: [...s.programs, program], tracking: s.tracking.programId ? s.tracking : { ...s.tracking, programId: id } }));
        return id;
    },
    renameProgram: (id, name) => set(s => ({
        programs: s.programs.map(p => (p.id === id ? { ...p, name: freeName(name, s.programs.filter(o => o.id !== id).map(o => o.name)), changed: now() } : p)),
    })),
    setProgramColor: (id, color) => set(s => ({ programs: s.programs.map(p => (p.id === id ? { ...p, color } : p)) })),
    setProgramHoles: (id, holes) => set(s => ({ programs: s.programs.map(p => (p.id === id ? { ...p, holes, changed: now() } : p)) })),
    removeProgram: (id) => set(s => ({
        programs: s.programs.filter(p => p.id !== id),
        editingId: s.editingId === id ? null : s.editingId,
        tracking: s.tracking.programId === id ? { ...s.tracking, programId: s.programs.find(p => p.id !== id)?.id ?? null } : s.tracking,
    })),
    setEditing: (id) => set({ editingId: id }),
    setLive: (live) => set({ live }),
    setTracking: (patch) => set(s => ({ tracking: { ...s.tracking, ...patch } })),
    setManualLink: (hole, key) => set(s => {
        const manualLinks = { ...s.tracking.manualLinks };
        if (key === undefined) delete manualLinks[hole]; else manualLinks[hole] = key;
        return { tracking: { ...s.tracking, manualLinks } };
    }),
    setActiveOverride: (hole, value) => set(s => {
        const activeOverride = { ...s.tracking.activeOverride };
        if (value === null) delete activeOverride[hole]; else activeOverride[hole] = value;
        return { tracking: { ...s.tracking, activeOverride } };
    }),
    setCustomRates: (hole, rates) => set(s => {
        const custom = { ...s.tracking.custom };
        if (rates === null) delete custom[hole]; else custom[hole] = rates;
        return { tracking: { ...s.tracking, custom } };
    }),
    load: (saved) => {
        set({
            programs: saved?.programs ?? [], live: saved?.live ?? null, editingId: null,
            tracking: { ...emptyTracking(), ...saved?.tracking, rules: { ...defaultRules(), ...saved?.tracking?.rules } },
        });
        useAppStore.setState({ trackingViews: saved?.views ?? [] });
    },
}));

/** What the project file keeps (undefined: nothing to keep) */
export function saveDrillTracking(): SavedDrillTracking | undefined {
    const s = useDrillTrackingStore.getState();
    const views = useAppStore.getState().trackingViews;
    if (!s.programs.length && !s.live && !views.length) return undefined;
    return { version: 1, programs: s.programs, live: s.live, tracking: s.tracking, views };
}
