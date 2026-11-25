/**
 * Section sets: parallel, evenly spaced planes to look at and draw on (pure,
 * unit-tested). A set is W-E or S-N sections, sections on any bearing, level
 * plans, or tilted planes. Plane `i` is worked out from its number, never by
 * adding steps, so stepping fifty times lands exactly on plane 50.
 */
import type { SectionSet, Vec3 } from './types';

export const MAX_SECTION_SETS = 50;

const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Cosine and sine of a whole number of degrees, exact at the quarter turns */
function cosSin(deg: number): [number, number] {
    const d = ((deg % 360) + 360) % 360;
    if (d === 0) return [1, 0];
    if (d === 90) return [0, 1];
    if (d === 180) return [-1, 0];
    if (d === 270) return [0, -1];
    const r = (d * Math.PI) / 180;
    return [Math.cos(r), Math.sin(r)];
}

/** Unit length, its largest part positive (as slices are kept). Null for a zero vector. */
export function setNormal(n: ArrayLike<number>): Vec3 | null {
    const len = Math.hypot(n[0], n[1], n[2]);
    if (!(len > 1e-12) || ![n[0], n[1], n[2]].every(Number.isFinite)) return null;
    let v: Vec3 = [n[0] / len, n[1] / len, n[2] / len];
    const a = v.map(Math.abs);
    const k = a[0] >= a[1] && a[0] >= a[2] ? 0 : a[1] >= a[2] ? 1 : 2;
    if (v[k] < 0) v = [-v[0], -v[1], -v[2]];
    // Within a hair of an axis: exactly on it
    for (let j = 0; j < 3; j++) if (Math.abs(v[j]) > 1 - 1e-12) return [j === 0 ? 1 : 0, j === 1 ? 1 : 0, j === 2 ? 1 : 0];
    return v.map(x => (Math.abs(x) < 1e-15 ? 0 : x)) as Vec3;
}

/** The normal of vertical sections that run on `azimuth` (degrees from north, clockwise). */
export function normalFromAzimuth(azimuth: number): Vec3 {
    const [c, s] = cosSin(azimuth);
    return setNormal([c, -s, 0])!;
}

/** The bearing vertical sections run on (0 to 180), null when the planes are not vertical. */
export function sectionAzimuth(normal: Vec3): number | null {
    if (Math.abs(normal[2]) > 1e-9) return null;
    const along = [-normal[1], normal[0]];
    const az = (Math.atan2(along[0], along[1]) * 180) / Math.PI;
    return Number((((az % 180) + 180) % 180).toFixed(6)) % 180;
}

export type SectionKind = 'we' | 'sn' | 'section' | 'level' | 'tilted';

export function sectionKind(normal: Vec3): SectionKind {
    if (normal[2] === 1) return 'level';
    if (normal[1] === 1) return 'we';
    if (normal[0] === 1) return 'sn';
    return Math.abs(normal[2]) < 1e-9 ? 'section' : 'tilted';
}

/** Which way a section set faces and steps, in words */
export function describeSectionSet(s: Pick<SectionSet, 'normal'>): string {
    switch (sectionKind(s.normal)) {
        case 'we': return 'W-E, stepping north';
        case 'sn': return 'S-N, stepping east';
        case 'level': return 'Level plans, stepping up';
        case 'section': return `Vertical, on ${Math.round(sectionAzimuth(s.normal)!).toString().padStart(3, '0')}°`;
        default: return 'Tilted';
    }
}

/** Plane `i` of a set: its normal and a point on it (world coordinates). */
export function sectionPlane(set: Pick<SectionSet, 'normal' | 'origin' | 'spacing'>, i: number): { normal: Vec3; point: Vec3 } {
    const d = i * set.spacing;
    const n = set.normal;
    return { normal: [n[0], n[1], n[2]], point: [set.origin[0] + d * n[0], set.origin[1] + d * n[1], set.origin[2] + d * n[2]] };
}

/** The number of the plane nearest a point (world coordinates). */
export function sectionIndexAt(set: Pick<SectionSet, 'normal' | 'origin' | 'spacing'>, p: ArrayLike<number>): number {
    const d = dot([p[0] - set.origin[0], p[1] - set.origin[1], p[2] - set.origin[2]], set.normal);
    const i = Math.round(d / set.spacing);
    return Object.is(i, -0) ? 0 : i;
}

