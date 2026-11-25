/**
 * Attribute Manager extras (parity):
 * - Data > From Colour / Shape / Size / Filter: the row names as a text column
 * - Home > Save / Restore Checkpoint: named attribute snapshots (saved in the project)
 * - Load / Save Attributes (.gat): legends; group names keep the legend's styles
 */
import React, { useState } from 'react';
import {
    Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider, IconButton, ListItemIcon, ListItemText,
    Menu, MenuItem, TextField, Tooltip, Typography,
} from '@mui/material';
import {
    MoreVert, TableRows, BookmarkAdd, Restore, Delete, Palette, SaveAlt, LayersClear, Rule, CompareArrows,
    Save, FolderOpen, Photo, Share, ClearAll, DeleteSweep,
} from '@mui/icons-material';
import { LegendExportDialog } from './LegendExportDialog';
import { useUIStore } from '../../store/uiStore';
import { AttributeType, TAB_NAMES, createCustomEntry, useAttributeStore } from '../../store/attributeStore';
import { useLegendStore } from '../../store/legendStore';
import { applyLegendStyles, parseGat, toGat } from '../../utils/interopLegend';
import { useAppStore } from '../../store/appStore';
import { useCheckpointStore } from '../../store/checkpointStore';
import { attributeColumnValues } from '../../utils/attributeUtils';
import { notify } from '../../store/notificationStore';

const DEFAULT_COLUMN: Record<AttributeType, string> = { color: 'Colour_Group', shape: 'Lithology', size: 'Size_Group', filter: 'Filter_Group' };

