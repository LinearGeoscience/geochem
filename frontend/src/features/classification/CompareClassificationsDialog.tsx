/**
 * Compare classifications: your colour groups (or any text column) against
 * another text column, such as logging, an earlier scheme or a colleague's
 * answer. Overall agreement, Cohen's kappa, and a cross-tab with recall
 * (per column-class) and precision (per row-class). Copy as TSV.
 */
import React, { useMemo, useState } from 'react';
import {
    Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, FormControlLabel, InputLabel,
    MenuItem, Select, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography,
} from '@mui/material';
import { ContentCopy } from '@mui/icons-material';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../store/appStore';
import { useUIStore } from '../../store/uiStore';
import { notify } from '../../store/notificationStore';
import { isNumericType } from '../../utils/columnGroups';
import { attributeColumnValues, getStyleArraysColumnar } from '../../utils/attributeUtils';
import { compareClassifications, normLabel, type ClassComparison } from '../../utils/ruleClassifier';
import { useStyleInputs } from '../../hooks/useStyleInputs';

const COLOUR_GROUPS = '__colour_groups__';
const pct = (v: number | null) => (v === null ? '–' : `${Math.round(v * 100)} %`);

function toTsv(c: ClassComparison, aName: string, bName: string): string {
    const lines = [[`${aName} \\ ${bName}`, ...c.bClasses, 'Total', 'Precision'].join('\t')];
    c.aClasses.forEach((a, i) => {
        const tot = c.counts[i].reduce((s, n) => s + n, 0);
        lines.push([a, ...c.counts[i], tot, pct(c.precision[a])].join('\t'));
    });
    lines.push(['Recall', ...c.bClasses.map(b => pct(c.recall[b]))].join('\t'));
    lines.push(`Agreement\t${pct(c.total ? c.agree / c.total : null)}\tKappa\t${c.kappa?.toFixed(3) ?? '–'}\tRows\t${c.total}`);
    return lines.join('\n');
}

