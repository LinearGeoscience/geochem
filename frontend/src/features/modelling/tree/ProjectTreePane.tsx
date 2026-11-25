/**
 * The project tree pane of the Modelling page: every object of the project
 * in its group and folder (features/model/projectTree), with what each is
 * built from linked under it.
 *
 * Click picks a row (Ctrl adds or takes away, Shift picks a run); what is
 * picked shows in the properties. A double-click opens a surface for editing
 * (again closes it). The eye shows and hides in the model view the tree acts
 * on (the one last used, named over the tree and chosen there when several
 * are open; Alt+click: only this). Over the tree too: show all, hide all,
 * open all, close all. Right-click for what can be done to the rows picked
 * (features/model/treeRules), Zoom to among it. Drag objects and folders into
 * folders, and sets of points or lines onto a surface to have it use them.
 *
 * Keys (tree focused): Up / Down move (Shift extends), Right / Left open and
 * close or go in and out, * opens everything under the row, Enter opens or
 * follows a link, Space shows or hides,
 * F2 renames, Delete deletes, Ctrl+A picks all, Esc clears the find box and
 * then the pick, Shift+F10 or the menu key opens the menu.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, Checkbox, Divider, FormControlLabel, InputAdornment, ListItemText, Menu, MenuItem, TextField, Tooltip, Typography } from '@mui/material';
import { Search } from '@mui/icons-material';
import { useViewVisibility } from '../../../hooks/useViewVisibility';
import { useDrillholeStore } from '../../../store/drillholeStore';
import { useModelStore } from '../../../store/modelStore';
import { activeModelView, useModellingStore } from '../../../store/modellingStore';
import { MESH_FORMATS } from '../../model/meshWriters';
import { keys as objectKeys, parseFolderKey, parseKey } from '../../model/objectKeys';
import { newIdOf } from '../../model/newObjects';
import { flattenTree, type TreeNode } from '../../model/projectTree';
import { exportObjects } from '../../model/geoModelActions';
import { exportKit } from '../../model/sceneActions';
import { exportModelKit } from '../../model/modelKitActions';
import {
    ancestorsOf, cannotDelete, dropFor, dropRefusal, eyeKeys, eyeOver, folderRootOf, menuFor, movedKey, newFolderPath, openableUnder, renamable, visKeysUnder,
    type TreeMenuItem,
} from '../../model/treeRules';
import { MODEL_PANEL_IDS, showModelPane } from '../modellingApi';
import { cannotMake, makeFromMenu } from '../newActions';
import { smallButton } from '../properties/styles';
import { boundsOfKeys, targetViewNow, useModelViewNames, zoomToKeys } from '../targetView';
import { ViewChooser } from '../ViewChooser';
import { applyDrop, modelsNotShownYet, renameKeepingPicks, requestDelete, setLocked } from './treeCommands';
import { ModelSetupStrip } from './ModelSetupStrip';
import { TreeRow, type Eye } from './TreeRow';
import { useProjectTree } from './useProjectTree';

/** Kinds of row that can be dragged */
const DRAGGABLE = new Set(['surface', 'inputs', 'readings', 'wireframe', 'folder', 'modelContact']);
const modelling = () => useModellingStore.getState();
/** Open a surface for editing, or close it when it is the one open (its settings are in the properties) */
function editSurface(key: string) {
    const id = parseKey(key)?.id;
    if (!id) return;
    const model = useModelStore.getState();
    model.setEditing(model.editingId === id ? null : id);
}
/** What a click on a row acts on: the rows picked when it is one of them, else that row */
const targetsIn = (selected: readonly string[], key: string): string[] => (selected.includes(key) ? [...selected] : [key]);

/** Every node of the tree by key, with the keys its eye covers */
function indexTree(tree: readonly TreeNode[]): { byKey: Map<string, TreeNode>; vis: Map<string, string[]> } {
    const byKey = new Map<string, TreeNode>(), vis = new Map<string, string[]>();
    const walk = (list: readonly TreeNode[]) => {
        for (const n of list) {
            byKey.set(n.key, n);
            vis.set(n.key, visKeysUnder(n));
            walk(n.children);
        }
    };
    walk(tree);
    return { byKey, vis };
}

