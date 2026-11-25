/**
 * Assay protocols (Data > Assay protocols): group samples by element suite
 * and detection limits so probability plots and PCA can treat each protocol
 * on its own. Shows the evidence (DLs per group, mixed-DL warnings), then
 * adds a protocol column, colours by it, opens split probability plots, or
 * keeps one group visible for PCA ("Use filtered data"). The Chart tab, Show
 * the split (protocol pane + map + probability plots) and Add to report
 * (method text, group table, figures) show how the data was split.
 */
import React, { useDeferredValue, useMemo, useState } from 'react';
import {
    Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, Tab, Tabs,
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import { WarningAmber } from '@mui/icons-material';
import { useAppStore } from '../../store/appStore';
import { useUIStore } from '../../store/uiStore';
import { useAuditStore } from '../../store/auditStore';
import { useAttributeStore } from '../../store/attributeStore';
import { notify } from '../../store/notificationStore';
import { isNumericColumn } from '../../types/columnarData';
import { censorableColumns } from '../../utils/censoring';
import { configureTab } from '../../utils/attributeClassify';
import { findHalfDlSpikesWithGroups, rankBatchColumns } from '../../utils/halfDetection';
import { findDuplicateUnitColumns } from '../../utils/calculations/elementColumnResolver';
import { detectProtocols, describeDls, protocolLabels, ProtocolColumn, ProtocolGroup } from '../../utils/assayProtocols';
import { rankStratumColumns } from '../../utils/groupLabels';
import { MultiColumnSelector } from '../../components/MultiColumnSelector';
import Plot from '../../components/ThemedPlot';
import {
    compositionCounts, protocolComposition, protocolMatrix, summariseProtocols, ProtocolSummary,
} from '../../utils/protocolFigures';
import { addProtocolSplitToReport, protocolSummaryOf, showProtocolSplit } from '../../utils/protocolSplit';

const PLOT_CONFIG = { displaylogo: false, responsive: true } as const;

const MAX_DL_COLUMNS = 8;

export const AssayProtocolDialog: React.FC = () => {
    const open = useUIStore(s => s.assayProtocolsOpen);
    const setOpen = useUIStore(s => s.setAssayProtocolsOpen);
    return open ? <AssayProtocolBody onClose={() => setOpen(false)} /> : null;
};

const AssayProtocolBody: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const columns = useAppStore(s => s.columns);
    const columnarData = useAppStore(s => s.columnarData);
    const mappings = useAppStore(s => s.geochemMappings);
    const rowCount = columnarData.rowCount;

    // Element / oxide assay columns
    const assayColumns = useMemo(() => {
        const censorable = censorableColumns(mappings);
        return columns.filter(c => { const col = columnarData.columns.get(c.name); return censorable.has(c.name) && !!col && isNumericColumn(col); });
    }, [columns, mappings, columnarData]);
    // The same measurement in another unit (Cu_pct beside Cu_ppm) is left out: each element counts once
    const twins = useMemo(() => findDuplicateUnitColumns(mappings, n => {
        const c = columnarData.columns.get(n);
        return c instanceof Float64Array ? c : undefined;
    }), [mappings, columnarData]);
    const [selected, setSelected] = useState<string[]>(() => {
        const skip = new Set(twins.map(t => t.column));
        return assayColumns.map(c => c.name).filter(n => !skip.has(n));
    });

    // Batch / method candidates (text, 2–2000 distinct values), lab methods first
    const batchOptions = useMemo(() => rankBatchColumns(columns, n => columnarData.columns.get(n), 2000)
        .map(o => ({ name: o.name, groups: o.groups, suggested: o.score > 0 })), [columns, columnarData]);
    const suggestion = batchOptions.find(b => b.suggested);
    const [batchColumn, setBatchColumn] = useState('');
    // Sample medium: groups are made within each (soil, stream, rock chip never mix)
    const stratumOptions = useMemo(() => rankStratumColumns(columns, n => columnarData.columns.get(n))
        .map(o => ({ name: o.name, groups: o.groups, suggested: o.score >= 2 })), [columns, columnarData]);
    const stratumSuggestion = stratumOptions.find(o => o.suggested);
    const [stratumColumn, setStratumColumn] = useState('');
    // Blank = automatic: 1 % of the rows (of each medium), at least 20
    const [minSize, setMinSize] = useState('');

    const params = useDeferredValue({ selected, batchColumn, stratumColumn, minSize });
    const analysis = useMemo(() => {
        const halfDlColumns: string[] = [];
        const batch = params.batchColumn ? columnarData.columns.get(params.batchColumn) : undefined;
        const strata = params.stratumColumn ? columnarData.columns.get(params.stratumColumn) : undefined;
        const cols: ProtocolColumn[] = params.selected.flatMap(name => {
            const values = columnarData.columns.get(name);
            if (!values || !isNumericColumn(values)) return [];
            // Clear-cut ½DL values (whole column, or within one batch) reveal the limit;
            // uncertain ones may be results at the limit and are not used
            const spikes = findHalfDlSpikesWithGroups(values, batch).filter(sp => sp.confidence === 'high');
            if (spikes.length) halfDlColumns.push(name);
            return [{ name, values, ...(spikes.length ? { halfDl: spikes.map(s => ({ value: s.value, dl: s.dl, group: s.group })) } : {}) }];
        });
        if (!cols.length) return null;
        const min = parseInt(params.minSize, 10);
        const result = detectProtocols({
            columns: cols, rowCount,
            batch: batch as ArrayLike<unknown> | undefined,
            strata: strata as ArrayLike<unknown> | undefined,
            minGroupSize: Number.isFinite(min) && min > 0 ? min : undefined,
        });
        return { result, halfDlColumns, minGroupSize: Number.isFinite(min) && min > 0 ? min : null };
    }, [params, columnarData, rowCount]);

    const result = analysis?.result;
    const dlColumns = useMemo(() => (result?.discriminating ?? []).slice(0, MAX_DL_COLUMNS), [result]);
    const anyMixed = !!result?.groups.some(g => g.mixedDl.length);

    const [name, setName] = useState('AssayProtocol');
    const [made, setMade] = useState<string | null>(null);
    const exists = columns.some(c => c.name === name.trim());
    const [tab, setTab] = useState(0);
    const [breakdown, setBreakdown] = useState<string | null>(null);
    const summaryFor = (column: string): ProtocolSummary | null => (result && analysis ? summariseProtocols(result, {
        column, batchColumn: params.batchColumn || null, stratumColumn: params.stratumColumn || null, rowCount, columns: params.selected,
        twinsLeftOut: twins.map(t => t.column).filter(c => !params.selected.includes(c)),
        halfDlColumns: analysis.halfDlColumns, minGroupSize: analysis.minGroupSize,
    }) : null);
    const preview = useMemo(() => (tab === 1 ? summaryFor(name.trim() || 'AssayProtocol') : null),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [tab, result]);
    const by = breakdown ?? (batchColumn || stratumColumn);
    const charts = useMemo(() => {
        if (!preview || !result) return null;
        const labels = protocolLabels(result, rowCount);
        const byValues = by ? columnarData.columns.get(by) ?? null : null;
        return { matrix: protocolMatrix(preview), composition: protocolComposition(preview, compositionCounts(labels, byValues), by || null) };
    }, [preview, result, rowCount, by, columnarData]);
    const textColumns = useMemo(() => columns.filter(c => {
        const col = columnarData.columns.get(c.name);
        return !!col && !isNumericColumn(col);
    }).map(c => c.name), [columns, columnarData]);

    const addColumn = () => {
        if (!result || !name.trim()) return;
        const col = name.trim();
        const store = useAppStore.getState();
        store.addColumn(col, protocolLabels(result, rowCount), 'categorical', 'Classification', null, undefined, {
            kind: 'classification',
            description: `Assay protocol groups by element suite${batchColumn ? ` and the detection limits of each ${batchColumn}` : ''}${stratumColumn ? `, within each ${stratumColumn}` : ''}`,
            params: {
                columns: selected, batchColumn: batchColumn || null, stratumColumn: stratumColumn || null,
                groups: result.groups.map(g => ({ name: g.name, rows: g.rows.length, mixedDl: g.mixedDl })),
                protocolSummary: summaryFor(col),
            },
            created: new Date().toISOString(),
        });
        useAuditStore.getState().recordAudit({
            category: 'column-operation',
            operation: 'Assay protocols',
            description: `${col}: ${result.groups.length} protocol groups (${result.groups.slice(0, 8).map(g => `${g.name} ${g.rows.length}`).join('; ')}${result.groups.length > 8 ? `; ${result.groups.length - 8} more` : ''})`,
            parameters: { batchColumn: batchColumn || null, stratumColumn: stratumColumn || null, minGroupSize: minSize || 'auto' },
            inputColumns: [...selected, ...(batchColumn ? [batchColumn] : []), ...(stratumColumn ? [stratumColumn] : [])],
            outputColumns: [col],
            rowsAffected: rowCount,
        });
        notify(`Added ${col} (${result.groups.length} groups)`, 'success');
        setMade(col);
    };

    const colourBy = () => {
        if (!made) return;
        configureTab('color', { field: made });
        notify(`Samples coloured by ${made}`, 'success');
    };

    const splitProbability = () => {
        if (!made || !result) return;
        configureTab('color', { field: made });
        const cols = (dlColumns.length ? dlColumns : selected).slice(0, 8);
        const app = useAppStore.getState();
        app.addPlot('probability', { settings: { selectedColumns: cols, splitByColour: true, valueScale: 'log' }, title: `Probability by ${made}` });
        app.setCurrentView('plots');
        notify(`Probability plots of ${cols.length} columns, split by ${made}`, 'success');
    };

    const showSplit = () => {
        if (!made || !result) return;
        const ids = showProtocolSplit(made, dlColumns.length ? dlColumns : selected);
        notify(`${ids.length} panes show how the samples were split by ${made}`, 'success');
        onClose();
    };

    const toReport = async () => {
        if (!made) return;
        const summary = protocolSummaryOf(useAppStore.getState().columns, made);
        if (!summary) return;
        onClose();
        const figures = await addProtocolSplitToReport(summary);
        notify(`Report: method note, group table and ${figures} figure${figures === 1 ? '' : 's'} added`, 'success');
    };

    const isolateGroup = (g: ProtocolGroup) => {
        if (!made) return;
        configureTab('filter', { field: made });
        const attr = useAttributeStore.getState();
        attr.setEntries('filter', attr.filter.entries.map(e => ({ ...e, visible: !e.isDefault && e.categoryValue === g.name })));
        notify(`Only ${g.name} is visible (${g.rows.length.toLocaleString()} rows). PCA → "Use filtered data" now runs on this group.`, 'success');
    };

    return (
        <Dialog open onClose={onClose} maxWidth="lg" fullWidth>
            <DialogTitle>Assay protocols</DialogTitle>
            <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Typography variant="body2" color="text.secondary">
                    Samples analysed differently (another element suite or detection limits) form false populations when mixed.
                    Groups are made from the elements each sample has, then split by detection limit — which shows only where a
                    value is below detection, so a batch / lab method column gives the cleanest split.
                </Typography>
                <MultiColumnSelector
                    columns={assayColumns.map(c => ({ name: c.name, alias: c.alias, priority: c.priority }))}
                    selectedColumns={selected}
                    onChange={setSelected}
                    label="Assay columns"
                />
                <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
                    <TextField select size="small" sx={{ minWidth: 260 }} label="Batch / lab method column" value={batchColumn}
                        onChange={e => setBatchColumn(e.target.value)}>
                        <MenuItem value="">(none)</MenuItem>
                        {batchOptions.map(b => (
                            <MenuItem key={b.name} value={b.name}>{b.name} ({b.groups} values){b.suggested ? ' · suggested' : ''}</MenuItem>
                        ))}
                    </TextField>
                    {!batchColumn && suggestion && (
                        <Button size="small" onClick={() => setBatchColumn(suggestion.name)}>Use {suggestion.name}</Button>
                    )}
                    <TextField select size="small" sx={{ minWidth: 220 }} label="Within (sample medium)" value={stratumColumn}
                        onChange={e => setStratumColumn(e.target.value)}>
                        <MenuItem value="">(all samples together)</MenuItem>
                        {stratumOptions.map(o => (
                            <MenuItem key={o.name} value={o.name}>{o.name} ({o.groups} values){o.suggested ? ' · suggested' : ''}</MenuItem>
                        ))}
                    </TextField>
                    {!stratumColumn && stratumSuggestion && (
                        <Button size="small" onClick={() => setStratumColumn(stratumSuggestion.name)}>Within {stratumSuggestion.name}</Button>
                    )}
                    <TextField size="small" sx={{ width: 150 }} label="Smallest group" value={minSize}
                        onChange={e => setMinSize(e.target.value)} placeholder="auto" InputLabelProps={{ shrink: true }}
                        helperText={`smaller suites merge; auto = 1 % of the ${stratumColumn ? "medium's " : ''}rows`} />
                </Stack>

                {!result ? (
                    <Alert severity="info">Pick at least one assay column.</Alert>
                ) : (
                    <>
                        {analysis!.halfDlColumns.length > 0 && (
                            <Alert severity="info">
                                ½-DL values were read as detection limits in {analysis!.halfDlColumns.length} column(s) ({analysis!.halfDlColumns.slice(0, 4).join(', ')}
                                {analysis!.halfDlColumns.length > 4 ? ', …' : ''}). Convert them in the Data Doctor so the BDL setting applies.
                            </Alert>
                        )}
                        {anyMixed && (
                            <Alert severity="warning">
                                Some groups hold more than one detection limit for an element (highlighted). {batchColumn
                                    ? 'These may be re-assays, or batches that mix methods.'
                                    : 'Choose a batch / lab method column to split them.'}
                            </Alert>
                        )}
                        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ minHeight: 36, '& .MuiTab-root': { minHeight: 36 } }}>
                            <Tab label={`Groups (${result.groups.length})`} />
                            <Tab label="Chart" />
                        </Tabs>
                        {tab === 1 && charts && (
                            <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1, maxHeight: 520, overflow: 'auto' }}>
                                <Plot data={charts.matrix.data} layout={charts.matrix.layout} config={{ displaylogo: false }} />
                                <TextField select size="small" label="Break groups down by" value={by} onChange={e => setBreakdown(e.target.value)} sx={{ minWidth: 240, m: 1 }}>
                                    <MenuItem value="">(samples only)</MenuItem>
                                    {textColumns.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                                </TextField>
                                <Plot data={charts.composition.data} layout={{ ...charts.composition.layout, autosize: true }} config={PLOT_CONFIG} style={{ width: '100%' }} useResizeHandler />
                            </Box>
                        )}
                        {tab === 0 && (
                        <TableContainer sx={{ maxHeight: 380, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                            <Table size="small" stickyHeader>
                                <TableHead>
                                    <TableRow>
                                        <TableCell>Group</TableCell>
                                        <TableCell align="right">Rows</TableCell>
                                        <TableCell align="right">Elements</TableCell>
                                        {dlColumns.map(c => <TableCell key={c} align="right">{c} DL</TableCell>)}
                                        {batchColumn && <TableCell>Batches</TableCell>}
                                        <TableCell />
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {result.groups.map(g => (
                                        <TableRow key={g.name} hover>
                                            <TableCell sx={{ fontWeight: 500, whiteSpace: 'nowrap' }}>
                                                {g.name}
                                                {g.mixedDl.length > 0 && (
                                                    <Tooltip title={`Several DLs: ${g.mixedDl.map(c => describeDls(c, g.dls[c])).join('; ')}`}>
                                                        <WarningAmber fontSize="inherit" color="warning" sx={{ ml: 0.5, verticalAlign: 'middle' }} />
                                                    </Tooltip>
                                                )}
                                            </TableCell>
                                            <TableCell align="right">{g.rows.length.toLocaleString()}</TableCell>
                                            <TableCell align="right">
                                                <Tooltip title={<>
                                                    <div>{g.elements.join(', ')}</div>
                                                    {g.missing.length > 0 && <div style={{ marginTop: 4 }}>Not analysed ({g.missing.length}): {g.missing.slice(0, 25).join(', ')}{g.missing.length > 25 ? ', …' : ''}</div>}
                                                </>}>
                                                    <span>{g.elements.length}</span>
                                                </Tooltip>
                                            </TableCell>
                                            {dlColumns.map(c => {
                                                const list = g.dls[c];
                                                const absent = !g.elements.includes(c);
                                                const mixed = g.mixedDl.includes(c);
                                                return (
                                                    <TableCell key={c} align="right" sx={{ color: mixed ? 'warning.main' : absent ? 'text.disabled' : undefined }}>
                                                        {absent ? '—' : list ? (
                                                            <Tooltip title={describeDls(c, list, 6)}><span>{list[0].dl}{mixed ? ' +' : ''}</span></Tooltip>
                                                        ) : '?'}
                                                    </TableCell>
                                                );
                                            })}
                                            {batchColumn && (
                                                <TableCell>
                                                    <Tooltip title={g.batches.join(', ')}>
                                                        <span>{g.batches.slice(0, 3).join(', ')}{g.batches.length > 3 ? ` +${g.batches.length - 3}` : ''}</span>
                                                    </Tooltip>
                                                </TableCell>
                                            )}
                                            <TableCell>
                                                <Tooltip title={made ? 'Show only this group (Filter tab); PCA → Use filtered data then runs on it' : 'Add the column first'}>
                                                    <span><Button size="small" disabled={!made} onClick={() => isolateGroup(g)}>Use only</Button></span>
                                                </Tooltip>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </TableContainer>
                        )}
                        <Typography variant="caption" color="text.secondary">
                            DL columns show the most common detection limit (hover for all); “?” = no value below detection in that group,
                            “—” = not analysed. {result.empty > 0 && `${result.empty.toLocaleString()} rows have no assay values.`}
                        </Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                            <TextField size="small" label="Column name" value={name} onChange={e => setName(e.target.value)}
                                helperText={exists ? 'Exists: will be replaced' : ' '} FormHelperTextProps={{ sx: { color: exists ? 'warning.main' : undefined } }} />
                            <Button variant="contained" onClick={addColumn} disabled={!name.trim()} sx={{ mb: 2.5 }}>Add column</Button>
                            {made && (
                                <>
                                    <Chip size="small" color="success" label={`${made} added`} sx={{ mb: 2.5 }} />
                                    <Button size="small" onClick={colourBy} sx={{ mb: 2.5 }}>Colour by it</Button>
                                    <Button size="small" onClick={splitProbability} sx={{ mb: 2.5 }}>Split probability plots</Button>
                                    <Tooltip title="Open the protocol summary (limits by group, what each group is made of), a map and probability plots coloured by group">
                                        <Button size="small" variant="outlined" onClick={showSplit} sx={{ mb: 2.5 }}>Show the split</Button>
                                    </Tooltip>
                                    <Tooltip title="Method in words, the group table and the three figures, into the report">
                                        <Button size="small" variant="outlined" onClick={toReport} sx={{ mb: 2.5 }}>Add to report</Button>
                                    </Tooltip>
                                </>
                            )}
                        </Box>
                    </>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Close</Button>
            </DialogActions>
        </Dialog>
    );
};
