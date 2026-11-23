/**
 * The groups of the tree in the properties, each with what makes a new
 * object of its kind (surfaces, readings, sets, section sets, meshes, logging
 * tables), and folders, links and several objects picked at once. What can
 * be made is one list (features/model/newObjects): the buttons here, the
 * tree's right-click menu and the page's New menu all go through it.
 */
import React, { useState } from 'react';
import { Alert, Box, Button, Checkbox, FormControlLabel, Stack, Tooltip, Typography } from '@mui/material';
import { Add } from '@mui/icons-material';
import { usePlotSetting } from '../../../hooks/usePlotSetting';
import { useModelStore } from '../../../store/modelStore';
import { newActionOf, newObject, type NewId } from '../../model/newObjects';
import type { TreeNode } from '../../model/projectTree';
import { visKeysUnder } from '../../model/treeRules';
import type { ViewNote } from '../../model/viewRegistry';
import { StructurePanel } from '../../plots/viewer3d/StructurePanel';
import { SurfaceHelp } from '../../plots/viewer3d/SurfaceHelp';
import { WireframeSection } from '../../plots/viewer3d/WireframePanel';
import { ModelHelp } from '../ModelHelp';
import { cannotMake, makeNew, pickedSamples, useMakeInputs } from '../newActions';
import { useTargetView, type TargetView } from '../targetView';
import { setLocked } from '../tree/treeCommands';
import { HoleFindings } from './HoleFindings';
import { NumericVolumes } from './NumericVolumes';
import { Caption, Fact, LookRow, NameField, NoViewNote } from './parts';

const wide = { textTransform: 'none', mt: 0.75 } as const;

/** A button that makes one of the things that can be made, greyed with the reason when it cannot be */
const NewButton: React.FC<{ id: NewId; target: TargetView; onNote?: (note: ViewNote) => void; children?: React.ReactNode }> = ({ id, target, onNote, children }) => {
    useMakeInputs();
    const made = newObject(id);
    const why = cannotMake(id, target);
    return (
        <Tooltip title={why ?? made.tip}>
            <span>
                <Button
                    size="small" variant={made.primary ? 'contained' : 'outlined'} fullWidth disabled={!!why} sx={wide} data-action={newActionOf(id)}
                    startIcon={made.primary ? <Add fontSize="small" /> : undefined}
                    onClick={() => { const note = makeNew(id, target); onNote?.(note); }}
                >
                    {children ?? made.label}
                </Button>
            </span>
        </Tooltip>
    );
};

/** New surfaces: in the view the pane acts on, and with none open in the model's own columns */
const SurfacesGroup: React.FC<{ target: TargetView }> = ({ target }) => {
    useMakeInputs();
    const [note, setNote] = useState<ViewNote>(null);
    const [help, setHelp] = useState(false);
    const count = useModelStore(s => s.scene.surfaces.length);
    const st = target.status;
    const selected = pickedSamples(target);
    return (
        <Box>
            <NewButton id="surface" target={target} onNote={setNote} />
            <NewButton id="surfaceFromSelection" target={target} onNote={setNote}>
                {newObject('surfaceFromSelection').label}{cannotMake('surfaceFromSelection', target) ? '' : ` (${selected.toLocaleString()})`}
            </NewButton>
            <NewButton id="contact" target={target} onNote={setNote} />
            <NewButton id="body" target={target} onNote={setNote} />
            <NewButton id="vein" target={target} onNote={setNote} />
            <NewButton id="shell" target={target} onNote={setNote} />
            <NewButton id="ground" target={target} onNote={setNote} />
            {note && <Alert severity={note.severity} sx={{ mt: 0.75, py: 0, '& .MuiAlert-message': { fontSize: 12 } }} onClose={() => setNote(null)}>{note.text}</Alert>}
            {st && !st.here && count > 0 && (
                <Alert
                    severity="warning" sx={{ mt: 0.75, py: 0, '& .MuiAlert-message': { fontSize: 12 } }}
                    action={<Button size="small" color="inherit" sx={{ textTransform: 'none' }} onClick={() => target.actions()?.useSceneColumns()}>Show them</Button>}
                >
                    The surfaces were built in the columns {st.sceneColumns}. {target.title} shows other columns, so they are not drawn there.
                </Alert>
            )}
            <NoViewNote what="see the surfaces" />
            <Tooltip describeChild title="How surfaces are fitted: a short guide with pictures you can change">
                <Button size="small" sx={{ textTransform: 'none', mt: 0.5 }} onClick={() => setHelp(true)}>How it works</Button>
            </Tooltip>
            <SurfaceHelp open={help} onClose={() => setHelp(false)} />
        </Box>
    );
};

