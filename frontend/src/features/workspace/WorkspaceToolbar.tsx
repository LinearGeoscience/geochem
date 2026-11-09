/**
 * 36px toolbar above the dock: New plot (Alt+N), templates, the shared drag
 * tool (L lasso / B box / Z zoom / P pan), Grid / Attributes / Workflows pane
 * toggles (Alt+G / Alt+A / Alt+F), Reset layout and representative sampling.
 */
import React, { useState } from 'react';
import { Box, Button, ToggleButtonGroup, ToggleButton, Tooltip, Chip, Popover, Divider } from '@mui/material';
import { Add, Gesture, CropFree, ZoomIn, PanTool, FilterAlt, SpaceDashboard, TableRows, Palette, ViewModule, PostAdd, Lock, LockOpen, ZoomOutMap, Checklist } from '@mui/icons-material';
import { useUIStore, DragMode } from '../../store/uiStore';
import { useAppStore } from '../../store/appStore';
import { TemplateMenu } from '../plots/TemplateMenu';
import { SamplingControls } from '../../components/SamplingControls';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { layoutPanelIds, PANEL_IDS } from '../../utils/workspaceLayout';
import { tilePlots, toggleFixedPane } from './workspaceApi';
import { addPlotToReport } from '../../utils/reportCapture';

const TOOLS: { mode: DragMode; label: string; key: string; icon: React.ReactElement }[] = [
    { mode: 'lasso', label: 'Lasso select', key: 'L', icon: <Gesture fontSize="small" /> },
    { mode: 'select', label: 'Box select', key: 'B', icon: <CropFree fontSize="small" /> },
    { mode: 'zoom', label: 'Zoom', key: 'Z', icon: <ZoomIn fontSize="small" /> },
    { mode: 'pan', label: 'Pan', key: 'P', icon: <PanTool fontSize="small" /> },
];

