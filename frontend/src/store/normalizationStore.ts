/**
 * User spider normalisations loaded from diagram XML files ("Open
 * normalisation…"). Persisted per browser; ids start with "file:".
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { FileNormalization } from '../utils/spiderProfiles';

interface NormalizationState {
    userNormalizations: FileNormalization[];
    /** Add or replace (same id) */
    addNormalizations: (list: FileNormalization[]) => void;
    removeNormalization: (id: string) => void;
}

export const useNormalizationStore = create<NormalizationState>()(
    persist(
        (set) => ({
            userNormalizations: [],
            addNormalizations: (list) => set(s => ({
                userNormalizations: [...s.userNormalizations.filter(n => !list.some(l => l.id === n.id)), ...list],
            })),
            removeNormalization: (id) => set(s => ({ userNormalizations: s.userNormalizations.filter(n => n.id !== id) })),
        }),
        { name: 'user-normalizations' },
    ),
);
