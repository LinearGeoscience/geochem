/**
 * Snapping planned holes' collars to the nearest drill pad
 * (utils/drillholePlanPads). Each hole's dip and azimuth at its target, lift
 * and drift are the guide; the collar goes to the pad (its own RL) and the
 * hole becomes collar to target, its collar dip and azimuth solved.
 */
import { snapToPad } from '../../../../utils/drillholePlanPads';
import { usePlanStore } from './planStore';
import type { Planner } from './usePlans';

export interface SnapReport {
    snapped: { name: string; pad: string }[];
    failed: { name: string; reason: string }[];
}

export function snapHolesToPads(planner: Planner, ids: readonly string[]): SnapReport {
    const store = usePlanStore.getState();
    const out: SnapReport = { snapped: [], failed: [] };
    const s = store.settings;
    for (const id of ids) {
        const hole = store.holes.find(h => h.id === id);
        if (!hole) continue;
        const input = hole.input, name = input.name;
        if (input.mode !== 'target') { out.failed.push({ name, reason: input.mode === 'wedge' ? 'a wedge starts on its parent' : 'planned by its collar (no target)' }); continue; }
        const t = input.target;
        if (t.e === null || t.n === null || t.rl === null) { out.failed.push({ name, reason: 'no target' }); continue; }
        const topo = planner.topoOf(hole.topo);
        if (!topo) { out.failed.push({ name, reason: 'no topography' }); continue; }
        // The guide: the hole's direction at its target (as typed for a projection to the surface, else as worked out)
        const surface = input.method === 'surface-straight' || input.method === 'surface-curved';
        const worked = planner.holes.find(h => h.hole.id === id)?.result;
        const dip = surface ? input.targetDip : worked?.targetDip ?? input.targetDip;
        const azi = surface ? input.targetAzi : worked?.targetAzi ?? input.targetAzi;
        if (dip === null || dip === undefined || azi === null || azi === undefined) { out.failed.push({ name, reason: 'no dip / azimuth at the target to guide it' }); continue; }
        const lift = input.method === 'surface-straight' ? 0 : input.lift ?? 0;
        const drift = input.method === 'surface-straight' ? 0 : input.drift ?? 0;
        const r = snapToPad([t.e, t.n, t.rl], { dip, azi, lift, drift }, planner.pads, {
            topo, radius: s.padRadius, maxDipChange: s.padMaxDip, maxAziChange: s.padMaxAzi, maxBackLength: s.maxBackLength,
        });
        if (!r.ok) { out.failed.push({ name, reason: r.reason }); continue; }
        // The pad's own RL, not the topography's
        store.updateHole(id, {
            mode: 'target', method: 'lift-drift', lift, drift, collar: { e: r.pad.p[0], n: r.pad.p[1], rl: r.pad.p[2] },
            rlFromTopo: false, collarPad: r.pad.id, collarHole: null,
        });
        out.snapped.push({ name, pad: r.pad.id });
    }
    return out;
}

/** "PLN_001 → PDD_006, …; 2 not snapped: PLN_005 (no pad within 300 m …)" */
export function snapReportText(r: SnapReport): string {
    const list = (xs: string[]) => xs.slice(0, 6).join('; ') + (xs.length > 6 ? `; … (${xs.length} in all)` : '');
    return [
        r.snapped.length ? `Snapped ${r.snapped.length} collar${r.snapped.length === 1 ? '' : 's'} to pads: ${list(r.snapped.map(x => `${x.name} → ${x.pad}`))}.` : '',
        r.failed.length ? `${r.failed.length} not snapped: ${list(r.failed.map(x => `${x.name} (${x.reason})`))}` : '',
    ].filter(Boolean).join(' ');
}
