/**
 * The throw across each fault of a built geological model, read from its
 * own contacts: a contact that is in the age order once on each side of a
 * fault (the same unit, as "Split its contacts by fault block" makes them)
 * is a marker, and where its two surfaces meet the fault tells the throw.
 */
import { useModelStore } from '../../store/modelStore';
import { piecesOn } from './faultCuts';
import { verticalThrow, zeroTrace, type Throw } from './faultThrow';
import { useGeoModelCache, type ModelResult } from './geoModelCache';
import { readModelField, type ModelField } from './geoModelJobs';
import { clipMeshByScalar } from './meshOps';
import { contactMeshes } from './modelParts';
import type { FaultSide, GeoModel, ModelContact } from './types';

export interface MarkerThrow extends Throw {
    /** The fault (its id in the model) and the marker's unit */
    fault: string;
    unit: string;
    /** The contacts read: on the fault's first side, and on its second */
    first: string;
    second: string;
}

/** A contact as the build has it in one fault block: its field there, and the sides of the faults that block is on */
interface Marker { c: ModelContact; field: ModelField; within: readonly FaultSide[] }

/**
 * The markers that are one layer: the parts of one contact (fitted in each
 * fault block apart by the model), or the contacts of one unit and kind that
 * were split from one by hand.
 */
const layerOf = (m: Marker): string => (m.c.within?.length ? `hand:${m.c.unit}|${m.c.kind}` : `own:${m.c.id}`);

/**
 * The throws of a model as built: per fault and marker, how much higher the
 * marker is on the fault's first side than on its second. Empty when the
 * model is not built, or no contact is on both sides of a fault.
 *
 * Where other faults cut the ground too, a marker has a part in each block
 * beside the fault: each is read along the stretch of the fault that its
 * block is on, and the stretches together are the marker's line on that side.
 */
export function modelThrows(model: GeoModel, result: ModelResult | undefined): MarkerThrow[] {
    const out = result?.out, job = result?.job;
    if (!result || !out || !job) return [];
    // (A contact fitted in each fault block apart is in the build once a block, with the sides of that block)
    const markers: Marker[] = result.contacts.flatMap((id, k) => {
        const c = model.contacts.find(x => x.id === id);
        return c && job.fields[k] ? [{ c, field: job.fields[k], within: result.sides?.[k] ?? c.within ?? [] }] : [];
    });
    const layers = new Map<string, Marker[]>();
    for (const m of markers) layers.set(layerOf(m), [...(layers.get(layerOf(m)) ?? []), m]);
    const throws: MarkerThrow[] = [];
    // (A fault that younger faults offset is in the build once a piece: it is one fault here, its pieces together)
    const pieces = result.faults.map((id, f) => ({ id, cut: result.cuts?.[f] ?? [] }));
    [...new Set(result.faults)].forEach(fault => {
        const mesh = contactMeshes(out, result.faults.flatMap((id, f) => (id === fault ? [out.faultFrom + f] : [])));
        if (mesh.triangles.length === 0) return;
        /** Where a marker meets the fault: on the stretch of it that is on the sides of the other faults the marker is on */
        const trace = (m: Marker): Float64Array => {
            let part = mesh;
            for (const [g, side] of piecesOn(pieces, m.within)) {
                if (result.faults[g] === fault || part.triangles.length === 0) continue;
                const v = readModelField(job.faults!.fields[g], part.vertices);
                part = clipMeshByScalar(part, Float64Array.from(v, x => -side * x));
            }
            return part.triangles.length > 0 ? zeroTrace(part, readModelField(m.field, part.vertices)) : new Float64Array(0);
        };
        const line = (ms: readonly Marker[]): Float64Array => {
            const traces = ms.map(trace);
            const all = new Float64Array(traces.reduce((n, t) => n + t.length, 0));
            let at = 0;
            for (const t of traces) { all.set(t, at); at += t.length; }
            return all;
        };
        for (const of of layers.values()) {
            const side = (m: Marker) => m.within.find(e => e.fault === fault)?.side ?? 0;
            const firsts = of.filter(m => side(m) === 1), seconds = of.filter(m => side(m) === -1);
            if (firsts.length === 0 || seconds.length === 0) continue;
            // (One field on both sides, where a block has nothing of the contact to fit: it tells no throw)
            if (firsts.every(a => seconds.some(b => b.field === a.field)) && seconds.every(b => firsts.some(a => a.field === b.field))) continue;
            const read = verticalThrow(line(firsts), line(seconds));
            if (read) throws.push({ ...read, fault, unit: firsts[0].c.unit, first: firsts[0].c.id, second: seconds[0].c.id });
        }
    });
    return throws;
}

/** The throws of a model of the scene, as it is built now */
export function throwsOf(modelId: string): MarkerThrow[] {
    const model = useModelStore.getState().scene.models?.find(g => g.id === modelId);
    return model ? modelThrows(model, useGeoModelCache.getState().byId[modelId]) : [];
}

/** A throw in words, given the names of the fault's sides: "east side up 50 m (48 to 52 m along 200 m of it)" */
export function throwText(t: Throw, sides: readonly [string, string]): string {
    const m = (v: number) => (Math.abs(v) >= 100 ? Math.round(Math.abs(v)).toLocaleString() : Math.abs(v).toFixed(1).replace(/\.0$/, ''));
    if (Math.abs(t.throw) < 0.05) return 'no throw to speak of';
    const up = sides[t.throw > 0 ? 0 : 1].replace(/ side$/, '');
    const lo = Math.min(Math.abs(t.low), Math.abs(t.high)), hi = Math.max(Math.abs(t.low), Math.abs(t.high));
    const spread = hi - lo > Math.max(0.5, 0.05 * Math.abs(t.throw)) ? `, ${m(lo)} to ${m(hi)} m` : '';
    return `${up} side up ${m(t.throw)} m (read along ${Math.round(t.length).toLocaleString()} m of the fault${spread})`;
}
