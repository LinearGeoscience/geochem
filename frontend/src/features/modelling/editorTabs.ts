/**
 * The tabs an editor in the properties is laid out in, and the one that is
 * open: kept for the session, so that going from one surface to the next
 * stays on the same tab, and so that other parts of the page (the tree, the
 * setup steps) can open an editor on the tab that matters.
 */
import { create } from 'zustand';
import type { ModelGroupPart } from '../model/objectKeys';
import { t } from '../model/terms';

/** The tabs of a surface's editor */
export const SURFACE_TABS = ['inputs', 'surfacing', 'trend', 'outputs'] as const;
export type SurfaceTab = (typeof SURFACE_TABS)[number];

/** What each is called, and what is found under it */
export const SURFACE_TAB_NAME: Record<SurfaceTab, { label: string; tip: string }> = {
    inputs: { label: 'Inputs', tip: 'What it is made from: logging, the points and lines placed for it with their dip measurements and directions, the sets it uses' },
    surfacing: { label: 'Surfacing', tip: 'How it is fitted: its smoothing (how closely it follows its points), its extent, its resolution, its sides' },
    trend: { label: 'Trend', tip: 'How it lies: whether it follows the global trend and the structural measurements set for the model' },
    outputs: { label: 'Outputs', tip: 'Outputs and checks: how well it honours its points, the columns it writes, its mesh, its Leapfrog export' },
};

/** The tabs of a geological model's editor */
export const MODEL_TABS = ['lithologies', 'boundary', 'chronology', 'faults', 'outputs'] as const;
export type ModelTab = (typeof MODEL_TABS)[number];

export const MODEL_TAB_NAME: Record<ModelTab, { label: string; tip: string }> = {
    lithologies: { label: t('tabLithologies'), tip: 'The units it is made of: the grouping of logged codes it reads, and its background lithology (the ground everything else is in)' },
    boundary: { label: t('tabBoundary'), tip: 'The ground the model covers: its box, its topography, an outline, and its resolution (the size of its cells)' },
    chronology: { label: t('tabChronology'), tip: 'Its surfaces in order of age, the youngest at the top: what each is, and which side of it is the younger' },
    faults: { label: t('tabFaults'), tip: 'The faults that cut it into blocks' },
    outputs: { label: t('tabOutputs'), tip: 'Outputs and checks: the volume of each unit, how well it agrees with the logging, its export' },
};

/** The tab each part of a model in the tree is under */
export const MODEL_TAB_OF: Record<ModelGroupPart, ModelTab> = { boundary: 'boundary', lithologies: 'lithologies', faults: 'faults', chronology: 'chronology', volumes: 'outputs' };

interface EditorTabs {
    surface: SurfaceTab;
    setSurfaceTab: (tab: SurfaceTab) => void;
    model: ModelTab;
    setModelTab: (tab: ModelTab) => void;
}

export const useEditorTabs = create<EditorTabs>(set => ({
    surface: 'inputs',
    setSurfaceTab: surface => set({ surface }),
    model: 'lithologies',
    setModelTab: model => set({ model }),
}));
