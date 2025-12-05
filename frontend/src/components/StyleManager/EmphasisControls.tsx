import React, { useMemo } from 'react';
import {
    Box,
    Typography,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Slider,
    Switch,
    ToggleButton,
    ToggleButtonGroup,
    Tooltip,
    Collapse,
    FormControlLabel,
    Checkbox,
} from '@mui/material';
import { Highlight, Category, TrendingUp } from '@mui/icons-material';
import { useAttributeStore, EmphasisMode } from '../../store/attributeStore';
import { useAppStore } from '../../store/appStore';

export const EmphasisControls: React.FC = () => {
    const { columns } = useAppStore();
    const {
        emphasis,
        color,
        setEmphasisEnabled,
        setEmphasisColumn,
        setEmphasisMode,
        setEmphasisThreshold,
        setEmphasisMinOpacity,
        setEmphasisBoostSize,
        setEmphasisSizeBoostFactor,
    } = useAttributeStore();

    const numericColumns = useMemo(() =>
        columns.filter(c => c.type === 'numeric' || c.type === 'float' || c.type === 'integer'),
        [columns]
    );

    // Check if category mode is available (requires color entries)
    const hasCategoryEntries = useMemo(() => {
        const nonDefaultEntries = color.entries.filter(e => !e.isDefault);
        return nonDefaultEntries.length > 0;
    }, [color.entries]);

    const handleModeChange = (_: React.MouseEvent<HTMLElement>, newMode: EmphasisMode | null) => {
        if (newMode) {
            setEmphasisMode(newMode);
        }
    };

    // Get description for current mode
    const getModeDescription = () => {
        switch (emphasis.mode) {
            case 'category':
                return 'Uses existing color categories - later categories are emphasized more';
            case 'percentile':
                return 'Ranks values by percentile - top values are emphasized';
            case 'linear':
                return 'Linear scaling from min to max value';
        }
    };

    return (
        <Box sx={{ mt: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Highlight fontSize="small" color={emphasis.enabled ? 'primary' : 'disabled'} />
                    <Typography variant="subtitle2">
                        High Grade Emphasis
                    </Typography>
                </Box>
                <Switch
                    size="small"
                    checked={emphasis.enabled}
                    onChange={(e) => setEmphasisEnabled(e.target.checked)}
                />
            </Box>

            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                Highlight high-grade values by fading low values and rendering high values on top
            </Typography>

            <Collapse in={emphasis.enabled}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
                    {/* Mode Selection */}
                    <Box>
                        <Typography variant="caption" color="text.secondary" gutterBottom>
                            Ranking Mode
                        </Typography>
                        <ToggleButtonGroup
                            value={emphasis.mode}
                            exclusive
                            onChange={handleModeChange}
                            size="small"
                            fullWidth
                        >
                            <ToggleButton value="category" disabled={!hasCategoryEntries}>
                                <Tooltip title="Use existing colour categories">
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                        <Category fontSize="small" />
                                        <span>Category</span>
                                    </Box>
                                </Tooltip>
                            </ToggleButton>
                            <ToggleButton value="percentile">
                                <Tooltip title="Rank by percentile">
                                    <span>Percentile</span>
                                </Tooltip>
                            </ToggleButton>
                            <ToggleButton value="linear">
                                <Tooltip title="Linear min-max scaling">
                                    <span>Linear</span>
                                </Tooltip>
                            </ToggleButton>
                        </ToggleButtonGroup>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                            {getModeDescription()}
                        </Typography>
                    </Box>

                    {/* Field Selection (only for non-category modes) */}
                    {emphasis.mode !== 'category' && (
                        <FormControl fullWidth size="small">
                            <InputLabel>Emphasis Column</InputLabel>
                            <Select
                                value={emphasis.column || ''}
                                onChange={(e) => setEmphasisColumn(e.target.value || null)}
                                label="Emphasis Column"
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
                    )}

                    {/* Category info when in category mode */}
                    {emphasis.mode === 'category' && (
                        <Box sx={{
                            p: 1,
                            bgcolor: 'action.hover',
                            borderRadius: 1,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1
                        }}>
                            <TrendingUp fontSize="small" color="primary" />
                            <Typography variant="caption">
                                Using {color.entries.filter(e => !e.isDefault).length} colour categories.
                                Higher categories = more emphasis.
                            </Typography>
                        </Box>
                    )}

                    {/* Threshold Slider */}
                    <Box>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Typography variant="caption" color="text.secondary">
                                Emphasis Threshold
                            </Typography>
                            <Typography variant="caption" fontWeight="bold">
                                {emphasis.threshold}%
                            </Typography>
                        </Box>
                        <Slider
                            value={emphasis.threshold}
                            onChange={(_, value) => setEmphasisThreshold(value as number)}
                            min={50}
                            max={99}
                            step={1}
                            valueLabelDisplay="auto"
                            valueLabelFormat={(v) => `${v}%`}
                            size="small"
                        />
                        <Typography variant="caption" color="text.secondary">
                            Values above this rank are fully emphasized
                        </Typography>
                    </Box>

                    {/* Min Opacity Slider */}
                    <Box>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Typography variant="caption" color="text.secondary">
                                Minimum Opacity
                            </Typography>
                            <Typography variant="caption" fontWeight="bold">
                                {Math.round(emphasis.minOpacity * 100)}%
                            </Typography>
                        </Box>
                        <Slider
                            value={emphasis.minOpacity}
                            onChange={(_, value) => setEmphasisMinOpacity(value as number)}
                            min={0.05}
                            max={0.5}
                            step={0.05}
                            valueLabelDisplay="auto"
                            valueLabelFormat={(v) => `${Math.round(v * 100)}%`}
                            size="small"
                        />
                        <Typography variant="caption" color="text.secondary">
                            Opacity for lowest-ranked values
                        </Typography>
                    </Box>

                    {/* Size Boost */}
                    <Box>
                        <FormControlLabel
                            control={
                                <Checkbox
                                    checked={emphasis.boostSize}
                                    onChange={(e) => setEmphasisBoostSize(e.target.checked)}
                                    size="small"
                                />
                            }
                            label={
                                <Typography variant="body2">
                                    Boost size of high-grade points
                                </Typography>
                            }
                        />
                        {emphasis.boostSize && (
                            <Box sx={{ pl: 4 }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <Typography variant="caption" color="text.secondary">
                                        Size Boost Factor
                                    </Typography>
                                    <Typography variant="caption" fontWeight="bold">
                                        {emphasis.sizeBoostFactor.toFixed(1)}x
                                    </Typography>
                                </Box>
                                <Slider
                                    value={emphasis.sizeBoostFactor}
                                    onChange={(_, value) => setEmphasisSizeBoostFactor(value as number)}
                                    min={1.0}
                                    max={3.0}
                                    step={0.1}
                                    valueLabelDisplay="auto"
                                    valueLabelFormat={(v) => `${v.toFixed(1)}x`}
                                    size="small"
                                />
                            </Box>
                        )}
                    </Box>
                </Box>
            </Collapse>
        </Box>
    );
};
