/**
 * Planned drilling programs: named sets of planned holes saved with the
 * project (pure; unit-tested).
 *
 * A program's holes are the drillhole planner's holes (what was typed or
 * dragged), so the planner can be opened on a program to change it. Beside
 * each, the hole as last worked out (`SolvedHole`): its path, target and end,
 * which the 3D views draw and drill tracking measures against without the
 * planner having to work anything out. Nothing is frozen: a program changes
 * whenever it is edited, and `changed` says when that last happened.
 *
 * A program can also come from a collar file and a survey file (a program
 * planned somewhere else): its holes are then planned by collar (the first
 * survey's dip and azimuth, the hole's overall lift and drift), and the path
 * kept is the one the surveys give.
 */
import { stationAt, type HoleInput, type PlanResult, type SurveyStation, type Trace, type Vec3 } from './drillholePlan';
import { traceFromStations } from './drillholePlanWedge';
import type { PlannedRef } from './drillTrackLinks';
import { closestApproach, type PlannedTrack } from './drillTrackProjection';
import { windowRates } from './drillTrackSurveys';
import { guessColumns, numberOf, textOf } from './drillTrackImport';

/** How a planned hole is drawn (the planner's hole style) */
export interface ProgramHoleStyle {
    color: string;
    width: number;
}

/** The topography a hole is projected to (the planner's TopoRef) */
export type ProgramTopo = { kind: 'mesh'; key: string } | { kind: 'flat'; rl: number };

/** A planned hole as last worked out */
export interface SolvedHole {
    /** Stations down the hole from its collar: depths, angles and places (xyz triples) */
    depth: number[];
    dip: number[];
    azi: number[];
    xyz: number[];
    target: Vec3 | null;
    targetDepth: number | null;
    eoh: number;
    lift: number;
    drift: number;
    /** A wedge: its parent's name and kick-off depth */
    parentName?: string | null;
    kop?: number | null;
}

export interface ProgramHole {
    /** Stable id (the planner's hole id, so wedges keep their parents) */
    id: string;
    input: HoleInput;
    topo: ProgramTopo | null;
    style: ProgramHoleStyle;
    visible: boolean;
    beforeWedge?: { input: HoleInput; topo: ProgramTopo | null } | null;
    /** Null: it could not be worked out when last saved */
    solved: SolvedHole | null;
}

export interface PlannedProgram {
    id: string;
    name: string;
    color: string;
    source: 'planner' | 'files';
    /** ISO date-times */
    created: string;
    changed: string;
    holes: ProgramHole[];
}

/** Stations kept every this many metres (and at the kick-off, target and end) */
export const SOLVED_STEP = 5;

const round = (v: number, dp: number) => Math.round(v * 10 ** dp) / 10 ** dp;

/** A trace cut down to stations every `step` metres, with the depths in `keep` (all kept to the mm and the 1e-6°) */
export function thinTrace(trace: Trace, keep: readonly (number | null | undefined)[] = [], step = SOLVED_STEP): Pick<SolvedHole, 'depth' | 'dip' | 'azi' | 'xyz'> {
    const n = trace.depth.length;
    const breaks = keep.filter((d): d is number => d !== null && d !== undefined && Number.isFinite(d));
    const out = { depth: [] as number[], dip: [] as number[], azi: [] as number[], xyz: [] as number[] };
    let next = 0;
    for (let i = 0; i < n; i++) {
        const d = trace.depth[i];
        const isBreak = breaks.some(b => Math.abs(b - d) < 1e-3);
        // A kick: the angles change at one depth (two stations there); both are kept
        const kick = (i > 0 && Math.abs(trace.depth[i - 1] - d) < 1e-9) || (i + 1 < n && Math.abs(trace.depth[i + 1] - d) < 1e-9);
        if (i === 0 || i === n - 1 || d >= next - 1e-9 || isBreak || kick) {
            out.depth.push(round(d, 3)); out.dip.push(round(trace.dip[i], 6)); out.azi.push(round(trace.azi[i], 6));
            out.xyz.push(round(trace.xyz[i * 3], 3), round(trace.xyz[i * 3 + 1], 3), round(trace.xyz[i * 3 + 2], 3));
            if (d >= next - 1e-9) next = (Math.floor(d / step + 1e-9) + 1) * step;
        }
    }
    return out;
}

