/**
 * Classify-by-rules sheets: the one being edited plus named saved sets
 * (persisted; also saved / loaded as .json files).
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ClassRule, RuleSet } from '../utils/ruleClassifier';

interface RuleSetState {
    rules: ClassRule[];
    name: string;
    saved: RuleSet[];
    setRules: (rules: ClassRule[]) => void;
    setName: (name: string) => void;
    save: () => void;
    load: (set: RuleSet) => void;
    remove: (name: string) => void;
}

export const useRuleSetStore = create<RuleSetState>()(
    persist(
        (set, get) => ({
            rules: [],
            name: 'Alteration rules',
            saved: [],
            setRules: (rules) => set({ rules }),
            setName: (name) => set({ name }),
            save: () => {
                const { name, rules, saved } = get();
                const n = name.trim() || 'Rules';
                set({ saved: [...saved.filter(s => s.name !== n), { name: n, rules }] });
            },
            load: (rs) => set({ name: rs.name, rules: rs.rules.map(r => ({ ...r, conditions: r.conditions.map(c => ({ ...c })) })) }),
            remove: (name) => set({ saved: get().saved.filter(s => s.name !== name) }),
        }),
        { name: 'rule-sets' },
    ),
);
