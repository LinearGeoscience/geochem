/**
 * What the colours of the logging tables drawn in a 3D view stand for: for
 * each table, its classes (unit, code or class of the samples) with how many
 * intervals each has, or the ramp of its numbers.
 */
import React from 'react';
import { Box, Paper, Typography } from '@mui/material';
import type { LoggingLayer } from './useLoggingLayers';

/** Classes listed for one table; the rest are counted */
const MAX_ITEMS = 12;

const fmt = (v: number) => (Math.abs(v) >= 1000 || Number.isInteger(v) ? String(Math.round(v)) : String(Number(v.toPrecision(3))));

const Swatch: React.FC<{ color: string }> = ({ color }) => (
    <Box component="span" sx={{ width: 10, height: 10, flexShrink: 0, bgcolor: color, border: 1, borderColor: 'divider', borderRadius: 0.25 }} />
);

export const LoggingLegend: React.FC<{ layers: readonly LoggingLayer[]; problem: string | null }> = ({ layers, problem }) => {
    if (layers.length === 0 && !problem) return null;
    return (
        <Paper
            variant="outlined" data-testid="logging-legend"
            sx={{ maxWidth: 230, minHeight: 0, overflow: 'auto', px: 1, py: 0.5, bgcolor: 'background.paper', opacity: 0.93 }}
        >
            {problem && <Typography variant="caption" color="warning.main" sx={{ display: 'block' }}>{problem}</Typography>}
            {layers.map(l => {
                const { legend } = l;
                return (
                    <Box key={l.id} sx={{ '& + &': { mt: 0.75 } }}>
                        <Typography variant="caption" noWrap sx={{ display: 'block', fontWeight: 600 }} title={`${l.name}: ${legend.title}`}>
                            {l.name}{legend.title !== l.name ? ` · ${legend.title}` : ''}
                        </Typography>
                        {legend.kind === 'ramp' ? (
                            <>
                                <Box sx={{ height: 10, borderRadius: 0.5, background: `linear-gradient(to right, ${legend.colors.join(', ')})` }} />
                                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <Typography variant="caption" color="text.secondary">{fmt(legend.min)}</Typography>
                                    <Typography variant="caption" color="text.secondary">{fmt(legend.max)}</Typography>
                                </Box>
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
                    </Box>
                );
            })}
        </Paper>
    );
};
