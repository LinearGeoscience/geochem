/**
 * Slim status bar (UI Refresh R2) — 28px caption-size strip replacing the
 * old divider-heavy ProjectManager statusbar variant. Purely store-driven.
 */
import React from 'react';
import { Box, CircularProgress, Tooltip, Typography } from '@mui/material';
import { Schedule } from '@mui/icons-material';
import { useProjectStore } from '../../store/projectStore';
import { useAppStore } from '../../store/appStore';
import { useShallow } from 'zustand/react/shallow';
import { SelectionBar } from './SelectionBar';
import { HiddenRowsChip } from './HiddenRowsChip';

function formatLastSaved(isoDate: string | null): string {
    if (!isoDate) return 'never';
    const date = new Date(isoDate);
    const diff = Date.now() - date.getTime();
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
    if (diff < 86400000) return date.toLocaleTimeString();
    return date.toLocaleDateString();
}

export const StatusBar: React.FC = () => {
    const { currentProject, isDirty, lastSaved, autosaveEnabled, isLoading, lastAutosave, lastAutosaveError, intervalMin } =
        useProjectStore(useShallow(s => ({
            currentProject: s.currentProject, isDirty: s.isDirty, lastSaved: s.lastSaved,
            autosaveEnabled: s.autosaveEnabled, isLoading: s.isLoading,
            lastAutosave: s.lastAutosave, lastAutosaveError: s.lastAutosaveError, intervalMin: s.autosaveIntervalMinutes,
        })));
    const autosaveOk = !lastAutosaveError;
    const liveRowCount = useAppStore(s => s.columnarData.rowCount);
    const liveColumnCount = useAppStore(s => s.columns.length);

    return (
        <Box
            sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                px: 2,
                height: 28,
                flexShrink: 0,
                bgcolor: 'background.paper',
                borderTop: 1,
                borderColor: 'divider',
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                <Typography variant="caption" sx={{ fontWeight: 500 }}>
                    {currentProject?.name || 'Untitled'}
                </Typography>
                {isDirty && (
                    <Tooltip title="Unsaved changes">
                        <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'warning.main' }} />
                    </Tooltip>
                )}
            </Box>

            {currentProject?.filePath && (
                <Tooltip title={currentProject.filePath}>
                    <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                        {currentProject.filePath}
                    </Typography>
                </Tooltip>
            )}

            <Typography variant="caption" color="text.secondary">
                Saved {formatLastSaved(lastSaved)}
            </Typography>

            {autosaveEnabled && (
                <Tooltip
                    title={lastAutosaveError
                        ?? `Every ${intervalMin} min unsaved changes go to a recovery copy (offered back if the app closes unexpectedly). `
                        + `The project file changes only when you Save.${lastAutosave ? ` Last autosave ${formatLastSaved(lastAutosave)}.` : ''}`}
                >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Schedule sx={{ fontSize: 13, color: autosaveOk ? (lastAutosave ? 'success.main' : 'text.disabled') : 'error.main' }} />
                        <Typography variant="caption" color={autosaveOk ? (lastAutosave ? 'success.main' : 'text.disabled') : 'error.main'}>
                            {autosaveOk ? 'autosave' : 'autosave failed'}
                        </Typography>
                    </Box>
                </Tooltip>
            )}

            {isLoading && <CircularProgress size={13} />}

            <Box sx={{ flexGrow: 1 }} />

            <HiddenRowsChip />

            <SelectionBar />

            {currentProject && (
                <Typography variant="caption" color="text.secondary">
                    {liveRowCount.toLocaleString()} rows × {liveColumnCount} cols
                </Typography>
            )}
        </Box>
    );
};
