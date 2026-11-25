/**
 * What of the model a plot shows, ticked on and off for that plot only. The
 * model is made and changed on the Modelling page; a plot only looks at it,
 * so each row can take you there with the object picked.
 */
import React, { useMemo, useState } from 'react';
import { Alert, Box, Button, Checkbox, IconButton, Paper, Popover, Tooltip, Typography } from '@mui/material';
import { Close, OpenInNew } from '@mui/icons-material';
import { useDrillholeStore } from '../../../store/drillholeStore';
import { useModelStore } from '../../../store/modelStore';
import { useModelCache } from '../../model/modelCache';
import { keys } from '../../model/objectKeys';
import { buildProjectTree, type TreeNode } from '../../model/projectTree';
import { openInModelling } from '../../model/treePicks';
import type { ViewVisibility } from '../../../hooks/useViewVisibility';

/** The groups a 3D plot lists (its meshes are listed with their import, below) and those a 2D plot draws */
const PLOT_3D_GROUPS = ['structure', 'points', 'lines', 'surfaces'] as const;
const PLOT_2D_GROUPS = ['surfaces', 'meshes'] as const;

interface Row { key: string; name: string; folder: string | null; color?: string }

/** The objects of a group that can be shown or hidden, folders flattened (their path kept) */
function rowsOf(node: TreeNode, folder: string | null = null): Row[] {
    const out: Row[] = [];
    for (const c of node.children) {
        if (c.kind === 'folder') out.push(...rowsOf(c, folder ? `${folder}/${c.name}` : c.name));
        else if (c.kind !== 'link' && c.visKey) out.push({ key: c.visKey, name: c.name, folder, color: c.color });
    }
    return out;
}

