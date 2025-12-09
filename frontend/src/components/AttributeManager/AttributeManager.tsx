import React, { useMemo, useState } from 'react';
import {
    Paper,
    Box,
    Tabs,
    Tab,
    Typography,
    Tooltip,
    IconButton,
    CircularProgress,
} from '@mui/material';
import { Palette, Category, FormatSize, FilterList, Lock, LockOpen, Share } from '@mui/icons-material';
import { useAttributeStore, AttributeType } from '../../store/attributeStore';
import { useAppStore } from '../../store/appStore';
import { AttributeGrid } from './AttributeGrid';
import { AttributeToolbar } from './AttributeToolbar';
import { AttributeConfig } from './AttributeConfig';
import { AttributeActions } from './AttributeActions';
import { EmphasisControls } from '../StyleManager/EmphasisControls';

// Shape marker SVG component
const ShapeIcon: React.FC<{ shape: string; color?: string; size?: number }> = ({
    shape,
    color = 'currentColor',
    size = 14
}) => {
    const getPath = () => {
        switch (shape) {
            case 'circle':
                return <circle cx="7" cy="7" r="5" fill={color} />;
            case 'square':
                return <rect x="2" y="2" width="10" height="10" fill={color} />;
            case 'diamond':
                return <path d="M 7 1 L 13 7 L 7 13 L 1 7 Z" fill={color} />;
            case 'triangle-up':
                return <path d="M 7 1 L 13 13 L 1 13 Z" fill={color} />;
            case 'triangle-down':
                return <path d="M 7 13 L 13 1 L 1 1 Z" fill={color} />;
            case 'cross':
                return <path d="M 7 1 L 7 13 M 1 7 L 13 7" stroke={color} strokeWidth="2" fill="none" />;
            case 'x':
                return <path d="M 2 2 L 12 12 M 12 2 L 2 12" stroke={color} strokeWidth="2" fill="none" />;
            case 'star':
                return <path d="M 7 1 L 8.5 5 L 13 5.5 L 10 9 L 11 13 L 7 11 L 3 13 L 4 9 L 1 5.5 L 5.5 5 Z" fill={color} />;
            default:
                return <circle cx="7" cy="7" r="5" fill={color} />;
        }
    };

    return (
        <svg width={size} height={size} viewBox="0 0 14 14">
            {getPath()}
        </svg>
    );
};

// Selected entry indicator component
const SelectedEntryIndicator: React.FC = () => {
    const { selectedEntryName, customEntries, color, shape, size } = useAttributeStore();

    if (!selectedEntryName) return null;

    // Find the entry across custom entries and all tabs
    const customEntry = customEntries.find(e => e.name === selectedEntryName);
    const colorEntry = color.entries.find(e => e.name === selectedEntryName);
    const shapeEntry = shape.entries.find(e => e.name === selectedEntryName);
    const sizeEntry = size.entries.find(e => e.name === selectedEntryName);

    // Get attributes from custom entry or tab-specific entries
    const entryColor = customEntry?.color || colorEntry?.color || '#808080';
    const entryShape = customEntry?.shape || shapeEntry?.shape || 'circle';
    const entrySize = customEntry?.size || sizeEntry?.size || 8;

    return (
        <Box
            sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 1.5,
                py: 0.5,
                bgcolor: 'action.selected',
                borderRadius: 1,
                border: '1px solid',
                borderColor: 'divider',
            }}
        >
            <Typography variant="body2" fontWeight="bold" sx={{ mr: 1 }}>
                {selectedEntryName}
            </Typography>
            <Tooltip title={`Color: ${entryColor}`}>
                <Box
                    sx={{
                        width: 16,
                        height: 16,
                        borderRadius: '50%',
                        bgcolor: entryColor,
                        border: '1px solid rgba(0,0,0,0.2)',
                    }}
                />
            </Tooltip>
            <Tooltip title={`Shape: ${entryShape}`}>
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <ShapeIcon shape={entryShape} size={16} />
                </Box>
            </Tooltip>
            <Tooltip title={`Size: ${entrySize}pt`}>
                <Typography variant="caption" sx={{ fontWeight: 'bold' }}>
                    {entrySize}pt
                </Typography>
            </Tooltip>
        </Box>
    );
};

