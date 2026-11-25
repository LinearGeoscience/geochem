/**
 * What the samples' colours stand for in a view of the model that colours
 * them by a column of its own (features/model/sampleColour): the ramp and
 * its range, or the classes with how many samples each has.
 */
import React from 'react';
import { Box, Paper, Typography } from '@mui/material';
import { formatLegendValue as fmt, rampValueAt, type SampleLegend as Legend } from '../../model/sampleColour';

/** Classes listed; the rest are counted */
const MAX_ITEMS = 14;

const Swatch: React.FC<{ color: string }> = ({ color }) => (
    <Box component="span" sx={{ width: 10, height: 10, flexShrink: 0, bgcolor: color, border: 1, borderColor: 'divider', borderRadius: 0.25 }} />
);

export const SampleLegend: React.FC<{ legend: Legend }> = ({ legend }) => (
    <Paper
        variant="outlined" data-testid="sample-legend"
        sx={{ width: 190, maxWidth: 230, minHeight: 0, overflow: 'auto', px: 1, py: 0.5, bgcolor: 'background.paper', opacity: 0.93, flexShrink: 0 }}
    >
        <Typography variant="caption" noWrap sx={{ display: 'block', fontWeight: 600 }} title={`Samples: ${legend.title}`}>
            Samples · {legend.title}{legend.kind === 'ramp' && legend.log ? ' (log)' : ''}
        </Typography>
        {legend.kind === 'ramp' ? (
            <>
                <Box sx={{ height: 10, borderRadius: 0.5, background: `linear-gradient(to right, ${legend.colors.join(', ')})` }} />
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="caption" color="text.secondary">≤ {fmt(legend.min)}</Typography>
                    <Typography variant="caption" color="text.secondary">{fmt(rampValueAt(legend, 0.5))}</Typography>
                    <Typography variant="caption" color="text.secondary">≥ {fmt(legend.max)}</Typography>
                </Box>
                {legend.blank > 0 && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        <Swatch color="#9e9e9e" />
                        <Typography variant="caption" sx={{ flex: 1 }}>No value</Typography>
                        <Typography variant="caption" color="text.secondary">{legend.blank.toLocaleString()}</Typography>
                    </Box>
                )}
            </>
        ) : (
            <>
                {legend.items.slice(0, MAX_ITEMS).map(item => (
                    <Box key={item.label} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                        <Swatch color={item.color} />
                        <Typography variant="caption" noWrap sx={{ flex: 1, minWidth: 0, lineHeight: 1.5 }}>{item.label}</Typography>
                        <Typography variant="caption" color="text.secondary">{item.count.toLocaleString()}</Typography>
                    </Box>
                ))}
                {legend.items.length > MAX_ITEMS && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>and {legend.items.length - MAX_ITEMS} more</Typography>
                )}
            </>
        )}
    </Paper>
);
