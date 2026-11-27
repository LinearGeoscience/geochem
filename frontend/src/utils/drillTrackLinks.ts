/**
 * Drill tracking: which drilled holes are being drilled, which planned hole
 * each was drilled to, and which are wedges off another (pure; unit-tested).
 *
 * Being drilled ("active"): a status among the rules' `activeStatuses` (by
 * default "In progress" or "Re-entry"); or else a start date, no finish date,
 * and a status not among the `finishedStatuses` (by default "Complete" or
 * "Abandoned"). A hole can be set on or off by hand, which wins.
 *
 * Linking: a drilled hole's planned-hole ID (e.g. Acquire's `PlanHoleID`) is matched,
 * without case, to a planned hole's name, then to its target's ID (a wedge
 * the planner renamed PARENT_W1 keeps its target's ID). An assignment by hand
 * wins, and may say "none". Several drilled holes may go to one planned hole
 * (a hole abandoned and drilled again, a wedge that still carries its
 * parent's ID): the one tracked is the one being drilled, else the last
 * started.
 *
 * Wedges: a daughter carries its parent's surveys down to the kick-off (that
 * is how Acquire keeps it). Two holes collared together whose first surveys
 * are the same are a parent and a daughter; the kick-off is the deepest
 * survey they share, and the parent is the one started first.
 */
import type { SurveyStation } from './drillholePlan';
import type { LiveCollar } from './drillTrackImport';
import { TRACK_DEFAULTS, type TrackRules } from './drillTrackSurveys';

export type ActiveOverride = 'on' | 'off';

const squash = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Whether a hole is being drilled, and why */
export function activeState(
    c: Pick<LiveCollar, 'status' | 'dateStart' | 'dateFini'>, override?: ActiveOverride | null,
    rules: Pick<TrackRules, 'activeStatuses' | 'finishedStatuses'> = TRACK_DEFAULTS,
): { active: boolean; why: string } {
    if (override === 'on') return { active: true, why: 'set by hand' };
    if (override === 'off') return { active: false, why: 'set by hand' };
    const status = squash(c.status);
    const active = new Set((rules.activeStatuses ?? TRACK_DEFAULTS.activeStatuses).map(squash));
    const done = new Set((rules.finishedStatuses ?? TRACK_DEFAULTS.finishedStatuses).map(squash));
    if (status && active.has(status)) return { active: true, why: `status ${c.status}` };
    if (status && done.has(status)) return { active: false, why: `status ${c.status}` };
    if (c.dateStart && !c.dateFini) return { active: true, why: `started ${c.dateStart}, not finished` };
    return { active: false, why: c.dateFini ? `finished ${c.dateFini}` : 'not started' };
}

/** A planned hole, as linking sees it */
export interface PlannedRef {
    /** Stable key of the planned hole (program id + the hole's id) */
    key: string;
    name: string;
    /** Its target point's ID, when the hole is called something else */
    targetId: string | null;
}

export type LinkHow = 'manual' | 'name' | 'target' | 'none' | 'ambiguous' | 'unmatched' | 'no-plan-id' | 'wedge';

export interface Link {
    hole: string;
    /** Null: not linked */
    planned: string | null;
    how: LinkHow;
}

export const LINK_LABELS: Record<LinkHow, string> = {
    manual: 'assigned by hand', name: 'planned hole ID = name', target: 'planned hole ID = target ID',
    none: 'set to none by hand', ambiguous: 'planned hole ID matches more than one planned hole', unmatched: 'planned hole ID not in the program',
    'no-plan-id': 'no planned hole ID', wedge: "a wedge carrying its parent's planned hole ID",
};

/**
 * Links each drilled hole to a planned hole. `manual`: by drilled hole, a
 * planned key or null for "none" (keys no longer in `planned` are ignored).
 */
