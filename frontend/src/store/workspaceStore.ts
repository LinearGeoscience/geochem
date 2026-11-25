/**
 * Dock workspace layout (Phase 29). `layout` mirrors the live dock (written
 * by the Workspace on every layout change, debounced) and is saved with the
 * project. `applyLayout` replaces it from outside (project load, layout
 * template, reset) and bumps `revision` so a mounted Workspace reloads.
 */
import { create } from 'zustand';
import type { SerializedLayout } from '../utils/workspaceLayout';

interface WorkspaceState {
    layout: SerializedLayout | null;
    revision: number;
    /** Written by the Workspace itself; does not trigger a reload. */
    setLayout: (layout: SerializedLayout | null) => void;
    /** Replace the layout from outside (null = default layout). */
    applyLayout: (layout: SerializedLayout | null) => void;
    resetLayout: () => void;
    /** Plot whose tab is being renamed inline (F2 / double-click). */
    renamingPlotId: string | null;
    setRenamingPlotId: (id: string | null) => void;
    /** Plot whose Graph properties dialog is open */
    propertiesPlotId: string | null;
    setPropertiesPlotId: (id: string | null) => void;
}

export const useWorkspaceStore = create<WorkspaceState>()((set) => ({
    layout: null,
    revision: 0,
    setLayout: (layout) => set({ layout }),
    applyLayout: (layout) => set(s => ({ layout, revision: s.revision + 1 })),
    resetLayout: () => set(s => ({ layout: null, revision: s.revision + 1 })),
    renamingPlotId: null,
    setRenamingPlotId: (renamingPlotId) => set({ renamingPlotId }),
    propertiesPlotId: null,
    setPropertiesPlotId: (propertiesPlotId) => set({ propertiesPlotId }),
}));
