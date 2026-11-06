/**
 * Row-virtualised data table for the Data view.
 *
 * The MIT MUI DataGrid caps pages at 100 rows; this renders only the rows in
 * view (fixed row height), so every row of a 100k+ dataset is scrollable.
 * Rows are identified by ORIGINAL dataset index throughout.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Checkbox, Typography, useTheme } from '@mui/material';
import { ArrowDropDown, ArrowDropUp, FilterAlt, FilterAltOutlined } from '@mui/icons-material';

export interface TableColumn {
    name: string;
    label: string;
    numeric: boolean;
    editable: boolean;
}

interface Props {
    columns: TableColumn[];
    /** Original row indices to show, in display order */
    rowIndices: number[];
    getValue: (column: string, row: number) => string | number | null;
    rowColor?: (row: number) => string | undefined;
    selected: Set<number>;
    onRowClick: (row: number, e: React.MouseEvent, displayPos: number) => void;
    onToggleRow: (row: number) => void;
    onToggleAll: (checked: boolean) => void;
    onEdit: (column: string, row: number, text: string) => void;
    sort: { column: string; dir: 'asc' | 'desc' } | null;
    onSort: (column: string) => void;
    height?: number;
    /** Opens the column's filter editor (anchored to the header button) */
    onFilterClick?: (column: string, anchor: HTMLElement) => void;
    /** Columns with an active filter */
    filtered?: Set<string>;
}

const ROW_H = 28;
const OVERSCAN = 12;
const COL_W = 120;
const LEFT = [36, 64, 18]; // checkbox, row number, colour swatch

function formatValue(v: string | number | null): string {
    if (v === null || v === '') return '';
    if (typeof v === 'number') {
        if (Number.isNaN(v)) return '';
        return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(10)));
    }
    return v;
}

