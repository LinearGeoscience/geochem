/**
 * LegendExport Component
 *
 * Renders a publication-quality legend based on attribute store settings.
 * Supports color, shape, size, and combinations.
 */

import React, { forwardRef } from 'react';
import { Box, Typography } from '@mui/material';
import { useAttributeStore, AttributeEntry } from '../../store/attributeStore';

export interface LegendExportConfig {
    showColor: boolean;
    showShape: boolean;
    showSize: boolean;
    title?: string;
    orientation: 'horizontal' | 'vertical';
    fontSize: number;
    symbolSize: number;
    showEntryNames: boolean;
    showRangeValues: boolean;
    combinedMode: boolean; // Show color+shape+size in single legend vs separate sections
}

interface LegendExportProps {
    config: LegendExportConfig;
}

// Shape marker SVG component for legend
const ShapeMarker: React.FC<{
    shape: string;
    color: string;
    size: number;
    strokeColor?: string;
}> = ({ shape, color, size, strokeColor = 'rgba(0,0,0,0.3)' }) => {
    const half = size / 2;

    const getPath = () => {
        switch (shape) {
            case 'circle':
                return <circle cx={half} cy={half} r={half * 0.8} fill={color} stroke={strokeColor} strokeWidth={0.5} />;
            case 'square':
                const sq = size * 0.8;
                const offset = (size - sq) / 2;
                return <rect x={offset} y={offset} width={sq} height={sq} fill={color} stroke={strokeColor} strokeWidth={0.5} />;
            case 'diamond':
                return <path d={`M ${half} ${size * 0.1} L ${size * 0.9} ${half} L ${half} ${size * 0.9} L ${size * 0.1} ${half} Z`} fill={color} stroke={strokeColor} strokeWidth={0.5} />;
            case 'triangle-up':
                return <path d={`M ${half} ${size * 0.1} L ${size * 0.9} ${size * 0.9} L ${size * 0.1} ${size * 0.9} Z`} fill={color} stroke={strokeColor} strokeWidth={0.5} />;
            case 'triangle-down':
                return <path d={`M ${half} ${size * 0.9} L ${size * 0.9} ${size * 0.1} L ${size * 0.1} ${size * 0.1} Z`} fill={color} stroke={strokeColor} strokeWidth={0.5} />;
            case 'cross':
                return <path d={`M ${half} ${size * 0.1} L ${half} ${size * 0.9} M ${size * 0.1} ${half} L ${size * 0.9} ${half}`} stroke={color} strokeWidth={size * 0.15} fill="none" />;
            case 'x':
                return <path d={`M ${size * 0.15} ${size * 0.15} L ${size * 0.85} ${size * 0.85} M ${size * 0.85} ${size * 0.15} L ${size * 0.15} ${size * 0.85}`} stroke={color} strokeWidth={size * 0.15} fill="none" />;
            case 'star':
                const cx = half, cy = half, r = half * 0.85, ri = half * 0.4;
                const points: string[] = [];
                for (let i = 0; i < 5; i++) {
                    const angle = (i * 72 - 90) * Math.PI / 180;
                    const angleInner = ((i * 72) + 36 - 90) * Math.PI / 180;
                    points.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
                    points.push(`${cx + ri * Math.cos(angleInner)},${cy + ri * Math.sin(angleInner)}`);
                }
                return <polygon points={points.join(' ')} fill={color} stroke={strokeColor} strokeWidth={0.5} />;
            case 'pentagon':
                const pentPoints: string[] = [];
                for (let i = 0; i < 5; i++) {
                    const angle = (i * 72 - 90) * Math.PI / 180;
                    pentPoints.push(`${half + half * 0.8 * Math.cos(angle)},${half + half * 0.8 * Math.sin(angle)}`);
                }
                return <polygon points={pentPoints.join(' ')} fill={color} stroke={strokeColor} strokeWidth={0.5} />;
            case 'hexagon':
                const hexPoints: string[] = [];
                for (let i = 0; i < 6; i++) {
                    const angle = (i * 60 - 90) * Math.PI / 180;
                    hexPoints.push(`${half + half * 0.8 * Math.cos(angle)},${half + half * 0.8 * Math.sin(angle)}`);
                }
                return <polygon points={hexPoints.join(' ')} fill={color} stroke={strokeColor} strokeWidth={0.5} />;
            default:
                return <circle cx={half} cy={half} r={half * 0.8} fill={color} stroke={strokeColor} strokeWidth={0.5} />;
        }
    };

    return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            {getPath()}
        </svg>
    );
};

