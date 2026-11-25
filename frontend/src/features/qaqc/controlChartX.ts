/**
 * X positions for a control chart: the sequence number (default), or the
 * value of a dataset column at each point's row. A column of dates / times
 * ("2026-11-03 10:22:15", "03/11/2026 10:22", ISO) gives a time axis, which
 * shows drift over the shift and the gaps between sessions that a sequence
 * number hides. Points are returned in x order.
 */

export interface ChartX {
    /** Point indices in plotting order */
    order: number[];
    /** x per point in `order` */
    x: Array<number | string>;
    kind: 'sequence' | 'number' | 'date';
}

const DMY = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

/** A cell as an ISO timestamp, or null. Day-first for d/m/yyyy (Australian convention). */
export function parseDateTime(v: unknown): string | null {
    if (v === null || v === undefined || typeof v === 'number') return null;
    const s = String(v).trim();
    if (!s) return null;
    const m = DMY.exec(s);
    if (m) {
        const [, d, mo, y, h = '0', mi = '0', se = '0'] = m;
        const t = Date.UTC(+y, +mo - 1, +d, +h, +mi, +se);
        return Number.isFinite(t) ? new Date(t).toISOString().replace('Z', '') : null;
    }
    if (!/^\d{4}-\d{1,2}-\d{1,2}/.test(s)) return null;
    const t = Date.parse(s.replace(' ', 'T').replace(/Z$/, '') + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? '' : 'Z'));
    return Number.isFinite(t) ? new Date(t).toISOString().replace('Z', '') : null;
}

export function controlChartX(rowIndices: number[], column: ArrayLike<unknown> | null): ChartX {
    const n = rowIndices.length;
    if (!column) return { order: [...Array(n).keys()], x: rowIndices.map((_, i) => i + 1), kind: 'sequence' };
    const raw = rowIndices.map(r => column[r]);
    const dates = raw.map(parseDateTime);
    const nDates = dates.filter(Boolean).length;
    const nums = raw.map(v => (typeof v === 'number' && Number.isFinite(v) ? v : null));
    const nNums = nums.filter(v => v !== null).length;
    if (!nDates && !nNums) return { order: [...Array(n).keys()], x: rowIndices.map((_, i) => i + 1), kind: 'sequence' };
    const kind = nDates >= nNums ? 'date' : 'number';
    const vals: Array<number | string | null> = kind === 'date' ? dates : nums;
    const order = [...Array(n).keys()].filter(i => vals[i] !== null)
        .sort((a, b) => (vals[a]! < vals[b]! ? -1 : vals[a]! > vals[b]! ? 1 : a - b));
    return { order, x: order.map(i => vals[i]!), kind };
}
