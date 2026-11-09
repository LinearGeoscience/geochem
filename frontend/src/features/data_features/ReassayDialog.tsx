/**
 * Over-limit re-assays (Data > Re-assays): find ore-grade re-assay rows,
 * report samples that exist ONLY as a re-assay row (their base suite is
 * missing from the export - every other element is absent for the most
 * mineralised samples), and merge re-assay grades into the base rows where
 * the base value is missing or capped at the upper limit.
 */
import React, { useMemo, useState } from 'react';
import {
    Alert, Autocomplete, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Table, TableBody, TableCell,
    TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import { useAppStore } from '../../store/appStore';
import { useUIStore } from '../../store/uiStore';
import { useAuditStore } from '../../store/auditStore';
import { notify } from '../../store/notificationStore';
import { isNumericColumn } from '../../types/columnarData';
import { censorableColumns } from '../../utils/censoring';
import {
    detectReassayMethods, mergeReassays, methodColumnCandidates, reassayStatus, scanReassays, type ReassayInput,
} from '../../utils/reassays';

const STATUS_COLUMN = 'ReassayStatus';

export const ReassayDialog: React.FC = () => {
    const open = useUIStore(s => s.reassaysOpen);
    const setOpen = useUIStore(s => s.setReassaysOpen);
    return open ? <ReassayBody onClose={() => setOpen(false)} /> : null;
};

const ReassayBody: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const columns = useAppStore(s => s.columns);
    const columnarData = useAppStore(s => s.columnarData);
    const mappings = useAppStore(s => s.geochemMappings);
    const n = columnarData.rowCount;

    const idColumn = columns.find(c => c.role === 'ID')?.name ?? '';
    const holeColumn = columns.find(c => c.role === 'HoleID')?.name ?? '';
    const textColumns = useMemo(() => columns.filter(c => c.type !== 'numeric' && c.type !== 'float' && c.type !== 'integer').map(c => c.name), [columns]);

    // Default method column: a likely-named column that holds re-assay codes
    const defaultMethod = useMemo(() => {
        const raw = (c: string) => useAppStore.getState().getRawColumn(c) as ArrayLike<unknown> | undefined;
        const cands = methodColumnCandidates(columns);
        return cands.find(c => detectReassayMethods(raw(c) ?? []).length > 0) ?? cands[0] ?? '';
    }, [columns]);
    const [methodColumn, setMethodColumn] = useState(defaultMethod);
    const methodValues = useMemo(() => {
        const col = methodColumn ? (useAppStore.getState().getRawColumn(methodColumn) as ArrayLike<unknown> | undefined) : undefined;
        if (!col) return { all: [] as string[], detected: [] as string[] };
        const all = new Set<string>();
        for (let i = 0; i < col.length && all.size < 300; i++) if (col[i] !== null && col[i] !== undefined && col[i] !== '') all.add(String(col[i]).trim());
        return { all: [...all].sort(), detected: detectReassayMethods(col) };
    }, [methodColumn, columnarData]); // eslint-disable-line react-hooks/exhaustive-deps
    const [chosen, setChosen] = useState<string[] | null>(null);
    const reMethods = chosen ?? methodValues.detected;

    const input = useMemo((): ReassayInput | null => {
        const app = useAppStore.getState();
        const ids = idColumn ? (app.getRawColumn(idColumn) as ArrayLike<unknown> | undefined) : undefined;
        const methods = methodColumn ? (app.getRawColumn(methodColumn) as ArrayLike<unknown> | undefined) : undefined;
        if (!ids || !methods || !reMethods.length) return null;
        const elements: Record<string, ArrayLike<number>> = {};
        for (const name of censorableColumns(mappings)) {
            const col = columnarData.columns.get(name);
            if (col && isNumericColumn(col)) elements[name] = col;
        }
        const holes = holeColumn ? (app.getRawColumn(holeColumn) as ArrayLike<unknown> | undefined) : undefined;
        return { ids, methods, holes, reassayMethods: reMethods, elements };
    }, [idColumn, methodColumn, holeColumn, reMethods, mappings, columnarData]);
    const scan = useMemo(() => (input ? scanReassays(input) : null), [input]);
    const mergeCells = scan ? scan.mergeable.reduce((a, m) => a + m.missing + m.capped, 0) : 0;

    const addStatus = () => {
        if (!scan) return;
        useAppStore.getState().addColumn(STATUS_COLUMN, reassayStatus(n, scan), 'categorical', 'Classification');
    };
    const audit = (operation: string, description: string, outputColumns: string[], rows: number) =>
        useAuditStore.getState().recordAudit({
            category: 'column-operation', operation, description,
            parameters: { idColumn, methodColumn, reassayMethods: reMethods },
            inputColumns: [idColumn, methodColumn], outputColumns, rowsAffected: rows,
        });

    const onStatus = () => {
        addStatus();
        audit('Re-assays: status column', `${STATUS_COLUMN}: ${scan!.paired} re-assays with a base row, ${scan!.orphans} without`, [STATUS_COLUMN], n);
        notify(`Added ${STATUS_COLUMN}`, 'success');
        onClose();
    };
    const onMerge = () => {
        if (!input || !scan) return;
        const { columns: merged, cells } = mergeReassays(input, scan);
        useAppStore.getState().applyColumnEdits({ replace: Object.entries(merged).map(([name, values]) => ({ name, values, numeric: true })) });
        addStatus();
        audit('Re-assays: merge', `Merged ${cells} re-assay grades into base rows (${scan.mergeable.map(m => m.column).join(', ')})`, [...Object.keys(merged), STATUS_COLUMN], cells);
        notify(`Merged ${cells.toLocaleString()} re-assay values into base rows`, 'success');
        onClose();
    };

    return (
        <Dialog open onClose={onClose} maxWidth="md" fullWidth>
            <DialogTitle>Over-limit re-assays</DialogTitle>
            <DialogContent>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Ore-grade re-assays give a second row per sample: the true grade of a few elements. GeoChem pairs them with the
                    base analysis by sample ID ({idColumn || 'no ID column'}).
                </Typography>
                {!idColumn && <Alert severity="warning" sx={{ mb: 2 }}>No column has the ID role; set it in Columns first.</Alert>}
                <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
                    <TextField select size="small" label="Method / lab code column" value={methodColumn} sx={{ minWidth: 240 }}
                        onChange={(e) => { setMethodColumn(e.target.value); setChosen(null); }}>
                        {textColumns.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                    </TextField>
                    <Autocomplete multiple size="small" sx={{ flex: 1, minWidth: 280 }} options={methodValues.all} value={reMethods}
                        onChange={(_, v) => setChosen(v)}
                        renderInput={(p) => <TextField {...p} label="Re-assay methods" helperText="Detected from codes ending OG / OL, 'over limit', 're-assay'" />} />
                </Box>

                {scan && (
                    <>
                        <Typography variant="body2" sx={{ mb: 1 }}>
                            <b>{scan.reassayRows.toLocaleString()}</b> re-assay rows: {scan.paired.toLocaleString()} with a base row,{' '}
                            <b>{scan.orphans.toLocaleString()}</b> without.
                        </Typography>
                        {scan.orphans > 0 && (
                            <Alert severity="warning" sx={{ mb: 2 }}>
                                {scan.orphans.toLocaleString()} samples exist only as a re-assay row: their base suite (all the other elements) is
                                not in this dataset, so the most mineralised samples are missing from multi-element plots, PCA and indices.
                                Ask for a re-export with the base results. By hole: {scan.orphansByHole.slice(0, 10).map(([h, c]) => `${h} ${c}`).join(', ')}
                                {scan.orphansByHole.length > 10 ? ', …' : ''}.
                            </Alert>
                        )}
                        {scan.mergeable.length > 0 ? (
                            <>
                                <Typography variant="subtitle2">Grades the merge would write into base rows</Typography>
                                <Table size="small" sx={{ mb: 1 }}>
                                    <TableHead><TableRow><TableCell>Column</TableCell><TableCell align="right">Capped at the limit</TableCell><TableCell align="right">Missing</TableCell></TableRow></TableHead>
                                    <TableBody>
                                        {scan.mergeable.map(m => (
                                            <TableRow key={m.column}><TableCell>{m.column}</TableCell><TableCell align="right">{m.capped}</TableCell><TableCell align="right">{m.missing}</TableCell></TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </>
                        ) : scan.paired > 0 ? <Typography variant="body2" color="text.secondary">Base rows already hold every re-assay grade.</Typography> : null}
                    </>
                )}
                {!scan && idColumn && <Typography variant="body2" color="text.secondary">Choose the method column and the re-assay methods.</Typography>}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Close</Button>
                <Button disabled={!scan || scan.reassayRows === 0} onClick={onStatus}>Add {STATUS_COLUMN} column</Button>
                <Button variant="contained" disabled={!mergeCells} onClick={onMerge}>Merge {mergeCells.toLocaleString()} values</Button>
            </DialogActions>
        </Dialog>
    );
};
