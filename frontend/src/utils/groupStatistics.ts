/**
 * Summary Statistics split by colour group: one statistic (median by
 * default) per group and variable over the visible rows, as used to turn
 * lithology groups into reference compositions (User nodes).
 */

export type GroupStat = 'median' | 'mean' | 'geomean' | 'min' | 'max' | 'p25' | 'p75' | 'count';

export const GROUP_STAT_LABELS: Record<GroupStat, string> = {
    median: 'Median', mean: 'Mean', geomean: 'Geometric mean', min: 'Minimum', max: 'Maximum',
    p25: '25th percentile', p75: '75th percentile', count: 'Count',
};

export interface GroupStatsTable {
    groups: { name: string; n: number }[];
    /** values[group][column] (null: no values) */
    values: (number | null)[][];
}

function quantile(sorted: number[], q: number): number {
    const pos = q * (sorted.length - 1);
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function statOf(values: number[], stat: GroupStat): number | null {
    if (stat === 'count') return values.length;
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    switch (stat) {
        case 'median': return quantile(sorted, 0.5);
        case 'p25': return quantile(sorted, 0.25);
        case 'p75': return quantile(sorted, 0.75);
        case 'min': return sorted[0];
        case 'max': return sorted[sorted.length - 1];
        case 'mean': return values.reduce((a, b) => a + b, 0) / values.length;
        case 'geomean': {
            const pos = values.filter(v => v > 0);
            return pos.length ? Math.exp(pos.reduce((a, v) => a + Math.log(v), 0) / pos.length) : null;
        }
    }
}

/**
 * Statistic per group (rows without a group name are left out) and column.
 * Groups keep the order of `groupOrder`, then first appearance.
 */
export function groupStatistics(
    rows: ArrayLike<number>,
    groupOf: (row: number) => string,
    columns: { name: string; values: ArrayLike<number | null> }[],
    stat: GroupStat,
    groupOrder: string[] = [],
): GroupStatsTable {
    const members = new Map<string, number[]>();
    for (const g of groupOrder) members.set(g, []);
    for (let k = 0; k < rows.length; k++) {
        const g = groupOf(rows[k]);
        if (!g) continue;
        const list = members.get(g);
        if (list) list.push(rows[k]); else members.set(g, [rows[k]]);
    }
    const groups = [...members].filter(([, r]) => r.length).map(([name, r]) => ({ name, n: r.length, rows: r }));
    return {
        groups: groups.map(({ name, n }) => ({ name, n })),
        values: groups.map(g => columns.map(c => {
            const vals: number[] = [];
            for (const r of g.rows) {
                const v = c.values[r];
                if (v != null && Number.isFinite(Number(v))) vals.push(Number(v));
            }
            return statOf(vals, stat);
        })),
    };
}

/** CSV of the table (Group, n, one column per variable) */
export function groupStatsCsv(table: GroupStatsTable, columns: string[], stat: GroupStat): string {
    const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const head = ['Group', 'n', ...columns.map(c => `${c} ${stat}`)].map(q).join(',');
    const body = table.groups.map((g, i) => [q(g.name), g.n, ...table.values[i].map(v => (v == null ? '' : +v.toPrecision(6)))].join(','));
    return [head, ...body].join('\n');
}
