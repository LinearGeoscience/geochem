import React, { useState } from 'react';
import { Box, Paper, Typography, Button, Tabs, Tab, Select, MenuItem } from '@mui/material';
import { Add, Close } from '@mui/icons-material';
import { useAppStore } from '../../store/appStore';

const PLOT_TYPES = [
    { value: 'scatter', label: 'Scatter' },
    { value: 'ternary', label: 'Ternary' },
    { value: 'spider', label: 'Spider' },
    { value: 'map', label: 'Map' },
    { value: 'map3d', label: 'Map 3D' },
    { value: 'downhole', label: 'Downhole' },
    { value: 'histogram', label: 'Histogram' },
    { value: 'clr', label: 'CLR Biplot' },
    { value: 'classification', label: 'Classification' },
    { value: 'pathfinder', label: 'Pathfinder' },
] as const;

type PlotTypeValue = typeof PLOT_TYPES[number]['value'];

export const PlotManager: React.FC = () => {
    const { plots, activePlotId, addPlot, removePlot, setActivePlotId } = useAppStore();
    const [selectedType, setSelectedType] = useState<PlotTypeValue>('scatter');

    return (
        <Paper sx={{ p: 2, mt: 2 }}>
            <Typography variant="h6" gutterBottom>
                Plot Manager
            </Typography>

            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 2 }}>
                <Select
                    value={selectedType}
                    onChange={(e) => setSelectedType(e.target.value as PlotTypeValue)}
                    size="small"
                    sx={{ flex: 1 }}
                >
                    {PLOT_TYPES.map((pt) => (
                        <MenuItem key={pt.value} value={pt.value}>
                            {pt.label}
                        </MenuItem>
                    ))}
                </Select>
                <Button
                    variant="contained"
                    size="small"
                    startIcon={<Add />}
                    onClick={() => addPlot(selectedType)}
                    sx={{ whiteSpace: 'nowrap' }}
                >
                    Add Plot
                </Button>
            </Box>

            {plots.length > 0 && (
                <Box>
                    <Typography variant="subtitle2" gutterBottom>Open Plots:</Typography>
                    <Tabs
                        orientation="vertical"
                        variant="scrollable"
                        value={activePlotId}
                        onChange={(_, newValue) => setActivePlotId(newValue)}
                        sx={{ borderRight: 1, borderColor: 'divider', maxHeight: 300 }}
                    >
                        {plots.map((plot) => (
                            <Tab
                                key={plot.id}
                                value={plot.id}
                                label={
                                    <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', justifyContent: 'space-between' }}>
                                        <Typography variant="body2" noWrap>{plot.title}</Typography>
                                        <Box
                                            component="span"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                removePlot(plot.id);
                                            }}
                                            sx={{
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                cursor: 'pointer',
                                                padding: 0.5,
                                                borderRadius: 1,
                                                '&:hover': {
                                                    backgroundColor: 'action.hover'
                                                }
                                            }}
                                        >
                                            <Close fontSize="small" />
                                        </Box>
                                    </Box>
                                }
                            />
                        ))}
                    </Tabs>
                </Box>
            )}
        </Paper>
    );
};
