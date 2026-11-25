/**
 * Variable screening: rank every candidate column against a target by AUC
 * and Spearman rho, with p-values that respect the order of the samples
 * (circular shift: slide the target past the variable, keeping each
 * series' own auto-correlation) and Benjamini-Hochberg q-values, because
 * testing many variables at once guarantees some flukes.
 */
import React, { useMemo, useState } from 'react';
import {
    Box, Button, CircularProgress, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import { useAppStore } from '../../../store/appStore';
import { ColumnPicker } from '../../../components/ColumnPicker';
import { MultiColumnSelector } from '../../../components/MultiColumnSelector';
import { notify } from '../../../store/notificationStore';
import { analysisInWorker } from '../../../utils/analysisWorker';
import type { ScreeningRow } from '../../../utils/statistics/targetEvaluation';
import { useSequenceSettings, useMethodData, sequenceOrder, addReportTable, fmt } from './methodsCommon';
import { SequenceFields, VisibleOnlySwitch } from './methodsControls';

export const ScreeningPanel: React.FC = () => {
    const data = useMethodData();
    const seq = useSequenceSettings();
    const mappings = useAppStore(s => s.geochemMappings);
    const elementCols = useMemo(() => {
        const el = new Set(mappings.filter(m => !m.isExcluded && (m.userOverride ?? m.detectedElement) && !m.role).map(m => m.originalName));
        return data.numericColumns.filter(c => el.has(c) && !/_err$/i.test(c));
    }, [mappings, data.numericColumns]);
    const [chosen, setChosen] = useState<string[] | null>(null);
    const candidates = chosen ?? elementCols;
    const [target, setTarget] = useState('');
    const [threshold, setThreshold] = useState('');
    const [minShift, setMinShift] = useState('15');
    const [visibleOnly, setVisibleOnly] = useState(true);
    const [running, setRunning] = useState(false);
    const [rows, setRows] = useState<ScreeningRow[] | null>(null);
    const [ran, setRan] = useState<{ target: string; threshold: number } | null>(null);

    if (!data.rowCount) return <Typography color="text.secondary">Load data to screen variables.</Typography>;
    const options = data.numericColumns.map(name => ({ name, alias: data.display(name) === name ? null : data.display(name) }));

    const go = async () => {
        const thr = parseFloat(threshold);
        const t = data.values(target);
        if (!t || !Number.isFinite(thr)) return;
        setRunning(true);
        try {
            const order = sequenceOrder(data, seq, visibleOnly ? data.visibleMask() : null).filter(i => Number.isFinite(t[i]));
            const pick = (v: Float64Array) => Float64Array.from(order, i => v[i]);
            const features = candidates.filter(c => c !== target).map(c => ({ name: c, values: pick(data.values(c)!) }));
            setRows(await analysisInWorker<ScreeningRow[]>('screenVariables', {
                features, target: pick(t),
                options: { threshold: thr, minShift: Math.max(1, parseInt(minShift, 10) || 15), resamples: 300, seed: 42 },
            }));
            setRan({ target, threshold: thr });
        } catch (err) {
            notify(`Screening failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
        } finally {
            setRunning(false);
        }
    };

    const toReport = () => {
        if (!rows || !ran) return;
        addReportTable(`Variable screening against ${data.display(ran.target)} ≥ ${ran.threshold}`,
            `Each variable's AUC (0.5 = no relationship; below 0.5 = lower values go with the target) and Spearman ρ with ${data.display(ran.target)}. p-values from circular shifts of the target along the sample order (shifts of at least ${minShift}), which keep the auto-correlation of both series; q = Benjamini-Hochberg false-discovery rate across all ${rows.length} variables.`,
            ['Variable', 'n', 'AUC', '95% interval', 'p (AUC)', 'q', 'Spearman ρ', 'p (ρ)'],
            rows.map(r => [data.display(r.name), r.n, r.auc, `${fmt(r.aucCI[0], 2)}–${fmt(r.aucCI[1], 2)}`, r.pShiftAuc, r.q, r.rho, r.pShiftRho]));
        notify('Screening table added to the report', 'success');
    };

    return (
        <Box>
            <Typography variant="h6" sx={{ mb: 0.5 }}>Variable screening</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Ranks every candidate against the target. Ordinary p-values assume independent samples and are far too small down a
                hole; here the target is slid past each variable along the sample order (a circular shift), so the "no relationship"
                case keeps the real auto-correlation. q-values correct for testing many variables at once.
            </Typography>
            <Paper sx={{ p: 2, mb: 2 }}>
                <Stack spacing={1.5}>
                    <MultiColumnSelector columns={options} selectedColumns={candidates} onChange={setChosen} label="Candidates (default: element columns)" />
                    <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap alignItems="center">
                        <ColumnPicker label="Target" value={target} onChange={setTarget} minWidth={200} />
                        <TextField size="small" label="Target hit at ≥" value={threshold} onChange={e => setThreshold(e.target.value)} sx={{ width: 140 }} />
                        <TextField size="small" label="Smallest shift (samples)" value={minShift} onChange={e => setMinShift(e.target.value)} sx={{ width: 170 }} />
                        <VisibleOnlySwitch value={visibleOnly} onChange={setVisibleOnly} />
                    </Stack>
                    <SequenceFields />
                    <Stack direction="row" spacing={1.5}>
                        <Button variant="contained" onClick={go} disabled={running || !candidates.length || !target || !Number.isFinite(parseFloat(threshold))}>
                            {running ? <CircularProgress size={18} /> : 'Screen'}
                        </Button>
                        {rows && <Button variant="outlined" onClick={toReport}>Add to report</Button>}
                    </Stack>
                </Stack>
            </Paper>
            {rows && (
                <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell>Variable</TableCell><TableCell align="right">n</TableCell><TableCell align="right">AUC</TableCell>
                                <TableCell align="right">95% interval</TableCell><TableCell align="right">p (AUC)</TableCell><TableCell align="right">q</TableCell>
                                <TableCell align="right">Spearman ρ</TableCell><TableCell align="right">p (ρ)</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {rows.map(r => (
                                <TableRow key={r.name} sx={{ opacity: r.q <= 0.1 ? 1 : 0.6 }}>
                                    <TableCell>{data.display(r.name)}</TableCell>
                                    <TableCell align="right">{r.n}</TableCell>
                                    <TableCell align="right" sx={{ fontWeight: 600 }}>{fmt(r.auc)}</TableCell>
                                    <TableCell align="right">{fmt(r.aucCI[0], 2)}–{fmt(r.aucCI[1], 2)}</TableCell>
                                    <TableCell align="right">{fmt(r.pShiftAuc)}</TableCell>
                                    <TableCell align="right">{fmt(r.q)}</TableCell>
                                    <TableCell align="right">{fmt(r.rho)}</TableCell>
                                    <TableCell align="right">{fmt(r.pShiftRho)}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                    <Typography variant="caption" color="text.secondary" sx={{ p: 1, display: 'block' }}>Rows with q above 0.1 are dimmed.</Typography>
                </Paper>
            )}
        </Box>
    );
};
