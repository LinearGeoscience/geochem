/**
 * Calculate Columns (Data > Calculate Columns / Transform presets).
 * Input columns get reference letters A, B, C…; each output row is an
 * expression in those letters and a new column name; Calculate All adds every
 * valid row. Sheets save to / load from JSON files and a saved list.
 * A second tab builds a weighted sum index (Garrett & Grunsky 2001).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, Menu,
    MenuItem, Radio, RadioGroup, Select, Switch, Tab, Table, TableBody, TableCell, TableHead, TableRow, Tabs,
    TextField, Tooltip, Typography,
} from '@mui/material';
import { Add, CheckCircle, Delete, ErrorOutline, FileOpen, Save } from '@mui/icons-material';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useAppStore } from '../../store/appStore';
import { useUIStore } from '../../store/uiStore';
import { useAuditStore } from '../../store/auditStore';
import { notify } from '../../store/notificationStore';
import { MultiColumnSelector } from '../../components/MultiColumnSelector';
import {
    CalcOutput, CalcSheet, checkSheet, evaluateSheet, inputsFor, PRESET_LABELS, PresetKind, presetSheet,
    VariateMode, weightedSum,
} from '../../utils/calculateColumns';

/** Saved sheets (browser-local), newest first */
const useSavedSheets = create<{ sheets: CalcSheet[]; save: (s: CalcSheet) => void; remove: (name: string) => void }>()(
    persist(
        (set) => ({
            sheets: [],
            save: (sheet) => set(s => ({ sheets: [sheet, ...s.sheets.filter(x => x.name !== sheet.name)].slice(0, 30) })),
            remove: (name) => set(s => ({ sheets: s.sheets.filter(x => x.name !== name) })),
        }),
        { name: 'calculate-columns-sheets' },
    ),
);

