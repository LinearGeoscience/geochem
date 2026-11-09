/**
 * Multi-element anomaly ranking (Phase 21).
 *
 * Scores every sample on a weighted set of pathfinder elements, each judged
 * against its own sample-type group (soil vs stream vs rock chip), and lists
 * the strongest targets. Uses analytical values (below-detection values
 * substituted per Settings). Clicking a target selects it in every plot.
 */
import React, { useMemo, useState } from 'react';
import {
    Alert, Autocomplete, Box, Button, Checkbox, Chip, CircularProgress, FormControl, FormControlLabel,
    InputLabel, MenuItem, Paper, Select, Slider, Stack, Table, TableBody, TableCell, TableContainer,
    TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore, useAnalyticalStore } from '../../store/appStore';
import { notify } from '../../store/notificationStore';
import { getStyleArraysColumnar } from '../../utils/attributeUtils';
import { findColumnForElement } from '../../utils/calculations/elementNameNormalizer';
import { isNumericColumn } from '../../types/columnarData';
import { rankAnomalies, RankingMethod, RankingResult } from '../../utils/statistics/anomalyRanking';
import { guessAxisColumn } from '../plots/viewer3d/coordinateColumns';
import { useStyleInputs } from '../../hooks/useStyleInputs';

/** Pathfinders offered by default when present in the dataset. */
const DEFAULT_PATHFINDERS = ['Au', 'Cu', 'Pb', 'Zn', 'Ag', 'As', 'Sb', 'Bi', 'Mo', 'W', 'Sn', 'Te'];

interface ElementChoice { column: string; element: string; weight: number }

interface RankingRun {
    result: RankingResult;
    elements: ElementChoice[];
    groupColumn: string;
    method: RankingMethod;
    anomalyPercentile: number;
    ms: number;
}

const fmt = (v: number, digits = 1) => (Number.isFinite(v) ? v.toFixed(digits) : '–');

