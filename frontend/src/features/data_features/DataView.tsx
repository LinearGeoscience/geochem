import React, { useCallback } from 'react';
import { Box, Paper, Typography, Button } from '@mui/material';
import { Download } from '@mui/icons-material';
import { DataGrid, GridColDef } from '@mui/x-data-grid';
import { useAppStore } from '../../store/appStore';

export const DataView: React.FC = () => {
    const { data, columns } = useAppStore();

    // Export data to CSV
    const handleExportCSV = useCallback(() => {
        if (!data.length || !columns.length) return;

        // Get column names (excluding internal fields)
        const columnNames = columns.filter(c => c && c.name).map(c => c.name);

        // Build CSV content
        const csvRows: string[] = [];

        // Header row
        csvRows.push(columnNames.map(name => `"${name.replace(/"/g, '""')}"`).join(','));

        // Data rows
        data.forEach(row => {
            const values = columnNames.map(colName => {
                const value = row[colName];
                if (value === null || value === undefined) {
                    return '';
                }
                if (typeof value === 'string') {
                    return `"${value.replace(/"/g, '""')}"`;
                }
                return String(value);
            });
            csvRows.push(values.join(','));
        });

        const csvContent = csvRows.join('\n');

        // Create and download the file
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `geochem_export_${new Date().toISOString().slice(0, 10)}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }, [data, columns]);

    // Filter out any columns with invalid/missing names and ensure each has a valid field
    const gridColumns: GridColDef[] = columns
        .filter((col) => col && col.name) // Remove any columns without a name
        .map((col) => ({
            field: col.name,
            headerName: col.alias || col.name,
            width: 150,
            type: col.type === 'numeric' ? 'number' : 'string',
        }));

    // Add an ID field if not present, as DataGrid requires it
    const gridRows = data.map((row, index) => ({
        id: index,
        ...row,
    }));

    return (
        <Paper sx={{ height: '100%', width: '100%', p: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                <Typography variant="h6">
                    Data Table
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Typography variant="body2" color="text.secondary">
                        <strong>{data.length.toLocaleString()}</strong> rows | <strong>{columns.length}</strong> columns
                    </Typography>
                    <Button
                        variant="outlined"
                        size="small"
                        startIcon={<Download />}
                        onClick={handleExportCSV}
                        disabled={!data.length}
                    >
                        Export CSV
                    </Button>
                </Box>
            </Box>
            <Box sx={{ height: 600, width: '100%' }}>
                <DataGrid
                    rows={gridRows}
                    columns={gridColumns}
                    initialState={{
                        pagination: {
                            paginationModel: { page: 0, pageSize: 100 },
                        },
                    }}
                    pageSizeOptions={[25, 50, 100]}
                    checkboxSelection
                    disableRowSelectionOnClick
                />
            </Box>
        </Paper>
    );
};
