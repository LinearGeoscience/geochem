/**
 * Plot / layout templates (Phase 22): save the active plot or all open plots
 * as a reusable template, apply templates to the current dataset (column
 * references resolve by element/role, see utils/plotTemplates), and move
 * templates between machines as .chemtpl files.
 */
import React, { useRef, useState } from 'react';
import {
    Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider, IconButton, ListItemText,
    Menu, MenuItem, TextField, Tooltip, Typography,
} from '@mui/material';
import { Bookmarks, Delete, Download, Upload } from '@mui/icons-material';
import { useAppStore } from '../../store/appStore';
import { notify } from '../../store/notificationStore';
import {
    Template, PlotTemplate, listTemplates, saveTemplate, deleteTemplate, makePlotTemplate,
    makeLayoutTemplate, resolveSettings, templateToFileBlob, readTemplateFile, TEMPLATE_FILE_EXTENSION,
    instantiateTemplateLayout,
} from '../../utils/plotTemplates';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { openInteropTemplateFile } from '../../utils/interopWorkspace';

type PendingSave = { kind: 'plot' | 'layout' } | null;

export const TemplateMenu: React.FC = () => {
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const [templates, setTemplates] = useState<Template[]>([]);
    const [pending, setPending] = useState<PendingSave>(null);
    const [name, setName] = useState('');
    const fileInput = useRef<HTMLInputElement>(null);
    const interopInput = useRef<HTMLInputElement>(null);

    const open = (e: React.MouseEvent<HTMLElement>) => {
        setTemplates(listTemplates());
        setAnchor(e.currentTarget);
    };
    const close = () => setAnchor(null);

    const startSave = (kind: 'plot' | 'layout') => {
        const { plots, activePlotId } = useAppStore.getState();
        const active = plots.find(p => p.id === activePlotId);
        setName(kind === 'plot' ? (active?.title ?? 'Plot template') : 'Layout');
        setPending({ kind });
        close();
    };

    const confirmSave = () => {
        if (!pending || !name.trim()) return;
        const { plots, activePlotId, columns, geochemMappings } = useAppStore.getState();
        if (pending.kind === 'plot') {
            const active = plots.find(p => p.id === activePlotId);
            if (!active) { notify('No active plot to save', 'warning'); setPending(null); return; }
            saveTemplate(makePlotTemplate(active, name.trim(), columns, geochemMappings));
        } else {
            if (plots.length === 0) { notify('No open plots to save', 'warning'); setPending(null); return; }
            saveTemplate(makeLayoutTemplate(plots, name.trim(), columns, geochemMappings, useWorkspaceStore.getState().layout));
        }
        notify(`Template "${name.trim()}" saved`, 'success');
        setPending(null);
    };

    const applyPlot = (t: PlotTemplate): { id: string; unresolved: string[] } => {
        const s = useAppStore.getState();
        const { settings, unresolved } = resolveSettings(t.settings, s.columns, s.geochemMappings);
        const id = s.addPlot(t.plotType as never, { settings, title: t.title });
        return { id, unresolved };
    };

    const apply = (t: Template) => {
        close();
        const made = t.kind === 'plot' ? [applyPlot(t)] : t.plots.map(applyPlot);
        const unresolved = made.flatMap(m => m.unresolved);
        if (t.kind === 'layout') {
            // v2: restore the arrangement; plots already open are added back as tabs
            const layout = instantiateTemplateLayout(t, made.map(m => m.id));
            if (layout) useWorkspaceStore.getState().applyLayout(layout);
        }
        const missing = [...new Set(unresolved)];
        notify(
            missing.length
                ? `Applied "${t.name}". No matching column for: ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? '…' : ''}`
                : `Applied "${t.name}"`,
            missing.length ? 'warning' : 'success',
        );
    };

    const exportTemplate = (t: Template) => {
        const a = document.createElement('a');
        const url = URL.createObjectURL(templateToFileBlob(t));
        a.href = url;
        a.download = `${t.name.replace(/[^a-z0-9]+/gi, '_')}${TEMPLATE_FILE_EXTENSION}`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const importFile = async (file: File | undefined) => {
        if (!file) return;
        try {
            const t = await readTemplateFile(file);
            saveTemplate(t);
            notify(`Imported template "${t.name}"`, 'success');
        } catch (err) {
            notify(err instanceof Error ? err.message : 'Could not read template', 'error');
        }
    };

    return (
        <>
            <Button size="small" variant="outlined" startIcon={<Bookmarks />} onClick={open} sx={{ whiteSpace: 'nowrap' }}>
                Templates
            </Button>
            <Menu anchorEl={anchor} open={!!anchor} onClose={close}>
                <MenuItem onClick={() => startSave('plot')}>Save active plot as template…</MenuItem>
                <MenuItem onClick={() => startSave('layout')}>Save all open plots as layout…</MenuItem>
                <MenuItem onClick={() => { close(); fileInput.current?.click(); }}>
                    <Upload fontSize="small" sx={{ mr: 1 }} /> Import template file…
                </MenuItem>
                <MenuItem onClick={() => { close(); interopInput.current?.click(); }}>
                    <Upload fontSize="small" sx={{ mr: 1 }} /> Open workspace template (.xml)…
                </MenuItem>
                <Divider />
                {templates.length === 0 && (
                    <MenuItem disabled><Typography variant="body2">No saved templates</Typography></MenuItem>
                )}
                {templates.map(t => (
                    <MenuItem key={`${t.kind}:${t.name}`} onClick={() => apply(t)} sx={{ gap: 1 }}>
                        <ListItemText
                            primary={t.name}
                            secondary={t.kind === 'layout' ? `Layout · ${t.plots.length} plots` : `Plot · ${t.plotType}`}
                        />
                        <Tooltip title="Export file">
                            <IconButton size="small" onClick={(e) => { e.stopPropagation(); exportTemplate(t); }}>
                                <Download fontSize="small" />
                            </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete">
                            <IconButton size="small" onClick={(e) => { e.stopPropagation(); deleteTemplate(t.kind, t.name); setTemplates(listTemplates()); }}>
                                <Delete fontSize="small" />
                            </IconButton>
                        </Tooltip>
                    </MenuItem>
                ))}
            </Menu>
            <input
                ref={fileInput}
                type="file"
                accept={`${TEMPLATE_FILE_EXTENSION},.json`}
                hidden
                onChange={(e) => { importFile(e.target.files?.[0]); e.target.value = ''; }}
            />
            <input
                ref={interopInput}
                type="file"
                accept=".xml"
                hidden
                data-testid="interop-template-input"
                onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) openInteropTemplateFile(f).then(msg => notify(msg, 'success'), err => notify(err instanceof Error ? err.message : 'Could not read template', 'error'));
                }}
            />
            <Dialog open={!!pending} onClose={() => setPending(null)} maxWidth="xs" fullWidth>
                <DialogTitle>{pending?.kind === 'layout' ? 'Save layout template' : 'Save plot template'}</DialogTitle>
                <DialogContent>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        Columns are stored by element and role, so the template also works on datasets with different column names.
                    </Typography>
                    <TextField autoFocus fullWidth size="small" label="Template name" value={name}
                        onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') confirmSave(); }} />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setPending(null)}>Cancel</Button>
                    <Button variant="contained" disabled={!name.trim()} onClick={confirmSave}>Save</Button>
                </DialogActions>
            </Dialog>
        </>
    );
};
