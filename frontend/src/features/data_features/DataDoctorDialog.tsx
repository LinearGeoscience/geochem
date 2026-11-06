/**
 * Data Doctor (Data > Data Doctor). Scans the chosen columns for "<x"
 * text, text codes (IS, NS…), missing codes, negatives, zeros and non-ppm
 * units, and below-detection values supplied as ½DL; each issue row gets a
 * replacement; "Replace all" sets one choice for every column with that issue.
 * Apply is one undoable change.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
    Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem,
    Select, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import { useAppStore } from '../../store/appStore';
import { useUIStore } from '../../store/uiStore';
import { useAuditStore } from '../../store/auditStore';
import { notify } from '../../store/notificationStore';
import { MultiColumnSelector } from '../../components/MultiColumnSelector';
import {
    ACTION_LABELS, applyBatchScaleIssue, applyColumnFixes, applyHalfDlIssue, convertToPpm, DoctorFix, DoctorIssue, FixAction, ISSUE_LABELS,
    IssueKind, scanColumns,
} from '../../utils/dataDoctor';
import { rankBatchColumns, suggestBatchColumn } from '../../utils/halfDetection';

interface Choice { action: FixAction; value: string; apply: boolean }

const keyOf = (i: { column: string; kind: IssueKind }) => `${i.column}\u0000${i.kind}`;

export const DataDoctorDialog: React.FC = () => {
    const open = useUIStore(s => s.dataDoctorOpen);
    const setOpen = useUIStore(s => s.setDataDoctorOpen);
    const columns = useAppStore(s => s.columns);
    const columnarData = useAppStore(s => s.columnarData);
    const mappings = useAppStore(s => s.geochemMappings);

    // Default: every column without a role (IDs and coordinates are left alone)
    const candidates = useMemo(() => columns.filter(c => !c.role || c.role === 'Classification'), [columns]);
    const [selected, setSelected] = useState<string[]>([]);
    const [groupColumn, setGroupColumn] = useState('');
    useEffect(() => {
        if (!open) return;
        setSelected(candidates.map(c => c.name));
        // Start from the lab batch / method column when there is one
        setGroupColumn(suggestBatchColumn(columns, n => columnarData.columns.get(n)) ?? '');
    }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

    // Columns that can hold the assay method / batch: text, 2–200 distinct values, methods first
    const groupOptions = useMemo(() => {
        if (!open) return [];
        return rankBatchColumns(columns, n => columnarData.columns.get(n))
            .map(o => ({ name: o.name, groups: o.groups, suggested: o.score > 0 }));
    }, [open, columns, columnarData]);
    const groups = groupColumn ? columnarData.columns.get(groupColumn) : undefined;

    const issues = useMemo<DoctorIssue[]>(() => {
        if (!open) return [];
        const cols = selected
            .map(name => ({ name, values: columnarData.columns.get(name) }))
            .filter((c): c is { name: string; values: NonNullable<typeof c.values> } => !!c.values);
        return scanColumns(cols, mappings, columnarData.columns.keys(), { groups });
    }, [open, selected, columnarData, mappings, groups]);

    const [choices, setChoices] = useState<Record<string, Choice>>({});
    useEffect(() => {
        const next: Record<string, Choice> = {};
        for (const i of issues) next[keyOf(i)] = { action: i.actions[0], value: '', apply: i.actions[0] !== 'keep' };
        setChoices(next);
    }, [issues]);

    const kinds = useMemo(() => [...new Set(issues.map(i => i.kind))], [issues]);
    const [bulk, setBulk] = useState<Partial<Record<IssueKind, { action: FixAction; value: string }>>>({});

    const setChoice = (k: string, patch: Partial<Choice>) =>
        setChoices(c => ({ ...c, [k]: { ...c[k], ...patch, apply: patch.action ? patch.action !== 'keep' : (patch.apply ?? c[k].apply) } }));

    const replaceAll = (kind: IssueKind) => {
        const b = bulk[kind] ?? { action: issues.find(i => i.kind === kind)!.actions[0], value: '' };
        setChoices(c => {
            const next = { ...c };
            for (const i of issues) if (i.kind === kind && i.actions.includes(b.action)) {
                next[keyOf(i)] = { action: b.action, value: b.value, apply: b.action !== 'keep' };
            }
            return next;
        });
    };

    const toApply = issues.filter(i => choices[keyOf(i)]?.apply && choices[keyOf(i)].action !== 'keep');
    const invalidValue = toApply.some(i => choices[keyOf(i)].action === 'value' && !Number.isFinite(parseFloat(choices[keyOf(i)].value)));

    const handleApply = () => {
        const byColumn = new Map<string, DoctorFix[]>();
        const conversions: DoctorIssue[] = [];
        // ½DL first, then batch scale (the -DL values scale with their batch); the
        // result then passes through the column's other fixes. Both are mirrored
        // onto same-measurement columns in another unit (Cu_pct beside Cu_ppm).
        const base = new Map<string, ArrayLike<unknown>>();
        let changed = 0;
        const current = (name: string) => base.get(name) ?? columnarData.columns.get(name)!;
        for (const kind of ['halfDL', 'batchScale'] as const) {
            for (const i of toApply) {
                if (i.kind !== kind) continue;
                const action = choices[keyOf(i)].action;
                const targets = [{ name: i.column, scale: 1 }, ...(i.twins ?? [])];
                for (const t of targets) {
                    const r = kind === 'halfDL'
                        ? applyHalfDlIssue(current(t.name), i, groups, { sureOnly: action === 'negDLSure', scale: t.scale })
                        : groups ? applyBatchScaleIssue(current(t.name), i, groups) : null;
                    if (!r) continue;
                    base.set(t.name, r.values);
                    changed += r.changed;
                    if (!byColumn.has(t.name)) byColumn.set(t.name, []);
                }
            }
        }
        for (const i of toApply) {
            const c = choices[keyOf(i)];
            if (i.kind === 'halfDL' || i.kind === 'batchScale') continue;
            if (i.kind === 'units') { conversions.push(i); continue; }
            const list = byColumn.get(i.column) ?? [];
            list.push({ column: i.column, kind: i.kind, action: c.action, value: c.action === 'value' ? parseFloat(c.value) : undefined });
            byColumn.set(i.column, list);
        }
        const replace: Array<{ name: string; values: (number | string | null)[]; numeric: boolean }> = [];
        for (const [name, fixes] of byColumn) {
            const r = applyColumnFixes(current(name), fixes);
            changed += r.changed;
            replace.push({ name, values: r.values, numeric: r.numeric });
        }
        // Units: convert the cleaned values when the same column was also fixed
        const add = conversions.map(i => ({
            name: i.target!,
            values: convertToPpm(replace.find(r => r.name === i.column)?.values ?? columnarData.columns.get(i.column)!, i.toPpm!),
        }));
        useAppStore.getState().applyColumnEdits({ replace, add });
        useAuditStore.getState().recordAudit({
            category: 'column-operation',
            operation: 'Data Doctor',
            description: `Data Doctor: ${changed.toLocaleString()} values replaced in ${replace.length} columns`
                + (add.length ? `; ${add.length} ppm columns added (${add.map(a => a.name).join(', ')})` : ''),
            parameters: {
                fixes: toApply.map(i => ({
                    column: i.column, issue: i.kind, action: choices[keyOf(i)].action, value: choices[keyOf(i)].value || undefined,
                    ...(i.spikes ? { halfDL: i.spikes.map(sp => ({ value: sp.value, dl: sp.dl, count: sp.count, group: sp.group, confidence: sp.confidence })) } : {}),
                    ...(i.batches ? { batches: i.batches.map(b => ({ batch: b.group, median: b.median, reference: b.reference, factor: b.factor })) } : {}),
                    ...(i.twins ? { mirroredTo: i.twins.map(t => t.name) } : {}),
                })),
                ...(groupColumn ? { groupColumn } : {}),
            },
            inputColumns: [...new Set(toApply.map(i => i.column))],
            outputColumns: [...replace.map(r => r.name), ...add.map(a => a.name)],
            rowsAffected: columnarData.rowCount,
        });
        notify(`Data Doctor: ${changed.toLocaleString()} values replaced${add.length ? `, ${add.length} ppm column${add.length > 1 ? 's' : ''} added` : ''}`, 'success');
        setOpen(false);
    };

    return (
        <Dialog open={open} onClose={() => setOpen(false)} maxWidth="lg" fullWidth>
            <DialogTitle>Data Doctor</DialogTitle>
            <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <MultiColumnSelector
                    columns={candidates.map(c => ({ name: c.name, alias: c.alias, priority: c.priority }))}
                    selectedColumns={selected}
                    onChange={setSelected}
                    label="Columns to check"
                />
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                    <TextField select size="small" sx={{ minWidth: 260 }} label="Detection limits differ by (optional)"
                        value={groupColumn} onChange={e => setGroupColumn(e.target.value)}>
                        <MenuItem value="">(whole column)</MenuItem>
                        {groupOptions.map(g => (
                            <MenuItem key={g.name} value={g.name}>{g.name} ({g.groups} groups){g.suggested ? ' · suggested' : ''}</MenuItem>
                        ))}
                    </TextField>
                    <Typography variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 260 }}>
                        Lab method / batch column: below-detection values supplied as ½DL (e.g. &lt;10 → 5) are looked for within each
                        group, so one method&apos;s ½DL is not hidden by another method&apos;s real values. Rows marked “?” are uncertain:
                        a measured value equal to ½DL cannot be told apart, so check them before converting. The same column also finds batches whose values sit 100× or more off the others (unit slips).
                    </Typography>
                </Box>
                {issues.length === 0 ? (
                    <Alert severity="success">No problems found in the {selected.length} selected columns.</Alert>
                ) : (
                    <>
                        <Box>
                            <Typography variant="subtitle2" gutterBottom>Replace all</Typography>
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
                                {kinds.map(kind => {
                                    const actions = issues.find(i => i.kind === kind)!.actions;
                                    const b = bulk[kind] ?? { action: actions[0], value: '' };
                                    return (
                                        <Box key={kind} sx={{ display: 'flex', alignItems: 'center', gap: 1, border: 1, borderColor: 'divider', borderRadius: 1, px: 1, py: 0.5 }}>
                                            <Typography variant="body2" sx={{ minWidth: 110 }}>{ISSUE_LABELS[kind]}</Typography>
                                            <Select size="small" value={b.action} onChange={e => setBulk(s => ({ ...s, [kind]: { ...b, action: e.target.value as FixAction } }))}>
                                                {actions.map(a => <MenuItem key={a} value={a}>{ACTION_LABELS[a]}</MenuItem>)}
                                            </Select>
                                            {b.action === 'value' && (
                                                <TextField size="small" sx={{ width: 90 }} value={b.value} placeholder="value"
                                                    onChange={e => setBulk(s => ({ ...s, [kind]: { ...b, value: e.target.value } }))} />
                                            )}
                                            <Button size="small" onClick={() => replaceAll(kind)}>Set all</Button>
                                        </Box>
                                    );
                                })}
                            </Box>
                        </Box>
                        <TableContainer sx={{ maxHeight: 420, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                            <Table size="small" stickyHeader>
                                <TableHead>
                                    <TableRow>
                                        <TableCell padding="checkbox" />
                                        <TableCell>Column</TableCell>
                                        <TableCell>Issue</TableCell>
                                        <TableCell align="right">Count</TableCell>
                                        <TableCell>Examples</TableCell>
                                        <TableCell>Replace with</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {issues.map(i => {
                                        const k = keyOf(i);
                                        const c = choices[k];
                                        if (!c) return null;
                                        return (
                                            <TableRow key={k} hover>
                                                <TableCell padding="checkbox">
                                                    <Checkbox size="small" checked={c.apply} disabled={c.action === 'keep'}
                                                        onChange={e => setChoice(k, { apply: e.target.checked })} />
                                                </TableCell>
                                                <TableCell sx={{ fontWeight: 500 }}>{i.column}</TableCell>
                                                <TableCell>{ISSUE_LABELS[i.kind]}</TableCell>
                                                <TableCell align="right">{i.count.toLocaleString()}</TableCell>
                                                <TableCell sx={{ fontFamily: 'monospace', fontSize: 12, color: 'text.secondary' }}>
                                                    {i.kind === 'units' ? `${i.unit} → ppm (×${i.toPpm})` : i.examples.join('  ')}
                                                </TableCell>
                                                <TableCell>
                                                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                                                        <Select size="small" value={c.action} sx={{ minWidth: 180 }}
                                                            onChange={e => setChoice(k, { action: e.target.value as FixAction })}>
                                                            {i.actions.map(a => <MenuItem key={a} value={a}>{ACTION_LABELS[a]}</MenuItem>)}
                                                        </Select>
                                                        {c.action === 'value' && (
                                                            <TextField size="small" sx={{ width: 90 }} value={c.value} placeholder="value"
                                                                error={!Number.isFinite(parseFloat(c.value))}
                                                                onChange={e => setChoice(k, { value: e.target.value })} />
                                                        )}
                                                        {c.action === 'convert' && (
                                                            <Typography variant="caption" color="text.secondary">→ {i.target}</Typography>
                                                        )}
                                                    </Box>
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </TableContainer>
                        <Typography variant="caption" color="text.secondary">
                            Negative values are kept by default: they mark below-detection results (standard convention) and are
                            substituted per the BDL setting when used. Apply can be undone with Ctrl+Z.
                        </Typography>
                    </>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={() => setOpen(false)}>Cancel</Button>
                <Button variant="contained" disabled={toApply.length === 0 || invalidValue} onClick={handleApply}>
                    Apply {toApply.length > 0 ? `(${toApply.length})` : ''}
                </Button>
            </DialogActions>
        </Dialog>
    );
};
