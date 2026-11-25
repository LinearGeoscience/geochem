/**
 * The Scene tab of the Modelling page: what the view draws, as a list in
 * groups (features/model/sceneList), and how. Each row: an eye (shown or
 * hidden in that view), its colour, its name (a click picks it, as in the
 * tree) and, for a mesh, how it is drawn there: solid, with its edges, its
 * edges only or its outline; how see-through; whether a slice cuts it
 * (features/model/viewDisplay). A group's own row acts on all of it. The
 * view it speaks of is the one the tree's eyes act on, chosen at the top
 * when more than one is open.
 *
 * It sits under the views, the width of them (moved anywhere as any pane
 * is). Wide, it is laid out across: its top in one line, and each row its
 * name in a column then every choice as a button, none in a menu. Narrow (at
 * a side) the choices are in menus.
 */
import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, Checkbox, FormControlLabel, IconButton, Tooltip, Typography } from '@mui/material';
import { ChevronRight, ExpandMore, Visibility, VisibilityOff, VisibilityOutlined } from '@mui/icons-material';
import { useViewDisplay, type ViewDisplayState } from '../../../hooks/useViewDisplay';
import { useViewVisibility, type ViewVisibility } from '../../../hooks/useViewVisibility';
import { useModelStore } from '../../../store/modelStore';
import { useModellingStore } from '../../../store/modellingStore';
import { keys, parseKey } from '../../model/objectKeys';
import { MODEL_PART_LOOK, ownLookOf, sceneList, type SceneGroup, type SceneRow } from '../../model/sceneList';
import { eyeKeys, eyeOver } from '../../model/treeRules';
import { pickFromView } from '../../model/treePicks';
import type { ModelScene } from '../../model/types';
import { DisplayControls, type Shown } from '../properties/DisplayControls';
import { RowColouredBy } from './ColouredBy';
import { smallButton } from '../properties/styles';
import { useModelViewNames, useTargetView } from '../targetView';
import { ViewChooser } from '../ViewChooser';
import { STATUS } from '../tree/statusLook';
import { useProjectTree } from '../tree/useProjectTree';

/** A row's height: an eye and a name you can hit (Phase 303: was 26) */
const ROW = 32;
/** At this width and over the list is laid out across */
export const ACROSS_WIDTH = 600;
/** Across: the width of the column of names (the eyes, colours and names; a group's name and count) */
const NAMES = 260;

/** The width of what the ref is put on, as it changes (0 until it is laid out) */
function useWidth(): [React.RefObject<HTMLDivElement>, number] {
    const ref = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(0);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const seen = new ResizeObserver(e => setWidth(Math.round(e[0]?.contentRect.width ?? 0)));
        seen.observe(el);
        return () => seen.disconnect();
    }, []);
    return [ref, width];
}

/** The objects of some rows that are drawn as meshes, each with its own look */
const meshesOf = (scene: ModelScene, rows: readonly SceneRow[]): Shown[] =>
    rows.filter(r => r.mesh).map(r => ({ key: r.visKey, own: ownLookOf(scene, r.visKey) ?? MODEL_PART_LOOK }));

/** An eye: shown, hidden, or some of each (several objects) */
const Eye: React.FC<{ state: 'shown' | 'hidden' | 'some'; name: string; viewTitle: string | null; onClick: (e: React.MouseEvent) => void }> = ({ state, name, viewTitle, onClick }) => {
    const where = viewTitle ? ` in ${viewTitle}` : '';
    const label = state === 'shown' ? `Hide ${name}${where}` : `Show ${name}${where}`;
    return (
        <Tooltip title={viewTitle ? `${label} (Alt+click: show only this)` : 'Open a 3D view to show and hide objects in it.'} enterDelay={600}>
            <span>
                <IconButton size="small" disabled={!viewTitle} aria-label={label} aria-pressed={state !== 'hidden'} data-eye={state} onClick={onClick} sx={{ p: 0.5 }}>
                    {state === 'shown' ? <Visibility sx={{ fontSize: 20 }} color="primary" /> : state === 'some' ? <VisibilityOutlined sx={{ fontSize: 20 }} color="primary" /> : <VisibilityOff sx={{ fontSize: 20, opacity: 0.55 }} />}
                </IconButton>
            </span>
        </Tooltip>
    );
};

