/**
 * User nodes (Mineral and Rock Nodes > User): compositions saved from
 * group medians in Summary statistics or imported from a node CSV.
 * Persisted per browser; ids start with "user:".
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { NodeDef } from '../utils/nodeLibrary';

interface UserNodeState {
    nodes: NodeDef[];
    /** Add or replace (same id) */
    addNodes: (nodes: NodeDef[]) => void;
    removeNode: (id: string) => void;
    removeGroup: (group: string) => void;
}

export const useUserNodeStore = create<UserNodeState>()(
    persist(
        (set) => ({
            nodes: [],
            addNodes: (list) => set(s => ({ nodes: [...s.nodes.filter(n => !list.some(l => l.id === n.id)), ...list] })),
            removeNode: (id) => set(s => ({ nodes: s.nodes.filter(n => n.id !== id) })),
            removeGroup: (group) => set(s => ({ nodes: s.nodes.filter(n => n.group !== group) })),
        }),
        { name: 'user-nodes' },
    ),
);
