/**
 * Drillhole planner: export and import of planned holes (pure, unit-tested).
 *
 * - Collar CSV (the source of truth): one row per hole, enough to rebuild it.
 * - Survey CSV: HoleID, Depth, Dip, Azi_grid at an interval, plus the collar,
 *   target and end-of-hole stations.
 * - Trace DXF: one 3D polyline per hole.
 *
 * Coordinates and depths are written to 3 decimals; dip, azimuth, lift and
 * drift to 4 (2 decimals on an angle can move the end of a 500 m hole by about
 * 4 cm). Azimuths are grid (clockwise from grid north), not true or magnetic.
 *
 * Import rebuilds each hole from its collar row, then checks it against the
 * survey CSV station by station.
 */
import {
    CollarMethod, HoleInput, PlanResult, RateLimits, SurveyStation, Trace, Vec3, desurvey, forwardTrace, stationAt,
} from './drillholePlan';

export const COLLAR_COLUMNS = [
    'HoleID', 'Easting', 'Northing', 'RL', 'Dip', 'Azi_grid', 'EOH', 'TargetDepth', 'TargetE', 'TargetN', 'TargetRL',
    'TargetDip', 'TargetAzi_grid', 'Lift', 'Drift', 'Mode', 'CollarMethod', 'Topography',
    'Pad', 'Parent', 'KOPDepth', 'Kick', 'KickToolface', 'KickMax', 'TargetID',
    'WedgeRates', 'LiftMin', 'LiftMax', 'DriftMin', 'DriftMax',
] as const;
export const SURVEY_COLUMNS = ['HoleID', 'Depth', 'Dip', 'Azi_grid'] as const;

/** Two stations further apart than this (m) on import are reported */
export const IMPORT_TOLERANCE = 0.01;

export interface ExportHole {
    name: string;
    input: HoleInput;
    result: PlanResult;
    /** Name of the hole's topography ('' for none) */
    topography: string;
    /** A wedge: its parent's Hole ID */
    parentName?: string;
}

const xyzText = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '' : v.toFixed(3));
const angText = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '' : v.toFixed(4));
const csvCell = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const csvRow = (cells: string[]) => cells.map(csvCell).join(',');

/** Holes with a trace (no errors) only. */
export function collarCsv(holes: readonly ExportHole[]): string {
    const rows = [csvRow([...COLLAR_COLUMNS])];
    for (const h of holes) {
        const r = h.result;
        if (!r.ok || !r.collar) continue;
        rows.push(csvRow([
            h.name, xyzText(r.collar[0]), xyzText(r.collar[1]), xyzText(r.collar[2]),
            angText(r.collarDip), angText(r.collarAzi), xyzText(r.eoh), xyzText(r.targetDepth),
            xyzText(r.target?.[0]), xyzText(r.target?.[1]), xyzText(r.target?.[2]),
            angText(r.targetDip), angText(r.targetAzi), angText(r.lift), angText(r.drift),
            h.input.mode, h.input.mode === 'target' ? h.input.method : '', h.topography,
            h.input.collarPad ?? '', r.wedge ? (h.parentName ?? r.wedge.parentName) : '', xyzText(r.wedge?.kop), angText(r.wedge?.kick), angText(r.wedge?.toolface),
            angText(r.wedge ? r.wedge.kickMax : null), h.input.fromTarget && h.input.fromTarget !== h.name ? h.input.fromTarget : '',
            // Wedges: solved or fixed rates, and the hole's own lift / drift limits (blank: the planner's)
            r.wedge ? (h.input.ratesMode === 'fixed' ? 'fixed' : 'solve') : '',
            ...(['liftMin', 'liftMax', 'driftMin', 'driftMax'] as const).map(k => (r.wedge && h.input.rateLimits ? String(h.input.rateLimits[k]) : '')),
        ]));
    }
    return rows.join('\r\n') + '\r\n';
}

/** The depths written for one hole: every `interval` m, the collar, the target and the end of hole. */
export function surveyDepths(eoh: number, targetDepth: number | null, interval: number, extra: number[] = []): number[] {
    const out = [0];
    if (interval > 0) for (let d = interval; d < eoh - 1e-6; d += interval) out.push(Math.round(d * 1000) / 1000);
    if (targetDepth !== null) out.push(targetDepth);
    for (const d of extra) if (d > 0 && d < eoh) out.push(d);
    out.push(eoh);
    out.sort((a, b) => a - b);
    return out.filter((d, i) => i === 0 || d - out[i - 1] > 1e-6);
}

