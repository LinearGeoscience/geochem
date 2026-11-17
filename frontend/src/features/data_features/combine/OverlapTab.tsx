/**
 * Overlap check: where two groups sampled the same ground (same map cell),
 * compare their medians. Groups that agree can be pooled before levelling;
 * groups that are offset need levelling (or a correction); groups that
 * never share ground cannot be checked — levelling them is an assumption.
 */
import React, { useDeferredValue, useMemo, useRef, useState } from 'react';
import {
    Alert, Box, Button, Chip, MenuItem, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    TextField, Tooltip, Typography,
} from '@mui/material';
import Plot from '../../../components/ThemedPlot';
import { useReportStore } from '../../../store/reportStore';
import { useUIStore } from '../../../store/uiStore';
import { useAuditStore } from '../../../store/auditStore';
import { notify } from '../../../store/notificationStore';
import { combineLabels } from '../../../utils/groupLabels';
import { clearHalfDl } from '../../../utils/groupDl';
import {
    CELL_SIZES, overlapCheck, poolFromAgreement, qqPairs, suggestCellSize, VERDICT_TEXT, type OverlapPair, type OverlapVerdict,
} from '../../../utils/overlapCheck';
import { GroupByFields } from './GroupByFields';
import { initialGroupBy, useSurveyColumns } from './surveyColumns';
import { poolKey, useCombineStore } from './combineStore';

const fx = (v: number) => (Number.isFinite(v) ? `×${v >= 10 ? v.toFixed(0) : v.toPrecision(2)}` : '—');
const VERDICT_COLOR: Record<OverlapVerdict, 'success' | 'warning' | 'default' | 'info'> = {
    agree: 'success', offset: 'warning', unclear: 'info', 'too-little': 'default',
};