export function linkHoles(collars: readonly Pick<LiveCollar, 'hole' | 'planId'>[], planned: readonly PlannedRef[], manual: Readonly<Record<string, string | null>> = {}): Link[] {
    const keys = new Set(planned.map(p => p.key));
    const index = (get: (p: PlannedRef) => string | null) => {
        const m = new Map<string, string[]>();
        for (const p of planned) {
            const k = squash(get(p));
            if (k) m.set(k, [...(m.get(k) ?? []), p.key]);
        }
        return m;
    };
    const byName = index(p => p.name), byTarget = index(p => p.targetId);
    return collars.map(c => {
        if (Object.prototype.hasOwnProperty.call(manual, c.hole)) {
            const m = manual[c.hole];
            if (m === null) return { hole: c.hole, planned: null, how: 'none' as const };
            if (keys.has(m)) return { hole: c.hole, planned: m, how: 'manual' as const };
        }
        const id = squash(c.planId);
        if (!id) return { hole: c.hole, planned: null, how: 'no-plan-id' as const };
        for (const [how, m] of [['name', byName], ['target', byTarget]] as const) {
            const hits = m.get(id);
            if (!hits) continue;
            if (new Set(hits).size > 1) return { hole: c.hole, planned: null, how: 'ambiguous' as const };
            return { hole: c.hole, planned: hits[0], how };
        }
        return { hole: c.hole, planned: null, how: 'unmatched' as const };
    });
}

/**
 * Of several drilled holes linked to one planned hole, the one tracked: the
 * active one (the last started of those), else the last started.
 */
export function trackedOf(holes: readonly Pick<LiveCollar, 'hole' | 'dateStart'>[], isActive: (hole: string) => boolean): string | null {
    if (holes.length === 0) return null;
    const order = [...holes].sort((a, b) => (a.dateStart ?? '').localeCompare(b.dateStart ?? '') || a.hole.localeCompare(b.hole));
    const active = order.filter(h => isActive(h.hole));
    const pool = active.length ? active : order;
    return pool[pool.length - 1].hole;
}

/** Two stations the same (depth, dip and azimuth within these) */
const SAME_DEPTH = 0.01, SAME_ANGLE = 0.01;
/** Collars closer than this (m) count as the same */
export const SAME_COLLAR = 2;

const same = (a: SurveyStation, b: SurveyStation) =>
    Math.abs(a.depth - b.depth) <= SAME_DEPTH && Math.abs(a.dip - b.dip) <= SAME_ANGLE && Math.abs(((a.azi - b.azi + 540) % 360) - 180) <= SAME_ANGLE;

/**
 * The deepest station two holes share from the top (null: their first
 * stations differ, or they share fewer than two).
 */
export function sharedTo(a: readonly SurveyStation[], b: readonly SurveyStation[]): number | null {
    let k = 0;
    while (k < a.length && k < b.length && same(a[k], b[k])) k++;
    return k >= 2 ? a[k - 1].depth : null;
}

export interface WedgePair {
    parent: string;
    daughter: string;
    /** Kick-off: the deepest survey they share */
    kop: number;
}

/**
 * Parents and daughters among drilled holes: holes collared together whose
 * surveys are the same from the top down to a depth above both their ends.
 */
export function findWedges(collars: readonly LiveCollar[], stations: ReadonlyMap<string, readonly SurveyStation[]>): WedgePair[] {
    const placed = collars.filter(c => c.e !== null && c.n !== null && (stations.get(c.hole)?.length ?? 0) >= 2);
    // Grid cells of the collar spacing, so only neighbours are compared
    const cell = (c: LiveCollar) => `${Math.floor(c.e! / SAME_COLLAR)},${Math.floor(c.n! / SAME_COLLAR)}`;
    const grid = new Map<string, LiveCollar[]>();
    for (const c of placed) grid.set(cell(c), [...(grid.get(cell(c)) ?? []), c]);
    const out: WedgePair[] = [];
    const daughters = new Set<string>();
    for (const a of placed) {
        const cx = Math.floor(a.e! / SAME_COLLAR), cy = Math.floor(a.n! / SAME_COLLAR);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
            for (const b of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
                if (b.hole <= a.hole || Math.hypot(a.e! - b.e!, a.n! - b.n!) > SAME_COLLAR) continue;
                const sa = stations.get(a.hole)!, sb = stations.get(b.hole)!;
                const kop = sharedTo(sa, sb);
                if (kop === null) continue;
                // The same hole twice (every survey of one is in the other) is not a wedge
                if (kop >= sa[sa.length - 1].depth - SAME_DEPTH || kop >= sb[sb.length - 1].depth - SAME_DEPTH) continue;
                const aFirst = (a.dateStart ?? '') < (b.dateStart ?? '') || ((a.dateStart ?? '') === (b.dateStart ?? '') && a.hole.length <= b.hole.length);
                const [parent, daughter] = aFirst ? [a.hole, b.hole] : [b.hole, a.hole];
                if (daughters.has(daughter)) continue;
                daughters.add(daughter);
                out.push({ parent, daughter, kop });
            }
        }
    }
    return out;
}
