import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Box,
    Typography,
    TextField,
    Slider,
    IconButton,
    Tooltip,
    ToggleButton,
    ToggleButtonGroup,
    Chip,
} from '@mui/material';
import {
    Refresh,
    ChevronLeft,
    ChevronRight,
    NearMe,
    Close,
} from '@mui/icons-material';
import { AxisRangeSlider } from './AxisRangeSlider';

// --- Exported types ---

export type AxisMode = 'range' | 'slice';

export interface AxisModes {
    x: AxisMode;
    y: AxisMode;
    z: AxisMode;
}

export interface SliceConfig {
    x: number;
    y: number;
    z: number;
}

export interface PickState {
    axis: 'x' | 'y' | 'z' | null;
    clickCount: number;
    firstValue: number | null;
}

// --- Component props ---

interface AxisRangeControlProps {
    label: string;
    axis: 'x' | 'y' | 'z';
    value: [number, number];
    dataRange: [number, number];
    onChange: (value: [number, number]) => void;
    onReset: () => void;
    color?: 'primary' | 'secondary' | 'error';
    mode: AxisMode;
    onModeChange: (mode: AxisMode) => void;
    sliceWidth: number;
    onSliceWidthChange: (width: number) => void;
    slicePosition: number;
    onSlicePositionChange: (position: number) => void;
    pickState: PickState;
    onPickStart: () => void;
    onPickCancel: () => void;
}

// Format value for display
const formatValue = (v: number): string => {
    if (Math.abs(v) >= 1000) return v.toFixed(1);
    if (Math.abs(v) >= 1) return v.toFixed(2);
    return v.toFixed(4);
};