// Tab label component
const TabLabel: React.FC<{ type: AttributeType; field: string | null }> = ({ type, field }) => {
    const icon = useMemo(() => {
        switch (type) {
            case 'color': return <Palette sx={{ fontSize: 18, mr: 0.5 }} />;
            case 'shape': return <Category sx={{ fontSize: 18, mr: 0.5 }} />;
            case 'size': return <FormatSize sx={{ fontSize: 18, mr: 0.5 }} />;
            case 'filter': return <FilterList sx={{ fontSize: 18, mr: 0.5 }} />;
        }
    }, [type]);

    const label = useMemo(() => {
        const typeName = type.charAt(0).toUpperCase() + type.slice(1);
        return field ? `${typeName} - ${field}` : `${typeName} -`;
    }, [type, field]);

    return (
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
            {icon}
            <Typography variant="body2" noWrap sx={{ maxWidth: 120 }}>
                {label}
            </Typography>
        </Box>
    );
};

export const AttributeManager: React.FC = () => {
    const {
        activeTab,
        setActiveTab,
        color,
        shape,
        size,
        filter,
        syncStylesToQgis,
    } = useAttributeStore();

    const { lockAxes, setLockAxes } = useAppStore();
    const [isSyncing, setIsSyncing] = useState(false);
    const [syncStatus, setSyncStatus] = useState<'idle' | 'success' | 'error'>('idle');

    const handleTabChange = (_: React.SyntheticEvent, newValue: AttributeType) => {
        setActiveTab(newValue);
    };

    const handleSyncToQgis = async () => {
        setIsSyncing(true);
        setSyncStatus('idle');
        try {
            await syncStylesToQgis();
            setSyncStatus('success');
            // Reset status after 3 seconds
            setTimeout(() => setSyncStatus('idle'), 3000);
        } catch (err) {
            setSyncStatus('error');
            setTimeout(() => setSyncStatus('idle'), 3000);
        } finally {
            setIsSyncing(false);
        }
    };

    const currentConfig = useMemo(() => {
        switch (activeTab) {
            case 'color': return color;
            case 'shape': return shape;
            case 'size': return size;
            case 'filter': return filter;
        }
    }, [activeTab, color, shape, size, filter]);

    return (
        <Paper sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            {/* Header with selected entry indicator */}
            <Box
                sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    px: 1,
                    py: 0.5,
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    minHeight: 40,
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="subtitle1" fontWeight="bold">
                        Attribute Manager
                    </Typography>
                    <Tooltip title={lockAxes ? "Unlock axes (allow auto-rescale)" : "Lock axes (prevent auto-rescale)"}>
                        <IconButton
                            size="small"
                            onClick={() => setLockAxes(!lockAxes)}
                            color={lockAxes ? "primary" : "default"}
                            sx={{ ml: 1 }}
                        >
                            {lockAxes ? <Lock fontSize="small" /> : <LockOpen fontSize="small" />}
                        </IconButton>
                    </Tooltip>
                    <Tooltip title="Sync styles to QGIS plugin">
                        <IconButton
                            size="small"
                            onClick={handleSyncToQgis}
                            disabled={isSyncing}
                            color={syncStatus === 'success' ? 'success' : syncStatus === 'error' ? 'error' : 'default'}
                            sx={{ ml: 0.5 }}
                        >
                            {isSyncing ? (
                                <CircularProgress size={18} />
                            ) : (
                                <Share fontSize="small" />
                            )}
                        </IconButton>
                    </Tooltip>
                </Box>
                <SelectedEntryIndicator />
            </Box>

            {/* Tabs */}
            <Tabs
                value={activeTab}
                onChange={handleTabChange}
                variant="fullWidth"
                sx={{
                    minHeight: 36,
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    '& .MuiTab-root': {
                        minHeight: 36,
                        py: 0.5,
                        px: 1,
                        fontSize: '0.75rem',
                    },
                }}
            >
                <Tab value="color" label={<TabLabel type="color" field={color.field} />} />
                <Tab value="shape" label={<TabLabel type="shape" field={shape.field} />} />
                <Tab value="size" label={<TabLabel type="size" field={size.field} />} />
                <Tab value="filter" label={<TabLabel type="filter" field={filter.field} />} />
            </Tabs>

            {/* Grid */}
            <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
                <AttributeGrid tab={activeTab} config={currentConfig} />
            </Box>

            {/* Toolbar (Add/Remove/All/Global) */}
            <AttributeToolbar tab={activeTab} />

            {/* Config (Field/Method/Palette/AutoAttribute) */}
            <AttributeConfig tab={activeTab} config={currentConfig} />

            {/* High Grade Emphasis Controls */}
            <Box sx={{ px: 1, pb: 1, borderTop: '1px solid', borderColor: 'divider' }}>
                <EmphasisControls />
            </Box>

            {/* Actions (All Visible/Invisible/Save/Load) */}
            <AttributeActions tab={activeTab} />
        </Paper>
    );
};

export default AttributeManager;
