/**
 * The drillhole planner's holes, worked out from the plan store for one 3D
 * view: each hole's trace, solved values, errors and warnings
 * (utils/drillholePlan), against the topographies the project has (its
 * wireframes and surfaces), the holes already in the dataset, and the data's
 * extent. A hole is only worked out again when it, or what it depends on,
 * changes.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../../../store/appStore';
import { useModelStore } from '../../../../store/modelStore';
import { useModelCache } from '../../../model/modelCache';
import { useWireframeFiles } from '../../../model/wireframeFiles';
import { holePositions } from '../../../model/logging';
import { holeCollars } from '../../../model/collars';
import { sameCoords } from '../../../model/sceneActions';
import { HoleInput, PlanContext, PlanResult, Rates, Trace, Vec3, WedgeParent, planHole } from '../../../../utils/drillholePlan';
import { traceFromPoints, traceFromStations } from '../../../../utils/drillholePlanWedge';
import { averageRates, planWedge } from '../../../../utils/drillholePlanWedgeRates';
import type { Pad } from '../../../../utils/drillholePlanPads';
import type { InputSet, PointSet } from '../../../model/types';
import { Topography, flatTopography, meshTopography } from '../../../../utils/drillholePlanTopo';
import type { WireframePart } from '../wireframeParsers';
import { PlanHole, TopoRef, usePlanStore } from './planStore';

export interface PlannerColumns {
    x: string;
    y: string;
    z: string;
    hole: string | null;
    from: string | null;
    to: string | null;
}

export interface TopoOption {
    key: string;
    name: string;
    kind: 'wireframe' | 'surface';
}

export interface ComputedHole {
    hole: PlanHole;
    result: PlanResult;
    /** Its topography's name ('' for none) */
    topoName: string;
    /** A wedge: its parent's Hole ID */
    parentName?: string;
    /** A wedge still being worked out (its result is its last one, or empty) */
    pending?: boolean;
}

export interface Planner {
    /** The planner needs an elevation column */
    enabled: boolean;
    columns: PlannerColumns;
    holes: ComputedHole[];
    selected: ComputedHole | null;
    topoOptions: TopoOption[];
    topoOf: (ref: TopoRef | null) => Topography | null;
    topoName: (ref: TopoRef | null) => string;
    /** Name → ref, for imported holes */
    topoByName: (name: string) => TopoRef | null;
    existingIds: ReadonlySet<string>;
    /** Collars of the holes already in the dataset (world xyz), by hole ID */
    existingCollars: ReadonlyMap<string, [number, number, number]>;
    /** World extent of the data */
    dataBounds: { min: number[]; max: number[] } | null;
    /** A wedge parent's trace (from its collar), name and lift / drift; null when it has none */
    parentTraceOf: (p: WedgeParent) => { trace: Trace; name: string; rates: Rates } | null;
    /** The scene's pad sets, and the pads collars are snapped to (the chosen set, or the only one) */
    padSets: PointSet[];
    pads: Pad[];
    /** Wedges being worked out: how many done of how many (null: none waiting) */
    wedgeProgress: { done: number; total: number } | null;
}

/** Topographies built once per mesh */
const topoCache = new WeakMap<WireframePart, Topography | null>();
const meshTopo = (name: string, part: WireframePart) => {
    if (!topoCache.has(part)) topoCache.set(part, meshTopography(name, part.vertices, part.triangles));
    return topoCache.get(part) ?? null;
};
const flatCache = new Map<number, Topography>();
const flatTopo = (rl: number) => {
    let t = flatCache.get(rl);
    if (!t) { t = flatTopography(rl); flatCache.set(rl, t); }
    return t;
};

/** The scene's sets of points with a role (drill pads, target points), or those of one role */
export function roleSetsOf(inputs: readonly InputSet[] | undefined, role?: PointSet['role']): PointSet[] {
    return (inputs ?? []).filter((s): s is PointSet => s.kind === 'points' && !!s.role && (!role || s.role === role));
}

