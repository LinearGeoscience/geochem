/**
 * Detection and precision of the element columns being checked: % above
 * zero, % zero, % below detection, the smallest positive value and, where the
 * column has a paired 1-sigma error column (an instrument export), the median
 * relative error and signal-to-noise. Collapsed until asked for; exported as CSV.
 */
import React, { useMemo, useState } from 'react';
import { Box, Button, Collapse, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { ExpandLess, ExpandMore } from '@mui/icons-material';
import { useAppStore } from '../../store/appStore';
import { isNumericColumn } from '../../types/columnarData';
import { detectionSummaryCsv, elementQc, pairedErrorColumns } from '../../utils/elementQc';
import { downloadText } from '../../utils/gisExport';

const pct = (x: number) => (Number.isFinite(x) ? x.toFixed(0) : '–');
const num = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '–');
const val = (x: number) => (Number.isFinite(x) ? String(+x.toPrecision(4)) : '–');

export const DetectionSummary: React.FC<{ columns: string[] }> = ({ columns }) => {
    const [open, setOpen] = useState(false);
    const mappings = useAppStore(s => s.geochemMappings);
    const data = useAppStore(s => s.columnarData);

    const { rows, errors } = useMemo(() => {
        if (!open) return { rows: [], errors: new Map<string, string>() };
        const numeric = new Set([...data.columns.entries()].filter(([, c]) => isNumericColumn(c)).map(([n]) => n));
        const errors = pairedErrorColumns(mappings, numeric);
        const chosen = new Set(columns);
        const inputs = mappings
            .filter(m => chosen.has(m.originalName) && numeric.has(m.originalName) && !m.pairedElement && !m.role && (m.userOverride ?? m.detectedElement))
            .map(m => {
                const element = (m.userOverride ?? m.detectedElement) as string;
                const err = errors.get(element);
                return { element, column: m.originalName, raw: data.columns.get(m.originalName) as Float64Array, error: err ? (data.columns.get(err) as Float64Array) : null };
            });
        return { rows: elementQc(inputs), errors };
    }, [open, columns, mappings, data]);

    return (
        <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 0.5, cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
                {open ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
                <Typography variant="subtitle2">Detection and precision</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                    per element column: how often it is detected, its smallest reading and (with a 1-sigma error column) its precision
                </Typography>
                {open && rows.length > 0 && (
                    <Button size="small" onClick={e => { e.stopPropagation(); downloadText(detectionSummaryCsv(rows, errors), 'detection_and_precision.csv', 'text/csv'); }}>
                        Export CSV
                    </Button>
                )}
            </Box>
            <Collapse in={open} unmountOnExit>
                {rows.length === 0 ? (
                    <Typography variant="body2" color="text.secondary" sx={{ px: 2, pb: 1 }}>No element columns among the columns being checked.</Typography>
                ) : (
                    <TableContainer sx={{ maxHeight: 300 }}>
                        <Table size="small" stickyHeader>
                            <TableHead>
                                <TableRow>
                                    <TableCell>Column</TableCell>
                                    <TableCell align="right">Values</TableCell>
                                    <TableCell align="right">% &gt; 0</TableCell>
                                    <TableCell align="right">% zero</TableCell>
                                    <TableCell align="right">% below DL</TableCell>
                                    <TableCell align="right">Smallest &gt; 0</TableCell>
                                    <TableCell align="right">Median 1σ %</TableCell>
                                    <TableCell align="right">Median S/N</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {rows.map(r => (
                                    <TableRow key={r.column} hover>
                                        <TableCell>{r.column}</TableCell>
                                        <TableCell align="right">{r.n.toLocaleString()}</TableCell>
                                        <TableCell align="right">{pct(r.pctDetected)}</TableCell>
                                        <TableCell align="right">{pct(r.pctZero)}</TableCell>
                                        <TableCell align="right">{pct(r.pctBelow)}</TableCell>
                                        <TableCell align="right">{val(r.minPositive)}</TableCell>
                                        <TableCell align="right">{num(r.medianRelErrPct, 0)}</TableCell>
                                        <TableCell align="right">{num(r.medianSnr)}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                )}
            </Collapse>
        </Box>
    );
};
