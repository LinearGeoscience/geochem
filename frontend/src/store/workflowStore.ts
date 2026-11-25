/**
 * Workflows pane session state: the selected recipe, which steps have run
 * (with their results), the last step's plots (replaced by the next step by
 * default). Not persisted and not in the project: a recipe is re-run, not
 * restored.
 */
import { create } from 'zustand';
import type { StepResult } from '../utils/workflows/types';

interface WorkflowState {
    selectedId: string | null;
    /** workflow id -> step id -> result */
    done: Record<string, Record<string, StepResult>>;
    /** Plots opened by the last step that ran */
    lastStepPlotIds: string[];
    /** Close the previous step's plots when the next step opens its own */
    replacePrevious: boolean;
    /** Signature of the dataset the ticks belong to */
    datasetKey: string | null;
    select: (id: string) => void;
    markDone: (workflowId: string, stepId: string, result: StepResult) => void;
    /** Clear ticks of one workflow, or all; `datasetKey` records which dataset they now belong to */
    reset: (workflowId?: string, datasetKey?: string | null) => void;
    setReplacePrevious: (on: boolean) => void;
}

export const useWorkflowStore = create<WorkflowState>()((set) => ({
    selectedId: null,
    done: {},
    lastStepPlotIds: [],
    replacePrevious: true,
    datasetKey: null,
    select: (selectedId) => set({ selectedId }),
    markDone: (workflowId, stepId, result) => set(s => ({
        done: { ...s.done, [workflowId]: { ...(s.done[workflowId] ?? {}), [stepId]: result } },
        lastStepPlotIds: result.plotIds.length ? result.plotIds : s.lastStepPlotIds,
    })),
    reset: (workflowId, datasetKey) => set(s => ({
        done: workflowId ? { ...s.done, [workflowId]: {} } : {},
        lastStepPlotIds: [],
        ...(datasetKey !== undefined ? { datasetKey } : {}),
    })),
    setReplacePrevious: (replacePrevious) => set({ replacePrevious }),
}));