export const WorkspaceToolbar: React.FC = () => {
    const dragMode = useUIStore(s => s.dragMode);
    const setDragMode = useUIStore(s => s.setDragMode);
    const setNewPlotOpen = useUIStore(s => s.setNewPlotDialogOpen);
    const sampling = useAppStore(s => s.samplingConfig.enabled);
    const gridOpen = useWorkspaceStore(s => !!s.layout && layoutPanelIds(s.layout).includes(PANEL_IDS.grid));
    const attributesOpen = useWorkspaceStore(s => !!s.layout && layoutPanelIds(s.layout).includes(PANEL_IDS.attributes));
    const workflowsOpen = useWorkspaceStore(s => !!s.layout && layoutPanelIds(s.layout).includes(PANEL_IDS.workflows));
    const activePlotId = useAppStore(s => s.activePlotId);
    const sampleSize = useAppStore(s => s.samplingResult?.sampleSize ?? null);
    const rowCount = useAppStore(s => s.columnarData.rowCount);
    const [samplingAnchor, setSamplingAnchor] = useState<HTMLElement | null>(null);
    const lockAxes = useAppStore(s => s.lockAxes);
    const lockFullExtent = useAppStore(s => s.lockFullExtent);

    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, height: 36, pl: 1, pr: 1, flexShrink: 0, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
            <Tooltip title="New plot (Alt+N)">
                <Button size="small" variant="contained" startIcon={<Add />} onClick={() => setNewPlotOpen(true)} sx={{ py: 0.25 }}>
                    New plot
                </Button>
            </Tooltip>
            <TemplateMenu />
            <Divider orientation="vertical" flexItem sx={{ my: 0.75 }} />
            <ToggleButtonGroup size="small" exclusive value={dragMode} onChange={(_, v) => v && setDragMode(v)} aria-label="Plot tool">
                {TOOLS.map(t => (
                    <ToggleButton key={t.mode} value={t.mode} aria-label={t.label} sx={{ py: 0.25, px: 0.75 }}>
                        <Tooltip title={`${t.label} (${t.key})`}>{t.icon}</Tooltip>
                    </ToggleButton>
                ))}
            </ToggleButtonGroup>
            <ToggleButtonGroup size="small" sx={{ '& .MuiToggleButton-root': { py: 0.25, px: 0.75 } }}>
                <Tooltip title={lockAxes ? 'Axes locked: plots keep their ranges when styles or filters change' : 'Lock axes (keep ranges when styles or filters change)'}>
                    <ToggleButton value="lock" selected={lockAxes} onChange={() => useAppStore.getState().setLockAxes(!lockAxes)} aria-label="Lock axes">
                        {lockAxes ? <Lock fontSize="small" /> : <LockOpen fontSize="small" />}
                    </ToggleButton>
                </Tooltip>
                <Tooltip title={lockFullExtent ? 'Axes span all data (hidden points included)' : 'Axes span all data, including hidden points'}>
                    <ToggleButton value="extent" selected={lockFullExtent} onChange={() => useAppStore.getState().setLockFullExtent(!lockFullExtent)} aria-label="Full data extent">
                        <ZoomOutMap fontSize="small" />
                    </ToggleButton>
                </Tooltip>
            </ToggleButtonGroup>
            <ToggleButtonGroup size="small" sx={{ '& .MuiToggleButton-root': { py: 0.25, px: 1, gap: 0.5, textTransform: 'none' } }}>
                <Tooltip title="Data grid pane (Alt+G)">
                    <ToggleButton value="grid" selected={gridOpen} onChange={() => toggleFixedPane(PANEL_IDS.grid)} aria-label="Toggle data grid">
                        <TableRows fontSize="small" />Grid
                    </ToggleButton>
                </Tooltip>
                <Tooltip title="Attribute Manager pane (Alt+A)">
                    <ToggleButton value="attributes" selected={attributesOpen} onChange={() => toggleFixedPane(PANEL_IDS.attributes)} aria-label="Toggle attributes">
                        <Palette fontSize="small" />Attributes
                    </ToggleButton>
                </Tooltip>
                <Tooltip title="Workflows pane: deposit-style recipes, one step at a time (Alt+F)">
                    <ToggleButton value="workflows" selected={workflowsOpen} onChange={() => toggleFixedPane(PANEL_IDS.workflows)} aria-label="Toggle workflows">
                        <Checklist fontSize="small" />Workflows
                    </ToggleButton>
                </Tooltip>
            </ToggleButtonGroup>
            <Tooltip title="Tile plots: every open plot side by side in an even grid">
                <Button size="small" startIcon={<ViewModule />} onClick={() => tilePlots()} sx={{ py: 0.25 }} data-testid="tile-plots">
                    Tile plots
                </Button>
            </Tooltip>
            <Tooltip title="Add the active plot to the report as a figure (Alt+R)">
                <span>
                    <Button
                        size="small" startIcon={<PostAdd />} sx={{ py: 0.25 }} data-testid="add-to-report"
                        disabled={!activePlotId}
                        onClick={() => { if (activePlotId) void addPlotToReport(activePlotId); }}
                    >
                        Add to report
                    </Button>
                </span>
            </Tooltip>
            <Tooltip title="Reset layout: plots as tabs, grid below, attributes on the right">
                <Button size="small" startIcon={<SpaceDashboard />} onClick={() => useWorkspaceStore.getState().resetLayout()} sx={{ py: 0.25 }}>
                    Reset layout
                </Button>
            </Tooltip>
            <Box sx={{ flex: 1 }} />
            <Tooltip title="Plot a representative sample (e.g. 10,000 rows) instead of every row: much faster with many charts or large files.">
                <Chip
                    size="small"
                    icon={<FilterAlt />}
                    color={sampling ? 'primary' : 'default'}
                    variant={sampling ? 'filled' : 'outlined'}
                    label={sampling
                        ? `Plotting ${sampleSize != null ? sampleSize.toLocaleString() : '…'} of ${rowCount.toLocaleString()} rows`
                        : `Plotting all ${rowCount.toLocaleString()} rows · Sample…`}
                    onClick={(e) => setSamplingAnchor(e.currentTarget)}
                    aria-label="Point sampling"
                />
            </Tooltip>
            <Popover
                open={!!samplingAnchor}
                anchorEl={samplingAnchor}
                onClose={() => setSamplingAnchor(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                slotProps={{ paper: { sx: { p: 2, maxWidth: 560 } } }}
            >
                <SamplingControls />
            </Popover>
        </Box>
    );
};
