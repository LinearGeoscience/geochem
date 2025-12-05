import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    TextField,
    Box,
    Typography,
    IconButton,
    Stack,
    Divider,
    Chip
} from '@mui/material';
import { Add, Delete, Palette as PaletteIcon } from '@mui/icons-material';
import { StyleRule, StyleRange, CategoryStyle, ClassificationMethod, MARKER_SHAPES, useStyleStore } from '../../store/styleStore';
import { jenksBreaks, equalIntervals, quantileBreaks, formatBreakLabel } from '../../utils/classification';
import { COLOR_PALETTES, generateColorsFromPalette } from '../../utils/colorPalettes';
import { useAppStore } from '../../store/appStore';

interface RangeEditorProps {
    open: boolean;
    onClose: () => void;
    field: string;
    attribute: 'color' | 'shape' | 'size';
    onSave: (rule: StyleRule) => void;
    existingRule?: StyleRule;
}

export const RangeEditor: React.FC<RangeEditorProps> = ({
    open,
    onClose,
    field,
    attribute,
    onSave,
    existingRule
}) => {
    const { data, columns } = useAppStore();
    const { customPalettes } = useStyleStore();
    const column = columns.find(c => c.name === field);
    const isNumeric = column?.type === 'numeric' || column?.type === 'float' || column?.type === 'integer';

    const [method, setMethod] = useState<ClassificationMethod>(existingRule?.method || 'jenks');
    const [numClasses, setNumClasses] = useState(existingRule?.numClasses || 5);
    const [selectedPalette, setSelectedPalette] = useState(existingRule?.palette || 'Jet');
    const [ranges, setRanges] = useState<StyleRange[]>(existingRule?.ranges || []);
    const [categories, setCategories] = useState<CategoryStyle[]>(existingRule?.categories || []);
    const [initialized, setInitialized] = useState(false);

    // All available palettes (built-in + custom)
    const allPalettes = useMemo(() => [
        ...COLOR_PALETTES,
        ...customPalettes.map(cp => ({ name: cp.name, colors: cp.colors, type: 'sequential' as const }))
    ], [customPalettes]);

    // Memoize numeric values for classification
    const numericValues = useMemo(() => {
        if (!isNumeric || !data.length) return [];
        return data.map(d => d[field]).filter(v => typeof v === 'number' && !isNaN(v));
    }, [data, field, isNumeric]);

    // Memoize unique categorical values (sorted alphabetically)
    const uniqueCategories = useMemo(() => {
        if (isNumeric || !data.length) return [];
        return [...new Set(data.map(d => String(d[field])))]
            .filter(v => v && v !== 'null' && v !== 'undefined')
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    }, [data, field, isNumeric]);

    const generateRanges = useCallback(() => {
        if (numericValues.length === 0) return;

        let breaks: number[] = [];

        switch (method) {
            case 'jenks':
                breaks = jenksBreaks(numericValues, numClasses);
                break;
            case 'equal':
                breaks = equalIntervals(numericValues, numClasses);
                break;
            case 'quantile':
                breaks = quantileBreaks(numericValues, numClasses);
                break;
            case 'manual':
                // Don't auto-generate for manual if ranges already exist
                if (ranges.length > 0) return;
                breaks = equalIntervals(numericValues, numClasses);
                break;
        }

        const colors = attribute === 'color' ? generateColorsFromPalette(selectedPalette, numClasses) : [];

        const newRanges: StyleRange[] = [];
        for (let i = 0; i < breaks.length - 1; i++) {
            newRanges.push({
                min: breaks[i],
                max: breaks[i + 1],
                label: formatBreakLabel(breaks[i], breaks[i + 1], i === breaks.length - 2),
                color: attribute === 'color' ? (colors[i] || '#808080') : undefined,
                shape: attribute === 'shape' ? MARKER_SHAPES[i % MARKER_SHAPES.length].value : undefined,
                size: attribute === 'size' ? 6 + i * 2 : undefined,
                visible: true
            });
        }

        setRanges(newRanges);
    }, [numericValues, method, numClasses, selectedPalette, attribute, ranges.length]);

    const generateCategories = useCallback(() => {
        if (uniqueCategories.length === 0) return;

        const colors = attribute === 'color' ? generateColorsFromPalette(selectedPalette, uniqueCategories.length) : [];

        const newCategories: CategoryStyle[] = uniqueCategories.map((value, i) => ({
            value,
            label: value,
            color: attribute === 'color' ? (colors[i] || '#808080') : undefined,
            shape: attribute === 'shape' ? MARKER_SHAPES[i % MARKER_SHAPES.length].value : undefined,
            size: attribute === 'size' ? 8 : undefined,
            visible: true
        }));

        setCategories(newCategories);
    }, [uniqueCategories, selectedPalette, attribute]);

    // Reset state when dialog opens with new field
    useEffect(() => {
        if (open) {
            setInitialized(false);
            if (existingRule) {
                setMethod(existingRule.method || 'jenks');
                setNumClasses(existingRule.numClasses || 5);
                setSelectedPalette(existingRule.palette || 'Jet');
                setRanges(existingRule.ranges || []);
                setCategories(existingRule.categories || []);
                setInitialized(true);
            }
        }
    }, [open, field, existingRule]);

    // Generate ranges/categories when parameters change (only after initial load)
    useEffect(() => {
        if (!open) return;

        if (isNumeric && numericValues.length > 0) {
            if (!initialized || method !== 'manual') {
                generateRanges();
                setInitialized(true);
            }
        } else if (!isNumeric && uniqueCategories.length > 0) {
            if (!initialized) {
                generateCategories();
                setInitialized(true);
            }
        }
    }, [open, isNumeric, numericValues.length, uniqueCategories.length, method, numClasses, selectedPalette, initialized, generateRanges, generateCategories]);

    // Re-generate when palette changes for categories
    useEffect(() => {
        if (open && !isNumeric && initialized && categories.length > 0) {
            generateCategories();
        }
    }, [selectedPalette]);

    const handleSave = () => {
        const rule: StyleRule = {
            field,
            attribute,
            type: isNumeric ? 'numeric' : 'categorical',
            method: isNumeric ? method : undefined,
            numClasses: isNumeric ? numClasses : undefined,
            palette: selectedPalette,
            ranges: isNumeric ? ranges : undefined,
            categories: !isNumeric ? categories : undefined
        };

        onSave(rule);
        onClose();
    };

    const updateRangeProperty = (index: number, property: keyof StyleRange, value: any) => {
        setRanges(prev => prev.map((r, i) => i === index ? { ...r, [property]: value } : r));
    };

    const updateCategoryProperty = (index: number, property: keyof CategoryStyle, value: any) => {
        setCategories(prev => prev.map((c, i) => i === index ? { ...c, [property]: value } : c));
    };

    const addManualRange = () => {
        const lastRange = ranges[ranges.length - 1];
        const newMin = lastRange ? lastRange.max : 0;
        const newMax = newMin + 1;

        setRanges([...ranges, {
            min: newMin,
            max: newMax,
            label: formatBreakLabel(newMin, newMax),
            color: attribute === 'color' ? '#808080' : undefined,
            shape: attribute === 'shape' ? 'circle' : undefined,
            size: attribute === 'size' ? 8 : undefined,
            visible: true
        }]);
    };

    const deleteRange = (index: number) => {
        setRanges(prev => prev.filter((_, i) => i !== index));
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
            <DialogTitle>
                Configure {attribute.toUpperCase()} for {field}
            </DialogTitle>
            <DialogContent>
                <Stack spacing={3} sx={{ mt: 2 }}>
                    {isNumeric ? (
                        <>
                            <Box sx={{ display: 'flex', gap: 2 }}>
                                <FormControl fullWidth>
                                    <InputLabel>Classification Method</InputLabel>
                                    <Select
                                        value={method}
                                        onChange={(e) => setMethod(e.target.value as ClassificationMethod)}
                                        label="Classification Method"
                                    >
                                        <MenuItem value="jenks">Jenks Natural Breaks</MenuItem>
                                        <MenuItem value="equal">Equal Intervals</MenuItem>
                                        <MenuItem value="quantile">Quantiles (Equal Count)</MenuItem>
                                        <MenuItem value="manual">Manual</MenuItem>
                                    </Select>
                                </FormControl>

                                {method !== 'manual' && (
                                    <TextField
                                        label="Number of Classes"
                                        type="number"
                                        value={numClasses}
                                        onChange={(e) => setNumClasses(Math.max(2, Math.min(10, parseInt(e.target.value) || 5)))}
                                        InputProps={{ inputProps: { min: 2, max: 10 } }}
                                        sx={{ minWidth: 150 }}
                                    />
                                )}
                            </Box>

                            {attribute === 'color' && (
                                <FormControl fullWidth>
                                    <InputLabel>Color Palette</InputLabel>
                                    <Select
                                        value={selectedPalette}
                                        onChange={(e) => setSelectedPalette(e.target.value)}
                                        label="Color Palette"
                                        renderValue={(value) => (
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                <PaletteIcon fontSize="small" />
                                                <Typography>{value}</Typography>
                                            </Box>
                                        )}
                                    >
                                        {allPalettes.map(palette => (
                                            <MenuItem key={palette.name} value={palette.name}>
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                                                    <Typography sx={{ flex: 1 }}>{palette.name}</Typography>
                                                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                                                        {palette.colors.slice(0, 8).map((color, i) => (
                                                            <Box key={i} sx={{ width: 12, height: 12, bgcolor: color, borderRadius: 0.5 }} />
                                                        ))}
                                                    </Box>
                                                    <Chip label={palette.type} size="small" />
                                                </Box>
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>
                            )}

                            <Divider />

                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <Typography variant="subtitle2">Ranges:</Typography>
                                {method === 'manual' && (
                                    <Button startIcon={<Add />} onClick={addManualRange} size="small">
                                        Add Range
                                    </Button>
                                )}
                            </Box>

                            {ranges.map((range, i) => (
                                <Box key={i} sx={{ display: 'flex', gap: 1, alignItems: 'center', p: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
                                    {method === 'manual' && (
                                        <>
                                            <TextField
                                                label="Min"
                                                type="number"
                                                value={range.min}
                                                onChange={(e) => updateRangeProperty(i, 'min', parseFloat(e.target.value))}
                                                size="small"
                                                sx={{ width: 100 }}
                                            />
                                            <TextField
                                                label="Max"
                                                type="number"
                                                value={range.max}
                                                onChange={(e) => updateRangeProperty(i, 'max', parseFloat(e.target.value))}
                                                size="small"
                                                sx={{ width: 100 }}
                                            />
                                        </>
                                    )}
                                    {method !== 'manual' && (
                                        <Typography variant="body2" sx={{ minWidth: 150 }}>
                                            {range.label}
                                        </Typography>
                                    )}

                                    {attribute === 'color' && (
                                        <TextField
                                            type="color"
                                            value={range.color || '#000000'}
                                            onChange={(e) => updateRangeProperty(i, 'color', e.target.value)}
                                            sx={{ width: 80 }}
                                            size="small"
                                        />
                                    )}

                                    {attribute === 'shape' && (
                                        <FormControl sx={{ minWidth: 150 }} size="small">
                                            <Select
                                                value={range.shape || 'circle'}
                                                onChange={(e) => updateRangeProperty(i, 'shape', e.target.value)}
                                            >
                                                {MARKER_SHAPES.map(shape => (
                                                    <MenuItem key={shape.value} value={shape.value}>{shape.label}</MenuItem>
                                                ))}
                                            </Select>
                                        </FormControl>
                                    )}

                                    {attribute === 'size' && (
                                        <TextField
                                            type="number"
                                            label="Size"
                                            value={range.size || 6}
                                            onChange={(e) => updateRangeProperty(i, 'size', parseInt(e.target.value) || 6)}
                                            InputProps={{ inputProps: { min: 2, max: 20 } }}
                                            size="small"
                                            sx={{ width: 100 }}
                                        />
                                    )}

                                    {method === 'manual' && (
                                        <IconButton onClick={() => deleteRange(i)} size="small" color="error">
                                            <Delete fontSize="small" />
                                        </IconButton>
                                    )}
                                </Box>
                            ))}
                        </>
                    ) : (
                        <>
                            {attribute === 'color' && (
                                <FormControl fullWidth>
                                    <InputLabel>Color Palette</InputLabel>
                                    <Select
                                        value={selectedPalette}
                                        onChange={(e) => setSelectedPalette(e.target.value)}
                                        label="Color Palette"
                                    >
                                        {allPalettes.filter(p => p.type === 'categorical' || p.type === 'sequential').map(palette => (
                                            <MenuItem key={palette.name} value={palette.name}>{palette.name}</MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>
                            )}

                            <Typography variant="subtitle2">Categories ({categories.length} items, sorted alphabetically):</Typography>
                            <Box sx={{ maxHeight: 400, overflow: 'auto' }}>
                                {categories.map((category, i) => (
                                    <Box key={i} sx={{ display: 'flex', gap: 2, alignItems: 'center', p: 1, bgcolor: 'action.hover', borderRadius: 1, mb: 1 }}>
                                        <Typography variant="body2" sx={{ minWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {category.label}
                                        </Typography>

                                        {attribute === 'color' && (
                                            <TextField
                                                type="color"
                                                value={category.color || '#000000'}
                                                onChange={(e) => updateCategoryProperty(i, 'color', e.target.value)}
                                                sx={{ width: 80 }}
                                                size="small"
                                            />
                                        )}

                                        {attribute === 'shape' && (
                                            <FormControl sx={{ minWidth: 150 }} size="small">
                                                <Select
                                                    value={category.shape || 'circle'}
                                                    onChange={(e) => updateCategoryProperty(i, 'shape', e.target.value)}
                                                >
                                                    {MARKER_SHAPES.map(shape => (
                                                        <MenuItem key={shape.value} value={shape.value}>{shape.label}</MenuItem>
                                                    ))}
                                                </Select>
                                            </FormControl>
                                        )}

                                        {attribute === 'size' && (
                                            <TextField
                                                type="number"
                                                label="Size"
                                                value={category.size || 8}
                                                onChange={(e) => updateCategoryProperty(i, 'size', parseInt(e.target.value) || 8)}
                                                InputProps={{ inputProps: { min: 2, max: 20 } }}
                                                size="small"
                                                sx={{ width: 100 }}
                                            />
                                        )}
                                    </Box>
                                ))}
                            </Box>
                        </>
                    )}
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button onClick={handleSave} variant="contained">Save</Button>
            </DialogActions>
        </Dialog>
    );
};
