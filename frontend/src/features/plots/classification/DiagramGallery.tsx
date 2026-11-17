/**
 * Diagram gallery: category tree, search, thumbnails and a detail pane that
 * shows how the diagram's variables resolve against the loaded dataset.
 * Used by classification plots ("Change diagram"), scatter/ternary "Apply
 * diagram…", and (Phase 28) the New Plot dialog.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert, Box, Button, Chip, Dialog, DialogContent, DialogTitle, IconButton, InputAdornment,
    List, ListItemButton, ListItemText, Stack, TextField, Tooltip, Typography, Collapse,
} from '@mui/material';
import {
    Close, Search, ChangeHistory, ScatterPlot as ScatterIcon, ExpandMore, ChevronRight,
    UploadFile, Edit as EditIcon, DeleteOutline,
} from '@mui/icons-material';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../../store/appStore';
import { useClassificationStore, getBuiltInDiagramsV3 } from '../../../store/classificationStore';
import { useCustomDiagramStore } from '../../../store/customDiagramStore';
import { useDiagramEditorStore } from '../../../store/diagramEditorStore';
import type { ClassificationDiagram } from '../../../types/classificationDiagram';
import { resolveDiagram, DiagramResolution } from '../../../utils/classificationAxisResolver';
import { importInteropXmlFiles } from '../../../utils/classification/importInteropXml';
import { toV3 } from './useDiagramLayer';
import { chemHtml } from './buildDiagramLayer';
import {
    CatalogEntry, CategoryNode, ResolutionStatus, buildCategoryTree, filterCatalog, resolutionStatus, thumbUrl, toCatalogEntry,
} from './diagramCatalog';

const STATUS_COLOR: Record<ResolutionStatus, string> = { full: 'success.main', partial: 'warning.main', none: 'error.main' };
const STATUS_TEXT: Record<ResolutionStatus, string> = {
    full: 'All inputs found in this dataset',
    partial: 'Some inputs missing',
    none: 'Inputs not found in this dataset',
};

interface DiagramGalleryProps {
    open: boolean;
    onClose: () => void;
    onSelect: (diagramId: string) => void;
    selectedId?: string | null;
    title?: string;
    /** Restrict to one geometry (e.g. 'ternary' when applying to a ternary plot). */
    kind?: 'xy' | 'ternary';
    /** Render inline (no Dialog), e.g. as a tab of the New Plot dialog. */
    embedded?: boolean;
    /** Controlled search text (hides the gallery's own search box). */
    query?: string;
}

/** Render chemistry markup (subscripts) from chemHtml as React nodes. */
const Chem: React.FC<{ text: string }> = ({ text }) => {
    const parts = chemHtml(text).split(/(<sub>.*?<\/sub>|<sup>.*?<\/sup>|<br>)/g);
    return <>{parts.map((p, i) => {
        if (p === '<br>') return ' ';
        const m = /^<(sub|sup)>(.*)<\/(?:sub|sup)>$/.exec(p);
        if (m) return m[1] === 'sub' ? <sub key={i}>{m[2]}</sub> : <sup key={i}>{m[2]}</sup>;
        return <React.Fragment key={i}>{p.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')}</React.Fragment>;
    })}</>;
};

const TreeNode: React.FC<{
    node: CategoryNode; depth: number; selected: string; expanded: Set<string>;
    onSelect: (key: string) => void; onToggle: (key: string) => void;
}> = ({ node, depth, selected, expanded, onSelect, onToggle }) => {
    const open = expanded.has(node.key);
    return (
        <>
            <ListItemButton
                dense selected={selected === node.key}
                onClick={() => { onSelect(node.key); if (node.children.length && !open) onToggle(node.key); }}
                sx={{ pl: 1 + depth * 1.5, py: 0.25 }}
            >
                {node.children.length ? (
                    <Box component="span" onClick={(e) => { e.stopPropagation(); onToggle(node.key); }} sx={{ display: 'flex', mr: 0.5 }}>
                        {open ? <ExpandMore fontSize="small" /> : <ChevronRight fontSize="small" />}
                    </Box>
                ) : <Box sx={{ width: 24 }} />}
                <ListItemText primary={node.label} primaryTypographyProps={{ variant: 'body2', noWrap: true }} />
                <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>{node.count}</Typography>
            </ListItemButton>
            {node.children.length > 0 && (
                <Collapse in={open} unmountOnExit>
                    {node.children.map(c => (
                        <TreeNode key={c.key} node={c} depth={depth + 1} selected={selected} expanded={expanded} onSelect={onSelect} onToggle={onToggle} />
                    ))}
                </Collapse>
            )}
        </>
    );
};

const Thumb: React.FC<{ entry: CatalogEntry; height: number }> = ({ entry, height }) => {
    const [failed, setFailed] = useState(false);
    if (entry.custom || failed) {
        return (
            <Box sx={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'action.hover', color: 'text.secondary' }}>
                {entry.kind === 'ternary' ? <ChangeHistory sx={{ fontSize: height / 3 }} /> : <ScatterIcon sx={{ fontSize: height / 3 }} />}
            </Box>
        );
    }
    return (
        <Box
            component="img" src={thumbUrl(entry.id)} alt="" loading="lazy" onError={() => setFailed(true)}
            sx={{ height, width: '100%', objectFit: 'contain', bgcolor: '#fff', display: 'block' }}
        />
    );
};

