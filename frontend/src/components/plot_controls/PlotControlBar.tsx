/**
 * Plot control bar (UI Refresh R4).
 *
 * Replaces the wrapping many-widget control rows above each plot with a
 * clean 44px toolbar: primary controls (axis/column pickers) on the left,
 * active-setting chips + a settings popover on the right.
 *
 * Purely presentational — all state stays in the plot components and their
 * getPlotSettings/updatePlotSettings persistence.
 */
import React, { useState } from 'react';
import { Badge, Box, Button, Chip, Divider, IconButton, Popover, Tooltip, Typography } from '@mui/material';
import { Tune, ExpandMore, ExpandLess } from '@mui/icons-material';
import { isCompactPane, usePane } from '../../features/workspace/PaneContext';

export interface PlotControlBarProps {
    /** Always-visible controls (axis pickers etc.), laid out left in one row */
    primary: React.ReactNode;
    /** Popover body — group with <ControlSection> */
    settings?: React.ReactNode;
    /** Chips summarizing non-default settings while the popover is closed */
    summary?: React.ReactNode;
    /** Show a dot on the settings button (e.g. any non-default setting) */
    settingsActive?: boolean;
}

export const PlotControlBar: React.FC<PlotControlBarProps> = ({ primary, settings, summary, settingsActive }) => {
    const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
    const compact = isCompactPane(usePane());
    const [expanded, setExpanded] = useState(false);
    const showPrimary = !compact || expanded;

    return (
        <Box
            sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 1.5,
                py: compact ? 0.25 : 0.5,
                mb: compact ? 0.5 : 1,
                borderBottom: 1,
                borderColor: 'divider',
                flexWrap: 'wrap',
            }}
        >
            {compact && (
                <Button size="small" onClick={() => setExpanded(v => !v)} endIcon={expanded ? <ExpandLess /> : <ExpandMore />}
                    sx={{ py: 0, textTransform: 'none' }} data-testid="plot-controls-toggle">
                    {expanded ? 'Hide controls' : 'Controls'}
                </Button>
            )}
            <Box sx={{ display: showPrimary ? 'flex' : 'none', alignItems: 'center', gap: 1, flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
                {primary}
            </Box>
            {!showPrimary && <Box sx={{ flex: 1 }} />}

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                {!compact && summary}
                {settings && (
                    <>
                        <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: 0.5 }} />
                        <Tooltip title="Plot settings">
                            <IconButton onClick={(e) => setAnchorEl(e.currentTarget)}>
                                <Badge color="primary" variant="dot" invisible={!settingsActive}>
                                    <Tune fontSize="small" />
                                </Badge>
                            </IconButton>
                        </Tooltip>
                    </>
                )}
            </Box>

            {settings && (
                <Popover
                    open={Boolean(anchorEl)}
                    anchorEl={anchorEl}
                    onClose={() => setAnchorEl(null)}
                    anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                    transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                >
                    <Box sx={{ width: 330, p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {settings}
                    </Box>
                </Popover>
            )}
        </Box>
    );
};

/** Overline-labelled group inside the settings popover. */
export const ControlSection: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <Box>
        <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
            {label}
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {children}
        </Box>
    </Box>
);

/** Tiny chip showing an active non-default setting; delete resets it. */
export const SettingChip: React.FC<{ label: string; onDelete?: () => void }> = ({ label, onDelete }) => (
    <Chip label={label} size="small" variant="outlined" color="primary" onDelete={onDelete} sx={{ height: 22 }} />
);
