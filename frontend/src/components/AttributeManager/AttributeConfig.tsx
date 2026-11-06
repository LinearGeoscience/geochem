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
    Chip,
} from '@mui/material';
import { RestartAlt, Palette as PaletteIcon, SwapVert, Add, Close } from '@mui/icons-material';
import {
    useAttributeStore,
    AttributeType,
    AttributeConfig as AttributeConfigType,
    ClassificationMethod,
} from '../../store/attributeStore';
import { useAppStore, useAnalyticalStore } from '../../store/appStore';
import { COLOR_PALETTES, generateColorsFromPalette } from '../../utils/colorPalettes';
import {
    configureTab, resetStyles, copyClassificationTo, methodsFor, numericDistinct, METHOD_LABELS, COUNTED_METHODS,
} from '../../utils/attributeClassify';
import { isNumericColumn } from '../../types/columnarData';

interface AttributeConfigProps {
    tab: AttributeType;
    config: AttributeConfigType;
}

const CLASS_COUNTS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15];

/**
 * Field, method, class count and palette of one tab. Every change
 * reclassifies at once on the full dataset and keeps the user's edits;
 * Reset styles rebuilds the palette styles and breaks from scratch.
 */
export const AttributeConfig: React.FC<AttributeConfigProps> = ({ tab, config }) => {
    const columns = useAppStore(s => s.columns);
    const analytical = useAnalyticalStore();
    const colourConfig = useAttributeStore(s => s.color);

    const availableColumns = useMemo(() => (
        tab === 'size' ? columns.filter(c => c.type === 'numeric' || c.type === 'float' || c.type === 'integer') : columns
    ), [columns, tab]);

    const fieldCol = config.field ? analytical.columns.get(config.field) : undefined;
    const isNumericField = !!fieldCol && isNumericColumn(fieldCol);
    // Numeric codes with few values can be coloured by value
    const fewValues = useMemo(() => isNumericField && numericDistinct(fieldCol) !== null, [isNumericField, fieldCol]);
    const combined = (config.additionalFields ?? []).length > 0;
    const methods: ClassificationMethod[] = methodsFor(tab, isNumericField && !combined, fewValues);
    const counted = COUNTED_METHODS.includes(config.method) && isNumericField && !combined;

    const canAddField = !!config.field && (!isNumericField || config.method === 'categorical')
        && (tab === 'color' || tab === 'shape') && (config.additionalFields ?? []).length < 2;
    const selectedFields = useMemo(
        () => new Set([config.field, ...(config.additionalFields ?? [])].filter(Boolean) as string[]),
        [config.field, config.additionalFields],
    );
    const categoricalColumns = useMemo(
        () => columns.filter(c => c.type !== 'numeric' && c.type !== 'float' && c.type !== 'integer'),
        [columns],
    );

    // Size with no field yet: Reset takes the Colour field, method and classes (habit)
    const inheritColour = tab === 'size' && !config.field && !!colourConfig.field;
    const handleReset = () => {
        if (inheritColour) copyClassificationTo('color', ['size']);
        else resetStyles(tab);
    };

    const setAdditional = (fields: string[]) => configureTab(tab, { additionalFields: fields, method: 'categorical' });

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
            {/* Field selector(s) */}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, flex: 1, minWidth: 120 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <FormControl size="small" sx={{ flex: 1, minWidth: 0 }}>
                        <Select
                            value={config.field || ''}
                            onChange={(e) => configureTab(tab, { field: (e.target.value as string) || null })}
                            displayEmpty
                            sx={{ fontSize: '0.75rem' }}
                            inputProps={{ 'aria-label': 'Field' }}
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
                    {canAddField && (
                        <Tooltip title="Combine with another column (one class per combination)">
                            <IconButton
                                size="small"
                                onClick={() => {
                                    const available = categoricalColumns.find(c => !selectedFields.has(c.name));
                                    if (available) setAdditional([...(config.additionalFields ?? []), available.name]);
                                }}
                                sx={{ p: 0.25 }}
                                aria-label="Add field"
                            >
                                <Add sx={{ fontSize: 16 }} />
                            </IconButton>
                        </Tooltip>
                    )}
                </Box>
                {(config.additionalFields ?? []).map((af, idx) => (
                    <Box key={idx} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <FormControl size="small" sx={{ flex: 1, minWidth: 0 }}>
                            <Select
                                value={af}
                                onChange={(e) => {
                                    const next = [...(config.additionalFields ?? [])];
                                    next[idx] = e.target.value as string;
                                    setAdditional(next);
                                }}
                                sx={{ fontSize: '0.75rem' }}
                            >
                                {categoricalColumns
                                    .filter(c => c.name === af || !selectedFields.has(c.name))
                                    .map(col => (
                                        <MenuItem key={col.name} value={col.name}>
                                            {col.alias || col.name}
                                        </MenuItem>
                                    ))}
                            </Select>
                        </FormControl>
                        <Tooltip title="Remove this field">
                            <IconButton
                                size="small"
                                onClick={() => setAdditional((config.additionalFields ?? []).filter((_, i) => i !== idx))}
                                sx={{ p: 0.25 }}
                            >
                                <Close sx={{ fontSize: 16 }} />
                            </IconButton>
                        </Tooltip>
                    </Box>
                ))}
            </Box>

            {/* Method */}
            {config.field && methods.length > 1 && (
                <FormControl size="small" sx={{ minWidth: 100 }}>
                    <Select
                        value={methods.includes(config.method) ? config.method : ''}
                        onChange={(e) => configureTab(tab, { method: e.target.value as ClassificationMethod })}
                        sx={{ fontSize: '0.75rem' }}
                        inputProps={{ 'aria-label': 'Method' }}
                    >
                        {methods.map(m => (
                            <MenuItem key={m} value={m}>{METHOD_LABELS[m]}</MenuItem>
                        ))}
                    </Select>
                </FormControl>
            )}

            {/* Number of classes */}
            {config.field && counted && (
                <FormControl size="small" sx={{ minWidth: 56 }}>
                    <Select
                        value={config.numClasses}
                        onChange={(e) => configureTab(tab, { numClasses: e.target.value as number })}
                        sx={{ fontSize: '0.75rem' }}
                        inputProps={{ 'aria-label': 'Classes' }}
                    >
                        {CLASS_COUNTS.map(n => <MenuItem key={n} value={n}>{n}</MenuItem>)}
                    </Select>
                </FormControl>
            )}

            {config.breaksEdited && (
                <Tooltip title="Breaks edited by hand: kept until the method or class count changes, or Reset styles">
                    <Chip size="small" label="Custom breaks" variant="outlined" sx={{ height: 20, fontSize: '0.65rem' }} />
                </Tooltip>
            )}

            {/* Palette (Colour tab) */}
            {tab === 'color' && config.field && (
                <FormControl size="small" sx={{ minWidth: 80 }}>
                    <Select
                        value={config.palette}
                        onChange={(e) => configureTab(tab, { palette: e.target.value as string })}
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
                                        {generateColorsFromPalette(p.name, 7).map((c, i) => (
                                            <Box key={i} sx={{ width: 10, height: 10, bgcolor: c, borderRadius: 0.5 }} />
                                        ))}
                                    </Box>
                                </Box>
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>
            )}

            {config.field && tab !== 'filter' && (
                <Tooltip title={config.reversed ? 'Order reversed (click to restore)' : 'Reverse the colour / shape / size order'}>
                    <IconButton
                        size="small"
                        color={config.reversed ? 'primary' : 'default'}
                        onClick={() => configureTab(tab, { reversed: !config.reversed })}
                        aria-label="Reverse order"
                    >
                        <SwapVert fontSize="small" />
                    </IconButton>
                </Tooltip>
            )}

            <Tooltip title={inheritColour
                ? `Size classes from the Colour settings (${colourConfig.field})`
                : 'Rebuild classes with palette styles and computed breaks (drops your edits)'}>
                <span>
                    <Button
                        size="small"
                        variant="outlined"
                        startIcon={<RestartAlt />}
                        onClick={handleReset}
                        disabled={!(config.field || inheritColour) || analytical.rowCount === 0}
                        sx={{ fontSize: '0.7rem', whiteSpace: 'nowrap' }}
                    >
                        {inheritColour ? 'From Colour' : 'Reset styles'}
                    </Button>
                </span>
            </Tooltip>
        </Box>
    );
};

export default AttributeConfig;
