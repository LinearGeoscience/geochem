/**
 * Default coordinate / hole columns for the 3D viewer: the role first, then
 * the column name. Older projects carry wrong roles (e.g. "mid_x" and
 * "holeid" saved with the generic ID role by the pre-Phase-12 detector), so
 * names matter: mid_x / X / Easting / CollarEast / x_coord, holeid / BHID ...
 */
interface ColumnLike { name: string; type: string; role: string | null }

const NUMERIC = new Set(['numeric', 'float', 'integer']);

const AXIS_ROLE = { x: 'East', y: 'North', z: 'Elevation' } as const;
const AXIS_WORDS = {
    x: ['x', 'east', 'easting', 'eastings', 'utme', 'xcoord'],
    y: ['y', 'north', 'northing', 'northings', 'utmn', 'ycoord'],
    z: ['z', 'rl', 'elev', 'elevation', 'zcoord', 'altitude'],
} as const;

function tokens(name: string): string[] {
    return name
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean)
        .map(t => t.toLowerCase());
}

/** Best column for an axis, or '' if none looks right. */
export function guessAxisColumn(columns: ColumnLike[], axis: 'x' | 'y' | 'z'): string {
    const numeric = columns.filter(c => NUMERIC.has(c.type));
    const byRole = numeric.filter(c => c.role === AXIS_ROLE[axis]);
    // Prefer sample positions over collar positions when both have the role
    const sample = byRole.find(c => !/collar/i.test(c.name));
    if (sample) return sample.name;
    if (byRole[0]) return byRole[0].name;

    const words: readonly string[] = AXIS_WORDS[axis];
    const scored = numeric
        .map(c => {
            const t = tokens(c.name);
            const last = t[t.length - 1];
            let score = 0;
            if (t.length === 1 && words.includes(t[0])) score = 4;          // "X", "Easting"
            else if (words.includes(last)) score = 3;                      // "mid_x", "nat_east"
            else if (t.some(w => words.includes(w) && w.length > 1)) score = 2;
            if (t.includes('collar')) score -= 1;                          // sample position first
            return { name: c.name, score };
        })
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score);
    return scored[0]?.name ?? '';
}

/** Hole identifier column for drillhole traces. */
export function guessHoleColumn(columns: ColumnLike[]): string | null {
    const byRole = columns.find(c => c.role === 'HoleID');
    if (byRole) return byRole.name;
    const byName = columns.find(c => {
        const t = tokens(c.name).join('');
        return t === 'holeid' || t === 'bhid' || t === 'dhid' || t === 'hole' || t === 'holename' || t === 'holenumber';
    });
    return byName?.name ?? null;
}

/** Depth column ordering samples down a hole (From, else Depth / mid depth). */
export function guessDepthColumn(columns: ColumnLike[]): string | null {
    const numeric = columns.filter(c => NUMERIC.has(c.type));
    const byRole = numeric.find(c => c.role === 'From') ?? numeric.find(c => c.role === 'Depth');
    if (byRole) return byRole.name;
    const byName = numeric.find(c => {
        const t = tokens(c.name);
        return t[0] === 'from' || t.includes('depth') || (t.includes('mid') && t.includes('depth'));
    });
    return byName?.name ?? null;
}
