/**
 * Drillhole planner state: the planned holes (what was typed or dragged,
 * never the computed traces) and the planner's settings. One store: every
 * view draws from it, and nothing writes back when it draws.
 *
 * Holes are planned on the 3D view's active slice (the slice bar owns it);
 * the planner has no section of its own. A target or collar only moves when
 * the user moves it: moving the slice never does.
 *
 * Plans are kept for the browser session only (not saved with the project).
 * Closing or reloading the page with plans changed since the last export
 * asks first.
 */
import { create } from 'zustand';
import { HoleInput, PLAN_DEFAULTS, PlanPoint, SurveyStation, WedgeParent } from '../../../../utils/drillholePlan';
import { PAD_DEFAULTS } from '../../../../utils/drillholePlanPads';
import { WEDGE_DEFAULTS } from '../../../../utils/drillholePlanWedge';
import { WEDGE_RATE_LIMITS, type RateLimits } from '../../../../utils/drillholePlanWedgeRates';

/** The topography a hole is projected to / takes its RL from */
export type TopoRef = { kind: 'mesh'; key: string } | { kind: 'flat'; rl: number };

export interface HoleStyle {
    color: string;
    /** Pixels */
    width: number;
}

export interface PlanHole {
    /** Internal id (the Hole ID can be changed) */
    id: string;
    input: HoleInput;
    topo: TopoRef | null;
    style: HoleStyle;
    visible: boolean;
    /** A wedge: the hole as it was before it became one (Undo wedge restores it) */
    beforeWedge?: { input: HoleInput; topo: TopoRef | null } | null;
}

export interface PlanSettings {
    liftLimit: number;
    rlTolerance: number;
    maxBackLength: number;
    /** Topography for new holes */
    defaultTopo: TopoRef | null;
    /** Depth ticks along planned holes in 3D */
    depthTicks: boolean;
    tickInterval: number;
    surveyInterval: number;
    /** Selecting a hole turns the 3D slice into the upright plane through its collar and target */
    followSelection: boolean;
    /** Name every planned hole in 3D (else only the selected one) */
    labelAll: boolean;
    /** The pad set collars are snapped to (a point set of the scene) */
    padSetId: string | null;
    /** Pads further than this from where the guide hole reaches the surface are not tried (m) */
    padRadius: number;
    /** Largest change from the guide's collar dip / azimuth when snapping to a pad (degrees) */
    padMaxDip: number;
    padMaxAzi: number;
    /** Wedges: no kick-off shallower than this (m) */
    minKop: number;
    /** Wedges: the lift / drift a daughter may take when its rates are solved (°/100 m, min to max); a hole may have its own */
    wedgeLimits: RateLimits;
}

/** A target point read from a file */
export interface TargetPoint {
    id: string;
    e: number;
    n: number;
    rl: number;
}

/** What "Apply to all" changes on every hole planned from a target (null: leave as it is) */
export interface AllHolesPatch {
    lift: number | null;
    drift: number | null;
    /** Dip / azimuth at the target: holes projected to the surface only */
    targetDip: number | null;
    targetAzi: number | null;
    topo: TopoRef | null;
}

/** The next click on the slice places the selected hole's target or collar */
export type PlanTool = 'target' | 'collar' | null;

