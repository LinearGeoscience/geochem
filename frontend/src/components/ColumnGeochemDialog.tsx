/**
 * ColumnGeochemDialog
 *
 * Post-import dialog for reviewing and editing column chemistry recognition.
 * Shows auto-detected element, oxide, unit, and category for each column.
 * Users can override any detection before confirming.
 */

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
    Dialog, DialogTitle, DialogContent, DialogActions,
    Box, Typography, Button, Chip, Collapse, IconButton,
    Table, TableBody, TableRow, TableCell, TableHead,
    Autocomplete, TextField, Select, MenuItem, Checkbox,
    FormControl, Alert
} from '@mui/material';
import {
    ExpandMore, ExpandLess, Close, CheckCircle, Warning
} from '@mui/icons-material';
import { useAppStore } from '../store/appStore';
import {
    ColumnGeochemMapping, GeochemCategory, ElementMappingConfidence
} from '../types/associations';
import {
    PERIODIC_TABLE_SYMBOLS,
    ELEMENT_TO_OXIDES,
    MAJOR_OXIDE_ELEMENTS,
    REE_ELEMENTS,
} from '../utils/calculations/elementNameNormalizer';

interface ColumnGeochemDialogProps {
    open: boolean;
    onClose: () => void;
}

// Element options for autocomplete
const ELEMENT_OPTIONS = ['', ...Array.from(PERIODIC_TABLE_SYMBOLS).sort(), 'LOI'];

// (Unit options rendered inline in the Select component)

// Category display info
const CATEGORY_CONFIG: Record<GeochemCategory, { label: string; color: 'primary' | 'secondary' | 'warning' | 'error' | 'default' | 'info' | 'success' }> = {
    majorOxide: { label: 'Major Oxides', color: 'primary' },
    traceElement: { label: 'Trace Elements', color: 'secondary' },
    ree: { label: 'Rare Earth Elements', color: 'info' },
    unknown: { label: 'Unrecognized', color: 'warning' },
    nonGeochemical: { label: 'Non-Geochemical / Excluded', color: 'default' },
};

// Display order for categories
const CATEGORY_ORDER: GeochemCategory[] = [
    'majorOxide', 'traceElement', 'ree', 'unknown', 'nonGeochemical'
];

function getConfidenceColor(confidence: ElementMappingConfidence, isConfirmed: boolean): 'success' | 'warning' | 'error' | 'default' | 'info' {
    if (isConfirmed) return 'info';
    switch (confidence) {
        case 'high': return 'success';
        case 'medium': return 'warning';
        case 'low': return 'error';
        default: return 'default';
    }
}

function getConfidenceLabel(confidence: ElementMappingConfidence, isConfirmed: boolean): string {
    if (isConfirmed) return 'Confirmed';
    switch (confidence) {
        case 'high': return 'High';
        case 'medium': return 'Medium';
        case 'low': return 'Low';
        default: return 'Unknown';
    }
}

/**
 * Recalculate category when user changes element/oxide/unit
 */
function recalculateCategory(mapping: ColumnGeochemMapping): GeochemCategory {
    if (mapping.isExcluded || mapping.role) return 'nonGeochemical';

    const element = mapping.userOverride ?? mapping.detectedElement;
    if (!element) return 'unknown';

    // LOI always belongs with major oxides
    if (element === 'LOI') return 'majorOxide';

    if (REE_ELEMENTS.has(element)) return 'ree';
    if (mapping.isOxide) return 'majorOxide';

    const effectiveUnit = mapping.userUnit ?? mapping.detectedUnit;
    if (MAJOR_OXIDE_ELEMENTS.has(element) && effectiveUnit === 'pct') return 'majorOxide';

    return 'traceElement';
}