export const AttributeMoreMenu: React.FC<{ tab: AttributeType }> = ({ tab }) => {
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const [dialog, setDialog] = useState<'column' | 'checkpoint' | null>(null);
    const [legendOpen, setLegendOpen] = useState(false);
    const [confirm, setConfirm] = useState<'tab' | 'all' | null>(null);
    const fieldSet = useAttributeStore(s => !!s[tab].field || s[tab].entries.length > 1);

    const saveJson = () => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([useAttributeStore.getState().exportState()], { type: 'application/json' }));
        a.download = 'attributes.json';
        a.click();
        URL.revokeObjectURL(a.href);
    };
    const loadJson = async (file: File) => {
        if (useAttributeStore.getState().importState(await file.text())) notify(`Loaded attributes from ${file.name}`, 'success');
        else notify(`${file.name} is not a GeoChem attributes file`, 'error');
    };
    const syncQgis = async () => {
        try {
            await useAttributeStore.getState().syncStylesToQgis();
            notify('Styles sent to QGIS', 'success');
        } catch {
            notify('Could not reach the QGIS plugin', 'error');
        }
    };
    const [name, setName] = useState('');
    const checkpoints = useCheckpointStore(s => s.checkpoints);
    const tabName = TAB_NAMES[tab];
    const legend = useLegendStore(s => s.legend);

    const loadLegend = async (file: File) => {
        try {
            const lg = parseGat(await file.text(), file.name.replace(/\.gat$/i, ''));
            useLegendStore.getState().setLegend(lg);
            const attr = useAttributeStore.getState();
            // Restyle groups already on screen; with no colour field, the legend's
            // colours become empty groups to paint rows into
            for (const t of ['color', 'shape', 'size'] as const) {
                if (attr[t].field) attr.setEntries(t, applyLegendStyles(t, attr[t].entries, lg));
            }
            let added = 0;
            if (!attr.color.field) {
                for (const e of lg.color) {
                    if (/^default/i.test(e.name) || attr.customEntries.some(c => c.name === e.name)) continue;
                    attr.addCustomEntry({ ...createCustomEntry(e.name, e.hex), visible: e.visible, assignedIndices: [], rowCount: 0, visibleRowCount: 0 });
                    added++;
                }
            }
            notify(`Legend "${lg.name}": ${lg.color.length} colours${added ? `, ${added} empty groups to paint into` : ''}`, 'success');
        } catch (err) {
            notify(err instanceof Error ? err.message : 'Could not read the legend', 'error');
        }
    };

    const saveLegend = () => {
        const attr = useAttributeStore.getState();
        const xml = toGat({
            color: [...attr.color.entries, ...attr.customEntries.filter(e => e.color)],
            shape: attr.shape.entries, size: attr.size.entries,
        });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }));
        a.download = 'attributes.gat';
        a.click();
        URL.revokeObjectURL(a.href);
    };

    const open = (kind: 'column' | 'checkpoint') => {
        setAnchor(null);
        setName(kind === 'column' ? DEFAULT_COLUMN[tab] : '');
        setDialog(kind);
    };

    const makeColumn = () => {
        const col = name.trim();
        const app = useAppStore.getState();
        if (!col) return;
        if (app.columns.some(c => c.name === col)) { notify(`Column "${col}" already exists`, 'error'); return; }
        const values = attributeColumnValues(tab, app.columnarData.rowCount, n => app.getRawColumn(n));
        app.addColumn(col, values, 'categorical', 'Classification');
        const groups = new Set(values.filter(Boolean)).size;
        notify(`Added "${col}" from ${tabName} (${groups} groups)`, 'success');
        setDialog(null);
    };

    const saveCheckpoint = () => {
        const cp = useCheckpointStore.getState().saveCheckpoint(name);
        notify(`Saved checkpoint "${cp.name}"`, 'success');
        setDialog(null);
    };

    return (
        <>
            <Tooltip title="More: save / load, legend, checkpoints, rules">
                <IconButton size="small" aria-label="More attribute actions" onClick={(e) => setAnchor(e.currentTarget)}>
                    <MoreVert fontSize="small" />
                </IconButton>
            </Tooltip>
            <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
                <MenuItem onClick={() => open('column')}>
                    <ListItemIcon><TableRows fontSize="small" /></ListItemIcon>
                    <ListItemText primary={`From ${tabName} → column…`} secondary="Row names as a text column" />
                </MenuItem>
                <MenuItem onClick={() => { setAnchor(null); useUIStore.getState().setRulesOpen(true); }}>
                    <ListItemIcon><Rule fontSize="small" /></ListItemIcon>
                    <ListItemText primary="Classify by rules…" secondary="Column limits → colour groups, first match wins" />
                </MenuItem>
                <MenuItem onClick={() => { setAnchor(null); useUIStore.getState().setCompareOpen(true); }}>
                    <ListItemIcon><CompareArrows fontSize="small" /></ListItemIcon>
                    <ListItemText primary="Compare classifications…" secondary="Colour groups vs a text column" />
                </MenuItem>
                <Divider />
                <MenuItem onClick={() => { setAnchor(null); setLegendOpen(true); }}>
                    <ListItemIcon><Photo fontSize="small" /></ListItemIcon>
                    <ListItemText primary="Export legend…" secondary="Image of the classes for reports" />
                </MenuItem>
                <MenuItem onClick={() => { setAnchor(null); saveJson(); }}>
                    <ListItemIcon><Save fontSize="small" /></ListItemIcon>
                    <ListItemText primary="Save attributes (.json)" secondary="All tabs, groups, filter and emphasis" />
                </MenuItem>
                <MenuItem component="label">
                    <ListItemIcon><FolderOpen fontSize="small" /></ListItemIcon>
                    <ListItemText primary="Load attributes (.json)…" />
                    <input hidden type="file" accept=".json" onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        setAnchor(null);
                        if (f) void loadJson(f);
                    }} />
                </MenuItem>
                <MenuItem component="label">
                    <ListItemIcon><Palette fontSize="small" /></ListItemIcon>
                    <ListItemText primary="Load attributes (.gat)…" secondary={legend ? `Loaded: ${legend.name}` : 'legend: colours by group name'} />
                    <input hidden type="file" accept=".gat,.xml" onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        setAnchor(null);
                        if (f) void loadLegend(f);
                    }} />
                </MenuItem>
                <MenuItem onClick={() => { setAnchor(null); saveLegend(); }}>
                    <ListItemIcon><SaveAlt fontSize="small" /></ListItemIcon>
                    <ListItemText primary="Save attributes (.gat)" secondary="Legend for or later sessions" />
                </MenuItem>
                {legend && (
                    <MenuItem onClick={() => { setAnchor(null); useLegendStore.getState().setLegend(null); notify('Legend cleared', 'info'); }}>
                        <ListItemIcon><LayersClear fontSize="small" /></ListItemIcon>
                        <ListItemText primary="Clear loaded legend" />
                    </MenuItem>
                )}
                <MenuItem onClick={() => { setAnchor(null); void syncQgis(); }}>
                    <ListItemIcon><Share fontSize="small" /></ListItemIcon>
                    <ListItemText primary="Send styles to QGIS" />
                </MenuItem>
                <Divider />
                <MenuItem onClick={() => open('checkpoint')}>
                    <ListItemIcon><BookmarkAdd fontSize="small" /></ListItemIcon>
                    <ListItemText primary="Save checkpoint…" secondary="Snapshot of all attributes" />
                </MenuItem>
                {checkpoints.length > 0 && <Typography variant="caption" color="text.secondary" sx={{ px: 2 }}>Restore checkpoint</Typography>}
                {checkpoints.map(cp => (
                    <MenuItem key={cp.id} onClick={() => {
                        setAnchor(null);
                        if (useCheckpointStore.getState().restoreCheckpoint(cp.id)) notify(`Restored "${cp.name}"`, 'success');
                        else notify(`Could not restore "${cp.name}"`, 'error');
                    }}>
                        <ListItemIcon><Restore fontSize="small" /></ListItemIcon>
                        <ListItemText primary={cp.name} secondary={new Date(cp.created).toLocaleString()} />
                        <IconButton size="small" edge="end" aria-label={`Delete ${cp.name}`} onClick={(e) => { e.stopPropagation(); useCheckpointStore.getState().removeCheckpoint(cp.id); }}>
                            <Delete fontSize="small" />
                        </IconButton>
                    </MenuItem>
                ))}
                <Divider />
                <MenuItem disabled={!fieldSet} onClick={() => { setAnchor(null); setConfirm('tab'); }}>
                    <ListItemIcon><ClearAll fontSize="small" /></ListItemIcon>
                    <ListItemText primary={`Clear ${tabName} tab`} secondary="Field and classes (painted groups stay)" />
                </MenuItem>
                <MenuItem onClick={() => { setAnchor(null); setConfirm('all'); }}>
                    <ListItemIcon><DeleteSweep fontSize="small" /></ListItemIcon>
                    <ListItemText primary="Clear all attributes" secondary="Every tab, painted groups and the value filter" />
                </MenuItem>
            </Menu>
            <LegendExportDialog open={legendOpen} onClose={() => setLegendOpen(false)} />
            <Dialog open={confirm !== null} onClose={() => setConfirm(null)} maxWidth="xs">
                <DialogTitle>{confirm === 'all' ? 'Clear all attributes?' : `Clear the ${tabName} tab?`}</DialogTitle>
                <DialogContent>
                    <Typography variant="body2">
                        {confirm === 'all'
                            ? 'Every tab goes back to its default, painted groups are removed and the value filter is switched off.'
                            : `The ${tabName} field and its classes are removed; points take the default ${tabName.toLowerCase()}.`}
                        {' '}Undo (Ctrl+Z) brings them back.
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirm(null)}>Cancel</Button>
                    <Button color="error" variant="contained" onClick={() => {
                        const s = useAttributeStore.getState();
                        if (confirm === 'all') s.removeGlobalEntries(); else s.removeAllEntries(tab);
                        setConfirm(null);
                    }}>Clear</Button>
                </DialogActions>
            </Dialog>
            <Dialog open={dialog !== null} onClose={() => setDialog(null)} maxWidth="xs" fullWidth>
                <DialogTitle>{dialog === 'column' ? `From ${tabName}` : 'Save checkpoint'}</DialogTitle>
                <DialogContent>
                    <TextField
                        autoFocus fullWidth size="small" sx={{ mt: 1 }}
                        label={dialog === 'column' ? 'New column name' : 'Checkpoint name'}
                        placeholder={dialog === 'checkpoint' ? `Checkpoint ${checkpoints.length + 1}` : undefined}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') (dialog === 'column' ? makeColumn : saveCheckpoint)(); }}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDialog(null)}>Cancel</Button>
                    <Button variant="contained" onClick={dialog === 'column' ? makeColumn : saveCheckpoint}>
                        {dialog === 'column' ? 'Create column' : 'Save'}
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
};
