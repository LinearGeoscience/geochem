/**
 * Compositional variation matrix: var(ln(xi/xj)) for every pair of chosen
 * elements, optionally inside one group (rock type). Small = the pair moves
 * together whatever dilution, leaching or closure does: the test for
 * immobile elements (and a guide to which element(s) to divide by).
 * Shown in Analysis > Variation Matrix and as a tab in Transformations.
 */
import React, { useMemo, useState } from 'react';
import {
    Box, Button, Collapse, Menu, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    TextField, Tooltip, Typography,
} from '@mui/material';
import Plot from '../../../components/ThemedPlot';
import { ColumnPicker } from '../../../components/ColumnPicker';
import { MultiColumnSelector } from '../../../components/MultiColumnSelector';
import { notify } from '../../../store/notificationStore';
import { useTransformationStore } from '../../../store/transformationStore';
import { analysisInWorker } from '../../../utils/analysisWorker';
import { downloadText } from '../../../utils/gisExport';
import {
    rankedPairs, rankedPairsCsv, variationMatrixCsv,
    type PairStability, type VariationMatrixOptions, type VariationMatrixResult, type VariationZeroRule,
} from '../../../utils/statistics/variationMatrix';
import { useMethodData, addReportTable, fmt, groupLabels } from './methodsCommon';
import { VisibleOnlySwitch } from './methodsControls';

const ZERO_RULES: { value: VariationZeroRule; label: string }[] = [
    { value: 'omit', label: 'Leave out (pairwise)' },
    { value: 'half-min', label: '½ × smallest positive' },
    { value: 'small-constant', label: '0.65 × smallest positive' },
    { value: 'custom', label: 'Fixed value' },
];

/** The Transformations zero strategy as a variation-matrix rule (row-wise strategies fall back to ½ min) */
function ruleFromStrategy(s: string): VariationZeroRule {
    return s === 'small-constant' ? 'small-constant' : s === 'custom' ? 'custom' : 'half-min';
}

interface Run { vm: VariationMatrixResult; elements: string[]; label: string; options: VariationMatrixOptions; mask: Uint8Array }

