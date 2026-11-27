/**
 * Drill tracking: the report on one hole being drilled, and the CSV of all
 * of them for the daily drilling meeting (pure; unit-tested).
 */
import type { Rates, Trace, Vec3 } from './drillholePlan';
import type { LiveCollar } from './drillTrackImport';
import { LINK_LABELS, type Link } from './drillTrackLinks';
import { projectAll, PROJECTION_LABELS, type Miss, type PlannedTrack, type PointCheck, type ProjectionKind, type ProjectionResult } from './drillTrackProjection';
import { drilledTrace, TRACK_DEFAULTS, windowRates, type HoleStations, type TrackRules, type WindowRates } from './drillTrackSurveys';
import { requiredRates, type RequiredRates } from './drillTrackRequired';
import { PLAN_DEFAULTS } from './drillholePlan';

export interface ReportInput {
    collar: LiveCollar;
    activeWhy: string;
    link: Link;
    /** The program the planned hole is in, and when it was last changed (ISO) */
    program: { name: string; changed: string | null } | null;
    plan: PlannedTrack | null;
    stations: HoleStations;
    /** Lift and drift for the third projection (null: the planned hole's) */
    custom: Rates | null;
    rules?: TrackRules;
    /** A wedge: the hole it was kicked off and where */
    wedgeOf?: { parent: string; kop: number } | null;
}

export interface HoleReport {
    hole: string;
    planned: string | null;
    linkHow: string;
    program: string | null;
    programChanged: string | null;
    status: string | null;
    activeWhy: string;
    depth: {
        /** The site team's depth, when the file has one */
        live: number | null;
        liveDate: string | null;
        /** Acquire's Max_Depth (not necessarily today's) */
        max: number | null;
        /** The depth the report calls current, and where it came from */
        current: number | null;
        currentFrom: 'live' | 'max' | 'survey' | null;
    };
    last: { depth: number; dip: number; azi: number; method: string | null } | null;
    rates: WindowRates | null;
    projections: ProjectionResult[];
    /** The drilled path down to the last survey (null: no surveys or no collar) */
    drilled: Trace | null;
    wedgeOf: { parent: string; kop: number } | null;
    /** Where the hole is on track to pass its planned target, and whether that is beyond the limit (null: no target or no projection) */
    forecast: TargetForecast | null;
    /** The least lift and drift that bring it within the limit of the target (null: no target, or none found) */
    required: RequiredRates | null;
    notes: string[];
}

/**
 * Where a hole is on track to pass its planned target: by the projection of
 * its recent lift and drift (holding the last survey when there are too few
 * surveys for rates), measured in the plane square to the planned hole at the
 * target; when the projection does not reach that plane, its closest
 * approach.
 */
export interface TargetForecast {
    distance: number;
    kind: ProjectionKind;
    measure: 'plane' | 'closest';
    /** High / right in the plane (null: measured by the closest approach) */
    miss: Miss | null;
    limit: number;
    /** Further than the limit */
    flagged: boolean;
}

export function targetForecast(projections: readonly ProjectionResult[], limit: number): TargetForecast | null {
    const p = projections.find(x => x.kind === 'recent') ?? projections.find(x => x.kind === 'hold');
    const t = p?.target;
    if (!p || !t) return null;
    const distance = t.miss?.distance ?? t.closest?.distance;
    if (distance === undefined || !Number.isFinite(distance)) return null;
    return { distance, kind: p.kind, measure: t.miss ? 'plane' : 'closest', miss: t.miss, limit, flagged: distance > limit };
}

/** A forecast in words: "On track to miss the target by 6.9 m (6.9 m high, 0.2 m right), more than 5 m (recent lift and drift)" */
export function forecastText(f: TargetForecast): string {
    const where = f.miss ? ` (${missText(f.miss)})` : ' (closest approach: the projection does not reach the target\'s plane)';
    const call = f.flagged ? `, more than ${f.limit} m` : `, within ${f.limit} m`;
    return `On track to pass ${f.distance.toFixed(1)} m from the target${where}${call} (${PROJECTION_LABELS[f.kind].toLowerCase()}).`;
}

const ZERO: Rates = { lift: 0, drift: 0 };