export const AnomalyRanking: React.FC = () => {
    const { columns, geochemMappings, setSelection, addColumn, getRawColumn } = useAppStore(useShallow(s => ({
        columns: s.columns, geochemMappings: s.geochemMappings, setSelection: s.setSelection,
        addColumn: s.addColumn, getRawColumn: s.getRawColumn,
    })));
    const store = useAnalyticalStore();
    // Re-evaluate visibility when attribute filtering changes
    const attributeFilter = useStyleInputs();

    // Element columns available for scoring (mapped, numeric, not oxides)
    const elementOptions = useMemo(() => geochemMappings
        .filter(m => !m.isExcluded && !m.isOxide && (m.userOverride ?? m.detectedElement) && !m.role)
        .filter(m => { const c = store.columns.get(m.originalName); return !!c && isNumericColumn(c); })
        .map(m => ({ column: m.originalName, element: (m.userOverride ?? m.detectedElement) as string })),
    [geochemMappings, store]);

    const defaultElements = useMemo<ElementChoice[]>(() => {
        const out: ElementChoice[] = [];
        for (const el of DEFAULT_PATHFINDERS) {
            const col = findColumnForElement(geochemMappings, el);
            if (col && elementOptions.some(o => o.column === col)) out.push({ column: col, element: el, weight: 1 });
        }
        return out;
    }, [geochemMappings, elementOptions]);

    const groupOptions = useMemo(
        () => columns.filter(c => c.type === 'text' || c.type === 'categorical').map(c => c.name),
        [columns],
    );
    const defaultGroup = useMemo(() => {
        const byName = groupOptions.find(n => /sample_?type|sampletype|medium/i.test(n));
        return byName ?? '';
    }, [groupOptions]);

    const [chosen, setChosen] = useState<ElementChoice[] | null>(null);
    const elements = chosen ?? defaultElements;
    const [groupChoice, setGroupChoice] = useState<string | null>(null);
    const groupColumn = groupChoice ?? defaultGroup;
    const [method, setMethod] = useState<RankingMethod>('percentile');
    const [minElements, setMinElements] = useState(2);
    const [minGroupSize, setMinGroupSize] = useState(20);
    const [anomalyPercentile, setAnomalyPercentile] = useState(90);
    const [visibleOnly, setVisibleOnly] = useState(true);
    const [topN, setTopN] = useState(50);
    const [scoreName, setScoreName] = useState('AnomalyScore');
    const [running, setRunning] = useState(false);
    const [run, setRun] = useState<RankingRun | null>(null);

    const idColumn = useMemo(
        () => columns.find(c => c.role === 'ID')?.name ?? columns.find(c => c.role === 'HoleID')?.name ?? null,
        [columns],
    );
    const xColumn = useMemo(() => guessAxisColumn(columns, 'x'), [columns]);
    const yColumn = useMemo(() => guessAxisColumn(columns, 'y'), [columns]);

    const compute = () => {
        if (elements.length === 0) return;
        setRunning(true);
        // Let the spinner paint before the (synchronous) computation
        setTimeout(() => {
            try {
                const t0 = performance.now();
                const n = store.rowCount;
                const cols = elements.map(e => store.columns.get(e.column) as Float64Array);
                const groups = groupColumn ? (store.columns.get(groupColumn) as string[] | undefined) ?? null : null;
                let rowMask: Uint8Array | null = null;
                if (visibleOnly) {
                    const styles = getStyleArraysColumnar(n, name => store.columns.get(name));
                    rowMask = Uint8Array.from(styles.visible, v => (v ? 1 : 0));
                }
                const result = rankAnomalies(cols, {
                    weights: elements.map(e => e.weight), groups, method, minElements,
                    minGroupSize, anomalyPercentile, rowMask,
                });
                setRun({ result, elements, groupColumn, method, anomalyPercentile, ms: performance.now() - t0 });
            } catch (err) {
                notify(`Anomaly ranking failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
            } finally {
                setRunning(false);
            }
        }, 0);
    };

    const cell = (name: string | null, row: number): string => {
        if (!name) return '';
        const col = getRawColumn(name);
        if (!col) return '';
        const v = col[row];
        if (typeof v === 'number') return Number.isFinite(v) ? String(Number(v.toPrecision(10))) : '';
        return v ?? '';
    };

    const topRows = run ? Array.from(run.result.order.slice(0, topN)) : [];

    const selectTop = () => {
        if (!run) return;
        setSelection(Array.from(run.result.order.slice(0, topN)).sort((a, b) => a - b));
    };

    const addScoreColumn = () => {
        if (!run || !scoreName.trim()) return;
        const values = Array.from(run.result.score, v => (Number.isFinite(v) ? v : null));
        addColumn(scoreName.trim(), values, 'numeric', 'Calculated', null, undefined, {
            kind: 'other',
            description: 'Multi-element anomaly score',
            params: {
                method: run.method,
                groupColumn: run.groupColumn || null,
                anomalyPercentile: run.anomalyPercentile,
                minElements, minGroupSize, visibleOnly,
                elements: run.elements.map(e => ({ column: e.column, weight: e.weight })),
            },
            created: new Date().toISOString(),
        });
        notify(`Added column "${scoreName.trim()}" — colour a map by it in the Attribute Manager`, 'success');
    };

    const exportCsv = () => {
        if (!run) return;
        const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
        const header = ['Rank', idColumn ?? 'Row', run.groupColumn || 'Group', xColumn, yColumn, 'Score', 'AnomalousElements',
            ...run.elements.map(e => `${e.column}_pctile`)];
        const lines = [header.map(esc).join(',')];
        for (const row of run.result.order) {
            lines.push([
                String(run.result.rank[row]),
                idColumn ? cell(idColumn, row) : String(row + 1),
                cell(run.groupColumn || null, row),
                cell(xColumn || null, row),
                cell(yColumn || null, row),
                fmt(run.result.score[row], 3),
                String(run.result.anomalousCount[row]),
                ...run.elements.map((_, k) => fmt(run.result.percentiles[k][row], 2)),
            ].map(esc).join(','));
        }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
        a.download = 'anomaly_ranking.csv';
        a.click();
        URL.revokeObjectURL(a.href);
    };

    if (store.rowCount === 0) {
        return <Typography color="text.secondary">Load data to rank multi-element anomalies.</Typography>;
    }

    return (
        <Box>
            <Typography variant="h6" sx={{ mb: 0.5 }}>Multi-element Anomaly Ranking</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Each element is scored against samples of the same type (percentile or robust log z-score), then
                combined with your weights. Below-detection values use the substitution set in Settings.
            </Typography>

            <Paper sx={{ p: 2, mb: 2 }}>
                <Stack spacing={2}>
                    <Autocomplete
                        multiple
                        size="small"
                        options={elementOptions}
                        value={elements.map(e => elementOptions.find(o => o.column === e.column) ?? { column: e.column, element: e.element })}
                        getOptionLabel={o => `${o.element} (${o.column})`}
                        isOptionEqualToValue={(a, b) => a.column === b.column}
                        onChange={(_, v) => setChosen(v.map(o => ({ ...o, weight: elements.find(e => e.column === o.column)?.weight ?? 1 })))}
                        renderInput={params => <TextField {...params} label="Elements" placeholder="Add element" />}
                    />

                    {elements.length > 0 && (
                        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 1.5 }}>
                            {elements.map(e => (
                                <Box key={e.column}>
                                    <Typography variant="caption">{e.element} weight: {e.weight}</Typography>
                                    <Slider
                                        size="small" min={0} max={5} step={0.5} value={e.weight}
                                        onChange={(_, v) => setChosen(elements.map(x => (x.column === e.column ? { ...x, weight: v as number } : x)))}
                                    />
                                </Box>
                            ))}
                        </Box>
                    )}

                    <Stack direction="row" spacing={2} useFlexGap flexWrap="wrap" alignItems="center">
                        <FormControl size="small" sx={{ minWidth: 200 }}>
                            <InputLabel>Score within groups of</InputLabel>
                            <Select label="Score within groups of" value={groupColumn} onChange={e => setGroupChoice(String(e.target.value))}>
                                <MenuItem value=""><em>Whole dataset</em></MenuItem>
                                {groupOptions.map(g => <MenuItem key={g} value={g}>{g}</MenuItem>)}
                            </Select>
                        </FormControl>
                        <FormControl size="small" sx={{ minWidth: 190 }}>
                            <InputLabel>Method</InputLabel>
                            <Select label="Method" value={method} onChange={e => setMethod(e.target.value as RankingMethod)}>
                                <MenuItem value="percentile">Percentile rank (0–100)</MenuItem>
                                <MenuItem value="zscore-log">Robust log z-score</MenuItem>
                            </Select>
                        </FormControl>
                        <FormControl size="small" sx={{ minWidth: 150 }}>
                            <InputLabel>Anomalous at</InputLabel>
                            <Select label="Anomalous at" value={anomalyPercentile} onChange={e => setAnomalyPercentile(Number(e.target.value))}>
                                {[80, 90, 95, 97.5, 99].map(p => <MenuItem key={p} value={p}>≥ P{p}</MenuItem>)}
                            </Select>
                        </FormControl>
                        <TextField size="small" type="number" label="Min elements" value={minElements} sx={{ width: 120 }}
                            inputProps={{ min: 1, max: Math.max(1, elements.length) }}
                            onChange={e => setMinElements(Math.max(1, Number(e.target.value) || 1))} />
                        <Tooltip title="Groups with fewer samples are scored against the whole dataset">
                            <TextField size="small" type="number" label="Min group size" value={minGroupSize} sx={{ width: 130 }}
                                inputProps={{ min: 1 }} onChange={e => setMinGroupSize(Math.max(1, Number(e.target.value) || 1))} />
                        </Tooltip>
                        <FormControlLabel control={<Checkbox checked={visibleOnly} onChange={e => setVisibleOnly(e.target.checked)} />} label="Only visible samples" />
                        <Button variant="contained" onClick={compute} disabled={running || elements.length === 0}
                            startIcon={running ? <CircularProgress size={16} color="inherit" /> : undefined}>
                            Rank samples
                        </Button>
                    </Stack>
                    {elements.length === 0 && (
                        <Alert severity="info">No pathfinder element columns recognised — add elements above (check the column chemistry mapping if none are listed).</Alert>
                    )}
                </Stack>
            </Paper>

            {run && (
                <Paper sx={{ p: 2 }}>
                    <Stack direction="row" spacing={2} useFlexGap flexWrap="wrap" alignItems="center" sx={{ mb: 1.5 }}>
                        <Typography variant="body2">
                            {run.result.order.length.toLocaleString()} samples scored
                            {run.groupColumn ? ` within ${run.groupColumn} groups` : ''} · {Math.round(run.ms)} ms
                        </Typography>
                        <TextField size="small" type="number" label="Show top" value={topN} sx={{ width: 110 }}
                            inputProps={{ min: 1 }} onChange={e => setTopN(Math.max(1, Number(e.target.value) || 1))} />
                        <Button size="small" variant="outlined" onClick={selectTop}>Select top {topN}</Button>
                        <TextField size="small" label="Score column" value={scoreName} sx={{ width: 160 }} onChange={e => setScoreName(e.target.value)} />
                        <Button size="small" variant="outlined" onClick={addScoreColumn} disabled={!scoreName.trim()}>Add score column</Button>
                        <Button size="small" onClick={exportCsv}>Export CSV</Button>
                    </Stack>

                    <TableContainer sx={{ maxHeight: 560 }}>
                        <Table size="small" stickyHeader>
                            <TableHead>
                                <TableRow>
                                    <TableCell>Rank</TableCell>
                                    <TableCell>{idColumn ?? 'Row'}</TableCell>
                                    {run.groupColumn && <TableCell>{run.groupColumn}</TableCell>}
                                    {xColumn && <TableCell>{xColumn}</TableCell>}
                                    {yColumn && <TableCell>{yColumn}</TableCell>}
                                    <TableCell align="right">Score</TableCell>
                                    <TableCell>Anomalous (≥P{run.anomalyPercentile})</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {topRows.map(row => (
                                    <TableRow key={row} hover sx={{ cursor: 'pointer' }} onClick={() => setSelection([row])}>
                                        <TableCell>{run.result.rank[row]}</TableCell>
                                        <TableCell>{idColumn ? cell(idColumn, row) : row + 1}</TableCell>
                                        {run.groupColumn && <TableCell>{cell(run.groupColumn, row)}</TableCell>}
                                        {xColumn && <TableCell>{cell(xColumn, row)}</TableCell>}
                                        {yColumn && <TableCell>{cell(yColumn, row)}</TableCell>}
                                        <TableCell align="right">{fmt(run.result.score[row], run.method === 'percentile' ? 1 : 2)}</TableCell>
                                        <TableCell>
                                            <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
                                                {run.elements.map((e, k) => {
                                                    const p = run.result.percentiles[k][row];
                                                    if (!(p >= run.anomalyPercentile)) return null;
                                                    return <Chip key={e.column} size="small" label={`${e.element} P${Math.round(p)}`} color="warning" variant="outlined" />;
                                                })}
                                            </Stack>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                    <Typography variant="caption" color="text.secondary">
                        Click a row to select that sample in every plot and map. Recompute after changing filters or the dataset.
                    </Typography>
                    {/* attributeFilter is read so changing styling invalidates "visible only" results visibly */}
                    {visibleOnly && attributeFilter.filter.field && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            Visibility follows the Attribute Manager filter on {attributeFilter.filter.field}.
                        </Typography>
                    )}
                </Paper>
            )}
        </Box>
    );
};
