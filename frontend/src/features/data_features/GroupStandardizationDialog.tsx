/**
 * Calculations > Group standardisation / normal scores: score any numeric
 * column (element, ratio, index) within groups, optionally only inside a
 * scope, optionally averaged into an index, and save / reuse the baseline so
 * a later batch is scored on the same scale. Maths in groupStandardization.ts
 * (run in the analysis worker).
 */
import React, { useMemo, useRef, useState } from 'react';
import {
    Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem,
    Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import { ColumnPicker } from '../../components/ColumnPicker';
import { MultiColumnSelector } from '../../components/MultiColumnSelector';
import { useAppStore } from '../../store/appStore';
import { useAuditStore } from '../../store/auditStore';
import { notify } from '../../store/notificationStore';
import { analysisInWorker } from '../../utils/analysisWorker';
import { censorableColumns } from '../../utils/censoring';
import { downloadText } from '../../utils/gisExport';
import { combineLabels } from '../../utils/groupLabels';
import { hasValue, maxPositive } from '../../utils/groupDl';
import {
    buildColumnBaseline, compositeIndex, parseBaseline, scoreWithBaseline, standardizedColumnName,
    STANDARDIZE_METHOD_TEXT, type StandardizeBaseline, type StandardizeMethod, type StandardizeOptions, type StandardizeResult,
} from '../../utils/statistics/groupStandardization';
import { useMethodData, groupLabels } from '../analysis/methods/methodsCommon';
import { VisibleOnlySwitch } from '../analysis/methods/methodsControls';
import { useDataToolsStore } from './join/dataToolsStore';

interface Scored { name: string; source: string; values: Float64Array; result: StandardizeResult | null }

export const GroupStandardizationDialog: React.FC = () => {
    const open = useDataToolsStore(s => s.standardizeOpen);
    const close = () => useDataToolsStore.getState().setStandardizeOpen(false);
    return open ? <GroupStandardizationBody onClose={close} /> : null;
};

const GroupStandardizationBody: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const data = useMethodData();
    const mappings = useAppStore(s => s.geochemMappings);
    const [columns, setColumns] = useState<string[]>([]);
    const [group1, setGroup1] = useState('');
    const [group2, setGroup2] = useState('');
    const [minSize, setMinSize] = useState('10');
    const [smallGroups, setSmallGroups] = useState<'global' | 'blank'>('global');
    const [scopeColumn, setScopeColumn] = useState('');
    const [scopeValues, setScopeValues] = useState<string[]>([]);
    const [outside, setOutside] = useState<'blank' | 'zero'>('blank');
    const [method, setMethod] = useState<StandardizeMethod>('nscore');
    const [log10, setLog10] = useState(false);
    const [visibleOnly, setVisibleOnly] = useState(false);
    const [makeIndex, setMakeIndex] = useState(false);
    const [indexName, setIndexName] = useState('Index_ns');
    const [indexMode, setIndexMode] = useState<'available' | 'all'>('available');
    const [baseline, setBaseline] = useState<StandardizeBaseline | null>(null);
    const [scored, setScored] = useState<Scored[] | null>(null);
    const [busy, setBusy] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);

    const scopeCol = scopeColumn ? data.text(scopeColumn) : null;
    const scopeOptions = useMemo(() => (scopeCol ? [...new Set(groupLabels(scopeCol, data.rowCount))].sort() : []), [scopeCol, data.rowCount]);
    const options = data.numericColumns.map(name => ({ name, alias: data.display(name) === name ? null : data.display(name) }));
    const groupBy = [group1, group2].filter(Boolean);
    const isZ = method === 'robustz' || method === 'z';
    const usedMethod: StandardizeMethod = baseline?.method ?? method;

    const buildOptions = (): StandardizeOptions & { groups: string[] | null } => {
        const n = data.rowCount;
        const groups = groupBy.length ? combineLabels(groupBy.map(g => data.text(g) ?? new Array(n).fill(''))) : null;
        const scope = scopeCol && scopeValues.length
            ? Uint8Array.from({ length: n }, (_, i) => (scopeValues.includes(String(scopeCol[i] ?? '')) ? 1 : 0)) : null;
        const ms = parseInt(minSize, 10);
        return {
            method: usedMethod, groups, scope, outsideScope: outside,
            rowMask: visibleOnly ? data.visibleMask() : null,
            minGroupSize: Number.isFinite(ms) && ms > 0 ? ms : 10, smallGroups,
            log10: baseline ? baseline.log10 : isZ && log10,
        };
    };

    /** Below-detection rows of a column: only for element columns that carry limits */
    const censoredOf = (name: string): Uint8Array | null => {
        if (!censorableColumns(mappings).has(name)) return null;
        const raw = data.rawValues(name);
        if (!raw) return null;
        const maxPos = maxPositive(raw);
        return Uint8Array.from(raw, v => (v < 0 && hasValue(v, maxPos) ? 1 : 0));
    };

    const run = async () => {
        const opts = buildOptions();
        const inputs = columns.map(name => ({ name, values: data.values(name)!, censored: censoredOf(name) })).filter(c => !!c.values);
        setBusy(true);
        try {
            let out: Scored[];
            if (baseline) {
                out = inputs.map(c => {
                    const b = baseline.columns.find(x => x.column === c.name);
                    return {
                        name: standardizedColumnName(c.name, baseline.method), source: c.name, result: null,
                        values: b ? scoreWithBaseline(c.values, b, baseline.method, { ...opts, censored: c.censored }) : new Float64Array(data.rowCount).fill(NaN),
                    };
                });
            } else {
                const res = await analysisInWorker<Array<{ name: string; result: StandardizeResult }>>('standardizeColumns', { columns: inputs, options: opts });
                out = res.map(r => ({ name: standardizedColumnName(r.name, opts.method), source: r.name, values: r.result.values, result: r.result }));
            }
            setScored(out);
        } catch (e) {
            notify(`Standardisation failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
        } finally {
            setBusy(false);
        }
    };

    const describe = (opts: ReturnType<typeof buildOptions>) => [
        STANDARDIZE_METHOD_TEXT[opts.method] + (opts.log10 ? ' of log10 values' : ''),
        groupBy.length ? `within ${groupBy.join(' × ')}` : 'over all rows',
        scopeCol && scopeValues.length ? `only where ${scopeColumn} is ${scopeValues.join(' / ')}` : '',
        baseline ? 'on a saved baseline' : '',
    ].filter(Boolean).join(', ');

    const addColumns = () => {
        if (!scored?.length) return;
        const opts = buildOptions();
        const created = new Date().toISOString();
        const how = describe(opts);
        const adds = scored.map(s => ({
            name: s.name, values: s.values, replace: true, nonElement: true,
            derivation: {
                kind: 'calculation' as const, created, description: `${s.source}: ${how}`,
                params: {
                    standardization: {
                        source: s.source, method: opts.method, log10: !!opts.log10, groupColumns: groupBy, minGroupSize: opts.minGroupSize,
                        smallGroups, scope: scopeCol && scopeValues.length ? { column: scopeColumn, values: scopeValues, outside } : null,
                        baseline: !!baseline,
                    },
                },
            },
        }));
        if (makeIndex && scored.length > 1) {
            adds.push({
                name: indexName.trim() || 'Index', values: compositeIndex(scored.map(s => s.values), indexMode), replace: true, nonElement: true,
                derivation: {
                    kind: 'calculation' as const, created,
                    description: `Equal-weight mean of ${scored.map(s => s.name).join(', ')} (${indexMode === 'all' ? 'all components required' : 'mean of those present'})`,
                    params: { standardization: { index: scored.map(s => s.name), mode: indexMode } } as never,
                },
            });
        }
        useAppStore.getState().applyColumnEdits({ add: adds });
        useAuditStore.getState().recordAudit({
            category: 'calculation',
            operation: 'Group standardisation',
            description: `Scored ${scored.length} column${scored.length > 1 ? 's' : ''}: ${how}.${makeIndex && scored.length > 1 ? ` Index ${adds[adds.length - 1].name}.` : ''}`,
            parameters: { method: opts.method, groupColumns: groupBy.join(', '), minGroupSize: opts.minGroupSize ?? 10, smallGroups },
            inputColumns: scored.map(s => s.source),
            outputColumns: adds.map(a => a.name),
            rowsAffected: data.rowCount,
        });
        notify(`Added ${adds.length} column${adds.length > 1 ? 's' : ''}`, 'success');
        onClose();
    };

    const saveBaseline = () => {
        const opts = buildOptions();
        const b: StandardizeBaseline = {
            kind: 'geochem-standardization-baseline', version: 1, method: opts.method, log10: !!opts.log10,
            groupColumns: groupBy, created: new Date().toISOString(),
            columns: columns.filter(c => data.values(c)).map(c => buildColumnBaseline(c, data.values(c)!, { ...opts, censored: censoredOf(c) })),
        };
        downloadText(JSON.stringify(b), 'standardisation_baseline.json', 'application/json');
    };

    const loadBaseline = async (file: File) => {
        try {
            const b = parseBaseline(await file.text());
            setBaseline(b);
            setColumns(b.columns.map(c => c.column).filter(c => data.numericColumns.includes(c)));
            const missing = b.columns.filter(c => !data.numericColumns.includes(c.column)).map(c => c.column);
            if (missing.length) notify(`Baseline columns not in this dataset: ${missing.join(', ')}`, 'warning');
            const groupCols = b.groupColumns.filter(g => data.textColumns.includes(g));
            setGroup1(groupCols[0] ?? ''); setGroup2(groupCols[1] ?? '');
            setScored(null);
        } catch (e) {
            notify(e instanceof Error ? e.message : String(e), 'error');
        }
    };

    const warnings = (scored ?? []).flatMap(s => (s.result?.groups ?? [])
        .filter(g => g.usedGlobal || g.blanked || (isZ && g.spreadKind !== 'MAD' && g.spreadKind !== 'SD'))
        .map(g => `${s.source} · ${g.group}: ${g.blanked ? `left blank (${g.n} values)` : g.usedGlobal ? `${g.n} values, scored against all rows` : `no spread (${g.spreadKind})`}`));

    return (
        <Dialog open onClose={onClose} maxWidth="md" fullWidth>
            <DialogTitle>Group standardisation / normal scores</DialogTitle>
            <DialogContent dividers>
                <Stack spacing={2}>
                    <Typography variant="body2" color="text.secondary">
                        Put any numeric columns (elements, ratios, indices) on one scale by scoring each value against its own group,
                        e.g. rock type, or rock type × regolith. Normal scores are bounded and never blow up when a column is mostly
                        constant or below detection; they can be averaged into an index. Below-detection values of element columns are
                        tied at the bottom of their group.
                    </Typography>
                    <MultiColumnSelector columns={options} selectedColumns={columns} onChange={c => { setColumns(c); setScored(null); }} label="Columns to score" />
                    <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap alignItems="center">
                        <ColumnPicker label="Group by (optional)" value={group1} onChange={v => { setGroup1(v); setScored(null); }} filter="categorical" allowNone minWidth={190} />
                        {group1 && <ColumnPicker label="and by (optional)" value={group2} onChange={v => { setGroup2(v); setScored(null); }} filter="categorical" allowNone minWidth={190} />}
                        <TextField size="small" label="Min group size" value={minSize} onChange={e => setMinSize(e.target.value)} sx={{ width: 130 }} />
                        <TextField select size="small" label="Smaller groups" value={smallGroups} onChange={e => setSmallGroups(e.target.value as 'global' | 'blank')} sx={{ minWidth: 200 }}>
                            <MenuItem value="global">Score against all rows</MenuItem>
                            <MenuItem value="blank">Leave blank</MenuItem>
                        </TextField>
                    </Stack>
                    <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap alignItems="center">
                        <ColumnPicker label="Only where (optional)" value={scopeColumn} onChange={v => { setScopeColumn(v); setScopeValues([]); setScored(null); }} filter="categorical" allowNone minWidth={190} />
                        {scopeCol && (
                            <>
                                <TextField select size="small" label="is one of" value={scopeValues} sx={{ minWidth: 220 }}
                                    SelectProps={{ multiple: true, renderValue: v => (v as string[]).map(x => x || '(blank)').join(', ') }}
                                    onChange={e => { setScopeValues(e.target.value as unknown as string[]); setScored(null); }}>
                                    {scopeOptions.map(o => <MenuItem key={o} value={o}>{o || '(blank)'}</MenuItem>)}
                                </TextField>
                                <TextField select size="small" label="Other rows" value={outside} onChange={e => setOutside(e.target.value as 'blank' | 'zero')} sx={{ minWidth: 140 }}>
                                    <MenuItem value="blank">Blank</MenuItem>
                                    <MenuItem value="zero">0</MenuItem>
                                </TextField>
                            </>
                        )}
                    </Stack>
                    <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap alignItems="center">
                        <TextField select size="small" label="Method" value={usedMethod} disabled={!!baseline} onChange={e => { setMethod(e.target.value as StandardizeMethod); setScored(null); }} sx={{ minWidth: 330 }}>
                            {(Object.keys(STANDARDIZE_METHOD_TEXT) as StandardizeMethod[]).map(m => <MenuItem key={m} value={m}>{STANDARDIZE_METHOD_TEXT[m]}</MenuItem>)}
                        </TextField>
                        {isZ && !baseline && <FormControlLabel control={<Checkbox size="small" checked={log10} onChange={e => setLog10(e.target.checked)} />} label="of log10 values" />}
                        <VisibleOnlySwitch value={visibleOnly} onChange={v => { setVisibleOnly(v); setScored(null); }} />
                    </Stack>
                    <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap alignItems="center">
                        <FormControlLabel control={<Checkbox size="small" checked={makeIndex} onChange={e => setMakeIndex(e.target.checked)} />} label="Also average the scores into an index" />
                        {makeIndex && (
                            <>
                                <TextField size="small" label="Index name" value={indexName} onChange={e => setIndexName(e.target.value)} sx={{ width: 170 }} />
                                <TextField select size="small" label="Rows missing a score" value={indexMode} onChange={e => setIndexMode(e.target.value as 'available' | 'all')} sx={{ minWidth: 230 }}>
                                    <MenuItem value="available">Average the scores present</MenuItem>
                                    <MenuItem value="all">Leave blank</MenuItem>
                                </TextField>
                            </>
                        )}
                    </Stack>
                    <Stack direction="row" spacing={1.5} alignItems="center">
                        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void loadBaseline(f); e.target.value = ''; }} />
                        <Button size="small" variant="outlined" onClick={() => fileRef.current?.click()}>Score on a saved baseline…</Button>
                        {baseline && (
                            <Typography variant="body2" sx={{ flex: 1 }}>
                                Baseline of {baseline.columns.length} column{baseline.columns.length > 1 ? 's' : ''} ({STANDARDIZE_METHOD_TEXT[baseline.method]}
                                {baseline.groupColumns.length ? `, groups by ${baseline.groupColumns.join(' × ')}` : ''}, saved {baseline.created.slice(0, 10)}).
                                {' '}<Button size="small" onClick={() => { setBaseline(null); setScored(null); }}>Clear</Button>
                            </Typography>
                        )}
                    </Stack>
                    {scored && (
                        <Box>
                            <Table size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell>New column</TableCell>
                                        <TableCell align="right">Scored</TableCell>
                                        <TableCell align="right">Groups</TableCell>
                                        <TableCell align="right">Below detection</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {scored.map(s => (
                                        <TableRow key={s.name}>
                                            <TableCell>{s.name}</TableCell>
                                            <TableCell align="right">{Array.from(s.values).filter(Number.isFinite).length}</TableCell>
                                            <TableCell align="right">{s.result ? s.result.groups.length : '–'}</TableCell>
                                            <TableCell align="right">{s.result ? s.result.groups.reduce((a, g) => a + g.nCensored, 0) : '–'}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                            {warnings.length > 0 && (
                                <Alert severity="warning" sx={{ mt: 1 }}>
                                    {warnings.slice(0, 8).map(w => <div key={w}>{w}</div>)}
                                    {warnings.length > 8 && <div>… and {warnings.length - 8} more</div>}
                                </Alert>
                            )}
                        </Box>
                    )}
                </Stack>
            </DialogContent>
            <DialogActions>
                {!baseline && <Button onClick={saveBaseline} disabled={!columns.length}>Save baseline…</Button>}
                <Box sx={{ flex: 1 }} />
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="outlined" onClick={run} disabled={!columns.length || busy}>{busy ? 'Scoring…' : 'Preview'}</Button>
                <Button variant="contained" onClick={addColumns} disabled={!scored?.length}>Add {scored ? scored.length + (makeIndex && scored.length > 1 ? 1 : 0) : ''} columns</Button>
            </DialogActions>
        </Dialog>
    );
};
