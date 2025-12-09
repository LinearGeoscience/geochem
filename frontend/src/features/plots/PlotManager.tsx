import React from 'react';
import { Box, Paper, Typography, Button, Tabs, Tab } from '@mui/material';
import { AddCircleOutline as AddCircle, Close } from '@mui/icons-material';
import { useAppStore } from '../../store/appStore';

export const PlotManager: React.FC = () => {
    const { plots, activePlotId, addPlot, removePlot, setActivePlotId } = useAppStore();

    return (
        <Paper sx={{ p: 2, mt: 2 }}>
            <Typography variant="h6" gutterBottom>
                Plot Manager
            </Typography>

            <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2" gutterBottom>Add New Plot:</Typography>
                <Box sx={{ display: 'flex', gap: 1, flexDirection: 'column' }}>
                    <Button variant="outlined" startIcon={<AddCircle />} onClick={() => addPlot('scatter')} fullWidth size="small">
                        SCATTER
                    </Button>
                    <Button variant="outlined" startIcon={<AddCircle />} onClick={() => addPlot('ternary')} fullWidth size="small">
                        TERNARY
                    </Button>
                    <Button variant="outlined" startIcon={<AddCircle />} onClick={() => addPlot('spider')} fullWidth size="small">
                        SPIDER
                    </Button>
                    <Button variant="outlined" startIcon={<AddCircle />} onClick={() => addPlot('map')} fullWidth size="small">
                        MAP
                    </Button>
                    <Button variant="outlined" startIcon={<AddCircle />} onClick={() => addPlot('map3d')} fullWidth size="small">
                        MAP 3D
                    </Button>
                    <Button variant="outlined" startIcon={<AddCircle />} onClick={() => addPlot('downhole')} fullWidth size="small">
                        DOWNHOLE
                    </Button>
                    <Button variant="outlined" startIcon={<AddCircle />} onClick={() => addPlot('histogram')} fullWidth size="small">
                        HISTOGRAM
                    </Button>
                    <Button variant="outlined" startIcon={<AddCircle />} onClick={() => addPlot('clr')} fullWidth size="small">
                        CLR BIPLOT
                    </Button>
                    <Button variant="outlined" startIcon={<AddCircle />} onClick={() => addPlot('classification')} fullWidth size="small" color="secondary">
                        CLASSIFICATION
                    </Button>
                </Box>
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
