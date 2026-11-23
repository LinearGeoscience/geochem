import { useState, useEffect } from 'react';
import {
    Box, FormControl, InputLabel, Select, MenuItem, Typography,
    Table, TableBody, TableCell, TableHead, TableRow, Chip, Alert
} from '@mui/material';
import { CheckCircle } from '@mui/icons-material';
import type { LoggingColumnInfo, LoggingMapping } from '../types/loggingInterval';

interface LoggingColumnMapperProps {
    columns: LoggingColumnInfo[];
    preview: Record<string, any>[];
    onMappingChange: (mapping: LoggingMapping | null) => void;
}

const ROLE_LABELS: Record<string, string> = {
    hole_id: 'Hole ID',
    from: 'From (Depth)',
    to: 'To (Depth)',
    category: 'Category',
};

export function LoggingColumnMapper({ columns, preview, onMappingChange }: LoggingColumnMapperProps) {
    const [mapping, setMapping] = useState<Record<string, string>>({
        hole_id: '',
        from: '',
        to: '',
        category: '',
    });

    // Auto-populate from suggestions
    useEffect(() => {
        const initial: Record<string, string> = { hole_id: '', from: '', to: '', category: '' };
        for (const col of columns) {
            if (col.suggested_role && col.confidence >= 50 && col.suggested_role in initial) {
                // Only auto-assign if not already taken
                const alreadyUsed = Object.values(initial).includes(col.name);
                if (!alreadyUsed) {
                    initial[col.suggested_role] = col.name;
                }
            }
        }
        setMapping(initial);
    }, [columns]);

    // Validate and propagate
    useEffect(() => {
        const { hole_id, from: fromCol, to: toCol, category } = mapping;
        if (hole_id && fromCol && toCol && category) {
            // Ensure no duplicates
            const vals = [hole_id, fromCol, toCol, category];
            if (new Set(vals).size === vals.length) {
                onMappingChange({ hole_id, from: fromCol, to: toCol, category });
                return;
            }
        }
        onMappingChange(null);
    }, [mapping, onMappingChange]);

    const handleChange = (role: string, value: string) => {
        setMapping(prev => ({ ...prev, [role]: value }));
    };

    const getConfidenceChip = (colName: string, role: string) => {
        const col = columns.find(c => c.name === colName);
        if (!col || col.suggested_role !== role) return null;
        if (col.confidence >= 80) {
            return <Chip size="small" icon={<CheckCircle />} label="Auto-detected" color="success" sx={{ ml: 1 }} />;
        }
        if (col.confidence >= 50) {
            return <Chip size="small" label="Suggested" color="info" sx={{ ml: 1 }} />;
        }
        return null;
    };

    const usedColumns = new Set(Object.values(mapping).filter(Boolean));

    return (
        <Box>
            <Typography variant="subtitle2" sx={{ mb: 2 }}>
                Map the columns from your logging file to the required fields.
            </Typography>

            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mb: 3 }}>
                {(['hole_id', 'from', 'to', 'category'] as const).map(role => (
                    <FormControl key={role} fullWidth size="small">
                        <InputLabel>{ROLE_LABELS[role]}</InputLabel>
                        <Select
                            value={mapping[role]}
                            label={ROLE_LABELS[role]}
                            onChange={(e) => handleChange(role, e.target.value)}
                        >
                            <MenuItem value="">
                                <em>Select column...</em>
                            </MenuItem>
                            {columns.map(col => (
                                <MenuItem
                                    key={col.name}
                                    value={col.name}
                                    disabled={usedColumns.has(col.name) && mapping[role] !== col.name}
                                >
                                    {col.name}
                                    {col.suggested_role === role && col.confidence >= 50 && ' *'}
                                </MenuItem>
                            ))}
                        </Select>
                        {mapping[role] && getConfidenceChip(mapping[role], role)}
                    </FormControl>
                ))}
            </Box>

            {mapping.category && (
                <Alert severity="info" sx={{ mb: 2 }}>
                    Category column: <strong>{mapping.category}</strong> —{' '}
                    {columns.find(c => c.name === mapping.category)?.unique_count ?? '?'} unique values
                </Alert>
            )}

            {preview.length > 0 && (
                <>
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>
                        Preview (first {preview.length} rows)
                    </Typography>
                    <Box sx={{ overflowX: 'auto', maxHeight: 200 }}>
                        <Table size="small">
                            <TableHead>
                                <TableRow>
                                    {columns.map(col => (
                                        <TableCell key={col.name} sx={{ fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                                            {col.name}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {preview.slice(0, 5).map((row, i) => (
                                    <TableRow key={i}>
                                        {columns.map(col => (
                                            <TableCell key={col.name} sx={{ whiteSpace: 'nowrap' }}>
                                                {row[col.name] != null ? String(row[col.name]) : '—'}
                                            </TableCell>
                                        ))}
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </Box>
                </>
            )}
        </Box>
    );
}
