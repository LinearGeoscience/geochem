import React, { useState } from 'react';
import { Box, Paper, Typography, Button, TextField, Dialog, DialogTitle, DialogContent, DialogActions, Autocomplete, IconButton } from '@mui/material';
import { Close, Class, FilterAlt, Download } from '@mui/icons-material';
import { useAppStore } from '../../store/appStore';

export const SelectionManager: React.FC = () => {
    const { selectedIndices, columns, assignClassToSelection, setSelection } = useAppStore();
    const [isClassifyOpen, setIsClassifyOpen] = useState(false);
    const [targetColumn, setTargetColumn] = useState<string>('');
    const [className, setClassName] = useState<string>('');

    if (selectedIndices.length === 0) return null;

    const handleClassify = () => {
        if (targetColumn && className) {
            assignClassToSelection(targetColumn, className);
            setIsClassifyOpen(false);
            // Optional: Clear selection or keep it? keeping it allows adding to multiple classes
        }
    };

    const handleClearSelection = () => {
        setSelection([]);
    };

    // Get existing categorical columns for autocomplete
    const categoricalColumns = columns.filter(c => c.type === 'categorical' || c.role === 'Classification');

    return (
        <>
            <Paper
                elevation={4}
                sx={{
                    position: 'fixed',
                    bottom: 20,
                    right: 20,
                    zIndex: 1000,
                    p: 2,
                    width: 300,
                    borderLeft: '4px solid #1976d2'
                }}
            >
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                    <Typography variant="subtitle1" fontWeight="bold">
                        {selectedIndices.length} Selected
                    </Typography>
                    <IconButton size="small" onClick={handleClearSelection}>
                        <Close fontSize="small" />
                    </IconButton>
                </Box>

                <Box sx={{ display: 'flex', gap: 1, flexDirection: 'column' }}>
                    <Button
                        variant="contained"
                        size="small"
                        startIcon={<Class />}
                        onClick={() => setIsClassifyOpen(true)}
                    >
                        Assign to Class
                    </Button>
                    {/* Future features: Filter, Export */}
                    <Button variant="outlined" size="small" startIcon={<FilterAlt />} disabled>
                        Filter Selection (Soon)
                    </Button>
                    <Button variant="outlined" size="small" startIcon={<Download />} disabled>
                        Export CSV (Soon)
                    </Button>
                </Box>
            </Paper>

            <Dialog open={isClassifyOpen} onClose={() => setIsClassifyOpen(false)}>
                <DialogTitle>Classify Selection</DialogTitle>
                <DialogContent sx={{ pt: 2, minWidth: 300 }}>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
                        <Autocomplete
                            freeSolo
                            options={categoricalColumns.map(c => c.name)}
                            value={targetColumn}
                            onChange={(_, newValue) => setTargetColumn(newValue || '')}
                            onInputChange={(_, newInputValue) => setTargetColumn(newInputValue)}
                            renderInput={(params) => (
                                <TextField {...params} label="Target Column" helperText="Select existing or type new name" />
                            )}
                        />
                        <TextField
                            label="Class Name"
                            value={className}
                            onChange={(e) => setClassName(e.target.value)}
                            helperText="e.g., Ultramafic, High-Grade"
                        />
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setIsClassifyOpen(false)}>Cancel</Button>
                    <Button onClick={handleClassify} variant="contained" disabled={!targetColumn || !className}>
                        Assign
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
};