export const CalculateColumnsDialog: React.FC = () => {
    const request = useUIStore(s => s.calculateColumns);
    const close = () => useUIStore.getState().setCalculateColumns(null);
    const columns = useAppStore(s => s.columns);
    const rowCount = useAppStore(s => s.columnarData.rowCount);

    const [tab, setTab] = useState<'expressions' | 'weighted'>('expressions');
    const [inputCols, setInputCols] = useState<string[]>([]);
    const [outputs, setOutputs] = useState<CalcOutput[]>([]);
    const [mode, setMode] = useState<VariateMode>('multivariate');
    const [sheetName, setSheetName] = useState('');

    const applyPreset = (kind: PresetKind, cols: string[]) => {
        const sheet = presetSheet(kind, cols);
        setOutputs(sheet.outputs);
        setMode(sheet.mode);
    };

    useEffect(() => {
        if (!request) return;
        const cols = request.columns ?? [];
        setInputCols(cols);
        setSheetName('');
        setTab(request.preset === 'weighted' ? 'weighted' : 'expressions');
        applyPreset(request.preset && request.preset !== 'weighted' ? request.preset : 'blank', cols);
    }, [request]);

    const sheet: CalcSheet = useMemo(() => ({ name: sheetName || undefined, inputs: inputsFor(inputCols), outputs, mode }), [sheetName, inputCols, outputs, mode]);
    const existing = useMemo(() => columns.map(c => c.name), [columns]);
    const checks = useMemo(() => checkSheet(sheet, existing), [sheet, existing]);
    const okCount = checks.filter(c => !c.error).length;

    const setOutput = (i: number, patch: Partial<CalcOutput>) => setOutputs(o => o.map((x, k) => (k === i ? { ...x, ...patch } : x)));

    // Weighted sum tab
    const [weights, setWeights] = useState<Record<string, string>>({});
    const [wsLog, setWsLog] = useState(true);
    const [wsName, setWsName] = useState('WeightedSum');

    const numericOptions = useMemo(() => columns.filter(c => c.type !== 'categorical' && c.type !== 'text' && c.type !== 'string')
        .map(c => ({ name: c.name, alias: c.alias, priority: c.priority })), [columns]);

    const addColumns = (made: Array<{ name: string; values: Float64Array; description: string }>) => {
        const store = useAppStore.getState();
        const groupId = `calc-${Date.now()}`;
        const created = new Date().toISOString();
        for (const m of made) {
            store.addColumn(m.name, Array.from(m.values, v => (Number.isFinite(v) ? v : null)), 'numeric', 'Calculated', null, groupId,
                { kind: 'calculation', description: m.description, params: { inputs: sheet.inputs, mode }, created });
        }
        useAuditStore.getState().recordAudit({
            category: 'calculation',
            operation: 'Calculate Columns',
            description: `Calculated ${made.length} column${made.length === 1 ? '' : 's'}: ${made.map(m => m.name).join(', ')}`,
            parameters: { inputs: sheet.inputs, outputs: made.map(m => m.description), mode },
            inputColumns: inputCols,
            outputColumns: made.map(m => m.name),
            rowsAffected: rowCount,
        });
        notify(`Added ${made.length} column${made.length === 1 ? '' : 's'}`, 'success');
    };

    const calculateAll = () => {
        const s = useAppStore.getState();
        const results = evaluateSheet(sheet, n => s.getNumericColumn(n), rowCount, existing);
        const letterNote = sheet.inputs.map(i => `${i.letter}=${i.column}`).join(', ');
        addColumns(results.map(r => {
            const o = outputs.find(x => x.name.trim() === r.name)!;
            return { ...r, description: `${o.expression} (${letterNote})` };
        }));
        close();
    };

    const calculateWeighted = () => {
        const s = useAppStore.getState();
        const cols = inputCols.map(n => s.getNumericColumn(n)!).filter(Boolean);
        const w = inputCols.map(n => parseFloat(weights[n] ?? '1'));
        const values = weightedSum(cols, w, rowCount, { log: wsLog });
        addColumns([{
            name: wsName.trim(), values,
            description: `Weighted sum (Garrett & Grunsky 2001)${wsLog ? ' of log10' : ''}: ${inputCols.map((n, i) => `${w[i]}×${n}`).join(' + ')}`,
        }]);
        close();
    };
    const weightsValid = inputCols.length >= 2 && inputCols.every(n => Number.isFinite(parseFloat(weights[n] ?? '1')))
        && !!wsName.trim() && !existing.includes(wsName.trim());

    // Save / load
    const saved = useSavedSheets(s => s.sheets);
    const [loadAnchor, setLoadAnchor] = useState<HTMLElement | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    const loadSheet = (s: CalcSheet) => {
        setInputCols(s.inputs.map(i => i.column));
        setOutputs(s.outputs);
        setMode(s.mode ?? 'multivariate');
        setSheetName(s.name ?? '');
        const missing = s.inputs.filter(i => !existing.includes(i.column)).map(i => i.column);
        if (missing.length) notify(`Not in this dataset: ${missing.join(', ')}`, 'warning');
    };
    const saveSheet = () => {
        const name = sheetName.trim() || `Calculation ${new Date().toLocaleString()}`;
        const toSave = { ...sheet, name };
        useSavedSheets.getState().save(toSave);
        setSheetName(name);
        const blob = new Blob([JSON.stringify(toSave, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${name.replace(/[^\w-]+/g, '_')}.calc.json`;
        a.click();
        URL.revokeObjectURL(a.href);
    };
    const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        try {
            const s = JSON.parse(await f.text()) as CalcSheet;
            if (!Array.isArray(s.inputs) || !Array.isArray(s.outputs)) throw new Error('not a calculation sheet');
            loadSheet(s);
        } catch (err) {
            notify(`Could not load ${f.name}: ${(err as Error).message}`, 'error');
        }
    };

    return (
        <Dialog open={!!request} onClose={close} maxWidth="lg" fullWidth>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                Calculate Columns
                <Box sx={{ flex: 1 }} />
                {tab === 'expressions' && (
                    <>
                        <Select size="small" value="" displayEmpty onChange={e => applyPreset(e.target.value as PresetKind, inputCols)} sx={{ minWidth: 220 }}>
                            <MenuItem value="" disabled>Preset…</MenuItem>
                            {(Object.keys(PRESET_LABELS) as PresetKind[]).map(k => <MenuItem key={k} value={k}>{PRESET_LABELS[k]}</MenuItem>)}
                        </Select>
                        <TextField size="small" label="Sheet name" value={sheetName} onChange={e => setSheetName(e.target.value)} sx={{ width: 200 }} />
                        <Tooltip title="Save sheet (list + .calc.json file)"><IconButton onClick={saveSheet}><Save /></IconButton></Tooltip>
                        <Tooltip title="Load sheet"><IconButton onClick={e => setLoadAnchor(e.currentTarget)}><FileOpen /></IconButton></Tooltip>
                        <Menu anchorEl={loadAnchor} open={!!loadAnchor} onClose={() => setLoadAnchor(null)}>
                            <MenuItem onClick={() => { setLoadAnchor(null); fileRef.current?.click(); }}>From file…</MenuItem>
                            {saved.map(s => (
                                <MenuItem key={s.name} onClick={() => { setLoadAnchor(null); loadSheet(s); }}>
                                    {s.name} <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>({s.outputs.length} outputs)</Typography>
                                </MenuItem>
                            ))}
                        </Menu>
                        <input ref={fileRef} type="file" accept=".json" hidden onChange={onFile} />
                    </>
                )}
            </DialogTitle>
            <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2, minHeight: 420 }}>
                <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ minHeight: 36, '& .MuiTab-root': { minHeight: 36 } }}>
                    <Tab value="expressions" label="Expressions" />
                    <Tab value="weighted" label="Weighted sum" />
                </Tabs>
                <MultiColumnSelector
                    columns={numericOptions}
                    selectedColumns={inputCols}
                    onChange={setInputCols}
                    label="Input columns (in order: A, B, C…)"
                />
                {tab === 'expressions' ? (
                    <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', flexWrap: { xs: 'wrap', md: 'nowrap' } }}>
                        <Box sx={{ width: { xs: '100%', md: 260 }, flexShrink: 0, border: 1, borderColor: 'divider', borderRadius: 1, maxHeight: 360, overflow: 'auto' }}>
                            <Table size="small" stickyHeader>
                                <TableHead><TableRow><TableCell>Ref</TableCell><TableCell>Input column</TableCell></TableRow></TableHead>
                                <TableBody>
                                    {sheet.inputs.map(i => (
                                        <TableRow key={i.letter}>
                                            <TableCell sx={{ fontFamily: 'monospace', fontWeight: 600 }}>{i.letter}</TableCell>
                                            <TableCell>{i.column}</TableCell>
                                        </TableRow>
                                    ))}
                                    {sheet.inputs.length === 0 && (
                                        <TableRow><TableCell colSpan={2}><Typography variant="caption" color="text.secondary">Pick input columns above</Typography></TableCell></TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </Box>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, maxHeight: 360, overflow: 'auto' }}>
                                <Table size="small" stickyHeader>
                                    <TableHead>
                                        <TableRow>
                                            <TableCell padding="checkbox" />
                                            <TableCell sx={{ width: '45%' }}>Expression</TableCell>
                                            <TableCell>Output column</TableCell>
                                            <TableCell>Notes</TableCell>
                                            <TableCell padding="checkbox" />
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {outputs.map((o, i) => (
                                            <TableRow key={i}>
                                                <TableCell padding="checkbox">
                                                    <Tooltip title={checks[i]?.error ?? 'OK'}>
                                                        {checks[i]?.error
                                                            ? <ErrorOutline color="error" fontSize="small" />
                                                            : <CheckCircle color="success" fontSize="small" />}
                                                    </Tooltip>
                                                </TableCell>
                                                <TableCell>
                                                    <TextField size="small" fullWidth value={o.expression} placeholder="e.g. A/B, LOG10(A), -A"
                                                        inputProps={{ style: { fontFamily: 'monospace' } }}
                                                        onChange={e => setOutput(i, { expression: e.target.value })} />
                                                </TableCell>
                                                <TableCell>
                                                    <TextField size="small" fullWidth value={o.name} placeholder="New column"
                                                        onChange={e => setOutput(i, { name: e.target.value })} />
                                                </TableCell>
                                                <TableCell>
                                                    <TextField size="small" fullWidth value={o.notes ?? ''}
                                                        onChange={e => setOutput(i, { notes: e.target.value })} />
                                                </TableCell>
                                                <TableCell padding="checkbox">
                                                    <IconButton size="small" onClick={() => setOutputs(x => x.filter((_, k) => k !== i))}><Delete fontSize="small" /></IconButton>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 1, flexWrap: 'wrap' }}>
                                <Button size="small" startIcon={<Add />} onClick={() => setOutputs(o => [...o, { expression: '', name: '' }])}>Add row</Button>
                                <RadioGroup row value={mode} onChange={e => setMode(e.target.value as VariateMode)}>
                                    <Tooltip title="A missing input makes the result missing">
                                        <FormControlLabel value="multivariate" control={<Radio size="small" />} label="Multivariate" />
                                    </Tooltip>
                                    <Tooltip title="Missing inputs count as zero">
                                        <FormControlLabel value="univariate" control={<Radio size="small" />} label="Univariate" />
                                    </Tooltip>
                                </RadioGroup>
                                <Box sx={{ flex: 1 }} />
                                {outputs.length > 0 && (
                                    <Typography variant="body2" color={okCount === outputs.length ? 'success.main' : 'warning.main'}>
                                        {okCount === outputs.length ? 'Expressions OK' : `${outputs.length - okCount} of ${outputs.length} rows need attention`}
                                    </Typography>
                                )}
                            </Box>
                            <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
                                Functions: LOG10, LN, LOG, EXP, SQRT, ABS, MIN, MAX, POW, IF(cond, a, b); operators + − × / ^ and comparisons.
                                Below-detection values are used as substituted (BDL setting).
                            </Typography>
                        </Box>
                    </Box>
                ) : (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <Alert severity="info">
                            Weighted sum index (Garrett &amp; Grunsky 2001): each input is converted to a robust z-score
                            ((x − median) / 1.4826·MAD) and summed with the weights below, scaled to unit length. Use negative
                            weights for elements that should be low in the target signature.
                        </Alert>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
                            {inputCols.map(n => (
                                <TextField key={n} size="small" label={n} value={weights[n] ?? '1'} sx={{ width: 120 }}
                                    error={!Number.isFinite(parseFloat(weights[n] ?? '1'))}
                                    onChange={e => setWeights(w => ({ ...w, [n]: e.target.value }))} />
                            ))}
                        </Box>
                        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                            <FormControlLabel control={<Switch checked={wsLog} onChange={e => setWsLog(e.target.checked)} />} label="Log10 first" />
                            <TextField size="small" label="Output column" value={wsName} onChange={e => setWsName(e.target.value)}
                                error={existing.includes(wsName.trim())} helperText={existing.includes(wsName.trim()) ? 'Already exists' : ' '} />
                        </Box>
                    </Box>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={close}>Cancel</Button>
                {tab === 'expressions' ? (
                    <Button variant="contained" disabled={okCount === 0} onClick={calculateAll}>
                        Calculate All{okCount ? ` (${okCount})` : ''}
                    </Button>
                ) : (
                    <Button variant="contained" disabled={!weightsValid} onClick={calculateWeighted}>Calculate</Button>
                )}
            </DialogActions>
        </Dialog>
    );
};
