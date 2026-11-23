/**
 * The ruler's numbers (Phase 231): what the line from one place to another
 * measures, as a geologist reads it: its length, how far it goes across and
 * up or down, and the bearing and plunge it heads along.
 */
import type { Vec3 } from './types';

export interface Measure {
    /** From end to end, m */
    length: number;
    /** Its part in plan, m */
    across: number;
    /** Its vertical part, m: above zero when the second place is the higher */
    rise: number;
    /** The bearing it heads along from the first place, degrees clockwise from north, 0-360 (null: straight up or down) */
    bearing: number | null;
    /** Degrees from level, 0-90: downwards when `rise` is below zero, upwards when above */
    plunge: number;
}

/** What the line from `a` to `b` measures (null: they are the same place, or not places) */
export function measure(a: ArrayLike<number>, b: ArrayLike<number>): Measure | null {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const length = Math.hypot(dx, dy, dz), across = Math.hypot(dx, dy);
    if (!(length > 0) || !Number.isFinite(length)) return null;
    const upright = across < 1e-9 * length;
    return {
        length, across: upright ? 0 : across, rise: dz,
        bearing: upright ? null : (((Math.atan2(dx, dy) * 180) / Math.PI) % 360 + 360) % 360,
        plunge: upright ? 90 : (Math.atan2(Math.abs(dz), across) * 180) / Math.PI,
    };
}

/** A length in metres as it is said: two places of decimals under 10 m, one under 1000 m, none beyond */
export function metres(v: number): string {
    const a = Math.abs(v);
    const places = a < 10 ? 2 : a < 1000 ? 1 : 0;
    return `${v.toLocaleString('en-US', { minimumFractionDigits: places, maximumFractionDigits: places })} m`;
}

const bearingText = (v: number) => String(Math.round(v) % 360).padStart(3, '0');

/** "214.3 m · 180.0 m across, 116.2 m down · bearing 045°, plunge 33°" */
export function measureText(m: Measure): string {
    const level = Math.abs(m.rise) < 5e-3;
    const parts = `${metres(m.across)} across, ${level ? 'level' : `${metres(Math.abs(m.rise))} ${m.rise > 0 ? 'up' : 'down'}`}`;
    const plunge = Math.round(m.plunge);
    const heading = m.bearing === null ? `straight ${m.rise > 0 ? 'up' : 'down'}`
        : level || plunge === 0 ? `bearing ${bearingText(m.bearing)}°, level`
            : `bearing ${bearingText(m.bearing)}°, ${m.rise > 0 ? 'rising' : 'plunge'} ${plunge}°`;
    return `${metres(m.length)} · ${parts} · ${heading}`;
}

/** The middle of the line (where its label goes) */
export function middle(a: ArrayLike<number>, b: ArrayLike<number>): Vec3 {
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}
