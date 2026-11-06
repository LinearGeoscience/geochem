/**
 * Classify by rules: an ordered list of groups, each a set of column windows
 * (min / max, all must hold). The first rule a row matches decides its group,
 * so later rules only see what earlier ones left (Scott Halley's SWIR
 * mineral priority, or an alteration scheme from K/Al and Na/Al).
 *
 * Live row counts per rule; Apply paints the groups as colour rows and can
 * also write them to a text column. Rule sets are saved by name or as .json.
 */
import React, { useMemo, useState } from 'react';
import {
    Alert, Autocomplete, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel,
    IconButton, MenuItem, Paper, Select, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import { Add, ArrowDownward, ArrowUpward, Delete, Close, FileOpen, SaveAlt } from '@mui/icons-material';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../store/appStore';
import { useAttributeStore, createCustomEntry } from '../../store/attributeStore';
import { useRuleSetStore } from '../../store/ruleSetStore';
import { useAuditStore } from '../../store/auditStore';
import { notify } from '../../store/notificationStore';
import { isNumericType } from '../../utils/columnGroups';
import { classifyByRules, ruleLabels, type ClassRule, type RuleSet } from '../../utils/ruleClassifier';
import { downloadText } from '../../utils/gisExport';

const PALETTE = ['#e31a1c', '#1f78b4', '#33a02c', '#ff7f00', '#6a3d9a', '#b15928', '#a6cee3', '#fb9a99', '#b2df8a', '#fdbf6f', '#cab2d6', '#ffff99'];

const newRule = (k: number): ClassRule => ({
    name: `Group ${k + 1}`, color: PALETTE[k % PALETTE.length], enabled: true,
    conditions: [{ column: '', min: null, max: null }],
});

const parseLimit = (s: string): number | null => {
    if (s.trim() === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
};

export const RulesClassifierDialog: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
    const { columns, columnarData } = useAppStore(useShallow(s => ({ columns: s.columns, columnarData: s.columnarData })));
    const { rules, name, saved } = useRuleSetStore(useShallow(s => ({ rules: s.rules, name: s.name, saved: s.saved })));
    const rs = useRuleSetStore.getState;
    const [writeColumn, setWriteColumn] = useState(false);
    const [columnName, setColumnName] = useState('Rule_Class');

    const numeric = useMemo(() => columns.filter(c => isNumericType(c.type)).map(c => c.name), [columns]);
    const counts = useMemo(() => {
        if (!open) return null;
        const app = useAppStore.getState();
        return classifyByRules(rules, columnarData.rowCount, c => app.getColumn(c));
    }, [open, rules, columnarData]);

    const update = (r: number, patch: Partial<ClassRule>) => rs().setRules(rules.map((x, k) => (k === r ? { ...x, ...patch } : x)));
    const updateCond = (r: number, c: number, patch: Partial<ClassRule['conditions'][number]>) =>
        update(r, { conditions: rules[r].conditions.map((x, k) => (k === c ? { ...x, ...patch } : x)) });
    const move = (r: number, d: -1 | 1) => {
        const next = [...rules];
        [next[r], next[r + d]] = [next[r + d], next[r]];
        rs().setRules(next);
    };

    const apply = () => {
        if (!counts) return;
        const attr = useAttributeStore.getState();
        let groups = 0, rows = 0;
        rules.forEach((rule, r) => {
            const idx = counts.indices[r];
            if (!rule.enabled || !rule.name.trim()) return;
            let entry = useAttributeStore.getState().customEntries.find(e => e.name === rule.name);
            if (entry) {
                attr.updateCustomEntry(entry.id, { color: rule.color, visible: true });
                attr.removeIndicesFromEntry(entry.id, entry.assignedIndices);
            } else {
                attr.addCustomEntry(createCustomEntry(rule.name, rule.color, 'circle', 8));
                entry = useAttributeStore.getState().customEntries.find(e => e.name === rule.name)!;
            }
            if (idx.length) {
                attr.setActiveEntryId(entry.id);
                attr.paintIndicesToActiveEntry(idx);
                groups++;
                rows += idx.length;
            }
        });
        attr.setActiveEntryId(null);
        if (writeColumn && columnName.trim()) {
            const app = useAppStore.getState();
            const taken = app.columns.map(c => c.name);
            let col = columnName.trim(), k = 2;
            while (taken.includes(col)) col = `${columnName.trim()}_${k++}`;
            const labels = ruleLabels(rules, app.columnarData.rowCount, c => app.getColumn(c)).map(v => v ?? 'Unassigned');
            app.addColumn(col, labels, 'categorical', 'Classification');
        }
        useAuditStore.getState().recordAudit({
            category: 'classification',
            operation: 'Classify by rules',
            description: `"${name}": ${groups} groups, ${rows} rows`,
            parameters: { rules },
        });
        notify(`Painted ${rows} rows into ${groups} colour groups`, 'success');
        onClose();
    };

    const loadFile = async (file: File) => {
        try {
            const json = JSON.parse(await file.text()) as RuleSet;
            if (!Array.isArray(json.rules)) throw new Error('no rules');
            rs().load({ name: json.name || file.name.replace(/\.json$/i, ''), rules: json.rules });
        } catch {
            notify('Not a rule set file', 'error');
        }
    };

    const missing = rules.flatMap(r => r.conditions.map(c => c.column)).filter(c => c && !numeric.includes(c));

    return (
        <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth data-testid="rules-classifier">
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                Classify by rules
                <Box sx={{ flex: 1 }} />
                <IconButton size="small" onClick={onClose} aria-label="Close"><Close fontSize="small" /></IconButton>
            </DialogTitle>
            <DialogContent dividers>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                    Rules run top to bottom; a row goes to the first rule whose limits it meets (blank = no limit), so later
                    rules only get what earlier ones left. Order them by priority.
                </Typography>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
                    <TextField size="small" label="Rule set" value={name} onChange={e => rs().setName(e.target.value)} sx={{ width: 220 }} />
                    <Button size="small" onClick={() => { rs().save(); notify(`Saved "${name}"`, 'success'); }} disabled={!rules.length}>Save</Button>
                    {saved.length > 0 && (
                        <Select size="small" displayEmpty value="" onChange={e => { const s = saved.find(x => x.name === e.target.value); if (s) rs().load(s); }} sx={{ minWidth: 160 }}
                            renderValue={() => <em>Saved sets…</em>}>
                            {saved.map(s => (
                                <MenuItem key={s.name} value={s.name} sx={{ gap: 1 }}>
                                    <Typography variant="body2" sx={{ flex: 1 }}>{s.name} ({s.rules.length})</Typography>
                                    <IconButton size="small" aria-label={`Delete ${s.name}`} onClick={e => { e.stopPropagation(); rs().remove(s.name); }}><Delete fontSize="small" /></IconButton>
                                </MenuItem>
                            ))}
                        </Select>
                    )}
                    <Box sx={{ flex: 1 }} />
                    <Button size="small" component="label" startIcon={<FileOpen fontSize="small" />}>
                        Load .json
                        <input hidden type="file" accept=".json" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void loadFile(f); }} />
                    </Button>
                    <Button size="small" startIcon={<SaveAlt fontSize="small" />} disabled={!rules.length}
                        onClick={() => downloadText(JSON.stringify({ name, rules }, null, 2), `${name || 'rules'}.json`, 'application/json')}>
                        Save .json
                    </Button>
                </Stack>

                <Stack spacing={1}>
                    {rules.map((rule, r) => (
                        <Paper key={r} variant="outlined" sx={{ p: 1, opacity: rule.enabled ? 1 : 0.55 }} data-testid="rule-row">
                            <Stack direction="row" spacing={1} alignItems="center">
                                <Typography variant="caption" sx={{ width: 18, textAlign: 'right' }}>{r + 1}</Typography>
                                <Checkbox size="small" checked={rule.enabled} onChange={e => update(r, { enabled: e.target.checked })} inputProps={{ 'aria-label': 'Rule on' }} />
                                <input type="color" value={rule.color} onChange={e => update(r, { color: e.target.value })} aria-label="Group colour"
                                    style={{ width: 28, height: 24, border: 'none', padding: 0, background: 'none' }} />
                                <TextField size="small" label="Group" value={rule.name} onChange={e => update(r, { name: e.target.value })} sx={{ width: 200 }} />
                                <Chip size="small" label={`${counts?.indices[r]?.length ?? 0} rows`} color={counts?.indices[r]?.length ? 'primary' : 'default'} variant="outlined" />
                                <Box sx={{ flex: 1 }} />
                                <IconButton size="small" disabled={r === 0} onClick={() => move(r, -1)} aria-label="Move up"><ArrowUpward fontSize="small" /></IconButton>
                                <IconButton size="small" disabled={r === rules.length - 1} onClick={() => move(r, 1)} aria-label="Move down"><ArrowDownward fontSize="small" /></IconButton>
                                <IconButton size="small" onClick={() => rs().setRules(rules.filter((_, k) => k !== r))} aria-label="Delete rule"><Delete fontSize="small" /></IconButton>
                            </Stack>
                            <Stack spacing={0.75} sx={{ pl: 7, pt: 0.75 }}>
                                {rule.conditions.map((c, k) => (
                                    <Stack key={k} direction="row" spacing={1} alignItems="center">
                                        <Typography variant="caption" sx={{ width: 28 }}>{k === 0 ? 'where' : 'and'}</Typography>
                                        <TextField size="small" label="min" defaultValue={c.min ?? ''} key={`min-${r}-${k}-${c.min}`}
                                            onBlur={e => updateCond(r, k, { min: parseLimit(e.target.value) })} sx={{ width: 100 }} inputProps={{ inputMode: 'decimal' }} />
                                        <Typography variant="body2">≤</Typography>
                                        <Autocomplete size="small" options={numeric} value={c.column || null} onChange={(_, v) => updateCond(r, k, { column: v ?? '' })}
                                            sx={{ width: 240 }} renderInput={p => <TextField {...p} label="Column" error={!!c.column && !numeric.includes(c.column)} />} />
                                        <Typography variant="body2">≤</Typography>
                                        <TextField size="small" label="max" defaultValue={c.max ?? ''} key={`max-${r}-${k}-${c.max}`}
                                            onBlur={e => updateCond(r, k, { max: parseLimit(e.target.value) })} sx={{ width: 100 }} inputProps={{ inputMode: 'decimal' }} />
                                        <IconButton size="small" disabled={rule.conditions.length === 1} aria-label="Remove condition"
                                            onClick={() => update(r, { conditions: rule.conditions.filter((_, j) => j !== k) })}><Close fontSize="small" /></IconButton>
                                    </Stack>
                                ))}
                                <Box>
                                    <Button size="small" startIcon={<Add fontSize="small" />}
                                        onClick={() => update(r, { conditions: [...rule.conditions, { column: '', min: null, max: null }] })}>Condition</Button>
                                </Box>
                            </Stack>
                        </Paper>
                    ))}
                </Stack>
                <Stack direction="row" spacing={2} alignItems="center" sx={{ mt: 1.5 }}>
                    <Button variant="outlined" size="small" startIcon={<Add />} onClick={() => rs().setRules([...rules, newRule(rules.length)])}>Add rule</Button>
                    {counts && rules.length > 0 && (
                        <Typography variant="body2" color="text.secondary" data-testid="rules-unassigned">
                            Unassigned: {counts.unassigned} of {columnarData.rowCount} rows
                        </Typography>
                    )}
                </Stack>
                {missing.length > 0 && <Alert severity="warning" sx={{ mt: 1.5 }}>Not in this dataset: {[...new Set(missing)].join(', ')}</Alert>}
            </DialogContent>
            <DialogActions>
                <FormControlLabel control={<Checkbox size="small" checked={writeColumn} onChange={e => setWriteColumn(e.target.checked)} />}
                    label={<Typography variant="body2">Also write a text column</Typography>} />
                {writeColumn && <TextField size="small" value={columnName} onChange={e => setColumnName(e.target.value)} sx={{ width: 160 }} />}
                <Box sx={{ flex: 1 }} />
                <Button onClick={onClose}>Cancel</Button>
                <Tooltip title="Paint each rule's rows into a colour group of the same name (existing groups are repainted)">
                    <span>
                        <Button variant="contained" onClick={apply} disabled={!counts || counts.indices.every(i => !i.length)} data-testid="rules-apply">
                            Apply as colour groups
                        </Button>
                    </span>
                </Tooltip>
            </DialogActions>
        </Dialog>
    );
};
