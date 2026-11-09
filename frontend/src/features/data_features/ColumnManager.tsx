import React, { useState, useCallback } from 'react';
import {
    Box, Paper, Typography, Select, MenuItem, TextField, FormControl, Button,
    Dialog, DialogTitle, DialogContent, DialogActions, Alert, Tooltip
} from '@mui/material';
import { MergeType, MedicalServices } from '@mui/icons-material';
import { useUIStore } from '../../store/uiStore';
import { DataGrid, GridColDef, GridRenderCellParams, GridRowId, useGridApiRef } from '@mui/x-data-grid';
import { useAppStore } from '../../store/appStore';
import { useShallow } from 'zustand/react/shallow';
import { notify } from '../../store/notificationStore';
import { ProjectionPicker } from '../../components/ProjectionPicker';

export const ColumnManager: React.FC = () => {
    const { columns, updateColumn, updateColumnType, updateColumnTypes, tidyCategoryValues, rowCount, setShowLoggingMergeDialog } = useAppStore(useShallow(s => ({
        columns: s.columns, updateColumn: s.updateColumn,
        updateColumnType: s.updateColumnType, updateColumnTypes: s.updateColumnTypes,
        tidyCategoryValues: s.tidyCategoryValues,
        rowCount: s.columnarData.rowCount, setShowLoggingMergeDialog: s.setShowLoggingMergeDialog,
    })));

    // Grid API ref for programmatic control
    const apiRef = useGridApiRef();

    // Selection state - tracked from grid callbacks
    const [selectedColumnIds, setSelectedColumnIds] = useState<GridRowId[]>([]);

    // Clear selection using the grid API
    const clearSelection = useCallback(() => {
        if (apiRef.current) {
            // MUI X DataGrid v7+ uses {type, ids} format
            try {
                apiRef.current.setRowSelectionModel({ type: 'include', ids: new Set() } as any);
            } catch {
                // Fallback for older versions
                apiRef.current.setRowSelectionModel([] as any);
            }
        }
        setSelectedColumnIds([]);
    }, [apiRef]);

    // Bulk type change dialog state
    const [bulkTypeDialogOpen, setBulkTypeDialogOpen] = useState(false);
    const [pendingBulkType, setPendingBulkType] = useState<string | null>(null);

    const handleRoleChange = (name: string, newRole: string) => {
        updateColumn(name, newRole === 'none' ? undefined : newRole, undefined);
    };

    const handleAliasChange = (name: string, newAlias: string) => {
        updateColumn(name, undefined, newAlias);
    };

    const handleTypeChange = (name: string, newType: string) => {
        updateColumnType(name, newType);
    };

    const selectedNames = () => (selectedColumnIds as number[]).map(id => rows[id]?.name).filter(Boolean);
    const selectedTextColumns = () => selectedNames().filter(name => {
        const t = columns.find(c => c.name === name)?.type;
        return t === 'text' || t === 'categorical';
    });

    const handleTidyCategories = () => {
        const targets = selectedTextColumns();
        const changed = tidyCategoryValues(targets);
        notify(changed > 0
            ? `Merged spelling variants: ${changed.toLocaleString()} value${changed === 1 ? '' : 's'} updated`
            : 'No case/whitespace variants found in the selected columns', changed > 0 ? 'success' : 'info');
    };

    const handleBulkTypeChangeRequest = (type: string) => {
        setPendingBulkType(type);
        setBulkTypeDialogOpen(true);
    };

    const handleConfirmBulkTypeChange = () => {
        if (pendingBulkType && selectedColumnIds.length > 0) {
            updateColumnTypes(selectedNames(), pendingBulkType);
            setBulkTypeDialogOpen(false);
            setPendingBulkType(null);
            clearSelection();
        }
    };

    const handleCancelBulkTypeChange = () => {
        setBulkTypeDialogOpen(false);
        setPendingBulkType(null);
    };

    const gridColumns: GridColDef[] = [
        { field: 'name', headerName: 'Column Name', width: 200, flex: 1 },
        {
            field: 'type',
            headerName: 'Type',
            width: 140,
            renderCell: (params: GridRenderCellParams) => (
                <FormControl fullWidth size="small" sx={{ my: 1 }}>
                    <Select
                        value={params.value || 'text'}
                        onChange={(e) => handleTypeChange(params.row.name, e.target.value)}
                        variant="standard"
                        disableUnderline
                        sx={{ textTransform: 'capitalize' }}
                        MenuProps={{
                            disablePortal: false,
                            PaperProps: { sx: { zIndex: 9999 } }
                        }}
                    >
                        <MenuItem value="numeric">Numeric</MenuItem>
                        <MenuItem value="integer">Integer</MenuItem>
                        <MenuItem value="float">Float</MenuItem>
                        <MenuItem value="text">Text</MenuItem>
                        <MenuItem value="categorical">Categorical</MenuItem>
                    </Select>
                </FormControl>
            )
        },
        {
            field: 'role',
            headerName: 'Role',
            width: 200,
            renderCell: (params: GridRenderCellParams) => (
                <FormControl fullWidth size="small" sx={{ my: 1 }}>
                    <Select
                        value={params.value || 'none'}
                        onChange={(e) => handleRoleChange(params.row.name, e.target.value)}
                        variant="standard"
                        disableUnderline
                    >
                        <MenuItem value="none"><em>None</em></MenuItem>
                        <MenuItem value="ID">Sample ID</MenuItem>
                        <MenuItem value="HoleID">Hole ID</MenuItem>
                        <MenuItem value="From">From (Depth)</MenuItem>
                        <MenuItem value="To">To (Depth)</MenuItem>
                        <MenuItem value="East">Easting (X)</MenuItem>
                        <MenuItem value="North">Northing (Y)</MenuItem>
                        <MenuItem value="Elevation">Elevation (Z)</MenuItem>
                        <MenuItem value="Latitude">Latitude</MenuItem>
                        <MenuItem value="Longitude">Longitude</MenuItem>
                        <MenuItem value="Lithology">Lithology</MenuItem>
                        <MenuItem value="Date">Date/Time</MenuItem>
                    </Select>
                </FormControl>
            )
        },
        {
            field: 'alias',
            headerName: 'Alias (Element)',
            width: 150,
            renderCell: (params: GridRenderCellParams) => (
                <TextField
                    variant="standard"
                    value={params.value || ''}
                    onChange={(e) => handleAliasChange(params.row.name, e.target.value)}
                    placeholder="e.g. Au"
                    InputProps={{ disableUnderline: true }}
                    fullWidth
                />
            )
        }
    ];

    const rows = columns
        .filter(col => col && col.name)
        .map((col, index) => ({
            id: index,
            ...col
        }));

    const isNumericConversion = pendingBulkType === 'numeric' || pendingBulkType === 'integer' || pendingBulkType === 'float';

    const hasHoleIdFromTo = columns.some(c => c.role === 'HoleID') &&
        columns.some(c => c.role === 'From') &&
        columns.some(c => c.role === 'To');
    const canMergeLogging = rowCount > 0 && hasHoleIdFromTo;

    return (
        <Paper sx={{ height: '100%', width: '100%', p: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="h6">
                    Column Properties
                </Typography>
                <Box sx={{ flex: 1 }} />
                <Box sx={{ mr: 2 }}><ProjectionPicker /></Box>
                <Button variant="outlined" size="small" startIcon={<MedicalServices />} sx={{ mr: 1 }}
                    disabled={!rowCount} onClick={() => useUIStore.getState().setDataDoctorOpen(true)}>
                    Data Doctor
                </Button>
                <Tooltip title={!rowCount ? 'Load data first' : !hasHoleIdFromTo ? 'Requires HoleID, From, and To columns' : 'Merge logging intervals (lithology, alteration, etc.) onto assay data'}>
                    <span>
                        <Button
                            variant="outlined"
                            size="small"
                            startIcon={<MergeType />}
                            disabled={!canMergeLogging}
                            onClick={() => setShowLoggingMergeDialog(true)}
                        >
                            Merge Logging Intervals
                        </Button>
                    </span>
                </Tooltip>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Define the role and standard alias for each column to enable advanced plotting and validation.
                Select multiple columns to change their type at once.
            </Typography>
            {/* Bulk Action Toolbar - shown when columns are selected */}
            <Box sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                p: 1.5,
                mb: 1,
                bgcolor: selectedColumnIds.length > 0 ? 'primary.main' : 'grey.100',
                color: selectedColumnIds.length > 0 ? 'primary.contrastText' : 'text.secondary',
                borderRadius: 1,
                border: selectedColumnIds.length > 0 ? '2px solid' : '1px solid',
                borderColor: selectedColumnIds.length > 0 ? 'primary.dark' : 'grey.300',
                minHeight: 48
            }}>
                {selectedColumnIds.length > 0 ? (
                    <>
                        <Typography variant="body2" fontWeight="bold">
                            {selectedColumnIds.length} column{selectedColumnIds.length !== 1 ? 's' : ''} selected
                        </Typography>
                        <FormControl size="small" sx={{ minWidth: 160 }}>
                            <Select
                                value=""
                                displayEmpty
                                onChange={(e) => {
                                    if (e.target.value) {
                                        handleBulkTypeChangeRequest(e.target.value);
                                    }
                                }}
                                sx={{ bgcolor: 'background.paper', height: 36 }}
                            >
                                <MenuItem value="" disabled>Change Type...</MenuItem>
                                <MenuItem value="numeric">Numeric</MenuItem>
                                <MenuItem value="integer">Integer</MenuItem>
                                <MenuItem value="float">Float</MenuItem>
                                <MenuItem value="text">Text</MenuItem>
                                <MenuItem value="categorical">Categorical</MenuItem>
                            </Select>
                        </FormControl>
                        <Tooltip title='Merge values that differ only in case or spacing (e.g. "Abra" / "ABRA") into the most common spelling'>
                            <span>
                                <Button
                                    size="small"
                                    variant="contained"
                                    color="inherit"
                                    disabled={selectedTextColumns().length === 0}
                                    onClick={handleTidyCategories}
                                    sx={{ color: 'text.primary' }}
                                >
                                    Tidy categories
                                </Button>
                            </span>
                        </Tooltip>
                        <Button
                            size="small"
                            variant="outlined"
                            onClick={clearSelection}
                            sx={{ color: 'inherit', borderColor: 'inherit', '&:hover': { borderColor: 'inherit', bgcolor: 'rgba(255,255,255,0.1)' } }}
                        >
                            Clear Selection
                        </Button>
                    </>
                ) : (
                    <Typography variant="body2">
                        Select columns using checkboxes to change their type in bulk
                    </Typography>
                )}
            </Box>
            <Box sx={{ height: 540, width: '100%' }}>
                <DataGrid
                    apiRef={apiRef}
                    rows={rows}
                    columns={gridColumns}
                    checkboxSelection
                    disableRowSelectionOnClick
                    onRowSelectionModelChange={(newSelection) => {
                        // Handle both old format (array) and new format ({type, ids: Set})
                        if (Array.isArray(newSelection)) {
                            setSelectedColumnIds([...newSelection]);
                        } else if (newSelection && typeof newSelection === 'object' && 'ids' in newSelection) {
                            // New MUI X DataGrid v7+ format: {type: 'include', ids: Set(...)}
                            setSelectedColumnIds(Array.from((newSelection as any).ids));
                        } else {
                            setSelectedColumnIds([]);
                        }
                    }}
                    rowHeight={50}
                />
            </Box>

            {/* Bulk Type Change Confirmation Dialog */}
            <Dialog open={bulkTypeDialogOpen} onClose={handleCancelBulkTypeChange}>
                <DialogTitle>Confirm Bulk Type Change</DialogTitle>
                <DialogContent>
                    <Typography>
                        Change {selectedColumnIds.length} column{selectedColumnIds.length !== 1 ? 's' : ''} to type "{pendingBulkType}"?
                    </Typography>
                    {isNumericConversion && (
                        <Alert severity="info" sx={{ mt: 2 }}>
                            Text that is not a number becomes blank. Values like "&lt;0.01" become -0.01 (below detection) and "&gt;10000" becomes 10000.
                        </Alert>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCancelBulkTypeChange}>Cancel</Button>
                    <Button onClick={handleConfirmBulkTypeChange} variant="contained">
                        Confirm
                    </Button>
                </DialogActions>
            </Dialog>
        </Paper>
    );
};
