/**
 * The open surface's settings, in the properties of the Modelling page, under
 * four tabs. Inputs: what it is made from (logging, its points and lines, the
 * sets it uses). Surfacing: how it is fitted, how far it reaches, its sides.
 * Trend: how it lies. Outputs: how well it honours its points, the columns it
 * writes, its mesh. (Its name, colour, opacity, lock and deleting it are in the
 * head of its editor: properties/EditorHeader.)
 *
 * The open surface is the one "being edited": the columns it fills in are
 * brought up to date when it is closed, not on every nudge of a slider.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
    Alert, Box, Button, Checkbox, FormControlLabel, IconButton, ListItemText, Menu, MenuItem, Slider, TextField,
    ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import { AdsClick, Check, ContentCopy, DeleteOutline, Gesture, LinkOff, SelectAll, SwapVert, Timeline } from '@mui/icons-material';
import { useAppStore } from '../../../store/appStore';
import { useDrillholeStore } from '../../../store/drillholeStore';
import { useModelStore } from '../../../store/modelStore';
import { nodesOfLines, useEditSession } from '../../model/editSession';
import { contactInputsFor, shellInputsFor, useModelCache } from '../../model/modelCache';
import { formatMetres, lockNote, surfaceStatus } from '../../model/describe';
import { sharePercent } from '../../model/proportion';
import { DrillCheckNote } from './DrillCheckNote';
import { listText } from '../../model/shellDomains';
import { StoppedFit } from './StoppedFit';
import { lockedInputs } from '../../model/inputs';
import { MESH_FORMATS } from '../../model/meshWriters';
import { SHADE_RAMP, thicknessShade } from '../../model/veinShade';
import { copyLinesToSection, exportKit, exportSurfaces, unitsLabel } from '../../model/sceneActions';
import { sectionOfLine } from '../../model/lineTools';
import { sectionLabel } from '../../model/sectionSets';
import { surfaceSides, writeInterceptColumn, writeSurfaceColumns, type SurfaceColumnKind } from '../../model/surfaceColumns';
import { lineLength, sampleLines } from '../../model/lines';
import { sheetsAutoReach, surfacePoints, surfaceReach, veinAcross, veinAutoReach } from '../../model/surfaceJobs';
import { veinPicks } from '../../model/vein';
import { chosenSets } from '../../model/trendField';
import { OwnTrend } from './OwnTrend';
import { isOrientedLine, ribbonKeys } from '../../model/ribbons';
import { AUTO_REACH, DEFAULT_LOCAL, DEFAULT_SHARE } from '../../model/shell';
import type { ScenePolyline, ShellRule, SurfaceObject, Vec3 } from '../../model/types';
import { CommitSlider } from '../../modelling/properties/CommitSlider';
import { ShellCheckNote } from './ShellCheckNote';
import { SurfaceContacts } from './SurfaceContacts';
import { VeinStretches } from './VeinStretches';
import { SurfaceMisfit } from './SurfaceMisfit';
import { SurfaceSettings } from './SurfaceSettings';
import { sliceKind } from './slices';
import { SurfaceDirections } from './SurfaceDirections';
import type { ThreeViewport } from './ThreeViewport';
import { SurfaceInputs } from './SurfaceInputs';
import { plain, t, termProps } from '../../model/terms';
import { Term } from '../../modelling/Term';
import { SURFACE_TABS, SURFACE_TAB_NAME, useEditorTabs, type SurfaceTab } from '../../modelling/editorTabs';
import { EditorPart as Part, EditorTabBar } from '../../modelling/properties/EditorTabs';

export interface SurfaceDetailsProps {
    surface: SurfaceObject;
    /** The view acted in shows the coordinate columns the scene is in: its surfaces are drawn there */
    here: boolean;
    /** A slice is on: points can be placed on it as well as on holes */
    canSlice: boolean;
    /** Start drawing lines for the open surface (the view brings up a slice to draw on if there is none) */
    onDraw: () => void;
    /** Change the units of a surface made from logging */
    onContact: (surfaceId?: string) => void;
    /** Change the column and cut-off of a shell */
    onShell: (surfaceId?: string) => void;
    /** The view is waiting for the open surface's outline to be drawn */
    outlining: boolean;
    /** The next drag in the view draws the outline the open surface is kept inside (again: never mind) */
    onOutline: () => void;
    /** The 3D view (null: not ready) and its vertical exaggeration: what "the view line" is */
    viewport?: ThreeViewport | null;
    vex?: number;
    /** Bring a place into view (world coordinates) */
    onZoomTo?: (p: Vec3, reach?: number) => void;
    /** A copy of the surface was made as a version: its id */
    onCopied?: (id: string) => void;
    /** Its settings under tabs (Inputs, Surfacing, Trend, Outputs), one shown at a time. Left out: every setting, one under the other */
    tabs?: boolean;
}

const smallButton = { minWidth: 0, px: 0.75, py: 0, height: 24, fontSize: 12, textTransform: 'none' } as const;
const label = { display: 'block', mt: 1, color: 'text.secondary' } as const;

/** Reach slider: this many powers of ten either side of the automatic reach */
const REACH_DECADES = 0.8;
/** A shell's reach can be set from a third of the automatic one and a half hole spacings to three times it */
const SHELL_REACH_DECADES = 0.5;

const WRITE_PROBLEM: Record<string, string> = {
    'no-surface': 'The surface is no longer there.',
    'not-ready': 'The surface is still being worked out. Try again in a moment.',
    'no-coordinates': 'The coordinate columns the surfaces were built in are no longer in the data.',
};

