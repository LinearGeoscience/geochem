/**
 * Attribute checkpoints (Home > Save/Restore Checkpoint): named
 * snapshots of the colour/shape/size/filter attributes, emphasis and value
 * filter. Saved in the project file (.chem v7).
 */
import { create } from 'zustand';
import { useAttributeStore } from './attributeStore';

export interface Checkpoint {
    id: string;
    name: string;
    created: string;
    /** attributeStore.exportState() JSON */
    state: string;
}

interface CheckpointState {
    checkpoints: Checkpoint[];
    /** Snapshot the current attributes; returns the new checkpoint */
    saveCheckpoint: (name?: string) => Checkpoint;
    /** Restore attributes from a checkpoint (false if it could not be read) */
    restoreCheckpoint: (id: string) => boolean;
    renameCheckpoint: (id: string, name: string) => void;
    removeCheckpoint: (id: string) => void;
    setCheckpoints: (list: Checkpoint[]) => void;
}

export const useCheckpointStore = create<CheckpointState>()((set, get) => ({
    checkpoints: [],
    saveCheckpoint: (name) => {
        const list = get().checkpoints;
        let k = list.length + 1;
        while (list.some(c => c.name === `Checkpoint ${k}`)) k++;
        const cp: Checkpoint = {
            id: `cp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            name: name?.trim() || `Checkpoint ${k}`,
            created: new Date().toISOString(),
            state: useAttributeStore.getState().exportState(),
        };
        set({ checkpoints: [...list, cp] });
        return cp;
    },
    restoreCheckpoint: (id) => {
        const cp = get().checkpoints.find(c => c.id === id);
        return cp ? useAttributeStore.getState().importState(cp.state) : false;
    },
    renameCheckpoint: (id, name) => set(s => ({ checkpoints: s.checkpoints.map(c => c.id === id ? { ...c, name } : c) })),
    removeCheckpoint: (id) => set(s => ({ checkpoints: s.checkpoints.filter(c => c.id !== id) })),
    setCheckpoints: (list) => set({ checkpoints: list }),
}));
