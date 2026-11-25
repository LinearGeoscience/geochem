/**
 * Join a second table (CSV / text, an Excel sheet, or cells pasted from a spreadsheet) onto the
 * dataset by a key column: a left join, so the dataset keeps every row and
 * gains the chosen columns where the key matches. Row filters drop rows of
 * the second table first (blanks, standards, repeats); a duplicate-key rule
 * says which reading wins. The summary lists keys that did not match, which
 * is where typos and relabelled samples show up.
 */
import React, { useMemo, useState } from 'react';
import Papa from 'papaparse';
import {
    Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import { Delete } from '@mui/icons-material';
import { useAppStore } from '../../../store/appStore';
import { useAuditStore } from '../../../store/auditStore';
import { notify } from '../../../store/notificationStore';
import { dataApi } from '../../../services/api';
import { applyColourGroups } from '../../../utils/colourGroups';
import { recordsFrom, DUPLICATE_HELP } from './joinTable';
import { ColumnPicker } from '../../../components/ColumnPicker';
import { MultiColumnSelector } from '../../../components/MultiColumnSelector';
import { joinOnKey, isMostlyNumeric, type DuplicateRule, type JoinFilter, type JoinFilterOp, type JoinResult } from '../../../utils/joinOnKey';
import { cellNumber, looksLikeLodText } from '../../../utils/instrumentLod';
import { useDataToolsStore } from './dataToolsStore';

const OPS: Array<{ op: JoinFilterOp; label: string; needsValue: boolean }> = [
    { op: 'equals', label: 'equals', needsValue: true },
    { op: 'not-equals', label: 'is not', needsValue: true },
    { op: 'starts-with', label: 'starts with', needsValue: true },
    { op: 'not-starts-with', label: 'does not start with', needsValue: true },
    { op: 'contains', label: 'contains', needsValue: true },
    { op: 'blank', label: 'is blank', needsValue: false },
    { op: 'not-blank', label: 'is not blank', needsValue: false },
];

interface Table {
    name: string;
    fields: string[];
    rows: Record<string, unknown>[];
    /** Excel: the workbook, its sheets and the one read */
    workbook?: { file: File; sheets: string[]; sheet: string };
}

// Text is parsed here, cell for cell ("0012" stays "0012")

function parseTable(text: string, name: string): Table {
    const res = Papa.parse<Record<string, unknown>>(text.trimStart(), { header: true, skipEmptyLines: 'greedy', dynamicTyping: false, transformHeader: h => h.trim() });
    return { name, fields: (res.meta.fields ?? []).filter(Boolean), rows: res.data };
}

export const JoinTableDialog: React.FC = () => {
    const open = useDataToolsStore(s => s.joinOpen);
    const close = () => useDataToolsStore.getState().setJoinOpen(false);
    const rowCount = useAppStore(s => s.columnarData.rowCount);
    const [table, setTable] = useState<Table | null>(null);
    const [paste, setPaste] = useState('');
    const [leftKey, setLeftKey] = useState('');
    const [rightKey, setRightKey] = useState('');
    const [columns, setColumns] = useState<string[]>([]);
    const [filters, setFilters] = useState<JoinFilter[]>([]);
    const [duplicates, setDuplicates] = useState<DuplicateRule>('first');
    const [ignoreCase, setIgnoreCase] = useState(true);
    const [prefix, setPrefix] = useState('');
    const [hideUnmatched, setHideUnmatched] = useState(false);
    const [reading, setReading] = useState(false);

    const load = (t: Table) => {
        setTable(t);
        setRightKey(t.fields[0] ?? '');
        setColumns(t.fields.slice(1));
        setFilters([]);
    };

    const readWorkbook = async (file: File, sheet?: string) => {
        setReading(true);
        try {
            const t = await dataApi.readSheet(file, sheet);
            load({ name: `${file.name} [${t.sheet}]`, fields: t.fields, rows: recordsFrom(t.fields, t.rows), workbook: { file, sheets: t.sheets, sheet: t.sheet } });
        } catch (e: unknown) {
            const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
            notify(detail ?? `Could not read ${file.name}`, 'error');
        } finally {
            setReading(false);
        }
    };

    const onFile = async (f: File | undefined) => {
        if (!f) return;
        if (/\.(xlsx|xlsm|xls)$/i.test(f.name)) { await readWorkbook(f); return; }
        load(parseTable(await f.text(), f.name));
    };

    const result: JoinResult | null = useMemo(() => {
        if (!open || !table || !leftKey || !rightKey || !columns.length) return null;
        const keys = useAppStore.getState().columnarData.columns.get(leftKey);
        if (!keys) return null;
        return joinOnKey(keys, table.rows, rightKey, { columns, filters: filters.filter(f => !OPS.find(o => o.op === f.op)?.needsValue || f.value), duplicates, ignoreCase });
    }, [open, table, leftKey, rightKey, columns, filters, duplicates, ignoreCase]);

    const apply = () => {
        if (!result || !table || result.blocked) return;
        const store = useAppStore.getState();
        const made: string[] = [];
        const lodText: string[] = [];
        for (const c of columns) {
            const v = result.values[c];
            const derivation = {
                kind: 'other' as const, created: new Date().toISOString(),
                description: `Joined from ${table.name} on ${leftKey} = ${rightKey}`,
                params: { file: table.name, leftKey, rightKey, column: c, filters, duplicates, ignoreCase },
            };
            const numeric = isMostlyNumeric(v);
            if (!numeric && looksLikeLodText(v)) lodText.push(c);
            const name = store.addColumn(`${prefix}${c}`, numeric ? v.map(x => cellNumber(x)) : v.map(x => (x === null || x === undefined ? null : String(x))),
                numeric ? 'numeric' : 'categorical', 'Joined', null, undefined, derivation, 'unique');
            if (name) made.push(name);
        }
        let hidden = 0;
        if (hideUnmatched && result.unmatchedRows.length) {
            hidden = applyColourGroups([{ name: `No match in ${table.name}`, color: '#9e9e9e', indices: result.unmatchedRows, visible: false }]).rows;
        }
        useAuditStore.getState().recordAudit({
            category: 'column-operation',
            operation: 'Join table by key',
            description: `Joined ${made.length} column${made.length === 1 ? '' : 's'} from ${table.name} on ${leftKey} = ${rightKey}`,
            details: `${result.matched} of ${rowCount} rows matched; ${result.unmatchedLeft} without a match, ${result.blankLeftKeys} with a blank key; `
                + `${result.unmatchedRight.length} table keys matched no row; ${result.duplicateKeys.length} keys repeated (rule: ${DUPLICATE_HELP[duplicates].toLowerCase()})`
                + `${result.rightRowsFiltered ? `; ${result.rightRowsFiltered} table rows filtered out` : ''}${hidden ? `; ${hidden} unmatched rows hidden` : ''}.`,
            parameters: { file: table.name, leftKey, rightKey, filters, duplicates, ignoreCase, prefix },
            inputColumns: [leftKey],
            outputColumns: made,
            rowsAffected: result.matched,
        });
        notify(`Joined ${made.length} column${made.length === 1 ? '' : 's'} onto ${result.matched} of ${rowCount} rows${hidden ? `; ${hidden} rows without a match hidden (painted group)` : ''}${lodText.length ? `. ${lodText.join(', ')} hold below-detection text: Data > Below-detection text converts them` : ''}`, 'success');
        close();
    };

    const fieldOptions = (table?.fields ?? []).map(name => ({ name, alias: null }));

    return (
        <Dialog open={open} onClose={close} maxWidth="md" fullWidth>
            <DialogTitle>Join a table by key</DialogTitle>
            <DialogContent dividers>
                <Stack spacing={2}>
                    <Typography variant="body2" color="text.secondary">
                        Brings columns from another table (assays, a second instrument) onto matching rows, keyed by sample ID. Every
                        dataset row is kept; rows without a match get blanks. Joined columns are not treated as element columns, so a
                        signed reading below zero stays a number.
                    </Typography>
                    <Stack direction="row" spacing={1.5} alignItems="flex-start">
                        <Button variant="outlined" component="label" disabled={reading} sx={{ flexShrink: 0 }}>
                            {reading ? 'Reading…' : 'Choose file (CSV, Excel)'}
                            <input hidden type="file" accept=".csv,.txt,.tsv,.xlsx,.xlsm,.xls" onChange={e => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
                        </Button>
                        <TextField size="small" multiline minRows={1} maxRows={4} fullWidth label="…or paste cells (with the header row)" value={paste}
                            onChange={e => setPaste(e.target.value)} />
                        <Button disabled={!paste.trim()} onClick={() => load(parseTable(paste, 'pasted table'))}>Use</Button>
                    </Stack>
                    {table && (
                        <>
                            <Stack direction="row" spacing={1.5} alignItems="center">
                                {table.workbook && table.workbook.sheets.length > 1 && (
                                    <TextField select size="small" label="Sheet" value={table.workbook.sheet} disabled={reading}
                                        onChange={e => void readWorkbook(table.workbook!.file, e.target.value)} sx={{ minWidth: 220 }}>
                                        {table.workbook.sheets.map(sh => <MenuItem key={sh} value={sh}>{sh}</MenuItem>)}
                                    </TextField>
                                )}
                                <Typography variant="body2">{table.name}: {table.rows.length} rows, {table.fields.length} columns</Typography>
                            </Stack>
                            <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap alignItems="center">
                                <ColumnPicker label="Dataset key" value={leftKey} onChange={setLeftKey} filter="all" minWidth={200} />
                                <TextField select size="small" label="Table key" value={rightKey} onChange={e => setRightKey(e.target.value)} sx={{ minWidth: 200 }}>
                                    {table.fields.map(f => <MenuItem key={f} value={f}>{f}</MenuItem>)}
                                </TextField>
                                <FormControlLabel control={<Checkbox size="small" checked={ignoreCase} onChange={e => setIgnoreCase(e.target.checked)} />} label="Ignore case and spaces at the ends" />
                            </Stack>
                            <MultiColumnSelector columns={fieldOptions.filter(f => f.name !== rightKey)} selectedColumns={columns} onChange={setColumns} label="Columns to bring" />
                            <Box>
                                <Typography variant="subtitle2">Keep only table rows where</Typography>
                                {filters.map((f, k) => {
                                    const op = OPS.find(o => o.op === f.op)!;
                                    const upd = (p: Partial<JoinFilter>) => setFilters(filters.map((x, j) => (j === k ? { ...x, ...p } : x)));
                                    return (
                                        <Stack key={k} direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
                                            <TextField select size="small" value={f.column} onChange={e => upd({ column: e.target.value })} sx={{ minWidth: 180 }}>
                                                {table.fields.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                                            </TextField>
                                            <TextField select size="small" value={f.op} onChange={e => upd({ op: e.target.value as JoinFilterOp })} sx={{ minWidth: 170 }}>
                                                {OPS.map(o => <MenuItem key={o.op} value={o.op}>{o.label}</MenuItem>)}
                                            </TextField>
                                            {op.needsValue && <TextField size="small" value={f.value ?? ''} onChange={e => upd({ value: e.target.value })} sx={{ width: 160 }} />}
                                            <IconButton size="small" onClick={() => setFilters(filters.filter((_, j) => j !== k))}><Delete fontSize="small" /></IconButton>
                                        </Stack>
                                    );
                                })}
                                <Button size="small" sx={{ mt: 0.5 }} onClick={() => setFilters([...filters, { column: table.fields[0], op: 'starts-with', value: '' }])}>Add condition</Button>
                            </Box>
                            <Stack direction="row" spacing={1.5} alignItems="center">
                                <TextField select size="small" label="Same key more than once" value={duplicates} onChange={e => setDuplicates(e.target.value as DuplicateRule)} sx={{ minWidth: 240 }}>
                                    {(Object.keys(DUPLICATE_HELP) as DuplicateRule[]).map(r => <MenuItem key={r} value={r}>{DUPLICATE_HELP[r]}</MenuItem>)}
                                </TextField>
                                <TextField size="small" label="Prefix for new columns" value={prefix} onChange={e => setPrefix(e.target.value)} sx={{ width: 190 }} />
                            </Stack>
                            <FormControlLabel
                                control={<Checkbox size="small" checked={hideUnmatched} onChange={e => setHideUnmatched(e.target.checked)} />}
                                label="Hide dataset rows without a match (a hidden painted group; no row is deleted)"
                            />
                        </>
                    )}
                    {result && (
                        <Alert severity={result.blocked ? 'error' : result.matched ? 'info' : 'warning'}>
                            {result.blocked && 'Nothing will be joined: some keys repeat. Choose another rule for repeated keys, or filter the repeats out. '}
                            {result.matched} of {rowCount} dataset rows matched ({result.rightRowsUsed} table rows after filters; {result.rightRowsFiltered} filtered out).
                            {result.unmatchedLeft > 0 && ` ${result.unmatchedLeft} dataset rows have no match${result.blankLeftKeys ? ` (${result.blankLeftKeys} with a blank key)` : ''}.`}
                            {result.unmatchedRight.length > 0 && ` ${result.unmatchedRight.length} table keys match nothing: ${result.unmatchedRight.slice(0, 8).join(', ')}${result.unmatchedRight.length > 8 ? '…' : ''}.`}
                            {result.duplicateKeys.length > 0 && ` ${result.duplicateKeys.length} keys appear more than once: ${result.duplicateKeys.slice(0, 6).join(', ')}${result.duplicateKeys.length > 6 ? '…' : ''}.`}
                            {result.notAveraged > 0 && ` ${result.notAveraged} repeated cells were not all numbers, so the first value was used.`}
                        </Alert>
                    )}
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={close}>Cancel</Button>
                <Button variant="contained" onClick={apply} disabled={!result?.matched || result.blocked}>Join {columns.length} column{columns.length === 1 ? '' : 's'}</Button>
            </DialogActions>
        </Dialog>
    );
};