/** Where a line was drawn, in a few words, and how many of its nodes carry a dip reading or a direction. */
function lineSlice(line: ScenePolyline): string {
    const at = (v: number) => Math.round(v).toLocaleString();
    const ticks = line.nodes?.reduce((n, node) => n + (node?.reading ? 1 : 0), 0) ?? 0;
    const directions = ribbonKeys(line).keys.length;
    const more = (ticks > 0 ? ` · ${ticks} dip ${ticks === 1 ? 'measurement' : 'measurements'}` : '')
        + (directions > 0 ? ` · ${directions} ${directions === 1 ? 'direction' : 'directions'}` : '')
        + (line.smooth ? ' · smooth' : '');
    if (!line.plane) return `In space, on no slice${more}`;
    const { normal, point } = line.plane;
    const kind = sliceKind(normal);
    return (kind === 'we' ? `W-E section, ${at(point[1])} N`
        : kind === 'sn' ? `S-N section, ${at(point[0])} E`
            : kind === 'level' ? `Level, ${at(point[2])} m`
                : 'On a slice') + more;
}

/** How far a shell may go from a sample at or above its cut-off, in hole spacings: set when the slider is let go (each change fits the shell again) */
const ShellReach: React.FC<{ rule: ShellRule; factor: number; onChange: (rule: ShellRule) => void }> = ({ rule, factor, onChange }) => {
    const [shown, setShown] = useState(factor);
    const from = (v: number) => Number((AUTO_REACH * 10 ** v).toPrecision(2));
    return (
        <>
            <Typography variant="caption" sx={label}>How far from the samples it may reach</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Tooltip title="From a sample at or above the cut-off the shell may go this many times the distance between the holes there, and no further: a few metres among close-spaced holes, tens of metres among wide-spaced ones. At one and a half it joins up between neighbouring holes and stops about a hole spacing past the last high sample.">
                    <Typography variant="caption" color="text.secondary" sx={{ width: 92, flexShrink: 0, whiteSpace: 'nowrap' }}>
                        {shown} × spacing
                    </Typography>
                </Tooltip>
                {/* Logarithmic, about one and a half hole spacings */}
                <Slider
                    size="small" min={-SHELL_REACH_DECADES} max={SHELL_REACH_DECADES} step={0.02} aria-label="How far from the samples it may reach"
                    value={Math.min(SHELL_REACH_DECADES, Math.max(-SHELL_REACH_DECADES, Math.log10(shown / AUTO_REACH)))}
                    onChange={(_, v) => setShown(from(v as number))}
                    onChangeCommitted={(_, v) => onChange({ ...rule, reach: from(v as number) })}
                />
                {rule.reach !== null && (
                    <Tooltip title="Back to one and a half hole spacings">
                        <Button size="small" sx={smallButton} onClick={() => onChange({ ...rule, reach: null })}>Auto</Button>
                    </Tooltip>
                )}
            </Box>
        </>
    );
};

/**
 * A shell found by counting: the share of the samples round about that must be at or above the cut-off, and how
 * many are taken together. Set when a slider is let go (each change fits the shell again).
 */
const ShellCounting: React.FC<{ rule: ShellRule; onChange: (rule: ShellRule) => void }> = ({ rule, onChange }) => {
    const [share, setShare] = useState(Math.round(100 * (rule.share ?? DEFAULT_SHARE)));
    const [local, setLocal] = useState(rule.local ?? DEFAULT_LOCAL);
    const from = (v: number) => Number((10 ** v).toPrecision(2));
    return (
        <>
            <Typography variant="caption" sx={label}>How many of the samples round about must be at or above the cut-off</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Tooltip title="The shell is put where at least this share of the samples round about are at or above the cut-off. Lower: it takes in more of them, and more low ground with them. Higher: only where they are thick on the ground.">
                    <Typography variant="caption" color="text.secondary" sx={{ width: 92, flexShrink: 0, whiteSpace: 'nowrap' }}>{share}%</Typography>
                </Tooltip>
                <Slider
                    size="small" min={10} max={90} step={5} aria-label="How many of the samples round about must be at or above the cut-off" value={share}
                    onChange={(_, v) => setShare(v as number)} onChangeCommitted={(_, v) => onChange({ ...rule, share: (v as number) / 100 })}
                />
            </Box>
            <Typography variant="caption" sx={label}>How many samples are taken together</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Tooltip title="About this many samples each way down a hole are counted together, and as far again to the sides. Few: it follows each run of high samples, in many pieces. Many: fewer, broader shells that leave out high samples standing alone.">
                    <Typography variant="caption" color="text.secondary" sx={{ width: 92, flexShrink: 0, whiteSpace: 'nowrap' }}>about {local} each way</Typography>
                </Tooltip>
                {/* Logarithmic, 1 to 15 */}
                <Slider
                    size="small" min={0} max={1.18} step={0.02} aria-label="How many samples are taken together" value={Math.min(1.18, Math.max(0, Math.log10(local)))}
                    onChange={(_, v) => setLocal(from(v as number))} onChangeCommitted={(_, v) => onChange({ ...rule, local: from(v as number) })}
                />
            </Box>
        </>
    );
};