/** The first and last planes that cut a box (world coordinates). */
export function sectionRange(set: Pick<SectionSet, 'normal' | 'origin' | 'spacing'>, box: { min: ArrayLike<number>; max: ArrayLike<number> }): [number, number] {
    let lo = Infinity, hi = -Infinity;
    for (let c = 0; c < 8; c++) {
        const p = [c & 1 ? box.max[0] : box.min[0], c & 2 ? box.max[1] : box.min[1], c & 4 ? box.max[2] : box.min[2]];
        const d = dot([p[0] - set.origin[0], p[1] - set.origin[1], p[2] - set.origin[2]], set.normal) / set.spacing;
        lo = Math.min(lo, d);
        hi = Math.max(hi, d);
    }
    return [Math.ceil(lo - 1e-9) || 0, Math.floor(hi + 1e-9) || 0];
}

const number = (v: number) => {
    const r = Math.abs(v) < 1e-9 ? 0 : v;
    return r.toLocaleString('en-US', { maximumFractionDigits: Math.abs(r) >= 100 ? 1 : 2 });
};

/** What plane `i` is called: "7,300,150 N", "500,200 E", "RL 350", or how far it is from plane 0. */
export function sectionLabel(set: Pick<SectionSet, 'normal' | 'origin' | 'spacing'>, i: number): string {
    const { point } = sectionPlane(set, i);
    switch (sectionKind(set.normal)) {
        case 'we': return `${number(point[1])} N`;
        case 'sn': return `${number(point[0])} E`;
        case 'level': return `RL ${number(point[2])}`;
        default: {
            const d = i * set.spacing;
            return d === 0 ? '0 m' : `${d > 0 ? '+' : '−'}${number(Math.abs(d))} m`;
        }
    }
}

/** A plain name for a new set */
export function sectionSetName(normal: Vec3): string {
    switch (sectionKind(normal)) {
        case 'we': return 'W-E sections';
        case 'sn': return 'S-N sections';
        case 'level': return 'Level plans';
        case 'section': return `Sections on ${Math.round(sectionAzimuth(normal)!).toString().padStart(3, '0')}°`;
        default: return 'Tilted sections';
    }
}

/**
 * A set through `point` (world coordinates) with the planes square to
 * `normal`. Plane 0 is put on a round number where the planes run square to
 * an axis (a W-E set at 7,300,150 N with 50 m spacing), else through `point`.
 */
export function makeSectionSet(normal: ArrayLike<number>, point: ArrayLike<number>, spacing: number, width: number): Omit<SectionSet, 'id' | 'name'> | null {
    const n = setNormal(normal);
    if (!n || !(spacing > 0) || !(width > 0) || ![point[0], point[1], point[2]].every(Number.isFinite)) return null;
    const origin: Vec3 = [point[0], point[1], point[2]];
    const axis = n.findIndex(v => v === 1);
    if (axis >= 0) origin[axis] = Math.round(origin[axis] / spacing) * spacing;
    return { normal: n, origin, spacing, width };
}

const isVec3 = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every(x => typeof x === 'number' && Number.isFinite(x));

/** Section sets as saved, checked (a bad one is left out). */
export function readSectionSets(saved: unknown): SectionSet[] {
    const out: SectionSet[] = [];
    for (const raw of Array.isArray(saved) ? saved : []) {
        const s = raw as Partial<SectionSet> | null;
        if (!s || typeof s.id !== 'string' || !s.id || out.some(x => x.id === s.id) || !isVec3(s.normal) || !isVec3(s.origin)) continue;
        const normal = setNormal(s.normal);
        if (!normal || !(typeof s.spacing === 'number' && s.spacing > 0 && Number.isFinite(s.spacing))) continue;
        const width = typeof s.width === 'number' && s.width > 0 && Number.isFinite(s.width) ? s.width : s.spacing;
        out.push({ id: s.id, name: typeof s.name === 'string' && s.name.trim() ? s.name.trim() : sectionSetName(normal), normal, origin: [...s.origin], spacing: s.spacing, width });
        if (out.length >= MAX_SECTION_SETS) break;
    }
    return out;
}