export const VirtualDataTable: React.FC<Props> = ({
    columns, rowIndices, getValue, rowColor, selected, onRowClick, onToggleRow, onToggleAll,
    onEdit, sort, onSort, height = 600, onFilterClick, filtered,
}) => {
    const theme = useTheme();
    const scrollRef = useRef<HTMLDivElement>(null);
    const [scrollTop, setScrollTop] = useState(0);
    const [editing, setEditing] = useState<{ row: number; column: string; text: string } | null>(null);

    // Jump back to the top when the row set changes (filters / sort)
    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
        setScrollTop(0);
    }, [rowIndices]);

    const visibleCount = Math.ceil(height / ROW_H) + OVERSCAN * 2;
    const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
    const end = Math.min(rowIndices.length, start + visibleCount);
    const totalWidth = LEFT.reduce((a, b) => a + b, 0) + columns.length * COL_W;

    const allSelected = rowIndices.length > 0 && rowIndices.every(r => selected.has(r));
    const someSelected = !allSelected && rowIndices.some(r => selected.has(r));

    const commit = useCallback(() => {
        if (editing) onEdit(editing.column, editing.row, editing.text);
        setEditing(null);
    }, [editing, onEdit]);

    const border = `1px solid ${theme.palette.divider}`;
    const cellSx = {
        width: COL_W, minWidth: COL_W, px: 1, overflow: 'hidden', textOverflow: 'ellipsis',
        whiteSpace: 'nowrap' as const, borderRight: border, lineHeight: `${ROW_H - 1}px`, fontSize: 13,
    };

    const header = useMemo(() => (
        <Box sx={{ display: 'flex', position: 'sticky', top: 0, zIndex: 2, bgcolor: 'background.paper', borderBottom: border, height: ROW_H + 4, width: totalWidth }}>
            <Box sx={{ width: LEFT[0], minWidth: LEFT[0], display: 'flex', alignItems: 'center' }}>
                <Checkbox size="small" sx={{ p: 0.5 }} checked={allSelected} indeterminate={someSelected}
                    onChange={(e) => onToggleAll(e.target.checked)} />
            </Box>
            <Box sx={{ width: LEFT[1], minWidth: LEFT[1], px: 1, fontSize: 12, fontWeight: 600, lineHeight: `${ROW_H + 4}px`, color: 'text.secondary' }}>Row</Box>
            <Box sx={{ width: LEFT[2], minWidth: LEFT[2] }} />
            {columns.map(c => (
                <Box key={c.name} onClick={() => onSort(c.name)} title={`${c.name}${c.editable ? ' (double-click a cell to edit)' : ''}`}
                    sx={{ ...cellSx, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', lineHeight: `${ROW_H + 4}px`, userSelect: 'none' }}>
                    <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.label}</Box>
                    {sort?.column === c.name && (sort.dir === 'asc' ? <ArrowDropUp fontSize="small" /> : <ArrowDropDown fontSize="small" />)}
                    {onFilterClick && (
                        <Box component="span" role="button" aria-label={`Filter ${c.label}`} title="Filter this column"
                            onClick={(e) => { e.stopPropagation(); onFilterClick(c.name, e.currentTarget as HTMLElement); }}
                            sx={{
                                ml: 'auto', pl: 0.25, display: 'flex', alignItems: 'center', cursor: 'pointer',
                                color: filtered?.has(c.name) ? 'primary.main' : 'text.disabled', '&:hover': { color: 'primary.main' },
                            }}>
                            {filtered?.has(c.name) ? <FilterAlt sx={{ fontSize: 16 }} /> : <FilterAltOutlined sx={{ fontSize: 16 }} />}
                        </Box>
                    )}
                </Box>
            ))}
        </Box>
        // eslint-disable-next-line react-hooks/exhaustive-deps -- cellSx/border derive from theme only
    ), [columns, sort, allSelected, someSelected, onToggleAll, onSort, totalWidth, theme, onFilterClick, filtered]);

    const rows = Array.from({ length: Math.max(0, end - start) }, (_, k) => {
        const pos = start + k;
        const r = rowIndices[pos];
        const isSel = selected.has(r);
        return (
            <Box key={r}
                onClick={(e) => onRowClick(r, e, pos)}
                sx={{
                    display: 'flex', position: 'absolute', top: pos * ROW_H, height: ROW_H, width: totalWidth,
                    borderBottom: border, cursor: 'default',
                    bgcolor: isSel ? 'action.selected' : pos % 2 ? 'action.hover' : 'transparent',
                }}>
                <Box sx={{ width: LEFT[0], minWidth: LEFT[0], display: 'flex', alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                    <Checkbox size="small" sx={{ p: 0.5 }} checked={isSel} onChange={() => onToggleRow(r)} />
                </Box>
                <Box sx={{ width: LEFT[1], minWidth: LEFT[1], px: 1, fontSize: 12, lineHeight: `${ROW_H - 1}px`, color: 'text.secondary' }}>{r + 1}</Box>
                <Box sx={{ width: LEFT[2], minWidth: LEFT[2], display: 'flex', alignItems: 'center' }}>
                    <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: rowColor?.(r) ?? 'transparent' }} />
                </Box>
                {columns.map(c => {
                    const isEditing = editing && editing.row === r && editing.column === c.name;
                    return (
                        <Box key={c.name}
                            onDoubleClick={c.editable ? (e) => { e.stopPropagation(); setEditing({ row: r, column: c.name, text: formatValue(getValue(c.name, r)) }); } : undefined}
                            sx={{ ...cellSx, textAlign: c.numeric ? 'right' : 'left', color: c.editable ? 'text.primary' : 'text.secondary' }}>
                            {isEditing ? (
                                <input
                                    autoFocus
                                    value={editing.text}
                                    onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                                    onBlur={commit}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') commit();
                                        else if (e.key === 'Escape') setEditing(null);
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    style={{ width: '100%', font: 'inherit', textAlign: c.numeric ? 'right' : 'left', border: 'none', outline: `1px solid ${theme.palette.primary.main}`, background: 'transparent', color: 'inherit' }}
                                />
                            ) : formatValue(getValue(c.name, r))}
                        </Box>
                    );
                })}
            </Box>
        );
    });

    return (
        <Box ref={scrollRef} onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
            sx={{ height, overflow: 'auto', border, borderRadius: 1, position: 'relative' }}>
            {header}
            <Box sx={{ position: 'relative', height: rowIndices.length * ROW_H, width: totalWidth }}>
                {rows}
            </Box>
            {rowIndices.length === 0 && (
                <Typography color="text.secondary" sx={{ p: 2 }}>No rows to show.</Typography>
            )}
        </Box>
    );
};
