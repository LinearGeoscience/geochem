import React, { useState, useEffect } from 'react';
import {
    Box,
    Typography,
    TextField,
    Slider,
    IconButton,
    Tooltip,
} from '@mui/material';
import { Refresh } from '@mui/icons-material';

interface AxisRangeSliderProps {
    label: string;
    value: [number, number];
    dataRange: [number, number];
    onChange: (value: [number, number]) => void;
    onReset?: () => void;
    color?: 'primary' | 'secondary' | 'error';
}

export const AxisRangeSlider: React.FC<AxisRangeSliderProps> = ({
    label,
    value,
    dataRange,
    onChange,
    onReset,
    color = 'primary',
}) => {
    const [localMin, setLocalMin] = useState(value[0].toString());
    const [localMax, setLocalMax] = useState(value[1].toString());

    // Update local state when value prop changes
    useEffect(() => {
        setLocalMin(formatValue(value[0]));
        setLocalMax(formatValue(value[1]));
    }, [value]);

    // Format value for display (avoid excessive decimals)
    const formatValue = (v: number): string => {
        if (Math.abs(v) >= 1000) {
            return v.toFixed(1);
        } else if (Math.abs(v) >= 1) {
            return v.toFixed(2);
        } else {
            return v.toFixed(4);
        }
    };

    const handleMinBlur = () => {
        const newMin = parseFloat(localMin);
        if (!isNaN(newMin)) {
            // Clamp to valid range
            const clampedMin = Math.max(dataRange[0], Math.min(newMin, value[1]));
            onChange([clampedMin, value[1]]);
            setLocalMin(formatValue(clampedMin));
        } else {
            setLocalMin(formatValue(value[0]));
        }
    };

    const handleMaxBlur = () => {
        const newMax = parseFloat(localMax);
        if (!isNaN(newMax)) {
            // Clamp to valid range
            const clampedMax = Math.min(dataRange[1], Math.max(newMax, value[0]));
            onChange([value[0], clampedMax]);
            setLocalMax(formatValue(clampedMax));
        } else {
            setLocalMax(formatValue(value[1]));
        }
    };

    const handleMinKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleMinBlur();
            (e.target as HTMLInputElement).blur();
        }
    };

    const handleMaxKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleMaxBlur();
            (e.target as HTMLInputElement).blur();
        }
    };

    const handleSliderChange = (_: Event, newValue: number | number[]) => {
        if (Array.isArray(newValue)) {
            onChange(newValue as [number, number]);
        }
    };

    // Calculate step based on data range
    const range = dataRange[1] - dataRange[0];
    const step = range / 1000;

    // Check if current range is different from data range
    const isModified = value[0] !== dataRange[0] || value[1] !== dataRange[1];

    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            {/* Label */}
            <Typography
                variant="body2"
                sx={{
                    minWidth: 20,
                    fontWeight: 'bold',
                    color: `${color}.main`,
                }}
            >
                {label}:
            </Typography>

            {/* Min input */}
            <TextField
                type="number"
                value={localMin}
                onChange={(e) => setLocalMin(e.target.value)}
                onBlur={handleMinBlur}
                onKeyDown={handleMinKeyDown}
                size="small"
                sx={{
                    width: 100,
                    '& input': {
                        py: 0.5,
                        px: 1,
                        fontSize: '0.8rem',
                        textAlign: 'right',
                    },
                }}
                inputProps={{ step: 'any' }}
            />

            {/* Range slider */}
            <Slider
                value={value}
                onChange={handleSliderChange}
                min={dataRange[0]}
                max={dataRange[1]}
                step={step}
                valueLabelDisplay="auto"
                valueLabelFormat={(v) => formatValue(v)}
                color={color}
                sx={{
                    flex: 1,
                    mx: 1,
                    '& .MuiSlider-thumb': {
                        width: 16,
                        height: 16,
                    },
                    '& .MuiSlider-valueLabel': {
                        fontSize: '0.7rem',
                    },
                }}
            />

            {/* Max input */}
            <TextField
                type="number"
                value={localMax}
                onChange={(e) => setLocalMax(e.target.value)}
                onBlur={handleMaxBlur}
                onKeyDown={handleMaxKeyDown}
                size="small"
                sx={{
                    width: 100,
                    '& input': {
                        py: 0.5,
                        px: 1,
                        fontSize: '0.8rem',
                    },
                }}
                inputProps={{ step: 'any' }}
            />

            {/* Reset button */}
            {onReset && (
                <Tooltip title="Reset to full range">
                    <span>
                        <IconButton
                            size="small"
                            onClick={onReset}
                            disabled={!isModified}
                            sx={{ opacity: isModified ? 1 : 0.3 }}
                        >
                            <Refresh fontSize="small" />
                        </IconButton>
                    </span>
                </Tooltip>
            )}
        </Box>
    );
};

export default AxisRangeSlider;