/** The model's structure, its direction drawn on the slice of the view the pane acts on */
const StructureInView: React.FC<{ target: TargetView & { id: string } }> = ({ target }) => {
    useMakeInputs();
    const [onSlice, setOnSlice] = usePlotSetting(target.id, 'trendLines3d', true);
    return (
        <StructurePanel
            blocked={target.status?.ready ? target.status.blocked : 'Open a 3D view first.'}
            fromColumnsBlocked={cannotMake('readings', target)} onFromColumns={() => { makeNew('readings', target); }}
            showOnSlice={onSlice} onShowOnSlice={setOnSlice}
        />
    );
};

export const StructureGroup: React.FC = () => {
    useMakeInputs();
    const target = useTargetView();
    return (
        <Box sx={{ mx: -1 }}>
            {target.id
                ? <StructureInView target={{ ...target, id: target.id }} />
                // (Readings from columns need no view; those put in by hand are placed in one)
                : <StructurePanel blocked="Open a 3D view first." fromColumnsBlocked={cannotMake('readings', target)} onFromColumns={() => { makeNew('readings', target); }} />}
        </Box>
    );
};

const SetsGroup: React.FC<{ kind: 'points' | 'lines'; target: TargetView }> = ({ kind, target }) => (
    <Box>
        <NewButton id={kind} target={target} />
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
            What you place or draw for a surface is kept as a set of its own. Drag a set onto a surface in the tree to have it shape that surface too.
        </Typography>
    </Box>
);

const SectionsGroup: React.FC<{ target: TargetView }> = ({ target }) => {
    const [note, setNote] = useState<ViewNote>(null);
    return (
        <Box>
            <Typography variant="caption" color="text.secondary">A set is a series of parallel sections or plans: step through them square-on, and draw lines on each.</Typography>
            <NewButton id="sectionsFromSlice" target={target} onNote={setNote} />
            <Stack direction="row" spacing={0.75}>
                <NewButton id="sectionsWE" target={target} onNote={setNote} />
                <NewButton id="sectionsSN" target={target} onNote={setNote} />
                <NewButton id="sectionsLevel" target={target} onNote={setNote} />
            </Stack>
            {note && <Alert severity={note.severity} sx={{ mt: 0.75, py: 0, '& .MuiAlert-message': { fontSize: 12 } }} onClose={() => setNote(null)}>{note.text}</Alert>}
            <NoViewNote what="look along a set" />
        </Box>
    );
};

const DrillholesGroup: React.FC<{ target: TargetView }> = ({ target }) => (
    <Box>
        <NewButton id="table" target={target} />
        <NewButton id="units" target={target} />
        <HoleFindings />
    </Box>
);

const ModelsGroup: React.FC<{ target: TargetView }> = ({ target }) => {
    const [help, setHelp] = useState(false);
    return (
        <Box>
            <Typography variant="caption" color="text.secondary">
                A geological model puts surfaces in order of age, each as a deposit, an erosion surface or an intrusion, and from them says which unit is at every place: cut surfaces, unit solids and a unit for every sample.
            </Typography>
            <NewButton id="model" target={target} />
            <Tooltip describeChild title="How a geological model is built: a short guide with pictures you can change">
                <Button size="small" sx={{ textTransform: 'none', mt: 0.5 }} onClick={() => setHelp(true)}>How it works</Button>
            </Tooltip>
            <ModelHelp open={help} onClose={() => setHelp(false)} />
        </Box>
    );
};

/** The numeric models: what one is, and the way to make one */
const NumericGroup: React.FC<{ target: TargetView; vis: readonly string[]; groupKey: string }> = ({ target, vis, groupKey }) => (
    <Box>
        {vis.length > 0 && <LookRow objectKeys={[groupKey]} visKeys={vis} />}
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            A numeric model takes one column of numbers (a grade, say) and several cut-offs, and keeps a grade shell for each: all found the same way, so that a setting
            is changed once for all of them, and each says how much ground it holds.
        </Typography>
        <NewButton id="numericModel" target={target} />
        <NumericVolumes />
    </Box>
);

