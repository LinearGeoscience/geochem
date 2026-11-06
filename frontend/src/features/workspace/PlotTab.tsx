/**
 * Dock tab for a plot pane: title with inline rename (double-click / F2),
 * close button, middle-click close and a context menu
 * (Rename / Duplicate / Graph properties / Export / Maximise / Close / Close others).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Box, IconButton, InputBase, Menu, MenuItem, Tooltip, Divider, ListItemIcon } from '@mui/material';
import { Close, Edit, ContentCopy, CancelPresentation, OpenInFull, Tune, Image, PostAdd, ListAlt } from '@mui/icons-material';
import type { IDockviewPanelHeaderProps } from 'dockview-react';
import { useAppStore, PLOT_TYPE_LABEL } from '../../store/appStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { PresentationDialog } from './PresentationDialog';
import { exportPlotImages } from '../../utils/plotExport';
import { addPlotToReport } from '../../utils/reportCapture';

const hint = (text: string) => <Box sx={{ ml: 'auto', pl: 2, color: 'text.secondary', fontSize: 12 }}>{text}</Box>;

export const PlotTab: React.FC<IDockviewPanelHeaderProps> = ({ api }) => {
    const plotId = api.id;
    const plot = useAppStore(s => s.plots.find(p => p.id === plotId));
    const editing = useWorkspaceStore(s => s.renamingPlotId === plotId);
    const setRenaming = useWorkspaceStore(s => s.setRenamingPlotId);
    const propertiesOpen = useWorkspaceStore(s => s.propertiesPlotId === plotId);
    const [draft, setDraft] = useState(plot?.title ?? '');
    const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (editing) { setDraft(plot?.title ?? ''); requestAnimationFrame(() => inputRef.current?.select()); }
    }, [editing, plot?.title]);

    if (!plot) return null;
    const commit = () => { useAppStore.getState().renamePlot(plotId, draft); setRenaming(null); };
    const close = () => useAppStore.getState().removePlot(plotId);
    const act = (fn: () => void) => () => { setMenu(null); fn(); };

    return (
        <Box
            sx={{ display: 'flex', alignItems: 'center', gap: 0.5, height: '100%', px: 1, maxWidth: 240 }}
            onDoubleClick={() => setRenaming(plotId)}
            onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); close(); } }}
            onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}
        >
            {editing ? (
                <InputBase
                    inputRef={inputRef}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commit}
                    onPointerDown={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter') commit();
                        else if (e.key === 'Escape') setRenaming(null);
                    }}
                    inputProps={{ 'aria-label': 'Plot name', size: Math.max(6, draft.length) }}
                    sx={{ fontSize: 13, px: 0.5, border: 1, borderColor: 'primary.main', borderRadius: 0.5, bgcolor: 'background.paper' }}
                />
            ) : (
                <Tooltip title={`${PLOT_TYPE_LABEL[plot.type]} · double-click or F2 to rename`} enterDelay={700}>
                    <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>
                        {plot.title}
                    </Box>
                </Tooltip>
            )}
            <IconButton
                size="small"
                aria-label={`Close ${plot.title}`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); close(); }}
                sx={{ p: 0.25, opacity: 0.6, color: 'inherit', '&:hover': { opacity: 1 } }}
            >
                <Close sx={{ fontSize: 14 }} />
            </IconButton>
            <Menu
                open={!!menu}
                onClose={() => setMenu(null)}
                anchorReference="anchorPosition"
                anchorPosition={menu ? { top: menu.y, left: menu.x } : undefined}
                slotProps={{ paper: { sx: { minWidth: 200 } } }}
            >
                <MenuItem onClick={act(() => setRenaming(plotId))}><ListItemIcon><Edit fontSize="small" /></ListItemIcon>Rename{hint('F2')}</MenuItem>
                <MenuItem onClick={act(() => useAppStore.getState().duplicatePlot(plotId))}><ListItemIcon><ContentCopy fontSize="small" /></ListItemIcon>Duplicate{hint('Alt+D')}</MenuItem>
                <MenuItem onClick={act(() => useWorkspaceStore.getState().setPropertiesPlotId(plotId))}><ListItemIcon><Tune fontSize="small" /></ListItemIcon>Graph properties…</MenuItem>
                <MenuItem onClick={act(() => useAppStore.getState().updatePlotSettings(plotId, { legendOverlay: !plot.settings?.legendOverlay }))}>
                    <ListItemIcon><ListAlt fontSize="small" /></ListItemIcon>{plot.settings?.legendOverlay ? 'Hide legend' : 'Show legend'}
                </MenuItem>
                <MenuItem onClick={act(() => { void addPlotToReport(plotId); })}><ListItemIcon><PostAdd fontSize="small" /></ListItemIcon>Add to report{hint('Alt+R')}</MenuItem>
                <MenuItem onClick={act(() => exportPlotImages(plotId, 'svg'))}><ListItemIcon><Image fontSize="small" /></ListItemIcon>Export SVG</MenuItem>
                <MenuItem onClick={act(() => exportPlotImages(plotId, 'png'))}><ListItemIcon><Image fontSize="small" /></ListItemIcon>Export PNG</MenuItem>
                <MenuItem onClick={act(() => (api.isMaximized() ? api.exitMaximized() : api.maximize()))}>
                    <ListItemIcon><OpenInFull fontSize="small" /></ListItemIcon>{api.isMaximized() ? 'Restore' : 'Maximise'}
                </MenuItem>
                <Divider />
                <MenuItem onClick={act(close)}><ListItemIcon><Close fontSize="small" /></ListItemIcon>Close{hint('Alt+W')}</MenuItem>
                <MenuItem
                    onClick={act(() => {
                        const s = useAppStore.getState();
                        for (const p of s.plots) if (p.id !== plotId) s.removePlot(p.id);
                        s.setActivePlotId(plotId);
                    })}
                >
                    <ListItemIcon><CancelPresentation fontSize="small" /></ListItemIcon>Close others
                </MenuItem>
            </Menu>
            {propertiesOpen && <PresentationDialog plotId={plotId} open onClose={() => useWorkspaceStore.getState().setPropertiesPlotId(null)} />}
        </Box>
    );
};