export function buildHoleReport(input: ReportInput): HoleReport {
    const { collar: c, plan, stations: hs } = input;
    const rules = input.rules ?? TRACK_DEFAULTS;
    const notes: string[] = [];
    const s = hs.stations;
    const last = s.length ? s[s.length - 1] : null;
    const at: Vec3 | null = c.e !== null && c.n !== null && c.rl !== null ? [c.e, c.n, c.rl] : null;
    const drilled = at && s.length ? drilledTrace(at, s) : null;
    const rates = windowRates(s, rules);

    const live = c.liveDepth, max = c.maxDepth;
    const current = live ?? max ?? last?.depth ?? null;
    const currentFrom = live !== null ? 'live' : max !== null ? 'max' : last ? 'survey' : null;
    if (currentFrom === 'max') notes.push('Current depth is Max_Depth, which may not be today\'s.');
    if (!at) notes.push('No collar coordinates.');
    if (!s.length) notes.push('No surveys yet.');
    if (hs.copiesOnly) notes.push('Only start / end of hole survey copies: no rates.');
    if (hs.otherGrid.length) notes.push(`${hs.otherGrid.length} survey row(s) to another grid (${[...new Set(hs.otherGrid.map(g => g.grid))].join(', ')}) left out.`);
    if (rates && !rates.enough) notes.push(`Only ${rates.n} surveys in the last ${rules.window} m: rates unreliable.`);
    if (rates?.nearVertical) notes.push('Near vertical: azimuth and drift mean little.');
    if (!plan) notes.push(input.link.planned ? 'The planned hole has no trace.' : `Not linked to a planned hole (${LINK_LABELS[input.link.how]}).`);

    const limit = rules.missLimit ?? TRACK_DEFAULTS.missLimit;
    let projections: ProjectionResult[] = [];
    let required: RequiredRates | null = null;
    if (drilled && last && plan && !hs.copiesOnly) {
        required = requiredRates(drilled, last.depth, plan, limit);
        projections = projectAll(drilled, last.depth, plan, {
            hold: ZERO,
            recent: rates ? { lift: rates.lift, drift: rates.drift } : null,
            custom: input.custom ?? { lift: plan.lift, drift: plan.drift },
            required: required?.rates ?? null,
        });
        if (plan.targetDepth !== null && !required) notes.push(`No lift and drift found that bring it within ${limit} m of the target.`);
        else if (required && Math.max(Math.abs(required.rates.lift), Math.abs(required.rates.drift)) > PLAN_DEFAULTS.liftLimit) {
            notes.push(`Coming within ${limit} m needs more than ${PLAN_DEFAULTS.liftLimit} °/100 m of lift or drift.`);
        }
    }
    const forecast = targetForecast(projections, limit);
    return {
        hole: c.hole, planned: plan?.name ?? null, linkHow: LINK_LABELS[input.link.how],
        program: input.program?.name ?? null, programChanged: input.program?.changed ?? null,
        status: c.status, activeWhy: input.activeWhy,
        depth: { live, liveDate: c.liveDepthDate, max, current, currentFrom },
        last: last ? { depth: last.depth, dip: last.dip, azi: last.azi, method: last.method } : null,
        rates, projections, drilled, wedgeOf: input.wedgeOf ?? null, forecast, required, notes,
    };
}

/** The least lift and drift in words: "lift -1.20, drift 0.85 °/100 m (recent 2.51 / 1.49; to hit the target -2.4 / 1.1)" */
export function requiredText(r: HoleReport): string {
    const q = r.required;
    if (!q) return '';
    const pair = (a: { lift: number; drift: number }) => `${num(a.lift, 2)} / ${num(a.drift, 2)}`;
    const head = q.holdIsEnough
        ? `Holding the last survey lands within ${q.limit} m (${num(q.distance, 1)} m): no lift or drift needed`
        : `Least lift / drift to come within ${q.limit} m: ${pair(q.rates)} °/100 m`;
    const extra = [r.rates ? `recent ${pair(r.rates)}` : null, q.hit ? `to hit the target ${pair(q.hit)}` : null].filter(Boolean).join('; ');
    return extra ? `${head} (${extra}).` : `${head}.`;
}

const num = (v: number | null | undefined, dp: number) => (v === null || v === undefined || !Number.isFinite(v) ? '' : (Object.is(Math.round(v * 10 ** dp), -0) ? 0 : v).toFixed(dp));
const csvCell = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

const checkCells = (c: PointCheck | null | undefined) => [
    num(c?.closest?.distance, 1), num(c?.closest?.depth, 1), num(c?.miss?.high, 1), num(c?.miss?.right, 1),
];

export const REPORT_KINDS: readonly ProjectionKind[] = ['hold', 'recent', 'custom', 'required'];

/** A miss in words: "2.3 m high, 1.1 m left" (null: the projection does not reach the plane) */
export function missText(miss: { high: number; right: number } | null | undefined, dp = 1): string {
    if (!miss) return 'does not reach';
    const part = (v: number, plus: string, minus: string) => {
        const t = Math.abs(v).toFixed(dp);
        return Number(t) === 0 ? `0 ${plus}/${minus}` : `${t} m ${v > 0 ? plus : minus}`;
    };
    return `${part(miss.high, 'high', 'low')}, ${part(miss.right, 'right', 'left')}`;
}

