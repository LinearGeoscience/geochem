import React, { useMemo } from 'react';
import {
    Box,
    FormControl,
    Select,
    MenuItem,
    Button,
    Tooltip,
    Typography,
    IconButton,
} from '@mui/material';
import { AutoAwesome, Palette as PaletteIcon, SwapVert, Refresh } from '@mui/icons-material';
import {
    useAttributeStore,
    AttributeType,
    AttributeConfig as AttributeConfigType,
    ClassificationMethod,
    createCategoryEntry,
    createRangeEntry,
} from '../../store/attributeStore';
import { useAppStore } from '../../store/appStore';
import { COLOR_PALETTES, generateColorsFromPalette } from '../../utils/colorPalettes';
import { jenksBreaks, equalIntervals, quantileBreaks } from '../../utils/classification';
import { MARKER_SHAPES } from '../../store/attributeStore';

interface AttributeConfigProps {
    tab: AttributeType;
    config: AttributeConfigType;
}

export const AttributeConfig: React.FC<AttributeConfigProps> = ({ tab, config }) => {
    const { data, columns } = useAppStore();
    const {
        setField,
        setMethod,
        setNumClasses,
        setPalette,
        setEntries,
    } = useAttributeStore();

    // Get available columns based on tab type
    const availableColumns = useMemo(() => {
        if (tab === 'size') {
            // Size only works with numeric
            return columns.filter(c =>
                c.type === 'numeric' || c.type === 'float' || c.type === 'integer'
            );
        }
        // Color, Shape, Filter work with all columns
        return columns;
    }, [columns, tab]);

    // Check if current field is numeric
    const isNumericField = useMemo(() => {
        if (!config.field) return false;
        const col = columns.find(c => c.name === config.field);
        return col?.type === 'numeric' || col?.type === 'float' || col?.type === 'integer';
    }, [config.field, columns]);

    // Available classification methods
    const methods: { value: ClassificationMethod; label: string }[] = useMemo(() => {
        if (isNumericField) {
            return [
                { value: 'equal', label: 'Equal Intervals' },
                { value: 'quantile', label: 'Quantiles' },
                { value: 'jenks', label: 'Jenks Natural Breaks' },
                { value: 'manual', label: 'Manual' },
            ];
        }
        return [{ value: 'categorical', label: 'Categorical' }];
    }, [isNumericField]);

    // Number of classes options
    const classOptions = [2, 3, 4, 5, 6, 7, 8, 9, 10];

    // Handle field change
    const handleFieldChange = (field: string) => {
        setField(tab, field || null);
        // Reset method based on field type
        const col = columns.find(c => c.name === field);
        const isNumeric = col?.type === 'numeric' || col?.type === 'float' || col?.type === 'integer';
        setMethod(tab, isNumeric ? 'equal' : 'categorical');
    };

    // Auto-Attribute function
    const handleAutoAttribute = () => {
        if (!config.field || !data.length) return;

        const col = columns.find(c => c.name === config.field);
        const isNumeric = col?.type === 'numeric' || col?.type === 'float' || col?.type === 'integer';

        if (isNumeric) {
            // Get numeric values
            const values = data
                .map(d => d[config.field!])
                .filter(v => typeof v === 'number' && !isNaN(v)) as number[];

            if (values.length === 0) return;

            // Calculate breaks based on method
            let breaks: number[];
            switch (config.method) {
                case 'jenks':
                    breaks = jenksBreaks(values, config.numClasses);
                    break;
                case 'quantile':
                    breaks = quantileBreaks(values, config.numClasses);
                    break;
                case 'equal':
                default:
                    breaks = equalIntervals(values, config.numClasses);
                    break;
            }

            // Generate entries
            const colors = tab === 'color'
                ? generateColorsFromPalette(config.palette, config.numClasses)
                : [];

            const newEntries = [];

            // Keep default entry
            const defaultEntry = config.entries.find(e => e.isDefault);
            if (defaultEntry) {
                newEntries.push(defaultEntry);
            }

            // Create range entries
            for (let i = 0; i < breaks.length - 1; i++) {
                const entry = createRangeEntry(
                    breaks[i],
                    breaks[i + 1],
                    i,
                    tab === 'color' ? colors[i] : undefined,
                    tab === 'shape' ? MARKER_SHAPES[i % MARKER_SHAPES.length].value : undefined,
                    tab === 'size' ? 4 + i * 3 : undefined
                );

                // Calculate row count
                entry.rowCount = values.filter(v =>
                    v >= breaks[i] && (i === breaks.length - 2 ? v <= breaks[i + 1] : v < breaks[i + 1])
                ).length;
                entry.visibleRowCount = entry.rowCount;

                newEntries.push(entry);
            }

            setEntries(tab, newEntries);

        } else {
            // Categorical field
            const uniqueValues = [...new Set(
                data.map(d => String(d[config.field!]))
                    .filter(v => v && v !== 'null' && v !== 'undefined')
            )].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

            // Generate entries
            const colors = tab === 'color'
                ? generateColorsFromPalette(config.palette, uniqueValues.length)
                : [];

            const newEntries = [];

            // Keep default entry
            const defaultEntry = config.entries.find(e => e.isDefault);
            if (defaultEntry) {
                newEntries.push(defaultEntry);
            }

            // Create category entries
            uniqueValues.forEach((value, i) => {
                const entry = createCategoryEntry(
                    value,
                    i,
                    tab === 'color' ? colors[i] : undefined,
                    tab === 'shape' ? MARKER_SHAPES[i % MARKER_SHAPES.length].value : undefined,
                    tab === 'size' ? 8 : undefined
                );

                // Calculate row count
                entry.rowCount = data.filter(d => String(d[config.field!]) === value).length;
                entry.visibleRowCount = entry.rowCount;

                newEntries.push(entry);
            });

            setEntries(tab, newEntries);
        }
    };

    return (
        <Box
            sx={{
                display: 'flex',
                gap: 0.5,
                px: 1,
                py: 0.5,
                borderTop: '1px solid',
                borderColor: 'divider',
                alignItems: 'center',
                flexWrap: 'wrap',
            }}
        >
            {/* Field selector */}
            <FormControl size="small" sx={{ minWidth: 120, flex: 1 }}>
                <Select
                    value={config.field || ''}
                    onChange={(e) => handleFieldChange(e.target.value)}
                    displayEmpty
                    sx={{ fontSize: '0.75rem' }}
                >
                    <MenuItem value="">
                        <em>Select field...</em>
                    </MenuItem>
                    {availableColumns.map(col => (
                        <MenuItem key={col.name} value={col.name}>
                            {col.alias || col.name}
                        </MenuItem>
                    ))}
                </Select>
            </FormControl>

            {/* Classification method (for numeric fields) */}
            {config.field && (
                <FormControl size="small" sx={{ minWidth: 100 }}>
                    <Select
                        value={config.method}
                        onChange={(e) => setMethod(tab, e.target.value as ClassificationMethod)}
                        sx={{ fontSize: '0.75rem' }}
                    >
                        {methods.map(m => (
                            <MenuItem key={m.value} value={m.value}>
                                {m.label}
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>
            )}

            {/* Number of classes (for numeric fields) */}
            {config.field && isNumericField && config.method !== 'manual' && (
                <FormControl size="small" sx={{ minWidth: 60 }}>
                    <Select
                        value={config.numClasses}
                        onChange={(e) => setNumClasses(tab, e.target.value as number)}
                        sx={{ fontSize: '0.75rem' }}
                    >
                        {classOptions.map(n => (
                            <MenuItem key={n} value={n}>{n}</MenuItem>
                        ))}
                    </Select>
                </FormControl>
            )}

            {/* Palette selector (for color tab) */}
            {tab === 'color' && config.field && (
                <FormControl size="small" sx={{ minWidth: 80 }}>
                    <Select
                        value={config.palette}
                        onChange={(e) => setPalette(tab, e.target.value)}
                        sx={{ fontSize: '0.75rem' }}
                        renderValue={(value) => (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <PaletteIcon sx={{ fontSize: 14 }} />
                                <Typography variant="caption">{value}</Typography>
                            </Box>
                        )}
                    >
                        {COLOR_PALETTES.map(p => (
                            <MenuItem key={p.name} value={p.name}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <Typography variant="caption" sx={{ minWidth: 60 }}>{p.name}</Typography>
                                    <Box sx={{ display: 'flex', gap: 0.25 }}>
                                        {p.colors.slice(0, 6).map((c, i) => (
                                            <Box key={i} sx={{ width: 10, height: 10, bgcolor: c, borderRadius: 0.5 }} />
                                        ))}
                                    </Box>
                                </Box>
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>
            )}

            {/* Reverse palette button */}
            {tab === 'color' && config.field && config.entries.filter(e => !e.isDefault).length > 1 && (
                <Tooltip title="Reverse colour order">
                    <IconButton
                        size="small"
                        onClick={() => {
                            const nonDefault = config.entries.filter(e => !e.isDefault);
                            const defaultEntry = config.entries.find(e => e.isDefault);
                            const colors = nonDefault.map(e => e.color);
                            const reversed = [...colors].reverse();
                            const newEntries = nonDefault.map((e, i) => ({
                                ...e,
                                color: reversed[i],
                            }));
                            setEntries(tab, [
                                ...(defaultEntry ? [defaultEntry] : []),
                                ...newEntries,
                            ]);
                        }}
                    >
                        <SwapVert fontSize="small" />
                    </IconButton>
                </Tooltip>
            )}

            {/* Reapply palette (changes colors of existing entries without regenerating) */}
            {tab === 'color' && config.field && config.entries.filter(e => !e.isDefault).length > 0 && (
                <Tooltip title="Reapply palette colours to existing entries">
                    <IconButton
                        size="small"
                        onClick={() => {
                            const nonDefault = config.entries.filter(e => !e.isDefault);
                            const defaultEntry = config.entries.find(e => e.isDefault);
                            const newColors = generateColorsFromPalette(config.palette, nonDefault.length);
                            const newEntries = nonDefault.map((e, i) => ({
                                ...e,
                                color: newColors[i],
                            }));
                            setEntries(tab, [
                                ...(defaultEntry ? [defaultEntry] : []),
                                ...newEntries,
                            ]);
                        }}
                    >
                        <Refresh fontSize="small" />
                    </IconButton>
                </Tooltip>
            )}

            {/* Auto-Attribute button */}
            <Tooltip title="Auto-generate attributes from field values">
                <span>
                    <Button
                        size="small"
                        variant="contained"
                        startIcon={<AutoAwesome />}
                        onClick={handleAutoAttribute}
                        disabled={!config.field || !data.length}
                        sx={{ fontSize: '0.7rem', whiteSpace: 'nowrap' }}
                    >
                        Auto-Attribute
                    </Button>
                </span>
            </Tooltip>
        </Box>
    );
};

export default AttributeConfig;
