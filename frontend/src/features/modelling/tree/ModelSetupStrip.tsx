/**
 * The steps of setting a geological model up, over the project tree (Phase
 * 211): which are done, which is the one to take now, and what is the
 * matter where something is. A step clicked goes to where it is done: the
 * import page, the dialog that groups the logged codes or starts a model,
 * or the tab of the model's editor. Folded, only the step to take is shown.
 */
import React from 'react';
import { Box, ButtonBase, CircularProgress, MenuItem, TextField, Tooltip, Typography } from '@mui/material';
import { CheckCircle, ExpandLess, ExpandMore, RadioButtonUnchecked, RemoveCircleOutline, TripOrigin, WarningAmber } from '@mui/icons-material';
import { useAppStore } from '../../../store/appStore';
import { useModelStore } from '../../../store/modelStore';
import { keys, type ModelGroupPart } from '../../model/objectKeys';
import { pickFromView } from '../../model/treePicks';
import { nextStep, progress, type StepId, type StepState, type WorkflowStep } from '../../model/workflow';
import { MODEL_PANEL_IDS, showModelPane } from '../modellingApi';
import { makeFromMenu } from '../newActions';
import { useTargetView } from '../targetView';
import { useModelWorkflow, useSetupStrip } from './useModelWorkflow';

/** The part of the model each step is set in */
const PART: Partial<Record<StepId, ModelGroupPart>> = { lithologies: 'lithologies', model: 'boundary', chronology: 'chronology', faults: 'faults', check: 'volumes', outputs: 'volumes' };

const STATE_WORD: Record<StepState, string> = { done: 'done', next: 'the step to take now', todo: 'waits for an earlier step', optional: 'can be left', busy: 'being worked out', problem: 'something is the matter' };

const icon = { fontSize: 15, flexShrink: 0 } as const;
const StateIcon: React.FC<{ state: StepState }> = ({ state }) => {
    switch (state) {
        case 'done': return <CheckCircle sx={{ ...icon, color: 'success.main' }} />;
        case 'next': return <TripOrigin sx={{ ...icon, color: 'primary.main' }} />;
        case 'busy': return <CircularProgress size={12} thickness={5} sx={{ mx: '1.5px', flexShrink: 0 }} />;
        case 'problem': return <WarningAmber sx={{ ...icon, color: 'warning.main' }} />;
        case 'optional': return <RemoveCircleOutline sx={{ ...icon, color: 'text.disabled' }} />;
        default: return <RadioButtonUnchecked sx={{ ...icon, color: 'text.disabled' }} />;
    }
};