// Format entry label
function formatEntryLabel(entry: AttributeEntry, showRange: boolean): string {
    if (entry.isDefault) {
        return 'Other';
    }
    if (entry.type === 'range' && showRange && entry.min !== undefined && entry.max !== undefined) {
        const formatVal = (v: number) => {
            if (v === 0) return '0';
            if (Math.abs(v) >= 1000) return v.toFixed(0);
            if (Math.abs(v) >= 1) return v.toFixed(1);
            if (Math.abs(v) >= 0.01) return v.toFixed(2);
            return v.toExponential(1);
        };
        return `${formatVal(entry.min)} - ${formatVal(entry.max)}`;
    }
    if (entry.type === 'category' && entry.categoryValue !== undefined) {
        return entry.categoryValue;
    }
    return entry.name || 'Unknown';
}

// Single legend item
interface LegendItemProps {
    entry: AttributeEntry;
    config: LegendExportConfig;
    colorOverride?: string;
    shapeOverride?: string;
    sizeOverride?: number;
}

const LegendItem: React.FC<LegendItemProps> = ({
    entry,
    config,
    colorOverride,
    shapeOverride,
    sizeOverride
}) => {
    const color = colorOverride || entry.color || '#808080';
    const shape = shapeOverride || entry.shape || 'circle';
    const size = sizeOverride || entry.size || 8;

    // Scale symbol size for display
    const displaySize = config.symbolSize * (config.showSize ? (size / 8) : 1);

    return (
        <Box
            sx={{
                display: 'flex',
                alignItems: 'center',
                gap: `${config.fontSize * 0.5}px`,
            }}
        >
            <Box sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: config.symbolSize,
                height: config.symbolSize,
            }}>
                <ShapeMarker
                    shape={config.showShape ? shape : 'circle'}
                    color={config.showColor ? color : '#333'}
                    size={Math.max(8, displaySize)}
                />
            </Box>
            <Typography
                sx={{
                    fontSize: config.fontSize,
                    fontFamily: 'Arial, sans-serif',
                    whiteSpace: 'nowrap',
                }}
            >
                {formatEntryLabel(entry, config.showRangeValues)}
                {config.showSize && !config.combinedMode && ` (${size}pt)`}
            </Typography>
        </Box>
    );
};