export const VariationMatrixPanel: React.FC = () => {
    const data = useMethodData();
    const zeroStrategy = useTransformationStore(s => s.zeroStrategy);
    const customZero = useTransformationStore(s => s.customZeroValue);
    const [elements, setElements] = useState<string[]>([]);
    const [groupColumn, setGroupColumn] = useState('');
    const [groupValue, setGroupValue] = useState('');
    const [clipMin, setClipMin] = useState('1');
    const [zeros, setZeros] = useState<VariationZeroRule>(() => ruleFromStrategy(zeroStrategy));
    const [customValue, setCustomValue] = useState(String(customZero ?? 0.001));
    const [visibleOnly, setVisibleOnly] = useState(true);
    const [result, setResult] = useState<Run | null>(null);
    const [busy, setBusy] = useState(false);
    const [showAll, setShowAll] = useState(false);
    const [exportAnchor, setExportAnchor] = useState<HTMLElement | null>(null);
    // Two-group check
    const [splitColumn, setSplitColumn] = useState('');
    const [splitA, setSplitA] = useState('');
    const [splitB, setSplitB] = useState('');
    const [stability, setStability] = useState<{ labelA: string; labelB: string; rows: PairStability[] } | null>(null);

    const groupCol = groupColumn ? data.text(groupColumn) : null;
    const groupValues = useMemo(() => (groupCol ? [...new Set(groupLabels(groupCol, data.rowCount))].filter(Boolean).sort() : []), [groupCol, data.rowCount]);
    const splitCol = splitColumn ? data.text(splitColumn) : null;
    const splitValues = useMemo(() => (splitCol ? [...new Set(groupLabels(splitCol, data.rowCount))].filter(Boolean).sort() : []), [splitCol, data.rowCount]);

    const pairs = useMemo(() => (result ? rankedPairs(result.vm) : []), [result]);

    if (!data.rowCount) return <Typography color="text.secondary">Load data to compute a variation matrix.</Typography>;
    const options = data.numericColumns.map(name => ({ name, alias: data.display(name) === name ? null : data.display(name) }));

    const parts = (names: string[]) => names.map(e => data.values(e)).filter((c): c is Float64Array => !!c);

    const run = async () => {
        const vis = visibleOnly ? data.visibleMask() : null;
        const mask = Uint8Array.from({ length: data.rowCount }, (_, i) =>
            (!vis || vis[i]) && (!groupCol || !groupValue || String(groupCol[i] ?? '') === groupValue) ? 1 : 0);
        const clip = parseFloat(clipMin);
        const custom = parseFloat(customValue);
        const opts: VariationMatrixOptions = {
            clipMin: Number.isFinite(clip) ? clip : null, zeros,
            ...(zeros === 'custom' ? { customZeroValue: Number.isFinite(custom) ? custom : NaN } : {}),
        };
        const names = elements.filter(e => !!data.values(e));
        setBusy(true);
        try {
            const vm = await analysisInWorker<VariationMatrixResult>('variationMatrix', { parts: parts(names), options: { ...opts, rowMask: mask } });
            setResult({ vm, elements: names, label: groupValue ? `${groupColumn} = ${groupValue}` : 'all rows', options: opts, mask });
            setStability(null);
        } catch (e) {
            notify(`Variation matrix failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
        } finally {
            setBusy(false);
        }
    };

    const compareGroups = async () => {
        if (!result || !splitCol || !splitA || !splitB) return;
        const m = (value: string) => Uint8Array.from({ length: data.rowCount }, (_, i) => (result.mask[i] && String(splitCol[i] ?? '') === value ? 1 : 0));
        setBusy(true);
        try {
            const rows = await analysisInWorker<PairStability[]>('pairStability', { parts: parts(result.elements), maskA: m(splitA), maskB: m(splitB), options: result.options });
            setStability({ labelA: splitA, labelB: splitB, rows });
        } finally {
            setBusy(false);
        }
    };

    const names = result ? result.elements.map(data.display) : [];
    const stabilityOf = new Map((stability?.rows ?? []).map(s => [`${s.i}|${s.j}`, s]));
    const shownPairs = showAll ? pairs : pairs.slice(0, 10);

    const toReport = () => {
        if (!result) return;
        addReportTable(`Variation matrix (${result.label})`,
            'var(ln(xi/xj)) for every pair (population variance over rows where both have a value). Small values: the two elements rise and fall together regardless of dilution, leaching or closure — the compositional test for immobile pairs.',
            ['', ...names], result.vm.matrix.map((row, i) => [names[i], ...row.map((v, j) => (i === j ? '' : fmt(v, 3)))]));
        const head = ['Pair', 'var(ln A/B)', 'n', ...(stability ? [`var in ${stability.labelA}`, `var in ${stability.labelB}`, 'Mann-Whitney p'] : [])];
        addReportTable(`Tightest pairs (${result.label})`, 'Pairs ranked by var(ln A/B); the first rows are the best-behaved references to divide by.' +
            (stability ? ` The last columns compare ${stability.labelA} with ${stability.labelB}: an immobile pair keeps its variance and its ratio (high p).` : ''),
            head, pairs.slice(0, 15).map(p => {
                const s = stabilityOf.get(`${p.i}|${p.j}`);
                return [`${names[p.i]}–${names[p.j]}`, fmt(p.variance, 3), p.n, ...(stability ? [s ? fmt(s.varA, 3) : '–', s ? fmt(s.varB, 3) : '–', s ? fmt(s.p, 2) : '–'] : [])];
            }));
        notify('Variation matrix added to the report', 'success');
    };

    const applyAsReference = (a: string, b: string) => {
        useTransformationStore.getState().setALRReferences([a, b]);
        notify(`ALR reference set to the geometric mean of ${data.display(a)} and ${data.display(b)} (Transformations > ALR, and PCA)`, 'success');
    };

    // Log colour scale: z = log10(var), ticks labelled in var units
    const zLog = result ? result.vm.matrix.map((r, i) => r.map((v, j) => (i === j || !(v > 0) ? null : Math.log10(v)))) : [];
    const finiteLogs = zLog.flat().filter((v): v is number => v !== null && Number.isFinite(v));
    const tickvals = finiteLogs.length ? Array.from({ length: Math.floor(Math.max(...finiteLogs)) - Math.ceil(Math.min(...finiteLogs)) + 1 }, (_, k) => Math.ceil(Math.min(...finiteLogs)) + k) : [];

    return (
        <Box>
            <Typography variant="h6" sx={{ mb: 0.5 }}>Variation matrix</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                For each pair of elements, the variance of ln(A/B) across samples. Concentrations rise and fall with dilution, leaching
                and closure, but the ratio of two immobile elements does not: the pair with the smallest value is the best-behaved
                reference to divide by. Compute it inside one rock type, since different protoliths have different ratios.
            </Typography>
            <Paper sx={{ p: 2, mb: 2 }}>
                <Stack spacing={1.5}>
                    <MultiColumnSelector columns={options} selectedColumns={elements} onChange={setElements} label="Elements" />
                    <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap alignItems="center">
                        <ColumnPicker label="Group (optional)" value={groupColumn} onChange={v => { setGroupColumn(v); setGroupValue(''); }} filter="categorical" allowNone minWidth={190} />
                        {groupCol && (
                            <TextField select size="small" label="Only" value={groupValue} onChange={e => setGroupValue(e.target.value)} sx={{ minWidth: 200 }}>
                                <MenuItem value="">All groups together</MenuItem>
                                {groupValues.map(g => <MenuItem key={g} value={g}>{g}</MenuItem>)}
                            </TextField>
                        )}
                        <Tooltip title="Zeros and negatives have no logarithm. Leave them out (each pair uses the rows where both elements have a value), or replace them per column first. Blank cells always stay blank." placement="top">
                            <TextField select size="small" label="Zeros" value={zeros} onChange={e => setZeros(e.target.value as VariationZeroRule)} sx={{ minWidth: 200 }}>
                                {ZERO_RULES.map(r => <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>)}
                            </TextField>
                        </Tooltip>
                        {zeros === 'custom' && <TextField size="small" label="Replace zeros with" value={customValue} onChange={e => setCustomValue(e.target.value)} sx={{ width: 150 }} />}
                        <TextField size="small" label="Raise values below to" value={clipMin} onChange={e => setClipMin(e.target.value)} sx={{ width: 170 }} />
                        <VisibleOnlySwitch value={visibleOnly} onChange={setVisibleOnly} />
                    </Stack>
                    <Stack direction="row" spacing={1.5}>
                        <Button variant="contained" onClick={run} disabled={elements.length < 2 || busy}>{busy ? 'Computing…' : 'Compute'}</Button>
                        {result && <Button variant="outlined" onClick={toReport}>Add to report</Button>}
                        {result && <Button variant="outlined" onClick={e => setExportAnchor(e.currentTarget)}>Export CSV</Button>}
                        <Menu anchorEl={exportAnchor} open={!!exportAnchor} onClose={() => setExportAnchor(null)}>
                            <MenuItem onClick={() => { if (result) downloadText(variationMatrixCsv(names, result.vm), 'variation_matrix.csv', 'text/csv'); setExportAnchor(null); }}>Matrix ({names.length} × {names.length})</MenuItem>
                            <MenuItem onClick={() => { if (result) downloadText(rankedPairsCsv(names, pairs, stability), 'variation_pairs.csv', 'text/csv'); setExportAnchor(null); }}>Ranked pairs{stability ? ' with group check' : ''}</MenuItem>
                        </Menu>
                    </Stack>
                </Stack>
            </Paper>
            {result && (
                <>
                    <Paper variant="outlined" sx={{ p: 1, mb: 2 }}>
                        <Typography variant="body2" sx={{ px: 1 }}>
                            {result.label} · total variation {fmt(result.vm.totalVariation, 3)}
                            {result.vm.replaced.some(c => c > 0) && ` · zeros replaced: ${result.vm.replaced.reduce((a, b) => a + b, 0)}`}
                        </Typography>
                        <Plot
                            data={[{
                                z: zLog,
                                x: names, y: names,
                                type: 'heatmap', colorscale: 'Viridis', reversescale: true,
                                text: result.vm.matrix.map((r, i) => r.map((v, j) => (i === j ? '' : fmt(v, 2)))) as any,
                                customdata: result.vm.matrix as any,
                                texttemplate: '%{text}', hovertemplate: 'var ln(%{y}/%{x}) = %{customdata:.4f}<extra></extra>',
                                colorbar: { title: { text: 'var ln ratio' }, tickvals, ticktext: tickvals.map(t => fmt(10 ** t, 2)) },
                            } as any]}
                            layout={{ height: Math.max(320, 40 * names.length + 120), margin: { l: 80, r: 20, t: 20, b: 80 }, yaxis: { autorange: 'reversed' } }}
                            config={{ displaylogo: false, responsive: true }}
                            style={{ width: '100%' }}
                            useResizeHandler
                        />
                    </Paper>
                    <Paper variant="outlined" sx={{ p: 1.5 }}>
                        <Typography variant="subtitle2">Tightest pairs</Typography>
                        <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap alignItems="center" sx={{ my: 1 }}>
                            <Typography variant="caption" color="text.secondary">Same pair in two groups (e.g. weathered vs fresh):</Typography>
                            <ColumnPicker label="Groups from" value={splitColumn} onChange={v => { setSplitColumn(v); setSplitA(''); setSplitB(''); setStability(null); }} filter="categorical" allowNone minWidth={170} />
                            {splitCol && (
                                <>
                                    <TextField select size="small" label="Group A" value={splitA} onChange={e => setSplitA(e.target.value)} sx={{ minWidth: 150 }}>
                                        {splitValues.map(g => <MenuItem key={g} value={g}>{g}</MenuItem>)}
                                    </TextField>
                                    <TextField select size="small" label="Group B" value={splitB} onChange={e => setSplitB(e.target.value)} sx={{ minWidth: 150 }}>
                                        {splitValues.filter(g => g !== splitA).map(g => <MenuItem key={g} value={g}>{g}</MenuItem>)}
                                    </TextField>
                                    <Button size="small" variant="outlined" onClick={compareGroups} disabled={!splitA || !splitB || busy}>Compare</Button>
                                </>
                            )}
                        </Stack>
                        <TableContainer sx={{ maxHeight: 360 }}>
                            <Table size="small" stickyHeader>
                                <TableHead>
                                    <TableRow>
                                        <TableCell>Pair</TableCell>
                                        <TableCell align="right">var(ln A/B)</TableCell>
                                        <TableCell align="right">n</TableCell>
                                        {stability && <TableCell align="right">var in {stability.labelA}</TableCell>}
                                        {stability && <TableCell align="right">var in {stability.labelB}</TableCell>}
                                        {stability && <TableCell align="right"><Tooltip title="Mann-Whitney test of ln(A/B) between the two groups. Low p: the ratio itself differs, so the pair is not immobile across them (or the groups have different protoliths)."><span>p (ratio differs)</span></Tooltip></TableCell>}
                                        <TableCell />
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {shownPairs.map(p => {
                                        const s = stabilityOf.get(`${p.i}|${p.j}`);
                                        return (
                                            <TableRow key={`${p.i}|${p.j}`} hover>
                                                <TableCell>{names[p.i]}–{names[p.j]}</TableCell>
                                                <TableCell align="right">{fmt(p.variance, 3)}</TableCell>
                                                <TableCell align="right">{p.n}</TableCell>
                                                {stability && <TableCell align="right">{s ? fmt(s.varA, 3) : '–'}</TableCell>}
                                                {stability && <TableCell align="right">{s ? fmt(s.varB, 3) : '–'}</TableCell>}
                                                {stability && <TableCell align="right">{s ? fmt(s.p, 2) : '–'}</TableCell>}
                                                <TableCell align="right">
                                                    <Button size="small" onClick={() => applyAsReference(result.elements[p.i], result.elements[p.j])}>Use as reference</Button>
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </TableContainer>
                        <Collapse in={pairs.length > 10}>
                            <Button size="small" onClick={() => setShowAll(v => !v)}>{showAll ? 'Show the 10 tightest' : `Show all ${pairs.length} pairs`}</Button>
                        </Collapse>
                    </Paper>
                </>
            )}
        </Box>
    );
};