/** The scene's drill pads */
export const padSetsOf = (inputs: readonly InputSet[] | undefined) => roleSetsOf(inputs, 'pads');

/** Each hole's last result and what it was worked out from, by its inputs (showing, hiding or recolouring a hole works nothing out) */
const resultCache = new WeakMap<HoleInput, { deps: unknown[]; result: PlanResult }>();
/** Each wedge's last result, shown while it is worked out again */
const lastWedge = new Map<string, PlanResult>();
/** Wedges the wedge designer's preview already worked out, by hole id (used once) */
const primed = new Map<string, PlanResult>();
/** The wedge designer hands over what its preview worked out, so new wedges aren't worked out twice */
export function primeWedgeResults(results: Map<string, PlanResult>) {
    for (const [id, r] of results) primed.set(id, r);
}

const EMPTY_RESULT: PlanResult = {
    ok: false, collar: null, collarDip: null, collarAzi: null, lift: null, drift: null, solvedRates: false,
    target: null, targetDip: null, targetAzi: null, targetDepth: null, eoh: null, trace: null, issues: [], miss: null, wedge: null,
};

/** A wedge waiting to be worked out (one at a time, between frames, so the view stays live) */
interface PendingWedge { hole: PlanHole; deps: unknown[]; run: () => PlanResult }

