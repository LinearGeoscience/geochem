/**
 * A unit of a geological model, opened from its row of the age order
 * without leaving the model: what it is built as, which can be changed
 * after the fact (unitBuild.ts: its surface, its place in the order and
 * what was placed on it by hand stay; what is not carried is said); for a
 * unit that cuts across, its check against holes left out and the other
 * ways the same units are modelled; and the settings of its surface.
 */
import React, { useState } from 'react';
import { Box, Link, MenuItem, TextField, Tooltip, Typography } from '@mui/material';
import { useModelStore } from '../../../store/modelStore';
import type { UnitPlan } from '../../model/geoModel';
import { keys } from '../../model/objectKeys';
import type { GeoModel, ModelContact } from '../../model/types';
import { FORM_LABEL, formsFor, PLAN_NAME, rebuildProblem, rebuildUnitAs, unitBuiltAs } from '../../model/unitBuild';
import { DrillCheckNote } from '../../plots/viewer3d/DrillCheckNote';
import { coordsFor, useTargetView } from '../targetView';
import { Caption } from './parts';
import { SurfaceEditor } from './SurfaceEditor';

const select = { style: { fontSize: 13, paddingTop: 2, paddingBottom: 2 } } as const;

export const UnitPanel: React.FC<{ model: GeoModel; contact: ModelContact; onGoTo: (key: string) => void }> = ({ model, contact, onGoTo }) => {
    const scene = useModelStore(s => s.scene);
    const editing = useModelStore(s => s.editingId);
    const target = useTargetView();
    // What came of building it another way: what was not carried, or why it was not done
    const [said, setSaid] = useState<{ unit: string; notes: string[]; bad: boolean } | null>(null);
    const unit = contact.unit;
    const surface = scene.surfaces.find(s => s.id === contact.surface);
    const as = unit ? unitBuiltAs(scene, model, unit) : null;
    if (!unit || !as || as === 'none') return null;
    const problem = rebuildProblem(scene, model, unit);
    const forms = formsFor(scene, model, unit);
    const system = (scene.veinSystems ?? []).find(v => !!contact.surface && v.veins.includes(contact.surface));
    const body = surface?.rule.kind === 'body';
    const others = model.contacts.filter(c => c.unit === unit).length;

    const change = (to: UnitPlan) => {
        const done = rebuildUnitAs(model.id, coordsFor(target), unit, to);
        setSaid(done.ok ? { unit, notes: done.notes, bad: false } : { unit, notes: [done.reason], bad: true });
    };

    return (
        <Box data-testid="unit-panel" data-unit={unit} sx={{ mt: 1, p: 0.75, border: 1, borderColor: 'primary.main', borderRadius: 1 }}>
            <Caption>{unit}: how it is built</Caption>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
                <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>Built as</Typography>
                <Tooltip placement="left" title={problem ?? 'Built another way, it keeps its surface, its place in the chronology and what was placed on it by hand. One step back undoes it.'}>
                    <TextField
                        select size="small" variant="standard" value={as} disabled={!!problem} sx={{ flex: 1, minWidth: 0 }}
                        onChange={e => change(e.target.value as UnitPlan)}
                        SelectProps={{ SelectDisplayProps: { ...select, 'aria-label': `What ${unit} is built as` } as React.HTMLAttributes<HTMLDivElement> }}
                    >
                        {forms.map(f => <MenuItem key={f} dense value={f}>{FORM_LABEL[f]}</MenuItem>)}
                        {!forms.includes(as) && <MenuItem dense value={as}>{FORM_LABEL[as]}</MenuItem>}
                    </TextField>
                </Tooltip>
            </Box>
            {problem && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.3 }}>{problem}</Typography>}
            {said?.unit === unit && said.notes.map(note => (
                <Typography key={note} data-testid="rebuilt-note" variant="caption" color={said.bad ? 'warning.main' : 'text.secondary'} sx={{ display: 'block', lineHeight: 1.3, mt: 0.25 }}>{note}</Typography>
            ))}
            {said?.unit === unit && !said.bad && said.notes.length === 0 && (
                <Typography data-testid="rebuilt-note" variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.3, mt: 0.25 }}>
                    It is now {PLAN_NAME[as]}: the same surface, with everything placed on it by hand.
                </Typography>
            )}
            {system && (
                <Typography data-testid="unit-system" variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.3, mt: 0.5 }}>
                    {surface?.name ?? 'This vein'} is one of the {others} veins of{' '}
                    <Link component="button" type="button" variant="caption" underline="hover" data-action="go-system" onClick={() => onGoTo(keys.veinSystem(system.id))}>{system.name}</Link>
                    : their order and where one stops at another are set there.
                </Typography>
            )}
            {/* (Open for editing, its check is under its Outputs) */}
            {body && surface && editing !== surface.id && (
                <DrillCheckNote target={system ? { kind: 'system', id: system.id } : { kind: 'surface', id: surface.id }} surfaceId={surface.id} onGoTo={onGoTo} />
            )}
            {surface && (
                <Box data-testid="unit-surface" sx={{ mt: 0.75, pt: 0.5, borderTop: 1, borderColor: 'divider' }}>
                    <SurfaceEditor surface={surface} />
                </Box>
            )}
        </Box>
    );
};
