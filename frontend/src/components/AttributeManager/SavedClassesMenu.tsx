/**
 * Saved classes of the active tab: keep the classes on screen under a name,
 * put saved ones back (on the field they were made on, or on the tab's
 * current field), and move the whole library as a .json file.
 */
import React, { useState } from 'react';
import {
    Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider, IconButton, ListItemIcon, ListItemText,
    Menu, MenuItem, TextField, Tooltip, Typography,
} from '@mui/material';
import { Bookmarks, BookmarkAdd, Delete, FileDownload, FileUpload, Style, SwapHoriz } from '@mui/icons-material';
import { AttributeType, TAB_NAMES, useAttributeStore } from '../../store/attributeStore';
import { ClassScheme, useClassSchemeStore } from '../../store/classSchemeStore';
import { useAppStore } from '../../store/appStore';
import { notify } from '../../store/notificationStore';
import { datasetGetter } from '../../utils/attributeClassify';
import { applyScheme, canApplyTo, schemeClassCount, schemeFromConfig, schemeTarget } from '../../utils/classSchemes';

export const SavedClassesMenu: React.FC<{ tab: AttributeType }> = ({ tab }) => {
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const [naming, setNaming] = useState(false);
    const [name, setName] = useState('');
    const config = useAttributeStore(s => s[tab]);
    const all = useClassSchemeStore(s => s.schemes);
    const columns = useAppStore(s => s.columns);
    const schemes = all.filter(s => s.tab === tab);
    const tabName = TAB_NAMES[tab];
    const alias = (f: string) => columns.find(c => c.name === f)?.alias || f;
    const canSave = !!config.field && config.entries.some(e => !e.isDefault && !e.isCustom);
    const replaces = schemes.some(s => s.name === name.trim());
    // column lookups only while the menu is open
    const data = anchor ? datasetGetter() : null;

    const openNaming = () => {
        setAnchor(null);
        setName(config.field ? alias(config.field) : '');
        setNaming(true);
    };

    const save = () => {
        const scheme = schemeFromConfig(tab, useAttributeStore.getState()[tab], name);
        if (!scheme) return;
        useClassSchemeStore.getState().save(scheme);
        notify(`Saved ${tabName.toLowerCase()} classes "${scheme.name}" (${schemeClassCount(scheme)} classes)`, 'success');
        setNaming(false);
    };

    const apply = (scheme: ClassScheme, field?: string) => {
        setAnchor(null);
        const r = applyScheme(scheme, field);
        notify(r.message, r.ok ? 'success' : 'error');
    };

    const exportFile = () => {
        setAnchor(null);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([useClassSchemeStore.getState().exportSchemes()], { type: 'application/json' }));
        a.download = 'saved-classes.json';
        a.click();
        URL.revokeObjectURL(a.href);
    };

    const importFile = async (file: File) => {
        const n = useClassSchemeStore.getState().importSchemes(await file.text());
        if (n) notify(`Read ${n} saved ${n === 1 ? 'class set' : 'class sets'} from ${file.name}`, 'success');
        else notify(`${file.name} is not a saved-classes file`, 'error');
    };

    return (
        <>
            <Tooltip title={`Saved classes: keep these ${tabName.toLowerCase()} classes, or put saved ones back`}>
                <IconButton size="small" aria-label="Saved classes" onClick={(e) => setAnchor(e.currentTarget)}>
                    <Bookmarks fontSize="small" />
                </IconButton>
            </Tooltip>
            <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
                <MenuItem disabled={!canSave} onClick={openNaming}>
                    <ListItemIcon><BookmarkAdd fontSize="small" /></ListItemIcon>
                    <ListItemText
                        primary={`Save these ${tabName.toLowerCase()} classes…`}
                        secondary={canSave ? 'Breaks or values, styles and names, for any dataset' : `Choose a ${tabName.toLowerCase()} field first`}
                    />
                </MenuItem>
                <Divider />
                <Typography variant="caption" color="text.secondary" sx={{ px: 2 }}>
                    {schemes.length ? `Saved ${tabName.toLowerCase()} classes` : `No saved ${tabName.toLowerCase()} classes yet`}
                </Typography>
                {schemes.map((s) => {
                    const target = data ? schemeTarget(s, config.field, data.getCol) : null;
                    // also offered on the tab's own field when that is a different, suitable one
                    const other = data && config.field && config.field !== target && canApplyTo(s, data.getCol(config.field))
                        ? config.field : null;
                    const n = schemeClassCount(s);
                    return (
                        <MenuItem key={s.id} onClick={() => apply(s)}>
                            <ListItemIcon><Style fontSize="small" /></ListItemIcon>
                            <ListItemText
                                primary={s.name}
                                secondary={`${alias(s.field)} · ${n} ${s.kind === 'range' ? (n === 1 ? 'range' : 'ranges') : (n === 1 ? 'value' : 'values')}`
                                    + (target && target !== s.field ? ` → ${alias(target)}` : '')
                                    + (target ? '' : ' · field not in this dataset')}
                                sx={{ mr: 1 }}
                            />
                            {other && (
                                <Tooltip title={`Put these classes on ${alias(other)} instead`}>
                                    <IconButton
                                        size="small" aria-label={`Apply ${s.name} to ${alias(other)}`}
                                        onClick={(e) => { e.stopPropagation(); apply(s, other); }}
                                    >
                                        <SwapHoriz fontSize="small" />
                                    </IconButton>
                                </Tooltip>
                            )}
                            <IconButton
                                size="small" edge="end" aria-label={`Delete ${s.name}`}
                                onClick={(e) => { e.stopPropagation(); useClassSchemeStore.getState().remove(s.id); }}
                            >
                                <Delete fontSize="small" />
                            </IconButton>
                        </MenuItem>
                    );
                })}
                <Divider />
                <MenuItem disabled={all.length === 0} onClick={exportFile}>
                    <ListItemIcon><FileDownload fontSize="small" /></ListItemIcon>
                    <ListItemText primary="Export saved classes (.json)" secondary="Every tab's saved classes, for another computer" />
                </MenuItem>
                <MenuItem component="label">
                    <ListItemIcon><FileUpload fontSize="small" /></ListItemIcon>
                    <ListItemText primary="Import saved classes (.json)…" />
                    <input hidden type="file" accept=".json" onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        setAnchor(null);
                        if (f) void importFile(f);
                    }} />
                </MenuItem>
            </Menu>
            <Dialog open={naming} onClose={() => setNaming(false)} maxWidth="xs" fullWidth>
                <DialogTitle>Save {tabName.toLowerCase()} classes</DialogTitle>
                <DialogContent>
                    <TextField
                        autoFocus fullWidth size="small" sx={{ mt: 1 }}
                        label="Name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) save(); }}
                        helperText={replaces
                            ? 'Saved classes with this name will be replaced'
                            : 'Kept on this computer for every project; apply them from this menu'}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setNaming(false)}>Cancel</Button>
                    <Button variant="contained" disabled={!name.trim()} onClick={save}>{replaces ? 'Replace' : 'Save'}</Button>
                </DialogActions>
            </Dialog>
        </>
    );
};
