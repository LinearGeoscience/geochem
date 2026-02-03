/**
 * MineralisationLegend Component
 *
 * Renders a horizontal legend for mineralisation using Attribute Manager entries.
 */

import React from 'react';
import { Box, Typography } from '@mui/material';
import { MineralisationConfig } from './MineralisationMapCell';
import { useAttributeStore, AttributeEntry } from '../../../store/attributeStore';

interface MineralisationLegendProps {
    config: MineralisationConfig;
    width: number;
    scaleFactor?: number;
}

// Format number for legend labels
function formatValue(value: number | undefined): string {
    if (value == null || isNaN(value)) return '?';
    if (value === 0) return '0';
    if (Math.abs(value) >= 1000) {
        return value.toFixed(0);
    } else if (Math.abs(value) >= 1) {
        return value.toFixed(1);
    } else if (Math.abs(value) >= 0.01) {
        return value.toFixed(2);
    } else {
        return value.toExponential(1);
    }
}

// Format entry label based on type
function getEntryLabel(entry: AttributeEntry): string {
    if (entry.isDefault) {
        return entry.name || 'Default';
    }
    if (entry.type === 'range' && entry.min !== undefined && entry.max !== undefined) {
        return `${formatValue(entry.min)} - ${formatValue(entry.max)}`;
    }
    if (entry.type === 'category' && entry.categoryValue !== undefined) {
        return entry.categoryValue;
    }
    return entry.name || 'Unknown';
}

export const MineralisationLegend: React.FC<MineralisationLegendProps> = ({
    config,
    width,
    scaleFactor = 1
}) => {
    const fontSize = Math.round(9 * scaleFactor);
    const boxSize = Math.round(12 * scaleFactor);
    const gap = Math.round(8 * scaleFactor);

    // Get entries from attribute store
    const colorEntries = useAttributeStore(state => state.color.entries);
    const customEntries = useAttributeStore(state => state.customEntries);

    // Filter to visible entries with colors
    const visibleEntries = [...colorEntries, ...customEntries].filter(
        e => e.visible && e.color && !e.isDefault
    );

    // Also include default entry if it exists
    const defaultEntry = colorEntries.find(e => e.isDefault && e.visible);

    if (visibleEntries.length === 0 && !defaultEntry) return null;

    return (
        <Box
            sx={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: `${gap}px`,
                py: 0.5,
                borderBottom: '1px solid #ccc',
                mb: 0.5,
                width: width
            }}
        >
            {/* Label */}
            <Typography
                sx={{
                    fontSize: fontSize,
                    fontFamily: 'Arial, sans-serif',
                    fontWeight: 'bold',
                    mr: 1
                }}
            >
                {config.displayName} ({config.unit}):
            </Typography>

            {/* Color boxes with labels - non-default entries first */}
            {visibleEntries.map((entry, index) => (
                <Box
                    key={entry.id || index}
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.5
                    }}
                >
                    <Box
                        sx={{
                            width: boxSize,
                            height: boxSize,
                            backgroundColor: entry.color,
                            border: '0.5px solid rgba(0,0,0,0.2)',
                            borderRadius: '2px'
                        }}
                    />
                    <Typography
                        sx={{
                            fontSize: fontSize - 1,
                            fontFamily: 'Arial, sans-serif'
                        }}
                    >
                        {getEntryLabel(entry)}
                    </Typography>
                </Box>
            ))}

            {/* Default entry last */}
            {defaultEntry && (
                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.5
                    }}
                >
                    <Box
                        sx={{
                            width: boxSize,
                            height: boxSize,
                            backgroundColor: defaultEntry.color || '#808080',
                            border: '0.5px solid rgba(0,0,0,0.2)',
                            borderRadius: '2px'
                        }}
                    />
                    <Typography
                        sx={{
                            fontSize: fontSize - 1,
                            fontFamily: 'Arial, sans-serif'
                        }}
                    >
                        Other
                    </Typography>
                </Box>
            )}
        </Box>
    );
};

export default MineralisationLegend;