/** Its colour: changed here where the colour is the object's own (a surface, a mesh from a file) */
const Chip: React.FC<{ row: SceneRow }> = ({ row }) => {
    const parsed = parseKey(row.visKey);
    const own = parsed?.kind === 'surface' || parsed?.kind === 'wireframe';
    if (!row.color) return <Box sx={{ width: 18, flexShrink: 0 }} />;
    if (!own) return <Box component="span" sx={{ width: 18, height: 18, flexShrink: 0, bgcolor: row.color, border: 1, borderColor: 'divider', borderRadius: 0.5 }} />;
    return (
        <Tooltip title="Its colour" enterDelay={600}>
            <Box
                component="input" type="color" value={row.color} aria-label={`Colour of ${row.name}`}
                onClick={(e: React.MouseEvent) => e.stopPropagation()}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    const model = useModelStore.getState();
                    if (parsed.kind === 'surface') model.updateSurface(parsed.id, { color: e.target.value });
                    else model.updateWireframe(parsed.id, { color: e.target.value });
                }}
                sx={{
                    width: 18, height: 18, p: 0, border: 1, borderColor: 'divider', borderRadius: 0.5, bgcolor: 'transparent', cursor: 'pointer', flexShrink: 0, appearance: 'none', overflow: 'hidden',
                    '&::-webkit-color-swatch-wrapper': { p: 0 }, '&::-webkit-color-swatch': { border: 'none' }, '&::-moz-color-swatch': { border: 'none' },
                }}
            />
        </Tooltip>
    );
};

interface RowProps {
    row: SceneRow;
    scene: ModelScene;
    picked: boolean;
    vis: ViewVisibility;
    view: ViewDisplayState;
    viewTitle: string | null;
    across: boolean;
}

const Row: React.FC<RowProps> = ({ row, scene, picked, vis, view, viewTitle, across }) => {
    const hidden = vis.hidden.has(row.visKey);
    const meshes = useMemo(() => meshesOf(scene, [row]), [scene, row]);
    const status = row.status ? STATUS[row.status] : null;
    return (
        <Box
            role="listitem" data-key={row.key} data-shown={!hidden} aria-current={picked || undefined}
            sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minHeight: ROW, pl: 2.5, pr: 0.5, bgcolor: picked ? 'action.selected' : undefined, '&:hover': { bgcolor: picked ? 'action.selected' : 'action.hover' } }}
        >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0, ...(across ? { flex: `0 0 ${NAMES - 20}px` } : { flex: 1 }) }}>
            <Eye
                state={hidden ? 'hidden' : 'shown'} name={row.name} viewTitle={viewTitle}
                onClick={e => { if (e.altKey) vis.showOnly([row.visKey]); else vis.setShown([row.visKey], hidden); }}
            />
            <Chip row={row} />
            <Tooltip title={row.detail ? `${row.name}: ${row.detail}` : row.name} enterDelay={800}>
                <Typography
                    component="button" type="button" variant="body2" noWrap data-action="pick"
                    onClick={(e: React.MouseEvent) => pickFromView(row.key, e.ctrlKey || e.metaKey)}
                    sx={{
                        flex: 1, minWidth: 0, textAlign: 'left', fontSize: 14, border: 'none', bgcolor: 'transparent', p: 0, cursor: 'pointer', font: 'inherit', color: 'inherit',
                        opacity: hidden ? 0.55 : 1,
                    }}
                >
                    {row.name}
                </Typography>
            </Tooltip>
            {status && (
                <Tooltip title={row.said ?? ''}>
                    <status.Icon aria-label={row.said} data-status={row.status} sx={{ fontSize: 15, flexShrink: 0, color: status.color }} />
                </Tooltip>
            )}
            </Box>
            <RowColouredBy row={row} />
            {meshes.length > 0 && <DisplayControls dense={!across} across={across} objects={meshes} name={row.name} view={view} />}
        </Box>
    );
};

interface GroupProps {
    group: SceneGroup;
    rows: readonly SceneRow[];
    open: boolean;
    onToggle: () => void;
    scene: ModelScene;
    picked: ReadonlySet<string>;
    vis: ViewVisibility;
    view: ViewDisplayState;
    viewTitle: string | null;
    across: boolean;
}

const Group: React.FC<GroupProps> = ({ group, rows, open, onToggle, scene, picked, vis, view, viewTitle, across }) => {
    const all = group.rows.map(r => r.visKey);
    const state = eyeOver(all, vis.hidden) ?? 'hidden';
    const meshes = useMemo(() => meshesOf(scene, group.rows), [scene, group.rows]);
    const shown = group.rows.filter(r => !vis.hidden.has(r.visKey)).length;
    return (
        <Box role="group" aria-label={group.title} data-group={group.key}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minHeight: ROW, pr: 0.5, bgcolor: 'action.hover', borderTop: 1, borderColor: 'divider' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0, ...(across ? { flex: `0 0 ${NAMES}px` } : { flex: 1 }) }}>
                <IconButton size="small" aria-label={open ? `Close ${group.title}` : `Open ${group.title}`} aria-expanded={open} onClick={onToggle} sx={{ p: 0.25 }}>
                    {open ? <ExpandMore sx={{ fontSize: 20 }} /> : <ChevronRight sx={{ fontSize: 20 }} />}
                </IconButton>
                <Eye
                    state={state} name={`all of ${group.title}`} viewTitle={viewTitle}
                    onClick={e => {
                        if (e.altKey) vis.showOnly(eyeKeys(all));
                        // Shown: what a view shows unless told not to. Hidden: everything of the group
                        else if (state === 'shown') vis.setShown(all, false);
                        else vis.setShown(eyeKeys(all), true);
                    }}
                />
                <Tooltip title={group.title} enterDelay={800}>
                    <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
                        <Typography variant="body2" noWrap sx={{ fontSize: 14, fontWeight: 600, flexShrink: 0 }}>{group.part ?? group.title}</Typography>
                        {/* (The part keeps its width: the model's name gives way first) */}
                        {group.of && <Typography variant="caption" color="text.secondary" noWrap sx={{ minWidth: 0 }}>{group.of}</Typography>}
                    </Box>
                </Tooltip>
                <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }} data-testid="group-count">{`${shown} of ${group.rows.length}`}</Typography>
                </Box>
                {meshes.length > 1 && <DisplayControls dense={!across} across={across} objects={meshes} name={`all of ${group.title}`} view={view} />}
            </Box>
            {open && (
                <Box role="list" aria-label={group.title}>
                    {rows.map(r => <Row key={r.visKey} row={r} scene={scene} picked={picked.has(r.key)} vis={vis} view={view} viewTitle={viewTitle} across={across} />)}
                    {rows.length === 0 && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', pl: 3, py: 0.5 }}>Nothing of it is shown.</Typography>}
                </Box>
            )}
        </Box>
    );
};

