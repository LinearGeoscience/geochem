/**
 * Drill tracking: a drilled hole's survey stations as tracking uses them, its
 * path, and its recent lift and drift (pure; unit-tested).
 *
 * The survey codes are each site's own, so they are rules (`TrackRules`,
 * kept with the project; neutral by default, a site sets its own or starts
 * from a preset):
 * - The database's chosen surveys are used as they come. Rows of the methods
 *   in `dropMethods` (e.g. planned or collar rows) are not surveys of the hole
 *   and are dropped.
 * - Rows of the methods in `copyMethods` are start / end of hole copies of the
 *   first and last survey, placed at 0 and at the end of hole. They would
 *   read as no change in angle, so they are left out (the path runs straight
 *   on past the last survey in any case). A hole with nothing else keeps them.
 * - Azimuths must be to the project grid's north. With `gridZone` set, a row
 *   whose grid names another zone is left out and reported; a row with no
 *   grid is taken as the project's.
 * - Two rows at one depth: the better method is kept (`methodRank`, best
 *   first; else the first row).
 * - The path is the 3D viewer's minimum curvature (features/model/desurvey.ts,
 *   the same as the backend's and the 3D view's hole traces), given back as a
 *   planner `Trace` (a station every metre) so that the planner's maths runs
 *   on it.
 * - Lift and drift are the slopes of straight lines fitted to dip and to
 *   azimuth against depth over the last stretch of the hole (a length, not a
 *   number of surveys), in the planner's signs: lift positive flattens, drift
 *   positive turns clockwise, both degrees per 100 m.
 */
import { anglesOf, aziDelta, normAzi, PLAN_STEP, type SurveyStation, type Trace, type Vec3 } from './drillholePlan';
import { cleanStations, placeAt, traceHole } from '../features/model/desurvey';
import type { LiveSurvey } from './drillTrackImport';

export interface TrackRules {
    /** Methods whose rows are not surveys of the hole (compared without case) */
    dropMethods: string[];
    /** Methods whose rows copy the first / last survey to the collar / end of hole */
    copyMethods: string[];
    /** The project grid's zone: rows to another zone are left out (null: any) */
    gridZone: number | null;
    /** Lift and drift are fitted over this much of the hole above the last survey (m) */
    window: number;
    /** Fewer stations than this in the window: the rates are marked unreliable */
    minStations: number;
    /** A hole on track to pass further than this from its planned target is flagged (m) */
    missLimit: number;
    /** Survey methods best first, for two rows at one depth (unlisted methods come after these) */
    methodRank: string[];
    /** Hole statuses that mean the hole is being drilled, and that it is finished (compared without case, spaces or punctuation) */
    activeStatuses: string[];
    finishedStatuses: string[];
}

/** A site's survey codes and statuses, as a preset file holds them */
export interface RulesPreset {
    name: string;
    notes?: string;
    /** New projects start with this preset */
    default?: boolean;
    rules: Partial<TrackRules>;
}

/** The site rules a preset sets (survey methods, grid zone, statuses), over these; the rest (window, limits) are kept */
export function presetRules(rules: TrackRules, preset: Pick<RulesPreset, 'rules'>): TrackRules {
    const site: (keyof TrackRules)[] = ['dropMethods', 'copyMethods', 'gridZone', 'methodRank', 'activeStatuses', 'finishedStatuses'];
    const out = { ...rules } as Record<keyof TrackRules, unknown>;
    for (const k of site) if (k in (preset.rules ?? {})) out[k] = preset.rules[k];
    return out as unknown as TrackRules;
}

/** Neutral rules: no site's survey codes (a site's come from its preset, features/drilltracking/presets) */
export const TRACK_DEFAULTS: TrackRules = {
    dropMethods: [],
    copyMethods: [],
    gridZone: null,
    window: 50,
    minStations: 3,
    missLimit: 5,
    methodRank: [],
    activeStatuses: ['In progress', 'Re-entry'],
    finishedStatuses: ['Complete', 'Completed', 'Abandoned'],
};

export interface TrackStation extends SurveyStation {
    method: string | null;
}

export interface HoleStations {
    /** The stations tracking uses, by depth */
    stations: TrackStation[];
    /** Rows left out, by why */
    dropped: number;
    copies: number;
    /** Rows to another grid zone (left out) */
    otherGrid: { depth: number; grid: string }[];
    /** Only start / end of hole copies were there, so they are used */
    copiesOnly: boolean;
}

const lower = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/** The zone a grid name gives (a two-digit part: "GRID_50", "UTM_50_DGPS" → 50); null when it gives none */
export function gridZoneOf(grid: string | null | undefined): number | null {
    const token = (grid ?? '').split(/[_\s-]+/).find(t => /^\d{2}$/.test(t));
    return token === undefined ? null : Number(token);
}

const rankOf = (rank: readonly string[], method: string | null) => {
    const i = rank.findIndex(m => lower(m) === lower(method));
    return i < 0 ? rank.length : i;
};

