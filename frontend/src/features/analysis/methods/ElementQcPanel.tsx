/**
 * Element QC: % detected, median detected value and median relative 1-sigma
 * error for every element column, with a suggested tier (reliable / care /
 * reject) from editable rules. Rejected elements can be excluded from the
 * element lists in one step (Columns > Chemistry undoes it).
 */
import React, { useMemo, useState } from 'react';
import {
    Box, Button, Chip, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import { useAppStore } from '../../../store/appStore';
import { notify } from '../../../store/notificationStore';
import { elementQc, pairedErrorColumns, PXRF_QC_DEFAULTS, type ElementQcRow, type QcTier } from '../../../utils/elementQc';
import { useMethodData, addReportTable, fmt } from './methodsCommon';

const TIER_COLOR: Record<QcTier, 'success' | 'warning' | 'error'> = { reliable: 'success', care: 'warning', reject: 'error' };
const list = (s: string) => s.split(/[,\s]+/).map(x => x.trim()).filter(Boolean);

export const ElementQcPanel: React.FC = () => {
    const data = useMethodData();
    const mappings = useAppStore(s => s.geochemMappings);
    const [rejectBelow, setRejectBelow] = useState(String(PXRF_QC_DEFAULTS.rejectBelowPct));
    const [careBelow, setCareBelow] = useState(String(PXRF_QC_DEFAULTS.careBelowPct));
    const [careError, setCareError] = useState(String(PXRF_QC_DEFAULTS.careAboveErrorPct));
    const [artefacts, setArtefacts] = useState(PXRF_QC_DEFAULTS.artefacts.join(', '));
    const [careList, setCareList] = useState(PXRF_QC_DEFAULTS.careList.join(', '));
    const [rows, setRows] = useState<ElementQcRow[] | null>(null);

    // Element columns (concentrations, not their error columns: those map to no element)
    const elementColumns = useMemo(() => mappings
        .filter(m => (m.userOverride ?? m.detectedElement) && !m.role && !m.pairedElement)
        .filter(m => !!data.rawValues(m.originalName))
        .map(m => ({ column: m.originalName, element: (m.userOverride ?? m.detectedElement) as string })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mappings, data.numericColumns]);

    if (!data.rowCount) return <Typography color="text.secondary">Load data to check elements.</Typography>;

    const errorColumnFor = (col: string, el: string): string | null => {
        const names = new Set(data.numericColumns);
        const paired = pairedErrorColumns(mappings, names).get(el);
        if (paired) return paired;
        // A mapping changed by hand: the usual names
        for (const c of [`${col}_err`, `${el}_err`, `${el} Error`, `${el}_error`]) if (names.has(c)) return c;
        return null;
    };

    const run = () => {
        const rules = {
            rejectBelowPct: parseFloat(rejectBelow) || 0, careBelowPct: parseFloat(careBelow) || 0,
            careAboveErrorPct: parseFloat(careError) || Infinity, artefacts: list(artefacts), careList: list(careList),
        };
        setRows(elementQc(elementColumns.map(({ column, element }) => {
            const err = errorColumnFor(column, element);
            return { element, column, raw: data.rawValues(column)!, error: err ? data.rawValues(err) : null };
        }), rules));
    };

    const exclude = () => {
        if (!rows) return;
        const rejected = rows.filter(r => r.tier === 'reject');
        const update = useAppStore.getState().updateGeochemMapping;
        for (const r of rejected) update(r.column, { isExcluded: true });
        notify(`Excluded ${rejected.length} element${rejected.length === 1 ? '' : 's'} from element lists (Columns > Chemistry to undo)`, 'success');
    };

    const toReport = () => {
        if (!rows) return;
        addReportTable('Element QC',
            `Per element: % of samples detected, median and 95th percentile of detected values, median relative 1-sigma error. Tiers: reject if on the artefact list (${artefacts}) or detected in under ${rejectBelow}%; care if detected in under ${careBelow}%, median error above ${careError}%, or on the care list (${careList}).`,
            ['Element', 'Detected %', 'Median', 'P95', 'Median 1σ error %', 'Tier', 'Why'],
            rows.map(r => [r.element, r.pctDetected.toFixed(0), r.medianDetected, r.p95Detected, r.medianRelErrPct, r.tier, r.reasons.join('; ')]));
        notify('Element QC added to the report', 'success');
    };

    return (
        <Box>
            <Typography variant="h6" sx={{ mb: 0.5 }}>Element QC</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Which elements can be used? Detection rate and the instrument's own 1-sigma counting error (from the
                <code> _err</code> columns of a pXRF import) give a suggested tier. Edit the rules: for a handheld XRF read through a bag,
                light elements are attenuated, and Bi, Cd and the light REE are often spectral-overlap artefacts.
            </Typography>
            <Paper sx={{ p: 2, mb: 2 }}>
                <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                    <TextField size="small" label="Reject if detected % <" value={rejectBelow} onChange={e => setRejectBelow(e.target.value)} sx={{ width: 170 }} />
                    <TextField size="small" label="Care if detected % <" value={careBelow} onChange={e => setCareBelow(e.target.value)} sx={{ width: 160 }} />
                    <TextField size="small" label="Care if 1σ error % >" value={careError} onChange={e => setCareError(e.target.value)} sx={{ width: 160 }} />
                    <TextField size="small" label="Artefacts (always reject)" value={artefacts} onChange={e => setArtefacts(e.target.value)} sx={{ minWidth: 240 }} />
                    <TextField size="small" label="Always care" value={careList} onChange={e => setCareList(e.target.value)} sx={{ minWidth: 220 }} />
                </Stack>
                <Stack direction="row" spacing={1.5} sx={{ mt: 1.5 }}>
                    <Button variant="contained" onClick={run} disabled={!elementColumns.length}>Check {elementColumns.length} elements</Button>
                    {rows && <Button variant="outlined" color="error" onClick={exclude}>Exclude rejected</Button>}
                    {rows && <Button variant="outlined" onClick={toReport}>Add to report</Button>}
                </Stack>
            </Paper>
            {rows && (
                <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell>Element</TableCell><TableCell align="right">Detected</TableCell><TableCell align="right">Median</TableCell>
                                <TableCell align="right">P95</TableCell><TableCell align="right">Median 1σ error</TableCell><TableCell>Tier</TableCell><TableCell>Why</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {rows.map(r => (
                                <TableRow key={r.column}>
                                    <TableCell>{r.element}</TableCell>
                                    <TableCell align="right">{r.pctDetected.toFixed(0)}%</TableCell>
                                    <TableCell align="right">{fmt(r.medianDetected)}</TableCell>
                                    <TableCell align="right">{fmt(r.p95Detected)}</TableCell>
                                    <TableCell align="right">{Number.isFinite(r.medianRelErrPct) ? `${r.medianRelErrPct.toFixed(1)}%` : '–'}</TableCell>
                                    <TableCell><Chip size="small" label={r.tier} color={TIER_COLOR[r.tier]} variant="outlined" /></TableCell>
                                    <TableCell sx={{ color: 'text.secondary' }}>{r.reasons.join('; ')}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </Paper>
            )}
        </Box>
    );
};
