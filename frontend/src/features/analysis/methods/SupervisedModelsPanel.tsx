/**
 * Supervised models (logistic regression, random forest, XGBoost) scored by
 * honest cross-validation: whole holes left out, or contiguous blocks of
 * samples with a buffer, never a random split. The training-data score is
 * shown beside the cross-validated one, because a model that scores 1.00 on
 * its own training data and 0.6 on unseen blocks has memorised the samples,
 * not learnt the geology. Out-of-fold scores can be added as a column.
 *
 * Runs in the backend (scikit-learn / xgboost, optional packages).
 */
import React, { useEffect, useState } from 'react';
import {
    Alert, Box, Button, Checkbox, CircularProgress, FormControlLabel, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import { ColumnPicker } from '../../../components/ColumnPicker';
import { MultiColumnSelector } from '../../../components/MultiColumnSelector';
import { notify } from '../../../store/notificationStore';
import { analysisApi, type ModelKind, type ModelsResponse } from '../../../services/analysisApi';
import { useSequenceSettings, useMethodData, sequenceOrder, addResultColumn, addReportTable, fmt } from './methodsCommon';
import { SequenceFields, VisibleOnlySwitch } from './methodsControls';

const KIND_LABEL: Record<ModelKind, string> = { logistic: 'Elastic-net logistic', random_forest: 'Random forest', xgboost: 'XGBoost' };

export const SupervisedModelsPanel: React.FC = () => {
    const data = useMethodData();
    const seq = useSequenceSettings();
    const [available, setAvailable] = useState<Record<ModelKind, boolean> | null>(null);
    const [features, setFeatures] = useState<string[]>([]);
    const [target, setTarget] = useState('');
    const [threshold, setThreshold] = useState('');
    const [kinds, setKinds] = useState<ModelKind[]>(['logistic', 'xgboost']);
    const [monotone, setMonotone] = useState(true);
    const [depth, setDepth] = useState('2');
    const [trees, setTrees] = useState('200');
    const [cvKind, setCvKind] = useState<'block' | 'hole'>('block');
    const [blockLength, setBlockLength] = useState('12');
    const [buffer, setBuffer] = useState('2');
    const [visibleOnly, setVisibleOnly] = useState(true);
    const [running, setRunning] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [res, setRes] = useState<{ out: ModelsResponse; rows: number[]; target: string; threshold: number } | null>(null);

    useEffect(() => {
        analysisApi.available().then(setAvailable).catch(() => setAvailable(null));
    }, []);

    if (!data.rowCount) return <Typography color="text.secondary">Load data to train models.</Typography>;
    const options = data.numericColumns.map(name => ({ name, alias: data.display(name) === name ? null : data.display(name) }));

    const run = async () => {
        const thr = parseFloat(threshold);
        const t = data.values(target);
        if (!t || !Number.isFinite(thr) || !features.length) return;
        setRunning(true);
        setError(null);
        try {
            const rows = sequenceOrder(data, seq, visibleOnly ? data.visibleMask() : null).filter(i => Number.isFinite(t[i]));
            const val = (v: number) => (Number.isFinite(v) ? v : null);
            const feats: Record<string, Array<number | null>> = {};
            for (const f of features) { const c = data.values(f)!; feats[f] = rows.map(i => val(c[i])); }
            const hole = seq.holeColumn ? data.text(seq.holeColumn) : null;
            const spec = (kind: ModelKind) => ({
                kind, name: `${KIND_LABEL[kind]}${kind === 'xgboost' && monotone ? ' (monotone up)' : ''}`,
                depth: Math.max(1, parseInt(depth, 10) || 2), n_trees: Math.max(10, parseInt(trees, 10) || 200), learning_rate: 0.05,
                monotone: kind === 'xgboost' && monotone ? Object.fromEntries(features.map(f => [f, 1])) : null,
            });
            const out = await analysisApi.models({
                features: feats, target: rows.map(i => val(t[i])), threshold: thr, models: kinds.map(spec),
                cv: { kind: cvKind, block_length: Math.max(2, parseInt(blockLength, 10) || 12), buffer: Math.max(0, parseInt(buffer, 10) || 0), repeats: 10 },
                groups: hole ? rows.map(i => String(hole[i] ?? '')) : null, seed: 42,
            });
            setRes({ out, rows, target, threshold: thr });
        } catch (err: any) {
            setError(err?.response?.data?.detail ?? (err instanceof Error ? err.message : String(err)));
        } finally {
            setRunning(false);
        }
    };

    const addOof = (k: number) => {
        if (!res) return;
        const m = res.out.models[k];
        const values = new Float64Array(data.rowCount).fill(NaN);
        res.rows.forEach((row, j) => { const v = m.oof[j]; if (v !== null) values[row] = v; });
        const name = addResultColumn(`${m.kind}_cv_score`, values, `${m.name}: out-of-fold score (0–1 rank) for ${data.display(res.target)} ≥ ${res.threshold}`,
            { model: m.name, features: m.features, cv: cvKind === 'hole' ? 'leave hole out' : `blocks of ${blockLength}, buffer ${buffer}`, cvAuc: m.cv_auc, trainAuc: m.train_auc });
        if (name) notify(`Added ${name}: each sample scored by a model that never saw it or its neighbours`, 'success');
    };

    const toReport = () => {
        if (!res) return;
        addReportTable(`Supervised models for ${data.display(res.target)} ≥ ${res.threshold}`,
            `Cross-validated AUC: every sample scored by a model trained without it ${cvKind === 'hole' ? 'or its hole' : `or its block of ${blockLength} neighbours (and ${buffer} more either side)`}. Training AUC: the same model scored on its own training data. A large gap means the model memorised the samples. ${res.out.n} samples, ${res.out.n_target} at or above the cut-off.`,
            ['Model', 'Cross-validated AUC', 'Training AUC', 'Top features'],
            res.out.models.map(m => [m.name, m.cv_auc, m.train_auc, m.importance.slice(0, 4).map(i => data.display(i.feature)).join(', ')]));
        notify('Model table added to the report', 'success');
    };

    return (
        <Box>
            <Typography variant="h6" sx={{ mb: 0.5 }}>Supervised models</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Train a model to predict the target from chosen columns, scored only on samples it never saw. Neighbours down a hole are
                alike, so random splits leak the answer; here whole holes, or blocks of consecutive samples with a buffer, are held
                out. With few target samples, flexible models memorise: compare the training and cross-validated scores, and prefer
                monotone constraints (more of an indicator element never lowers the score) or a simple index.
            </Typography>
            {available === null && <Alert severity="warning" sx={{ mb: 2 }}>The backend is not reachable, or too old for supervised models.</Alert>}
            {available && !available.xgboost && (
                <Alert severity="info" sx={{ mb: 2 }}>
                    {available.logistic ? 'XGBoost is' : 'scikit-learn and XGBoost are'} not installed. Run <code>backend\venv\Scripts\python -m pip install -r backend\requirements-ml.txt</code> and restart GeoChem.
                </Alert>
            )}
            <Paper sx={{ p: 2, mb: 2 }}>
                <Stack spacing={1.5}>
                    <MultiColumnSelector columns={options} selectedColumns={features} onChange={setFeatures} label="Features" />
                    <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap alignItems="center">
                        <ColumnPicker label="Target" value={target} onChange={setTarget} minWidth={200} />
                        <TextField size="small" label="Target hit at ≥" value={threshold} onChange={e => setThreshold(e.target.value)} sx={{ width: 140 }} />
                        <VisibleOnlySwitch value={visibleOnly} onChange={setVisibleOnly} />
                    </Stack>
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
                        {(Object.keys(KIND_LABEL) as ModelKind[]).map(k => (
                            <FormControlLabel key={k} label={KIND_LABEL[k]} control={
                                <Checkbox size="small" checked={kinds.includes(k)} disabled={available ? !available[k] : false}
                                    onChange={e => setKinds(e.target.checked ? [...kinds, k] : kinds.filter(x => x !== k))} />} />
                        ))}
                        <FormControlLabel label="XGBoost monotone up" control={<Checkbox size="small" checked={monotone} onChange={e => setMonotone(e.target.checked)} />} />
                        <TextField size="small" label="Tree depth" value={depth} onChange={e => setDepth(e.target.value)} sx={{ width: 100 }} />
                        <TextField size="small" label="Trees" value={trees} onChange={e => setTrees(e.target.value)} sx={{ width: 90 }} />
                    </Stack>
                    <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap alignItems="center">
                        <TextField select size="small" label="Hold out" value={cvKind} onChange={e => setCvKind(e.target.value as 'block' | 'hole')} sx={{ width: 220 }}>
                            <MenuItem value="block">Blocks of consecutive samples</MenuItem>
                            <MenuItem value="hole" disabled={!seq.holeColumn}>Whole holes{seq.holeColumn ? '' : ' (set a hole column)'}</MenuItem>
                        </TextField>
                        {cvKind === 'block' && <TextField size="small" label="Block (samples)" value={blockLength} onChange={e => setBlockLength(e.target.value)} sx={{ width: 130 }} />}
                        {cvKind === 'block' && <TextField size="small" label="Buffer either side" value={buffer} onChange={e => setBuffer(e.target.value)} sx={{ width: 140 }} />}
                    </Stack>
                    <SequenceFields />
                    <Stack direction="row" spacing={1.5}>
                        <Button variant="contained" onClick={run} disabled={running || !features.length || !target || !kinds.length || !Number.isFinite(parseFloat(threshold))}>
                            {running ? <CircularProgress size={18} /> : 'Train and cross-validate'}
                        </Button>
                        {res && <Button variant="outlined" onClick={toReport}>Add to report</Button>}
                    </Stack>
                </Stack>
            </Paper>
            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
            {res && (
                <>
                    {res.out.n_target < 50 && (
                        <Alert severity="warning" sx={{ mb: 1 }}>Only {res.out.n_target} target samples: flexible models will overfit. Treat differences under ~0.05 AUC as noise.</Alert>
                    )}
                    <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
                        <Table size="small">
                            <TableHead>
                                <TableRow>
                                    <TableCell>Model</TableCell><TableCell align="right">Cross-validated AUC</TableCell><TableCell align="right">Training AUC</TableCell>
                                    <TableCell>Most important features</TableCell><TableCell />
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {res.out.models.map((m, k) => (
                                    <TableRow key={m.name}>
                                        <TableCell>{m.name}</TableCell>
                                        <TableCell align="right" sx={{ fontWeight: 600 }}>{fmt(m.cv_auc)}</TableCell>
                                        <TableCell align="right" sx={{ color: m.train_auc - m.cv_auc > 0.15 ? 'error.main' : undefined }}>{fmt(m.train_auc)}</TableCell>
                                        <TableCell>{m.importance.slice(0, 5).map(i => `${data.display(i.feature)} ${fmt(i.value, 2)}`).join(' · ')}</TableCell>
                                        <TableCell><Button size="small" onClick={() => addOof(k)}>Add scores</Button></TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </Paper>
                    <Typography variant="caption" color="text.secondary">{res.out.n} samples · {res.out.n_target} at or above {res.threshold}. Training AUC in red: more than 0.15 above the cross-validated score (memorised).</Typography>
                </>
            )}
        </Box>
    );
};
