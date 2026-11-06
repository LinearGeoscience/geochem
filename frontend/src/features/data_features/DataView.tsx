import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Public } from '@mui/icons-material';
import { Box, Paper, Typography, Button, FormControlLabel, Switch, TextField, Chip, Menu, MenuItem, InputAdornment, Divider, ListItemText } from '@mui/material';
import { Download, Functions, MedicalServices, Search, ArrowDropDown, FilterAltOff, Category, MergeType } from '@mui/icons-material';
import { mergeSelection } from '../../hooks/useSelectionHandler';
import {
    applyFilters, useDataFilterStore, detectDateColumn, parseDateColumn, filterKindFor, describeFilter,
    DateDetection, FilterKind,
} from './dataFilters';
import { ColumnFilterPopover } from './ColumnFilterPopover';
import { useUIStore } from '../../store/uiStore';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../store/appStore';
import { useAuditStore } from '../../store/auditStore';
import { notify } from '../../store/notificationStore';
import { isNumericColumn } from '../../types/columnarData';
import { getStyleArraysColumnar } from '../../utils/attributeUtils';
import { VirtualDataTable, TableColumn } from './VirtualDataTable';
import { isEditableColumn, sortRowIndices, applyCellEdit } from './dataViewHelpers';
import { useFillHeight } from '../../hooks/useFillHeight';
import { useStyleInputs } from '../../hooks/useStyleInputs';

/**
 * Data view: every row scrollable (row-virtualised), coloured by the
 * Attribute Manager, linked two-way with the global selection, filterable to
 * the selection / visible rows, sortable, and editable for raw columns.
 *
 * Values are shown exactly as stored: below-detection values appear as -DL
 * (standard convention), not the substituted value used in analysis.
 *
 * `embedded`: compact chrome for a dock pane; the table fills the pane.
 */