export function usePlanner(columns: PlannerColumns, bounds: { min: number[]; max: number[] } | null, active: boolean): Planner {
    const { holes, selectedId, settings } = usePlanStore(useShallow(s => ({ holes: s.holes, selectedId: s.selectedId, settings: s.settings })));
    const scene = useModelStore(s => s.scene);
    const fits = useModelCache(s => s.byId);
    const files = useWireframeFiles(s => s.byFile);
    const columnarData = useAppStore(s => s.columnarData);
    const enabled = !!columns.z;
    const working = active && enabled;

    // The topographies on offer: wireframes and surfaces with triangles
    const topo = useMemo(() => {
        const options: TopoOption[] = [];
        const parts = new Map<string, { name: string; part: WireframePart }>();
        for (const w of scene.wireframes) {
            const part = files[w.file]?.parts[w.part];
            if (!part || part.triangles.length === 0) continue;
            const key = `wireframe:${w.id}`;
            options.push({ key, name: w.name, kind: 'wireframe' });
            parts.set(key, { name: w.name, part });
        }
        // Surfaces are in the columns they were built in
        if (sameCoords(scene.coords, columns.x, columns.y, columns.z)) {
            for (const s of scene.surfaces) {
                const part = fits[s.id]?.part;
                if (!part || part.triangles.length === 0) continue;
                const key = `surface:${s.id}`;
                options.push({ key, name: s.name, kind: 'surface' });
                parts.set(key, { name: s.name, part });
            }
        }
        return { options, parts };
    }, [scene.wireframes, scene.surfaces, scene.coords, files, fits, columns.x, columns.y, columns.z]);

    const topoOf = useMemo(() => (ref: TopoRef | null): Topography | null => {
        if (!ref) return null;
        if (ref.kind === 'flat') return Number.isFinite(ref.rl) ? flatTopo(ref.rl) : null;
        const p = topo.parts.get(ref.key);
        return p ? meshTopo(p.name, p.part) : null;
    }, [topo]);
    const topoName = useMemo(() => (ref: TopoRef | null): string => {
        if (!ref) return '';
        if (ref.kind === 'flat') return `Flat RL ${ref.rl}`;
        return topo.parts.get(ref.key)?.name ?? '';
    }, [topo]);
    const topoByName = useMemo(() => (name: string): TopoRef | null => {
        const flat = /^Flat RL (-?[\d.]+)$/.exec(name.trim());
        if (flat) return { kind: 'flat', rl: Number(flat[1]) };
        const o = topo.options.find(t => t.name === name.trim());
        return o ? { kind: 'mesh', key: o.key } : null;
    }, [topo]);

    // The holes already in the dataset: their IDs and collars
    const existing = useMemo(() => {
        void columnarData;
        if (!working) return { ids: new Set<string>(), collars: null as Float64Array | null, holes: [] as string[] };
        const log = holePositions(columns);
        if (!log) {
            const raw = columns.hole ? useAppStore.getState().getRawColumn(columns.hole) : null;
            const ids = new Set<string>();
            const list = raw as ArrayLike<unknown> | null;
            if (list) for (let i = 0; i < list.length; i++) { const v = list[i]; if (v !== null && v !== undefined && v !== '') ids.add(String(v).trim()); }
            return { ids, collars: null, holes: [] as string[] };
        }
        const c = holeCollars(log);
        const holes = c.holes.map(h => h.trim());
        // The drillhole import keeps each hole's surveyed collar (CollarEast / CollarNorth / CollarRL): exact, where the
        // collar above worked back from the first sample can be off by millimetres
        const app = useAppStore.getState();
        const named = (want: string) => app.columns.find(col => col.name.toLowerCase() === want)?.name ?? null;
        const [ce, cn, crl] = ['collareast', 'collarnorth', 'collarrl'].map(n => { const name = named(n); return name ? app.getNumericColumn(name) : null; });
        if (ce && cn && crl) {
            const first = new Map<string, number>();
            for (let i = 0; i < log.hole.length; i++) { const h = log.hole[i]; if (h && !first.has(h.trim())) first.set(h.trim(), i); }
            holes.forEach((h, k) => {
                const i = first.get(h);
                if (i !== undefined && Number.isFinite(ce[i]) && Number.isFinite(cn[i]) && Number.isFinite(crl[i])) c.positions.set([ce[i], cn[i], crl[i]], k * 3);
            });
        }
        return { ids: new Set(holes), collars: c.positions, holes };
    }, [working, columns.x, columns.y, columns.z, columns.hole, columns.from, columns.to, columnarData]); // eslint-disable-line react-hooks/exhaustive-deps

    const boundsKey = bounds ? [...bounds.min, ...bounds.max].join(',') : '';
    const dataBounds = useMemo(() => bounds, [boundsKey]); // eslint-disable-line react-hooks/exhaustive-deps

    // Existing collars by hole, for anchoring a planned collar to one (and wedge parents)
    const collarOf = useMemo(() => {
        const map = new Map<string, [number, number, number]>();
        const c = existing.collars, ids = existing.holes;
        if (c && ids.length * 3 === c.length) ids.forEach((id, i) => map.set(id, [c[i * 3], c[i * 3 + 1], c[i * 3 + 2]]));
        return map;
    }, [existing]);

    // Existing drillholes as wedge parents: from their survey (a survey CSV given in the wedge designer), else their samples
    const parentSurveys = usePlanStore(s => s.parentSurveys);
    const existingTrace = useMemo(() => {
        void columnarData;
        const cache = new Map<string, Trace | null>();
        let rowsByHole: Map<string, number[]> | null = null;
        return (name: string): Trace | null => {
            if (cache.has(name)) return cache.get(name)!;
            const collar = collarOf.get(name);
            let trace: Trace | null = null;
            if (collar && columns.hole && columns.from) {
                const app = useAppStore.getState();
                const holeIds = app.getRawColumn(columns.hole) as ArrayLike<unknown> | undefined;
                const from = app.getNumericColumn(columns.from), to = columns.to ? app.getNumericColumn(columns.to) : null;
                const x = app.getNumericColumn(columns.x), y = app.getNumericColumn(columns.y), z = app.getNumericColumn(columns.z);
                if (holeIds && from && x && y && z) {
                    if (!rowsByHole) {
                        rowsByHole = new Map();
                        for (let i = 0; i < holeIds.length; i++) {
                            const h = holeIds[i];
                            if (h === null || h === undefined || h === '') continue;
                            const k = String(h).trim();
                            (rowsByHole.get(k) ?? rowsByHole.set(k, []).get(k)!).push(i);
                        }
                    }
                    const rows = rowsByHole.get(name) ?? [];
                    const mids = rows.map(i => (to && Number.isFinite(to[i]) ? (from[i] + to[i]) / 2 : from[i]));
                    const deepest = rows.reduce((m, i) => Math.max(m, to && Number.isFinite(to[i]) ? to[i] : from[i]), 0);
                    const stations = parentSurveys[name];
                    trace = stations?.length
                        ? traceFromStations(collar, stations, deepest)
                        : traceFromPoints(collar, mids, rows.map(i => [x[i], y[i], z[i]] as Vec3));
                }
            }
            cache.set(name, trace);
            return trace;
        };
    }, [collarOf, parentSurveys, columnarData, columns.hole, columns.from, columns.to, columns.x, columns.y, columns.z]);

    // Bumped as each waiting wedge is worked out
    const [tick, setTick] = useState(0);
    const worked = useMemo((): { list: ComputedHole[]; pending: PendingWedge[] } => {
        if (!enabled) return { list: [], pending: [] };
        // Holes first, then wedges off their parents' traces
        const first = new Map<string, ComputedHole>();
        for (const hole of holes) {
            if (hole.input.mode === 'wedge') continue;
            const t = topoOf(hole.topo);
            const deps = [hole.topo, t, settings.liftLimit, settings.rlTolerance, settings.maxBackLength, existing.ids, existing.collars, dataBounds];
            const have = resultCache.get(hole.input);
            let result = have && have.deps.length === deps.length && have.deps.every((d, i) => d === deps[i]) ? have.result : null;
            if (!result) {
                const ctx: PlanContext = {
                    topo: t, existingIds: existing.ids, existingCollars: existing.collars, dataBounds,
                    liftLimit: settings.liftLimit, rlTolerance: settings.rlTolerance, maxBackLength: settings.maxBackLength,
                };
                result = planHole(hole.input, ctx);
                resultCache.set(hole.input, { deps, result });
            }
            first.set(hole.id, { hole, result, topoName: topoName(hole.topo) });
        }
        const parentOf = (p: WedgeParent | null | undefined): { trace: Trace; name: string; rates: Rates } | null => {
            if (!p) return null;
            if (p.kind === 'planned') {
                const c = first.get(p.id);
                return c?.result.trace ? { trace: c.result.trace, name: c.hole.input.name, rates: { lift: c.result.lift ?? 0, drift: c.result.drift ?? 0 } } : null;
            }
            if (p.kind === 'name') {
                const c = [...first.values()].find(h => h.hole.input.name === p.name);
                if (c) return c.result.trace ? { trace: c.result.trace, name: c.hole.input.name, rates: { lift: c.result.lift ?? 0, drift: c.result.drift ?? 0 } } : null;
            }
            const t = existingTrace(p.name);
            return t ? { trace: t, name: p.name, rates: averageRates(t) } : null;
        };
        const pending: PendingWedge[] = [];
        const list = holes.map((hole): ComputedHole => {
            if (hole.input.mode !== 'wedge') return first.get(hole.id)!;
            const parent = parentOf(hole.input.parent);
            const parentName = parent?.name ?? (hole.input.parent && hole.input.parent.kind !== 'planned' ? hole.input.parent.name : '');
            const deps = [parent?.trace ?? null, parent?.name ?? '', settings.minKop, settings.wedgeLimits, existing.ids];
            const have = resultCache.get(hole.input);
            let result = have && have.deps.length === deps.length && have.deps.every((d, i) => d === deps[i]) ? have.result : null;
            const pre = primed.get(hole.id);
            if (!result && pre) {
                primed.delete(hole.id);
                // Worked out under the daughter's old name: only the Hole ID check differs
                const name = hole.input.name.trim();
                result = {
                    ...pre, issues: [
                        ...(existing.ids?.has(name) ? [{ level: 'warning' as const, code: 'id-exists' as const, text: `Hole ID ${name} is already a drillhole in the dataset.` }] : []),
                        ...pre.issues.filter(i => i.code !== 'id-exists'),
                    ],
                };
                resultCache.set(hole.input, { deps, result });
            }
            if (result) {
                lastWedge.set(hole.id, result);
                return { hole, result, topoName: '', parentName };
            }
            const input = hole.input, minKop = settings.minKop, limits = settings.wedgeLimits, existingIds = existing.ids;
            pending.push({ hole, deps, run: () => planWedge(input, { parent, existingIds, minKop, limits }) });
            return { hole, result: lastWedge.get(hole.id) ?? EMPTY_RESULT, topoName: '', parentName, pending: true };
        });
        return { list, pending };
    }, [enabled, holes, topoOf, topoName, settings.liftLimit, settings.rlTolerance, settings.maxBackLength, settings.minKop, settings.wedgeLimits, existing, dataBounds, existingTrace, tick]);
    const computed = worked.list;

    // Wedges are worked out one per step (each can take a fraction of a second), counted for a progress bar
    const batch = useRef<{ total: number; done: number } | null>(null);
    const pendingNow = worked.pending;
    if (pendingNow.length === 0) batch.current = null;
    else if (!batch.current) batch.current = { total: pendingNow.length, done: 0 };
    else batch.current.total = Math.max(batch.current.total, batch.current.done + pendingNow.length);
    useEffect(() => {
        if (pendingNow.length === 0) return;
        const next = pendingNow[0];
        // A frame first, so the progress shows before the work
        const timer = window.setTimeout(() => {
            const result = next.run();
            resultCache.set(next.hole.input, { deps: next.deps, result });
            lastWedge.set(next.hole.id, result);
            if (batch.current) batch.current.done += 1;
            setTick(t => t + 1);
        }, 16);
        return () => window.clearTimeout(timer);
    }, [pendingNow]);
    const wedgeProgress = batch.current && pendingNow.length > 0 ? { ...batch.current } : null;

    const selected = useMemo(() => computed.find(h => h.hole.id === selectedId) ?? null, [computed, selectedId]);

    /** A wedge parent's trace, name and lift / drift, for the wedge designer (as the wedges themselves are worked out) */
    const parentTraceOf = useMemo(() => (p: WedgeParent): { trace: Trace; name: string; rates: Rates } | null => {
        if (p.kind === 'planned') {
            const c = computed.find(h => h.hole.id === p.id);
            return c?.result.trace ? { trace: c.result.trace, name: c.hole.input.name, rates: { lift: c.result.lift ?? 0, drift: c.result.drift ?? 0 } } : null;
        }
        const t = existingTrace(p.name);
        return t ? { trace: t, name: p.name, rates: averageRates(t) } : null;
    }, [computed, existingTrace]);

    // Pad sets (the scene's sets of points with the pads role) and the pads collars are snapped to (by name)
    const inputs = useModelStore(s => s.scene.inputs);
    const padSets = useMemo(() => padSetsOf(inputs), [inputs]);
    const pads = useMemo((): Pad[] => {
        const set = padSets.find(p => p.id === settings.padSetId) ?? (padSets.length === 1 ? padSets[0] : null);
        return set ? set.points.map(q => ({ id: q.name ?? q.id, p: q.p })) : [];
    }, [padSets, settings.padSetId]);

    return {
        enabled, columns, holes: computed, selected, topoOptions: topo.options, topoOf, topoName, topoByName,
        existingIds: existing.ids, existingCollars: collarOf, dataBounds, parentTraceOf, padSets, pads, wedgeProgress,
    };
}