/** One hole's survey rows as tracking uses them */
export function holeStations(rows: readonly LiveSurvey[], rules: TrackRules = TRACK_DEFAULTS): HoleStations {
    const drop = new Set(rules.dropMethods.map(lower)), copy = new Set(rules.copyMethods.map(lower));
    let dropped = 0, copies = 0;
    const otherGrid: { depth: number; grid: string }[] = [];
    const real: LiveSurvey[] = [], copied: LiveSurvey[] = [];
    for (const r of rows) {
        if (drop.has(lower(r.method))) { dropped++; continue; }
        const zone = gridZoneOf(r.grid);
        if (rules.gridZone !== null && zone !== null && zone !== rules.gridZone) { otherGrid.push({ depth: r.depth, grid: r.grid ?? '' }); continue; }
        if (copy.has(lower(r.method))) { copies++; copied.push(r); continue; }
        real.push(r);
    }
    const copiesOnly = real.length === 0 && copied.length > 0;
    const use = copiesOnly ? copied : real;
    const byDepth = new Map<number, LiveSurvey>();
    for (const r of use) {
        const key = Math.round(r.depth * 1000) / 1000;
        const had = byDepth.get(key);
        if (!had || rankOf(rules.methodRank ?? [], r.method) < rankOf(rules.methodRank ?? [], had.method)) byDepth.set(key, r);
    }
    const stations = [...byDepth.values()].sort((a, b) => a.depth - b.depth)
        .map(r => ({ depth: r.depth, dip: r.dip, azi: normAzi(r.azi), method: r.method }));
    return { stations, dropped, copies, otherGrid, copiesOnly };
}

/**
 * The path of a drilled hole from its collar through its stations, with a
 * station every metre down to `toDepth` (straight on past the last survey).
 * Null without stations.
 */
export function drilledTrace(collar: Vec3, stations: readonly SurveyStation[], toDepth?: number | null): Trace | null {
    const clean = cleanStations(stations.map(s => ({ depth: s.depth, dip: s.dip, azimuth: s.azi })));
    const path = traceHole(collar, clean);
    if (!path) return null;
    const last = clean[clean.length - 1].depth;
    const end = Math.max(last, toDepth ?? 0);
    const depths: number[] = [];
    for (let d = 0; d < end - 1e-9; d += PLAN_STEP) depths.push(d);
    for (const s of clean) depths.push(s.depth);
    depths.push(end);
    const sorted = [...new Set(depths.map(d => Math.round(d * 1e6) / 1e6))].sort((a, b) => a - b);
    const n = sorted.length;
    const out: Trace = { depth: new Float64Array(n), dip: new Float64Array(n), azi: new Float64Array(n), xyz: new Float64Array(n * 3) };
    sorted.forEach((d, i) => {
        const { position, direction } = placeAt(path, d);
        const { dip, azi } = anglesOf(direction);
        out.depth[i] = d; out.dip[i] = dip; out.azi[i] = azi;
        out.xyz.set(position, i * 3);
    });
    return out;
}

export interface WindowRates {
    /** °/100 m, planner signs */
    lift: number;
    drift: number;
    /** Stations used and the depths they span */
    n: number;
    from: number;
    to: number;
    /** Scatter of dip and azimuth about the fitted lines (degrees; NaN with two stations) */
    dipSd: number;
    aziSd: number;
    /** Standard error of the lift and drift (°/100 m; NaN with two stations) */
    liftSe: number;
    driftSe: number;
    /** At least the rules' number of stations */
    enough: boolean;
    /** Steeper than 85°: azimuth, and so drift, means little */
    nearVertical: boolean;
}

function fit(x: readonly number[], y: readonly number[]): { slope: number; sd: number; se: number } {
    const n = x.length;
    const mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
    let sxx = 0, sxy = 0;
    for (let i = 0; i < n; i++) { sxx += (x[i] - mx) ** 2; sxy += (x[i] - mx) * (y[i] - my); }
    const slope = sxx > 0 ? sxy / sxx : 0;
    let ss = 0;
    for (let i = 0; i < n; i++) ss += (y[i] - my - slope * (x[i] - mx)) ** 2;
    const sd = n > 2 ? Math.sqrt(ss / (n - 2)) : NaN;
    return { slope, sd, se: n > 2 && sxx > 0 ? sd / Math.sqrt(sxx) : NaN };
}

/**
 * Lift and drift over the last `window` metres of surveys (the stations from
 * the last one's depth less the window down to it). Null with fewer than two
 * stations there, or none apart in depth.
 */
export function windowRates(stations: readonly SurveyStation[], rules: Pick<TrackRules, 'window' | 'minStations'> = TRACK_DEFAULTS): WindowRates | null {
    if (stations.length === 0) return null;
    const s = [...stations].sort((a, b) => a.depth - b.depth);
    const last = s[s.length - 1].depth;
    const w = s.filter(x => x.depth >= last - rules.window - 1e-9);
    if (w.length < 2 || !(w[w.length - 1].depth > w[0].depth)) return null;
    const x = w.map(v => v.depth);
    // Azimuths unwrapped from the first, so a hole drifting through north fits as one line
    const azi: number[] = [w[0].azi];
    for (let i = 1; i < w.length; i++) azi.push(azi[i - 1] + aziDelta(w[i - 1].azi, w[i].azi));
    const d = fit(x, w.map(v => v.dip)), a = fit(x, azi);
    const meanDip = w.reduce((sum, v) => sum + v.dip, 0) / w.length;
    return {
        lift: d.slope * 100, drift: a.slope * 100, n: w.length, from: w[0].depth, to: last,
        dipSd: d.sd, aziSd: a.sd, liftSe: d.se * 100, driftSe: a.se * 100,
        enough: w.length >= rules.minStations, nearVertical: meanDip < -85,
    };
}