/** The open surface's settings, in the properties of the Modelling page */
export const SurfaceDetails: React.FC<SurfaceDetailsProps> =({ surface, here, canSlice, onDraw, outlining, onOutline, onContact, onShell, viewport = null, vex = 1, onZoomTo, onCopied, tabs = false }) => {
    const tab = useEditorTabs(x => x.surface);
    const setTab = useEditorTabs(x => x.setSurfaceTab);
    const open: SurfaceTab | 'all' = tabs ? tab : 'all';
    const { updateSurface, setPicking, setDrawing, setHotLine, updatePolyline, removePolylines } = useModelStore.getState();
    const picking = useModelStore(s => s.picking);
    const marking = useModelStore(s => s.marking);
    const drawing = useModelStore(s => s.drawing);
    const hotLine = useModelStore(s => s.hotLine);
    const snapNodes = useModelStore(s => s.snapNodes);
    const drawSmooth = useEditSession(s => s.drawSmooth);
    // The lines of a locked set stay as they are (Points and lines, further up the panel)
    const inputs = useModelStore(s => s.scene.inputs);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- worked out from the scene's sets as they are now
    const locked = useMemo(() => lockedInputs(useModelStore.getState().scene, surface), [inputs, surface]);
    const result = useModelCache(s => s.byId[surface.id]);
    const columnNames = useAppStore(s => s.columns);
    // A line drawn on a plane of a section set can be copied to the next plane of the set
    const sectionSets = useModelStore(s => s.scene.sectionSets);
    const [copyMenu, setCopyMenu] = useState<{ anchor: HTMLElement; line: string } | null>(null);
    const copyFrom = copyMenu ? surface.polylines.find(l => l.id === copyMenu.line) : undefined;
    const copyOn = copyFrom ? sectionOfLine(copyFrom, sectionSets) : null;
    const [sides, setSides] = useState<[string, string]>(surface.sides ?? ['', '']);
    const [problem, setProblem] = useState<string | null>(null);
    /** The column last written with the samples in an intercept */
    const [flagged, setFlagged] = useState<string | null>(null);
    useEffect(() => setSides(surface.sides ?? ['', '']), [surface.sides]);

    // From logging: what the dataset (or a table logged down the holes) gives it now. Remembered per dataset, tables
    // and rule, so asking again costs nothing; the subscriptions are there to ask again when any of them changes
    useAppStore(s => s.columnarData);
    useModelStore(s => s.scene.coords);
    const loggedTable = useDrillholeStore(s => (surface.rule.kind === 'contact' || surface.rule.kind === 'body') && surface.rule.table
        ? s.db?.tables.find(t => t.id === (surface.rule as { table?: string }).table) ?? null : null);
    useDrillholeStore(s => s.db);
    // Where its logging is read: a column of the dataset, or of a table as it was logged
    const unitMap = useModelStore(s => ((surface.rule.kind === 'contact' || surface.rule.kind === 'body') && surface.rule.units
        ? s.scene.unitMaps?.find(m => m.id === (surface.rule as { units?: string }).units) ?? null : undefined));
    const loggedIn = (column: string) => (unitMap ? `the lithologies ${unitMap.name}` : unitMap === null ? 'lithologies no longer in the project'
        : loggedTable ? `${column} of ${loggedTable.name}, as logged` : column);
    // (The direction and the structural data it follows: its own when it has them, else the model's)
    const structure = useModelStore(s => surface.params.trendOwn ?? s.scene.structure?.overall ?? null);
    // Readings the model follows: a sheet or a contact can lie as they say
    const readingsFollowed = useModelStore(s => chosenSets(s.scene.structure?.sets, surface.params.trendSets).length > 0);
    const planesFollowed = useModelStore(s => chosenSets(s.scene.structure?.sets, surface.params.trendSets).some(set => set.kind === 'plane'));
    const found = contactInputsFor(surface);
    const shellInputs = shellInputsFor(surface);
    const status = surfaceStatus(surface, result, found, shellInputs, structure);
    // A shell follows its column alone: nothing is placed by hand
    const shell = surface.rule.kind === 'shell';
    // Closed (a body or a shell): no edge to it. A body takes lines and dip measurements on its skin (a vein: on its reference surface); a shell takes nothing by hand
    const body = surface.rule.kind === 'body' || shell;
    // (A vein is built from its two walls: it is not stretched along the model's direction. Held, its reference surface follows the readings: ContactDialog)
    const vein = surface.rule.kind === 'body' && !!surface.rule.vein;
    // (A vein is carried from its stretches down the holes: by the gaps between the holes that meet it)
    // (An intrusion of thin sheets is drawn only near where holes meet it: by the usual gap between its stretches)
    const thinSheets = surface.rule.kind === 'body' && !surface.rule.vein && !!surface.rule.sheets;
    const auto = useMemo(() => (vein
        ? (found ? veinAutoReach(veinPicks(found.list).stretches, 0, veinAcross(surface, found)) : 0)
        : thinSheets ? (found ? sheetsAutoReach(found.middles, 0) : 0)
            : surfaceReach(surfacePoints(surface, found), sampleLines(surface.polylines))), [surface, found, vein, thinSheets]);
    const reach = surface.params.reach ?? auto;
    /** The reach at a place on its slider (logarithmic, about the automatic reach) */
    const reachAt = (v: number) => Number((auto * 10 ** v).toPrecision(3));
    // Where the reach slider is while it is dragged (null: where the surface says)
    const [shownReach, setShownReach] = useState<number | null>(null);
    const namedSides = surfaceSides(surface, result?.trend ?? null);
    const automaticSides = surfaceSides({ ...surface, sides: null }, result?.trend ?? null);
    const has = (column: string | null) => !!column && columnNames.some(c => c.name === column);
    // Something under Trend: a direction it follows, or can be told to
    const veinPlunge = vein && structure?.lineTrend != null && structure.lineStrength > 1;
    const trendSet = (!!surface.trendHeld && (result?.stats?.turned ?? 0) >= 1) || ((shell || (body && !vein)) && planesFollowed) || (body && !vein && !!structure)
        || (!body && readingsFollowed) || veinPlunge
        // (... or it follows the layers of a geological model: OwnTrend says so)
        || ((shell || body) && !!surface.params.trendLayers);

    const commitSides = () => {
        const a = sides[0].trim(), b = sides[1].trim();
        // One name given: the other keeps its automatic name
        const next: [string, string] | null = a || b ? [a || automaticSides[0], b || automaticSides[1]] : null;
        if (JSON.stringify(next) !== JSON.stringify(surface.sides)) updateSurface(surface.id, { sides: next });
    };
    // (Worked out once for a mesh, and only while it is coloured that way)
    const shade = vein && surface.shade === 'thickness' && result?.state === 'ready' && result.part ? thicknessShade(result.part, result.field) : null;
    const addColumn = (kind: SurfaceColumnKind) => {
        const out = writeSurfaceColumns(surface.id, [kind]);
        setProblem(out.ok ? null : WRITE_PROBLEM[out.reason]);
    };

    return (
        <Box sx={{ px: 1, pb: 1 }}>
            <Box data-testid="surface-status">
                <Typography variant="caption" color={status.problem ? 'warning.main' : 'text.primary'} sx={{ display: 'block' }}>
                    {status.headline}
                </Typography>
                {status.notes.map(note => (
                    <Typography key={note} variant="caption" color="text.secondary" sx={{ display: 'block' }}>{note}</Typography>
                ))}
            </Box>
            <StoppedFit surfaceId={surface.id} />
            {surface.locked && (
                <Alert
                    severity={lockNote(surface, result) ? 'warning' : 'info'} data-testid="locked-note" sx={{ mt: 0.5, py: 0, '& .MuiAlert-message': { fontSize: 12 } }}
                    action={<Button size="small" color="inherit" sx={smallButton} onClick={() => updateSurface(surface.id, { locked: undefined })}>Unlock</Button>}
                >
                    {lockNote(surface, result) ?? 'Locked: it stays as it was fitted. What is said of it here is as its inputs are now; unlock it to bring the surface up to date.'}
                </Alert>
            )}
            {tabs && (
                <EditorTabBar tabs={SURFACE_TABS} names={SURFACE_TAB_NAME} value={tab} onChange={setTab} label="The settings of the surface" />
            )}
            <Part tab="inputs" open={open}>
                {surface.rule.kind === 'contact' && (
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, mt: 0.5 }}>
                        <Typography variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 0 }}>
                            Where {unitsLabel(surface.rule.sideA)} gives way to {unitsLabel(surface.rule.sideB)} in {loggedIn(surface.rule.column)}
                            {found ? `: in ${found.holesWithContact.toLocaleString()} of ${found.holes.toLocaleString()} holes.` : '.'}
                        </Typography>
                        <Button size="small" sx={smallButton} onClick={() => onContact(surface.id)}>Change</Button>
                    </Box>
                )}
                {surface.rule.kind === 'shell' && (
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, mt: 0.5 }}>
                        <Typography variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 0 }}>
                            {surface.rule.of ? `Round the ground where ${sharePercent(surface.rule.cutoff)} or more is ${listText(surface.rule.of.inside)}, logged in ${surface.rule.of.column}. How it is found is changed in its numeric model.`
                                : surface.rule.method === 'intercepts' ? `Round the intercepts of ${surface.rule.cutoff} or more in ${surface.rule.column}.`
                                : surface.rule.method === 'indicator' ? `Round where enough of the samples are ${surface.rule.cutoff} or more in ${surface.rule.column}.`
                                : `Round everything of ${surface.rule.cutoff} or more in ${surface.rule.column}.`}
                        </Typography>
                        {!surface.rule.of && <Button size="small" sx={smallButton} onClick={() => onShell(surface.id)}>Change</Button>}
                    </Box>
                )}
                {surface.rule.kind === 'body' && (
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, mt: 0.5 }}>
                        <Typography variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 0 }}>
                            {surface.rule.vein ? 'A vein of' : 'Round'} everything logged as {unitsLabel(surface.rule.inside)} in {loggedIn(surface.rule.column)}
                            {found ? `: holes pass into or out of it in ${found.holesWithContact.toLocaleString()} of ${found.holes.toLocaleString()}.` : '.'}
                        </Typography>
                        <Button size="small" sx={smallButton} onClick={() => onContact(surface.id)}>Change</Button>
                    </Box>
                )}
                {!shell && <Tooltip title={!here ? 'This view shows other coordinate columns than the surface was built in' : surface.rule.kind === 'body' && surface.rule.vein ? 'Add, move and remove places on its walls, in the 3D view: a place above its middle is on the upper wall, one below on the lower. A place given a dip measurement or a direction is on its reference surface (the middle of it) instead, and says how the vein lies there'
                    : body ? 'Add, move and remove more places its skin passes through, in the 3D view. A place can carry a dip measurement or a direction: its skin lies that way there' : 'Add, move and remove the points this surface runs through, in the 3D view'}>
                    <span>
                        <ToggleButton
                            size="small" fullWidth value="place" selected={picking} disabled={!here || !!surface.locked} color="primary"
                            onChange={() => setPicking(!picking)} sx={{ textTransform: 'none', py: 0.25, mt: 0.75, gap: 0.5, fontSize: 12 }}
                        >
                            <AdsClick fontSize="small" />{!picking ? 'Place and move its points' : marking === 'take' ? 'Taking stretches: Esc when done' : marking === 'link' ? 'Making links: Esc when done'
                                : marking === 'hole' ? 'Holes kept clear of: Esc when done' : marking === 'contact' ? 'Moving contacts: Esc when done' : marking ? 'Marking places: Esc when done' : 'Placing points: Esc when done'}
                        </ToggleButton>
                    </span>
                </Tooltip>}
                {!shell && <Tooltip title={!here ? 'This view shows other coordinate columns than the surface was built in' : vein ? 'Draw the vein where you see it on a section: its reference surface (the middle of it) runs along the line, and the vein is carried along it.'
                    : body ? 'Draw its edge where you see it on a section: its skin runs along the line, with the inside on the side the logging near the line says (R turns a line over).' : 'Draw the surface where you see it on a section. Lines let it bend and fold back on itself.'}>
                    <span>
                        <ToggleButton
                            size="small" fullWidth value="draw" selected={drawing} disabled={!here || !!surface.locked} color="primary"
                            onChange={() => (drawing ? setDrawing(false) : onDraw())} sx={{ textTransform: 'none', py: 0.25, mt: 0.5, gap: 0.5, fontSize: 12 }}
                        >
                            <Gesture fontSize="small" />{drawing ? 'Drawing lines on the slice' : 'Draw lines on a slice'}
                        </ToggleButton>
                    </span>
                </Tooltip>}
                {drawing ? (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                        {canSlice
                            ? 'Click along the surface where you see it on the slice: each click is a node of the line. Double-click or Enter ends it. Or drag to draw it freehand. Then drag a node to move it, click the line to add one, right-click to remove, R to turn it over. A line stays on its section: step the slice on, draw the next, and the surface runs from line to line. Nodes snap to other nodes and to the squares where lines of other sections cross this one.'
                            : 'With no slice, lines are drawn on the other surfaces shown: click or drag over one. Turn on Slice to draw on a slice.'}
                        <Tooltip title="A click or a drag onto a drillhole puts the node on the hole, at that depth, not on the slice: on a logged contact first, then the edge or the middle of a sample. The line then runs in space from hole to hole: the surface passes along it, and dip measurements placed on its nodes say how it lies there.">
                            <FormControlLabel
                                sx={{ display: 'flex', ml: -0.5, mt: 0.25, '& .MuiFormControlLabel-label': { fontSize: 12 } }}
                                control={<Checkbox size="small" sx={{ p: 0.25 }} checked={snapNodes} onChange={e => useModelStore.getState().setSnapNodes(e.target.checked)} />}
                                label="Nodes go on drillholes"
                            />
                        </Tooltip>
                        <Tooltip title="Lines drawn from now on are a smooth curve through their nodes (a spline), not straight from node to node. A line drawn freehand is kept as the few nodes the curve needs to follow it. Each line can be made smooth or straight again in the list below.">
                            <FormControlLabel
                                sx={{ display: 'flex', ml: -0.5, '& .MuiFormControlLabel-label': { fontSize: 12 } }}
                                control={<Checkbox size="small" sx={{ p: 0.25 }} checked={drawSmooth} onChange={e => useEditSession.getState().setDrawSmooth(e.target.checked)} />}
                                label="Smooth lines"
                            />
                        </Tooltip>
                    </Typography>
                ) : picking && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                        Click a drillhole to add a point: it snaps to the edge or the middle of the sample.
                        {canSlice ? ' Away from the holes, a click lands on the slice.' : ' Turn on Slice to place points between holes.'}
                        {' '}Drag a point to move it; right-click removes it; a click picks it out (below). A point is at its place in space: a slice that has moved away from it hides it.
                        {' '}Ctrl+drag puts down a point with a dip measurement: the plane through your drag and your line of sight, the drag's length how far it holds. Alt+click or double-click a point or a node to type its dip measurement. A point with a dip measurement that is picked out has a handle on the edge of its disc: drag it to turn the disc.
                        {' '}The view still turns and zooms as usual.
                    </Typography>
                )}
                {!shell && surface.polylines.length > 0 && (
                    <Box sx={{ mt: 0.75 }} onMouseLeave={() => setHotLine(null)}>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            Lines ({surface.polylines.length}).{!surface.polylines.some(l => l.plane) || vein ? '' : body ? ' Their ticks point into it.' : ` Their ticks point to the ${namedSides[0].replace(/ side$/, '')} side.`}
                        </Typography>
                        {surface.polylines.map((line, i) => (
                            <Box
                                key={line.id} onMouseEnter={() => setHotLine(line.id)}
                                sx={{ display: 'flex', alignItems: 'center', pl: 0.5, borderRadius: 0.5, bgcolor: hotLine === line.id ? 'action.hover' : undefined }}
                            >
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                    <Typography variant="caption" noWrap sx={{ display: 'block', lineHeight: 1.3 }}>
                                        Line {i + 1} · {formatMetres(lineLength(line.points))}{isOrientedLine(line) && line.flipped ? ' · turned over' : ''}{locked.has(line.id) ? ' · locked' : ''}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', lineHeight: 1.3, fontSize: 11 }}>{lineSlice(line)}</Typography>
                                </Box>
                                {picking && (
                                    <Tooltip title="Pick out all its nodes in the view, to give them a direction (below)">
                                        <IconButton size="small" aria-label={`Pick out the nodes of line ${i + 1}`} onClick={() => useEditSession.getState().select(surface.id, { nodes: nodesOfLines([line]) })}>
                                            <SelectAll fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                )}
                                {line.points.length >= 3 && (
                                    <Tooltip title={locked.has(line.id) ? 'This line is in a locked set: unlock the set under Points and lines to change it' : line.smooth ? 'Smooth: a curve through its nodes. Click to make it straight from node to node.' : 'Straight from node to node. Click to make it a smooth curve through its nodes.'}>
                                        <span>
                                            <IconButton
                                                size="small" aria-label={line.smooth ? `Make line ${i + 1} straight` : `Make line ${i + 1} smooth`} color={line.smooth ? 'primary' : 'default'}
                                                disabled={locked.has(line.id)} onClick={() => useModelStore.getState().setLinesSmooth(surface.id, [line.id], !line.smooth)}
                                            >
                                                <Timeline fontSize="small" />
                                            </IconButton>
                                        </span>
                                    </Tooltip>
                                )}
                                {/* (A line in space with no directions has no side of its own to turn over) */}
                                {isOrientedLine(line) && (
                                    <Tooltip title="Turn this line over: the surface's two sides swap along it. Use it if the surface twists or tears at this line.">
                                        <IconButton size="small" aria-label={`Turn line ${i + 1} over`} color={line.flipped ? 'primary' : 'default'} onClick={() => updatePolyline(surface.id, line.id, { flipped: !line.flipped })}>
                                            <SwapVert fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                )}
                                {sectionOfLine(line, sectionSets) && (
                                    <Tooltip title="Copy this line to the next section of its set (or the one before), to move into place there">
                                        <IconButton size="small" aria-label={`Copy line ${i + 1} to another section`} onClick={e => setCopyMenu({ anchor: e.currentTarget, line: line.id })}>
                                            <ContentCopy fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                )}
                                {line.plane && (
                                    <Tooltip title={locked.has(line.id) ? 'This line is in a locked set: unlock the set under Points and lines to change it' : 'Let this line go from its slice: its nodes can then be dragged anywhere, and onto drillholes. The surface still passes along it, but the line no longer says which side is which: that comes from the other lines, the points and the dip measurements.'}>
                                        <span>
                                            <IconButton size="small" aria-label={`Let line ${i + 1} go from its slice`} disabled={locked.has(line.id)} onClick={() => updatePolyline(surface.id, line.id, { plane: null })}>
                                                <LinkOff fontSize="small" />
                                            </IconButton>
                                        </span>
                                    </Tooltip>
                                )}
                                <Tooltip title={locked.has(line.id) ? 'This line is in a locked set: unlock the set under Points and lines to remove it' : 'Remove this line'}>
                                    <span>
                                        <IconButton size="small" aria-label={`Remove line ${i + 1}`} disabled={locked.has(line.id)} onClick={() => removePolylines(surface.id, [line.id])}>
                                            <DeleteOutline fontSize="small" />
                                        </IconButton>
                                    </span>
                                </Tooltip>
                            </Box>
                        ))}
                        <Menu anchorEl={copyMenu?.anchor ?? null} open={!!copyMenu && !!copyOn} onClose={() => setCopyMenu(null)}>
                            {copyOn && [1, -1].map(step => (
                                <MenuItem
                                    key={step} dense
                                    onClick={() => {
                                        setCopyMenu(null);
                                        copyLinesToSection(surface.id, [copyFrom!.id], step, copyOn.set.id);
                                    }}
                                >
                                    <ListItemText primary={`To ${sectionLabel(copyOn.set, copyOn.index + step)}`} secondary={step > 0 ? 'The next section' : 'The section before'} />
                                </MenuItem>
                            ))}
                        </Menu>
                    </Box>
                )}
                {!shell && (surface.polylines.length > 0 || surface.points.length > 0) && <SurfaceDirections surface={surface} viewport={here ? viewport : null} vex={vex} picking={picking} />}
                {!shell && <SurfaceInputs surface={surface} here={here} />}
                {(surface.rule.kind === 'contact' || surface.rule.kind === 'body') && found && (
                    <SurfaceContacts surface={surface} found={found} here={here} sides={namedSides} onZoom={onZoomTo} />
                )}
                {surface.rule.kind === 'body' && surface.rule.vein?.picks && found && <VeinStretches surface={surface} found={found} here={here} onZoom={onZoomTo} />}
            </Part>
            <Part tab="surfacing" open={open}>
                {surface.rule.kind === 'shell' && surface.rule.method === 'indicator' ? (
                    <ShellCounting key={`${surface.id}:${surface.rule.share}:${surface.rule.local}`} rule={surface.rule} onChange={rule => updateSurface(surface.id, { rule })} />
                ) : surface.rule.kind === 'shell' && surface.rule.of ? (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        How even it is comes from how many pieces of hole are taken together, set in its numeric model.
                    </Typography>
                ) : (
                    <>
                        <Typography variant="caption" sx={label}><Term k={shell ? 'smoothingShell' : 'smoothing'} /></Typography>
                        {/* (Taken when it is let go: each change fits the surface again) */}
                        <CommitSlider
                            size="small" min={0} max={1} step={0.05} value={surface.params.follow} {...termProps('smoothing')}
                            onCommit={v => updateSurface(surface.id, { params: { follow: v } })}
                            marks={[{ value: 0, label: 'Through each' }, { value: 1, label: 'Smooth' }]}
                            sx={{ mx: 1, width: 'calc(100% - 16px)', '& .MuiSlider-markLabel': { fontSize: 11 }, '& .MuiSlider-markLabel[data-index="0"]': { transform: 'translateX(-8px)' }, '& .MuiSlider-markLabel[data-index="1"]': { transform: 'translateX(calc(-100% + 8px))' } }}
                        />
                    </>
                )}
                {!body && <Typography variant="caption" sx={label}><Term k="surfaceExtent" /></Typography>}
                {!body && <ToggleButtonGroup
                    size="small" exclusive fullWidth value={surface.params.extent}
                    onChange={(_, v) => {
                        if (!v) return;
                        updateSurface(surface.id, { params: { extent: v } });
                        // Nothing to keep inside yet: straight to drawing it
                        if (v === 'outline' && !surface.params.outline && !outlining && here) onOutline();
                    }}
                >
                    <ToggleButton value="near" sx={{ textTransform: 'none', py: 0.25, px: 0.5, fontSize: 11.5, whiteSpace: 'nowrap' }}>Near its points</ToggleButton>
                    <ToggleButton value="box" sx={{ textTransform: 'none', py: 0.25, px: 0.5, fontSize: 11.5, whiteSpace: 'nowrap' }}>Edge of the data</ToggleButton>
                    <ToggleButton value="outline" sx={{ textTransform: 'none', py: 0.25, px: 0.5, fontSize: 11.5, whiteSpace: 'nowrap' }}>An outline</ToggleButton>
                </ToggleButtonGroup>}
                {!body && surface.params.extent === 'outline' && (
                    <Box sx={{ mt: 0.5 }}>
                        <Button
                            size="small" fullWidth variant={outlining ? 'contained' : 'outlined'} disabled={!here} onClick={onOutline}
                            sx={{ textTransform: 'none', py: 0, fontSize: 12 }}
                        >
                            {outlining ? 'Drag around it in the view (Esc cancels)' : surface.params.outline ? 'Draw the outline again' : 'Draw the outline'}
                        </Button>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                            {surface.params.outline
                                ? 'The surface is kept inside the outline, as seen from where it was drawn.'
                                : 'Until an outline is drawn, the surface runs to the edge of the data.'}
                            {' '}Turn the view first (plan suits most surfaces), then drag around the part to keep.
                        </Typography>
                    </Box>
                )}
                {surface.rule.kind === 'shell' && shellInputs && (
                    <ShellReach key={`${surface.id}:${shellInputs.reachFactor}`} rule={surface.rule} factor={shellInputs.reachFactor} onChange={rule => updateSurface(surface.id, { rule })} />
                )}
                {(vein || thinSheets || (!body && surface.params.extent === 'near')) && auto > 0 && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                        <Tooltip title={thinSheets
                            ? 'How far it is drawn from the nearest place a hole meets it: further out nothing is known of it. Automatic: twice the gap that nearly all neighbouring stretches of it are within.'
                            : vein
                            ? 'How far the vein is carried from the nearest hole that meets it: it ends between half of this and all of it beyond the outermost. Automatic: one and a half times the widest gap between neighbouring holes that meet it.'
                            : 'How far the surface runs past its points. Automatic: the widest gap between neighbouring points (about the hole spacing), so it fills in between them.'}>
                            <Typography variant="caption" color="text.secondary" sx={{ width: 92, flexShrink: 0, whiteSpace: 'nowrap' }}>
                                Within {formatMetres(shownReach ?? reach)}
                            </Typography>
                        </Tooltip>
                        {/* Logarithmic, about the gap between neighbouring points */}
                        <CommitSlider
                            size="small" min={-REACH_DECADES} max={REACH_DECADES} step={0.02} aria-label="How far it reaches from its points" data-setting="reach"
                            value={Math.min(REACH_DECADES, Math.max(-REACH_DECADES, Math.log10(reach / auto)))}
                            onShow={v => setShownReach(v === null ? null : reachAt(v))}
                            onCommit={v => updateSurface(surface.id, { params: { reach: reachAt(v) } })}
                        />
                        {surface.params.reach !== null && (
                            <Tooltip title="Back to the automatic reach: the widest gap between neighbouring points">
                                <Button size="small" sx={smallButton} onClick={() => updateSurface(surface.id, { params: { reach: null } })}>Auto</Button>
                            </Tooltip>
                        )}
                    </Box>
                )}
                <SurfaceSettings surface={surface} cell={surface.params.resolution === null ? result?.stats?.cell ?? result?.stats?.body?.cell ?? null : null} onCopied={onCopied} />
                <Typography variant="caption" sx={label}>Names of its two sides</Typography>
                <Box sx={{ display: 'flex', gap: 1 }}>
                    {[0, 1].map(k => (
                        <TextField
                            key={k} size="small" variant="standard" fullWidth value={sides[k]} placeholder={automaticSides[k]}
                            onChange={e => setSides(k === 0 ? [e.target.value, sides[1]] : [sides[0], e.target.value])}
                            onBlur={commitSides} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLElement).blur(); }}
                            inputProps={{ 'aria-label': k === 0 ? 'Name of the first side' : 'Name of the second side', spellCheck: false, autoComplete: 'off', style: { fontSize: 13 } }}
                        />
                    ))}
                </Box>
            </Part>
            <Part tab="trend" open={open}>
                {surface.trendHeld && (result?.stats?.turned ?? 0) >= 1 && (
                    <Tooltip describeChild title="A surface is fitted about one overall plane. That plane is kept from one fit to the next, so that moving a point changes the surface near the point and does not tilt all of it. It is worked out afresh by itself once the points give one more than 5° away; this does it now.">
                        <Button size="small" sx={{ ...smallButton, mt: 0.25 }} onClick={() => updateSurface(surface.id, { trendHeld: null })}>Work out its overall lie again</Button>
                    </Tooltip>
                )}
                {(shell || (body && !vein)) && planesFollowed ? (
                    <Tooltip title={`It joins from hole to hole along the ground as the measurements the model follows say it lies, round folds and all, and stays thin across it. Untick for a ${shell ? 'shell' : 'body'} that takes no notice of them.`}>
                        <FormControlLabel
                            sx={{ mt: 0.5, ml: -0.75 }}
                            control={(
                                <Checkbox
                                    size="small" checked={surface.params.trend !== false} onChange={e => updateSurface(surface.id, { params: { trend: e.target.checked } })} sx={{ p: 0.5 }}
                                    inputProps={termProps('useTrendClosed') as React.InputHTMLAttributes<HTMLInputElement>}
                                />
                            )}
                            label={<Typography variant="caption">{t('useTrendClosed')}</Typography>}
                        />
                    </Tooltip>
                ) : body && !vein && structure && (
                    <Tooltip title={plain('useTrendGlobal')}><FormControlLabel
                        sx={{ mt: 0.5, ml: -0.75 }}
                        control={<Checkbox size="small" checked={surface.params.trend !== false} onChange={e => updateSurface(surface.id, { params: { trend: e.target.checked } })} sx={{ p: 0.5 }} />}
                        label={<Typography variant="caption">{t('useTrendGlobal')}</Typography>}
                    /></Tooltip>
                )}
                {veinPlunge && (
                    <Tooltip title={plain('useTrendVein')}><FormControlLabel
                        sx={{ mt: 0.5, ml: -0.75 }}
                        control={(
                            <Checkbox
                                size="small" checked={surface.params.trend !== false} onChange={e => updateSurface(surface.id, { params: { trend: e.target.checked } })} sx={{ p: 0.5 }}
                                inputProps={termProps('useTrendVein') as React.InputHTMLAttributes<HTMLInputElement>}
                            />
                        )}
                        label={<Typography variant="caption">{t('useTrendVein')}</Typography>}
                    /></Tooltip>
                )}
                {!body && readingsFollowed && (
                    <Tooltip title="Where it passes near measurements the model follows, it lies as they say: it leaves each of its points the way the ground lies there. Untick for a surface that cuts across what was measured (a fault through bedding).">
                        <FormControlLabel
                            sx={{ mt: 0.5, ml: -0.75 }}
                            control={(
                                <Checkbox
                                    size="small" checked={surface.params.trend !== false} onChange={e => updateSurface(surface.id, { params: { trend: e.target.checked } })} sx={{ p: 0.5 }}
                                    inputProps={termProps('useTrendSheet') as React.InputHTMLAttributes<HTMLInputElement>}
                                />
                            )}
                            label={<Typography variant="caption">{t('useTrendSheet')}</Typography>}
                        />
                    </Tooltip>
                )}
                {open !== 'all' && !trendSet && (
                    <Typography variant="caption" color="text.secondary" data-testid="no-trend" sx={{ display: 'block', mt: 0.5 }}>
                        Nothing in the model gives this surface a direction to follow yet: no global trend, and no measurements the model follows (Structural data, in the tree). The dip measurements and directions placed on its own points and lines, under Inputs, always count.
                    </Typography>
                )}
                <OwnTrend surface={surface} />
            </Part>
            <Part tab="outputs" open={open}>
                {!shell && <SurfaceMisfit surface={surface} field={result?.state === 'ready' ? result.field : null} found={found} sides={namedSides} onZoom={onZoomTo} />}
                {(surface.rule.kind === 'body' || (surface.rule.kind === 'shell' && !!surface.rule.of)) && (
                    <DrillCheckNote target={{ kind: 'surface', id: surface.id }} surfaceId={surface.id} />
                )}
                {surface.rule.kind === 'shell' && !surface.rule.of && shellInputs && shellInputs.holes > 0 && (
                    <ShellCheckNote surfaceId={surface.id} rule={surface.rule} fitKey={result?.key} ready={result?.state === 'ready'} averaged={shellInputs.holes > 0} />
                )}
                <Typography variant="caption" sx={label}>Tag every sample with</Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    {([
                        ['side', 'Its side', `A column saying which side of the surface each sample is on: “${namedSides[0]}” or “${namedSides[1]}”. Colour or filter any plot by it.`],
                        ['distance', 'Its distance', `A column of each sample's distance to the surface in metres, negative on the “${namedSides[1]}” side. Plot any element against it.`],
                        ...(vein ? [['thickness', 'Its thickness', 'A column of how thick the vein is where each sample is, in metres: how far apart its walls are there, square to it. Blank where the vein is not there. Plot grade against it, or multiply the two.']] : []),
                    ] as [SurfaceColumnKind, string, string][]).map(([kind, text, tip]) => {
                        const column = surface.columns[kind] ?? null;
                        return has(column) ? (
                            <Typography key={kind} variant="caption" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <Check fontSize="inherit" color="success" />
                                <Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Column “{column}”, kept up to date</Box>
                            </Typography>
                        ) : (
                            <Tooltip key={kind} title={tip} placement="left">
                                <span><Button size="small" variant="outlined" fullWidth sx={smallButton} disabled={result?.state !== 'ready'} onClick={() => addColumn(kind)}>{text} → new column</Button></span>
                            </Tooltip>
                        );
                    })}
                </Box>
                {surface.rule.kind === 'shell' && surface.rule.method === 'intercepts' && (
                    <Box sx={{ mt: 0.5 }}>
                        <Tooltip title="A column that says which samples are in an intercept. It is made from the drilling as it is now: make it again after changing the cut-off or the lengths." placement="left">
                            <span>
                                <Button size="small" variant="outlined" fullWidth sx={smallButton} onClick={() => setFlagged(writeInterceptColumn(surface.id))}>
                                    Samples in an intercept → new column
                                </Button>
                            </span>
                        </Tooltip>
                        {flagged && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>Written to the column “{flagged}”.</Typography>}
                    </Box>
                )}
                {problem && <Alert severity="warning" sx={{ mt: 0.5, py: 0, '& .MuiAlert-message': { fontSize: 12 } }} onClose={() => setProblem(null)}>{problem}</Alert>}
                {vein && (
                    <Box sx={{ mt: 0.75 }}>
                        <Tooltip title="Draws the vein pale where it is thin and dark where it is thick, in place of its one colour: where it swells and where it pinches is seen at once." placement="left">
                            <FormControlLabel
                                sx={{ ml: -0.75 }}
                                control={(
                                    <Checkbox
                                        size="small" checked={surface.shade === 'thickness'} sx={{ p: 0.5 }}
                                        onChange={e => updateSurface(surface.id, { shade: e.target.checked ? 'thickness' : undefined })}
                                        inputProps={{ 'data-testid': 'vein-shade' } as React.InputHTMLAttributes<HTMLInputElement>}
                                    />
                                )}
                                label={<Typography variant="caption">Colour it by how thick it is</Typography>}
                            />
                        </Tooltip>
                        {surface.shade === 'thickness' && shade && (
                            <Box data-testid="vein-shade-legend" sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>{formatMetres(shade.low)} or less</Typography>
                                <Box sx={{ flex: 1, height: 10, borderRadius: 0.5, border: 1, borderColor: 'divider', background: `linear-gradient(to right, ${SHADE_RAMP.join(', ')})` }} />
                                <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>{formatMetres(shade.high)} or more</Typography>
                            </Box>
                        )}
                    </Box>
                )}
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.25 }}>Save the mesh as</Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
                    {MESH_FORMATS.map(f => (
                        <Tooltip key={f.format} title={f.format === 'msh' ? 'Leapfrog mesh: Leapfrog\'s own format, with exact coordinates' : `${f.label}: opens in Leapfrog, Micromine, QGIS and other 3D packages`}>
                            <span><Button size="small" variant="outlined" sx={smallButton} disabled={!result?.part?.triangles.length} onClick={() => exportSurfaces([surface.id], f.format)}>{f.format.toUpperCase()}</Button></span>
                        </Tooltip>
                    ))}
                </Box>
                <Tooltip title="One zip with everything this surface was built from (its points, lines and dip measurements, as files Leapfrog reads), its mesh, and a note of how it was set: enough to build it again in Leapfrog, or to check one built there against it.">
                    <span>
                        <Button
                            size="small" variant="outlined" sx={{ ...smallButton, mt: 0.5 }}
                            disabled={surface.points.length + surface.polylines.length === 0 && !result?.part?.triangles.length}
                            data-action="export-kit" onClick={() => { if (!exportKit(surface.id)) setProblem('There is nothing to put in a Leapfrog export yet.'); }}
                        >
                            {t('leapfrogExport')} (.zip)
                        </Button>
                    </span>
                </Tooltip>
            </Part>
        </Box>
    );
};
