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
import { ShapeMarker } from '../ShapeMarker';

// Selected entry indicator component
const SelectedEntryIndicator: React.FC = () => {
    const { selectedEntryNames, customEntries, color, shape, size } = useAttributeStore();

    if (selectedEntryNames.length === 0) return null;

    // Show count if multiple selected
    if (selectedEntryNames.length > 1) {
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
                <Typography variant="body2" fontWeight="bold">
                    {selectedEntryNames.length} selected
                </Typography>
            </Box>
        );
    }

    const selectedEntryName = selectedEntryNames[0];

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
                    <ShapeMarker shape={entryShape} size={16} />
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
            case 'color': return <Palette sx={{ fontSize: 16, mr: 0.5, flexShrink: 0 }} />;
            case 'shape': return <Category sx={{ fontSize: 16, mr: 0.5, flexShrink: 0 }} />;
            case 'size': return <FormatSize sx={{ fontSize: 16, mr: 0.5, flexShrink: 0 }} />;
            case 'filter': return <FilterList sx={{ fontSize: 16, mr: 0.5, flexShrink: 0 }} />;
        }
    }, [type]);

    const label = useMemo(() => {
        const typeName = type.charAt(0).toUpperCase() + type.slice(1);
        return field ? `${typeName} - ${field}` : typeName;
    }, [type, field]);

    return (
        <Tooltip title={label} enterDelay={400}>
            <Box sx={{ display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
                {icon}
                <Typography variant="body2" noWrap sx={{ fontSize: '0.7rem' }}>
                    {label}
                </Typography>
            </Box>
        </Tooltip>
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
                    pr: 1,
                    pl: 3,
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

            {/* Actions (All Visible/Invisible/Save/Load) */}
            <AttributeActions tab={activeTab} />

            {/* High Grade Emphasis Controls */}
            <Box sx={{ px: 1, pb: 1, borderTop: '1px solid', borderColor: 'divider' }}>
                <EmphasisControls />
            </Box>
        </Paper>
    );
};

export default AttributeManager;
