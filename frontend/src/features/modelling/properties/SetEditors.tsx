/**
 * Sets in the properties: a set of points or lines (which surfaces it shapes,
 * turned over for one of them, locked or not) and a set of readings
 * (followed by the model or not).
 */
import React, { useMemo } from 'react';
import { Box, Button, Checkbox, FormControlLabel, IconButton, Tooltip, Typography } from '@mui/material';
import { SwapVert } from '@mui/icons-material';
import { useModelStore } from '../../../store/modelStore';
import { setText } from '../../model/inputs';
import { keys } from '../../model/objectKeys';
import type { InputSet, ReadingSet } from '../../model/types';
import { sharedLine, sharedLineText } from '../../model/foldAxis';
import { Caption, ColourField, LookRow, NameField } from './parts';

export const InputSetEditor: React.FC<{ set: InputSet }> = ({ set }) => {
    const surfaces = useModelStore(s => s.scene.surfaces);
    const { updateInputSet, setSurfaceUse, flipSetFor } = useModelStore.getState();
    const key = keys.inputs(set.id);
    const owner = surfaces.find(s => s.id === set.owner) ?? null;
    return (
        <Box data-testid="inputs-editor">
            <NameField objectKey={key} name={set.name} />
            <LookRow objectKeys={[key]}>
                <ColourField value={set.color} name={set.name} onChange={color => updateInputSet(set.id, { color })} />
            </LookRow>
            <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
                {setText(set)}{owner ? `, made for ${owner.name}` : set.owner ? ', made for a surface no longer in the project' : ''}
            </Typography>
            <Tooltip describeChild title="Locked: its points and lines cannot be moved, added to or removed by mistake.">
                <FormControlLabel
                    sx={{ ml: -0.75 }}
                    control={<Checkbox size="small" sx={{ p: 0.5 }} checked={!!set.locked} onChange={e => updateInputSet(set.id, { locked: e.target.checked })} />}
                    label={<Typography variant="caption">Locked</Typography>}
                />
            </Tooltip>
            <Caption>Surfaces it shapes</Caption>
            {surfaces.length === 0 && <Typography variant="caption" color="text.secondary">No surfaces yet.</Typography>}
            {surfaces.map(s => {
                const use = s.uses?.find(u => u.set === set.id) ?? null;
                // Every line of the set turned over for this surface only
                const over = !!use && set.kind === 'lines' && set.lines.length > 0 && set.lines.every(l => use.flipped?.includes(l.id));
                return (
                    <Box key={s.id} sx={{ display: 'flex', alignItems: 'center' }}>
                        <FormControlLabel
                            sx={{ flex: 1, minWidth: 0, ml: -0.75, mr: 0 }}
                            control={<Checkbox size="small" sx={{ p: 0.5 }} checked={!!use} onChange={e => setSurfaceUse(s.id, set.id, e.target.checked)} inputProps={{ 'aria-label': `${s.name} uses ${set.name}` }} />}
                            label={<Typography variant="caption" noWrap>{s.name}{over ? ' (turned over)' : ''}</Typography>}
                        />
                        {use && set.kind === 'lines' && set.lines.length > 0 && (
                            <Tooltip title={`Turn every line of this set over for ${s.name} only. Another surface that uses the set keeps its lines the way up it has them.`}>
                                <IconButton size="small" sx={{ p: 0.25 }} aria-label={`Turn ${set.name} over for ${s.name}`} color={over ? 'primary' : 'default'} onClick={() => flipSetFor(s.id, set.id)}>
                                    <SwapVert fontSize="small" />
                                </IconButton>
                            </Tooltip>
                        )}
                    </Box>
                );
            })}
        </Box>
    );
};

const SOURCE: Record<ReadingSet['source'], string> = {
    columns: 'read from columns',
    hand: 'put in by hand',
    suggested: 'suggested from the model',
};

export const ReadingSetEditor: React.FC<{ set: ReadingSet }> = ({ set }) => {
    const { updateReadingSet, addReadingSets } = useModelStore.getState();
    const key = keys.readings(set.id);
    const n = set.readings.length;
    // The line its planes share (a fold's axis, where they are the limbs of one)
    const shared = useMemo(() => (set.kind === 'plane' ? sharedLine(set.readings) : null), [set.kind, set.readings]);
    const keepLine = () => {
        if (!shared) return;
        const middle: [number, number, number] = [0, 0, 0];
        for (const r of set.readings) for (let k = 0; k < 3; k++) middle[k] += r.p[k] / n;
        addReadingSets([{ name: `${set.name}: the line they share`, kind: 'line', source: 'suggested', follow: false, readings: [{ p: middle, dip: shared.line.dip, direction: shared.line.direction }] }]);
    };
    return (
        <Box data-testid="readings-editor">
            <NameField objectKey={key} name={set.name} />
            <LookRow objectKeys={[key]}>
                <ColourField value={set.color} name={set.name} onChange={color => updateReadingSet(set.id, { color })} />
            </LookRow>
            <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
                {n.toLocaleString()} {set.kind === 'plane' ? (n === 1 ? 'plane' : 'planes') : (n === 1 ? 'line' : 'lines')}, {SOURCE[set.source]}
            </Typography>
            <Tooltip describeChild title="The model takes the direction of the ground from place to place from the measurements it follows: sheets, contacts and shells can then lie as they say. Untick to keep them for looking at only.">
                <FormControlLabel
                    sx={{ ml: -0.75 }}
                    control={<Checkbox size="small" sx={{ p: 0.5 }} checked={set.follow !== false} onChange={e => updateReadingSet(set.id, { follow: e.target.checked })} />}
                    label={<Typography variant="caption">The model follows these</Typography>}
                />
            </Tooltip>
            {shared && (
                <Box data-testid="shared-line" sx={{ mt: 0.5 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{sharedLineText(shared)}</Typography>
                    {shared.kind === 'line' && (
                        <Tooltip describeChild title="A set of its own with that one line in it, at the middle of these measurements: to look at, to look along, or for the model to follow as the direction things run in.">
                            <Button size="small" variant="outlined" sx={{ mt: 0.5, textTransform: 'none', py: 0, fontSize: 12 }} onClick={keepLine}>Keep that line as a measurement</Button>
                        </Tooltip>
                    )}
                </Box>
            )}
        </Box>
    );
};
