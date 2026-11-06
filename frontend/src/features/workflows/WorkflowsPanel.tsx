/**
 * Workflows pane: pick a deposit-style recipe, run its steps one at a time.
 * Each step shows why and what to look for, a Run button, a tick once run,
 * and a "Missing: …" chip when the dataset lacks what the step needs. The
 * cut-offs behind every line and rule preset are listed under References.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
    Box, Button, Chip, Collapse, FormControl, FormControlLabel, IconButton, List, ListItem, ListSubheader,
    MenuItem, Select, Stack, Switch, Tooltip, Typography,
} from '@mui/material';
import { CheckCircle, DeleteSweep, ExpandLess, ExpandMore, Replay } from '@mui/icons-material';
import { useAppStore } from '../../store/appStore';
import { useWorkflowStore } from '../../store/workflowStore';
import { ensureDiagramsLoaded, useClassificationStore } from '../../store/classificationStore';
import { notify } from '../../store/notificationStore';
import { WORKFLOWS, WORKFLOW_GROUPS, workflowById } from '../../utils/workflows/library';
import { makeContext, refLabel } from '../../utils/workflows/resolve';
import { clearWorkflowPlots, runStep, stepAvailability } from '../../utils/workflows/runner';
import type { StepResult, Workflow, WorkflowAction, WorkflowStep } from '../../utils/workflows/types';

const EMPTY: Record<string, StepResult> = {};
const DERIVED_ROLES = new Set(['Calculated', 'Classification']);

function summarise(r: StepResult): string {
    const parts: string[] = [];
    if (r.plotIds.length) parts.push(`${r.plotIds.length} plot${r.plotIds.length === 1 ? '' : 's'}`);
    if (r.added.length) parts.push(`${r.added.join(', ')} added`);
    if (r.opened.includes('rules')) parts.push('rules sheet opened: review, then Apply');
    if (r.opened.includes('dialog')) parts.push('dialog opened: review, then apply');
    if (r.opened.includes('analysis') && !r.plotIds.length) parts.push('Analysis view');
    if (r.missing.length) parts.push(`missing ${r.missing.join(', ')}`);
    return parts.join('; ') || 'Nothing to do';
}

/** Cut-offs an action carries: reference lines and rule windows */
function cutoffs(a: WorkflowAction): string[] {
    const out: string[] = [];
    if (a.kind === 'scatter') {
        for (const l of a.refLines ?? []) {
            if ('ratio' in l) out.push(l.ratio.label ?? `${refLabel(l.ratio.num)}/${refLabel(l.ratio.den)} = ${l.ratio.value}`);
            else out.push(l.level.label ?? `${refLabel(l.level.on)} = ${l.level.at}`);
        }
    } else if (a.kind === 'rules') {
        for (const r of a.rules) {
            const conds = r.where.map(w => {
                const lo = w.min != null ? `${w.min} ≤ ` : '';
                const hi = w.max != null ? ` ≤ ${w.max}` : '';
                return `${lo}${refLabel(w.on)}${hi}`;
            });
            out.push(`${r.name}: ${conds.join(', ')}`);
        }
    }
    return out;
}

const StepRow: React.FC<{
    index: number; step: WorkflowStep; done: boolean; isNext: boolean; running: boolean;
    availability: ReturnType<typeof stepAvailability>; onRun: () => void;
}> = ({ index, step, done, isNext, running, availability, onRun }) => {
    const noteOnly = step.actions.every(a => a.kind === 'note');
    const blocked = !availability.ok || availability.diagramsPending;
    const reason = availability.diagramsPending ? 'Loading the diagram library…'
        : !availability.ok ? `Needs ${availability.missing.join(', ')}` : '';
    return (
        <ListItem alignItems="flex-start" disableGutters sx={{ py: 0.75, gap: 1, borderBottom: 1, borderColor: 'divider' }} data-testid="workflow-step">
            <Box sx={{ width: 22, flexShrink: 0, pt: 0.25, display: 'flex', justifyContent: 'center' }}>
                {done
                    ? <CheckCircle color="success" sx={{ fontSize: 20 }} data-testid="step-done" />
                    : <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', lineHeight: '20px' }}>{index + 1}</Typography>}
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.3 }}>{step.title}</Typography>
                <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.25, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {step.note}
                </Typography>
                <Typography variant="caption" component="p" sx={{ mt: 0.25, fontStyle: 'italic' }}>
                    Look for: {step.look}
                </Typography>
                {availability.missing.length > 0 && (
                    <Chip
                        size="small" color={availability.ok ? 'default' : 'warning'} variant="outlined"
                        label={`Missing: ${availability.missing.join(', ')}`}
                        sx={{ mt: 0.5, height: 20, '& .MuiChip-label': { px: 0.75, fontSize: 11 } }}
                        data-testid="step-missing"
                    />
                )}
            </Box>
            {!noteOnly && (
                <Tooltip title={reason}>
                    <span>
                        <Button
                            size="small" variant={isNext ? 'contained' : 'outlined'} disabled={blocked || running}
                            onClick={onRun} sx={{ minWidth: 52, py: 0.125, flexShrink: 0 }} data-testid="step-run"
                        >
                            {done ? 'Again' : 'Run'}
                        </Button>
                    </span>
                </Tooltip>
            )}
        </ListItem>
    );
};

