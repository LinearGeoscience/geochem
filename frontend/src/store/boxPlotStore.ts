/**
 * Box plot (Analysis tab) settings, kept while switching tabs and settable
 * from outside the component (command finder, tutorial runner).
 */
import { create } from 'zustand';

export interface BoxPlotSettings {
    numericColumns: string[];
    categoryColumn: string;
    showViolin: boolean;
    showPoints: boolean;
    logScale: boolean;
    showNotches: boolean;
    orientation: 'v' | 'h';
    showMean: boolean;
    categorySort: 'alpha' | 'asc' | 'desc';
    showCrust: boolean;
    refValue: string;
    /** Several variables by group: one panel (own value axis) per variable */
    panels: boolean;
}

interface BoxPlotState extends BoxPlotSettings {
    set: (patch: Partial<BoxPlotSettings>) => void;
}

export const useBoxPlotStore = create<BoxPlotState>()((set) => ({
    numericColumns: [],
    categoryColumn: '',
    showViolin: false,
    showPoints: false,
    logScale: false,
    showNotches: false,
    orientation: 'v',
    showMean: true,
    categorySort: 'alpha',
    showCrust: false,
    refValue: '',
    panels: true,
    set: (patch) => set(patch),
}));
