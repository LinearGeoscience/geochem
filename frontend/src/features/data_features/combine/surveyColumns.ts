/**
 * Columns the Combine surveys tools work with: assay columns (element /
 * oxide, numeric, one per element — unit twins left out) and grouping
 * columns ordered by usefulness: assay protocol columns (newest first), then
 * lab method / batch columns, then sample-medium columns, then other text.
 */
import { useMemo } from 'react';
import { useAppStore } from '../../../store/appStore';
import { isNumericColumn } from '../../../types/columnarData';
import { censorableColumns } from '../../../utils/censoring';
import { findDuplicateUnitColumns } from '../../../utils/calculations/elementColumnResolver';
import { rankBatchColumns } from '../../../utils/halfDetection';
import { rankStratumColumns } from '../../../utils/groupLabels';
import { protocolColumns, protocolSummaryOf } from '../../../utils/protocolSplit';
import { useCombineStore } from './combineStore';

export interface GroupOption { name: string; kind: 'protocol' | 'method' | 'medium' | 'text'; values: number }

export const KIND_LABEL: Record<GroupOption['kind'], string> = {
    protocol: 'assay protocols', method: 'lab method / batch', medium: 'sample medium', text: 'text',
};

/**
 * Grouping a tab opens on: the one last used in another tab, else the most
 * useful column plus the sample medium (unless it is already split by medium).
 */
export function initialGroupBy(columns: Parameters<typeof protocolSummaryOf>[0], options: GroupOption[]): string[] {
    const shared = useCombineStore.getState().groupBy;
    if (shared?.length && shared.every(c => options.some(o => o.name === c))) return shared;
    const first = options[0];
    if (!first) return [];
    // A protocol column made within a medium already separates media
    const madeWithin = first.kind === 'protocol' && !!protocolSummaryOf(columns, first.name)?.stratumColumn;
    const medium = options.find(o => o.kind === 'medium')?.name;
    return [first.name, ...(!madeWithin && first.kind !== 'medium' && medium ? [medium] : [])];
}

export function useSurveyColumns() {
    const columns = useAppStore(s => s.columns);
    const columnarData = useAppStore(s => s.columnarData);
    const mappings = useAppStore(s => s.geochemMappings);

    const assayColumns = useMemo(() => {
        const censorable = censorableColumns(mappings);
        const twins = new Set(findDuplicateUnitColumns(mappings, n => {
            const c = columnarData.columns.get(n);
            return c instanceof Float64Array ? c : undefined;
        }).map(t => t.column));
        return columns.filter(c => {
            const col = columnarData.columns.get(c.name);
            return censorable.has(c.name) && !twins.has(c.name) && !!col && isNumericColumn(col);
        }).map(c => c.name);
    }, [columns, mappings, columnarData]);

    const groupOptions = useMemo((): GroupOption[] => {
        const get = (n: string) => columnarData.columns.get(n);
        const seen = new Set<string>();
        const out: GroupOption[] = [];
        const push = (name: string, kind: GroupOption['kind'], values: number) => {
            if (seen.has(name)) return;
            seen.add(name);
            out.push({ name, kind, values });
        };
        const distinct = (n: string) => {
            const col = get(n);
            if (!col) return 0;
            const s = new Set<string>();
            for (let i = 0; i < col.length && s.size <= 5000; i++) s.add(col[i] == null ? '' : String(col[i]));
            return s.size;
        };
        for (const p of [...protocolColumns(columns)].reverse()) push(p, 'protocol', distinct(p));
        for (const b of rankBatchColumns(columns, get, 2000)) if (b.score > 0) push(b.name, 'method', b.groups);
        for (const m of rankStratumColumns(columns, get)) if (m.score >= 2) push(m.name, 'medium', m.groups);
        for (const b of rankBatchColumns(columns, get, 2000)) push(b.name, 'text', b.groups);
        return out;
    }, [columns, columnarData]);

    return { columns, columnarData, mappings, assayColumns, groupOptions };
}