export const LegendExport = forwardRef<HTMLDivElement, LegendExportProps>(({
    config
}, ref) => {
    const { color, shape, size, customEntries } = useAttributeStore();

    // Get visible entries from each tab
    const colorEntries = color.entries.filter(e => e.visible);
    const shapeEntries = shape.entries.filter(e => e.visible);
    const sizeEntries = size.entries.filter(e => e.visible);
    const visibleCustom = customEntries.filter(e => e.visible);

    // Combined mode: merge entries and show all attributes together
    if (config.combinedMode) {
        // Use color entries as primary, merge in shape/size from matching entries or custom
        const allEntries: Array<{
            entry: AttributeEntry;
            color: string;
            shape: string;
            size: number;
        }> = [];

        // Start with custom entries (they have all attributes)
        for (const ce of visibleCustom) {
            allEntries.push({
                entry: ce,
                color: ce.color || '#808080',
                shape: ce.shape || 'circle',
                size: ce.size || 8,
            });
        }

        // Add color entries (excluding those already in custom)
        const customNames = new Set(visibleCustom.map(e => e.name));
        for (const ce of colorEntries) {
            if (!customNames.has(ce.name)) {
                // Find matching shape and size entries
                const se = shapeEntries.find(s => s.name === ce.name);
                const sz = sizeEntries.find(s => s.name === ce.name);
                allEntries.push({
                    entry: ce,
                    color: ce.color || '#808080',
                    shape: se?.shape || 'circle',
                    size: sz?.size || 8,
                });
            }
        }

        const isHorizontal = config.orientation === 'horizontal';

        return (
            <Box
                ref={ref}
                sx={{
                    display: 'inline-block',
                    bgcolor: 'white',
                    p: 2,
                    fontFamily: 'Arial, sans-serif',
                }}
            >
                {config.title && (
                    <Typography
                        sx={{
                            fontSize: config.fontSize * 1.2,
                            fontWeight: 'bold',
                            fontFamily: 'Arial, sans-serif',
                            mb: 1,
                            textAlign: isHorizontal ? 'center' : 'left',
                        }}
                    >
                        {config.title}
                    </Typography>
                )}
                <Box
                    sx={{
                        display: 'flex',
                        flexDirection: isHorizontal ? 'row' : 'column',
                        flexWrap: isHorizontal ? 'wrap' : 'nowrap',
                        gap: `${config.fontSize * 0.75}px`,
                    }}
                >
                    {allEntries.map((item, idx) => (
                        <LegendItem
                            key={item.entry.id || idx}
                            entry={item.entry}
                            config={config}
                            colorOverride={item.color}
                            shapeOverride={item.shape}
                            sizeOverride={item.size}
                        />
                    ))}
                </Box>
            </Box>
        );
    }

    // Separate sections mode
    const sections: Array<{
        title: string;
        entries: AttributeEntry[];
        type: 'color' | 'shape' | 'size';
    }> = [];

    if (config.showColor && colorEntries.length > 0) {
        sections.push({
            title: color.field ? `Color: ${color.field}` : 'Color',
            entries: colorEntries,
            type: 'color',
        });
    }

    if (config.showShape && shapeEntries.length > 0) {
        sections.push({
            title: shape.field ? `Shape: ${shape.field}` : 'Shape',
            entries: shapeEntries,
            type: 'shape',
        });
    }

    if (config.showSize && sizeEntries.length > 0) {
        sections.push({
            title: size.field ? `Size: ${size.field}` : 'Size',
            entries: sizeEntries,
            type: 'size',
        });
    }

    // Add custom entries section if present
    if (visibleCustom.length > 0) {
        sections.push({
            title: 'Custom',
            entries: visibleCustom,
            type: 'color', // Custom entries show all attributes
        });
    }

    const isHorizontal = config.orientation === 'horizontal';

    return (
        <Box
            ref={ref}
            sx={{
                display: 'inline-block',
                bgcolor: 'white',
                p: 2,
                fontFamily: 'Arial, sans-serif',
            }}
        >
            {config.title && (
                <Typography
                    sx={{
                        fontSize: config.fontSize * 1.2,
                        fontWeight: 'bold',
                        fontFamily: 'Arial, sans-serif',
                        mb: 1.5,
                    }}
                >
                    {config.title}
                </Typography>
            )}
            <Box
                sx={{
                    display: 'flex',
                    flexDirection: isHorizontal ? 'row' : 'column',
                    gap: isHorizontal ? 4 : 2,
                }}
            >
                {sections.map((section, sIdx) => (
                    <Box key={sIdx}>
                        <Typography
                            sx={{
                                fontSize: config.fontSize,
                                fontWeight: 'bold',
                                fontFamily: 'Arial, sans-serif',
                                mb: 0.5,
                                borderBottom: '1px solid #ccc',
                                pb: 0.25,
                            }}
                        >
                            {section.title}
                        </Typography>
                        <Box
                            sx={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: `${config.fontSize * 0.5}px`,
                            }}
                        >
                            {section.entries.map((entry, eIdx) => (
                                <LegendItem
                                    key={entry.id || eIdx}
                                    entry={entry}
                                    config={{
                                        ...config,
                                        showColor: section.type === 'color' || section.entries === visibleCustom,
                                        showShape: section.type === 'shape' || section.entries === visibleCustom,
                                        showSize: section.type === 'size' || section.entries === visibleCustom,
                                    }}
                                />
                            ))}
                        </Box>
                    </Box>
                ))}
            </Box>
        </Box>
    );
});

LegendExport.displayName = 'LegendExport';

export default LegendExport;
