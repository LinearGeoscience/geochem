/**
 * Selection and paint controls inline in the status bar (replaces the old
 * floating SelectionManager card). Shown while samples are selected or
 * paint mode is on.
 */
import React, { useState } from 'react';
import {
    Box, Typography, Button, TextField, Dialog, DialogTitle, DialogContent, DialogActions, Autocomplete,
    IconButton, Switch, Select, MenuItem, Tooltip, Menu, ListItemIcon, Divider, Checkbox, FormControlLabel,
} from '@mui/material';
import { Close, Class, Brush, Undo, Add, FormatColorReset, SaveAlt, MoreVert } from '@mui/icons-material';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../store/appStore';
import { useAttributeStore } from '../../store/attributeStore';
import { useHistoryStore } from '../../store/historyStore';
import { paintableIndices } from '../../utils/attributeUtils';

const dot = (color?: string) => (
    <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: color || '#808080', border: '1px solid rgba(0,0,0,0.2)', flexShrink: 0 }} />
);

export const SelectionBar: React.FC = () => {
    const { selectedIndices, columns, assignClassToSelection, setSelection, savePaintGroupsToColumn } = useAppStore(useShallow(s => ({
        selectedIndices: s.selectedIndices, columns: s.columns,
        assignClassToSelection: s.assignClassToSelection, setSelection: s.setSelection,
        savePaintGroupsToColumn: s.savePaintGroupsToColumn,
    })));
    const a = useAttributeStore(useShallow(s => ({
        paintMode: s.paintMode, setPaintMode: s.setPaintMode, activeEntryId: s.activeEntryId, setActiveEntryId: s.setActiveEntryId,
        customEntries: s.customEntries, paintIndicesToActiveEntry: s.paintIndicesToActiveEntry, unpaintIndices: s.unpaintIndices,
        createEntryAndSetActive: s.createEntryAndSetActive, activeTab: s.activeTab,
        paintUnassignedOnly: s.paintUnassignedOnly, setPaintUnassignedOnly: s.setPaintUnassignedOnly,
    })));

    // Painting is undone with the app-wide undo (one history for everything)
    const canUndo = useHistoryStore(s => s.canUndo);
    const undo = useHistoryStore(s => s.undo);
    const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null);
    const [isClassifyOpen, setIsClassifyOpen] = useState(false);
    const [targetColumn, setTargetColumn] = useState('');
    const [className, setClassName] = useState('');
    const [isSaveGroupsOpen, setIsSaveGroupsOpen] = useState(false);
    const [groupColumnName, setGroupColumnName] = useState('Paint_Groups');

    const n = selectedIndices.length;
    const hasPaintedGroups = a.customEntries.some(e => e.assignedIndices.length > 0);
    const categoricalColumns = columns.filter(c => c.type === 'categorical' || c.role === 'Classification');
    const visible = n > 0 || a.paintMode;

    const handleClassify = () => {
        if (targetColumn && className) { assignClassToSelection(targetColumn, className); setIsClassifyOpen(false); }
    };
    const handleSaveGroups = () => {
        if (groupColumnName.trim()) { savePaintGroupsToColumn(groupColumnName.trim()); setIsSaveGroupsOpen(false); }
    };

    return (
        <>
            {visible && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, height: '100%' }}>
                    {n > 0 && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, px: 0.75, borderRadius: 1, bgcolor: 'primary.main', color: 'primary.contrastText' }}>
                            <Typography variant="caption" sx={{ fontWeight: 600 }}>{n.toLocaleString()} selected</Typography>
                            <Tooltip title="Clear selection (Esc)">
                                <IconButton size="small" onClick={() => setSelection([])} sx={{ p: 0.1, color: 'inherit' }} aria-label="Clear selection">
                                    <Close sx={{ fontSize: 14 }} />
                                </IconButton>
                            </Tooltip>
                        </Box>
                    )}
                    <Tooltip title="Paint mode: lasso paints into the active group">
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                            <Switch size="small" color="success" checked={a.paintMode} onChange={(e) => a.setPaintMode(e.target.checked)} inputProps={{ 'aria-label': 'Paint mode' }} />
                            <Typography variant="caption">Paint</Typography>
                        </Box>
                    </Tooltip>
                    {a.paintMode && (
                        <Tooltip title="Only paint rows that are not in a group yet (earlier groups stay put)">
                            <FormControlLabel sx={{ m: 0, mr: 0.5 }}
                                control={<Checkbox size="small" sx={{ p: 0.25 }} checked={a.paintUnassignedOnly} onChange={(e) => a.setPaintUnassignedOnly(e.target.checked)} />}
                                label={<Typography variant="caption">Unassigned only</Typography>} />
                        </Tooltip>
                    )}
                    <Select
                        value={a.activeEntryId || ''}
                        onChange={(e) => a.setActiveEntryId(e.target.value || null)}
                        size="small"
                        displayEmpty
                        variant="standard"
                        disableUnderline
                        sx={{ fontSize: 12, minWidth: 110, '& .MuiSelect-select': { py: 0, display: 'flex', alignItems: 'center', gap: 0.5 } }}
                        renderValue={(v) => {
                            const e = a.customEntries.find(x => x.id === v);
                            return e ? <>{dot(e.color)}{e.name} ({e.assignedIndices.length})</> : <em>No group</em>;
                        }}
                    >
                        <MenuItem value=""><em>None</em></MenuItem>
                        {a.customEntries.map(e => (
                            <MenuItem key={e.id} value={e.id} sx={{ gap: 1 }}>{dot(e.color)}<Typography variant="body2" noWrap>{e.name}</Typography></MenuItem>
                        ))}
                    </Select>
                    <Tooltip title="New paint group">
                        <IconButton size="small" onClick={() => a.createEntryAndSetActive(a.activeTab)} sx={{ p: 0.25 }}><Add sx={{ fontSize: 16 }} /></IconButton>
                    </Tooltip>
                    <Tooltip title="Paint selected into the active group">
                        <span>
                            <Button size="small" color="success" startIcon={<Brush sx={{ fontSize: 14 }} />} disabled={!a.activeEntryId || n === 0}
                                onClick={() => {
                                    const app = useAppStore.getState();
                                    a.paintIndicesToActiveEntry(paintableIndices(selectedIndices, app.columnarData.rowCount, c => app.getRawColumn(c)));
                                }} sx={{ py: 0, minWidth: 0, fontSize: 12 }}>Paint</Button>
                        </span>
                    </Tooltip>
                    <Tooltip title="Remove selected from all groups">
                        <span>
                            <IconButton size="small" disabled={n === 0} onClick={() => a.unpaintIndices(selectedIndices)} sx={{ p: 0.25 }} aria-label="Unpaint">
                                <FormatColorReset sx={{ fontSize: 16 }} />
                            </IconButton>
                        </span>
                    </Tooltip>
                    <Tooltip title="Undo (Ctrl+Z)">
                        <span>
                            <IconButton size="small" disabled={!canUndo} onClick={undo} sx={{ p: 0.25 }} aria-label="Undo paint">
                                <Undo sx={{ fontSize: 16 }} />
                            </IconButton>
                        </span>
                    </Tooltip>
                    <IconButton size="small" onClick={(e) => setMoreAnchor(e.currentTarget)} sx={{ p: 0.25 }} aria-label="More selection actions">
                        <MoreVert sx={{ fontSize: 16 }} />
                    </IconButton>
                    <Divider orientation="vertical" flexItem sx={{ my: 0.5 }} />
                </Box>
            )}
            <Menu anchorEl={moreAnchor} open={!!moreAnchor} onClose={() => setMoreAnchor(null)}>
                <MenuItem disabled={n === 0} onClick={() => { setMoreAnchor(null); setIsClassifyOpen(true); }}>
                    <ListItemIcon><Class fontSize="small" /></ListItemIcon>Assign selection to column class…
                </MenuItem>
                <MenuItem disabled={!hasPaintedGroups} onClick={() => { setMoreAnchor(null); setIsSaveGroupsOpen(true); }}>
                    <ListItemIcon><SaveAlt fontSize="small" /></ListItemIcon>Save paint groups to column…
                </MenuItem>
                <Divider />
                <MenuItem disabled sx={{ fontSize: 12 }}>Ctrl+lasso adds · Alt+lasso subtracts</MenuItem>
            </Menu>

            <Dialog open={isClassifyOpen} onClose={() => setIsClassifyOpen(false)}>
                <DialogTitle>Classify selection</DialogTitle>
                <DialogContent sx={{ pt: 2, minWidth: 300 }}>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
                        <Autocomplete
                            freeSolo
                            options={categoricalColumns.map(c => c.name)}
                            value={targetColumn}
                            onChange={(_, v) => setTargetColumn(v || '')}
                            onInputChange={(_, v) => setTargetColumn(v)}
                            renderInput={(params) => <TextField {...params} label="Target column" helperText="Select existing or type a new name" />}
                        />
                        <TextField label="Class name" value={className} onChange={(e) => setClassName(e.target.value)} helperText="e.g. Ultramafic, High-grade" />
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setIsClassifyOpen(false)}>Cancel</Button>
                    <Button onClick={handleClassify} variant="contained" disabled={!targetColumn || !className}>Assign</Button>
                </DialogActions>
            </Dialog>

            <Dialog open={isSaveGroupsOpen} onClose={() => setIsSaveGroupsOpen(false)}>
                <DialogTitle>Save paint groups to column</DialogTitle>
                <DialogContent sx={{ pt: 2, minWidth: 300 }}>
                    <TextField
                        autoFocus fullWidth label="Column name" value={groupColumnName}
                        onChange={(e) => setGroupColumnName(e.target.value)}
                        helperText="Unpainted rows are set to 'Unclassified'" sx={{ mt: 1 }}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setIsSaveGroupsOpen(false)}>Cancel</Button>
                    <Button onClick={handleSaveGroups} variant="contained" disabled={!groupColumnName.trim()}>Save</Button>
                </DialogActions>
            </Dialog>
        </>
    );
};
