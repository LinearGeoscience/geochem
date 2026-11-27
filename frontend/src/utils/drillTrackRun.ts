/**
 * Drill tracking, all of it: the drilled holes of the latest Acquire data
 * against a planned program (pure; unit-tested).
 *
 * - Each drilled hole's stations (drillTrackSurveys) and whether it is being
 *   drilled (drillTrackLinks.activeState, with the settings by hand).
 * - Links to the program's holes (by name, then target ID; by hand wins).
 * - Wedges: a daughter that carries its parent's planned-hole ID (as Acquire
 *   has them now) is linked to the program's one wedge planned off that
 *   parent's planned hole, when there is exactly one; else it is left for
 *   assigning by hand.
 * - A report on every hole being drilled (drillTrackReport).
 * - Each planned hole's drilled holes, and which one is tracked.
 */
import type { Rates, SurveyStation } from './drillholePlan';
import type { LiveDrillData, LiveSurvey } from './drillTrackImport';
import { activeState, findWedges, linkHoles, trackedOf, type ActiveOverride, type Link, type WedgePair } from './drillTrackLinks';
import { buildHoleReport, type HoleReport } from './drillTrackReport';
import { holeStations, TRACK_DEFAULTS, type HoleStations, type TrackRules } from './drillTrackSurveys';
import { plannedKey, plannedRefs, plannedTrackOf, type PlannedProgram } from './plannedPrograms';

export interface TrackingInput {
    program: PlannedProgram | null;
    live: LiveDrillData | null;
    manualLinks?: Readonly<Record<string, string | null>>;
    activeOverride?: Readonly<Record<string, ActiveOverride>>;
    custom?: Readonly<Record<string, Rates>>;
    rules?: TrackRules;
}

export interface PlannedStatus {
    key: string;
    name: string;
    /** Drilled holes linked to it, and the one tracked */
    drilled: string[];
    tracked: string | null;
    state: 'not drilled' | 'drilling' | 'drilled';
}

export interface TrackingResult {
    links: Link[];
    active: Map<string, { active: boolean; why: string }>;
    stations: Map<string, HoleStations>;
    wedges: WedgePair[];
    /** Reports on the holes being drilled, by hole ID */
    reports: HoleReport[];
    planned: PlannedStatus[];
    /** Drilled holes being drilled that are not linked to a planned hole */
    activeUnlinked: Link[];
}

export function runTracking(input: TrackingInput): TrackingResult {
    const rules = input.rules ?? TRACK_DEFAULTS;
    const collars = input.live?.collars ?? [];
    const byHole = new Map<string, LiveSurvey[]>();
    for (const s of input.live?.surveys ?? []) {
        const list = byHole.get(s.hole);
        if (list) list.push(s); else byHole.set(s.hole, [s]);
    }
    const stations = new Map<string, HoleStations>();
    for (const c of collars) stations.set(c.hole, holeStations(byHole.get(c.hole) ?? [], rules));
    const active = new Map(collars.map(c => [c.hole, activeState(c, input.activeOverride?.[c.hole], rules)]));
    const program = input.program;
    const refs = program ? plannedRefs(program) : [];
    const links = linkHoles(collars, refs, input.manualLinks ?? {});
    const plain = new Map<string, readonly SurveyStation[]>([...stations].map(([h, s]) => [h, s.stations]));
    const wedges = findWedges(collars, plain);

    // A daughter linked to its parent's planned hole only because it carries its ID
    const linkOf = new Map(links.map(l => [l.hole, l]));
    if (program) {
        for (const w of wedges) {
            const d = linkOf.get(w.daughter), p = linkOf.get(w.parent);
            if (!d || !p || d.how === 'manual' || d.how === 'none' || !d.planned || d.planned !== p.planned) continue;
            const parentId = d.planned.slice(program.id.length + 1);
            const parentName = program.holes.find(h => h.id === parentId)?.input.name;
            const planned = program.holes.filter(h => h.input.mode === 'wedge' && h.input.parent && (
                (h.input.parent.kind === 'planned' && h.input.parent.id === parentId) || (h.input.parent.kind !== 'planned' && h.input.parent.name === parentName)));
            const next: Link = planned.length === 1
                ? { hole: w.daughter, planned: plannedKey(program.id, planned[0].id), how: 'wedge' }
                : { hole: w.daughter, planned: null, how: 'wedge' };
            linkOf.set(w.daughter, next);
        }
    }
    const finalLinks = links.map(l => linkOf.get(l.hole) ?? l);
    const wedgeOf = new Map(wedges.map(w => [w.daughter, w]));

    const holesOf = new Map<string, string[]>();
    for (const l of finalLinks) if (l.planned) holesOf.set(l.planned, [...(holesOf.get(l.planned) ?? []), l.hole]);
    const collarOf = new Map(collars.map(c => [c.hole, c]));
    const isActive = (h: string) => active.get(h)?.active ?? false;
    const planned: PlannedStatus[] = (program?.holes ?? []).map(h => {
        const key = plannedKey(program!.id, h.id);
        const drilled = holesOf.get(key) ?? [];
        const tracked = trackedOf(drilled.map(d => collarOf.get(d)!), isActive);
        return {
            key, name: h.input.name, drilled, tracked,
            state: drilled.some(isActive) ? 'drilling' : drilled.length ? 'drilled' : 'not drilled',
        };
    });

    const holeByKey = new Map((program?.holes ?? []).map(h => [plannedKey(program!.id, h.id), h]));
    const reports: HoleReport[] = [];
    for (const c of collars) {
        const a = active.get(c.hole)!;
        if (!a.active) continue;
        const link = linkOf.get(c.hole)!;
        const hole = link.planned ? holeByKey.get(link.planned) : undefined;
        const w = wedgeOf.get(c.hole);
        reports.push(buildHoleReport({
            collar: c, activeWhy: a.why, link,
            program: program ? { name: program.name, changed: program.changed } : null,
            plan: hole ? plannedTrackOf(hole) : null, stations: stations.get(c.hole)!,
            custom: input.custom?.[c.hole] ?? null, rules, wedgeOf: w ? { parent: w.parent, kop: w.kop } : null,
        }));
    }
    reports.sort((a, b) => a.hole.localeCompare(b.hole));
    const activeUnlinked = finalLinks.filter(l => isActive(l.hole) && !l.planned);
    return { links: finalLinks, active, stations, wedges, reports, planned, activeUnlinked };
}