export const DiagramGallery: React.FC<DiagramGalleryProps> = ({ open, onClose, onSelect, selectedId, title, kind, embedded, query: externalQuery }) => {
    const diagrams = useClassificationStore(s => s.diagrams);
    const { columns, geochemMappings } = useAppStore(useShallow(s => ({ columns: s.columns, geochemMappings: s.geochemMappings })));
    const [ownQuery, setQuery] = useState('');
    const query = externalQuery ?? ownQuery;
    const [folder, setFolder] = useState('');
    const [expanded, setExpanded] = useState<Set<string>>(new Set(['']));
    const [focusId, setFocusId] = useState<string | null>(selectedId ?? null);
    const [importMsg, setImportMsg] = useState<{ severity: 'success' | 'error'; text: string } | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    useEffect(() => { if (open) setFocusId(selectedId ?? null); }, [open, selectedId]);

    const byId = useMemo(() => new Map(diagrams.map(d => [d.id, d])), [diagrams]);

    const entries = useMemo(() => [
        ...diagrams.map(d => toCatalogEntry(toV3(d), d.id.startsWith('custom-'))),
        // built-in plots (Piper) open their native plot type; not when
        // a geometry is imposed (Apply diagram on scatter/ternary)
        ...(kind ? [] : getBuiltInDiagramsV3().filter(d => d.kind === 'builtin').map(d => toCatalogEntry(d, false))),
    ].filter(e => !kind || e.kind === kind),
    [diagrams, kind]);
    const tree = useMemo(() => buildCategoryTree(entries), [entries]);
    const visible = useMemo(() => filterCatalog(entries, folder, query), [entries, folder, query]);

    const numericNames = useMemo(
        () => columns.filter(c => c.type === 'numeric' || c.type === 'float' || c.type === 'integer').map(c => c.name),
        [columns],
    );
    // Resolution is cached per diagram for this dataset
    const resolutionCache = useMemo(() => new Map<string, DiagramResolution | null>(), [geochemMappings, numericNames]); // eslint-disable-line react-hooks/exhaustive-deps
    const resolutionOf = (id: string): DiagramResolution | null => {
        if (!numericNames.length) return null;
        if (!resolutionCache.has(id)) {
            const legacy = byId.get(id);
            resolutionCache.set(id, legacy ? resolveDiagram(legacy, geochemMappings, numericNames) : null);
        }
        return resolutionCache.get(id) ?? null;
    };

    // The detail pane follows the visible cards (search/folder narrow it)
    const focus = visible.find(e => e.id === focusId) ?? visible[0] ?? null;
    const focusResolution = focus ? resolutionOf(focus.id) : null;

    const toggle = (key: string) => setExpanded(prev => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
    });

    const choose = (id: string) => { onSelect(id); onClose(); };

    const handleImport = async (files: FileList | null) => {
        if (!files?.length) return;
        const { imported, errors } = await importInteropXmlFiles([...files]);
        const store = useCustomDiagramStore.getState();
        for (const d of imported) {
            if (store.getDiagram(d.id)) store.updateDiagram(d); else store.addDiagram(d);
        }
        useClassificationStore.getState().refreshCustomDiagrams();
        if (imported.length) {
            setFolder('Custom');
            setExpanded(prev => new Set([...prev, 'Custom']));
            setFocusId(imported[0].id);
        }
        setImportMsg(errors.length
            ? { severity: 'error', text: `${imported.length} imported; ${errors.length} failed: ${errors.join('; ')}` }
            : { severity: 'success', text: `${imported.length} diagram${imported.length === 1 ? '' : 's'} imported` });
        if (fileRef.current) fileRef.current.value = '';
    };

    const editCustom = (d: ClassificationDiagram) => {
        useDiagramEditorStore.getState().loadDiagramForEditing(d);
        useAppStore.getState().setCurrentView('diagram-editor');
        onClose();
    };
    const removeCustom = (id: string) => {
        useCustomDiagramStore.getState().removeDiagram(id);
        useClassificationStore.getState().removeCustomDiagram(id);
        setFocusId(null);
    };

    const header = (
        <>
                {!embedded && <Typography variant="h6" sx={{ flexShrink: 0 }}>{title ?? 'Diagram library'}</Typography>}
                {externalQuery === undefined && <TextField
                    size="small" autoFocus placeholder="Search name, element, author…" value={query}
                    onChange={(e) => setQuery(e.target.value)} sx={{ flex: 1, maxWidth: 480 }}
                    InputProps={{ startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> }}
                />}
                <Typography variant="body2" color="text.secondary">{visible.length} of {entries.length}</Typography>
                <Box sx={{ flex: 1 }} />
                <input ref={fileRef} type="file" accept=".xml" multiple hidden onChange={(e) => handleImport(e.target.files)} />
                <Button size="small" startIcon={<UploadFile />} onClick={() => fileRef.current?.click()}>Import diagram XML</Button>
                {!embedded && <IconButton onClick={onClose} size="small" aria-label="Close"><Close /></IconButton>}
        </>
    );
    const alert = importMsg && <Alert severity={importMsg.severity} onClose={() => setImportMsg(null)} sx={{ mx: 2, mb: 1 }}>{importMsg.text}</Alert>;
    const body = (
        <>
                {/* Category tree */}
                <Box sx={{ width: 250, flexShrink: 0, borderRight: 1, borderColor: 'divider', overflow: 'auto' }}>
                    <List dense disablePadding>
                        <TreeNode node={tree} depth={0} selected={folder} expanded={expanded} onSelect={setFolder} onToggle={toggle} />
                    </List>
                </Box>

                {/* Cards */}
                <Box sx={{ flex: 1, overflow: 'auto', p: 1.5 }}>
                    {visible.length === 0 ? (
                        <Typography color="text.secondary" sx={{ p: 2 }}>No diagrams match.</Typography>
                    ) : (
                        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(176px, 1fr))', gap: 1.5 }}>
                            {visible.map(e => {
                                const status = resolutionStatus(resolutionOf(e.id));
                                const isFocus = focus?.id === e.id;
                                return (
                                    <Box
                                        key={e.id} role="button" tabIndex={0} data-diagram-id={e.id}
                                        onClick={() => setFocusId(e.id)} onDoubleClick={() => choose(e.id)}
                                        onKeyDown={(ev) => { if (ev.key === 'Enter') choose(e.id); }}
                                        sx={{
                                            border: 2, borderRadius: 1, overflow: 'hidden', cursor: 'pointer', bgcolor: 'background.paper',
                                            borderColor: isFocus ? 'primary.main' : e.id === selectedId ? 'primary.light' : 'divider',
                                            '&:hover': { borderColor: isFocus ? 'primary.main' : 'text.secondary' },
                                        }}
                                    >
                                        <Thumb entry={e} height={138} />
                                        <Box sx={{ px: 1, py: 0.75, display: 'flex', gap: 0.75, alignItems: 'flex-start' }}>
                                            {numericNames.length > 0 && e.kind !== 'builtin' && (
                                                <Tooltip title={STATUS_TEXT[status]}>
                                                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: STATUS_COLOR[status], mt: 0.6, flexShrink: 0 }} />
                                                </Tooltip>
                                            )}
                                            <Typography variant="caption" sx={{ lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                                {e.name}
                                            </Typography>
                                        </Box>
                                    </Box>
                                );
                            })}
                        </Box>
                    )}
                </Box>

                {/* Detail pane */}
                <Box sx={{ width: 340, flexShrink: 0, borderLeft: 1, borderColor: 'divider', overflow: 'auto', p: 2 }}>
                    {focus ? (
                        <Stack spacing={1.5}>
                            <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
                                <Thumb entry={focus} height={250} />
                            </Box>
                            <Box>
                                <Typography variant="subtitle1" fontWeight={600} lineHeight={1.3}>{focus.name}</Typography>
                                <Typography variant="caption" color="text.secondary">
                                    {focus.category.join(' › ')} · {focus.kind === 'ternary' ? 'Ternary' : focus.kind === 'builtin' ? 'Native plot' : 'XY'}
                                </Typography>
                            </Box>
                            <Stack direction="row" spacing={1}>
                                <Button variant="contained" onClick={() => choose(focus.id)} sx={{ flex: 1 }}>Use diagram</Button>
                                {focus.custom && byId.get(focus.id) && (
                                    <>
                                        <Tooltip title="Edit in the diagram editor"><IconButton onClick={() => editCustom(byId.get(focus.id)!)}><EditIcon /></IconButton></Tooltip>
                                        <Tooltip title="Remove custom diagram"><IconButton onClick={() => removeCustom(focus.id)}><DeleteOutline /></IconButton></Tooltip>
                                    </>
                                )}
                            </Stack>

                            <Box>
                                <Typography variant="overline" color="text.secondary">Axes</Typography>
                                {(['x', 'y', 'a', 'b', 'c'] as const).filter(k => focus.diagram.axes[k]).map(k => {
                                    const ax = focus.diagram.axes[k]!;
                                    const res = focusResolution?.axes[k];
                                    const ok = !!res && (!!res.singleColumn || (res.isComputed && res.isFullyResolved));
                                    const missing = res?.variables.filter(v => v.status === 'missing').map(v => v.element) ?? [];
                                    return (
                                        <Box key={k} sx={{ mb: 0.75 }}>
                                            <Stack direction="row" spacing={0.75} alignItems="center">
                                                <Chip size="small" label={k.toUpperCase()} sx={{ height: 18, fontSize: '0.65rem' }} />
                                                <Typography variant="body2" fontWeight={500}><Chem text={ax.name} />{ax.log ? ' (log)' : ''}</Typography>
                                                {numericNames.length > 0 && (
                                                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: ok ? 'success.main' : missing.length && res?.variables.some(v => v.status !== 'missing') ? 'warning.main' : 'error.main' }} />
                                                )}
                                            </Stack>
                                            {ax.formula && (ax.kind === 'function' || ax.kind === 'freeFunction') && ax.formula.length > 1 && <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{ax.formula}</Typography>}
                                            {numericNames.length > 0 && missing.length > 0 && (
                                                <Typography variant="caption" color="warning.main" display="block">Missing: {missing.join(', ')}</Typography>
                                            )}
                                        </Box>
                                    );
                                })}
                            </Box>

                            {focus.diagram.variables.length > 0 && (
                                <Box>
                                    <Typography variant="overline" color="text.secondary">Inputs</Typography>
                                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                        {focus.diagram.variables.map(v => {
                                            const name = v.element ?? v.columnName ?? v.letter;
                                            const rv = focusResolution && Object.values(focusResolution.axes).flatMap(a => a.variables).find(x => x.element === name);
                                            const color = !numericNames.length || !rv ? 'default' : rv.status === 'missing' ? 'error' : rv.status === 'converted' ? 'warning' : 'success';
                                            return (
                                                <Tooltip key={v.letter + name} title={rv?.resolvedColumn ? `${rv.resolvedColumn}${rv.conversionDescription ? ` (${rv.conversionDescription})` : ''}` : ''}>
                                                    <Chip size="small" variant="outlined" color={color as 'default'} label={<span>{v.letter} = <Chem text={name} />{v.unit ? ` ${v.unit}` : ''}</span>} />
                                                </Tooltip>
                                            );
                                        })}
                                    </Box>
                                </Box>
                            )}

                            {focus.diagram.comments.length > 0 && (
                                <Box>
                                    <Typography variant="overline" color="text.secondary">Notes</Typography>
                                    {focus.diagram.comments.map((c, i) => <Typography key={i} variant="body2" sx={{ whiteSpace: 'pre-line' }}>{c}</Typography>)}
                                </Box>
                            )}
                            {focus.diagram.references.length > 0 && (
                                <Box>
                                    <Typography variant="overline" color="text.secondary">References</Typography>
                                    {focus.diagram.references.map((r, i) => <Typography key={i} variant="caption" display="block" sx={{ mb: 0.5 }}>{r}</Typography>)}
                                </Box>
                            )}
                        </Stack>
                    ) : (
                        <Typography color="text.secondary">Select a diagram to see its details.</Typography>
                    )}
                </Box>
        </>
    );

    if (embedded) {
        return (
            <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2, py: 1 }}>{header}</Box>
                {alert}
                <Box sx={{ display: 'flex', flex: 1, minHeight: 0, borderTop: 1, borderColor: 'divider' }}>{body}</Box>
            </Box>
        );
    }
    return (
        <Dialog open={open} onClose={onClose} maxWidth="xl" fullWidth PaperProps={{ sx: { height: '86vh' } }}>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 1 }}>{header}</DialogTitle>
            {alert}
            <DialogContent dividers sx={{ p: 0, display: 'flex', minHeight: 0 }}>{body}</DialogContent>
        </Dialog>
    );
};
