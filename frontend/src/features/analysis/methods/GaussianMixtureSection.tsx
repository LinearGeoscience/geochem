/**
 * Gaussian mixture groups with the number of groups chosen by BIC (shown in
 * the Clustering tab). Soft-edged, data-driven groups: each sample gets the
 * probability of its group, so contact and mixed samples show up as
 * uncertain. Typical use: rock types from immobile-element ratios
 * (log Zr/Ti, log Cr/Ti), where hand-set thresholds would be arbitrary.
 */
import React, { useState } from 'react';
import {
    Alert, Box, Button, CircularProgress, FormControlLabel, MenuItem, Paper, Stack, Switch, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import Plot from '../../../components/ThemedPlot';
import { MultiColumnSelector } from '../../../components/MultiColumnSelector';
import { notify } from '../../../store/notificationStore';
import { analysisInWorker } from '../../../utils/analysisWorker';
import type { GmmSelectionResult } from '../../../utils/statistics/gaussianMixture';
import { useMethodData, addResultColumn, addTextColumn, addReportTable, fmt } from './methodsCommon';
import { VisibleOnlySwitch } from './methodsControls';

type Transform = 'none' | 'log10';

export const GaussianMixtureSection: React.FC = () => {
    const data = useMethodData();
    const [cols, setCols] = useState<string[]>([]);
    const [transform, setTransform] = useState<Transform>('log10');
    const [standardise, setStandardise] = useState(true);
    const [kMax, setKMax] = useState('6');
    const [fixedK, setFixedK] = useState('');
    const [bootstrap, setBootstrap] = useState('0');
    const [visibleOnly, setVisibleOnly] = useState(true);
    const [running, setRunning] = useState(false);
    const [res, setRes] = useState<{ r: GmmSelectionResult; rowIndex: number[]; cols: string[]; transform: Transform } | null>(null);

    if (!data.rowCount) return null;
    const options = data.numericColumns.map(name => ({ name, alias: data.display(name) === name ? null : data.display(name) }));

    const run = async () => {
        setRunning(true);
        try {
            const vis = visibleOnly ? data.visibleMask() : null;
            const rowIndex: number[] = [];
            for (let i = 0; i < data.rowCount; i++) if (!vis || vis[i]) rowIndex.push(i);
            const columns = cols.map(c => {
                const v = data.values(c)!;
                return Float64Array.from(rowIndex, i => (transform === 'log10' ? (v[i] > 0 ? Math.log10(v[i]) : NaN) : v[i]));
            });
            const k = parseInt(fixedK, 10);
            const r = await analysisInWorker<GmmSelectionResult>('gmmSelect', {
                config: {
                    columns, standardise, nInit: 20, seed: 42,
                    kMin: Number.isFinite(k) ? k : 1, kMax: Number.isFinite(k) ? k : Math.max(1, parseInt(kMax, 10) || 6),
                    bootstrap: Math.max(0, parseInt(bootstrap, 10) || 0),
                },
            });
            setRes({ r, rowIndex, cols, transform });
        } catch (err) {
            notify(`Gaussian mixture failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
        } finally {
            setRunning(false);
        }
    };

    const add = () => {
        if (!res) return;
        const { r, rowIndex } = res;
        const labels = new Array<string>(data.rowCount).fill('');
        const prob = new Float64Array(data.rowCount).fill(NaN);
        r.rows.forEach((j, n) => { const row = rowIndex[j]; labels[row] = `G${r.model.labels[n] + 1}`; prob[row] = r.model.maxProbability[n]; });
        const params = { method: 'Gaussian mixture (full covariance, EM, BIC)', columns: res.cols, transform: res.transform, standardise, k: r.model.k, bic: r.bic };
        const a = addTextColumn(`GMM${r.model.k}`, labels, `Gaussian mixture group (k = ${r.model.k}) of ${res.cols.join(', ')}`, params);
        const b = addResultColumn(`GMM${r.model.k}_prob`, prob, `Probability of the assigned Gaussian mixture group (k = ${r.model.k})`, params);
        notify(`Added ${[a, b].filter(Boolean).join(' and ')}: colour by the group, and check samples with low probability`, 'success');
    };

    const toReport = () => {
        if (!res) return;
        addReportTable('Gaussian mixture: groups chosen by BIC',
            `Full-covariance Gaussian mixtures fitted to ${res.cols.map(data.display).join(', ')}${res.transform === 'log10' ? ' (log10)' : ''}${standardise ? ', standardised' : ''}, k = ${res.r.bic[0].k}–${res.r.bic.at(-1)!.k}, best of 20 starts each. Lowest BIC: k = ${res.r.kBest}.${Object.keys(res.r.bootstrapK).length ? ` Bootstrap choice of k: ${Object.entries(res.r.bootstrapK).map(([k, v]) => `${k}: ${v}`).join(', ')}.` : ''}`,
            ['k', 'BIC'], res.r.bic.map(b => [b.k, b.bic]));
        notify('BIC table added to the report', 'success');
    };

    const counts = res ? Array.from({ length: res.r.model.k }, (_, g) => res.r.model.labels.filter(l => l === g).length) : [];
    const uncertain = res ? res.r.model.maxProbability.filter(p => p < 0.8).length : 0;

    return (
        <Paper sx={{ p: 2, mt: 3 }}>
            <Typography variant="h6" sx={{ mb: 0.5 }}>Gaussian mixture (groups chosen by BIC)</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Fits 1 to k overlapping bell-shaped groups and keeps the number with the lowest BIC (fit traded against complexity;
                differences under ~10 are weak). Every sample gets the probability of its group, so samples at contacts show as
                uncertain. For rock types, use ratios of immobile elements (e.g. Zr/Ti, Cr/Ti) on a log scale, not alteration-prone ones.
            </Typography>
            <Stack spacing={1.5}>
                <MultiColumnSelector columns={options} selectedColumns={cols} onChange={setCols} label="Variables" />
                <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap alignItems="center">
                    <TextField select size="small" label="Transform" value={transform} onChange={e => setTransform(e.target.value as Transform)} sx={{ width: 130 }}>
                        <MenuItem value="log10">log10</MenuItem>
                        <MenuItem value="none">None</MenuItem>
                    </TextField>
                    <FormControlLabel control={<Switch size="small" checked={standardise} onChange={e => setStandardise(e.target.checked)} />} label="Standardise" />
                    <TextField size="small" label="Try k up to" value={kMax} onChange={e => setKMax(e.target.value)} sx={{ width: 110 }} />
                    <TextField size="small" label="Or fix k" value={fixedK} onChange={e => setFixedK(e.target.value)} sx={{ width: 100 }} placeholder="by BIC" />
                    <TextField size="small" label="Bootstrap runs" value={bootstrap} onChange={e => setBootstrap(e.target.value)} sx={{ width: 130 }} />
                    <VisibleOnlySwitch value={visibleOnly} onChange={setVisibleOnly} />
                </Stack>
                <Stack direction="row" spacing={1.5}>
                    <Button variant="contained" onClick={run} disabled={running || !cols.length}>{running ? <CircularProgress size={18} /> : 'Fit mixtures'}</Button>
                    {res && <Button variant="outlined" onClick={add}>Add groups as columns</Button>}
                    {res && <Button variant="outlined" onClick={toReport}>Add to report</Button>}
                </Stack>
            </Stack>
            {res && (
                <Box sx={{ mt: 2 }}>
                    {uncertain > 0 && <Alert severity="info" sx={{ mb: 1 }}>{uncertain} sample{uncertain === 1 ? '' : 's'} below 80% probability of their group: contacts, mixed or unusual samples.</Alert>}
                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
                        <Plot
                            data={[{ x: res.r.bic.map(b => b.k), y: res.r.bic.map(b => b.bic), type: 'scatter', mode: 'lines+markers', name: 'BIC' }]}
                            layout={{ title: { text: `BIC by number of groups (best k = ${res.r.kBest}${res.r.bic.length === 1 ? ', fixed' : ''})` }, height: 300, margin: { l: 55, r: 10, t: 40, b: 45 }, xaxis: { title: { text: 'k' }, dtick: 1 }, yaxis: { title: { text: 'BIC (lower is better)' } } }}
                            config={{ displaylogo: false, responsive: true }} style={{ width: '100%' }} useResizeHandler
                        />
                        {res.cols.length >= 2 && (
                            <Plot
                                data={Array.from({ length: res.r.model.k }, (_, g) => {
                                    const pts = res.r.rows.map((j, n) => ({ j, n })).filter(p => res.r.model.labels[p.n] === g);
                                    const v = (c: number) => { const col = data.values(res.cols[c])!; return pts.map(p => col[res.rowIndex[p.j]]); };
                                    return { x: v(0), y: v(1), type: 'scatter' as const, mode: 'markers' as const, name: `G${g + 1} (${counts[g]})`, marker: { size: 6, opacity: 0.8 } };
                                })}
                                layout={{ height: 300, margin: { l: 55, r: 10, t: 20, b: 45 }, xaxis: { title: { text: data.display(res.cols[0]) }, type: res.transform === 'log10' ? 'log' : 'linear' }, yaxis: { title: { text: data.display(res.cols[1]) }, type: res.transform === 'log10' ? 'log' : 'linear' } }}
                                config={{ displaylogo: false, responsive: true }} style={{ width: '100%' }} useResizeHandler
                            />
                        )}
                    </Box>
                    <Table size="small" sx={{ mt: 1 }}>
                        <TableHead><TableRow><TableCell>Group</TableCell><TableCell align="right">Samples</TableCell><TableCell align="right">Weight</TableCell>{res.cols.map(c => <TableCell key={c} align="right">Centre: {data.display(c)}{standardise ? ' (std.)' : ''}</TableCell>)}</TableRow></TableHead>
                        <TableBody>
                            {res.r.model.means.map((m, g) => (
                                <TableRow key={g}><TableCell>G{g + 1}</TableCell><TableCell align="right">{counts[g]}</TableCell><TableCell align="right">{fmt(res.r.model.weights[g], 2)}</TableCell>{m.map((v, j) => <TableCell key={j} align="right">{fmt(v)}</TableCell>)}</TableRow>
                            ))}
                        </TableBody>
                    </Table>
                    {Object.keys(res.r.bootstrapK).length > 0 && (
                        <Typography variant="caption" color="text.secondary">
                            Bootstrap: k chosen {Object.entries(res.r.bootstrapK).map(([k, v]) => `${k} (${v}×)`).join(', ')}. A k chosen in most resamples is a stable result.
                        </Typography>
                    )}
                </Box>
            )}
        </Paper>
    );
};
