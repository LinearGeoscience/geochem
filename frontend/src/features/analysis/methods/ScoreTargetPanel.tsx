/**
 * Score vs target: how well do one or more scores (an index, a vector, a
 * model output, a single element) pick out a target (gold at or above a
 * cut-off)? ROC + AUC with a moving-block bootstrap interval (and a forest
 * chart comparing the scores), precision-recall against the base rate,
 * capture curves (share of the target total in the top x % of samples by
 * score), and band calibration: the hit rate and grade in each band of a
 * class column or of a score cut into ranges.
 */
import React, { useMemo, useRef, useState } from 'react';
import {
    Alert, Box, Button, CircularProgress, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import Plot from '../../../components/ThemedPlot';
import { ColumnPicker } from '../../../components/ColumnPicker';
import { MultiColumnSelector } from '../../../components/MultiColumnSelector';
import { ExpandablePlotWrapper } from '../../../components/ExpandablePlotWrapper';
import { notify } from '../../../store/notificationStore';
import { useReportStore } from '../../../store/reportStore';
import { analysisInWorker } from '../../../utils/analysisWorker';
import { bandCalibration, binAtQuantiles, binAtThresholds, forestOrder, type BandCalibrationRow, type Banding, type ScoreEvaluation } from '../../../utils/statistics/targetEvaluation';
import { slate, teal } from '../../../theme/colors';
import { useSequenceSettings, useMethodData, sequenceOrder, addReportTable, fmt } from './methodsCommon';
import { SequenceFields, VisibleOnlySwitch } from './methodsControls';

interface Run {
    target: string;
    threshold: number;
    /** Rows evaluated (visible rows when that was on), in sequence order */
    rows: number[];
    results: Array<{ name: string; result: ScoreEvaluation }>;
}

type BandSource = 'quantiles' | 'cuts' | 'column';
type ChartKey = 'forest' | 'roc' | 'pr' | 'capture' | 'bands';

const pct = (v: number) => (Number.isFinite(v) ? `${(100 * v).toFixed(0)}%` : '–');
const parseList = (s: string) => s.split(/[,;\s]+/).map(Number).filter((v, i, a) => s.trim() !== '' && Number.isFinite(v) && a.indexOf(v) === i);
const GUIDE = { color: slate[400], width: 1 };

export const ScoreTargetPanel: React.FC = () => {
    const data = useMethodData();
    const seq = useSequenceSettings();
    const [scores, setScores] = useState<string[]>([]);
    const [target, setTarget] = useState('');
    const [threshold, setThreshold] = useState('');
    const [blockLength, setBlockLength] = useState('10');
    const [visibleOnly, setVisibleOnly] = useState(true);
    const [running, setRunning] = useState(false);
    const [run, setRun] = useState<Run | null>(null);
    // Band calibration
    const [bandSource, setBandSource] = useState<BandSource>('quantiles');
    const [bandColumn, setBandColumn] = useState('');
    const [bandScore, setBandScore] = useState('');
    const [bandCuts, setBandCuts] = useState('');
    const [bandK, setBandK] = useState('5');
    const [secondCut, setSecondCut] = useState('');
    // The boxes holding the drawn charts (not the full-screen copies), for the report
    const boxes = useRef<Partial<Record<ChartKey, HTMLDivElement | null>>>({});
    const box = (key: ChartKey) => (el: HTMLDivElement | null) => { boxes.current[key] = el; };

    const scoreName = bandScore || run?.results[0]?.name || '';
    const targetCol = run ? data.values(run.target) : null;
    const scoreCol = bandSource !== 'column' && scoreName ? data.values(scoreName) : null;
    const classCol = bandSource === 'column' && bandColumn ? data.text(bandColumn) : null;
    const second = parseFloat(secondCut);
    const bands = useMemo(() => {
        if (!run || !targetCol) return null;
        const rows = run.rows;
        const t = Float64Array.from(rows, i => targetCol[i]);
        let banding: Banding | { bands: (string | null)[]; order?: string[] } | null = null;
        if (bandSource === 'column') {
            if (!classCol) return null;
            banding = {
                bands: rows.map(i => {
                    const v = classCol[i];
                    if (v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v))) return null;
                    return String(v).trim() || null;
                }),
            };
        } else {
            if (!scoreCol) return null;
            const s = Float64Array.from(rows, i => scoreCol[i]);
            if (bandSource === 'cuts') {
                const cuts = parseList(bandCuts);
                if (!cuts.length) return null;
                banding = binAtThresholds(s, cuts);
            } else {
                // Cut points from the samples with a target value, so the bands hold similar numbers of them
                banding = binAtQuantiles(s, Math.max(2, Math.min(20, parseInt(bandK, 10) || 5)), s.filter((_, k) => Number.isFinite(t[k])));
            }
        }
        const thresholds = [run.threshold, ...(Number.isFinite(second) && second !== run.threshold ? [second] : [])];
        return { thresholds, rows: bandCalibration(t, banding.bands, thresholds, banding.order) };
    }, [run, targetCol, bandSource, classCol, scoreCol, bandCuts, bandK, second]);

    if (!data.rowCount) return <Typography color="text.secondary">Load data to test scores against a target.</Typography>;
    const options = data.numericColumns.map(name => ({ name, alias: data.display(name) === name ? null : data.display(name) }));

    const go = async () => {
        const thr = parseFloat(threshold);
        const t = data.values(target);
        if (!t || !Number.isFinite(thr) || !scores.length) return;
        setRunning(true);
        try {
            const order = sequenceOrder(data, seq, visibleOnly ? data.visibleMask() : null);
            const pick = (v: Float64Array) => Float64Array.from(order, i => v[i]);
            const payload = {
                scores: scores.map(s => ({ name: s, values: pick(data.values(s)!) })),
                target: pick(t),
                options: { threshold: thr, blockLength: Math.max(1, parseInt(blockLength, 10) || 10), resamples: 500, seed: 42 },
            };
            const results = await analysisInWorker<Run['results']>('evaluateScores', payload);
            setRun({ target, threshold: thr, rows: order, results });
        } catch (err) {
            notify(`Evaluation failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
        } finally {
            setRunning(false);
        }
    };

    const bandLabel = bandSource === 'column' ? data.display(bandColumn)
        : `${data.display(scoreName)} ${bandSource === 'cuts' ? 'bands' : 'quantile bands'}`;
    const targetLabel = run ? data.display(run.target) : '';

    const toReport = async () => {
        if (!run) return;
        const r0 = run.results[0]?.result;
        const report = useReportStore.getState();
        addReportTable(`Scores against ${targetLabel} ≥ ${run.threshold}`,
            `ROC AUC (0.5 = guessing) with a 95% moving-block bootstrap interval (blocks of ${blockLength} consecutive samples), average precision against the base rate ${pct(r0?.baseRate ?? NaN)}, and the share of the ${targetLabel} total caught in the top 10 / 20 / 30% of samples by score. ${r0?.n ?? 0} samples, ${r0?.nTarget ?? 0} at or above the cut-off.`,
            ['Score', 'AUC', '95% interval', 'Avg precision', 'Top 10%', 'Top 20%', 'Top 30%'],
            run.results.map(({ name, result: r }) => [data.display(name), r.auc, `${fmt(r.aucCI[0], 2)}–${fmt(r.aucCI[1], 2)}`, r.averagePrecision, pct(r.capture10), pct(r.capture20), pct(r.capture30)]));
        if (bands?.rows.length) {
            addReportTable(`${targetLabel} by ${bandLabel}`,
                `Samples with a ${targetLabel} value in each band, the share at or above ${bands.thresholds.join(' and ')} (inclusive), and the median, quartiles and maximum of ${targetLabel}.`,
                bandHeader(bands.thresholds), bands.rows.map(bandCells));
        }
        const png = async (key: ChartKey, width: number, height: number) => {
            const gd = boxes.current[key]?.querySelector<HTMLElement>('.js-plotly-plot');
            if (!gd) return null;
            try {
                const Plotly = (await import('plotly.js')).default as unknown as { toImage: (g: HTMLElement, o: object) => Promise<string> };
                return await Plotly.toImage(gd, { format: 'png', scale: 2, width, height });
            } catch { return null; }
        };
        const context = [`${r0?.n ?? 0} samples, ${r0?.nTarget ?? 0} with ${targetLabel} ≥ ${run.threshold}`, visibleOnly ? 'Visible rows only' : 'All rows'];
        let figures = 0;
        const forestPng = await png('forest', 640, Math.max(220, 110 + 34 * run.results.length));
        if (forestPng) {
            report.addFigure({ title: `AUC of each score against ${targetLabel} ≥ ${run.threshold}`, caption: 'ROC AUC (dot) with its 95% moving-block bootstrap interval (whiskers), highest first; dashed line = 0.5 (no better than chance).', images: [forestPng], context });
            figures++;
        }
        const curves = (await Promise.all((['roc', 'pr', 'capture'] as const).map(k => png(k, 460, 380)))).filter((s): s is string => !!s);
        if (curves.length) {
            report.addFigure({ title: `ROC, precision-recall and capture curves: ${targetLabel} ≥ ${run.threshold}`, caption: `ROC (dotted diagonal = chance), precision-recall (dotted = base rate ${pct(r0?.baseRate ?? NaN)}) and the share of the ${targetLabel} total caught when samples are taken highest score first (dotted vertical = top 20%).`, images: curves, context });
            figures++;
        }
        const bandPng = bands?.rows.length ? await png('bands', 760, 420) : null;
        if (bandPng) {
            report.addFigure({ title: `${targetLabel} hit rate by ${bandLabel}`, caption: `Share of samples in each band with ${targetLabel} at or above ${bands!.thresholds.join(' / ')}; n = samples with a ${targetLabel} value, Med = median ${targetLabel}.`, images: [bandPng], context });
            figures++;
        }
        notify(`Report: ${bands?.rows.length ? 'tables' : 'table'}${figures ? ` and ${figures} figure${figures > 1 ? 's' : ''}` : ''} added`, 'success');
    };

    const curve = (key: 'roc' | 'pr' | 'capture', title: string, xt: string, yt: string, diag?: 'roc' | 'capture') => run && (
        <ExpandablePlotWrapper>
            <Plot
                data={[
                    ...run.results.map(({ name, result }) => ({
                        x: result[key].x, y: result[key].y, type: 'scatter' as const, mode: 'lines' as const, name: data.display(name), line: { width: 2 },
                    })),
                    ...(diag ? [{ x: [0, 1], y: [0, 1], type: 'scatter' as const, mode: 'lines' as const, name: diag === 'roc' ? 'Chance' : 'Random order', line: { dash: 'dot' as const, width: 1, color: '#888' } }] : []),
                    ...(key === 'pr' ? [{ x: [0, 1], y: [run.results[0].result.baseRate, run.results[0].result.baseRate], type: 'scatter' as const, mode: 'lines' as const, name: 'Base rate', line: { dash: 'dot' as const, width: 1, color: '#888' } }] : []),
                ]}
                layout={{
                    title: { text: title }, height: 320, margin: { l: 50, r: 10, t: 40, b: 45 },
                    xaxis: { title: { text: xt }, range: [0, 1] }, yaxis: { title: { text: yt }, range: [0, 1.02] },
                    showlegend: key === 'roc', legend: { x: 0.45, y: 0.05 },
                    // Top 20% guide, as in the table
                    ...(key === 'capture' ? { shapes: [{ type: 'line' as const, x0: 0.2, x1: 0.2, y0: 0, y1: 1, yref: 'paper' as const, line: { ...GUIDE, dash: 'dot' as const } }] } : {}),
                }}
                config={{ displaylogo: false, responsive: true }}
                style={{ width: '100%' }}
                useResizeHandler
            />
        </ExpandablePlotWrapper>
    );

    const forestChart = () => {
        if (!run) return null;
        const rows = forestOrder(run.results.map(({ name, result: r }) => ({ name: data.display(name), auc: r.auc, lo: r.aucCI[0], hi: r.aucCI[1] })));
        const lows = rows.flatMap(r => [r.lo, r.auc]).filter(Number.isFinite);
        const xMin = Math.max(0, Math.min(0.3, ...lows) - 0.03);
        const height = Math.max(200, 100 + 34 * rows.length);
        return (
            <ExpandablePlotWrapper>
                <Plot
                    data={[{
                        type: 'scatter', mode: 'markers', x: rows.map(r => r.auc), y: rows.map(r => r.name),
                        marker: { size: 10, color: teal[600] },
                        error_x: {
                            type: 'data', symmetric: false, color: teal[600], thickness: 2, width: 5,
                            array: rows.map(r => (Number.isFinite(r.hi) ? Math.max(0, r.hi - r.auc) : 0)),
                            arrayminus: rows.map(r => (Number.isFinite(r.lo) ? Math.max(0, r.auc - r.lo) : 0)),
                        },
                        customdata: rows.map(r => [fmt(r.lo, 2), fmt(r.hi, 2)]),
                        hovertemplate: '%{y}<br>AUC %{x:.3f}<br>95%: %{customdata[0]}–%{customdata[1]}<extra></extra>',
                    }]}
                    layout={{
                        title: { text: 'AUC with 95% interval' }, height, margin: { l: 10, r: 20, t: 40, b: 45 },
                        xaxis: { title: { text: 'ROC AUC (0.5 = chance)' }, range: [xMin, 1.01], zeroline: false },
                        yaxis: { autorange: 'reversed', automargin: true, type: 'category' },
                        shapes: [{ type: 'line', x0: 0.5, x1: 0.5, y0: 0, y1: 1, yref: 'paper', line: { ...GUIDE, dash: 'dash' } }],
                        showlegend: false,
                    }}
                    config={{ displaylogo: false, responsive: true }}
                    style={{ width: '100%' }}
                    useResizeHandler
                />
            </ExpandablePlotWrapper>
        );
    };

    const bandChart = () => {
        if (!bands?.rows.length) return null;
        const x = bands.rows.map(r => r.band);
        const top = (r: BandCalibrationRow) => Math.max(0, ...r.rates.map(v => (Number.isFinite(v) ? 100 * v : 0)));
        return (
            <ExpandablePlotWrapper>
                <Plot
                    data={bands.thresholds.map((t, j) => ({
                        type: 'bar' as const, name: `% ≥ ${t}`, x, y: bands.rows.map(r => (Number.isFinite(r.rates[j]) ? 100 * r.rates[j] : 0)),
                        marker: { color: j === 0 ? teal[400] : teal[800], line: { width: 0 } },
                        customdata: bands.rows.map(r => [r.hits[j], r.n]),
                        hovertemplate: `%{x}<br>%{y:.0f}% at or above ${t}<br>%{customdata[0]} of %{customdata[1]}<extra></extra>`,
                    }))}
                    layout={{
                        title: { text: `${targetLabel} hit rate by band` }, height: 380, margin: { l: 55, r: 15, t: 60, b: 70 },
                        barmode: 'group', bargap: 0.3, bargroupgap: 0.06,
                        xaxis: { title: { text: bandLabel }, type: 'category' },
                        yaxis: { title: { text: '% of samples in band' }, range: [0, 118] },
                        legend: { orientation: 'h', x: 0, y: 1.08, xanchor: 'left', yanchor: 'bottom' },
                        annotations: bands.rows.map(r => ({
                            x: r.band, y: top(r), text: `n=${r.n}<br>Med=${fmt(r.median)}`,
                            showarrow: false, yanchor: 'bottom' as const, yshift: 3, font: { size: 11 },
                        })),
                    }}
                    config={{ displaylogo: false, responsive: true }}
                    style={{ width: '100%' }}
                    useResizeHandler
                />
            </ExpandablePlotWrapper>
        );
    };

    return (
        <Box>
            <Typography variant="h6" sx={{ mb: 0.5 }}>Score vs target</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                How well does a score pick out the target? AUC is the chance a random target sample outscores a random background
                sample (0.5 = guessing). The interval resamples runs of consecutive samples, because neighbours down a hole are not
                independent. The capture curve answers the practical question: assay the top 20% by score, catch how much of the metal?
            </Typography>
            <Paper sx={{ p: 2, mb: 2 }}>
                <Stack spacing={1.5}>
                    <MultiColumnSelector columns={options} selectedColumns={scores} onChange={setScores} label="Scores to compare" />
                    <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap alignItems="center">
                        <ColumnPicker label="Target" value={target} onChange={setTarget} minWidth={200} />
                        <TextField size="small" label="Target hit at ≥" value={threshold} onChange={e => setThreshold(e.target.value)} sx={{ width: 140 }} />
                        <TextField size="small" label="Bootstrap block (samples)" value={blockLength} onChange={e => setBlockLength(e.target.value)} sx={{ width: 180 }} />
                        <VisibleOnlySwitch value={visibleOnly} onChange={setVisibleOnly} />
                    </Stack>
                    <SequenceFields />
                    <Stack direction="row" spacing={1.5}>
                        <Button variant="contained" onClick={go} disabled={running || !scores.length || !target || !Number.isFinite(parseFloat(threshold))}>
                            {running ? <CircularProgress size={18} /> : 'Evaluate'}
                        </Button>
                        {run && <Button variant="outlined" onClick={toReport}>Add to report</Button>}
                    </Stack>
                </Stack>
            </Paper>
            {run && run.results[0] && (
                <>
                    {run.results[0].result.nTarget < 15 && (
                        <Alert severity="warning" sx={{ mb: 2 }}>Only {run.results[0].result.nTarget} samples at or above the cut-off: intervals are wide and differences between scores may be noise.</Alert>
                    )}
                    <Typography variant="caption" color="text.secondary">
                        {run.results[0].result.n} samples with score and target · {run.results[0].result.nTarget} at or above {run.threshold} · base rate {pct(run.results[0].result.baseRate)}
                    </Typography>
                    <Paper variant="outlined" sx={{ overflowX: 'auto', mb: 2 }}>
                        <Table size="small">
                            <TableHead>
                                <TableRow>
                                    <TableCell>Score</TableCell><TableCell align="right">AUC</TableCell><TableCell align="right">95% interval</TableCell>
                                    <TableCell align="right">Avg precision</TableCell><TableCell align="right">Top 10%</TableCell><TableCell align="right">Top 20%</TableCell><TableCell align="right">Top 30%</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {run.results.map(({ name, result: r }) => (
                                    <TableRow key={name}>
                                        <TableCell>{data.display(name)}</TableCell>
                                        <TableCell align="right" sx={{ fontWeight: 600 }}>{fmt(r.auc)}</TableCell>
                                        <TableCell align="right">{fmt(r.aucCI[0], 2)}–{fmt(r.aucCI[1], 2)}</TableCell>
                                        <TableCell align="right">{fmt(r.averagePrecision)}</TableCell>
                                        <TableCell align="right">{pct(r.capture10)}</TableCell>
                                        <TableCell align="right">{pct(r.capture20)}</TableCell>
                                        <TableCell align="right">{pct(r.capture30)}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </Paper>
                    <Paper variant="outlined" sx={{ mb: 2 }} ref={box('forest')}>{forestChart()}</Paper>
                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr 1fr' }, gap: 2 }}>
                        <Paper variant="outlined" ref={box('roc')}>{curve('roc', 'ROC', 'False-positive rate', 'True-positive rate', 'roc')}</Paper>
                        <Paper variant="outlined" ref={box('pr')}>{curve('pr', 'Precision-recall', 'Recall', 'Precision')}</Paper>
                        <Paper variant="outlined" ref={box('capture')}>{curve('capture', `Capture of ${targetLabel}`, 'Share of samples (highest score first)', 'Share of target total', 'capture')}</Paper>
                    </Box>

                    <Typography variant="subtitle1" sx={{ mt: 3, mb: 0.5 }}>Band calibration</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                        What does each band of a score (or each class) deliver? The share of samples at or above the cut-off, and the
                        typical grade, per band. Only samples with a {targetLabel} value are counted; the same rows as above.
                    </Typography>
                    <Paper sx={{ p: 2, mb: 2 }}>
                        <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap alignItems="center">
                            <ToggleButtonGroup size="small" exclusive value={bandSource} onChange={(_, v: BandSource | null) => v && setBandSource(v)}>
                                <ToggleButton value="quantiles">Score quantiles</ToggleButton>
                                <ToggleButton value="cuts">Score at cut points</ToggleButton>
                                <ToggleButton value="column">Class column</ToggleButton>
                            </ToggleButtonGroup>
                            {bandSource === 'column' ? (
                                <ColumnPicker label="Band column" value={bandColumn} onChange={setBandColumn} filter="all" minWidth={200} />
                            ) : (
                                <ColumnPicker label="Score" value={scoreName} onChange={setBandScore} minWidth={200} />
                            )}
                            {bandSource === 'cuts' && (
                                <TextField size="small" label="Cut points (comma list)" value={bandCuts} onChange={e => setBandCuts(e.target.value)} sx={{ width: 200 }} />
                            )}
                            {bandSource === 'quantiles' && (
                                <TextField size="small" type="number" label="Bands" value={bandK} onChange={e => setBandK(e.target.value)} sx={{ width: 90 }} />
                            )}
                            <TextField size="small" label="Also % ≥ (optional)" value={secondCut} onChange={e => setSecondCut(e.target.value)} sx={{ width: 160 }} />
                        </Stack>
                    </Paper>
                    {bands?.rows.length ? (
                        <>
                            <Paper variant="outlined" sx={{ mb: 2 }} ref={box('bands')}>{bandChart()}</Paper>
                            <Paper variant="outlined" sx={{ overflowX: 'auto', mb: 2 }}>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow>{bandHeader(bands.thresholds).map((h, i) => <TableCell key={h} align={i ? 'right' : 'left'}>{h}</TableCell>)}</TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {bands.rows.map(r => (
                                            <TableRow key={r.band}>{bandCells(r).map((v, i) => <TableCell key={i} align={i ? 'right' : 'left'}>{v}</TableCell>)}</TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </Paper>
                        </>
                    ) : (
                        <Typography variant="body2" color="text.secondary">
                            {bandSource === 'column' ? 'Pick a column whose values are the bands.' : bandSource === 'cuts' ? 'Type the cut points, e.g. 0, 0.5, 1.' : 'Pick a score to cut into bands.'}
                        </Typography>
                    )}
                </>
            )}
        </Box>
    );
};

function bandHeader(thresholds: number[]): string[] {
    return ['Band', 'n', ...thresholds.map(t => `% ≥ ${t}`), 'Median', 'P25–P75', 'Max'];
}

function bandCells(r: BandCalibrationRow): string[] {
    return [r.band, String(r.n), ...r.rates.map(pct), fmt(r.median), `${fmt(r.p25)}–${fmt(r.p75)}`, fmt(r.max)];
}
