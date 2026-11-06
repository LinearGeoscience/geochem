/**
 * Variable selection history (variable selector "History"): the
 * multi-column selections made in column pickers, most recent first, in the
 * order the columns were picked. Persisted per browser; a .gas file's own
 * history is merged in on import.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface VariableSelection {
    columns: string[];
    /** Optional user name ("PCA set") */
    name?: string;
    at: number;
}

export const MAX_SELECTION_HISTORY = 20;

interface VariableSelectionState {
    history: VariableSelection[];
    /** Record a selection (2+ columns); an identical list moves to the top keeping its name. */
    push: (columns: string[], name?: string) => void;
    rename: (index: number, name: string) => void;
    remove: (index: number) => void;
    /** Add selections from a file (oldest last), without moving existing ones. */
    seed: (lists: string[][]) => void;
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export const useVariableSelectionStore = create<VariableSelectionState>()(
    persist(
        (set) => ({
            history: [],
            push: (columns, name) => {
                if (columns.length < 2) return;
                set(s => {
                    const prev = s.history.find(h => sameList(h.columns, columns));
                    const entry: VariableSelection = { columns: [...columns], name: name ?? prev?.name, at: Date.now() };
                    return { history: [entry, ...s.history.filter(h => h !== prev)].slice(0, MAX_SELECTION_HISTORY) };
                });
            },
            rename: (index, name) => set(s => ({
                history: s.history.map((h, i) => (i === index ? { ...h, name: name.trim() || undefined } : h)),
            })),
            remove: (index) => set(s => ({ history: s.history.filter((_, i) => i !== index) })),
            seed: (lists) => set(s => {
                const fresh = lists
                    .filter(l => l.length >= 2 && !s.history.some(h => sameList(h.columns, l)))
                    .map((columns, i) => ({ columns, at: Date.now() - (i + 1) }));
                return { history: [...s.history, ...fresh].slice(0, MAX_SELECTION_HISTORY) };
            }),
        }),
        { name: 'variable-selection-history' },
    ),
);

/** Short label: "Ag, As, Bi, Cd … (12)" */
export function selectionLabel(sel: VariableSelection): string {
    const head = sel.columns.slice(0, 5).join(', ');
    const more = sel.columns.length > 5 ? ` … (${sel.columns.length})` : '';
    return sel.name ? `${sel.name} — ${sel.columns.length} columns` : head + more;
}
