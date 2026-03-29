import { create } from 'zustand';
import { AuditEntry } from '../types/audit';

interface AuditState {
    entries: AuditEntry[];
    recordAudit: (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void;
    clearAudit: () => void;
    setEntries: (entries: AuditEntry[]) => void;
}

export const useAuditStore = create<AuditState>()((set) => ({
    entries: [],

    recordAudit: (entry) => {
        const fullEntry: AuditEntry = {
            ...entry,
            id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestamp: new Date().toISOString(),
        };
        set((state) => ({ entries: [...state.entries, fullEntry] }));
    },

    clearAudit: () => set({ entries: [] }),

    setEntries: (entries) => set({ entries }),
}));