/** What the planner worked out for a hole, as a program keeps it (null: it has no trace) */
export function solvedFromResult(result: PlanResult, parentName?: string | null): SolvedHole | null {
    if (!result.ok || !result.trace || !result.collar) return null;
    const eoh = result.eoh ?? result.trace.depth[result.trace.depth.length - 1];
    return {
        ...thinTrace(result.trace, [result.targetDepth, result.wedge?.kop, eoh]),
        target: result.target ? [...result.target] as Vec3 : null,
        targetDepth: result.targetDepth, eoh, lift: result.lift ?? 0, drift: result.drift ?? 0,
        ...(result.wedge ? { parentName: parentName ?? result.wedge.parentName, kop: result.wedge.kop } : {}),
    };
}

/** A kept hole's path as a planner trace */
export function solvedTrace(s: SolvedHole): Trace {
    return { depth: Float64Array.from(s.depth), dip: Float64Array.from(s.dip), azi: Float64Array.from(s.azi), xyz: Float64Array.from(s.xyz) };
}

/** A program's hole as drill tracking measures against it (null: never worked out) */
export function plannedTrackOf(hole: ProgramHole): PlannedTrack | null {
    const s = hole.solved;
    if (!s || s.depth.length < 2) return null;
    return { name: hole.input.name, trace: solvedTrace(s), target: s.target, targetDepth: s.targetDepth, eoh: s.eoh, lift: s.lift, drift: s.drift };
}

/** The key a program's hole is linked by */
export const plannedKey = (programId: string, holeId: string) => `${programId}/${holeId}`;

/** A program's holes as linking sees them */
export function plannedRefs(program: PlannedProgram): PlannedRef[] {
    return program.holes.map(h => ({
        key: plannedKey(program.id, h.id), name: h.input.name,
        targetId: h.input.fromTarget && h.input.fromTarget !== h.input.name ? h.input.fromTarget : null,
    }));
}

// ---------------------------------------------------------------------------
// A program from a collar file and a survey file
// ---------------------------------------------------------------------------

export interface PlannedCollarRow {
    hole: string;
    collar: Vec3;
    /** End of hole (null: the deepest survey) */
    eoh: number | null;
    /** The target, when the file gives one: a point, or a depth down the hole */
    target: Vec3 | null;
    targetDepth: number | null;
    /** The target's own ID, when the file gives one */
    targetId: string | null;
    /** Collar dip / azimuth, when the file gives them (used when the hole has no surveys) */
    dip: number | null;
    azi: number | null;
}

export const PLANNED_COLLAR_FIELDS = ['hole', 'e', 'n', 'rl', 'eoh', 'dip', 'azi', 'targetE', 'targetN', 'targetRL', 'targetDepth', 'targetId'] as const;
export type PlannedCollarField = (typeof PLANNED_COLLAR_FIELDS)[number];
export type PlannedCollarColumns = Record<PlannedCollarField, number | null>;
export const PLANNED_COLLAR_REQUIRED: readonly PlannedCollarField[] = ['hole', 'e', 'n', 'rl'];
export const PLANNED_COLLAR_LABELS: Record<PlannedCollarField, string> = {
    hole: 'Hole ID', e: 'Easting', n: 'Northing', rl: 'RL', eoh: 'End of hole', dip: 'Dip', azi: 'Azimuth (grid)',
    targetE: 'Target easting', targetN: 'Target northing', targetRL: 'Target RL', targetDepth: 'Target depth', targetId: 'Target ID',
};
/** Header names tried for each field (the planner's own export first, then Acquire's) */
const PLANNED_COLLAR_NAMES: Record<PlannedCollarField, string[]> = {
    hole: ['holeid', 'hole_id', 'hole', 'bhid', 'planholeid'],
    e: ['easting', 'east_20', 'east', 'x', 'collareast'],
    n: ['northing', 'north_20', 'north', 'y', 'collarnorth'],
    rl: ['rl_20', 'rl', 'elevation', 'z', 'collarrl'],
    eoh: ['eoh', 'max_depth', 'maxdepth', 'planned_depth', 'planneddepth', 'depth', 'total_depth'],
    dip: ['dip', 'collar_dip', 'planned_dip'],
    azi: ['azi_grid', 'azimuth', 'azi', 'collar_azi', 'planned_azi'],
    targetE: ['targete', 'target_e', 'target_east', 'targeteasting'],
    targetN: ['targetn', 'target_n', 'target_north', 'targetnorthing'],
    targetRL: ['targetrl', 'target_rl', 'target_z'],
    targetDepth: ['targetdepth', 'target_depth'],
    targetId: ['targetid', 'target_id', 'target'],
};
export const guessPlannedCollarColumns = (header: readonly string[]): PlannedCollarColumns => guessColumns(header, PLANNED_COLLAR_NAMES);

