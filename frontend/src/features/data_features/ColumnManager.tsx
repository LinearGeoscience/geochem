import React from 'react';
import { Box, Paper, Typography, Select, MenuItem, TextField, FormControl } from '@mui/material';
import { DataGrid, GridColDef, GridRenderCellParams } from '@mui/x-data-grid';
import { useAppStore } from '../../store/appStore';

export const ColumnManager: React.FC = () => {
    const { columns, updateColumn, updateColumnType } = useAppStore();

    const handleRoleChange = (name: string, newRole: string) => {
        updateColumn(name, newRole === 'none' ? undefined : newRole, undefined);
    };

    const handleAliasChange = (name: string, newAlias: string) => {
        updateColumn(name, undefined, newAlias);
    };

    const handleTypeChange = (name: string, newType: string) => {
        updateColumnType(name, newType, true); // treatNegativeAsZero = true
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
        .filter(col => col && col.name)  // Defensive null check
        .map((col, index) => ({
            id: index,
            ...col
        }));

    return (
        <Paper sx={{ height: '100%', width: '100%', p: 2 }}>
            <Typography variant="h6" gutterBottom>
                Column Properties
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Define the role and standard alias for each column to enable advanced plotting and validation.
            </Typography>
            <Box sx={{ height: 600, width: '100%' }}>
                <DataGrid
                    rows={rows}
                    columns={gridColumns}
                    disableRowSelectionOnClick
                    rowHeight={50}
                />
            </Box>
        </Paper>
    );
};
