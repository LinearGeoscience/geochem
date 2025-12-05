import React from 'react';
import { Paper, Typography, Box, Stack, Divider, Checkbox } from '@mui/material';
import { Circle } from '@mui/icons-material';
import { useStyleStore } from '../../store/styleStore';

// Render a marker shape as SVG to show accurate representation
const ShapeMarker: React.FC<{ shape: string; color?: string; size?: number }> = ({ shape, color = '#000', size = 16 }) => {
    // SVG path data for each shape
    const getPath = () => {
        switch (shape) {
            case 'circle':
                return <circle cx="8" cy="8" r="6" fill={color} />;
            case 'square':
                return <rect x="2" y="2" width="12" height="12" fill={color} />;
            case 'diamond':
                return <path d="M 8 2 L 14 8 L 8 14 L 2 8 Z" fill={color} />;
            case 'cross':
                return <path d="M 8 2 L 8 14 M 2 8 L 14 8" stroke={color} strokeWidth="2" fill="none" />;
            case 'x':
                return <path d="M 2 2 L 14 14 M 14 2 L 2 14" stroke={color} strokeWidth="2" fill="none" />;
            case 'triangle-up':
                return <path d="M 8 2 L 14 14 L 2 14 Z" fill={color} />;
            case 'triangle-down':
                return <path d="M 8 14 L 14 2 L 2 2 Z" fill={color} />;
            case 'pentagon':
                return <path d="M 8 2 L 13.5 6 L 11 12 L 5 12 L 2.5 6 Z" fill={color} />;
            case 'hexagon':
                return <path d="M 8 1 L 13 4.5 L 13 11.5 L 8 15 L 3 11.5 L 3 4.5 Z" fill={color} />;
            case 'star':
                return <path d="M 8 1 L 9.5 6 L 15 6.5 L 11 10 L 12 15 L 8 12 L 4 15 L 5 10 L 1 6.5 L 6.5 6 Z" fill={color} />;
            case 'hourglass':
                return <path d="M 2 2 L 14 2 L 8 8 L 14 14 L 2 14 L 8 8 Z" fill={color} />;
            default:
                return <circle cx="8" cy="8" r="6" fill={color} />;
        }
    };

    return (
        <svg width={size} height={size} viewBox="0 0 16 16" style={{ flexShrink: 0 }}>
            {getPath()}
        </svg>
    );
};