export const ProjectTreePane: React.FC = () => {
    const tree = useProjectTree();
    const scene = useModelStore(s => s.scene);
    const editingSurface = useModelStore(s => s.editingId);
    const db = useDrillholeStore(s => s.db);
    const expanded = useModellingStore(s => s.expanded);
    const selected = useModellingStore(s => s.selected);
    const views = useModelViewNames();
    const activeId = useModellingStore(s => s.activeViewId);
    const view = activeModelView(views, activeId);
    const vis = useViewVisibility(view?.id ?? null);

    const [filter, setFilter] = useState('');
    const rows = useMemo(() => flattenTree(tree, new Set(expanded), filter), [tree, expanded, filter]);
    const index = useMemo(() => indexTree(tree), [tree]);
    const eyes = useMemo(() => {
        const out = new Map<string, Eye>();
        for (const r of rows) out.set(r.node.key, eyeOver(index.vis.get(r.node.key) ?? [], vis.hidden));
        return out;
    }, [rows, index, vis.hidden]);

    const [focusKey, setFocusKey] = useState<string | null>(null);
    const [editing, setEditing] = useState<string | null>(null);
    // Kept (closed) after it goes, so its items stay while it fades: an emptied menu takes the focus back to itself
    const [menu, setMenu] = useState<{ x: number; y: number; keys: string[]; exporting: boolean; open: boolean } | null>(null);
    const closeMenu = () => setMenu(m => (m ? { ...m, open: false } : m));
    const [drop, setDrop] = useState<{ key: string; label: string; refused?: boolean } | null>(null);
    const [note, setNote] = useState<string | null>(null);
    const anchor = useRef<string | null>(null);
    const pendingSingle = useRef<string | null>(null);
    const dragKeys = useRef<string[] | null>(null);
    const listRef = useRef<HTMLDivElement>(null);
    // The latest of everything, for the row callbacks (kept stable so rows do not re-render)
    const live = useRef({ rows, selected, index, tree, vis, scene, filter });
    live.current = { rows, selected, index, tree, vis, scene, filter };

    // The row with the focus is kept on screen
    // A model the tree has not shown before is shown open, down to its top, its faults and its age order: what is in it is seen
    const modelIds = (scene.models ?? []).map(m => m.id).join('\n');
    useEffect(() => {
        const fresh = modelsNotShownYet(modelIds ? modelIds.split('\n') : []);
        if (fresh.length === 0) return;
        const tree = useModellingStore.getState();
        tree.setExpanded([...new Set([...tree.expanded, objectKeys.root('models'), ...fresh.flatMap(id => [objectKeys.model(id), objectKeys.modelGroup(id, 'boundary'), objectKeys.modelGroup(id, 'faults'), objectKeys.modelGroup(id, 'chronology')])])]);
    }, [modelIds]);

    useEffect(() => {
        if (!focusKey) return;
        const el = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-key]') ?? [])].find(e => e.dataset.key === focusKey);
        el?.scrollIntoView?.({ block: 'nearest' });
    }, [focusKey, rows]);

    const focusTree = useCallback(() => listRef.current?.focus({ preventScroll: true }), []);
    const pick = useCallback((key: string) => {
        modelling().setSelected([key]);
        anchor.current = key;
        setFocusKey(key);
    }, []);
    const pickTo = useCallback((key: string) => {
        const list = live.current.rows.map(r => r.node.key);
        const a = anchor.current ? list.indexOf(anchor.current) : -1, b = list.indexOf(key);
        if (a < 0 || b < 0) { pick(key); return; }
        modelling().setSelected(list.slice(Math.min(a, b), Math.max(a, b) + 1));
        setFocusKey(key);
    }, [pick]);

    /** Open the nodes a node is in, and pick it */
    const goTo = useCallback((target: string) => {
        const up = ancestorsOf(live.current.tree, target);
        if (!up) return;
        const node = live.current.index.byKey.get(target);
        if (live.current.filter && node && !node.name.toLowerCase().includes(live.current.filter.trim().toLowerCase())) setFilter('');
        modelling().setExpanded([...new Set([...modelling().expanded, ...up])]);
        pick(target);
    }, [pick]);

    // Picked in a view: its row comes into sight (and out from under a filter) and is where the keys go on from
    const reveal = useModellingStore(s => s.reveal);
    useEffect(() => {
        if (!reveal) return;
        const node = live.current.index.byKey.get(reveal.key);
        if (live.current.filter && node && !node.name.toLowerCase().includes(live.current.filter.trim().toLowerCase())) setFilter('');
        anchor.current = reveal.key;
        setFocusKey(reveal.key);
    }, [reveal]);

    const toggle = useCallback((key: string) => modelling().toggleExpanded(key), []);

    // ---- rows -------------------------------------------------------------------------
    const onMouseDown = useCallback((key: string, e: React.MouseEvent) => {
        if (e.button !== 0) return;
        focusTree();
        pendingSingle.current = null;
        const { selected: sel } = live.current;
        if (e.ctrlKey || e.metaKey) {
            modelling().setSelected(sel.includes(key) ? sel.filter(k => k !== key) : [...sel, key]);
            anchor.current = key;
            setFocusKey(key);
        } else if (e.shiftKey) pickTo(key);
        // A row of several picked: wait for the click, it may be the start of a drag of them all
        else if (sel.includes(key) && sel.length > 1) { pendingSingle.current = key; setFocusKey(key); }
        else pick(key);
    }, [focusTree, pick, pickTo]);

    const onClick = useCallback((key: string) => {
        if (pendingSingle.current === key) pick(key);
        pendingSingle.current = null;
    }, [pick]);

    const onDoubleClick = useCallback((key: string) => {
        const node = live.current.index.byKey.get(key);
        if (node?.link) goTo(node.link.target);
        // A surface opens for editing (its settings fill the properties)
        else if (node?.kind === 'surface' && !node.made) editSurface(key);
        else if (node && node.children.length) toggle(key);
    }, [goTo, toggle]);

    const onEye = useCallback((key: string, e?: React.MouseEvent) => {
        const { vis: v, index: idx, selected: sel } = live.current;
        if (!v.plotId) return;
        const covered = [...new Set(targetsIn(sel, key).flatMap(k => idx.vis.get(k) ?? []))];
        if (!covered.length) return;
        // Alt+click: this, and nothing else
        if (e?.altKey) { v.showOnly(eyeKeys(covered)); return; }
        // Shown: what a view shows unless told not to. Hidden: everything it covers
        const show = eyeOver(idx.vis.get(key) ?? [], v.hidden) !== 'shown';
        v.setShown(show ? eyeKeys(covered) : covered, show);
    }, []);

    const onLock = useCallback((key: string) => {
        const { index: idx, selected: sel } = live.current;
        const node = idx.byKey.get(key);
        if (!node) return;
        setLocked(targetsIn(sel, key).filter(k => idx.byKey.get(k)?.lockable), !node.locked);
    }, []);

    const onContextMenu = useCallback((key: string, e: React.MouseEvent) => {
        e.preventDefault();
        const targets = targetsIn(live.current.selected, key);
        if (!live.current.selected.includes(key)) pick(key);
        else setFocusKey(key);
        setMenu({ x: e.clientX, y: e.clientY, keys: targets, exporting: false, open: true });
    }, [pick]);

    // ---- rename -----------------------------------------------------------------------
    const onCommitName = useCallback((key: string, name: string | null) => {
        setEditing(null);
        focusTree();
        const node = live.current.index.byKey.get(key);
        if (name === null || !node || name.trim() === node.name) return;
        const next = renameKeepingPicks(key, name);
        if (next && next !== key) {
            anchor.current = next;
            setFocusKey(next);
        }
    }, [focusTree]);

    // ---- drag and drop ----------------------------------------------------------------
    const onDragStart = useCallback((key: string, e: React.DragEvent) => {
        const { index: idx, selected: sel } = live.current;
        const dragged = targetsIn(sel, key).filter(k => DRAGGABLE.has(idx.byKey.get(k)?.kind ?? ''));
        if (!dragged.length) { e.preventDefault(); return; }
        pendingSingle.current = null;
        dragKeys.current = dragged;
        e.dataTransfer.effectAllowed = 'all';
        e.dataTransfer.setData('text/plain', dragged.map(k => idx.byKey.get(k)?.name ?? k).join('\n'));
    }, []);

    const onDragOver = useCallback((key: string, e: React.DragEvent) => {
        const dragged = dragKeys.current;
        const node = live.current.index.byKey.get(key);
        const d = dragged && node ? dropFor(live.current.scene, dragged, node) : null;
        if (!d) {
            // The dock takes every drag over it (dockview's drop targets): saying 'none' is what refuses it here
            if (dragged) e.dataTransfer.dropEffect = 'none';
            // Where the drop could have been meant, the row says why it is not taken
            const why = dragged && node ? dropRefusal(live.current.scene, dragged, node) : null;
            setDrop(prev => (!why ? null : prev?.key === key && prev.label === why ? prev : { key, label: why, refused: true }));
            return;
        }
        e.preventDefault();
        e.dataTransfer.dropEffect = d.kind === 'use' ? 'link' : 'move';
        setDrop(prev => (prev?.key === key && prev.label === d.label ? prev : { key, label: d.label }));
    }, []);

    const onDrop = useCallback((key: string, e: React.DragEvent) => {
        e.preventDefault();
        const dragged = dragKeys.current;
        dragKeys.current = null;
        setDrop(null);
        const node = live.current.index.byKey.get(key);
        const d = dragged && node ? dropFor(live.current.scene, dragged, node) : null;
        if (!d) return;
        const into = applyDrop(d);
        if (d.kind === 'file') {
            // Folders moved have new keys: what was open and picked follows them
            const move = (k: string) => d.folders.reduce((acc, f) => movedKey(acc, d.root, f.from, f.to), k);
            modelling().setExpanded([...new Set([...modelling().expanded.map(move), ...(into ? [into, ...(ancestorsOf(live.current.tree, into) ?? [])] : [])])]);
            modelling().setSelected(modelling().selected.map(move));
        } else if (d.kind === 'toModel') {
            // What was given to the model is seen where it now is: its part of the model is opened
            modelling().setExpanded([...new Set([...modelling().expanded, objectKeys.root('models'), objectKeys.model(d.model), objectKeys.modelGroup(d.model, d.as === 'fault' ? 'faults' : 'chronology')])]);
        } else if (d.kind === 'use') {
            modelling().setExpanded([...new Set([...modelling().expanded, key])]);
        }
    }, []);

    // ---- what the menu and the keys do ---------------------------------------------------
    const newFolder = (node: TreeNode) => {
        const root = folderRootOf(node.key);
        if (!root) return;
        const parent = parseFolderKey(node.key)?.path ?? null;
        const path = newFolderPath(live.current.scene, root, parent);
        useModelStore.getState().addFolder(root, path);
        modelling().setExpanded([...new Set([...modelling().expanded, node.key])]);
        const key = objectKeys.folder(root, path);
        pick(key);
        setEditing(key);
    };

    const askDelete = (targets: string[]) => {
        const nodes = targets.map(k => live.current.index.byKey.get(k)).filter((n): n is TreeNode => !!n);
        if (!nodes.length || nodes.some(n => n.kind === 'link' || n.kind === 'root' || cannotDelete(n, live.current.scene))) return;
        // (Asked about in the one dialog of the app; removing folders takes nothing with it, and is not asked about)
        const why = requestDelete(targets);
        if (why) setNote(why);
    };

    /** Open, or close, some rows and every row under them */
    const openUnder = (nodes: readonly TreeNode[], open: boolean) => {
        const under = openableUnder(nodes);
        const shut = new Set(under);
        modelling().setExpanded(open ? [...new Set([...modelling().expanded, ...under])] : modelling().expanded.filter(k => !shut.has(k)));
    };

    const run = (item: TreeMenuItem, targets: string[]) => {
        const nodes = targets.map(k => live.current.index.byKey.get(k)).filter((n): n is TreeNode => !!n);
        const covered = [...new Set(targets.flatMap(k => index.vis.get(k) ?? []))];
        const surfaces = () => targets.map(k => parseKey(k)!.id);
        closeMenu();
        // A new thing: made as it is from its group's buttons and the page's New menu
        const made = newIdOf(item.action);
        if (made) { makeFromMenu(made, targetViewNow()); return; }
        if (item.action !== 'rename' && item.action !== 'newFolder') focusTree();
        switch (item.action) {
            case 'goTo': if (nodes[0]?.link) goTo(nodes[0].link.target); break;
            case 'edit': editSurface(targets[0]); break;
            case 'newFolder': if (nodes[0]) newFolder(nodes[0]); break;
            case 'rename': setEditing(targets[0]); break;
            case 'openAll': openUnder(nodes, true); break;
            case 'closeAll': openUnder(nodes, false); break;
            case 'properties': showModelPane(MODEL_PANEL_IDS.properties); break;
            case 'zoomTo': zoomToKeys(view?.id ?? null, targets); break;
            case 'show': vis.setShown(eyeKeys(covered), true); break;
            case 'hide': vis.setShown(covered, false); break;
            case 'showOnly': vis.showOnly(eyeKeys(covered)); break;
            case 'lock': setLocked(targets, true); break;
            case 'unlock': setLocked(targets, false); break;
            case 'moveOut': useModelStore.getState().moveToFolder(targets, null); break;
            case 'export': break; // the menu shows the formats instead
            case 'kit':
                if (nodes[0]?.kind === 'model') exportModelKit(targets[0].slice('model:'.length));
                else if (!exportKit(surfaces()[0])) setNote('There is nothing to put in a Leapfrog export yet.');
                break;
            case 'delete': askDelete(targets); break;
        }
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (editing) return;
        const list = rows.map(r => r.node.key);
        const cur = focusKey ? list.indexOf(focusKey) : -1;
        const row = cur >= 0 ? rows[cur] : null;
        const handled = () => { e.preventDefault(); e.stopPropagation(); };
        const go = (key: string | undefined) => {
            if (!key) return;
            if (e.shiftKey) pickTo(key);
            else pick(key);
        };
        if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
            handled();
            if (!row) return;
            const el = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-key]') ?? [])].find(x => x.dataset.key === row.node.key);
            const r = el?.getBoundingClientRect();
            setMenu({ x: (r?.left ?? 0) + 24, y: (r?.bottom ?? 0), keys: targetsIn(selected, row.node.key), exporting: false, open: true });
            return;
        }
        switch (e.key) {
            case 'ArrowDown': handled(); go(cur < 0 ? list[0] : list[Math.min(list.length - 1, cur + 1)]); return;
            case 'ArrowUp': handled(); go(cur < 0 ? list[0] : list[Math.max(0, cur - 1)]); return;
            case 'Home': handled(); go(list[0]); return;
            case 'End': handled(); go(list[list.length - 1]); return;
            case 'ArrowRight':
                handled();
                if (!row?.hasChildren) return;
                if (!row.open) toggle(row.node.key);
                else go(list[cur + 1]);
                return;
            case 'ArrowLeft':
                handled();
                if (!row) return;
                if (row.open) toggle(row.node.key);
                else if (row.path.length) go(row.path[row.path.length - 1]);
                return;
            case 'Enter':
                handled();
                if (row?.node.link) goTo(row.node.link.target);
                else if (row?.hasChildren) toggle(row.node.key);
                return;
            case 'F2':
                handled();
                if (row && renamable(row.node)) setEditing(row.node.key);
                return;
            case 'Delete':
                handled();
                askDelete(selected.length ? selected : row ? [row.node.key] : []);
                return;
            case ' ':
                handled();
                if (row) onEye(row.node.key);
                return;
            case '*':
                handled();
                if (row) openUnder([row.node], true);
                return;
            case 'Escape':
                if (filter) { handled(); setFilter(''); } else if (selected.length) { handled(); modelling().setSelected([]); }
                return;
            case 'a': case 'A':
                if (e.ctrlKey || e.metaKey) {
                    handled();
                    modelling().setSelected(rows.filter(r => r.node.kind !== 'root' && r.node.kind !== 'link' && r.node.kind !== 'note').map(r => r.node.key));
                }
                return;
        }
    };

    // ---- the menu ------------------------------------------------------------------------
    const menuNodes = menu ? menu.keys.map(k => index.byKey.get(k)).filter((n): n is TreeNode => !!n) : [];
    const items = menu && !menu.exporting
        ? menuFor(menuNodes, { scene, db, view: view ? { title: view.title, hidden: vis.hidden } : null, editing: editingSurface, framed: boundsOfKeys(menu.keys) !== null, cannotMake: id => cannotMake(id, targetViewNow()), open: new Set(expanded) })
        : [];
    // Everything the tree's eyes cover, and every row that opens
    const everything = useMemo(() => ({ vis: [...new Set(tree.flatMap(visKeysUnder))], open: openableUnder(tree) }), [tree]);
    const noView = 'Open a 3D view to show and hide objects in it.';
    const full = useModellingStore(s => s.treeFull);
    const selSet = useMemo(() => new Set(selected), [selected]);
    const viewTitle = view?.title ?? null;

    return (
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'background.paper' }}>
            <ModelSetupStrip />
            <Box sx={{ px: 1, pt: 0.75, pb: 0.5 }}>
                <TextField
                    size="small" fullWidth placeholder="Find" value={filter}
                    onChange={e => setFilter(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Escape') { setFilter(''); e.stopPropagation(); }
                        if (e.key === 'ArrowDown') { e.preventDefault(); focusTree(); if (rows[0]) pick(rows[0].node.key); }
                    }}
                    inputProps={{ 'aria-label': 'Find in the project tree' }}
                    InputProps={{ startAdornment: <InputAdornment position="start"><Search sx={{ fontSize: 16 }} /></InputAdornment>, sx: { fontSize: 13, height: 28 } }}
                />
            </Box>
            <Box data-testid="tree-bar" sx={{ px: 1, pb: 0.25 }}>
                {view
                    ? <ViewChooser says="Eyes show and hide in" label="The view the eyes act on" viewId={view.id} title={view.title} />
                    : <Typography variant="caption" color="text.secondary" component="div">{noView}</Typography>}
                <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 0.5 }}>
                    <Tooltip title={view ? `Show everything in ${view.title}` : noView} enterDelay={600}>
                        <span><Button size="small" sx={smallButton} data-action="show-all" disabled={!view} onClick={() => vis.setShown(eyeKeys(everything.vis), true)}>Show all</Button></span>
                    </Tooltip>
                    <Tooltip title={view ? `Hide everything in ${view.title}` : noView} enterDelay={600}>
                        <span><Button size="small" sx={smallButton} data-action="hide-all" disabled={!view} onClick={() => vis.setShown(everything.vis, false)}>Hide all</Button></span>
                    </Tooltip>
                    <Box sx={{ flex: 1 }} />
                    <Tooltip describeChild title="Open every row of the tree, all the way down" enterDelay={600}>
                        <Button size="small" sx={smallButton} data-action="open-all" onClick={() => modelling().setExpanded(everything.open)}>Open all</Button>
                    </Tooltip>
                    <Tooltip describeChild title="Close every row of the tree" enterDelay={600}>
                        <Button size="small" sx={smallButton} data-action="close-all" onClick={() => modelling().setExpanded([])}>Close all</Button>
                    </Tooltip>
                </Box>
                <Tooltip describeChild enterDelay={600} title="Under each thing, also what is set on it and was placed on it by hand, everything it follows or is kept inside, and what uses it. Off: only what it is built from.">
                    <FormControlLabel
                        sx={{ m: 0, display: 'flex', '& .MuiFormControlLabel-label': { fontSize: 12, color: 'text.secondary' } }}
                        control={<Checkbox size="small" sx={{ p: 0.25, mr: 0.5 }} checked={full} onChange={(_, on) => modelling().setTreeFull(on)} data-action="tree-full" />}
                        label="Each thing in full: what is set on it, what uses it"
                    />
                </Tooltip>
            </Box>
            {note && <Alert severity="info" onClose={() => setNote(null)} sx={{ mx: 1, mb: 0.5, py: 0, '& .MuiAlert-message': { fontSize: 12 } }}>{note}</Alert>}
            <Box
                ref={listRef}
                role="tree"
                aria-label="Project tree"
                aria-multiselectable
                tabIndex={0}
                onKeyDown={onKeyDown}
                onFocus={() => { if (!focusKey && rows[0]) setFocusKey(selected[0] ?? rows[0].node.key); }}
                onDragEnd={() => { dragKeys.current = null; setDrop(null); }}
                onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null); }}
                sx={{ flex: 1, minHeight: 0, overflow: 'auto', pb: 1, outline: 'none' }}
            >
                {rows.map(row => (
                    <TreeRow
                        key={row.node.key}
                        row={row}
                        selected={selSet.has(row.node.key)}
                        focused={focusKey === row.node.key}
                        editing={editing === row.node.key}
                        eye={eyes.get(row.node.key) ?? null}
                        viewTitle={viewTitle}
                        draggable={DRAGGABLE.has(row.node.kind)}
                        dropHint={drop?.key === row.node.key ? drop.label : null}
                        dropRefused={drop?.key === row.node.key && !!drop.refused}
                        onMouseDown={onMouseDown}
                        onClick={onClick}
                        onToggle={toggle}
                        onEye={onEye}
                        onLock={onLock}
                        onContextMenu={onContextMenu}
                        onDoubleClick={onDoubleClick}
                        onCommitName={onCommitName}
                        onDragStart={onDragStart}
                        onDragOver={onDragOver}
                        onDrop={onDrop}
                    />
                ))}
                {rows.length === 0 && (
                    <Typography variant="caption" color="text.secondary" component="div" sx={{ px: 1.5, py: 1 }}>
                        Nothing in the project is called that.
                    </Typography>
                )}
            </Box>

            <Menu
                open={!!menu?.open}
                onClose={() => { closeMenu(); focusTree(); }}
                // Focus goes where the item puts it (a name box, a dialog or the tree): the closing menu neither
                // puts it back nor pulls it in (its trap still listens while the name box takes it), as a name box
                // that lost it would end the rename at once
                disableRestoreFocus
                disableEnforceFocus
                anchorReference="anchorPosition"
                anchorPosition={menu ? { top: menu.y, left: menu.x } : undefined}
                MenuListProps={{ dense: true, 'aria-label': 'What to do with it' }}
                slotProps={{ paper: { sx: { minWidth: 220, maxWidth: 320 } } }}
            >
                {menu?.exporting
                    ? MESH_FORMATS.map(f => (
                        <MenuItem
                            key={f.format}
                            onClick={() => {
                                const picked = menu.keys;
                                closeMenu();
                                focusTree();
                                if (!exportObjects(picked, f.format)) setNote('Nothing to export yet: no mesh has been fitted or built.');
                            }}
                        >
                            <ListItemText primary={`${f.label} (.${f.format})`} />
                        </MenuItem>
                    ))
                    : items.flatMap((item, i) => [
                        i > 0 && items[i - 1].group !== item.group ? <Divider key={`line-${i}`} /> : null,
                        <MenuItem
                            key={item.action}
                            data-action={item.action}
                            disabled={!!item.disabled}
                            onClick={() => (item.action === 'export' ? setMenu({ ...menu!, exporting: true }) : run(item, menu!.keys))}
                        >
                            <ListItemText
                                primary={item.label}
                                secondary={item.disabled}
                                secondaryTypographyProps={{ sx: { whiteSpace: 'normal', fontSize: 11 } }}
                            />
                            {item.shortcut && <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>{item.shortcut}</Typography>}
                        </MenuItem>,
                    ])}
            </Menu>
        </Box>
    );
};