/** The collars of a planned collar file's rows (the header first) */
export function readPlannedCollars(rows: readonly (readonly string[])[], cols: PlannedCollarColumns): { collars: PlannedCollarRow[]; problems: string[] } {
    const missing = PLANNED_COLLAR_REQUIRED.filter(f => cols[f] === null);
    if (missing.length) return { collars: [], problems: [`The collar file has no column for: ${missing.map(f => PLANNED_COLLAR_LABELS[f]).join(', ')}.`] };
    const at = (row: readonly string[], f: PlannedCollarField) => (cols[f] === null ? undefined : row[cols[f]!]);
    const collars: PlannedCollarRow[] = [], problems: string[] = [];
    const seen = new Set<string>();
    rows.slice(1).forEach((row, k) => {
        const hole = textOf(at(row, 'hole'));
        const e = numberOf(at(row, 'e')), n = numberOf(at(row, 'n')), rl = numberOf(at(row, 'rl'));
        if (!hole) { problems.push(`Collar row ${k + 2}: no hole ID.`); return; }
        if (seen.has(hole)) { problems.push(`${hole} is in the collar file twice; the first is kept.`); return; }
        seen.add(hole);
        if (e === null || n === null || rl === null) { problems.push(`${hole}: no collar coordinates; left out.`); return; }
        const te = numberOf(at(row, 'targetE')), tn = numberOf(at(row, 'targetN')), trl = numberOf(at(row, 'targetRL'));
        collars.push({
            hole, collar: [e, n, rl], eoh: numberOf(at(row, 'eoh')),
            target: te !== null && tn !== null && trl !== null ? [te, tn, trl] : null, targetDepth: numberOf(at(row, 'targetDepth')),
            targetId: textOf(at(row, 'targetId')), dip: numberOf(at(row, 'dip')), azi: numberOf(at(row, 'azi')),
        });
    });
    return { collars, problems };
}

/** Planned holes from collars and their survey stations; holes with neither surveys nor collar angles are reported */
export function programHolesFromFiles(collars: readonly PlannedCollarRow[], surveys: ReadonlyMap<string, readonly SurveyStation[]>, colors: readonly string[]): { holes: ProgramHole[]; problems: string[] } {
    const holes: ProgramHole[] = [], problems: string[] = [];
    collars.forEach((c, k) => {
        let stations = [...(surveys.get(c.hole) ?? [])].sort((a, b) => a.depth - b.depth);
        if (!stations.length) {
            if (c.dip === null || c.azi === null || c.eoh === null) { problems.push(`${c.hole}: no surveys, and no dip, azimuth and end of hole on its collar row; left out.`); return; }
            stations = [{ depth: 0, dip: c.dip, azi: c.azi }];
        }
        const eoh = Math.max(c.eoh ?? 0, stations[stations.length - 1].depth);
        if (!(eoh > 0)) { problems.push(`${c.hole}: no length; left out.`); return; }
        const trace = traceFromStations(c.collar, stations, eoh);
        // The whole hole's lift and drift, as a hole planned by collar would have them
        const rates = stations.length >= 2 ? windowRates(stations, { window: Infinity, minStations: 2 }) : null;
        // A target point: its depth is where the hole comes closest to it; a target depth: its point is the hole's there
        const targetDepth = c.targetDepth ?? (c.target ? closestApproach(trace, c.target)?.depth ?? null : null);
        const target = c.target ?? (targetDepth !== null ? stationAt(trace, Math.min(targetDepth, eoh))?.p ?? null : null);
        const input: HoleInput = {
            name: c.hole, mode: 'collar', collar: { e: c.collar[0], n: c.collar[1], rl: c.collar[2] }, rlFromTopo: false,
            dip: stations[0].dip, azi: stations[0].azi, lift: rates ? round(rates.lift, 4) : 0, drift: rates ? round(rates.drift, 4) : 0, eoh,
            target: { e: null, n: null, rl: null }, method: 'surface-curved', targetDip: null, targetAzi: null, extension: 0,
            ...(c.targetId && c.targetId !== c.hole ? { fromTarget: c.targetId } : {}),
        };
        holes.push({
            id: `h${k + 1}`, input, topo: null, style: { color: colors[k % colors.length], width: 3 }, visible: true,
            solved: {
                ...thinTrace(trace, [targetDepth, eoh]), target, targetDepth, eoh,
                lift: input.lift ?? 0, drift: input.drift ?? 0,
            },
        });
    });
    return { holes, problems };
}