/** A group of the tree: what is in it, and what makes a new one */
export const GroupEditor: React.FC<{ node: TreeNode }> = ({ node }) => {
    const target = useTargetView();
    const group = node.key.slice('root:'.length);
    const vis = visKeysUnder(node);
    const n = node.children.filter(c => c.kind !== 'folder').length;
    return (
        <Box data-testid={`group-editor-${group}`}>
            <Typography variant="subtitle2">{node.name}</Typography>
            {group !== 'structure' && group !== 'drillholes' && group !== 'sections' && group !== 'models' && group !== 'numeric' && <LookRow objectKeys={[node.key]} visKeys={vis} />}
            {group === 'structure' ? <StructureGroup />
                : group === 'surfaces' ? <SurfacesGroup target={target} />
                    : group === 'points' || group === 'lines' ? <SetsGroup kind={group} target={target} />
                        : group === 'sections' ? <SectionsGroup target={target} />
                            : group === 'drillholes' ? <DrillholesGroup target={target} />
                                : group === 'models' ? <ModelsGroup target={target} />
                                : group === 'numeric' ? <NumericGroup target={target} vis={vis} groupKey={node.key} />
                                : group === 'meshes' ? (
                                    <Box sx={{ mx: -1, mt: 0.5 }}>
                                        <Box sx={{ mx: 1 }}><NewButton id="topography" target={target} /></Box>
                                        <WireframeSection dataBounds={target.actions()?.dataBounds() ?? null} onZoomTo={b => target.actions()?.zoomToWorld(b)} />
                                    </Box>
                                ) : <Fact>{n.toLocaleString()} {n === 1 ? 'object' : 'objects'}</Fact>}
        </Box>
    );
};

export const FolderEditor: React.FC<{ node: TreeNode }> = ({ node }) => (
    <Box data-testid="folder-editor">
        <NameField objectKey={node.key} name={node.name} />
        <Fact>{node.detail === 'empty' ? 'Empty' : node.detail}</Fact>
        <LookRow objectKeys={[node.key]} visKeys={visKeysUnder(node)} />
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>Drag objects onto it in the tree to file them in it.</Typography>
    </Box>
);

/** Several objects picked: what is common to them */
export const ManyEditor: React.FC<{ nodes: readonly TreeNode[] }> = ({ nodes }) => {
    const objectKeys = nodes.map(n => n.key);
    const vis = [...new Set(nodes.flatMap(visKeysUnder))];
    const lockable = nodes.every(n => n.lockable);
    const locked = lockable && nodes.every(n => n.locked);
    return (
        <Box data-testid="many-editor">
            <Typography variant="subtitle2">{nodes.length} objects picked</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }} noWrap>{nodes.map(n => n.name).join(', ')}</Typography>
            <LookRow objectKeys={objectKeys} visKeys={vis} />
            {lockable && (
                <FormControlLabel
                    sx={{ ml: -0.75 }}
                    control={<Checkbox size="small" sx={{ p: 0.5 }} checked={locked} indeterminate={!locked && nodes.some(n => n.locked)} onChange={e => setLocked(objectKeys, e.target.checked)} />}
                    label={<Typography variant="caption">Locked</Typography>}
                />
            )}
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>Right-click in the tree for what else can be done to them all.</Typography>
        </Box>
    );
};

const VIA: Record<string, string> = { contact: 'The surface it is', boundary: 'The surface it stops at', uses: 'A set it uses', units: 'The units it reads', logging: 'The logging it is built from', values: 'The column it is put round' };

export const LinkEditor: React.FC<{ node: TreeNode; onGoTo: (key: string) => void }> = ({ node, onGoTo }) => (
    <Box data-testid="link-editor">
        <Caption>{VIA[node.link?.via ?? ''] ?? 'Linked'}</Caption>
        <Typography variant="subtitle2">{node.name}</Typography>
        {node.link?.broken
            ? <Typography variant="caption" color="warning.main">It is no longer in the project.</Typography>
            : <Button size="small" variant="outlined" sx={{ ...wide, width: 'auto' }} onClick={() => node.link && onGoTo(node.link.target)}>Go to it</Button>}
    </Box>
);

/** The samples, the collars, a column: facts only */
export const InfoEditor: React.FC<{ node: TreeNode }> = ({ node }) => (
    <Box data-testid="info-editor">
        <Typography variant="subtitle2">{node.name}</Typography>
        {node.detail && <Fact>{node.detail}</Fact>}
        {node.status === 'missing' && <Typography variant="caption" color="warning.main" sx={{ display: 'block' }}>Not in the project now.</Typography>}
    </Box>
);
