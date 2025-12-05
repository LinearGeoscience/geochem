import React from 'react';
import { Box, Typography, Checkbox, Popover } from '@mui/material';
import { HexColorPicker } from 'react-colorful';

interface LegendListProps {
    values: string[];
    colorMap: Record<string, string>;
    shapeMap: Record<string, string>;
    visibilityMap: Record<string, boolean>;
    onColorChange: (value: string, color: string) => void;
    onShapeChange: (value: string, shape: string) => void;
    onVisibilityChange: (value: string) => void;
}

export const LegendList: React.FC<LegendListProps> = ({
    values,
    colorMap,
    shapeMap: _shapeMap,
    visibilityMap,
    onColorChange,
    onShapeChange: _onShapeChange,
    onVisibilityChange
}) => {
    const [colorAnchor, setColorAnchor] = React.useState<null | HTMLElement>(null);
    const [activeValue, setActiveValue] = React.useState<string | null>(null);

    const handleColorClick = (event: React.MouseEvent<HTMLElement>, value: string) => {
        setColorAnchor(event.currentTarget);
        setActiveValue(value);
    };

    const handleColorClose = () => {
        setColorAnchor(null);
        setActiveValue(null);
    };

    return (
        <Box sx={{ maxHeight: 300, overflowY: 'auto', mt: 1, border: '1px solid #eee', borderRadius: 1 }}>
            {values.map(val => (
                <Box key={val} sx={{ display: 'flex', alignItems: 'center', p: 0.5, '&:hover': { bgcolor: '#f5f5f5' } }}>
                    <Checkbox
                        size="small"
                        checked={visibilityMap[val] !== false}
                        onChange={() => onVisibilityChange(val)}
                    />

                    <Box
                        onClick={(e) => handleColorClick(e, val)}
                        sx={{
                            width: 16,
                            height: 16,
                            bgcolor: colorMap[val] || '#ccc',
                            borderRadius: '50%',
                            cursor: 'pointer',
                            mr: 1,
                            border: '1px solid #ddd'
                        }}
                    />

                    <Typography variant="body2" sx={{ flexGrow: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {val}
                    </Typography>
                </Box>
            ))}

            <Popover
                open={Boolean(colorAnchor)}
                anchorEl={colorAnchor}
                onClose={handleColorClose}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
            >
                {activeValue && (
                    <Box sx={{ p: 1 }}>
                        <HexColorPicker
                            color={colorMap[activeValue] || '#000000'}
                            onChange={(newColor) => onColorChange(activeValue, newColor)}
                        />
                    </Box>
                )}
            </Popover>
        </Box>
    );
};
