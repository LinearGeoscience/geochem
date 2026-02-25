import React, { useEffect, useMemo, useCallback } from 'react';
import {
    Box,
    Typography,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Slider,
    Switch,
    Collapse,
    TextField,
    IconButton,
    Tooltip,
} from '@mui/material';
import { FilterAlt, RestartAlt } from '@mui/icons-material';
import { useAttributeStore } from '../../store/attributeStore';
import { useAppStore } from '../../store/appStore';
import { getFieldRange } from '../../utils/emphasisUtils';

export const ValueFilterControls: React.FC = () => {
    const { data, columns } = useAppStore();
    const {
        valueFilter,
        color,
        setValueFilterEnabled,
        setValueFilterColumn,
        setValueFilterRange,
        setValueFilterDataRange,
        resetValueFilter,
    } = useAttributeStore();

    const numericColumns = useMemo(() =>
        columns.filter(c => c.type === 'numeric' || c.type === 'float' || c.type === 'integer'),
        [columns]
    );

    // Determine the effective column for filtering
    const effectiveColumn = valueFilter.column || color.field;

    // Auto-detect data range when column changes
    useEffect(() => {
        if (!effectiveColumn || data.length === 0) return;
        const range = getFieldRange(data, effectiveColumn);
        if (range) {
            setValueFilterDataRange(range.min, range.max);
            // If min/max are null (first time), initialize to full range
            const state = useAttributeStore.getState();
            if (state.valueFilter.min === null && state.valueFilter.max === null) {
                setValueFilterRange(range.min, range.max);
            }
        }
    }, [effectiveColumn, data, setValueFilterDataRange, setValueFilterRange]);

    // Count visible points within filter range
    const filterStats = useMemo(() => {
        if (!effectiveColumn || !valueFilter.enabled) return null;
        let total = 0;
        let inRange = 0;
        for (const row of data) {
            const v = row[effectiveColumn];
            if (typeof v === 'number' && !isNaN(v)) {
                total++;
                const aboveMin = valueFilter.min === null || v >= valueFilter.min;
                const belowMax = valueFilter.max === null || v <= valueFilter.max;
                if (aboveMin && belowMax) inRange++;
            }
        }
        return { total, inRange };
    }, [data, effectiveColumn, valueFilter.enabled, valueFilter.min, valueFilter.max]);

    // Slider bounds
    const sliderMin = valueFilter.dataMin ?? 0;
    const sliderMax = valueFilter.dataMax ?? 100;
    const sliderRange = sliderMax - sliderMin;
    const step = sliderRange > 0 ? Math.max(sliderRange / 1000, Number.EPSILON) : 1;

    const handleSliderChange = useCallback((_: Event, value: number | number[]) => {
        if (Array.isArray(value)) {
            setValueFilterRange(value[0], value[1]);
        }
    }, [setValueFilterRange]);

    const handleMinInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value === '' ? null : parseFloat(e.target.value);
        if (val === null || !isNaN(val)) {
            setValueFilterRange(val, valueFilter.max);
        }
    }, [setValueFilterRange, valueFilter.max]);

    const handleMaxInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value === '' ? null : parseFloat(e.target.value);
        if (val === null || !isNaN(val)) {
            setValueFilterRange(valueFilter.min, val);
        }
    }, [setValueFilterRange, valueFilter.min]);

    return (
        <Box sx={{ mt: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <FilterAlt fontSize="small" color={valueFilter.enabled ? 'primary' : 'disabled'} />
                    <Typography variant="subtitle2">
                        Value Filter
                    </Typography>
                    {filterStats && valueFilter.enabled && (
                        <Typography variant="caption" color="text.secondary">
                            ({filterStats.inRange}/{filterStats.total})
                        </Typography>
                    )}
                </Box>
                <Switch
                    size="small"
                    checked={valueFilter.enabled}
                    onChange={(e) => setValueFilterEnabled(e.target.checked)}
                />
            </Box>

            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                Hide data points outside a numeric range
            </Typography>

            <Collapse in={valueFilter.enabled}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mt: 1 }}>
                    {/* Column Selector */}
                    <FormControl fullWidth size="small">
                        <InputLabel>Filter Column</InputLabel>
                        <Select
                            value={valueFilter.column || ''}
                            onChange={(e) => setValueFilterColumn(e.target.value || null)}
                            label="Filter Column"
                        >
                            <MenuItem value="">
                                <em>Use colour field</em>
                            </MenuItem>
                            {numericColumns.map(col => (
                                <MenuItem key={col.name} value={col.name}>
                                    {col.alias || col.name}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>

                    {/* Min/Max text fields */}
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                        <TextField
                            label="Min"
                            type="number"
                            size="small"
                            value={valueFilter.min ?? ''}
                            onChange={handleMinInput}
                            sx={{ flex: 1 }}
                            inputProps={{ step: 'any' }}
                        />
                        <TextField
                            label="Max"
                            type="number"
                            size="small"
                            value={valueFilter.max ?? ''}
                            onChange={handleMaxInput}
                            sx={{ flex: 1 }}
                            inputProps={{ step: 'any' }}
                        />
                        <Tooltip title="Reset to full data range">
                            <IconButton size="small" onClick={resetValueFilter}>
                                <RestartAlt fontSize="small" />
                            </IconButton>
                        </Tooltip>
                    </Box>

                    {/* Range Slider */}
                    {valueFilter.dataMin !== null && valueFilter.dataMax !== null && sliderRange > 0 && (
                        <Box sx={{ px: 1 }}>
                            <Slider
                                value={[
                                    valueFilter.min ?? sliderMin,
                                    valueFilter.max ?? sliderMax,
                                ]}
                                onChange={handleSliderChange}
                                min={sliderMin}
                                max={sliderMax}
                                step={step}
                                valueLabelDisplay="auto"
                                valueLabelFormat={(v) => v.toPrecision(4)}
                                size="small"
                                disableSwap
                            />
                        </Box>
                    )}

                    {/* No column warning */}
                    {!effectiveColumn && (
                        <Typography variant="caption" color="warning.main">
                            Select a colour field or filter column to use value filter
                        </Typography>
                    )}
                </Box>
            </Collapse>
        </Box>
    );
};
