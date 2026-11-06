/**
 * On-plot legend (plot tab menu > Show legend): the Attribute Manager classes
 * shown in this plot, pinned to the pane's top-right corner. Click to hide.
 */
import React, { useMemo } from 'react';
import { Box, Paper } from '@mui/material';
import { AttributeLegend } from '../../components/AttributeLegend';
import { buildLegendModel } from '../../utils/legendModel';
import { useStyleInputs } from '../../hooks/useStyleInputs';
import { useAppStore } from '../../store/appStore';

export const LegendOverlay: React.FC<{ plotId: string }> = ({ plotId }) => {
    const inputs = useStyleInputs();
    const columns = useAppStore(s => s.columns);
    const sections = useMemo(() => {
        void inputs; void columns;
        return buildLegendModel({ tabs: ['color', 'shape', 'size'], combined: true, counts: true, hideEmpty: true });
    }, [inputs, columns]);
    if (!sections.length) return null;
    return (
        // Sticky zero-height strip: the card stays in the corner while the pane scrolls
        <Box sx={{ position: 'sticky', top: 0, height: 0, zIndex: 6, display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-start', pointerEvents: 'none' }}>
            <Paper
                elevation={3}
                title="Legend (click to hide)"
                onClick={() => useAppStore.getState().updatePlotSettings(plotId, { legendOverlay: false })}
                sx={{
                    m: 1, p: 1, maxHeight: 320, maxWidth: 260, overflow: 'auto', cursor: 'pointer',
                    pointerEvents: 'auto', opacity: 0.94, '&:hover': { opacity: 1 },
                }}
            >
                <AttributeLegend sections={sections} fontSize={11} symbolSize={11} />
            </Paper>
        </Box>
    );
};
