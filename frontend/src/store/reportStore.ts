/**
 * Report notebook (Phase 58): notes and captured figures written as the
 * interpretation progresses. Saved in the project file (.chem v8); the data
 * processing log comes from the audit store and is interleaved by time in
 * the Report view and the exported report.
 */
import { create } from 'zustand';
import type { AuditEntry } from '../types/audit';

export interface ReportNote {
    id: string;
    kind: 'note';
    created: string;
    title: string;
    text: string;
}

export interface ReportFigure {
    id: string;
    kind: 'figure';
    created: string;
    title: string;
    caption: string;
    /** PNG data URLs, one per chart in the pane */
    images: string[];
    plotId?: string;
    plotType?: string;
    /** What was shown, recorded at capture ("Colour: Lith (8 classes)", "7,950 of 8,479 rows shown") */
    context: string[];
    /** Copies written to the project's figures/ folder */
    files?: string[];
}

/** A table of text cells (e.g. the assay protocol groups) */
export interface ReportTable {
    id: string;
    kind: 'table';
    created: string;
    title: string;
    caption: string;
    columns: string[];
    rows: string[][];
}

export type ReportItem = ReportNote | ReportFigure | ReportTable;

export interface ReportData {
    title: string;
    author: string;
    items: ReportItem[];
}

interface ReportState extends ReportData {
    addNote: (title?: string, text?: string) => ReportNote;
    addFigure: (figure: Omit<ReportFigure, 'id' | 'kind' | 'created'>) => ReportFigure;
    addTable: (table: Omit<ReportTable, 'id' | 'kind' | 'created'>) => ReportTable;
    updateItem: (id: string, patch: Partial<Omit<ReportNote, 'kind'>> | Partial<Omit<ReportFigure, 'kind'>> | Partial<Omit<ReportTable, 'kind'>>) => void;
    removeItem: (id: string) => void;
    /** Move an item up (-1) or down (+1) */
    moveItem: (id: string, delta: number) => void;
    setMeta: (meta: Partial<Pick<ReportData, 'title' | 'author'>>) => void;
    setReport: (data: Partial<ReportData> | undefined) => void;
}

const newId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export const useReportStore = create<ReportState>()((set, get) => ({
    title: '',
    author: '',
    items: [],
    addNote: (title = '', text = '') => {
        const note: ReportNote = { id: newId('note'), kind: 'note', created: new Date().toISOString(), title, text };
        set(s => ({ items: [...s.items, note] }));
        return note;
    },
    addFigure: (figure) => {
        const item: ReportFigure = { ...figure, id: newId('fig'), kind: 'figure', created: new Date().toISOString() };
        set(s => ({ items: [...s.items, item] }));
        return item;
    },
    addTable: (table) => {
        const item: ReportTable = { ...table, id: newId('tab'), kind: 'table', created: new Date().toISOString() };
        set(s => ({ items: [...s.items, item] }));
        return item;
    },
    updateItem: (id, patch) => set(s => ({
        items: s.items.map(it => (it.id === id ? { ...it, ...patch } as ReportItem : it)),
    })),
    removeItem: (id) => set(s => ({ items: s.items.filter(it => it.id !== id) })),
    moveItem: (id, delta) => {
        const items = [...get().items];
        const i = items.findIndex(it => it.id === id);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= items.length) return;
        [items[i], items[j]] = [items[j], items[i]];
        set({ items });
    },
    setMeta: (meta) => set(meta),
    setReport: (data) => set({ title: data?.title ?? '', author: data?.author ?? '', items: data?.items ?? [] }),
}));

export type ReportRow = { kind: 'item'; item: ReportItem } | { kind: 'steps'; steps: AuditEntry[]; key: string };

/** Audit entries placed before the first report item created after them */
export function interleaveSteps(items: ReportItem[], audit: AuditEntry[]): ReportRow[] {
    const steps = [...audit].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    let next = 0;
    const rows: ReportRow[] = [];
    for (const item of items) {
        const before: AuditEntry[] = [];
        while (next < steps.length && steps[next].timestamp <= item.created) before.push(steps[next++]);
        if (before.length) rows.push({ kind: 'steps', steps: before, key: `s-${item.id}` });
        rows.push({ kind: 'item', item });
    }
    if (next < steps.length) rows.push({ kind: 'steps', steps: steps.slice(next), key: 's-end' });
    return rows;
}

/** Figure numbers in report order (figure id -> 1-based number) */
export function figureNumbers(items: ReportItem[]): Map<string, number> {
    const out = new Map<string, number>();
    for (const it of items) if (it.kind === 'figure') out.set(it.id, out.size + 1);
    return out;
}

/** Table numbers in report order (table id -> 1-based number) */
export function tableNumbers(items: ReportItem[]): Map<string, number> {
    const out = new Map<string, number>();
    for (const it of items) if (it.kind === 'table') out.set(it.id, out.size + 1);
    return out;
}
