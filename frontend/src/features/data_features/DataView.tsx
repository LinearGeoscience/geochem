import React, { useCallback, useMemo } from 'react';
import { Box, Paper, Typography, Button } from '@mui/material';
import { Download } from '@mui/icons-material';
import { DataGrid, GridColDef } from '@mui/x-data-grid';
import { useAppStore } from '../../store/appStore';
import { isNumericColumn } from '../../types/columnarData';

export const DataView: React.FC = () => {
    const { data, columns } = useAppStore();
    const columnarRowCount = useAppStore(s => s.columnarData.rowCount);
    const getColumn = useAppStore(s => s.getColumn);

    const rowCount = columnarRowCount > 0 ? columnarRowCount : data.length;

    // Export data to CSV — columnar fast path avoids row materialization
    const handleExportCSV = useCallback(() => {
        if (rowCount === 0 || !columns.length) return;

        const columnNames = columns.filter(c => c && c.name).map(c => c.name);
        const csvRows: string[] = [];

        // Header row
        csvRows.push(columnNames.map(name => `"${name.replace(/"/g, '""')}"`).join(','));

        if (columnarRowCount > 0) {
            // Columnar fast path: read columns directly
            const colArrays = columnNames.map(name => getColumn(name));
            for (let i = 0; i < columnarRowCount; i++) {
                const values = colArrays.map(col => {
                    if (!col) return '';
                    if (isNumericColumn(col)) {
                        const v = col[i];
                        return isNaN(v) ? '' : String(v);
                    }
                    const v = col[i];
                    return v ? `"${String(v).replace(/"/g, '""')}"` : '';
                });
                csvRows.push(values.join(','));
            }
        } else {
            // Legacy row path
            data.forEach(row => {
                const values = columnNames.map(colName => {
                    const value = row[colName];
                    if (value === null || value === undefined) return '';
                    if (typeof value === 'string') return `"${value.replace(/"/g, '""')}"`;
                    return String(value);
                });
                csvRows.push(values.join(','));
            });
        }

        const csvContent = csvRows.join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `geochem_export_${new Date().toISOString().slice(0, 10)}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }, [data, columns, columnarRowCount, rowCount, getColumn]);

    // Filter out any columns with invalid/missing names and ensure each has a valid field
    const gridColumns: GridColDef[] = columns
        .filter((col) => col && col.name) // Remove any columns without a name
        .map((col) => ({
            field: col.name,
            headerName: col.alias || col.name,
            width: 150,
            type: col.type === 'numeric' ? 'number' : 'string',
        }));

    // Build grid rows — use columnar data when available
    // Depends on columnarRowCount (stable scalar) + columns (only changes on add/remove)
    // instead of columnarData (changes on ANY mutation)
    const gridRows = useMemo(() => {
        if (columnarRowCount > 0) {
            const rows: any[] = new Array(columnarRowCount);
            const columnNames = columns.filter(c => c && c.name).map(c => c.name);
            const colArrays = columnNames.map(name => getColumn(name));
            for (let i = 0; i < columnarRowCount; i++) {
                const row: any = { id: i };
                for (let j = 0; j < columnNames.length; j++) {
                    const col = colArrays[j];
                    if (!col) continue;
                    if (col instanceof Float64Array) {
                        const v = col[i];
                        row[columnNames[j]] = isNaN(v) ? null : v;
                    } else {
                        row[columnNames[j]] = col[i] === '' ? null : col[i];
                    }
                }
                rows[i] = row;
            }
            return rows;
        }
        return data.map((row, index) => ({ id: index, ...row }));
    }, [data, columnarRowCount, columns, getColumn]);

    return (
        <Paper sx={{ height: '100%', width: '100%', p: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                <Typography variant="h6">
                    Data Table
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Typography variant="body2" color="text.secondary">
                        <strong>{rowCount.toLocaleString()}</strong> rows | <strong>{columns.length}</strong> columns
                    </Typography>
                    <Button
                        variant="outlined"
                        size="small"
                        startIcon={<Download />}
                        onClick={handleExportCSV}
                        disabled={rowCount === 0}
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