const COLORS = ['#d81b60', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa', '#00897b', '#6d4c41', '#3949ab'];

interface PlanState {
    holes: PlanHole[];
    selectedId: string | null;
    settings: PlanSettings;
    /** The slice also drawn in 2D beside the 3D view */
    view2d: { on: boolean; ratio: number };
    tool: PlanTool;
    /** Bumped by every change to the holes */
    version: number;
    /** The version last exported (or imported) */
    exportedVersion: number;

    addHole: (mode: HoleInput['mode'], init?: Partial<HoleInput>) => string;
    updateHole: (id: string, patch: Partial<HoleInput>) => void;
    setHoleMeta: (id: string, patch: Partial<Pick<PlanHole, 'topo' | 'style' | 'visible'>>) => void;
    removeHole: (id: string) => void;
    removeHoles: (ids: string[]) => void;
    /** Wedges back to the holes they were (name, way of planning, collar, pad, rates); returns old → new names */
    undoWedges: (ids: string[]) => { from: string; to: string }[];
    duplicateHole: (id: string) => string | null;
    /** Imported holes: same Hole ID replaces, others are added */
    putHoles: (holes: { input: HoleInput; topo: TopoRef | null }[]) => void;
    select: (id: string | null) => void;
    setSettings: (patch: Partial<PlanSettings>) => void;
    setView2d: (patch: Partial<{ on: boolean; ratio: number }>) => void;
    setTool: (tool: PlanTool) => void;
    markExported: () => void;
    /**
     * Targets from a file: a new ID becomes a hole projected from its target
     * to the surface (`base`: its dip / azimuth at the target, lift, drift,
     * extension); an ID already planned gets the new target and keeps the rest.
     */
    importTargets: (targets: TargetPoint[], base: Partial<HoleInput>, topo: TopoRef) => { added: string[]; updated: string[] };
    /** The same values on every hole planned from a target; how many holes changed */
    applyToAll: (patch: AllHolesPatch) => number;
    /** Survey stations of existing drillholes used as wedge parents (from a survey CSV), by Hole ID */
    parentSurveys: Record<string, SurveyStation[]>;
    setParentSurvey: (hole: string, stations: SurveyStation[] | null) => void;
    /**
     * Holes become wedges (daughters) off a parent, keeping their targets.
     * `kops`: each daughter's kick-off depth (null: none works yet), for the
     * numbering: deepest = W1. Returns the new names, old → new.
     */
    /** Daughters keep their target (the one worked out, for a hole planned by collar) */
    makeWedges: (parent: WedgeParent, parentName: string, daughters: { id: string; kop: number | null; target?: PlanPoint }[], base: Partial<HoleInput>) => { from: string; to: string }[];
    /** Show or hide several holes at once */
    setVisible: (ids: string[], visible: boolean) => void;
    /** Name a parent's wedges W1, W2 … from the deepest kick-off up */
    renumberWedges: (parentName: string, kops: Map<string, number | null>) => { from: string; to: string }[];
}

const emptyPoint = () => ({ e: null, n: null, rl: null });

export function newHoleInput(name: string, mode: HoleInput['mode']): HoleInput {
    return {
        name, mode, collar: emptyPoint(), rlFromTopo: false, dip: -60, azi: null, lift: 0, drift: 0, eoh: null,
        target: emptyPoint(), method: 'surface-curved', targetDip: -60, targetAzi: null, extension: 0,
    };
}

/** The next free name like P001, P002 … */
export function nextHoleName(taken: Iterable<string>): string {
    const used = new Set(taken);
    for (let i = 1; ; i++) {
        const name = `P${String(i).padStart(3, '0')}`;
        if (!used.has(name)) return name;
    }
}

let counter = 0;
const newId = () => `plan-${Date.now().toString(36)}-${(counter++).toString(36)}`;
const newStyle = (n: number): HoleStyle => ({ color: COLORS[n % COLORS.length], width: 3 });

export const usePlanStore = create<PlanState>()((set, get) => ({
    holes: [],
    selectedId: null,
    settings: {
        liftLimit: PLAN_DEFAULTS.liftLimit, rlTolerance: PLAN_DEFAULTS.rlTolerance, maxBackLength: PLAN_DEFAULTS.maxBackLength,
        defaultTopo: null, depthTicks: false, tickInterval: 50, surveyInterval: 30, followSelection: true, labelAll: true,
        padSetId: null, padRadius: PAD_DEFAULTS.radius, padMaxDip: PAD_DEFAULTS.maxDipChange, padMaxAzi: PAD_DEFAULTS.maxAziChange, minKop: WEDGE_DEFAULTS.minKop,
        wedgeLimits: { ...WEDGE_RATE_LIMITS },
    },
    view2d: { on: false, ratio: 0.5 },
    tool: null,
    version: 0,
    exportedVersion: 0,

    addHole: (mode, init) => {
        const s = get();
        const id = newId();
        const name = init?.name ?? nextHoleName(s.holes.map(h => h.input.name));
        const hole: PlanHole = { id, input: { ...newHoleInput(name, mode), ...init, name }, topo: s.settings.defaultTopo, style: newStyle(s.holes.length), visible: true };
        set({ holes: [...s.holes, hole], selectedId: id, version: s.version + 1 });
        return id;
    },
    updateHole: (id, patch) => set(s => ({
        holes: s.holes.map(h => (h.id === id ? { ...h, input: { ...h.input, ...patch } } : h)), version: s.version + 1,
    })),
    setHoleMeta: (id, patch) => set(s => ({
        holes: s.holes.map(h => (h.id === id ? { ...h, ...patch } : h)), version: s.version + 1,
    })),
    setVisible: (ids, visible) => set(s => {
        const pick = new Set(ids);
        return { holes: s.holes.map(h => (pick.has(h.id) && h.visible !== visible ? { ...h, visible } : h)), version: s.version + 1 };
    }),
    removeHole: id => get().removeHoles([id]),
    removeHoles: ids => set(s => {
        const gone = new Set(ids);
        const holes = s.holes.filter(h => !gone.has(h.id));
        return { holes, selectedId: s.selectedId && gone.has(s.selectedId) ? (holes[0]?.id ?? null) : s.selectedId, version: s.version + 1, tool: null };
    }),
    undoWedges: ids => {
        const s = get();
        const back = new Set(ids);
        const restored: { from: string; to: string }[] = [];
        const holes = s.holes.map(h => {
            if (!back.has(h.id) || h.input.mode !== 'wedge') return h;
            // As it was before it became a wedge; else (made before this was kept) back to its old ID, collar to target
            const was = h.beforeWedge;
            const input: HoleInput = was ? was.input : {
                ...h.input, mode: 'target', method: h.input.method === 'surface-straight' || h.input.method === 'surface-curved' ? h.input.method : 'lift-drift',
                name: h.input.fromTarget ?? h.input.name, parent: null, kopDepth: null, fromTarget: null,
            };
            restored.push({ from: h.input.name, to: input.name });
            return { ...h, input, topo: was ? was.topo : h.topo, beforeWedge: null };
        });
        set({ holes, version: s.version + 1 });
        return restored;
    },
    duplicateHole: id => {
        const s = get();
        const from = s.holes.find(h => h.id === id);
        if (!from) return null;
        const copy: PlanHole = { ...from, id: newId(), input: { ...from.input, name: nextHoleName(s.holes.map(h => h.input.name)) }, style: newStyle(s.holes.length) };
        set({ holes: [...s.holes, copy], selectedId: copy.id, version: s.version + 1 });
        return copy.id;
    },
    putHoles: incoming => set(s => {
        const holes = [...s.holes];
        for (const { input, topo } of incoming) {
            const at = holes.findIndex(h => h.input.name === input.name);
            if (at >= 0) holes[at] = { ...holes[at], input, topo };
            else holes.push({ id: newId(), input, topo, style: newStyle(holes.length), visible: true });
        }
        // Just read from files: nothing new to lose
        return { holes, selectedId: s.selectedId ?? holes[0]?.id ?? null, version: s.version + 1, exportedVersion: s.version + 1 };
    }),
    select: id => set(s => (s.selectedId === id ? {} : { selectedId: id, tool: null })),
    setSettings: patch => set(s => ({ settings: { ...s.settings, ...patch } })),
    setView2d: patch => set(s => ({ view2d: { ...s.view2d, ...patch } })),
    setTool: tool => set({ tool }),
    markExported: () => set(s => ({ exportedVersion: s.version })),
    importTargets: (targets, base, topo) => {
        const s = get();
        const holes = [...s.holes];
        const added: string[] = [], updated: string[] = [];
        for (const t of targets) {
            const target = { e: t.e, n: t.n, rl: t.rl };
            const at = holes.findIndex(h => h.input.name === t.id);
            if (at >= 0) {
                // A hole planned by its collar has no target: it becomes collar to target, keeping its collar and rates
                const was = holes[at].input;
                holes[at] = { ...holes[at], input: { ...was, target, ...(was.mode === 'collar' ? { mode: 'target' as const, method: 'lift-drift' as const } : {}) } };
                updated.push(t.id);
            } else {
                holes.push({
                    id: newId(), input: { ...newHoleInput(t.id, 'target'), method: 'surface-curved', ...base, name: t.id, target },
                    topo, style: newStyle(holes.length), visible: true,
                });
                added.push(t.id);
            }
        }
        const first = holes.find(h => h.input.name === (added[0] ?? updated[0]));
        set({ holes, selectedId: s.selectedId ?? first?.id ?? null, version: s.version + 1 });
        return { added, updated };
    },
    parentSurveys: {},
    setParentSurvey: (hole, stations) => set(s => {
        const next = { ...s.parentSurveys };
        if (stations) next[hole] = stations; else delete next[hole];
        return { parentSurveys: next, version: s.version + 1 };
    }),
    makeWedges: (parent, parentName, daughters, base) => {
        const s = get();
        const byId = new Map(daughters.map(d => [d.id, d]));
        const holes = s.holes.map(h => (byId.has(h.id) ? {
            // What it was, for Undo wedge (a hole already a wedge keeps what it was before the first time)
            ...h, beforeWedge: h.beforeWedge ?? { input: h.input, topo: h.topo }, input: {
                ...h.input, ...base, mode: 'wedge' as const, parent, kopDepth: null, target: byId.get(h.id)!.target ?? h.input.target,
                fromTarget: h.input.fromTarget ?? h.input.name, collarPad: null, collarHole: null,
            },
        } : h));
        set({ holes, version: s.version + 1 });
        return get().renumberWedges(parentName, new Map(daughters.map(d => [d.id, d.kop])));
    },
    renumberWedges: (parentName, kops) => {
        const s = get();
        const parentKey = (p: WedgeParent | null | undefined) => (!p ? '' : p.kind === 'planned' ? `planned:${p.id}` : `name:${p.name}`);
        // The parent of the holes being renumbered: those in `kops`, or all of this parent's wedges
        const first = s.holes.find(h => kops.has(h.id) && h.input.mode === 'wedge');
        if (!first) return [];
        const key = parentKey(first.input.parent);
        const family = s.holes.filter(h => h.input.mode === 'wedge' && parentKey(h.input.parent) === key);
        // Deepest kick-off first (W1); those with no kick-off yet last, in list order
        const order = [...family].sort((a, b) => (kops.get(b.id) ?? -Infinity) - (kops.get(a.id) ?? -Infinity));
        const renamed: { from: string; to: string }[] = [];
        const others = new Set(s.holes.filter(h => !family.includes(h)).map(h => h.input.name));
        let k = 1;
        const names = new Map<string, string>();
        for (const h of order) {
            let name = `${parentName}_W${k++}`;
            while (others.has(name)) name = `${parentName}_W${k++}`;
            names.set(h.id, name);
            if (name !== h.input.name) renamed.push({ from: h.input.name, to: name });
        }
        set({ holes: s.holes.map(h => (names.has(h.id) ? { ...h, input: { ...h.input, name: names.get(h.id)! } } : h)), version: s.version + 1 });
        return renamed;
    },
    applyToAll: patch => {
        const s = get();
        let changed = 0;
        const holes = s.holes.map(h => {
            if (h.input.mode !== 'target') return h;
            const surface = h.input.method === 'surface-straight' || h.input.method === 'surface-curved';
            const input: HoleInput = { ...h.input };
            if (patch.lift !== null) input.lift = patch.lift;
            if (patch.drift !== null) input.drift = patch.drift;
            if (surface && patch.targetDip !== null) input.targetDip = patch.targetDip;
            if (surface && patch.targetAzi !== null) input.targetAzi = patch.targetAzi;
            // Lift / drift only act on a curved projection
            if (surface && (patch.lift !== null || patch.drift !== null)) input.method = 'surface-curved';
            changed++;
            return { ...h, input, topo: patch.topo ?? h.topo };
        });
        if (changed) set({ holes, version: s.version + 1 });
        return changed;
    },
}));

/** Plans changed since they were last exported */
export const hasUnexportedPlans = (s: Pick<PlanState, 'holes' | 'version' | 'exportedVersion'>) => s.holes.length > 0 && s.version !== s.exportedVersion;

// Ask before the page is closed or reloaded with plans that were never exported
if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', e => {
        if (!hasUnexportedPlans(usePlanStore.getState())) return;
        e.preventDefault();
        e.returnValue = '';
    });
}
