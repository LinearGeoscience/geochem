import React, { useState } from 'react';
import {
    Box, Paper, Typography, Button, TextField, Dialog, DialogTitle,
    DialogContent, DialogActions, Autocomplete, IconButton, Switch,
    FormControlLabel, Select, MenuItem, Divider, Tooltip
} from '@mui/material';
import {
    Close, Class, Brush, Undo, Add, FormatColorReset, SaveAlt
} from '@mui/icons-material';
import { useAppStore } from '../../store/appStore';
import { useAttributeStore } from '../../store/attributeStore';

export const SelectionManager: React.FC = () => {
    const { selectedIndices, columns, assignClassToSelection, setSelection, savePaintGroupsToColumn } = useAppStore();
    const {
        paintMode, setPaintMode,
        activeEntryId, setActiveEntryId,
        customEntries,
        paintIndicesToActiveEntry,
        unpaintIndices,
        undoLastPaint,
        paintHistory,
        createEntryAndSetActive,
        activeTab,
    } = useAttributeStore();

    const [isClassifyOpen, setIsClassifyOpen] = useState(false);
    const [targetColumn, setTargetColumn] = useState<string>('');
    const [className, setClassName] = useState<string>('');
    const [isSaveGroupsOpen, setIsSaveGroupsOpen] = useState(false);
    const [groupColumnName, setGroupColumnName] = useState<string>('Paint_Groups');

    // Show panel when there's a selection OR paint mode is active
    if (selectedIndices.length === 0 && !paintMode) return null;

    const handleClassify = () => {
        if (targetColumn && className) {
            assignClassToSelection(targetColumn, className);
            setIsClassifyOpen(false);
        }
    };

    const handleClearSelection = () => {
        setSelection([]);
    };

    const handlePaint = () => {
        if (activeEntryId && selectedIndices.length > 0) {
            paintIndicesToActiveEntry(selectedIndices);
        }
    };

    const handleUnpaint = () => {
        if (selectedIndices.length > 0) {
            unpaintIndices(selectedIndices);
        }
    };

    const handleQuickCreate = () => {
        createEntryAndSetActive(activeTab);
    };

    const handleSaveGroups = () => {
        if (groupColumnName.trim()) {
            savePaintGroupsToColumn(groupColumnName.trim());
            setIsSaveGroupsOpen(false);
        }
    };

    const hasPaintedGroups = customEntries.some(e => e.assignedIndices.length > 0);

    const activeEntry = customEntries.find(e => e.id === activeEntryId);

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
                    p: 1.5,
                    width: 320,
                    borderLeft: `4px solid ${paintMode ? '#4caf50' : '#1976d2'}`
                }}
            >
                {/* Header */}
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                    <FormControlLabel
                        control={
                            <Switch
                                checked={paintMode}
                                onChange={(e) => setPaintMode(e.target.checked)}
                                size="small"
                                color="success"
                            />
                        }
                        label={
                            <Typography variant="subtitle2" fontWeight="bold">
                                Paint Mode
                            </Typography>
                        }
                        sx={{ mr: 0 }}
                    />
                    <IconButton size="small" onClick={handleClearSelection} title="Clear selection">
                        <Close fontSize="small" />
                    </IconButton>
                </Box>

                {/* Active Entry Selector */}
                <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', mb: 1 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                        Active:
                    </Typography>
                    <Select
                        value={activeEntryId || ''}
                        onChange={(e) => setActiveEntryId(e.target.value || null)}
                        size="small"
                        displayEmpty
                        sx={{ flex: 1, fontSize: '0.8rem', '& .MuiSelect-select': { py: 0.5 } }}
                    >
                        <MenuItem value="">
                            <em>None</em>
                        </MenuItem>
                        {customEntries.map(entry => (
                            <MenuItem key={entry.id} value={entry.id}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <Box sx={{
                                        width: 12, height: 12, borderRadius: '50%',
                                        bgcolor: entry.color || '#808080',
                                        border: '1px solid rgba(0,0,0,0.2)',
                                        flexShrink: 0,
                                    }} />
                                    <Typography variant="body2" noWrap>
                                        {entry.name}
                                    </Typography>
                                </Box>
                            </MenuItem>
                        ))}
                    </Select>
                    <Tooltip title="Create new group">
                        <IconButton size="small" onClick={handleQuickCreate} color="primary">
                            <Add fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </Box>

                {/* Active entry info */}
                {activeEntry && (
                    <Box sx={{
                        display: 'flex', alignItems: 'center', gap: 1, mb: 1,
                        px: 1, py: 0.5, bgcolor: 'action.hover', borderRadius: 1,
                    }}>
                        <Box sx={{
                            width: 16, height: 16, borderRadius: '50%',
                            bgcolor: activeEntry.color || '#808080',
                            border: '1px solid rgba(0,0,0,0.2)',
                        }} />
                        <Typography variant="body2" fontWeight="bold">
                            {activeEntry.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                            ({activeEntry.assignedIndices.length} pts)
                        </Typography>
                    </Box>
                )}

                {/* Selection count */}
                {selectedIndices.length > 0 && (
                    <Typography variant="body2" sx={{ mb: 1 }}>
                        {selectedIndices.length} selected
                    </Typography>
                )}

                {/* Paint action buttons */}
                <Box sx={{ display: 'flex', gap: 0.5, mb: 1 }}>
                    <Tooltip title="Paint selected points into active group">
                        <span>
                            <Button
                                variant="contained"
                                size="small"
                                startIcon={<Brush />}
                                onClick={handlePaint}
                                disabled={!activeEntryId || selectedIndices.length === 0}
                                color="success"
                                sx={{ flex: 1, fontSize: '0.75rem' }}
                            >
                                Paint
                            </Button>
                        </span>
                    </Tooltip>
                    <Tooltip title="Remove selected points from all groups">
                        <span>
                            <Button
                                variant="outlined"
                                size="small"
                                startIcon={<FormatColorReset />}
                                onClick={handleUnpaint}
                                disabled={selectedIndices.length === 0}
                                sx={{ flex: 1, fontSize: '0.75rem' }}
                            >
                                Unpaint
                            </Button>
                        </span>
                    </Tooltip>
                    <Tooltip title="Undo last paint action">
                        <span>
                            <Button
                                variant="outlined"
                                size="small"
                                startIcon={<Undo />}
                                onClick={undoLastPaint}
                                disabled={paintHistory.length === 0}
                                sx={{ minWidth: 0, px: 1 }}
                            >
                                Undo
                            </Button>
                        </span>
                    </Tooltip>
                </Box>

                {/* Selection mode hints */}
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                    Ctrl+lasso = Add | Alt+lasso = Subtract
                </Typography>

                {/* Data Operations */}
                <Divider sx={{ my: 0.5 }} />
                <Button
                    variant="outlined"
                    size="small"
                    startIcon={<Class />}
                    onClick={() => setIsClassifyOpen(true)}
                    disabled={selectedIndices.length === 0}
                    fullWidth
                    sx={{ mt: 0.5, fontSize: '0.75rem' }}
                >
                    Assign to Column Class
                </Button>
                <Button
                    variant="outlined"
                    size="small"
                    startIcon={<SaveAlt />}
                    onClick={() => setIsSaveGroupsOpen(true)}
                    disabled={!hasPaintedGroups}
                    fullWidth
                    sx={{ mt: 0.5, fontSize: '0.75rem' }}
                >
                    Save Groups to Column
                </Button>
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

            <Dialog open={isSaveGroupsOpen} onClose={() => setIsSaveGroupsOpen(false)}>
                <DialogTitle>Save Paint Groups to Column</DialogTitle>
                <DialogContent sx={{ pt: 2, minWidth: 300 }}>
                    <TextField
                        autoFocus
                        fullWidth
                        label="Column Name"
                        value={groupColumnName}
                        onChange={(e) => setGroupColumnName(e.target.value)}
                        helperText="Unpainted rows will be set to 'Unclassified'"
                        sx={{ mt: 1 }}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setIsSaveGroupsOpen(false)}>Cancel</Button>
                    <Button onClick={handleSaveGroups} variant="contained" disabled={!groupColumnName.trim()}>
                        Save
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
};
