import React, { useRef, useState } from 'react';
import { Box, Button, Tooltip } from '@mui/material';
import { Visibility, VisibilityOff, Save, FolderOpen, Photo } from '@mui/icons-material';
import { useAttributeStore, AttributeType } from '../../store/attributeStore';
import { LegendExportDialog } from './LegendExportDialog';

interface AttributeActionsProps {
    tab: AttributeType;
}

export const AttributeActions: React.FC<AttributeActionsProps> = ({ tab }) => {
    const {
        setAllVisible,
        exportState,
        importState,
        customEntries,
        color,
        shape,
        size,
        filter,
    } = useAttributeStore();

    const fileInputRef = useRef<HTMLInputElement>(null);
    const [legendDialogOpen, setLegendDialogOpen] = useState(false);

    const handleAllVisible = () => {
        setAllVisible(tab, true);
        // Also set custom entries visible
        customEntries.forEach(entry => {
            useAttributeStore.getState().updateCustomEntry(entry.id, { visible: true });
        });
    };

    const handleAllInvisible = () => {
        setAllVisible(tab, false);
        // Also set custom entries invisible
        customEntries.forEach(entry => {
            useAttributeStore.getState().updateCustomEntry(entry.id, { visible: false });
        });
    };

    const handleSave = () => {
        const jsonData = exportState();
        const blob = new Blob([jsonData], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'attributes.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleLoad = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const content = e.target?.result as string;
            if (content) {
                const success = importState(content);
                if (!success) {
                    alert('Failed to load attributes file. Please check the file format.');
                }
            }
        };
        reader.readAsText(file);

        // Reset file input
        event.target.value = '';
    };

    // Check if any entries exist to enable/disable buttons
    const currentConfig = tab === 'color' ? color :
                          tab === 'shape' ? shape :
                          tab === 'size' ? size : filter;

    const hasEntries = currentConfig.entries.length > 1 || customEntries.length > 0;

    return (
        <Box
            sx={{
                display: 'flex',
                gap: 0.5,
                px: 1,
                py: 0.5,
                borderTop: '1px solid',
                borderColor: 'divider',
                bgcolor: 'action.hover',
            }}
        >
            <Tooltip title="Show all entries">
                <span>
                    <Button
                        size="small"
                        variant="outlined"
                        startIcon={<Visibility />}
                        onClick={handleAllVisible}
                        disabled={!hasEntries}
                        sx={{ fontSize: '0.65rem', flex: 1 }}
                    >
                        All Visible
                    </Button>
                </span>
            </Tooltip>

            <Tooltip title="Hide all entries">
                <span>
                    <Button
                        size="small"
                        variant="outlined"
                        startIcon={<VisibilityOff />}
                        onClick={handleAllInvisible}
                        disabled={!hasEntries}
                        sx={{ fontSize: '0.65rem', flex: 1 }}
                    >
                        All Invisible
                    </Button>
                </span>
            </Tooltip>

            <Tooltip title="Save attributes to file">
                <Button
                    size="small"
                    variant="outlined"
                    startIcon={<Save />}
                    onClick={handleSave}
                    sx={{ fontSize: '0.65rem', flex: 1 }}
                >
                    Save
                </Button>
            </Tooltip>

            <Tooltip title="Load attributes from file">
                <Button
                    size="small"
                    variant="outlined"
                    startIcon={<FolderOpen />}
                    onClick={handleLoad}
                    sx={{ fontSize: '0.65rem', flex: 1 }}
                >
                    Load
                </Button>
            </Tooltip>

            <Tooltip title="Export legend as image">
                <Button
                    size="small"
                    variant="outlined"
                    startIcon={<Photo />}
                    onClick={() => setLegendDialogOpen(true)}
                    disabled={!hasEntries}
                    sx={{ fontSize: '0.65rem', flex: 1 }}
                >
                    Legend
                </Button>
            </Tooltip>

            <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".json"
                style={{ display: 'none' }}
            />

            <LegendExportDialog
                open={legendDialogOpen}
                onClose={() => setLegendDialogOpen(false)}
            />
        </Box>
    );
};

export default AttributeActions;
