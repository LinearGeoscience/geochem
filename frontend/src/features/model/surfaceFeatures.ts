/**
 * What is set on a surface beyond what it is built from, as short lines for
 * the project tree (pure): what was placed on it by hand, counted; the plane
 * and the lengths given to it; a trend of its own; the columns it writes.
 * Only what is set: a surface left as it was made has none.
 */
import { SHEETS_STRENGTH, type ModelScene, type SurfaceObject } from './types';

export interface SurfaceFeature {
    /** Unique among the features of one surface */
    slug: string;
    name: string;
    detail?: string;
}

/** A length for reading (two figures: 0.2 m, 3.5 m, 26 m) */
const formatMetres = (v: number) => `${Number(v.toPrecision(2)).toLocaleString()} m`;
const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const bearing = (v: number) => String(((Math.round(v) % 360) + 360) % 360).padStart(3, '0');
const lie = (p: { dip: number; dipDirection: number }) => `dips ${Math.round(p.dip)}° to ${bearing(p.dipDirection)}`;

export function surfaceFeatures(s: SurfaceObject, scene: Pick<ModelScene, 'models'>): SurfaceFeature[] {
    const out: SurfaceFeature[] = [];
    const add = (slug: string, name: string, detail?: string) => { out.push({ slug, name, ...(detail ? { detail } : {}) }); };
    const rule = s.rule;
    const body = rule.kind === 'body' ? rule : null;
    const modelName = (id: string) => scene.models?.find(m => m.id === id)?.name ?? 'a model no longer in the project';

    // --- By hand, on what the logging gives it ---
    const control = rule.kind === 'contact' || rule.kind === 'body' ? rule.control : undefined;
    const marks = control?.marks ?? [];
    const links = marks.filter(m => m.to).length;
    const inside = marks.filter(m => !m.to && m.side > 0).length, outside = marks.filter(m => !m.to && m.side < 0).length;
    if (links) add('links', count(links, 'link'), 'by hand, between holes');
    if (body) {
        if (inside) add('inside', count(inside, 'place'), 'held inside it, by hand');
        if (outside) add('cuts', count(outside, 'cut'), 'places held outside it, by hand');
    } else if (inside + outside) add('sides', count(inside + outside, 'place'), 'held on one side of it, by hand');
    const edits = control?.edits ?? [];
    const moved = edits.filter(e => !e.ignore && e.to !== undefined).length, left = edits.filter(e => e.ignore).length;
    if (moved) add('moved', count(moved, 'contact'), 'moved along its hole, by hand');
    if (left) add('left', count(left, 'contact'), 'left out, by hand');
    if (control?.uncrossed?.length) add('uncrossed', count(control.uncrossed.length, 'hole'), 'it must not cross');
    if (body?.vein?.picks?.length) add('picks', count(body.vein.picks.length, 'stretch', 'stretches'), 'of its units down the holes are this vein');

    // --- By hand, on the surface itself ---
    let dips = 0, directions = 0;
    for (const p of s.points ?? []) { if (p.reading) dips++; else if (p.direction) directions++; }
    for (const line of s.polylines ?? []) for (const n of line.nodes ?? []) { if (n?.reading) dips++; if (n?.direction) directions++; }
    if (dips) add('dips', count(dips, 'dip'), 'by hand');
    if (directions) add('directions', count(directions, 'direction'), 'by hand');

    // --- The plane and the lengths given to it ---
    const plane = body ? body.vein?.plane ?? body.sheets?.plane : rule.kind === 'shell' ? rule.of?.plane : undefined;
    if (plane) add('plane', 'Plane of its sheets', `${lie(plane)}, given`);
    if (body?.sheets && !body.vein) {
        add('sheets', 'Thin sheets', `${body.sheets.strength ?? SHEETS_STRENGTH} times as far along as across`);
        if (body.sheets.join) add('join', 'Join length', formatMetres(body.sheets.join));
        if (body.sheets.least) add('least', 'Small pieces left out', `under ${body.sheets.least.toLocaleString()} m³`);
    }
    if (body?.vein) {
        if (body.vein.join) add('join', 'Join length', formatMetres(body.vein.join));
        if (body.vein.thickness === 'net') add('net', 'Net thickness', 'as thick as its units in each zone');
        if (body.vein.least > 0) add('least', 'Least thickness', formatMetres(body.vein.least));
    }
    if (s.params.extent === 'near' && s.params.reach != null) add('reach', 'Reach', `${formatMetres(s.params.reach)} from its places`);
    if (s.params.extent === 'outline' && s.params.outline) add('outline', 'Kept inside an outline', 'drawn in a view');
    if (rule.kind === 'shell' && rule.topCut != null) add('topCut', 'Top cut', rule.topCut.toLocaleString());

    // --- What it follows, of its own ---
    if (s.params.trend !== false) {
        const own = s.params.trendOwn;
        if (own) add('trend', 'A global trend of its own', `${lie(own)}${own.lineTrend != null ? `, plunging towards ${bearing(own.lineTrend)}` : ''}`);
        if (s.params.trendLayers) add('layers', 'Follows the layers of', modelName(s.params.trendLayers));
    }
    if (s.conform && s.conform.by != null) add('offset', 'Offset', `${formatMetres(Math.abs(s.conform.by))} from what it is conformable to`);
    if (s.within && !s.blockOf) add('block', 'Fitted in one fault block of', modelName(s.within.model));

    // --- What it writes ---
    const columns = [s.columns?.side, s.columns?.distance, s.columns?.thickness].filter((c): c is string => !!c);
    if (columns.length) add('columns', columns.length === 1 ? 'A column it writes' : 'Columns it writes', columns.join(', '));
    return out;
}
