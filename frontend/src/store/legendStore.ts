/**
 * The loaded attribute legend (.gat). While one is loaded,
 * Auto-Attribute on a text column uses its colours / shapes / sizes for
 * matching group names. Persisted per browser.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Legend } from '../utils/interopLegend';

interface LegendState {
    legend: Legend | null;
    setLegend: (legend: Legend | null) => void;
}

export const useLegendStore = create<LegendState>()(
    persist(
        (set) => ({
            legend: null,
            setLegend: (legend) => set({ legend }),
        }),
        { name: 'interop-legend' },
    ),
);