export const ModelSetupStrip: React.FC = () => {
    const { steps, facts, model, models, choose } = useModelWorkflow();
    const open = useSetupStrip(s => s.open);
    const setOpen = useSetupStrip(s => s.setOpen);
    const target = useTargetView();
    const next = nextStep(steps);
    const { done, of } = progress(steps);
    // Folded: the step to take, else the one with something the matter or being worked out
    const one = next ?? steps.find(s => s.state === 'problem') ?? steps.find(s => s.state === 'busy') ?? null;

    /** What cannot be gone to yet, and why (null: it can) */
    const waits = (id: StepId): string | null => (!model && id !== 'data' && id !== 'lithologies' && id !== 'model' ? 'Start a model first' : null);
    const go = (id: StepId) => {
        const show = (key: string) => { if (pickFromView(key)) showModelPane(MODEL_PANEL_IDS.properties); };
        if (id === 'data') {
            if (facts.holes > 0) show(keys.root('drillholes'));
            else useAppStore.getState().setCurrentView('import');
        } else if (id === 'lithologies' && facts.groupings === 0) makeFromMenu('units', target);
        else if (id === 'lithologies' && !model) show(keys.unitMap(useModelStore.getState().scene.unitMaps![0].id));
        else if (id === 'model' && !model) makeFromMenu('model', target);
        else if (model && PART[id]) show(keys.modelGroup(model.id, PART[id]!));
    };

    const row = (s: WorkflowStep) => {
        const why = waits(s.id);
        // The line under its name: where it stands, for the steps that want looking at
        const under = s.state === 'next' || s.state === 'problem' || s.state === 'busy';
        return (
            <Tooltip key={s.id} title={why ?? (under || s.state === 'done' ? '' : s.note)} placement="right" enterDelay={500}>
                <span>
                    <ButtonBase
                        data-step={s.id} data-state={s.state} disabled={!!why} onClick={() => go(s.id)}
                        aria-label={`${s.label}: ${STATE_WORD[s.state]}. ${s.note}`} aria-current={s.state === 'next' ? 'step' : undefined}
                        sx={{ display: 'flex', width: '100%', alignItems: 'flex-start', justifyContent: 'flex-start', textAlign: 'left', gap: 0.75, px: 1, py: 0.25, borderRadius: 0.5, '&:hover': { bgcolor: 'action.hover' }, '&.Mui-disabled': { opacity: 0.55 } }}
                    >
                        <Box sx={{ display: 'flex', alignItems: 'center', height: 20 }}><StateIcon state={s.state} /></Box>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
                                <Typography noWrap sx={{ fontSize: 13, lineHeight: '20px', fontWeight: s.state === 'next' ? 600 : 400, color: s.state === 'todo' ? 'text.secondary' : 'text.primary', flexShrink: 0 }}>{s.label}</Typography>
                                {!under && s.state === 'done' && <Typography noWrap sx={{ fontSize: 12, color: 'text.secondary', minWidth: 0, flex: 1, textAlign: 'right' }}>{s.note}</Typography>}
                            </Box>
                            {under && <Typography data-testid="step-note" sx={{ display: 'block', fontSize: 12, lineHeight: 1.35, pb: 0.25, color: s.state === 'problem' ? 'warning.main' : 'text.secondary' }}>{s.note}</Typography>}
                        </Box>
                    </ButtonBase>
                </span>
            </Tooltip>
        );
    };

    return (
        <Box data-testid="model-setup" role="group" aria-label="Setting up a geological model" sx={{ mx: 1, mt: 0.75, border: 1, borderColor: 'divider', borderRadius: 1, flexShrink: 0 }}>
            <ButtonBase
                data-action="toggle-setup" aria-expanded={open} onClick={() => setOpen(!open)}
                sx={{ display: 'flex', width: '100%', alignItems: 'center', gap: 0.75, px: 1, py: 0.25, borderRadius: 1 }}
            >
                <Typography noWrap sx={{ fontSize: 12, fontWeight: 600, color: 'text.secondary', flex: 1, minWidth: 0, textAlign: 'left' }}>
                    Model setup{model && models.length === 1 ? `: ${model.name}` : ''}
                </Typography>
                <Typography data-testid="setup-progress" sx={{ fontSize: 12, color: done === of ? 'success.main' : 'text.secondary', flexShrink: 0 }}>{done === of ? 'All done' : `${done} of ${of}`}</Typography>
                {open ? <ExpandLess sx={{ fontSize: 16, color: 'text.secondary' }} /> : <ExpandMore sx={{ fontSize: 16, color: 'text.secondary' }} />}
            </ButtonBase>
            {open && models.length > 1 && model && (
                <Box sx={{ px: 1, pb: 0.25 }}>
                    <TextField
                        select size="small" variant="standard" fullWidth value={model.id} onChange={e => choose(e.target.value)}
                        SelectProps={{ SelectDisplayProps: { 'aria-label': 'The model the steps are for', style: { fontSize: 13, paddingTop: 1, paddingBottom: 1 } } as React.HTMLAttributes<HTMLDivElement> }}
                    >
                        {models.map(m => <MenuItem key={m.id} dense value={m.id}>{m.name}</MenuItem>)}
                    </TextField>
                </Box>
            )}
            {open ? <Box sx={{ pb: 0.5 }}>{steps.map(row)}</Box> : one && <Box sx={{ pb: 0.5 }}>{row(one)}</Box>}
        </Box>
    );
};
