/**
 * Combine surveys session state shared between tabs: groups the overlap
 * check found equivalent, pooled for levelling (per grouping columns), and
 * the grouping last used, so Levelling opens on the grouping just checked.
 */
import { create } from 'zustand';

/** Pooling map key: the grouping columns */
export const poolKey = (groupBy: string[]) => groupBy.join('\u0001');

interface CombineState {
    /** poolKey -> { group: pooled-with group } */
    pools: Record<string, Record<string, string>>;
    groupBy: string[] | null;
    setPool: (key: string, pool: Record<string, string> | null) => void;
    setGroupBy: (cols: string[]) => void;
}

export const useCombineStore = create<CombineState>()(set => ({
    pools: {},
    groupBy: null,
    setPool: (key, pool) => set(s => {
        const pools = { ...s.pools };
        if (pool && Object.keys(pool).length) pools[key] = pool; else delete pools[key];
        return { pools };
    }),
    setGroupBy: cols => set({ groupBy: cols }),
}));