export function surveyCsv(holes: readonly ExportHole[], interval: number): string {
    const rows = [csvRow([...SURVEY_COLUMNS])];
    for (const h of holes) {
        const r = h.result;
        if (!r.ok || !r.trace || r.eoh === null) continue;
        // A wedge: a station on its kick-off too
        for (const d of surveyDepths(r.eoh, r.targetDepth, interval, r.wedge ? [r.wedge.kop] : [])) {
            const s = stationAt(r.trace, d);
            if (s) rows.push(csvRow([h.name, xyzText(d), angText(s.dip), angText(s.azi)]));
        }
    }
    return rows.join('\r\n') + '\r\n';
}

/** A DXF layer name: letters, digits, _ and - only */
const layerName = (name: string) => `PLAN_${name.replace(/[^A-Za-z0-9_-]/g, '_')}`.slice(0, 64);

/** One 3D polyline per hole (AutoCAD R12 ASCII). */
export function traceDxf(holes: readonly ExportHole[]): string {
    const out: string[] = ['0', 'SECTION', '2', 'ENTITIES'];
    for (const h of holes) {
        const t = h.result.ok ? h.result.trace : null;
        if (!t) continue;
        const layer = layerName(h.name);
        out.push('0', 'POLYLINE', '8', layer, '66', '1', '70', '8', '10', '0.0', '20', '0.0', '30', '0.0');
        for (let i = 0; i < t.depth.length; i++) {
            out.push('0', 'VERTEX', '8', layer, '10', xyzText(t.xyz[i * 3]), '20', xyzText(t.xyz[i * 3 + 1]), '30', xyzText(t.xyz[i * 3 + 2]), '70', '32');
        }
        out.push('0', 'SEQEND', '8', layer);
    }
    out.push('0', 'ENDSEC', '0', 'EOF');
    return out.join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** Rows of a CSV (quoted fields allowed); blank lines dropped. */
export function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [], cell = '', quoted = false;
    const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (quoted) {
            if (ch === '"') {
                if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
            } else cell += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === ',') { row.push(cell); cell = ''; }
        else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && s[i + 1] === '\n') i++;
            row.push(cell); cell = '';
            if (row.some(c => c.trim() !== '')) rows.push(row);
            row = [];
        } else cell += ch;
    }
    row.push(cell);
    if (row.some(c => c.trim() !== '')) rows.push(row);
    return rows;
}

/** Which file a CSV is, from its header */
export function csvKind(text: string): 'collar' | 'survey' | null {
    const head = parseCsv(text.slice(0, 4000))[0]?.map(h => h.trim().toLowerCase()) ?? [];
    if (head.includes('holeid') && head.includes('easting') && head.includes('northing')) return 'collar';
    if (head.includes('holeid') && head.includes('depth') && head.includes('dip')) return 'survey';
    return null;
}

const num = (s: string | undefined): number | null => {
    if (s === undefined || s.trim() === '') return null;
    const v = Number(s);
    return Number.isFinite(v) ? v : null;
};

export interface CollarRow {
    name: string;
    collar: Vec3 | null;
    dip: number | null;
    azi: number | null;
    eoh: number | null;
    targetDepth: number | null;
    target: Vec3 | null;
    targetDip: number | null;
    targetAzi: number | null;
    lift: number | null;
    drift: number | null;
    mode: 'collar' | 'target' | 'wedge';
    method: CollarMethod;
    pad: string;
    parent: string;
    kopDepth: number | null;
    kickMax: number | null;
    targetId: string;
    ratesMode: 'solve' | 'fixed' | null;
    rateLimits: RateLimits | null;
    topography: string;
}

const METHODS: CollarMethod[] = ['surface-straight', 'surface-curved', 'target-angles', 'collar-angles', 'lift-drift'];

