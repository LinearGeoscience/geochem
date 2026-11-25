/**
 * Shared pieces of the method panels (element QC, variation matrix, sequence
 * tools, mass change, score vs target, variable screening, supervised
 * models): column access with analytical (below-detection substituted) or
 * raw values, a visible-rows mask, the sample-order settings every
 * order-aware method shares, and adding results as columns / report tables.
 */
import { create } from 'zustand';
import { useAppStore, useAnalyticalStore } from '../../../store/appStore';
import { useReportStore } from '../../../store/reportStore';
import { getStyleArraysColumnar, getColumnDisplayName } from '../../../utils/attributeUtils';
import { isNumericColumn } from '../../../types/columnarData';
import type { ColumnDerivation } from '../../../store/appStore';
import { trailingNumber } from '../../../utils/statistics/sequence';
import { useStyleInputs } from '../../../hooks/useStyleInputs';

/** Sample-order settings shared by the order-aware methods */
interface SequenceSettings {
    holeColumn: string;
    positionColumn: string;
    maxGap: string;
    set: (patch: Partial<Omit<SequenceSettings, 'set'>>) => void;
}

export const useSequenceSettings = create<SequenceSettings>(set => ({
    holeColumn: '',
    positionColumn: '',
    maxGap: '',
    set: patch => set(patch),
}));

/** Columns and values for the method panels */
export function useMethodData() {
    const columns = useAppStore(s => s.columns);
    const raw = useAppStore(s => s.columnarData);
    const store = useAnalyticalStore();
    useStyleInputs(); // re-render when visibility changes
    const rowCount = raw.rowCount;
    const numericColumns = columns.filter(c => { const d = raw.columns.get(c.name); return !!d && isNumericColumn(d); }).map(c => c.name);
    const textColumns = columns.filter(c => { const d = raw.columns.get(c.name); return !!d && !isNumericColumn(d); }).map(c => c.name);
    /** Analytical values (below detection substituted per Settings); null when not numeric */
    const values = (name: string): Float64Array | null => {
        const c = store.columns.get(name);
        return c && isNumericColumn(c) ? c : null;
    };
    /** Values as stored (-DL for below detection) */
    const rawValues = (name: string): Float64Array | null => {
        const c = raw.columns.get(name);
        return c && isNumericColumn(c) ? c : null;
    };
    const text = (name: string): ArrayLike<unknown> | null => (name ? raw.columns.get(name) ?? null : null);
    const visibleMask = (): Uint8Array => {
        const styles = getStyleArraysColumnar(rowCount, n => raw.columns.get(n));
        return Uint8Array.from(styles.visible, v => (v ? 1 : 0));
    };
    const display = (name: string) => getColumnDisplayName(columns, name);
    return { columns, rowCount, numericColumns, textColumns, values, rawValues, text, visibleMask, display };
}

/** Position along the sequence for every row: numeric column as is, text IDs by their trailing number */
export function positionValues(data: ReturnType<typeof useMethodData>, name: string): Float64Array | null {
    if (!name) return null;
    const num = data.rawValues(name);
    if (num) return num;
    const t = data.text(name);
    if (!t) return null;
    return Float64Array.from({ length: t.length }, (_, i) => trailingNumber(t[i]));
}

/** The order options for sequence methods, from the shared settings */
export function sequenceOptions(data: ReturnType<typeof useMethodData>, s: Pick<SequenceSettings, 'holeColumn' | 'positionColumn' | 'maxGap'>) {
    const gap = parseFloat(s.maxGap);
    return {
        groups: s.holeColumn ? data.text(s.holeColumn) : null,
        position: positionValues(data, s.positionColumn),
        maxGap: Number.isFinite(gap) ? gap : null,
    };
}

/** Row indices in sequence order (hole, then position), optionally only rows passing a mask */
export function sequenceOrder(data: ReturnType<typeof useMethodData>, s: Pick<SequenceSettings, 'holeColumn' | 'positionColumn' | 'maxGap'>, mask?: Uint8Array | null): number[] {
    const { groups, position } = sequenceOptions(data, s);
    const idx: number[] = [];
    for (let i = 0; i < data.rowCount; i++) {
        if (mask && !mask[i]) continue;
        if (position && !Number.isFinite(position[i])) continue;
        idx.push(i);
    }
    const key = (v: unknown) => (v === null || v === undefined ? '' : String(v));
    return idx.sort((a, b) => {
        if (groups) { const ga = key(groups[a]), gb = key(groups[b]); if (ga !== gb) return ga < gb ? -1 : 1; }
        return position ? position[a] - position[b] || a - b : a - b;
    });
}

/** Add a numeric result column (role Calculated, so it is never read as an element) */
export function addResultColumn(name: string, values: ArrayLike<number>, description: string, params: Record<string, unknown>): string | null {
    const derivation: ColumnDerivation = { kind: 'other', description, params, created: new Date().toISOString() };
    return useAppStore.getState().addColumn(name, Array.from(values, v => (Number.isFinite(v) ? v : null)), 'numeric', 'Calculated', null, undefined, derivation, 'unique');
}

/** Add a text result column (role Classification) */
export function addTextColumn(name: string, values: ArrayLike<string>, description: string, params: Record<string, unknown>): string | null {
    const derivation: ColumnDerivation = { kind: 'other', description, params, created: new Date().toISOString() };
    return useAppStore.getState().addColumn(name, Array.from(values), 'categorical', 'Classification', null, undefined, derivation, 'unique');
}

export function addReportTable(title: string, caption: string, columns: string[], rows: (string | number)[][]) {
    useReportStore.getState().addTable({ title, caption, columns, rows: rows.map(r => r.map(v => (typeof v === 'number' ? fmt(v) : v))) });
}

/** Compact number for tables */
export function fmt(v: number, digits = 3): string {
    if (!Number.isFinite(v)) return '–';
    const a = Math.abs(v);
    if (a !== 0 && (a >= 1e5 || a < 1e-3)) return v.toExponential(2);
    return String(+v.toPrecision(digits));
}

/** Text group of each row ('' for blank) */
export function groupLabels(col: ArrayLike<unknown> | null, n: number): string[] {
    return Array.from({ length: n }, (_, i) => (col ? String(col[i] ?? '') : ''));
}
