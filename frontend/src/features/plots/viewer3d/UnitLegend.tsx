/**
 * What the colours of a geological model's solids stand for, in a view that
 * shows them: each lithology of each model with its colour, the youngest at
 * the top. A click shows or hides that lithology's solid in this view.
 */
import React from 'react';
import { Box, Paper, Typography } from '@mui/material';
import { t } from '../../model/terms';
import type { LegendModel } from './legendUnits';

export const UnitLegend: React.FC<{ models: readonly LegendModel[]; onShow: (key: string, shown: boolean) => void }> = ({ models, onShow }) => {
    if (models.length === 0) return null;
    return (
        <Paper variant="outlined" data-testid="unit-legend" sx={{ maxWidth: 230, minHeight: 0, overflow: 'auto', px: 1, py: 0.5, bgcolor: 'background.paper', opacity: 0.93 }}>
            {models.map(m => (
                <Box key={m.id} data-model={m.id} sx={{ '& + &': { mt: 0.75 } }}>
                    <Typography variant="caption" noWrap sx={{ display: 'block', fontWeight: 600 }} title={`${m.name}: its ${t('lithologies').toLowerCase()}, the youngest at the top`}>{m.name}</Typography>
                    {m.units.map(u => (
                        <Box
                            key={u.key} role="checkbox" aria-checked={u.shown} aria-label={u.name} tabIndex={0} data-unit={u.name}
                            title={u.shown ? `${u.name}: hide its solid in this view` : `${u.name}: show its solid in this view`}
                            onClick={() => onShow(u.key, !u.shown)}
                            onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onShow(u.key, !u.shown); } }}
                            sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, cursor: 'pointer', borderRadius: 0.5, opacity: u.shown ? 1 : 0.5, '&:hover': { bgcolor: 'action.hover' }, '&:focus-visible': { outline: 1, outlineColor: 'primary.main' } }}
                        >
                            <Box component="span" sx={{ width: 10, height: 10, flexShrink: 0, bgcolor: u.shown ? u.color : 'transparent', border: 1, borderColor: u.shown ? 'divider' : u.color, borderRadius: 0.25 }} />
                            <Typography variant="caption" noWrap sx={{ flex: 1, minWidth: 0, lineHeight: 1.5, textDecoration: u.shown ? undefined : 'line-through' }}>{u.name}</Typography>
                        </Box>
                    ))}
                </Box>
            ))}
        </Paper>
    );
};
