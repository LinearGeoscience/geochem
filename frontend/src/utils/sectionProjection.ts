/**
 * Vertical cross-section through drillhole samples: project desurveyed
 * East / North / Elevation onto a section line (origin + azimuth) and keep the
 * samples within a slab either side of it. Coordinates stay float64 (UTM
 * northings need it). Distance along the section grows in the azimuth
 * direction; offset is positive to the right of that direction (azimuth + 90).
 */

export interface SectionLine {
    originE: number;
    originN: number;
    /** Degrees clockwise from north */
    azimuth: number;
    /** Samples further than this from the plane (metres) are left out */
    halfWidth: number;
}

export interface SectionProjection {
    /** Original row index of each sample in the slab */
    rows: number[];
    along: number[];
    elev: number[];
    offset: number[];
    /** Samples with coordinates that fall outside the slab */
    outside: number;
    /** Samples without usable East / North / Elevation */
    missing: number;
}

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Along-section distance and signed offset of one point. */
export function projectPoint(e: number, n: number, line: Pick<SectionLine, 'originE' | 'originN' | 'azimuth'>): { along: number; offset: number } {
    const a = rad(line.azimuth);
    const de = e - line.originE, dn = n - line.originN;
    return {
        along: de * Math.sin(a) + dn * Math.cos(a),
        offset: de * Math.cos(a) - dn * Math.sin(a),
    };
}

/** Project the given rows (all rows when omitted) onto the section. */
export function projectSection(
    east: ArrayLike<unknown>, north: ArrayLike<unknown>, elev: ArrayLike<unknown>,
    line: SectionLine, rows?: ArrayLike<number>,
): SectionProjection {
    const out: SectionProjection = { rows: [], along: [], elev: [], offset: [], outside: 0, missing: 0 };
    const count = rows ? rows.length : east.length;
    for (let k = 0; k < count; k++) {
        const i = rows ? rows[k] : k;
        const e = Number(east[i]), n = Number(north[i]), z = Number(elev[i]);
        if (east[i] == null || north[i] == null || elev[i] == null || !Number.isFinite(e) || !Number.isFinite(n) || !Number.isFinite(z)) { out.missing++; continue; }
        const p = projectPoint(e, n, line);
        if (Math.abs(p.offset) > line.halfWidth) { out.outside++; continue; }
        out.rows.push(i);
        out.along.push(p.along);
        out.elev.push(z);
        out.offset.push(p.offset);
    }
    return out;
}

/**
 * Section line fitted to the points: through their mean, along their longest
 * horizontal direction (principal axis), azimuth in [0, 180). Half width:
 * a tenth of the spread across that direction's perpendicular, at least 10 m.
 */
export function fitSectionLine(east: ArrayLike<unknown>, north: ArrayLike<unknown>, rows?: ArrayLike<number>): SectionLine | null {
    let n = 0, me = 0, mn = 0;
    const count = rows ? rows.length : east.length;
    const at = (k: number) => (rows ? rows[k] : k);
    for (let k = 0; k < count; k++) {
        const e = Number(east[at(k)]), no = Number(north[at(k)]);
        if (east[at(k)] == null || north[at(k)] == null || !Number.isFinite(e) || !Number.isFinite(no)) continue;
        n++; me += (e - me) / n; mn += (no - mn) / n;
    }
    if (n < 2) return null;
    let see = 0, snn = 0, sen = 0;
    for (let k = 0; k < count; k++) {
        const e = Number(east[at(k)]), no = Number(north[at(k)]);
        if (east[at(k)] == null || north[at(k)] == null || !Number.isFinite(e) || !Number.isFinite(no)) continue;
        const de = e - me, dn = no - mn;
        see += de * de; snn += dn * dn; sen += de * dn;
    }
    // Principal axis angle from east (counter-clockwise), converted to azimuth from north
    const theta = 0.5 * Math.atan2(2 * sen, see - snn);
    let azimuth = 90 - (theta * 180) / Math.PI;
    azimuth = ((azimuth % 180) + 180) % 180;
    // Spread perpendicular to the line (minor-axis standard deviation)
    const tr = see + snn, det = see * snn - sen * sen;
    const minor = Math.max(0, tr / 2 - Math.sqrt(Math.max(0, (tr * tr) / 4 - det)));
    const halfWidth = Math.max(10, Math.round(Math.sqrt(minor / n) / 2));
    return { originE: me, originN: mn, azimuth: Math.round(azimuth * 10) / 10, halfWidth };
}

/**
 * Hole traces on the section: for each hole the in-slab samples in down-hole
 * order (by depth when given, else row order), with a gap (null) where the
 * hole leaves the slab between samples.
 */
export function holeTraces(
    proj: SectionProjection, holes: ArrayLike<unknown>, depth?: ArrayLike<unknown>,
): { hole: string; x: (number | null)[]; y: (number | null)[] }[] {
    const byHole = new Map<string, number[]>();
    proj.rows.forEach((row, k) => {
        const h = holes[row];
        if (h === null || h === undefined || h === '') return;
        const key = String(h);
        const l = byHole.get(key);
        if (l) l.push(k); else byHole.set(key, [k]);
    });
    const order = (k: number) => {
        const v = depth ? Number(depth[proj.rows[k]]) : NaN;
        return Number.isFinite(v) ? v : proj.rows[k];
    };
    const out: { hole: string; x: (number | null)[]; y: (number | null)[] }[] = [];
    for (const [hole, ks] of byHole) {
        if (ks.length < 2) continue;
        ks.sort((a, b) => order(a) - order(b) || proj.rows[a] - proj.rows[b]);
        // A down-hole step well above the hole's usual spacing = the hole left the slab
        const steps = ks.slice(1).map((k, j) => order(k) - order(ks[j])).sort((a, b) => a - b);
        const usual = steps[Math.floor(steps.length / 2)] || 1;
        const x: (number | null)[] = [], y: (number | null)[] = [];
        ks.forEach((k, j) => {
            if (j > 0 && order(k) - order(ks[j - 1]) > 3 * usual) { x.push(null); y.push(null); }
            x.push(proj.along[k]); y.push(proj.elev[k]);
        });
        out.push({ hole, x, y });
    }
    return out;
}

/** "045°" style label. */
export const bearing = (az: number) => `${String(Math.round(((az % 360) + 360) % 360)).padStart(3, '0')}°`;