export function readCollarCsv(text: string): { rows: CollarRow[]; problems: string[] } {
    const [head, ...body] = parseCsv(text);
    const problems: string[] = [];
    if (!head) return { rows: [], problems: ['The collar CSV is empty.'] };
    const col = new Map(head.map((h, i) => [h.trim().toLowerCase(), i]));
    const get = (r: string[], name: string) => { const i = col.get(name.toLowerCase()); return i === undefined ? undefined : r[i]; };
    const rows: CollarRow[] = [];
    for (const r of body) {
        const name = (get(r, 'HoleID') ?? '').trim();
        if (!name) continue;
        const e = num(get(r, 'Easting')), n = num(get(r, 'Northing')), rl = num(get(r, 'RL'));
        const te = num(get(r, 'TargetE')), tn = num(get(r, 'TargetN')), trl = num(get(r, 'TargetRL'));
        const modeText = (get(r, 'Mode') ?? '').trim().toLowerCase();
        const mode = modeText === 'target' ? 'target' : modeText === 'wedge' ? 'wedge' : 'collar';
        const m = (get(r, 'CollarMethod') ?? '').trim() as CollarMethod;
        const ratesText = (get(r, 'WedgeRates') ?? '').trim().toLowerCase();
        const lim = ['LiftMin', 'LiftMax', 'DriftMin', 'DriftMax'].map(c => num(get(r, c)));
        if (lim.some(v => v !== null) && !lim.every(v => v !== null)) problems.push(`${name}: some of LiftMin / LiftMax / DriftMin / DriftMax are blank; the planner's limits are used.`);
        if (mode === 'target' && !METHODS.includes(m)) problems.push(`${name}: unknown collar method "${m}"; read as given lift/drift.`);
        rows.push({
            name,
            collar: e !== null && n !== null && rl !== null ? [e, n, rl] : null,
            dip: num(get(r, 'Dip')), azi: num(get(r, 'Azi_grid')), eoh: num(get(r, 'EOH')), targetDepth: num(get(r, 'TargetDepth')),
            target: te !== null && tn !== null && trl !== null ? [te, tn, trl] : null,
            targetDip: num(get(r, 'TargetDip')), targetAzi: num(get(r, 'TargetAzi_grid')),
            lift: num(get(r, 'Lift')), drift: num(get(r, 'Drift')),
            mode, method: METHODS.includes(m) ? m : 'lift-drift',
            topography: (get(r, 'Topography') ?? '').trim(),
            pad: (get(r, 'Pad') ?? '').trim(), parent: (get(r, 'Parent') ?? '').trim(),
            kopDepth: num(get(r, 'KOPDepth')), kickMax: num(get(r, 'KickMax')), targetId: (get(r, 'TargetID') ?? '').trim(),
            ratesMode: ratesText === 'fixed' ? 'fixed' : ratesText === 'solve' ? 'solve' : null,
            rateLimits: lim.every(v => v !== null) ? { liftMin: lim[0]!, liftMax: lim[1]!, driftMin: lim[2]!, driftMax: lim[3]! } : null,
        });
        if (!rows[rows.length - 1].collar) problems.push(`${name}: no collar Easting / Northing / RL.`);
    }
    return { rows, problems };
}

export function readSurveyCsv(text: string): Map<string, SurveyStation[]> {
    const [head, ...body] = parseCsv(text);
    const out = new Map<string, SurveyStation[]>();
    if (!head) return out;
    const col = new Map(head.map((h, i) => [h.trim().toLowerCase(), i]));
    const at = (r: string[], name: string) => { const i = col.get(name); return i === undefined ? undefined : r[i]; };
    for (const r of body) {
        const name = (at(r, 'holeid') ?? '').trim();
        const depth = num(at(r, 'depth')), dip = num(at(r, 'dip')), azi = num(at(r, 'azi_grid') ?? at(r, 'azi') ?? at(r, 'azimuth'));
        if (!name || depth === null || dip === null || azi === null) continue;
        const list = out.get(name) ?? [];
        list.push({ depth, dip, azi });
        out.set(name, list);
    }
    for (const list of out.values()) list.sort((a, b) => a.depth - b.depth);
    return out;
}

const point = (p: Vec3 | null) => ({ e: p?.[0] ?? null, n: p?.[1] ?? null, rl: p?.[2] ?? null });

/**
 * The inputs that rebuild a hole in the mode it was planned in. A hole
 * projected to a topography that is not here keeps its exported collar
 * (solved from its target dip / azimuth instead).
 */
export function inputFromCollarRow(row: CollarRow, topographyHere: boolean): { input: HoleInput; note: string | null } {
    const base: HoleInput = {
        name: row.name, mode: row.mode, collar: point(row.collar), rlFromTopo: false,
        dip: row.dip, azi: row.azi, lift: row.lift, drift: row.drift, eoh: row.eoh,
        target: point(row.target), method: row.method, targetDip: row.targetDip, targetAzi: row.targetAzi,
        extension: row.eoh !== null && row.targetDepth !== null ? Math.max(0, Math.round((row.eoh - row.targetDepth) * 1000) / 1000) : 0,
    };
    if (row.pad) base.collarPad = row.pad;
    if (row.targetId) base.fromTarget = row.targetId;
    if (row.mode === 'collar') return { input: base, note: null };
    // A wedge: its parent is matched by Hole ID (a planned hole first, else an existing drillhole) once planned
    if (row.mode === 'wedge') return { input: { ...base, parent: row.parent ? { kind: 'name', name: row.parent } : null, kopDepth: row.kopDepth, kickMax: row.kickMax, ratesMode: row.ratesMode ?? 'solve', rateLimits: row.rateLimits }, note: row.parent ? null : `${row.name}: a wedge without a parent.` };
    if ((row.method === 'surface-straight' || row.method === 'surface-curved') && !topographyHere) {
        return {
            input: { ...base, method: 'target-angles' },
            note: `${row.name}: its topography${row.topography ? ` (${row.topography})` : ''} is not in this project; the collar is kept where it was exported.`,
        };
    }
    return { input: base, note: null };
}