export const AxisRangeControl: React.FC<AxisRangeControlProps> = ({
    label,
    axis,
    value,
    dataRange,
    onChange,
    onReset,
    color = 'primary',
    mode,
    onModeChange,
    sliceWidth,
    onSliceWidthChange,
    slicePosition,
    onSlicePositionChange,
    pickState,
    onPickStart,
    onPickCancel,
}) => {
    const totalRange = dataRange[1] - dataRange[0];
    const step = totalRange / 1000;
    const isPickActive = pickState.axis === axis;

    // Clamp slice width to data range
    const effectiveWidth = Math.min(sliceWidth, totalRange);

    // Local drag state: slider moves freely during drag, commits on release
    const [draggingPos, setDraggingPos] = useState<number | null>(null);

    // Throttled live updates during drag
    const throttleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const latestDragPos = useRef<number>(slicePosition);

    // Cleanup throttle on unmount
    useEffect(() => () => {
        if (throttleRef.current) clearTimeout(throttleRef.current);
    }, []);

    // When slice position changes, update the range value
    const handleSlicePositionChange = useCallback((newPos: number) => {
        const clampedPos = Math.max(dataRange[0], Math.min(newPos, dataRange[1] - effectiveWidth));
        onSlicePositionChange(clampedPos);
        onChange([clampedPos, clampedPos + effectiveWidth]);
    }, [dataRange, effectiveWidth, onSlicePositionChange, onChange]);

    // Step forward/backward by slice width
    const handleStepBack = useCallback(() => {
        handleSlicePositionChange(slicePosition - effectiveWidth);
    }, [slicePosition, effectiveWidth, handleSlicePositionChange]);

    const handleStepForward = useCallback(() => {
        handleSlicePositionChange(slicePosition + effectiveWidth);
    }, [slicePosition, effectiveWidth, handleSlicePositionChange]);

    // Handle slice width change from text field
    const handleWidthChange = useCallback((newWidth: number) => {
        if (isNaN(newWidth) || newWidth <= 0) return;
        const clamped = Math.min(newWidth, totalRange);
        onSliceWidthChange(clamped);
        // Re-clamp position with new width
        const clampedPos = Math.max(dataRange[0], Math.min(slicePosition, dataRange[1] - clamped));
        onSlicePositionChange(clampedPos);
        onChange([clampedPos, clampedPos + clamped]);
    }, [totalRange, dataRange, slicePosition, onSliceWidthChange, onSlicePositionChange, onChange]);

    // Handle mode switch
    const handleModeChange = useCallback((_: React.MouseEvent, newMode: string | null) => {
        if (!newMode) return;
        const m = newMode as AxisMode;
        onModeChange(m);
        if (m === 'slice') {
            // Default: use current visible extent or range/10
            const currentExtent = value[1] - value[0];
            const defaultWidth = (currentExtent > 0 && currentExtent < totalRange) ? currentExtent : totalRange / 10;
            const w = Math.min(defaultWidth, totalRange);
            onSliceWidthChange(w);
            const pos = Math.max(dataRange[0], Math.min(value[0], dataRange[1] - w));
            onSlicePositionChange(pos);
            onChange([pos, pos + w]);
        }
    }, [value, totalRange, dataRange, onModeChange, onSliceWidthChange, onSlicePositionChange, onChange]);

    const isModified = value[0] !== dataRange[0] || value[1] !== dataRange[1];

    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'nowrap' }}>
            {/* Axis label */}
            <Typography
                variant="body2"
                sx={{ minWidth: 16, fontWeight: 'bold', color: `${color}.main` }}
            >
                {label}:
            </Typography>

            {/* Mode toggle */}
            <ToggleButtonGroup
                value={mode}
                exclusive
                onChange={handleModeChange}
                size="small"
                sx={{
                    '& .MuiToggleButton-root': {
                        py: 0.25,
                        px: 0.75,
                        fontSize: '0.65rem',
                        lineHeight: 1.2,
                        textTransform: 'none',
                    },
                }}
            >
                <ToggleButton value="range">Range</ToggleButton>
                <ToggleButton value="slice">Slice</ToggleButton>
            </ToggleButtonGroup>

            {/* Mode-specific controls */}
            {mode === 'range' ? (
                // Range mode: delegate to AxisRangeSlider
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <AxisRangeSlider
                        label={label}
                        value={value}
                        dataRange={dataRange}
                        onChange={onChange}
                        color={color}
                        hideLabel
                        hideReset
                    />
                </Box>
            ) : (
                // Slice mode: step buttons + width input + single-handle slider
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flex: 1, minWidth: 0 }}>
                    {/* Step back */}
                    <Tooltip title="Step back by slice width">
                        <span>
                            <IconButton
                                size="small"
                                onClick={handleStepBack}
                                disabled={slicePosition <= dataRange[0]}
                                sx={{ p: 0.25 }}
                            >
                                <ChevronLeft fontSize="small" />
                            </IconButton>
                        </span>
                    </Tooltip>

                    {/* Width input */}
                    <Tooltip title="Slice width">
                        <TextField
                            type="number"
                            value={formatValue(effectiveWidth)}
                            onChange={(e) => handleWidthChange(parseFloat(e.target.value))}
                            size="small"
                            label="Width"
                            sx={{
                                width: 80,
                                '& input': { py: 0.5, px: 0.75, fontSize: '0.75rem', textAlign: 'right' },
                                '& .MuiInputLabel-root': { fontSize: '0.7rem' },
                            }}
                            inputProps={{ step: 'any', min: step }}
                        />
                    </Tooltip>

                    {/* Step forward */}
                    <Tooltip title="Step forward by slice width">
                        <span>
                            <IconButton
                                size="small"
                                onClick={handleStepForward}
                                disabled={slicePosition + effectiveWidth >= dataRange[1]}
                                sx={{ p: 0.25 }}
                            >
                                <ChevronRight fontSize="small" />
                            </IconButton>
                        </span>
                    </Tooltip>

                    {/* Single-handle position slider */}
                    <Slider
                        value={draggingPos ?? slicePosition}
                        onChange={(_, v) => {
                            const pos = v as number;
                            setDraggingPos(pos);
                            latestDragPos.current = pos;
                            // Throttle: commit at most every 200ms during drag
                            if (!throttleRef.current) {
                                throttleRef.current = setTimeout(() => {
                                    throttleRef.current = null;
                                    handleSlicePositionChange(latestDragPos.current);
                                }, 200);
                            }
                        }}
                        onChangeCommitted={(_, v) => {
                            if (throttleRef.current) {
                                clearTimeout(throttleRef.current);
                                throttleRef.current = null;
                            }
                            setDraggingPos(null);
                            handleSlicePositionChange(v as number);
                        }}
                        min={dataRange[0]}
                        max={dataRange[1] - effectiveWidth}
                        step={step}
                        valueLabelDisplay="auto"
                        valueLabelFormat={(v) => `${formatValue(v)} – ${formatValue(v + effectiveWidth)}`}
                        color={color}
                        sx={{
                            flex: 1,
                            mx: 1,
                            '& .MuiSlider-thumb': { width: 16, height: 16 },
                            '& .MuiSlider-valueLabel': { fontSize: '0.65rem' },
                        }}
                    />
                </Box>
            )}

            {/* Pick Range button */}
            {isPickActive ? (
                <Tooltip title="Cancel pick">
                    <Chip
                        label={pickState.clickCount === 0 ? 'Pick 1st' : 'Pick 2nd'}
                        size="small"
                        color="warning"
                        onDelete={onPickCancel}
                        deleteIcon={<Close fontSize="small" />}
                        sx={{ fontSize: '0.7rem', height: 24 }}
                    />
                </Tooltip>
            ) : (
                <Tooltip title="Pick range from two data points">
                    <IconButton
                        size="small"
                        onClick={onPickStart}
                        sx={{ p: 0.25 }}
                    >
                        <NearMe fontSize="small" />
                    </IconButton>
                </Tooltip>
            )}

            {/* Reset button */}
            <Tooltip title="Reset to full range">
                <span>
                    <IconButton
                        size="small"
                        onClick={() => {
                            onReset();
                            if (mode === 'slice') {
                                onSlicePositionChange(dataRange[0]);
                                onSliceWidthChange(totalRange / 10);
                            }
                        }}
                        disabled={!isModified}
                        sx={{ opacity: isModified ? 1 : 0.3, p: 0.25 }}
                    >
                        <Refresh fontSize="small" />
                    </IconButton>
                </span>
            </Tooltip>
        </Box>
    );
};

export default AxisRangeControl;
