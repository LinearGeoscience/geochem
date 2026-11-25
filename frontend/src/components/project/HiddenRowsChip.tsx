/**
 * Status-bar chip: "Showing N of M rows" whenever the Attribute Manager hides
 * anything. Hidden rows are left out of plots and most analyses, so an
 * earlier step's hidden class must never silently empty a later analysis.
 */
import React, { useMemo, useState } from 'react';
import { Box, Button, Popover, Typography } from '@mui/material';
import { VisibilityOff } from '@mui/icons-material';
import { useShallow } from 'zustand/react/shallow';
import { useAttributeStore } from '../../store/attributeStore';
import { useVisibleRowCount } from '../../hooks/useVisibleRowCount';
import { hiddenSources, showAllRows } from '../../utils/hiddenRows';

export const HiddenRowsChip: React.FC = () => {
    const { shown, total } = useVisibleRowCount();
    const sourceState = useAttributeStore(useShallow(s => ({
        color: s.color, shape: s.shape, size: s.size, filter: s.filter, customEntries: s.customEntries, valueFilter: s.valueFilter,
    })));
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);

    const sources = useMemo(() => hiddenSources(sourceState), [sourceState]);
    if (!total || shown === total) return null;
    const none = shown === 0;

    return (
        <>
            <Box
                role="button"
                aria-label="Hidden rows"
                onClick={(e) => setAnchor(e.currentTarget)}
                sx={{
                    display: 'flex', alignItems: 'center', gap: 0.5, px: 0.75, borderRadius: 1, cursor: 'pointer',
                    bgcolor: none ? 'error.main' : 'warning.light', color: none ? 'error.contrastText' : 'warning.contrastText',
                }}
            >
                <VisibilityOff sx={{ fontSize: 13 }} />
                <Typography variant="caption" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {none ? 'All rows hidden' : `Showing ${shown.toLocaleString()} of ${total.toLocaleString()} rows`}
                </Typography>
            </Box>
            <Popover open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }} transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
                <Box sx={{ p: 1.5, maxWidth: 380 }}>
                    <Typography variant="subtitle2">{(total - shown).toLocaleString()} rows hidden</Typography>
                    <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }}>
                        Hidden rows are left out of plots and of statistics, probability plots, clustering and other analyses.
                    </Typography>
                    {sources.length > 0 ? (
                        <Box component="ul" sx={{ m: 0, pl: 2.5, mb: 1 }}>
                            {sources.map((s, i) => (
                                <li key={i}><Typography variant="body2">{s.label}{s.rows !== null ? ` (${s.rows.toLocaleString()} rows)` : ''}</Typography></li>
                            ))}
                        </Box>
                    ) : null}
                    <Button size="small" variant="contained" onClick={() => { showAllRows(); setAnchor(null); }}>Show all rows</Button>
                </Box>
            </Popover>
        </>
    );
};