export const ColumnGeochemDialog: React.FC<ColumnGeochemDialogProps> = ({ open, onClose }) => {
    const { geochemMappings, setGeochemMappings, updateColumn } = useAppStore();

    // Local copy for staged edits
    const [localMappings, setLocalMappings] = useState<ColumnGeochemMapping[]>([]);

    // Section collapse state
    const [expandedSections, setExpandedSections] = useState<Record<GeochemCategory, boolean>>({
        majorOxide: true,
        traceElement: true,
        ree: true,
        unknown: true,
        nonGeochemical: false,
    });

    // Load from store when dialog opens
    useEffect(() => {
        if (open) {
            setLocalMappings([...geochemMappings]);
        }
    }, [open, geochemMappings]);

    // Group mappings by category
    const groupedMappings = useMemo(() => {
        const groups: Record<GeochemCategory, ColumnGeochemMapping[]> = {
            majorOxide: [],
            traceElement: [],
            ree: [],
            unknown: [],
            nonGeochemical: [],
        };
        for (const m of localMappings) {
            groups[m.category].push(m);
        }
        return groups;
    }, [localMappings]);

    // Summary counts
    const summaryCounts = useMemo(() => {
        const counts: Record<GeochemCategory, number> = {
            majorOxide: 0,
            traceElement: 0,
            ree: 0,
            unknown: 0,
            nonGeochemical: 0,
        };
        for (const m of localMappings) {
            counts[m.category]++;
        }
        return counts;
    }, [localMappings]);

    // Count unconfirmed low/unknown
    const issueCount = useMemo(() => {
        return localMappings.filter(
            m => !m.isConfirmed && (m.confidence === 'low' || m.confidence === 'unknown') && !m.isExcluded
        ).length;
    }, [localMappings]);

    const toggleSection = useCallback((category: GeochemCategory) => {
        setExpandedSections(prev => ({ ...prev, [category]: !prev[category] }));
    }, []);

    // Update a single mapping locally
    const updateLocalMapping = useCallback((columnName: string, updates: Partial<ColumnGeochemMapping>) => {
        setLocalMappings(prev => prev.map(m => {
            if (m.originalName !== columnName) return m;
            const updated = { ...m, ...updates, isConfirmed: true };
            // Recalculate category
            updated.category = recalculateCategory(updated);
            return updated;
        }));
    }, []);

    // Handle element change
    const handleElementChange = useCallback((columnName: string, newElement: string | null) => {
        updateLocalMapping(columnName, {
            userOverride: newElement || undefined,
            // Reset oxide if element changes
            isOxide: false,
            oxideFormula: null,
        });
    }, [updateLocalMapping]);

    // Handle oxide formula change
    const handleOxideChange = useCallback((columnName: string, oxideFormula: string | null) => {
        updateLocalMapping(columnName, {
            isOxide: !!oxideFormula,
            oxideFormula,
        });
    }, [updateLocalMapping]);

    // Handle unit change
    const handleUnitChange = useCallback((columnName: string, unit: string | null) => {
        updateLocalMapping(columnName, { userUnit: unit });
    }, [updateLocalMapping]);

    // Handle exclude toggle
    const handleExcludeToggle = useCallback((columnName: string, excluded: boolean) => {
        updateLocalMapping(columnName, { isExcluded: excluded });
    }, [updateLocalMapping]);

    // Confirm all
    const handleConfirmAll = useCallback(() => {
        const confirmed = localMappings.map(m => ({ ...m, isConfirmed: true }));
        setGeochemMappings(confirmed);

        // Auto-fill column aliases from confirmed mappings
        const unitDisplay = (unit: string | null | undefined): string => {
            if (!unit || unit === 'none') return '';
            if (unit === 'pct') return ' %';
            return ` ${unit}`;
        };

        for (const m of confirmed) {
            if (m.isExcluded) continue;
            const element = m.userOverride ?? m.detectedElement;
            if (!element) continue;

            const unit = m.userUnit ?? m.detectedUnit;
            let alias: string;

            if (element === 'LOI') {
                alias = `LOI${unitDisplay(unit)}`;
            } else if (m.isOxide && m.oxideFormula) {
                alias = `${m.oxideFormula}${unitDisplay(unit)}`;
            } else {
                alias = `${element}${unitDisplay(unit)}`;
            }

            updateColumn(m.originalName, undefined, alias);
        }

        onClose();
    }, [localMappings, setGeochemMappings, updateColumn, onClose]);

    // Skip / close without saving
    const handleSkip = useCallback(() => {
        onClose();
    }, [onClose]);

    // Get oxide options for a given element
    const getOxideOptions = useCallback((element: string | null): string[] => {
        if (!element) return [];
        return ELEMENT_TO_OXIDES[element] || [];
    }, []);

    return (
        <Dialog
            open={open}
            onClose={handleSkip}
            maxWidth="lg"
            fullWidth
            PaperProps={{ sx: { maxHeight: '85vh' } }}
        >
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
                <Typography variant="h6">Column Chemistry Recognition</Typography>
                <IconButton onClick={handleSkip} size="small">
                    <Close />
                </IconButton>
            </DialogTitle>

            <DialogContent dividers sx={{ p: 0 }}>
                {/* Summary chips */}
                <Box sx={{ px: 2, py: 1.5, display: 'flex', gap: 1, flexWrap: 'wrap', borderBottom: 1, borderColor: 'divider' }}>
                    {CATEGORY_ORDER.map(cat => (
                        summaryCounts[cat] > 0 && (
                            <Chip
                                key={cat}
                                label={`${summaryCounts[cat]} ${CATEGORY_CONFIG[cat].label}`}
                                color={CATEGORY_CONFIG[cat].color}
                                size="small"
                                variant="outlined"
                                onClick={() => toggleSection(cat)}
                            />
                        )
                    ))}
                    {issueCount > 0 && (
                        <Chip
                            icon={<Warning />}
                            label={`${issueCount} need review`}
                            color="error"
                            size="small"
                            variant="outlined"
                        />
                    )}
                </Box>

                {/* Category sections */}
                <Box sx={{ px: 0 }}>
                    {CATEGORY_ORDER.map(cat => {
                        const items = groupedMappings[cat];
                        if (items.length === 0) return null;

                        return (
                            <Box key={cat}>
                                {/* Section header */}
                                <Box
                                    onClick={() => toggleSection(cat)}
                                    sx={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 1,
                                        px: 2,
                                        py: 1,
                                        cursor: 'pointer',
                                        bgcolor: 'grey.50',
                                        borderBottom: 1,
                                        borderColor: 'divider',
                                        '&:hover': { bgcolor: 'grey.100' },
                                    }}
                                >
                                    {expandedSections[cat] ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
                                    <Typography variant="subtitle2" fontWeight="bold">
                                        {CATEGORY_CONFIG[cat].label}
                                    </Typography>
                                    <Chip label={items.length} size="small" color={CATEGORY_CONFIG[cat].color} sx={{ height: 20, fontSize: '0.7rem' }} />
                                </Box>

                                {/* Table */}
                                <Collapse in={expandedSections[cat]}>
                                    <Table size="small" sx={{ '& .MuiTableCell-root': { py: 0.5, px: 1 } }}>
                                        <TableHead>
                                            <TableRow>
                                                <TableCell sx={{ fontWeight: 'bold', width: '20%' }}>Column</TableCell>
                                                <TableCell sx={{ fontWeight: 'bold', width: '18%' }}>Element</TableCell>
                                                <TableCell sx={{ fontWeight: 'bold', width: '18%' }}>Oxide</TableCell>
                                                <TableCell sx={{ fontWeight: 'bold', width: '14%' }}>Unit</TableCell>
                                                <TableCell sx={{ fontWeight: 'bold', width: '14%' }}>Confidence</TableCell>
                                                <TableCell sx={{ fontWeight: 'bold', width: '8%' }} align="center">Excl.</TableCell>
                                            </TableRow>
                                        </TableHead>
                                        <TableBody>
                                            {items.map(mapping => {
                                                const element = mapping.userOverride ?? mapping.detectedElement;
                                                const oxideOptions = getOxideOptions(element);
                                                return (
                                                    <TableRow
                                                        key={mapping.originalName}
                                                        sx={{
                                                            '&:hover': { bgcolor: 'action.hover' },
                                                            opacity: mapping.isExcluded ? 0.5 : 1,
                                                        }}
                                                    >
                                                        {/* Column name */}
                                                        <TableCell>
                                                            <Typography variant="body2" noWrap title={mapping.originalName}>
                                                                {mapping.originalName}
                                                            </Typography>
                                                        </TableCell>

                                                        {/* Element */}
                                                        <TableCell>
                                                            <Autocomplete
                                                                size="small"
                                                                options={ELEMENT_OPTIONS}
                                                                value={element || ''}
                                                                onChange={(_, val) => handleElementChange(mapping.originalName, val || null)}
                                                                renderInput={(params) => (
                                                                    <TextField {...params} variant="standard" placeholder="--" sx={{ minWidth: 80 }} />
                                                                )}
                                                                disableClearable={false}
                                                                freeSolo={false}
                                                                sx={{ '& .MuiInputBase-root': { fontSize: '0.85rem' } }}
                                                            />
                                                        </TableCell>

                                                        {/* Oxide formula */}
                                                        <TableCell>
                                                            {oxideOptions.length > 0 ? (
                                                                <FormControl size="small" variant="standard" fullWidth>
                                                                    <Select
                                                                        value={mapping.oxideFormula || ''}
                                                                        onChange={(e) => handleOxideChange(
                                                                            mapping.originalName,
                                                                            e.target.value || null
                                                                        )}
                                                                        displayEmpty
                                                                        sx={{ fontSize: '0.85rem' }}
                                                                    >
                                                                        <MenuItem value="">
                                                                            <em>Element form</em>
                                                                        </MenuItem>
                                                                        {oxideOptions.map(ox => (
                                                                            <MenuItem key={ox} value={ox}>{ox}</MenuItem>
                                                                        ))}
                                                                    </Select>
                                                                </FormControl>
                                                            ) : (
                                                                <Typography variant="body2" color="text.disabled">--</Typography>
                                                            )}
                                                        </TableCell>

                                                        {/* Unit */}
                                                        <TableCell>
                                                            <FormControl size="small" variant="standard" fullWidth>
                                                                <Select
                                                                    value={mapping.userUnit === null || mapping.userUnit === undefined ? '__auto__' : (mapping.userUnit || 'none')}
                                                                    onChange={(e) => {
                                                                        const v = e.target.value;
                                                                        handleUnitChange(mapping.originalName, v === '__auto__' ? null : v);
                                                                    }}
                                                                    sx={{ fontSize: '0.85rem' }}
                                                                >
                                                                    <MenuItem value="__auto__">
                                                                        <em>Auto ({mapping.detectedUnit || 'none'})</em>
                                                                    </MenuItem>
                                                                    <MenuItem value="ppm">ppm</MenuItem>
                                                                    <MenuItem value="ppb">ppb</MenuItem>
                                                                    <MenuItem value="pct">pct / wt%</MenuItem>
                                                                    <MenuItem value="none">None</MenuItem>
                                                                </Select>
                                                            </FormControl>
                                                        </TableCell>

                                                        {/* Confidence */}
                                                        <TableCell>
                                                            <Chip
                                                                label={getConfidenceLabel(mapping.confidence, mapping.isConfirmed)}
                                                                color={getConfidenceColor(mapping.confidence, mapping.isConfirmed)}
                                                                size="small"
                                                                variant="outlined"
                                                                sx={{ height: 22, fontSize: '0.7rem' }}
                                                            />
                                                        </TableCell>

                                                        {/* Exclude */}
                                                        <TableCell align="center">
                                                            <Checkbox
                                                                checked={mapping.isExcluded}
                                                                onChange={(e) => handleExcludeToggle(mapping.originalName, e.target.checked)}
                                                                size="small"
                                                            />
                                                        </TableCell>
                                                    </TableRow>
                                                );
                                            })}
                                        </TableBody>
                                    </Table>
                                </Collapse>
                            </Box>
                        );
                    })}
                </Box>

                {localMappings.length === 0 && (
                    <Box sx={{ p: 4, textAlign: 'center' }}>
                        <Typography color="text.secondary">
                            No columns loaded. Import data first.
                        </Typography>
                    </Box>
                )}
            </DialogContent>

            <DialogActions sx={{ px: 2, py: 1.5 }}>
                {issueCount > 0 && (
                    <Alert severity="info" sx={{ flex: 1, mr: 2, py: 0 }} icon={<Warning fontSize="small" />}>
                        <Typography variant="caption">
                            {issueCount} column{issueCount > 1 ? 's' : ''} with low confidence - review recommended
                        </Typography>
                    </Alert>
                )}
                <Button onClick={handleSkip} color="inherit">
                    Skip
                </Button>
                <Button
                    onClick={handleConfirmAll}
                    variant="contained"
                    startIcon={<CheckCircle />}
                    disabled={localMappings.length === 0}
                >
                    Confirm All
                </Button>
            </DialogActions>
        </Dialog>
    );
};