export const StyleLegend: React.FC = () => {
    const { styleRules, toggleRangeVisibility, toggleCategoryVisibility } = useStyleStore();

    if (styleRules.length === 0) return null;

    const colorRules = styleRules.filter(r => r.attribute === 'color');
    const shapeRules = styleRules.filter(r => r.attribute === 'shape');
    const sizeRules = styleRules.filter(r => r.attribute === 'size');

    return (
        <Paper sx={{ p: 2, mt: 2, maxWidth: 300 }}>
            <Typography variant="h6" gutterBottom>
                Legend
            </Typography>

            <Stack spacing={2} divider={<Divider />}>
                {/* Color Legend */}
                {colorRules.map(rule => (
                    <Box key={`color-${rule.field}`}>
                        <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                            Colour: {rule.field}
                        </Typography>
                        <Stack spacing={0.5}>
                            {rule.type === 'numeric' && rule.ranges ? (
                                rule.ranges.map((range, i) => (
                                    <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                        <Checkbox
                                            size="small"
                                            checked={range.visible !== false}
                                            onChange={() => toggleRangeVisibility(rule.field, rule.attribute, i)}
                                            sx={{ p: 0 }}
                                        />
                                        <Box
                                            sx={{
                                                width: 16,
                                                height: 16,
                                                backgroundColor: range.color || '#000',
                                                borderRadius: '50%',
                                                flexShrink: 0,
                                                opacity: range.visible === false ? 0.3 : 1
                                            }}
                                        />
                                        <Typography
                                            variant="body2"
                                            sx={{ opacity: range.visible === false ? 0.5 : 1 }}
                                        >
                                            {range.label}
                                        </Typography>
                                    </Box>
                                ))
                            ) : rule.categories ? (
                                rule.categories.map((cat, i) => (
                                    <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                        <Checkbox
                                            size="small"
                                            checked={cat.visible !== false}
                                            onChange={() => toggleCategoryVisibility(rule.field, rule.attribute, i)}
                                            sx={{ p: 0 }}
                                        />
                                        <Box
                                            sx={{
                                                width: 16,
                                                height: 16,
                                                backgroundColor: cat.color || '#000',
                                                borderRadius: '50%',
                                                flexShrink: 0,
                                                opacity: cat.visible === false ? 0.3 : 1
                                            }}
                                        />
                                        <Typography
                                            variant="body2"
                                            sx={{ opacity: cat.visible === false ? 0.5 : 1 }}
                                        >
                                            {cat.label}
                                        </Typography>
                                    </Box>
                                ))
                            ) : null}
                        </Stack>
                    </Box>
                ))}{/* Shape Legend */}
                {shapeRules.map(rule => (
                    <Box key={`shape-${rule.field}`}>
                        <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                            Shape: {rule.field}
                        </Typography>
                        <Stack spacing={0.5}>
                            {rule.type === 'numeric' && rule.ranges ? (
                                rule.ranges.map((range, i) => (
                                    <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                        <Checkbox
                                            size="small"
                                            checked={range.visible !== false}
                                            onChange={() => toggleRangeVisibility(rule.field, rule.attribute, i)}
                                            sx={{ p: 0 }}
                                        />
                                        <ShapeMarker shape={range.shape || 'circle'} color="#000" />
                                        <Typography
                                            variant="body2"
                                            sx={{ opacity: range.visible === false ? 0.5 : 1 }}
                                        >
                                            {range.label}
                                        </Typography>
                                    </Box>
                                ))
                            ) : rule.categories ? (
                                rule.categories.map((cat, i) => (
                                    <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                        <Checkbox
                                            size="small"
                                            checked={cat.visible !== false}
                                            onChange={() => toggleCategoryVisibility(rule.field, rule.attribute, i)}
                                            sx={{ p: 0 }}
                                        />
                                        <ShapeMarker shape={cat.shape || 'circle'} color="#000" />
                                        <Typography
                                            variant="body2"
                                            sx={{ opacity: cat.visible === false ? 0.5 : 1 }}
                                        >
                                            {cat.label}
                                        </Typography>
                                    </Box>
                                ))
                            ) : null}
                        </Stack>
                    </Box>
                ))}

                {/* Size Legend */}
                {sizeRules.map(rule => (
                    <Box key={`size-${rule.field}`}>
                        <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                            Size: {rule.field}
                        </Typography>
                        <Stack spacing={0.5}>
                            {rule.type === 'numeric' && rule.ranges ? (
                                rule.ranges.map((range, i) => (
                                    <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                        <Checkbox
                                            size="small"
                                            checked={range.visible !== false}
                                            onChange={() => toggleRangeVisibility(rule.field, rule.attribute, i)}
                                            sx={{ p: 0 }}
                                        />
                                        <Circle sx={{ fontSize: (range.size || 6) * 2, opacity: range.visible === false ? 0.3 : 1 }} />
                                        <Typography
                                            variant="body2"
                                            sx={{ opacity: range.visible === false ? 0.5 : 1 }}
                                        >
                                            {range.label}
                                        </Typography>
                                    </Box>
                                ))
                            ) : rule.categories ? (
                                rule.categories.map((cat, i) => (
                                    <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                        <Checkbox
                                            size="small"
                                            checked={cat.visible !== false}
                                            onChange={() => toggleCategoryVisibility(rule.field, rule.attribute, i)}
                                            sx={{ p: 0 }}
                                        />
                                        <Circle sx={{ fontSize: (cat.size || 8) * 2, opacity: cat.visible === false ? 0.3 : 1 }} />
                                        <Typography
                                            variant="body2"
                                            sx={{ opacity: cat.visible === false ? 0.5 : 1 }}
                                        >
                                            {cat.label}
                                        </Typography>
                                    </Box>
                                ))
                            ) : null}
                        </Stack>
                    </Box>
                ))}
            </Stack>
        </Paper>
    );
};
