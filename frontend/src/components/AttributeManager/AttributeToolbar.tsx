import React from 'react';
import { Box, Button, Tooltip, IconButton } from '@mui/material';
import { Add, Remove, ClearAll, DeleteForever, AddCircleOutline } from '@mui/icons-material';
import {
    useAttributeStore,
    AttributeType,
    createCustomEntry,
    AttributeEntry,
} from '../../store/attributeStore';
import { useAppStore } from '../../store/appStore';

interface AttributeToolbarProps {
    tab: AttributeType;
}

export const AttributeToolbar: React.FC<AttributeToolbarProps> = ({ tab }) => {
    const {
        selectedEntryNames,
        addCustomEntry,
        addEntry,
        removeCustomEntry,
        removeEntry,
        removeAllEntries,
        removeGlobalEntries,
        batchDeleteEntries,
        customEntries,
        color,
        shape,
        size,
        filter,
    } = useAttributeStore();

    const { columns } = useAppStore();

    const currentConfig = tab === 'color' ? color :
                          tab === 'shape' ? shape :
                          tab === 'size' ? size : filter;

    // Check if selected field is numeric (for Add Range button)
    const isNumericField = React.useMemo(() => {
        if (!currentConfig.field) return false;
        const col = columns.find(c => c.name === currentConfig.field);
        return col?.type === 'numeric' || col?.type === 'float' || col?.type === 'integer';
    }, [currentConfig.field, columns]);

    const handleAdd = () => {
        const baseName = tab === 'color' ? 'New Colour' :
                         tab === 'shape' ? 'New Shape' :
                         tab === 'size' ? 'New Size' : 'New Filter';

        // Find unique name
        let name = baseName;
        let counter = 1;
        while (customEntries.some(e => e.name === name) ||
               currentConfig.entries.some(e => e.name === name)) {
            name = `${baseName} ${counter}`;
            counter++;
        }

        const newEntry = createCustomEntry(
            name,
            tab === 'color' ? '#ff0000' : undefined,
            tab === 'shape' ? 'circle' : undefined,
            tab === 'size' ? 8 : undefined
        );

        addCustomEntry(newEntry);
    };

    const handleAddRange = () => {
        if (!currentConfig.field) return;

        // Find the last range entry to get the max value as a starting point
        const rangeEntries = currentConfig.entries.filter(e => e.type === 'range' && !e.isDefault);
        const lastRange = rangeEntries[rangeEntries.length - 1];

        const newMin = lastRange?.max ?? 0;
        const newMax = newMin + 1;

        const id = `range-${Date.now()}`;

        const colors = ['#e41a1c', '#377eb8', '#4daf4a', '#984ea3', '#ff7f00', '#ffff33', '#a65628', '#f781bf'];
        const colorIndex = rangeEntries.length % colors.length;

        const newEntry: AttributeEntry = {
            id,
            name: `${newMin.toFixed(2)} - ${newMax.toFixed(2)}`,
            isDefault: false,
            isCustom: false,
            visible: true,
            type: 'range',
            min: newMin,
            max: newMax,
            color: colors[colorIndex],
            shape: 'circle',
            size: 8,
            assignedIndices: [],
            rowCount: 0,
            visibleRowCount: 0,
        };

        addEntry(tab, newEntry);
    };

    const handleRemove = () => {
        if (selectedEntryNames.length === 0) return;

        if (selectedEntryNames.length > 1) {
            // Batch delete
            batchDeleteEntries(tab, selectedEntryNames);
            return;
        }

        // Single delete
        const selectedName = selectedEntryNames[0];

        const customEntry = customEntries.find(e => e.name === selectedName);
        if (customEntry) {
            removeCustomEntry(customEntry.id);
            return;
        }

        const fieldEntry = currentConfig.entries.find(
            e => e.name === selectedName && !e.isDefault
        );
        if (fieldEntry) {
            removeEntry(tab, fieldEntry.id);
        }
    };

    const handleRemoveAll = () => {
        removeAllEntries(tab);
    };

    const handleGlobal = () => {
        removeGlobalEntries();
    };

    // Check if selected entries can be removed
    const canRemove = selectedEntryNames.length > 0 && selectedEntryNames.some(name =>
        customEntries.some(e => e.name === name) ||
        currentConfig.entries.some(e => e.name === name && !e.isDefault)
    );

    // Show Add Range when a numeric field is selected (not just when range entries exist)
    const showAddRange = currentConfig.field && (
        isNumericField || currentConfig.entries.some(e => e.type === 'range')
    );

    return (
        <Box
            sx={{
                display: 'flex',
                gap: 1,
                px: 1,
                py: 0.5,
                borderTop: '1px solid',
                borderColor: 'divider',
                bgcolor: 'action.hover',
            }}
        >
            <Tooltip title="Add custom entry (manual selection)">
                <IconButton size="small" onClick={handleAdd} color="primary">
                    <Add />
                </IconButton>
            </Tooltip>

            {showAddRange && (
                <Tooltip title="Add new range">
                    <IconButton size="small" onClick={handleAddRange} color="secondary">
                        <AddCircleOutline />
                    </IconButton>
                </Tooltip>
            )}

            <Tooltip title={selectedEntryNames.length > 1 ? `Remove ${selectedEntryNames.length} selected` : "Remove selected entry"}>
                <span>
                    <IconButton
                        size="small"
                        onClick={handleRemove}
                        disabled={!canRemove}
                        color="error"
                    >
                        <Remove />
                    </IconButton>
                </span>
            </Tooltip>

            <Box sx={{ flex: 1 }} />

            <Tooltip title="Remove all entries (this tab)">
                <Button
                    size="small"
                    variant="outlined"
                    startIcon={<ClearAll />}
                    onClick={handleRemoveAll}
                    sx={{ fontSize: '0.7rem' }}
                >
                    All
                </Button>
            </Tooltip>

            <Tooltip title="Remove ALL attributes (all tabs)">
                <Button
                    size="small"
                    variant="outlined"
                    color="error"
                    startIcon={<DeleteForever />}
                    onClick={handleGlobal}
                    sx={{ fontSize: '0.7rem' }}
                >
                    Global
                </Button>
            </Tooltip>
        </Box>
    );
};

export default AttributeToolbar;