/** The short table for the daily meeting (the Report page): a row a hole being drilled, the projections at the target */
export function meetingTable(reports: readonly HoleReport[]): { columns: string[]; rows: string[][] } {
    const columns = ['Hole', 'Planned', 'On track to pass the target by (m)', 'Depth (m)', 'Last survey (m)', 'Dip / Azi', 'Lift / Drift (°/100 m)',
        'Least lift / drift to come within tolerance (°/100 m)', ...REPORT_KINDS.map(k => `${PROJECTION_LABELS[k]}: at target`), 'Notes'];
    const rows = reports.map(r => [
        r.hole + (r.wedgeOf ? ` (wedge of ${r.wedgeOf.parent})` : ''), r.planned ?? '—',
        r.forecast ? `${num(r.forecast.distance, 1)}${r.forecast.flagged ? ` — FLAG, more than ${r.forecast.limit} m` : ''}` : '',
        `${num(r.depth.current, 1)}${r.depth.currentFrom === 'max' ? ' (Max_Depth)' : ''}`, num(r.last?.depth, 1),
        r.last ? `${num(r.last.dip, 1)} / ${num(r.last.azi, 1)}` : '',
        r.rates ? `${num(r.rates.lift, 2)} / ${num(r.rates.drift, 2)}${r.rates.enough ? '' : ' (few surveys)'}` : '',
        r.required ? (r.required.holdIsEnough ? 'none needed (holding is within)' : `${num(r.required.rates.lift, 2)} / ${num(r.required.rates.drift, 2)}`) : '',
        ...REPORT_KINDS.map(k => {
            const p = r.projections.find(x => x.kind === k);
            if (!p?.target) return '';
            return `${missText(p.target.miss)}; closest ${num(p.target.closest?.distance, 1)} m`;
        }),
        r.notes.join(' '),
    ]);
    return { columns, rows };
}

/** The report on every hole as a CSV (one row a hole), headed by when the data was read */
export function reportCsv(reports: readonly HoleReport[], meta: { refreshedAt: string; source: string; window: number }): string {
    const lines: string[][] = [
        ['Drill tracking report'], ['Data read', meta.refreshedAt], ['From', meta.source], ['Lift / drift window (m)', String(meta.window)],
        ['Signs: lift + flattens, drift + clockwise (°/100 m); high + towards the planned hole\'s high side, right + to its right looking down it; azimuths grid'], [],
    ];
    const head = ['Hole', 'Planned hole', 'Linked by', 'Program', 'Program changed', 'Status', 'Active because', 'Wedge of', 'Kick-off (m)',
        'Current depth (m)', 'Current depth from', 'Live depth (m)', 'Live depth date', 'Max depth (m)',
        'Last survey (m)', 'Last survey method', 'Dip', 'Azimuth (grid)',
        'Lift (°/100 m)', 'Drift (°/100 m)', 'Lift SE', 'Drift SE', 'Dip scatter (°)', 'Azimuth scatter (°)', 'Window from (m)', 'Window to (m)', 'Surveys in window',
        'Forecast at target (m)', 'Forecast by', 'Flag limit (m)', 'Flag',
        'Least lift to come within limit', 'Least drift to come within limit', 'Holding is within limit', 'Lift to hit target', 'Drift to hit target'];
    for (const k of REPORT_KINDS) {
        const l = PROJECTION_LABELS[k];
        head.push(`${l}: lift`, `${l}: drift`,
            `${l}: target closest (m)`, `${l}: at depth (m)`, `${l}: target high (m)`, `${l}: target right (m)`,
            `${l}: EOH closest (m)`, `${l}: at depth (m)`, `${l}: EOH high (m)`, `${l}: EOH right (m)`);
    }
    head.push('Notes');
    lines.push(head);
    for (const r of reports) {
        const row = [
            r.hole, r.planned ?? '', r.linkHow, r.program ?? '', r.programChanged ?? '', r.status ?? '', r.activeWhy, r.wedgeOf?.parent ?? '', num(r.wedgeOf?.kop, 1),
            num(r.depth.current, 1), r.depth.currentFrom ?? '', num(r.depth.live, 1), r.depth.liveDate ?? '', num(r.depth.max, 1),
            num(r.last?.depth, 1), r.last?.method ?? '', num(r.last?.dip, 2), num(r.last?.azi, 2),
            num(r.rates?.lift, 2), num(r.rates?.drift, 2), num(r.rates?.liftSe, 2), num(r.rates?.driftSe, 2), num(r.rates?.dipSd, 2), num(r.rates?.aziSd, 2),
            num(r.rates?.from, 1), num(r.rates?.to, 1), r.rates ? String(r.rates.n) : '',
            num(r.forecast?.distance, 1), r.forecast ? `${PROJECTION_LABELS[r.forecast.kind]}${r.forecast.measure === 'closest' ? ' (closest approach)' : ''}` : '',
            num(r.forecast?.limit, 1), r.forecast?.flagged ? 'FLAG' : '',
            num(r.required?.rates.lift, 2), num(r.required?.rates.drift, 2), r.required ? (r.required.holdIsEnough ? 'yes' : 'no') : '',
            num(r.required?.hit?.lift, 2), num(r.required?.hit?.drift, 2),
        ];
        for (const k of REPORT_KINDS) {
            const p = r.projections.find(x => x.kind === k);
            row.push(num(p?.rates.lift, 2), num(p?.rates.drift, 2), ...checkCells(p?.target), ...checkCells(p?.eoh));
        }
        row.push(r.notes.join(' '));
        lines.push(row);
    }
    return lines.map(l => l.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
