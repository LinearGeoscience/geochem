/**
 * UI preferences (Phase 9): theme mode, persisted across sessions.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PresetKind } from '../utils/calculateColumns';

export type ThemeMode = 'light' | 'dark';

interface UIState {
    themeMode: ThemeMode;
    setThemeMode: (mode: ThemeMode) => void;
    toggleThemeMode: () => void;
    /** Columns picked recently in any column picker, most recent first (max 8). */
    recentColumns: string[];
    pushRecentColumn: (name: string) => void;
    /** Plot drag tool shared by all plots (L/B/Z/P). */
    dragMode: DragMode;
    setDragMode: (mode: DragMode) => void;
    /** Check GitHub for a newer GeoChem version at start-up (Settings > Updates) */
    updateCheckEnabled: boolean;
    setUpdateCheckEnabled: (enabled: boolean) => void;
    /** Session-only (not persisted). */
    newPlotDialogOpen: boolean;
    setNewPlotDialogOpen: (open: boolean) => void;
    dataDoctorOpen: boolean;
    setDataDoctorOpen: (open: boolean) => void;
    /** Assay protocols dialog (Data > Assay protocols) */
    assayProtocolsOpen: boolean;
    setAssayProtocolsOpen: (open: boolean) => void;
    /** Combine surveys dialog: open tab, or null when closed */
    combineSurveys: CombineSurveysTab | null;
    setCombineSurveys: (tab: CombineSurveysTab | null) => void;
    /** Calculate Columns dialog request (null = closed) */
    calculateColumns: CalculateColumnsRequest | null;
    setCalculateColumns: (request: CalculateColumnsRequest | null) => void;
    /** Analysis view tab (AnalysisNav index) */
    analysisTab: number;
    setAnalysisTab: (tab: number) => void;
    gisOpen: boolean;
    setGisOpen: (open: boolean) => void;
    /** Classify by rules / Compare classifications dialogs */
    rulesOpen: boolean;
    setRulesOpen: (open: boolean) => void;
    compareOpen: boolean;
    /** Reference column to preselect when opening Compare classifications */
    compareReference: string | null;
    setCompareOpen: (open: boolean, reference?: string | null) => void;
    /** menu command finder (Ctrl+K) */
    commandFinderOpen: boolean;
    setCommandFinderOpen: (open: boolean) => void;
    /** Attribute class under the pointer: its rows are highlighted in every plot (session only) */
    hoveredClass: { tab: 'color' | 'shape' | 'size' | 'filter'; id: string } | null;
    setHoveredClass: (c: { tab: 'color' | 'shape' | 'size' | 'filter'; id: string } | null) => void;
    /** Attribute Manager: classify bar / display section expanded */
    classifyOpen: boolean;
    setClassifyOpen: (open: boolean) => void;
    displayOpen: boolean;
    setDisplayOpen: (open: boolean) => void;
}

/** Tabs of the Combine surveys dialog */
export type CombineSurveysTab = 'overlap' | 'levelling' | 'commonDl';

export interface CalculateColumnsRequest {
    preset?: PresetKind | 'weighted';
    columns?: string[];
}

export type DragMode = 'lasso' | 'select' | 'zoom' | 'pan';

export const MAX_RECENT_COLUMNS = 8;

export const useUIStore = create<UIState>()(
    persist(
        (set) => ({
            themeMode: 'light',
            setThemeMode: (mode) => set({ themeMode: mode }),
            toggleThemeMode: () => set((s) => ({ themeMode: s.themeMode === 'light' ? 'dark' : 'light' })),
            recentColumns: [],
            pushRecentColumn: (name) => set((s) => ({
                recentColumns: [name, ...s.recentColumns.filter(n => n !== name)].slice(0, MAX_RECENT_COLUMNS),
            })),
            dragMode: 'lasso',
            setDragMode: (dragMode) => set({ dragMode }),
            updateCheckEnabled: true,
            setUpdateCheckEnabled: (updateCheckEnabled) => set({ updateCheckEnabled }),
            newPlotDialogOpen: false,
            setNewPlotDialogOpen: (newPlotDialogOpen) => set({ newPlotDialogOpen }),
            dataDoctorOpen: false,
            setDataDoctorOpen: (dataDoctorOpen) => set({ dataDoctorOpen }),
            assayProtocolsOpen: false,
            setAssayProtocolsOpen: (assayProtocolsOpen) => set({ assayProtocolsOpen }),
            combineSurveys: null,
            setCombineSurveys: (combineSurveys) => set({ combineSurveys }),
            calculateColumns: null,
            setCalculateColumns: (calculateColumns) => set({ calculateColumns }),
            analysisTab: 0,
            setAnalysisTab: (analysisTab) => set({ analysisTab }),
            gisOpen: false,
            setGisOpen: (gisOpen) => set({ gisOpen }),
            rulesOpen: false,
            setRulesOpen: (rulesOpen) => set({ rulesOpen }),
            compareOpen: false,
            compareReference: null,
            setCompareOpen: (compareOpen, reference = null) => set({ compareOpen, compareReference: reference }),
            commandFinderOpen: false,
            setCommandFinderOpen: (commandFinderOpen) => set({ commandFinderOpen }),
            hoveredClass: null,
            setHoveredClass: (hoveredClass) => set((s) => (
                s.hoveredClass?.id === hoveredClass?.id && s.hoveredClass?.tab === hoveredClass?.tab ? s : { hoveredClass }
            )),
            classifyOpen: true,
            setClassifyOpen: (classifyOpen) => set({ classifyOpen }),
            displayOpen: false,
            setDisplayOpen: (displayOpen) => set({ displayOpen }),
        }),
        {
            name: 'ui-storage',
            partialize: (s) => ({
                themeMode: s.themeMode, recentColumns: s.recentColumns, dragMode: s.dragMode,
                classifyOpen: s.classifyOpen, displayOpen: s.displayOpen, updateCheckEnabled: s.updateCheckEnabled,
            }),
        }
    )
);
