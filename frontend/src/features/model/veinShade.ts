/**
 * A vein's mesh coloured by how thick it is at each place (vein.ts,
 * `veinThickness`): one hue, pale where it is thin and dark where it is
 * thick, over the range most of it lies in. Worked out once for a mesh and
 * kept with it.
 */
import type { FittedField } from './rbf';
import { veinThickness } from './vein';

/** Pale to dark, as the legend draws it (sRGB) */
export const SHADE_RAMP = ['#e3eef9', '#a9cdea', '#5fa3d6', '#2a71b5', '#0b3f7e'] as const;

/** The range runs between these shares of the mesh's places, so that one thick spot does not flatten the rest */
const LOW = 0.02, HIGH = 0.98;

export interface Shade {
    /** Red, green and blue of each vertex, 0 to 1, as the renderer wants them (linear, not sRGB) */
    colors: Float32Array;
    /** What the palest and the darkest colour stand for, m */
    low: number;
    high: number;
}

const RAMP = SHADE_RAMP.map(hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255));
const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** The colour at a share of the way up the ramp (0 to 1), linear */
export function rampColor(t: number): [number, number, number] {
    const at = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0)) * (RAMP.length - 1);
    const i = Math.min(RAMP.length - 2, Math.floor(at)), w = at - i;
    return [0, 1, 2].map(k => linear(RAMP[i][k] + w * (RAMP[i + 1][k] - RAMP[i][k]))) as [number, number, number];
}

/** The colours of a set of thicknesses (NaN: the palest), and the range they span */
export function shadeOf(thickness: ArrayLike<number>): Shade | null {
    const known = Array.from(thickness).filter(Number.isFinite).sort((a, b) => a - b);
    if (known.length === 0) return null;
    const low = known[Math.floor(LOW * (known.length - 1))], high = known[Math.ceil(HIGH * (known.length - 1))];
    const colors = new Float32Array(thickness.length * 3);
    for (let i = 0; i < thickness.length; i++) {
        const t = thickness[i];
        colors.set(rampColor(!Number.isFinite(t) ? 0 : high > low ? (t - low) / (high - low) : 0.5), i * 3);
    }
    return { colors, low, high };
}

const kept = new WeakMap<object, { field: FittedField; shade: Shade | null }>();

/** A vein's mesh by its thickness (null: it is no vein, or is nowhere there) */
export function thicknessShade(part: { vertices: Float64Array }, field: FittedField | null | undefined): Shade | null {
    if (!field?.walls || part.vertices.length === 0) return null;
    let k = kept.get(part);
    if (!k || k.field !== field) {
        k = { field, shade: shadeOf(veinThickness(field, part.vertices)) };
        kept.set(part, k);
    }
    return k.shade;
}