export const ScenePane: React.FC = () => {
    const tree = useProjectTree();
    const scene = useModelStore(s => s.scene);
    // (The global trend is drawn once there is one)
    const trend = !!scene.structure?.overall;
    const groups = useMemo(() => sceneList(tree).map(g => (trend ? g : { ...g, rows: g.rows.filter(r => r.visKey !== keys.structure) })).filter(g => g.rows.length > 0), [tree, trend]);
    const views = useModelViewNames();
    const target = useTargetView();
    const vis = useViewVisibility(target.id);
    const view = useViewDisplay(target.id);
    const selected = useModellingStore(s => s.selected);
    const picked = useMemo(() => new Set(selected), [selected]);
    const [shownOnly, setShownOnly] = useState(false);
    const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
    const [paneRef, width] = useWidth();
    const across = width >= ACROSS_WIDTH;

    const all = useMemo(() => groups.flatMap(g => g.rows.map(r => r.visKey)), [groups]);
    const shown = all.filter(k => !vis.hidden.has(k)).length;
    const own = all.filter(k => view.display[k]);

    return (
        <Box ref={paneRef} data-testid="scene-pane" data-across={across} sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <Box sx={{ px: 1, pt: across ? 0.25 : 0.75, pb: across ? 0.25 : 0.5, flexShrink: 0, ...(across ? { display: 'flex', alignItems: 'center', columnGap: 1.5, flexWrap: 'wrap' } : {}) }}>
                {views.length === 0 || !target.id ? (
                    <Typography variant="body2" color="text.secondary">Open a 3D view (New 3D view) to see what it draws, and how.</Typography>
                ) : (
                    <>
                        <ViewChooser says="What is drawn in" label="The view the list speaks of" viewId={target.id} title={target.title ?? ''} />
                        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 0.5, ...(across ? { flex: 1, minWidth: 0 } : { mt: 0.25 }) }}>
                            <Button size="small" sx={smallButton} data-action="show-all" onClick={() => vis.setShown(eyeKeys(all), true)}>Show all</Button>
                            <Button size="small" sx={smallButton} data-action="hide-all" onClick={() => vis.setShown(all, false)}>Hide all</Button>
                            <Tooltip title="Draw everything as it is in itself again: what this view draws its own way (outlines, edges, opacity, whole on a slice) is let go">
                                <span>
                                    <Button size="small" sx={smallButton} data-action="own-looks" disabled={own.length === 0} onClick={() => view.set(own, null)}>As they are</Button>
                                </span>
                            </Tooltip>
                            <Box sx={{ flex: 1 }} />
                            <FormControlLabel
                                sx={{ mr: 0 }} control={<Checkbox size="small" sx={{ p: 0.25 }} checked={shownOnly} onChange={e => setShownOnly(e.target.checked)} />}
                                label={<Typography variant="caption">Only what is shown</Typography>}
                            />
                        </Box>
                        <Typography variant="caption" color="text.secondary" data-testid="scene-count" sx={{ display: 'block', ...(across ? { flexShrink: 0 } : {}) }}>{`${shown} of ${all.length} shown`}</Typography>
                    </>
                )}
            </Box>
            <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
                {groups.map(g => {
                    const rows = shownOnly ? g.rows.filter(r => !vis.hidden.has(r.visKey)) : g.rows;
                    if (shownOnly && rows.length === 0) return null;
                    return (
                        <Group
                            key={g.key} group={g} rows={rows} open={!closed.has(g.key)} scene={scene} picked={picked} vis={vis} view={view} viewTitle={target.id ? target.title : null} across={across}
                            onToggle={() => setClosed(prev => { const next = new Set(prev); if (next.has(g.key)) next.delete(g.key); else next.add(g.key); return next; })}
                        />
                    );
                })}
                {groups.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>The project has nothing to draw yet.</Typography>}
            </Box>
        </Box>
    );
};

export default ScenePane;
