/**
 * Build an additive index column from elements picked on a ranked scaled
 * eigenvector plot (or a PC end group): Σ CLR or Σ log10(ppm), each element
 * + (high = signature) or − (low = signature), optionally with log10(S*).
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
    Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
    FormControlLabel, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import { Timeline, Palette } from '@mui/icons-material';
import type { FullPCAResult } from '../../../types/compositional';
import { useAppStore } from '../../../store/appStore';
import { useAuditStore } from '../../../store/auditStore';
import { notify } from '../../../store/notificationStore';
import { contextFromStore } from '../../../utils/workflows/runner';
import {
    computePcaIndex, defaultIndexName, sulphideAvailable, symbolOf, inputsAreClr, IndexForm, IndexPick,
} from './pcaIndex';
import { colourByQuantiles } from './pcScoreColour';

interface Props {
    open: boolean;
    onClose: () => void;
    result: FullPCAResult;
    /** Picked PCA labels, in ranked order from the end inward */
    labels: string[];
    /** e.g. "PC1+" — recorded with the column */
    source: string;
}

function quantile(sorted: number[], q: number) {
    if (!sorted.length) return NaN;
    const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
const fmt = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : '–');

export const BuildIndexDialog: React.FC<Props> = ({ open, onClose, result, labels, source }) => {
    const columns = useAppStore(s => s.columns);
    const rowCount = useAppStore(s => s.columnarData.rowCount);
    const ctx = useMemo(() => contextFromStore(), [columns]); // eslint-disable-line react-hooks/exhaustive-deps -- columns = mapping version
    const canSulphide = useMemo(() => sulphideAvailable(ctx), [ctx]);
    const isClrColumn = useMemo(() => {
        const clr = new Set(columns.filter(c => c.transformationType === 'clr').map(c => c.name));
        return (n: string) => clr.has(n);
    }, [columns]);
    const clrInputs = useMemo(() => inputsAreClr(result, isClrColumn), [result, isClrColumn]);

    const [picks, setPicks] = useState<IndexPick[]>([]);
    const [form, setForm] = useState<IndexForm>('clr');
    const [sulphide, setSulphide] = useState(false);
    const [name, setName] = useState('');
    const [nameEdited, setNameEdited] = useState(false);
    const [made, setMade] = useState<string | null>(null);

    // Reset whenever the dialog opens on a new pick
    useEffect(() => {
        if (!open) return;
        setPicks(labels.map(label => ({ label, sign: 1 })));
        setForm(result.transform !== 'log10' || clrInputs ? 'clr' : 'log');
        setSulphide(canSulphide && labels.some(l => symbolOf(l) === 'S'));
        setNameEdited(false);
        setMade(null);
    }, [open, labels, result, canSulphide, clrInputs]);

    const spec = useMemo(() => ({ form, picks, sulphide }), [form, picks, sulphide]);
    useEffect(() => { if (!nameEdited) setName(defaultIndexName(spec)); }, [spec, nameEdited]);

    const preview = useMemo(() => {
        if (!open || (!picks.length && !sulphide)) return null;
        const s = useAppStore.getState();
        return computePcaIndex(result, spec, { rowCount, getNumeric: s.getNumericColumn, ctx, isClrColumn });
    }, [open, result, spec, rowCount, ctx, picks.length, sulphide, isClrColumn]);

    const stats = useMemo(() => {
        if (!preview || 'error' in preview) return null;
        const v = Array.from(preview.values).filter(Number.isFinite).sort((a, b) => a - b);
        return { p5: quantile(v, 0.05), p50: quantile(v, 0.5), p95: quantile(v, 0.95) };
    }, [preview]);

    const exists = columns.some(c => c.name === name.trim());

    const create = () => {
        if (!preview || 'error' in preview || !name.trim()) return;
        const store = useAppStore.getState();
        const created = new Date().toISOString();
        const groupId = `pca-index-${Date.now()}`;
        const colName = name.trim();
        const added = [colName];
        if (preview.sStar && !columns.some(c => c.name === 'S_star_ppm')) {
            store.addColumn('S_star_ppm', Array.from(preview.sStar.values, v => (Number.isFinite(v) ? v : null)), 'numeric', 'Calculated', null, groupId, {
                kind: 'calculation',
                description: `Sulphide S (barite-corrected): S* = ${preview.sStar.sColumn} − 0.234·${preview.sStar.baColumn} (ppm); ≤ 0 set to ${preview.sStar.floor.toPrecision(3)} ppm`,
                params: { sColumn: preview.sStar.sColumn, baColumn: preview.sStar.baColumn, floor: preview.sStar.floor },
                created,
            });
            added.unshift('S_star_ppm');
        }
        store.addColumn(colName, Array.from(preview.values, v => (Number.isFinite(v) ? v : null)), 'numeric', 'Calculated', null, groupId, {
            kind: 'pca',
            description: `${source} additive index: ${preview.formula}`,
            params: { form, source, elements: picks.map(p => symbolOf(p.label)), signs: picks.map(p => p.sign), sulphide },
            created,
        });
        useAuditStore.getState().recordAudit({
            category: 'calculation',
            operation: 'PCA Additive Index',
            description: `${colName} = ${preview.formula}`,
            parameters: { form, source, picks, sulphide },
            inputColumns: preview.inputColumns,
            outputColumns: added,
            rowsAffected: preview.valid,
        });
        notify(`Added ${added.join(' and ')}`, 'success');
        setMade(colName);
    };

    const openProbability = () => {
        if (!made) return;
        useAppStore.getState().addPlot('probability', { settings: { selectedColumns: [made] }, title: `Probability ${made}` });
        notify(`Opened a probability plot of ${made}`, 'success');
    };
    const colourBy = () => {
        if (!made) return;
        const r = colourByQuantiles(made);
        notify(r.message, r.ok ? 'success' : 'warning');
    };

    const error = preview && 'error' in preview ? preview.error : null;
    const hasS = labels.some(l => symbolOf(l) === 'S');

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>Build index from {source}</DialogTitle>
            <DialogContent dividers>
                <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
                    Elements in ranked order. Click a sign to make an element count against the index (low = signature).
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 2 }}>
                    {picks.map((p, k) => (
                        <Chip key={p.label} size="small" variant="outlined" color={p.sign > 0 ? 'success' : 'error'}
                            label={<span><b style={{ cursor: 'pointer' }}
                                onClick={() => setPicks(ps => ps.map((q, j) => (j === k ? { ...q, sign: q.sign > 0 ? -1 : 1 } : q)))}>
                                {p.sign > 0 ? '+' : '−'}</b> {symbolOf(p.label)}</span>}
                            onDelete={() => setPicks(ps => ps.filter((_, j) => j !== k))} />
                    ))}
                    {!picks.length && <Typography variant="body2" color="text.secondary">No elements left.</Typography>}
                </Box>

                <Typography variant="subtitle2" gutterBottom>Form</Typography>
                <ToggleButtonGroup size="small" exclusive value={form} onChange={(_, v) => v && setForm(v)} sx={{ mb: 0.5 }}>
                    <ToggleButton value="clr">Σ CLR</ToggleButton>
                    <ToggleButton value="log">Σ log10 (ppm)</ToggleButton>
                </ToggleButtonGroup>
                <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 2 }}>
                    {form === 'clr' && clrInputs
                        ? 'The PCA used CLR columns, so the index is the sum of those columns for the picked elements (e.g. BiAuCuMo = CLR-Bi + CLR-Au + CLR-Cu + CLR-Mo).'
                        : form === 'clr'
                        ? `Each element's centred log-ratio over the same ${result.columns.length} elements the PCA used, so the index follows the PCA (e.g. BiAuCuMo = CLR-Bi + CLR-Au + CLR-Cu + CLR-Mo). Rows missing any of those elements are blank.`
                        : 'Sum of log10 concentrations in ppm (units converted). Only the picked elements are needed.'}
                </Typography>

                <Tooltip title={canSulphide ? '' : 'Needs S and Ba columns'}>
                    <span>
                        <FormControlLabel disabled={!canSulphide}
                            control={<Checkbox size="small" checked={sulphide} onChange={e => setSulphide(e.target.checked)} />}
                            label={`Add log10(S*) — sulphide S = S − 0.234·Ba${hasS ? ' (replaces the picked S)' : ''}`} />
                    </span>
                </Tooltip>
                <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 2, ml: 4 }}>
                    Assumes all Ba is in barite. S* ≤ 0 is set to half the smallest positive S*. Also adds an S_star_ppm column.
                </Typography>

                <TextField size="small" fullWidth label="Column name" value={name}
                    onChange={e => { setName(e.target.value); setNameEdited(true); }}
                    helperText={exists ? 'A column with this name exists and will be replaced' : ' '}
                    FormHelperTextProps={{ sx: { color: exists ? 'warning.main' : undefined } }} />

                {error && <Alert severity="warning" sx={{ mt: 1 }}>{error}</Alert>}
                {preview && !('error' in preview) && stats && (
                    <Alert severity="info" icon={false} sx={{ mt: 1 }}>
                        <Typography variant="body2"><b>{name}</b> = {preview.formula}</Typography>
                        <Typography variant="caption" component="div">
                            {preview.valid.toLocaleString()} of {rowCount.toLocaleString()} rows ·
                            P5 {fmt(stats.p5)} · median {fmt(stats.p50)} · P95 {fmt(stats.p95)}
                            {preview.sStar && preview.sStar.floored > 0 && ` · S* floored on ${preview.sStar.floored.toLocaleString()} rows`}
                        </Typography>
                    </Alert>
                )}
                {made && (
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 2 }}>
                        <Typography variant="body2" sx={{ mr: 1 }}>Added <b>{made}</b>:</Typography>
                        <Button size="small" startIcon={<Timeline />} onClick={openProbability}>Probability plot</Button>
                        <Button size="small" startIcon={<Palette />} onClick={colourBy}>Colour samples by it</Button>
                    </Stack>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>{made ? 'Done' : 'Cancel'}</Button>
                <Button variant="contained" onClick={create} disabled={!!error || !preview || !name.trim()}>
                    Add column
                </Button>
            </DialogActions>
        </Dialog>
    );
};
