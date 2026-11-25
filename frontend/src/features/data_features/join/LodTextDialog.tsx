/**
 * Convert a result column holding below-detection text ("<LOD", "<LOD: -1.2",
 * "<0.5", "ND") into numbers, optionally using the instrument's own signed
 * reading and per-row detection limit from companion columns.
 *
 * Writes up to three columns:
 *   <name>_cens    below detection as −DL (GeoChem's convention)
 *   <name>_half    below detection as DL / 2 (a plain number for quick plots)
 *   <name>_signed  the instrument's signed reading (negative values kept;
 *                  unbiased for averages, correlations and ranking)
 * Blank results are failed reads and stay blank in all three.
 */
import React, { useMemo, useState } from 'react';
import {
    Alert, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Stack, Typography,
} from '@mui/material';
import { useAppStore } from '../../../store/appStore';
import { notify } from '../../../store/notificationStore';
import { ColumnPicker } from '../../../components/ColumnPicker';
import { convertLodText } from '../../../utils/instrumentLod';
import { setColumnCensoring } from '../../../utils/columnCensoring';
import { useDataToolsStore } from './dataToolsStore';

export const LodTextDialog: React.FC = () => {
    const open = useDataToolsStore(s => s.lodOpen);
    const close = () => useDataToolsStore.getState().setLodOpen(false);
    const columnar = useAppStore(s => s.columnarData);
    const [column, setColumn] = useState('');
    const [signed, setSigned] = useState('');
    const [limit, setLimit] = useState('');
    const [outCens, setOutCens] = useState(true);
    const [outHalf, setOutHalf] = useState(false);
    const [outSigned, setOutSigned] = useState(true);

    const result = useMemo(() => {
        if (!open || !column) return null;
        const v = columnar.columns.get(column);
        if (!v) return null;
        return convertLodText(v, { signed: signed ? columnar.columns.get(signed) : null, limit: limit ? columnar.columns.get(limit) : null });
    }, [open, column, signed, limit, columnar]);

    const apply = () => {
        if (!result) return;
        const store = useAppStore.getState();
        const base = column.replace(/\s*\(.*?\)\s*/g, '').trim().replace(/\s+/g, '_') || column;
        const derivation = (what: string) => ({
            kind: 'other' as const, created: new Date().toISOString(),
            description: `${column}: ${what}`, params: { source: column, signed: signed || null, limit: limit || null },
        });
        const num = (a: Float64Array) => Array.from(a, v => (Number.isFinite(v) ? v : null));
        const made: string[] = [];
        if (outCens) {
            const n = store.addColumn(`${base}_cens`, num(result.censored), 'numeric', 'Joined', null, undefined, derivation('below detection stored as −DL'), 'unique');
            // Its negatives are detection limits: substituted per Settings like any element column
            if (n) { made.push(n); setColumnCensoring(n, 'limits'); }
        }
        if (outHalf) {
            const half = Float64Array.from(result.censored, v => (v < 0 ? -v / 2 : v));
            const n = store.addColumn(`${base}_half`, num(half), 'numeric', 'Joined', null, undefined, derivation('below detection as half the detection limit'), 'unique');
            if (n) made.push(n);
        }
        if (outSigned && signed) {
            const n = store.addColumn(`${base}_signed`, num(result.signed), 'numeric', 'Joined', null, undefined, derivation('instrument signed reading, negatives kept'), 'unique');
            // Negative readings are values, whatever the column is later mapped as
            if (n) { made.push(n); setColumnCensoring(n, 'signed'); }
        }
        notify(`Added ${made.join(', ')}`, 'success');
        close();
    };

    const c = result?.counts;
    return (
        <Dialog open={open} onClose={close} maxWidth="sm" fullWidth>
            <DialogTitle>Below-detection text to numbers</DialogTitle>
            <DialogContent dividers>
                <Stack spacing={2}>
                    <Typography variant="body2" color="text.secondary">
                        For a result column that came in as text because some cells read "&lt;LOD" or "&lt;0.5". Setting those to zero
                        biases averages and hides how far below the limit the reading was. If the instrument also exports its signed
                        reading, keep it: it is the least biased value for averages, correlations and ranking.
                    </Typography>
                    <ColumnPicker label="Result column (text)" value={column} onChange={setColumn} filter="all" minWidth={260} />
                    <ColumnPicker label="Signed reading (optional)" value={signed} onChange={setSigned} filter="all" allowNone minWidth={260} />
                    <ColumnPicker label="Detection limit per row (optional)" value={limit} onChange={setLimit} filter="all" allowNone minWidth={260} />
                    <Stack direction="row" spacing={1} flexWrap="wrap">
                        <FormControlLabel control={<Checkbox size="small" checked={outCens} onChange={e => setOutCens(e.target.checked)} />} label="_cens (−DL)" />
                        <FormControlLabel control={<Checkbox size="small" checked={outHalf} onChange={e => setOutHalf(e.target.checked)} />} label="_half (DL / 2)" />
                        <FormControlLabel control={<Checkbox size="small" checked={outSigned} disabled={!signed} onChange={e => setOutSigned(e.target.checked)} />} label="_signed" />
                    </Stack>
                    {c && (
                        <Alert severity={c.unparsed ? 'warning' : 'info'}>
                            {c.measured} measured · {c.belowLod} below detection{c.negative ? ` (${c.negative} signed readings below zero)` : ''} · {c.missing} blank (failed reads)
                            {c.limitUnknown > 0 && ` · ${c.limitUnknown} below detection with no known limit (left blank in _cens / _half)`}
                            {c.unparsed > 0 && ` · ${c.unparsed} unreadable, e.g. ${result!.unparsedExamples.slice(0, 3).map(s => `"${s}"`).join(', ')}`}
                        </Alert>
                    )}
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={close}>Cancel</Button>
                <Button variant="contained" onClick={apply} disabled={!result || !(outCens || outHalf || (outSigned && signed))}>Add columns</Button>
            </DialogActions>
        </Dialog>
    );
};