export const CompareClassificationsDialog: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
    const { columns, columnarData } = useAppStore(useShallow(s => ({ columns: s.columns, columnarData: s.columnarData })));
    // Recompute when the colour groups change
    const attrStamp = useStyleInputs();
    const text = useMemo(() => columns.filter(c => !isNumericType(c.type)).map(c => c.name), [columns]);
    const [aCol, setACol] = useState(COLOUR_GROUPS);
    const [bCol, setBCol] = useState(() => useUIStore.getState().compareReference ?? '');
    const [visibleOnly, setVisibleOnly] = useState(false);
    const b = bCol || text[0] || '';

    const result = useMemo(() => {
        if (!open || !b) return null;
        const app = useAppStore.getState();
        const n = app.columnarData.rowCount;
        const getRaw = (c: string) => app.getRawColumn(c);
        const a = aCol === COLOUR_GROUPS ? attributeColumnValues('color', n, getRaw) : app.getRawColumn(aCol);
        const bv = app.getRawColumn(b);
        if (!a || !bv) return null;
        let rows: number[] | undefined;
        if (visibleOnly) {
            const vis = getStyleArraysColumnar(n, c => app.getColumn(c)).visible;
            rows = [];
            for (let i = 0; i < n; i++) if (vis[i]) rows.push(i);
        }
        return compareClassifications(a, bv, { rows });
        // columnarData / attrStamp: change signals for data read through getState()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, aCol, b, visibleOnly, columnarData, attrStamp]);

    const aName = aCol === COLOUR_GROUPS ? 'Colour groups' : aCol;
    const max = result ? Math.max(1, ...result.counts.flat()) : 1;

    return (
        <Dialog open={open} onClose={onClose} maxWidth="xl" fullWidth data-testid="compare-classifications">
            <DialogTitle>Compare classifications</DialogTitle>
            <DialogContent dividers>
                <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2, flexWrap: 'wrap' }}>
                    <FormControl size="small" sx={{ minWidth: 220 }}>
                        <InputLabel>Rows: classification</InputLabel>
                        <Select label="Rows: classification" value={aCol} onChange={e => setACol(e.target.value)}>
                            <MenuItem value={COLOUR_GROUPS}><em>Colour groups (Attribute Manager)</em></MenuItem>
                            {text.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                        </Select>
                    </FormControl>
                    <Typography>vs</Typography>
                    <FormControl size="small" sx={{ minWidth: 220 }}>
                        <InputLabel>Columns: reference</InputLabel>
                        <Select label="Columns: reference" value={b} onChange={e => setBCol(e.target.value)}>
                            {text.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                        </Select>
                    </FormControl>
                    <FormControlLabel control={<Checkbox size="small" checked={visibleOnly} onChange={e => setVisibleOnly(e.target.checked)} />}
                        label={<Typography variant="body2">Visible rows only</Typography>} />
                </Stack>
                {!text.length && <Typography color="text.secondary">The dataset has no text columns to compare against.</Typography>}
                {result && (
                    <>
                        <Stack direction="row" spacing={4} sx={{ mb: 1.5 }}>
                            <Typography variant="h6" data-testid="compare-agreement">
                                {pct(result.total ? result.agree / result.total : null)} agree
                            </Typography>
                            <Typography variant="body1" sx={{ alignSelf: 'center' }} data-testid="compare-kappa">
                                Cohen's κ {result.kappa?.toFixed(2) ?? '–'} · {result.agree} of {result.total} rows
                            </Typography>
                        </Stack>
                        <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
                            Groups match by name (case, spaces and hyphens ignored). Recall: share of each reference class your
                            classification put in the class of the same name. Precision: share of each of your groups the reference agrees with.
                        </Typography>
                        <TableContainer sx={{ maxHeight: 520 }}>
                            <Table size="small" stickyHeader>
                                <TableHead>
                                    <TableRow>
                                        <TableCell sx={{ fontWeight: 600 }}>{aName} \ {b}</TableCell>
                                        {result.bClasses.map(c => <TableCell key={c} align="right" sx={{ fontWeight: 600 }}>{c}</TableCell>)}
                                        <TableCell align="right" sx={{ fontWeight: 600 }}>Total</TableCell>
                                        <TableCell align="right" sx={{ fontWeight: 600 }}>Precision</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {result.aClasses.map((a, i) => (
                                        <TableRow key={a} hover>
                                            <TableCell sx={{ fontWeight: 600 }}>{a}</TableCell>
                                            {result.bClasses.map((c, j) => {
                                                const n = result.counts[i][j];
                                                const same = normLabel(a) === normLabel(c);
                                                return (
                                                    <TableCell key={c} align="right" sx={{
                                                        bgcolor: n ? (same ? `rgba(46,125,50,${0.15 + 0.6 * n / max})` : `rgba(198,40,40,${0.08 + 0.5 * n / max})`) : undefined,
                                                        fontWeight: same ? 600 : undefined,
                                                    }}>{n || ''}</TableCell>
                                                );
                                            })}
                                            <TableCell align="right">{result.counts[i].reduce((s, n) => s + n, 0)}</TableCell>
                                            <TableCell align="right">{pct(result.precision[a])}</TableCell>
                                        </TableRow>
                                    ))}
                                    <TableRow>
                                        <TableCell sx={{ fontWeight: 600 }}>Recall</TableCell>
                                        {result.bClasses.map(c => <TableCell key={c} align="right" sx={{ fontWeight: 600 }}>{pct(result.recall[c])}</TableCell>)}
                                        <TableCell /><TableCell />
                                    </TableRow>
                                </TableBody>
                            </Table>
                        </TableContainer>
                    </>
                )}
            </DialogContent>
            <DialogActions>
                <Button startIcon={<ContentCopy fontSize="small" />} disabled={!result}
                    onClick={() => { void navigator.clipboard.writeText(toTsv(result!, aName, b)).then(() => notify('Copied table', 'success')); }}>
                    Copy table
                </Button>
                <Box sx={{ flex: 1 }} />
                <Button onClick={onClose}>Close</Button>
            </DialogActions>
        </Dialog>
    );
};