export const OverlapTab: React.FC = () => {
    const { columns, columnarData, mappings, assayColumns, groupOptions } = useSurveyColumns();
    const east = columns.find(c => c.role === 'East')?.name;
    const north = columns.find(c => c.role === 'North')?.name;
    const [element, setElement] = useState(() => assayColumns.find(c => /^Cu[_\s(]/i.test(c)) ?? assayColumns[0] ?? '');
    const [groupBy, setGroupByState] = useState<string[]>(() => initialGroupBy(columns, groupOptions));
    const setGroupBy = (cols: string[]) => { setGroupByState(cols); useCombineStore.getState().setGroupBy(cols); };
    const [sizeText, setSizeText] = useState<string>('auto');
    const [minPerCell, setMinPerCell] = useState('5');
    const [picked, setPicked] = useState<string | null>(null);
    const qqRef = useRef<HTMLElement | null>(null);
    const unit = mappings.find(m => m.originalName === element)?.detectedUnit ?? '';

    const params = useDeferredValue({ element, groupBy, sizeText, minPerCell });
    const analysis = useMemo(() => {
        const raw = columnarData.columns.get(params.element);
        const ex = east ? columnarData.columns.get(east) : undefined;
        const ny = north ? columnarData.columns.get(north) : undefined;
        const groupCols = params.groupBy.map(c => columnarData.columns.get(c));
        if (!(raw instanceof Float64Array) || !ex || !ny || !params.groupBy.length || groupCols.some(c => !c)) return null;
        const groups = combineLabels(groupCols as ArrayLike<unknown>[]);
        // Pairs only within one sample medium when the grouping includes one
        const mediumCol = params.groupBy.find(c => groupOptions.find(o => o.name === c)?.kind === 'medium');
        const strata = mediumCol ? columnarData.columns.get(mediumCol) : null;
        const halfDl = clearHalfDl(raw, groups);
        const min = Math.max(2, parseInt(params.minPerCell, 10) || 5);
        const run = (cellSize: number, bootstrap = 1000) => overlapCheck(raw, groups, ex, ny, { cellSize, minPerCell: min, strata, halfDl, bootstrap });
        const auto = params.sizeText === 'auto';
        const size = auto ? suggestCellSize(s => run(s, 0)) : Number(params.sizeText);
        return { result: run(size), size, auto, groups, mediumCol };
    }, [params, columnarData, east, north, groupOptions]);

    const pairs = analysis?.result.pairs ?? [];
    const pairKey = (p: OverlapPair) => `${p.a}\u0001${p.b}`;
    const pair = pairs.find(p => pairKey(p) === picked) ?? pairs.find(p => p.verdict !== 'too-little') ?? null;
    const counts = pairs.reduce((m, p) => ({ ...m, [p.verdict]: (m[p.verdict] ?? 0) + 1 }), {} as Partial<Record<OverlapVerdict, number>>);
    const pool = analysis ? poolFromAgreement(analysis.result) : {};

    const charts = useMemo(() => {
        if (!pair) return null;
        const raw = columnarData.columns.get(element) as Float64Array;
        const qq = qqPairs(pair.rowsA.map(i => raw[i]), pair.rowsB.map(i => raw[i]));
        const all = [...qq.x, ...qq.y].filter(v => v > 0);
        const lo = Math.min(...all), hi = Math.max(...all);
        const ratioColour = pair.cells.map(c => c.logRatio);
        const lim = Math.max(0.3, ...ratioColour.map(Math.abs));
        return {
            qq: {
                data: [
                    { x: [lo, hi], y: [lo, hi], mode: 'lines', line: { color: '#999', dash: 'dash', width: 1 }, name: '1 : 1', hoverinfo: 'skip' },
                    ...(Number.isFinite(pair.ratio) ? [{ x: [lo, hi], y: [lo * pair.ratio, hi * pair.ratio], mode: 'lines', line: { color: '#d62728', width: 1 }, name: `${fx(pair.ratio)}` }] : []),
                    { x: qq.x, y: qq.y, mode: 'markers', marker: { size: 6, color: '#1f77b4' }, name: 'quantiles', hovertemplate: `${pair.a}: %{x}<br>${pair.b}: %{y}<extra></extra>` },
                ],
                layout: {
                    title: { text: `Q–Q in shared cells: ${element}`, font: { size: 13 } },
                    xaxis: { type: 'log', title: { text: `${pair.a} (${unit})` } },
                    yaxis: { type: 'log', title: { text: `${pair.b} (${unit})` } },
                    width: 440, height: 380, margin: { l: 70, r: 20, t: 40, b: 60 }, showlegend: true, legend: { x: 0.02, y: 0.98 },
                },
            },
            cells: {
                data: [{
                    x: pair.cells.map(c => c.x), y: pair.cells.map(c => c.y), mode: 'markers', type: 'scatter',
                    marker: { size: 12, symbol: 'square', color: ratioColour, colorscale: 'RdBu', reversescale: true, cmin: -lim, cmax: lim, colorbar: { title: { text: 'log B/A' }, thickness: 10 } },
                    text: pair.cells.map(c => `${pair.a}: ${c.nA} · median ${+c.medA.toPrecision(3)}<br>${pair.b}: ${c.nB} · median ${+c.medB.toPrecision(3)}`),
                    hovertemplate: '%{text}<extra></extra>',
                }],
                layout: {
                    title: { text: 'Shared cells (colour = B / A)', font: { size: 13 } },
                    xaxis: { title: { text: east } }, yaxis: { title: { text: north }, scaleanchor: 'x' },
                    width: 440, height: 380, margin: { l: 80, r: 20, t: 40, b: 60 },
                },
            },
        };
    }, [pair, columnarData, element, unit, east, north]);

    const applyPool = () => {
        useCombineStore.getState().setPool(poolKey(groupBy), pool);
        useCombineStore.getState().setGroupBy(groupBy);
        useAuditStore.getState().recordAudit({
            category: 'calculation',
            operation: 'Overlap check',
            description: `${Object.keys(pool).length} group(s) pooled for levelling (${element}, ${analysis!.size} m cells)`,
            details: Object.entries(pool).map(([g, to]) => `${g} → ${to}`).join('; '),
            parameters: { element, groupColumns: groupBy, cellSize: analysis!.size, minPerCell },
            inputColumns: [element, ...groupBy],
            outputColumns: [],
            rowsAffected: 0,
        });
        useUIStore.getState().setCombineSurveys('levelling');
    };

    const toReport = async () => {
        if (!analysis) return;
        const report = useReportStore.getState();
        report.addNote(`Overlap check (${element})`, [
            `Where two ${groupBy.join(' × ')} groups sampled the same ground — at least ${minPerCell} samples of each in one ${analysis.size} m cell — `
            + `the ratio of their medians measures the difference between them rather than geology. A cell is used only when both medians are above both groups' detection limits.`,
            `Per pair: median ratio over the usable cells with a 90 % bootstrap interval. “Agree” = the interval lies within ×0.8–×1.25; `
            + `“offset” = it excludes ×1; “unclear” = it includes ×1 but is wider than the agreement band.`
            + (analysis.mediumCol ? ` Pairs were formed only within one ${analysis.mediumCol} value.` : ''),
            `Result: ${(Object.entries(counts) as [OverlapVerdict, number][]).map(([v, c]) => `${c} ${VERDICT_TEXT[v]}`).join(', ')}. Groups that never share ground cannot be checked: levelling them assumes their areas have the same distribution.`,
        ].join('\n\n'));
        report.addTable({
            title: `Overlap check: ${element}, ${analysis.size} m cells`,
            caption: `B / A = ratio of medians in shared cells (90 % interval).`,
            columns: ['Group A', 'Group B', 'Shared cells', 'Usable', 'B / A', '90 % interval', 'Verdict'],
            rows: pairs.filter(p => p.verdict !== 'too-little').slice(0, 40).map(p => [
                p.a, p.b, String(p.sharedCells), String(p.usableCells), fx(p.ratio), `${fx(p.lo)} – ${fx(p.hi)}`, VERDICT_TEXT[p.verdict],
            ]),
        });
        let fig = false;
        const gd = qqRef.current;
        if (gd && pair) {
            try {
                const Plotly = (await import('plotly.js')).default as unknown as { toImage: (g: HTMLElement, o: object) => Promise<string> };
                const png = await Plotly.toImage(gd, { format: 'png', scale: 2, width: 440, height: 380 });
                report.addFigure({ title: `Q–Q: ${pair.a} vs ${pair.b} (${element})`, caption: `${element} in the ${pair.usableCells} cells both groups sampled; red line = median ratio ${fx(pair.ratio)}.`, images: [png], context: [`${analysis.size} m cells`, `at least ${minPerCell} samples of each per cell`] });
                fig = true;
            } catch { /* table and note are enough */ }
        }
        notify(`Report: overlap note, pair table${fig ? ' and Q–Q figure' : ''} added`, 'success');
    };

    if (!east || !north) return <Alert severity="info">The overlap check needs East and North columns.</Alert>;
    if (!assayColumns.length) return <Alert severity="info">No element columns to work with.</Alert>;
    return (
        <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
                Where two groups sampled the same ground (the same map cell), any difference between their medians comes from the lab, method or
                sampling, not the geology. Groups that agree can be pooled before levelling; groups that are offset need levelling.
                Most reliable for soils, lags and stream sediments: rock chips in one cell are often different rocks, so their “offset” may be geology.
            </Typography>
            <Stack direction="row" spacing={1.5} alignItems="flex-start" flexWrap="wrap" useFlexGap>
                <TextField select size="small" label="Element" value={element} onChange={e => setElement(e.target.value)} sx={{ minWidth: 150 }}>
                    {assayColumns.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                </TextField>
                <GroupByFields options={groupOptions} value={groupBy} onChange={setGroupBy} help="pairs are formed only within one sample medium" />
                <TextField select size="small" label="Cell size" value={sizeText} onChange={e => setSizeText(e.target.value)} sx={{ minWidth: 150 }}
                    helperText={analysis?.auto ? `auto: ${analysis.size.toLocaleString()} m` : undefined}>
                    <MenuItem value="auto">Auto</MenuItem>
                    {CELL_SIZES.map(s => <MenuItem key={s} value={String(s)}>{s.toLocaleString()} m</MenuItem>)}
                </TextField>
                <TextField size="small" label="Samples of each per cell" value={minPerCell} onChange={e => setMinPerCell(e.target.value)} sx={{ width: 170 }} />
            </Stack>
            {!analysis ? <Alert severity="info">Choose an element and a grouping column.</Alert> : !pairs.length ? (
                <Alert severity="info">No two groups sampled the same {analysis.size.toLocaleString()} m cells. Try larger cells — or the groups cover different ground,
                    and levelling them assumes their areas have the same distribution.</Alert>
            ) : (
                <>
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                        {(['offset', 'unclear', 'agree', 'too-little'] as OverlapVerdict[]).filter(v => counts[v]).map(v => (
                            <Chip key={v} size="small" color={VERDICT_COLOR[v]} variant="outlined" label={`${counts[v]} ${VERDICT_TEXT[v]}`} />
                        ))}
                        {analysis.result.noCoords > 0 && <Chip size="small" variant="outlined" label={`${analysis.result.noCoords.toLocaleString()} values without coordinates`} />}
                    </Stack>
                    <TableContainer sx={{ maxHeight: 260, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                        <Table size="small" stickyHeader>
                            <TableHead>
                                <TableRow>
                                    <TableCell>Group A</TableCell>
                                    <TableCell>Group B</TableCell>
                                    <TableCell align="right">Shared cells</TableCell>
                                    <TableCell align="right">Usable</TableCell>
                                    <TableCell align="right">B / A</TableCell>
                                    <TableCell align="right">90 % interval</TableCell>
                                    <TableCell>Verdict</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {pairs.slice(0, 200).map(p => (
                                    <TableRow key={pairKey(p)} hover selected={pair === p} onClick={() => setPicked(pairKey(p))} sx={{ cursor: 'pointer' }}>
                                        <TableCell>{p.a}</TableCell>
                                        <TableCell>{p.b}</TableCell>
                                        <TableCell align="right">{p.sharedCells}</TableCell>
                                        <TableCell align="right">
                                            <Tooltip title={p.censoredCells ? `${p.censoredCells} shared cell(s) with a median below detection left out` : ''}>
                                                <span>{p.usableCells}</span>
                                            </Tooltip>
                                        </TableCell>
                                        <TableCell align="right">{fx(p.ratio)}</TableCell>
                                        <TableCell align="right">{Number.isFinite(p.lo) ? `${fx(p.lo)} – ${fx(p.hi)}` : '—'}</TableCell>
                                        <TableCell><Chip size="small" color={VERDICT_COLOR[p.verdict]} variant="outlined" label={VERDICT_TEXT[p.verdict]} /></TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                    {charts && (
                        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                            <Plot data={charts.qq.data as any} layout={charts.qq.layout as any} config={{ displaylogo: false }}
                                onInitialized={(_f: unknown, gd: HTMLElement) => { qqRef.current = gd; }} onUpdate={(_f: unknown, gd: HTMLElement) => { qqRef.current = gd; }} />
                            <Plot data={charts.cells.data as any} layout={charts.cells.layout as any} config={{ displaylogo: false }} />
                        </Box>
                    )}
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                        <Tooltip title={Object.keys(pool).length ? Object.entries(pool).map(([g, to]) => `${g} → ${to}`).join('; ') : 'No pair agrees'}>
                            <span>
                                <Button variant="contained" onClick={applyPool} disabled={!Object.keys(pool).length}>
                                    Pool groups that agree ({Object.keys(pool).length})
                                </Button>
                            </span>
                        </Tooltip>
                        <Button variant="outlined" onClick={toReport}>Add to report</Button>
                        <Typography variant="caption" color="text.secondary">
                            Pooled groups are levelled as one; groups that never share ground cannot be checked.
                        </Typography>
                    </Box>
                </>
            )}
        </Stack>
    );
};
