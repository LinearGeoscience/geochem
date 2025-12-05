import React, { useEffect, useState } from 'react';
import { Box, FormControl, InputLabel, Select, MenuItem, TextField, Typography, Slider } from '@mui/material';

interface NumericLegendProps {
    columnName: string;
    data: any[];
    colorPalette: string;
    colorRange: [number, number] | null;
    onPaletteChange: (palette: string) => void;
    onRangeChange: (range: [number, number] | null) => void;
}

const PALETTES = ['Viridis', 'Plasma', 'Inferno', 'Magma', 'Jet', 'Rainbow', 'RdBu', 'Greys'];

export const NumericLegend: React.FC<NumericLegendProps> = ({
    columnName,
    data,
    colorPalette,
    colorRange,
    onPaletteChange,
    onRangeChange
}) => {
    const [localMin, setLocalMin] = useState<string>('');
    const [localMax, setLocalMax] = useState<string>('');

    // Calculate actual min/max from data
    const { min, max } = React.useMemo(() => {
        const values = data.map(d => d[columnName]).filter(v => typeof v === 'number' && !isNaN(v));
        return {
            min: values.length ? Math.min(...values) : 0,
            max: values.length ? Math.max(...values) : 100
        };
    }, [data, columnName]);

    // Sync local state with props or calculated values
    useEffect(() => {
        if (colorRange) {
            setLocalMin(colorRange[0].toString());
            setLocalMax(colorRange[1].toString());
        } else {
            setLocalMin(min.toString());
            setLocalMax(max.toString());
        }
    }, [colorRange, min, max]);

    const handleMinChange = (val: string) => {
        setLocalMin(val);
        const num = parseFloat(val);
        if (!isNaN(num)) {
            onRangeChange([num, parseFloat(localMax) || max]);
        }
    };

    const handleMaxChange = (val: string) => {
        setLocalMax(val);
        const num = parseFloat(val);
        if (!isNaN(num)) {
            onRangeChange([parseFloat(localMin) || min, num]);
        }
    };

    return (
        <Box sx={{ p: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <FormControl fullWidth size="small">
                <InputLabel>Color Palette</InputLabel>
                <Select
                    value={colorPalette}
                    label="Color Palette"
                    onChange={(e) => onPaletteChange(e.target.value)}
                >
                    {PALETTES.map(p => (
                        <MenuItem key={p} value={p}>{p}</MenuItem>
                    ))}
                </Select>
            </FormControl>

            <Box>
                <Typography variant="caption" color="text.secondary">Range (Min - Max)</Typography>
                <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                    <TextField
                        label="Min"
                        size="small"
                        value={localMin}
                        onChange={(e) => handleMinChange(e.target.value)}
                        type="number"
                    />
                    <TextField
                        label="Max"
                        size="small"
                        value={localMax}
                        onChange={(e) => handleMaxChange(e.target.value)}
                        type="number"
                    />
                </Box>
            </Box>

            <Box sx={{ px: 1 }}>
                <Slider
                    value={[parseFloat(localMin) || min, parseFloat(localMax) || max]}
                    min={min}
                    max={max}
                    onChange={(_, val) => {
                        if (Array.isArray(val)) {
                            setLocalMin(val[0].toString());
                            setLocalMax(val[1].toString());
                            onRangeChange(val as [number, number]);
                        }
                    }}
                    valueLabelDisplay="auto"
                />
            </Box>
        </Box>
    );
};