export const WorkflowsPanel: React.FC = () => {
    const selectedId = useWorkflowStore(s => s.selectedId);
    const wf: Workflow = workflowById(selectedId ?? '') ?? WORKFLOWS[0];
    const done = useWorkflowStore(s => s.done[wf.id] ?? EMPTY);
    const replacePrevious = useWorkflowStore(s => s.replacePrevious);
    const lastStepPlotIds = useWorkflowStore(s => s.lastStepPlotIds);
    const datasetKey = useWorkflowStore(s => s.datasetKey);
    const columns = useAppStore(s => s.columns);
    const mappings = useAppStore(s => s.geochemMappings);
    const rowCount = useAppStore(s => s.columnarData.rowCount);
    const isLoaded = useClassificationStore(s => s.isLoaded);
    const [running, setRunning] = useState<string | null>(null);
    const [refsOpen, setRefsOpen] = useState(false);

    useEffect(() => { void ensureDiagramsLoaded(); }, []);

    // Ticks belong to a dataset: forget them when the loaded data changes (derived columns don't count)
    const key = useMemo(() => `${rowCount}|${columns.filter(c => !DERIVED_ROLES.has(c.role ?? '')).map(c => c.name).join(',')}`, [rowCount, columns]);
    useEffect(() => {
        if (datasetKey !== key) useWorkflowStore.getState().reset(undefined, key);
    }, [key, datasetKey]);

    const ctx = useMemo(() => makeContext(columns, mappings, wf), [columns, mappings, wf]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const availability = useMemo(() => wf.steps.map(s => stepAvailability(wf, s, ctx)), [wf, ctx, isLoaded]);
    const nextIndex = wf.steps.findIndex((s, i) => !done[s.id] && availability[i].ok && !availability[i].diagramsPending);

    const run = async (step: WorkflowStep) => {
        setRunning(step.id);
        try {
            const r = await runStep(wf, step, { replacePlotIds: replacePrevious ? lastStepPlotIds : [] });
            useWorkflowStore.getState().markDone(wf.id, step.id, r);
            notify(`${step.title}: ${summarise(r)}`, r.missing.length || r.warnings.length ? 'warning' : 'success');
        } catch (e) {
            notify(`${step.title}: ${e instanceof Error ? e.message : String(e)}`, 'error');
        } finally {
            setRunning(null);
        }
    };

    const allCutoffs = wf.steps.flatMap(s => s.actions.flatMap(cutoffs));

    return (
        <Stack sx={{ p: 1, gap: 0.75, minWidth: 0 }} data-testid="workflows-panel">
            <Stack direction="row" sx={{ gap: 0.5, alignItems: 'center' }}>
                <FormControl size="small" fullWidth>
                    <Select
                        value={wf.id} onChange={e => useWorkflowStore.getState().select(String(e.target.value))}
                        inputProps={{ 'aria-label': 'Workflow' }} sx={{ fontSize: 13 }}
                        MenuProps={{ PaperProps: { sx: { maxHeight: 420 } } }}
                    >
                        {WORKFLOW_GROUPS.flatMap(g => [
                            <ListSubheader key={`g:${g}`} sx={{ lineHeight: '28px', fontSize: 11 }}>{g}</ListSubheader>,
                            ...WORKFLOWS.filter(w => w.group === g).map(w => (
                                <MenuItem key={w.id} value={w.id} sx={{ fontSize: 13 }}>{w.name}</MenuItem>
                            )),
                        ])}
                    </Select>
                </FormControl>
                <Tooltip title="Close every plot">
                    <IconButton size="small" onClick={() => clearWorkflowPlots()} aria-label="Clear plots"><DeleteSweep fontSize="small" /></IconButton>
                </Tooltip>
                <Tooltip title="Forget which steps have run">
                    <IconButton size="small" onClick={() => useWorkflowStore.getState().reset(wf.id)} aria-label="Reset steps"><Replay fontSize="small" /></IconButton>
                </Tooltip>
            </Stack>
            <Typography variant="caption" color="text.secondary">{wf.summary}</Typography>
            <FormControlLabel
                sx={{ ml: 0, mr: 0, '& .MuiFormControlLabel-label': { fontSize: 12 } }}
                control={<Switch size="small" checked={replacePrevious} onChange={(_, v) => useWorkflowStore.getState().setReplacePrevious(v)} />}
                label="Replace the previous step's plots"
            />
            <List dense disablePadding>
                {wf.steps.map((s, i) => (
                    <StepRow
                        key={s.id} index={i} step={s} done={!!done[s.id]} isNext={i === nextIndex}
                        running={running === s.id} availability={availability[i]} onRun={() => void run(s)}
                    />
                ))}
            </List>
            <Button
                size="small" onClick={() => setRefsOpen(o => !o)} endIcon={refsOpen ? <ExpandLess /> : <ExpandMore />}
                sx={{ alignSelf: 'flex-start', textTransform: 'none', px: 0.5 }}
            >
                References and cut-offs
            </Button>
            <Collapse in={refsOpen}>
                <Stack sx={{ gap: 0.5 }}>
                    {allCutoffs.length > 0 && (
                        <Box>
                            <Typography variant="caption" sx={{ fontWeight: 600 }}>Cut-offs used (element ppm, oxide wt%, ratios as made)</Typography>
                            {allCutoffs.map((c, i) => <Typography key={i} variant="caption" component="p" sx={{ pl: 1 }}>{c}</Typography>)}
                        </Box>
                    )}
                    <Box>
                        <Typography variant="caption" sx={{ fontWeight: 600 }}>References</Typography>
                        {wf.references.map((r, i) => (
                            <Typography key={i} variant="caption" component="p" sx={{ pl: 1 }}>{r.cite}{r.note ? ` — ${r.note}` : ''}</Typography>
                        ))}
                    </Box>
                </Stack>
            </Collapse>
        </Stack>
    );
};

export default WorkflowsPanel;
