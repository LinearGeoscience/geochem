/**
 * A geological model's age order in a window of its own (Phase 210): the
 * table with room to read across, floated over the views from the model's
 * Chronology tab. It shows the model picked in the tree (the model itself, a
 * part of it, one of its contacts or faults), else the one it showed last,
 * else the first in the project.
 */
import React from 'react';
import { Box, MenuItem, TextField, Typography } from '@mui/material';
import { t } from '../model/terms';
import { pickFromView } from '../model/treePicks';
import { usePickedModel } from './pickedModel';
import { ChronologyTable } from './properties/ChronologyTable';

export const ChronologyPane: React.FC = () => {
    const { model, contact, models, choose } = usePickedModel();
    return (
        <Box aria-label={t('chronology')} data-testid="chronology-pane" sx={{ height: '100%', overflow: 'auto', p: 1.5, bgcolor: 'background.paper', '& .MuiTypography-caption': { fontSize: '0.8125rem' } }}>
            {!model ? (
                <Typography variant="body2" color="text.secondary">No geological model in the project yet. New &gt; New geological model… makes one.</Typography>
            ) : (
                <>
                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 1 }}>
                        {models.length > 1 ? (
                            <TextField
                                select size="small" variant="standard" value={model.id} onChange={e => choose(e.target.value)} sx={{ minWidth: 180 }}
                                SelectProps={{ SelectDisplayProps: { 'aria-label': 'The model whose chronology this is' } as React.HTMLAttributes<HTMLDivElement> }}
                            >
                                {models.map(m => <MenuItem key={m.id} dense value={m.id}>{m.name}</MenuItem>)}
                            </TextField>
                        ) : <Typography variant="subtitle2">{model.name}</Typography>}
                        <Typography variant="body2" color="text.secondary">{t('chronology')}: the youngest at the top. Drag a row by its handle to change the order.</Typography>
                    </Box>
                    <ChronologyTable model={model} picked={contact} onGoTo={key => { pickFromView(key); }} wide />
                </>
            )}
        </Box>
    );
};