export const ShownObjectsList: React.FC<{ visibility: ViewVisibility; groups: readonly string[] }> = ({ visibility, groups }) => {
    const scene = useModelStore(s => s.scene);
    const db = useDrillholeStore(s => s.db);
    const fits = useModelCache(s => s.byId);
    const listed = useMemo(() => {
        const roots = buildProjectTree(scene, db);
        // (the overall direction is listed once there is one)
        const drawn = (r: Row) => r.key !== keys.structure || !!scene.structure?.overall;
        return groups.flatMap(g => {
            const root = roots.find(r => r.key === keys.root(g));
            return root ? [{ key: root.key, title: root.name, rows: rowsOf(root).filter(drawn) }] : [];
        }).filter(g => g.rows.length > 0);
    }, [scene, db, groups]);

    if (listed.length === 0) {
        return (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', p: 1 }}>
                Nothing made yet. Surfaces, points, lines and measurements are made on the Modelling page, and can then be shown here.
            </Typography>
        );
    }
    return (
        <Box data-testid="shown-objects">
            {listed.map(g => {
                const on = g.rows.filter(r => visibility.isShown(r.key)).length;
                return (
                    <Box key={g.key} sx={{ pb: 0.5 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', pl: 0.25, pr: 0.5, bgcolor: 'action.hover' }}>
                            <Checkbox
                                size="small" sx={{ p: 0.5 }} checked={on === g.rows.length} indeterminate={on > 0 && on < g.rows.length}
                                inputProps={{ 'aria-label': `Show all ${g.title.toLowerCase()}` }}
                                onChange={e => visibility.setShown(g.rows.map(r => r.key), e.target.checked)}
                            />
                            <Typography variant="caption" sx={{ fontWeight: 600, flex: 1 }}>{g.title}</Typography>
                            <Typography variant="caption" color="text.secondary">{on} of {g.rows.length}</Typography>
                        </Box>
                        {g.rows.map(r => {
                            const id = r.key.startsWith('surface:') ? r.key.slice('surface:'.length) : null;
                            return (
                                <Box key={r.key} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, pl: 0.25, pr: 0.25, '&:hover .edit-in-modelling': { opacity: 1 } }}>
                                    <Checkbox
                                        size="small" sx={{ p: 0.5 }} checked={visibility.isShown(r.key)} inputProps={{ 'aria-label': `Show ${r.name}` }}
                                        onChange={e => visibility.setShown([r.key], e.target.checked)}
                                    />
                                    {r.color && <Box component="span" sx={{ width: 10, height: 10, flexShrink: 0, bgcolor: r.color, border: 1, borderColor: 'divider', borderRadius: 0.25 }} />}
                                    <Box sx={{ flex: 1, minWidth: 0 }}>
                                        <Typography variant="body2" noWrap sx={{ fontSize: 13 }}>{r.name}</Typography>
                                        {r.folder && <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', lineHeight: 1.1 }}>{r.folder}</Typography>}
                                    </Box>
                                    {id && fits[id]?.state === 'fitting' && <Typography variant="caption" color="text.secondary">fitting</Typography>}
                                    <Tooltip describeChild title="Change it on the Modelling page">
                                        <IconButton className="edit-in-modelling" size="small" sx={{ p: 0.25, opacity: 0.5 }} aria-label={`Edit ${r.name} on the Modelling page`} onClick={() => openInModelling(r.key)}>
                                            <OpenInNew sx={{ fontSize: 14 }} />
                                        </IconButton>
                                    </Tooltip>
                                </Box>
                            );
                        })}
                    </Box>
                );
            })}
        </Box>
    );
};

/** The button that takes you to the Modelling page, there to make or change the model */
const OpenModelling: React.FC = () => (
    <Tooltip describeChild title="Surfaces, points, lines, measurements and sections are made and changed on the Modelling page: a project tree, its properties, and 3D and section views">
        <Button size="small" variant="contained" fullWidth startIcon={<OpenInNew fontSize="small" />} sx={{ textTransform: 'none' }} onClick={() => openInModelling()}>
            Open in Modelling
        </Button>
    </Tooltip>
);

interface PanelProps {
    height: number | string;
    visibility: ViewVisibility;
    /** Whether the view shows the columns the model was built in, and which those are */
    here: boolean;
    sceneColumns: string | null;
    onUseSceneColumns: () => void;
    onClose: () => void;
    /** Shown below the list (the meshes, with their import) */
    children?: React.ReactNode;
}

/** The side panel of a 3D plot: what of the model it shows */
export const ShownObjectsPanel: React.FC<PanelProps> = ({ height, visibility, here, sceneColumns, onUseSceneColumns, onClose, children }) => {
    const made = useModelStore(s => s.scene.surfaces.length + (s.scene.inputs?.length ?? 0) + (s.scene.structure?.sets?.length ?? 0) > 0);
    return (
        <Paper data-testid="shown-objects-panel" variant="outlined" sx={{ width: 248, flexShrink: 0, height, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <Box sx={{ p: 0.75, pl: 1, display: 'flex', alignItems: 'center' }}>
                <Typography variant="subtitle2" sx={{ flex: 1 }}>Model shown here</Typography>
                <Tooltip title="Close this panel"><IconButton size="small" aria-label="Close the model list" onClick={onClose}><Close fontSize="small" /></IconButton></Tooltip>
            </Box>
            <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                <Box sx={{ px: 1, pb: 1 }}>
                    <OpenModelling />
                    {!here && made && (
                        <Alert
                            severity="warning" sx={{ mt: 0.75, py: 0, '& .MuiAlert-message': { fontSize: 12 } }}
                            action={<Button size="small" color="inherit" sx={{ textTransform: 'none' }} onClick={onUseSceneColumns}>Show them</Button>}
                        >
                            The model was built in the columns {sceneColumns}. This view shows other columns, so it is not drawn here.
                        </Alert>
                    )}
                </Box>
                <ShownObjectsList visibility={visibility} groups={PLOT_3D_GROUPS} />
                {children && <Box sx={{ borderTop: 1, borderColor: 'divider' }}>{children}</Box>}
            </Box>
        </Paper>
    );
};

/** A 2D plot's button for which surfaces and meshes it draws */
export const ShownObjectsButton: React.FC<{ visibility: ViewVisibility; disabled?: boolean }> = ({ visibility, disabled }) => {
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    return (
        <>
            <Button size="small" disabled={disabled} sx={{ textTransform: 'none' }} onClick={e => setAnchor(e.currentTarget)}>Which ones…</Button>
            <Popover open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
                <Box sx={{ width: 260, maxHeight: 420, overflowY: 'auto', py: 0.5 }}>
                    <ShownObjectsList visibility={visibility} groups={PLOT_2D_GROUPS} />
                    <Box sx={{ px: 1, pt: 0.5 }}><OpenModelling /></Box>
                </Box>
            </Popover>
        </>
    );
};