export const DataView: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
    // In a pane: table height = what's left below the toolbar
    const { ref: tableRef, height: tableHeight } = useFillHeight<HTMLDivElement>(600, 160, 8);
    const { columns, rowCount, columnarData, selectedIndices, setSelection, getAnalyticalStore } = useAppStore(useShallow(s => ({
        columns: s.columns, rowCount: s.columnarData.rowCount, columnarData: s.columnarData,
        selectedIndices: s.selectedIndices, setSelection: s.setSelection, getAnalyticalStore: s.getAnalyticalStore,
    })));
    const getColumn = useAppStore(s => s.getRawColumn);
    const attributeStyleState = useStyleInputs();

    const [selectedOnly, setSelectedOnly] = useState(false);
    const [visibleOnly, setVisibleOnly] = useState(false);
    const [sort, setSort] = useState<{ column: string; dir: 'asc' | 'desc' } | null>(null);

    const selectedSet = useMemo(() => new Set(selectedIndices), [selectedIndices]);

    // --- filters ---------------------------------------------------------------
    const { filters, search, setFilter, setSearch, clearAll } = useDataFilterStore();
    const [filterTarget, setFilterTarget] = useState<{ column: string; anchor: HTMLElement } | null>(null);
    const [selMenu, setSelMenu] = useState<HTMLElement | null>(null);

    // Date columns, recognised from their values (backend types are numeric/text only)
    const dateInfo = useMemo(() => {
        const out = new Map<string, DateDetection>();
        for (const c of columns) {
            if (!c?.name) continue;
            const det = detectDateColumn(getColumn(c.name), c.role);
            if (det.isDate) out.set(c.name, det);
        }
        return out;
    }, [columns, columnarData, getColumn]); // eslint-disable-line react-hooks/exhaustive-deps -- columnarData = dataset version
    // Parsed dates, made on first use for this dataset version
    const dateCache = useMemo(() => new Map<string, Float64Array>(), [columnarData]); // eslint-disable-line react-hooks/exhaustive-deps
    const getDates = useCallback((name: string) => {
        const det = dateInfo.get(name);
        const col = getColumn(name);
        if (!det || !col) return undefined;
        let d = dateCache.get(name);
        if (!d) { d = parseDateColumn(col, det); dateCache.set(name, d); }
        return d;
    }, [dateInfo, dateCache, getColumn]);

    // Filters on columns that no longer exist are ignored
    const activeFilters = useMemo(() => {
        const names = new Set(columns.map(c => c?.name));
        return Object.fromEntries(Object.entries(filters).filter(([n]) => names.has(n)));
    }, [filters, columns]);
    const filteredSet = useMemo(() => new Set(Object.keys(activeFilters)), [activeFilters]);
    const searchColumns = useMemo(() => columns
        .filter(c => c?.name && !(c.type === 'numeric' || c.type === 'float' || c.type === 'integer'))
        .map(c => c.name), [columns]);
    const filterKind = useCallback((name: string): FilterKind =>
        filterKindFor(getColumn(name), dateInfo.get(name) ?? { isDate: false, dayFirst: true }), [getColumn, dateInfo]);

    // Attribute colours / visibility for every row (analytical values, as plots use)
    const styles = useMemo(() => {
        if (rowCount === 0) return null;
        void attributeStyleState; // read inside getStyleArraysColumnar
        const store = getAnalyticalStore();
        return getStyleArraysColumnar(rowCount, (name) => store.columns.get(name));
    }, [rowCount, columnarData, getAnalyticalStore, attributeStyleState]); // eslint-disable-line react-hooks/exhaustive-deps -- columnarData = dataset version

    // Rows to show, in display order
    const rowIndices = useMemo(() => {
        let rows: number[];
        if (selectedOnly) rows = [...selectedIndices].sort((a, b) => a - b);
        else rows = Array.from({ length: rowCount }, (_, i) => i);
        if (visibleOnly && styles) rows = rows.filter(i => styles.visible[i]);
        rows = applyFilters(rows, activeFilters, { getColumn, getDates }, { text: search, columns: searchColumns });
        // Date columns sort by date, not by text
        if (sort) rows = sortRowIndices(rows, getDates(sort.column) ?? getColumn(sort.column), sort.dir);
        return rows;
    }, [rowCount, selectedOnly, selectedIndices, visibleOnly, styles, sort, getColumn, getDates, activeFilters, search, searchColumns]);

    const selectShown = useCallback((mode: 'replace' | 'add' | 'subtract') => {
        setSelection(mergeSelection(selectedIndices, rowIndices, mode).sort((a, b) => a - b));
        setSelMenu(null);
    }, [rowIndices, selectedIndices, setSelection]);
    const invertSelection = useCallback(() => {
        const out: number[] = [];
        for (let i = 0; i < rowCount; i++) if (!selectedSet.has(i)) out.push(i);
        setSelection(out);
        setSelMenu(null);
    }, [rowCount, selectedSet, setSelection]);
    const filtering = filteredSet.size > 0 || !!search.trim();

    const tableColumns: TableColumn[] = useMemo(() => columns
        .filter(c => c && c.name)
        .map(c => ({
            name: c.name,
            label: c.alias || c.name,
            numeric: c.type === 'numeric' || c.type === 'float' || c.type === 'integer',
            editable: isEditableColumn(c),
        })), [columns]);

    const getValue = useCallback((column: string, row: number) => {
        const col = getColumn(column);
        return col ? col[row] : null;
    }, [getColumn]);

    const rowColor = useCallback((row: number) => styles?.colors[row], [styles]);

    // --- selection (two-way with the global selection) -----------------------
    const lastClicked = useRef<number | null>(null);
    const onRowClick = useCallback((row: number, e: React.MouseEvent, displayPos: number) => {
        if (e.shiftKey && lastClicked.current !== null) {
            const a = Math.min(lastClicked.current, displayPos), b = Math.max(lastClicked.current, displayPos);
            const range = rowIndices.slice(a, b + 1);
            setSelection(Array.from(new Set([...selectedIndices, ...range])).sort((x, y) => x - y));
        } else if (e.ctrlKey || e.metaKey) {
            setSelection(selectedSet.has(row) ? selectedIndices.filter(i => i !== row) : [...selectedIndices, row].sort((x, y) => x - y));
            lastClicked.current = displayPos;
        } else {
            setSelection([row]);
            lastClicked.current = displayPos;
        }
    }, [rowIndices, selectedIndices, selectedSet, setSelection]);

    const onToggleRow = useCallback((row: number) => {
        setSelection(selectedSet.has(row) ? selectedIndices.filter(i => i !== row) : [...selectedIndices, row].sort((a, b) => a - b));
    }, [selectedIndices, selectedSet, setSelection]);

    const onToggleAll = useCallback((checked: boolean) => {
        if (checked) setSelection(Array.from(new Set([...selectedIndices, ...rowIndices])).sort((a, b) => a - b));
        else {
            const shown = new Set(rowIndices);
            setSelection(selectedIndices.filter(i => !shown.has(i)));
        }
    }, [rowIndices, selectedIndices, setSelection]);

    const onSort = useCallback((column: string) => {
        setSort(prev => prev?.column !== column ? { column, dir: 'asc' }
            : prev.dir === 'asc' ? { column, dir: 'desc' } : null);
    }, []);

    // --- editing -------------------------------------------------------------
    const onEdit = useCallback((columnName: string, row: number, text: string) => {
        const info = useAppStore.getState().columns.find(c => c.name === columnName);
        const col = getColumn(columnName);
        if (!info || !col || !isEditableColumn(info)) return;
        const before = col[row];
        const values = applyCellEdit(col, row, text);
        if (!values) {
            notify(`"${text}" is not a number (use e.g. 1.5, <0.01 or >10000)`, 'warning');
            return;
        }
        if (values[row] === before || (values[row] === null && typeof before === 'number' && Number.isNaN(before))) return;
        useAppStore.getState().updateColumnValues(columnName, values);
        useAuditStore.getState().recordAudit({
            category: 'column-operation',
            operation: 'Edit Cell',
            description: `Edited ${columnName} at row ${row + 1}: ${formatAudit(before)} → ${formatAudit(values[row])}`,
            parameters: { row, column: columnName, from: formatAudit(before), to: formatAudit(values[row]) },
            inputColumns: [columnName],
            outputColumns: [columnName],
            rowsAffected: 1,
        });
    }, [getColumn]);

    // Export data to CSV — read columns directly, no row materialization
    const handleExportCSV = useCallback(() => {
        if (rowCount === 0 || !columns.length) return;

        const columnNames = columns.filter(c => c && c.name).map(c => c.name);
        const csvRows: string[] = [];

        // Header row
        csvRows.push(columnNames.map(name => `"${name.replace(/"/g, '""')}"`).join(','));

        const colArrays = columnNames.map(name => getColumn(name));
        for (let i = 0; i < rowCount; i++) {
            const values = colArrays.map(col => {
                if (!col) return '';
                if (isNumericColumn(col)) {
                    const v = col[i];
                    return isNaN(v) ? '' : String(v);
                }
                const v = col[i];
                return v ? `"${String(v).replace(/"/g, '""')}"` : '';
            });
            csvRows.push(values.join(','));
        }

        const csvContent = csvRows.join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `geochem_export_${new Date().toISOString().slice(0, 10)}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }, [columns, rowCount, getColumn]);

    return (
        <Paper
            elevation={embedded ? 0 : undefined}
            square={embedded}
            sx={{ height: '100%', width: '100%', p: embedded ? 0.75 : 2, ...(embedded ? { bgcolor: 'background.default' } : {}) }}
        >
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: embedded ? 0.5 : 1, flexWrap: 'wrap', gap: 1 }}>
                {!embedded && (
                    <Typography variant="h6">
                        Data Table
                    </Typography>
                )}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                    <FormControlLabel
                        control={<Switch size="small" checked={selectedOnly} onChange={e => setSelectedOnly(e.target.checked)} />}
                        label={`Selected only (${selectedIndices.length.toLocaleString()})`}
                    />
                    <FormControlLabel
                        control={<Switch size="small" checked={visibleOnly} onChange={e => setVisibleOnly(e.target.checked)} />}
                        label="Visible only"
                    />
                    <Typography variant="body2" color="text.secondary">
                        <strong>{rowIndices.length.toLocaleString()}</strong> of {rowCount.toLocaleString()} rows | <strong>{columns.length}</strong> columns
                    </Typography>
                    <Button
                        variant="outlined"
                        size="small"
                        startIcon={<MedicalServices />}
                        onClick={() => useUIStore.getState().setDataDoctorOpen(true)}
                        disabled={rowCount === 0}
                    >
                        Data Doctor
                    </Button>
                    <Button
                        variant="outlined"
                        size="small"
                        startIcon={<Category />}
                        onClick={() => useUIStore.getState().setAssayProtocolsOpen(true)}
                        disabled={rowCount === 0}
                    >
                        Assay protocols
                    </Button>
                    <Button
                        variant="outlined"
                        size="small"
                        startIcon={<MergeType />}
                        onClick={() => useUIStore.getState().setCombineSurveys('levelling')}
                        disabled={rowCount === 0}
                    >
                        Combine surveys
                    </Button>
                    <Button
                        variant="outlined"
                        size="small"
                        startIcon={<Functions />}
                        onClick={() => useUIStore.getState().setCalculateColumns({})}
                        disabled={rowCount === 0}
                    >
                        Calculate Columns
                    </Button>
                    <Button
                        variant="outlined"
                        size="small"
                        startIcon={<Download />}
                        onClick={handleExportCSV}
                        disabled={rowCount === 0}
                    >
                        Export CSV
                    </Button>
                    <Button
                        variant="outlined"
                        size="small"
                        startIcon={<Public />}
                        onClick={() => useUIStore.getState().setGisOpen(true)}
                        disabled={rowCount === 0}
                    >
                        GIS
                    </Button>
                </Box>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75, flexWrap: 'wrap' }}>
                <TextField
                    size="small" placeholder="Search text columns" value={search}
                    onChange={e => setSearch(e.target.value)}
                    sx={{ width: 220 }}
                    InputProps={{ startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> }}
                />
                {Object.entries(activeFilters).map(([name, f]) => (
                    <Chip key={name} size="small" color="primary" variant="outlined"
                        label={describeFilter(columns.find(c => c.name === name)?.alias || name, f)}
                        onClick={(e) => setFilterTarget({ column: name, anchor: e.currentTarget })}
                        onDelete={() => setFilter(name, null)} />
                ))}
                {filtering && (
                    <Button size="small" startIcon={<FilterAltOff />} onClick={clearAll}>Clear filters</Button>
                )}
                <Button size="small" variant="outlined" endIcon={<ArrowDropDown />} onClick={e => setSelMenu(e.currentTarget)}
                    disabled={rowCount === 0} sx={{ ml: 'auto' }}>
                    Selection
                </Button>
                <Menu anchorEl={selMenu} open={!!selMenu} onClose={() => setSelMenu(null)}>
                    <MenuItem onClick={() => selectShown('replace')}>
                        <ListItemText primary={`Select shown rows (${rowIndices.length.toLocaleString()})`} secondary="Replace the selection with the rows listed" />
                    </MenuItem>
                    <MenuItem onClick={() => selectShown('add')}>
                        <ListItemText primary="Add shown rows to selection" />
                    </MenuItem>
                    <MenuItem onClick={() => selectShown('subtract')}>
                        <ListItemText primary="Remove shown rows from selection" />
                    </MenuItem>
                    <Divider />
                    <MenuItem onClick={invertSelection}><ListItemText primary="Invert selection" /></MenuItem>
                    <MenuItem onClick={() => { setSelection([]); setSelMenu(null); }} disabled={!selectedIndices.length}>
                        <ListItemText primary="Clear selection" />
                    </MenuItem>
                </Menu>
            </Box>
            <Box ref={tableRef}>
            <VirtualDataTable
                columns={tableColumns}
                rowIndices={rowIndices}
                getValue={getValue}
                rowColor={rowColor}
                selected={selectedSet}
                onRowClick={onRowClick}
                onToggleRow={onToggleRow}
                onToggleAll={onToggleAll}
                onEdit={onEdit}
                sort={sort}
                onSort={onSort}
                height={tableHeight}
                onFilterClick={(column, anchor) => setFilterTarget({ column, anchor })}
                filtered={filteredSet}
            />
            {filterTarget && (
                <ColumnFilterPopover
                    key={filterTarget.column}
                    anchorEl={filterTarget.anchor}
                    onClose={() => setFilterTarget(null)}
                    column={filterTarget.column}
                    label={columns.find(c => c.name === filterTarget.column)?.alias || filterTarget.column}
                    kind={filterKind(filterTarget.column)}
                    col={getColumn(filterTarget.column)}
                    dates={getDates(filterTarget.column)}
                    value={activeFilters[filterTarget.column]}
                    onApply={(f) => setFilter(filterTarget.column, f)}
                />
            )}
            </Box>
            {!embedded && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                Click a row to select it (Ctrl toggles, Shift selects a range) — selections are shared with every plot.
                Double-click a cell in a raw column to edit it; below-detection values show as stored (e.g. −0.01 = &lt;0.01). Click a header to sort;
                use its funnel to filter (numbers, categories, text or dates), then Selection → Select shown rows.
            </Typography>}
        </Paper>
    );
};

function formatAudit(v: unknown): string {
    if (v === null || v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v))) return '(blank)';
    return String(v);
}