/** The hole as the collar row describes it: forward from the collar. */
export function traceFromCollarRow(row: CollarRow): Trace | null {
    // A wedge is rebuilt from its parent, not from its collar row
    if (row.mode === 'wedge') return null;
    if (!row.collar || row.dip === null || row.azi === null || row.eoh === null || !(row.eoh > 0)) return null;
    return forwardTrace(row.collar, row.dip, row.azi, { lift: row.lift ?? 0, drift: row.drift ?? 0 }, row.eoh, row.targetDepth);
}

/** The largest distance (m) between a trace and survey stations from the same collar, with its depth. */
export function surveyMismatch(trace: Trace, stations: readonly SurveyStation[]): { distance: number; depth: number } {
    const collar: Vec3 = [trace.xyz[0], trace.xyz[1], trace.xyz[2]];
    const placed = desurvey(collar, stations);
    let worst = { distance: 0, depth: 0 };
    const sorted = [...stations].sort((a, b) => a.depth - b.depth);
    sorted.forEach((s, k) => {
        const at = stationAt(trace, s.depth);
        const d = at ? Math.hypot(at.p[0] - placed[k][0], at.p[1] - placed[k][1], at.p[2] - placed[k][2]) : Infinity;
        if (d > worst.distance) worst = { distance: d, depth: s.depth };
    });
    return worst;
}

// ---------------------------------------------------------------------------
// Target points (ID, Easting, Northing, RL): many holes at once
// ---------------------------------------------------------------------------

/** Column numbers of a target CSV (-1: not found) */
export interface TargetColumns {
    id: number;
    e: number;
    n: number;
    rl: number;
}

const key = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]/g, '');

/** The columns of a target CSV, guessed from its header (the best name match first) */
export function guessTargetColumns(header: readonly string[]): TargetColumns {
    const keys = header.map(key);
    // Grid columns before local ones: X_MGA before X_LOC; a name in the grid's own words first
    const grid = (k: string) => /mga|gda|grid|utm/.test(k);
    const local = (k: string) => /loc|local/.test(k);
    const find = (exact: string[], starts: string[], exclude: number[]) => {
        for (const want of exact) { const i = keys.findIndex((k, j) => k === want && !exclude.includes(j)); if (i >= 0) return i; }
        const loose = keys.map((k, j) => ({ k, j })).filter(({ k, j }) => !exclude.includes(j) && starts.some(s => k.startsWith(s)));
        const ranked = [...loose.filter(c => grid(c.k)), ...loose.filter(c => !grid(c.k) && !local(c.k)), ...loose.filter(c => !grid(c.k) && local(c.k))];
        return ranked[0]?.j ?? -1;
    };
    const id = find(['holeid', 'hole', 'id', 'targetid', 'target', 'name', 'padid', 'pad', 'planid', 'bhid'], ['holeid', 'hole', 'target', 'name', 'pad'], []);
    const e = find(['easting', 'east', 'x', 'e', 'mgae', 'targete'], ['easting', 'east', 'x'], [id]);
    const n = find(['northing', 'north', 'y', 'n', 'mgan', 'targetn'], ['northing', 'north', 'y'], [id, e]);
    const rl = find(['rl', 'elevation', 'elev', 'z', 'mrl', 'ahd', 'targetrl'], ['rl', 'elev', 'z'], [id, e, n]);
    return { id, e, n, rl };
}

export interface TargetRow {
    id: string;
    e: number;
    n: number;
    rl: number;
}

/**
 * The targets in a CSV's rows (header first), by the chosen columns. Rows
 * without an ID or with a coordinate that is not a number are left out and
 * listed. An ID given twice is listed and, by default, kept once (the
 * first: a target is one hole); `keepRepeats` keeps every row, the later
 * ones as "ID (2)", "ID (3)" (pads: the same name used for different places).
 */
export function readTargets(rows: readonly string[][], cols: TargetColumns, opts: { keepRepeats?: boolean } = {}): { targets: TargetRow[]; bad: number[]; repeated: string[] } {
    const targets: TargetRow[] = [], bad: number[] = [], repeated: string[] = [];
    const seen = new Map<string, number>();
    if (cols.id < 0 || cols.e < 0 || cols.n < 0 || cols.rl < 0) return { targets, bad, repeated };
    rows.slice(1).forEach((r, k) => {
        let id = (r[cols.id] ?? '').trim();
        const v = [cols.e, cols.n, cols.rl].map(i => num(r[i]));
        if (!id || v.some(x => x === null)) { bad.push(k + 2); return; }
        const times = (seen.get(id) ?? 0) + 1;
        seen.set(id, times);
        if (times > 1) {
            if (!repeated.includes(id)) repeated.push(id);
            if (!opts.keepRepeats) return;
            id = `${id} (${times})`;
        }
        targets.push({ id, e: v[0]!, n: v[1]!, rl: v[2]! });
    });
    return { targets, bad, repeated };
}
