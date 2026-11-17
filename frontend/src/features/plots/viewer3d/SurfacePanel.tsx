/**
 * Surfaces panel beside the 3D view: the surfaces built in the project's
 * scene (shared by every 3D view and saved with the project). Build one by
 * clicking on drillholes, or through the selected samples; open one to move
 * its points, draw lines for it on a slice, shape it, name its sides, tag every sample with its side or its
 * distance to it, or export its mesh.
 *
 * The open surface is the one "being edited": the columns it fills in are
 * brought up to date when it is closed, not on every nudge of a slider.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert, Box, Button, Checkbox, CircularProgress, Collapse, FormControlLabel, IconButton, Paper, Slider, TextField,
    ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import { Add, AdsClick, CenterFocusStrong, Check, Close, DeleteOutline, ExpandLess, ExpandMore, Gesture, GridOn, SwapVert } from '@mui/icons-material';
import { useAppStore } from '../../../store/appStore';
import { useModelStore } from '../../../store/modelStore';
import { contactInputsFor, shellInputsFor, useModelCache } from '../../model/modelCache';
import { formatMetres, surfaceStatus } from '../../model/describe';
import { MESH_FORMATS } from '../../model/meshWriters';
import { exportSurfaces, unitsLabel } from '../../model/sceneActions';
import { surfaceSides, writeInterceptColumn, writeSurfaceColumns, type SurfaceColumnKind } from '../../model/surfaceColumns';
import { lineLength, sampleLines } from '../../model/lines';
import { surfacePoints, surfaceReach } from '../../model/surfaceJobs';
import { followedSets } from '../../model/trendField';
import { AUTO_REACH, DEFAULT_LOCAL, DEFAULT_SHARE } from '../../model/shell';
import type { ScenePolyline, ShellRule, SurfaceObject } from '../../model/types';
import { ShellCheckNote } from './ShellCheckNote';
import { sliceKind } from './slices';
import { StructurePanel } from './StructurePanel';
import { SurfaceHelp } from './SurfaceHelp';
import { SurfaceInputs } from './SurfaceInputs';

export const SURFACE_PANEL_WIDTH = 288;

export interface SurfacePanelProps {
    height: number;
    /** This view shows the coordinate columns the scene is in: its surfaces are drawn here */
    here: boolean;
    /** The scene's coordinate columns, for saying so when this view shows others */
    sceneColumns: string | null;
    /** Why a surface cannot be built in this view (null: it can) */
    blocked: string | null;
    selectedCount: number;
    /** A slice is on: points can be placed on it as well as on holes */
    canSlice: boolean;
    /** Start an empty surface, built by clicking in the view */
    onNew: () => void;
    /** Start drawing lines for the open surface (the view brings up a slice to draw on if there is none) */
    onDraw: () => void;
    /** Why a surface cannot be made from logging in this view (null: it can) */
    contactBlocked: string | null;
    /** Make a surface between logged units, or (with a surface) change the units of one made from logging */
    onContact: (surfaceId?: string) => void;
    /** Make a closed body round logged units */
    onBody: () => void;
    /** Make a shell round the high values of a column, or (with a surface) change the column and cut-off of one */
    onShell: (surfaceId?: string) => void;
    /** Take orientation readings for the whole model from columns */
    onReadings?: () => void;
    /** The model's direction from place to place is drawn on the slice of this view */
    trendOnSlice?: boolean;
    onTrendOnSlice?: (on: boolean) => void;
    /** Make a ground surface through the tops of the holes; what came of it, to tell the user (null: nothing to say) */
    onGround: () => { severity: 'info' | 'warning'; text: string } | null;
    /** Shown under the surfaces (the scene's wireframes) */
    children?: React.ReactNode;
    /** The view is waiting for the open surface's outline to be drawn */
    outlining: boolean;
    /** The next drag in the view draws the outline the open surface is kept inside (again: never mind) */
    onOutline: () => void;
    /** Build a surface through the selected samples; returns a note for the user, or null */
    onFromSelection: () => { severity: 'info' | 'warning'; text: string } | null;
    /** Switch this view to the scene's coordinate columns */
    onUseSceneColumns: () => void;
    /** Frame these world bounds in the view */
    onZoomTo: (bounds: { min: number[]; max: number[] }) => void;
    onClose: () => void;
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

/** Where a line was drawn, in a few words. */
function lineSlice(line: ScenePolyline): string {
    const at = (v: number) => Math.round(v).toLocaleString();
    const { normal, point } = line.plane;
    const kind = sliceKind(normal);
    return kind === 'we' ? `W-E section, ${at(point[1])} N`
        : kind === 'sn' ? `S-N section, ${at(point[0])} E`
            : kind === 'level' ? `Level, ${at(point[2])} m`
                : 'On a slice';
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

type DetailsProps = Pick<SurfacePanelProps, 'here' | 'canSlice' | 'onDraw' | 'outlining' | 'onOutline' | 'onContact' | 'onShell'> & { surface: SurfaceObject };

const SurfaceDetails: React.FC<DetailsProps> = ({ surface, here, canSlice, onDraw, outlining, onOutline, onContact, onShell }) => {
    const { updateSurface, removeSurface, setPicking, setDrawing, setHotLine, updatePolyline, removePolylines } = useModelStore.getState();
    const picking = useModelStore(s => s.picking);
    const drawing = useModelStore(s => s.drawing);
    const hotLine = useModelStore(s => s.hotLine);
    const result = useModelCache(s => s.byId[surface.id]);
    const columnNames = useAppStore(s => s.columns);
    const [name, setName] = useState(surface.name);
    const [sides, setSides] = useState<[string, string]>(surface.sides ?? ['', '']);
    const [problem, setProblem] = useState<string | null>(null);
    /** The column last written with the samples in an intercept */
    const [flagged, setFlagged] = useState<string | null>(null);
    useEffect(() => setName(surface.name), [surface.name]);
    useEffect(() => setSides(surface.sides ?? ['', '']), [surface.sides]);

    // From logging: what the dataset gives it now. Remembered per dataset and rule, so asking again costs nothing;
    // the two subscriptions are there to ask again when either changes
    useAppStore(s => s.columnarData);
    useModelStore(s => s.scene.coords);
    const structure = useModelStore(s => s.scene.structure?.overall ?? null);
    // Readings the model follows: a sheet or a contact can lie as they say
    const readingsFollowed = useModelStore(s => followedSets(s.scene.structure?.sets).length > 0);
    const planesFollowed = useModelStore(s => followedSets(s.scene.structure?.sets).some(set => set.kind === 'plane'));
    const found = contactInputsFor(surface);
    const shellInputs = shellInputsFor(surface);
    const status = surfaceStatus(surface, result, found, shellInputs, structure);
    // A shell follows its column alone: nothing is placed by hand
    const shell = surface.rule.kind === 'shell';
    // Closed (a body or a shell): no lines, readings or edge to it
    const body = surface.rule.kind === 'body' || shell;
    const auto = useMemo(() => surfaceReach(surfacePoints(surface, found), sampleLines(surface.polylines)), [surface, found]);
    const reach = surface.params.reach ?? auto;
    const namedSides = surfaceSides(surface, result?.trend ?? null);
    const automaticSides = surfaceSides({ ...surface, sides: null }, result?.trend ?? null);
    const has = (column: string | null) => !!column && columnNames.some(c => c.name === column);

    const commitName = () => {
        const next = name.trim();
        if (next && next !== surface.name) updateSurface(surface.id, { name: next });
        else setName(surface.name);
    };
    const commitSides = () => {
        const a = sides[0].trim(), b = sides[1].trim();
        // One name given: the other keeps its automatic name
        const next: [string, string] | null = a || b ? [a || automaticSides[0], b || automaticSides[1]] : null;
        if (JSON.stringify(next) !== JSON.stringify(surface.sides)) updateSurface(surface.id, { sides: next });
    };
    const addColumn = (kind: SurfaceColumnKind) => {
        const out = writeSurfaceColumns(surface.id, [kind]);
        setProblem(out.ok ? null : WRITE_PROBLEM[out.reason]);
    };

    return (
        <Box sx={{ px: 1, pb: 1 }}>
            <Typography variant="caption" color={status.problem ? 'warning.main' : 'text.primary'} sx={{ display: 'block' }}>
                {status.headline}
            </Typography>
            {status.notes.map(note => (
                <Typography key={note} variant="caption" color="text.secondary" sx={{ display: 'block' }}>{note}</Typography>
            ))}
            {surface.rule.kind === 'contact' && (
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, mt: 0.5 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 0 }}>
                        Where {unitsLabel(surface.rule.sideA)} gives way to {unitsLabel(surface.rule.sideB)} in {surface.rule.column}
                        {found ? `: in ${found.holesWithContact.toLocaleString()} of ${found.holes.toLocaleString()} holes.` : '.'}
                    </Typography>
                    <Button size="small" sx={smallButton} onClick={() => onContact(surface.id)}>Change</Button>
                </Box>
            )}
            {surface.rule.kind === 'shell' && (
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, mt: 0.5 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 0 }}>
                        {surface.rule.method === 'intercepts' ? `Round the intercepts of ${surface.rule.cutoff} or more in ${surface.rule.column}.`
                            : surface.rule.method === 'indicator' ? `Round where enough of the samples are ${surface.rule.cutoff} or more in ${surface.rule.column}.`
                            : `Round everything of ${surface.rule.cutoff} or more in ${surface.rule.column}.`}
                    </Typography>
                    <Button size="small" sx={smallButton} onClick={() => onShell(surface.id)}>Change</Button>
                </Box>
            )}
            {surface.rule.kind === 'body' && (
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, mt: 0.5 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 0 }}>
                        Round everything logged as {unitsLabel(surface.rule.inside)} in {surface.rule.column}
                        {found ? `: holes pass into or out of it in ${found.holesWithContact.toLocaleString()} of ${found.holes.toLocaleString()}.` : '.'}
                    </Typography>
                    <Button size="small" sx={smallButton} onClick={() => onContact(surface.id)}>Change</Button>
                </Box>
            )}

            {!shell && <Tooltip title={!here ? 'This view shows other coordinate columns than the surface was built in' : body ? 'Add, move and remove more places its skin passes through, in the 3D view' : 'Add, move and remove the points this surface runs through, in the 3D view'}>
                <span>
                    <ToggleButton
                        size="small" fullWidth value="place" selected={picking} disabled={!here} color="primary"
                        onChange={() => setPicking(!picking)} sx={{ textTransform: 'none', py: 0.25, mt: 0.75, gap: 0.5, fontSize: 12 }}
                    >
                        <AdsClick fontSize="small" />{picking ? 'Placing points: Esc when done' : 'Place and move its points'}
                    </ToggleButton>
                </span>
            </Tooltip>}
            {!body && <Tooltip title={here ? 'Draw the surface where you see it on a section. Lines let it bend and fold back on itself.' : 'This view shows other coordinate columns than the surface was built in'}>
                <span>
                    <ToggleButton
                        size="small" fullWidth value="draw" selected={drawing} disabled={!here} color="primary"
                        onChange={() => (drawing ? setDrawing(false) : onDraw())} sx={{ textTransform: 'none', py: 0.25, mt: 0.5, gap: 0.5, fontSize: 12 }}
                    >
                        <Gesture fontSize="small" />{drawing ? 'Drawing lines on the slice' : 'Draw lines on a slice'}
                    </ToggleButton>
                </span>
            </Tooltip>}
            {drawing ? (
                <Typography variant="caption" color={canSlice ? 'text.secondary' : 'warning.main'} sx={{ display: 'block', mt: 0.5 }}>
                    {canSlice
                        ? 'Click along the surface where you see it on the slice: each click is a node of the line. Double-click or Enter ends it. Or drag to draw it freehand. Then drag a node to move it, click the line to add one, right-click to remove. A line stays on its section: step the slice on, draw the next, and the surface runs from line to line.'
                        : 'Turn on Slice: lines are drawn on the slice.'}
                </Typography>
            ) : picking && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                    Click a drillhole to add a point: it snaps to the edge or the middle of the sample.
                    {canSlice ? ' Away from the holes, a click lands on the slice.' : ' Turn on Slice to place points between holes.'}
                    {' '}Drag a point to move it; right-click removes it. A point is at its place in space: a slice that has moved away from it hides it.
                    {' '}The view still turns and zooms as usual.
                </Typography>
            )}
            {!body && surface.polylines.length > 0 && (
                <Box sx={{ mt: 0.75 }} onMouseLeave={() => setHotLine(null)}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        Lines ({surface.polylines.length}). Their ticks point to the {namedSides[0].replace(/ side$/, '')} side.
                    </Typography>
                    {surface.polylines.map((line, i) => (
                        <Box
                            key={line.id} onMouseEnter={() => setHotLine(line.id)}
                            sx={{ display: 'flex', alignItems: 'center', pl: 0.5, borderRadius: 0.5, bgcolor: hotLine === line.id ? 'action.hover' : undefined }}
                        >
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography variant="caption" noWrap sx={{ display: 'block', lineHeight: 1.3 }}>
                                    Line {i + 1} · {formatMetres(lineLength(line.points))}{line.flipped ? ' · turned over' : ''}
                                </Typography>
                                <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', lineHeight: 1.3, fontSize: 11 }}>{lineSlice(line)}</Typography>
                            </Box>
                            <Tooltip title="Turn this line over: the surface's two sides swap along it. Use it if the surface twists or tears at this line.">
                                <IconButton size="small" aria-label={`Turn line ${i + 1} over`} color={line.flipped ? 'primary' : 'default'} onClick={() => updatePolyline(surface.id, line.id, { flipped: !line.flipped })}>
                                    <SwapVert fontSize="small" />
                                </IconButton>
                            </Tooltip>
                            <Tooltip title="Remove this line">
                                <IconButton size="small" aria-label={`Remove line ${i + 1}`} onClick={() => removePolylines(surface.id, [line.id])}>
                                    <DeleteOutline fontSize="small" />
                                </IconButton>
                            </Tooltip>
                        </Box>
                    ))}
                </Box>
            )}
            {!body && <SurfaceInputs surface={surface} here={here} />}

            <TextField
                size="small" fullWidth variant="standard" label="Name" value={name} sx={{ mt: 1 }}
                onChange={e => setName(e.target.value)} onBlur={commitName}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLElement).blur(); }}
                inputProps={{ spellCheck: false, autoComplete: 'off' }}
            />

            {shell && planesFollowed ? (
                <Tooltip title="It joins from hole to hole along the ground as the readings the model follows say it lies, round folds and all, and stays thin across it. Untick for a shell that takes no notice of them.">
                    <FormControlLabel
                        sx={{ mt: 0.5, ml: -0.75 }}
                        control={(
                            <Checkbox
                                size="small" checked={surface.params.trend !== false} onChange={e => updateSurface(surface.id, { params: { trend: e.target.checked } })} sx={{ p: 0.5 }}
                                inputProps={{ 'aria-label': "Follow the ground as the model's readings say it lies" }}
                            />
                        )}
                        label={<Typography variant="caption">Follow the ground as the model's readings say it lies</Typography>}
                    />
                </Tooltip>
            ) : body && structure && (
                <FormControlLabel
                    sx={{ mt: 0.5, ml: -0.75 }}
                    control={<Checkbox size="small" checked={surface.params.trend !== false} onChange={e => updateSurface(surface.id, { params: { trend: e.target.checked } })} sx={{ p: 0.5 }} />}
                    label={<Typography variant="caption">Follow the structure set for the model</Typography>}
                />
            )}
            {!body && readingsFollowed && (
                <Tooltip title="Where it passes near readings the model follows, it lies as they say: it leaves each of its points the way the ground lies there. Untick for a surface that cuts across what was measured (a fault through bedding).">
                    <FormControlLabel
                        sx={{ mt: 0.5, ml: -0.75 }}
                        control={(
                            <Checkbox
                                size="small" checked={surface.params.trend !== false} onChange={e => updateSurface(surface.id, { params: { trend: e.target.checked } })} sx={{ p: 0.5 }}
                                inputProps={{ 'aria-label': "Lie as the model's readings say" }}
                            />
                        )}
                        label={<Typography variant="caption">Lie as the model's readings say</Typography>}
                    />
                </Tooltip>
            )}

            {surface.rule.kind === 'shell' && surface.rule.method === 'indicator' ? (
                <ShellCounting key={`${surface.id}:${surface.rule.share}:${surface.rule.local}`} rule={surface.rule} onChange={rule => updateSurface(surface.id, { rule })} />
            ) : (
                <>
                    <Typography variant="caption" sx={label}>{shell ? 'How closely it follows the samples' : 'How closely it follows its points'}</Typography>
                    <Slider
                        size="small" min={0} max={1} step={0.05} value={surface.params.follow} aria-label="How closely it follows its points"
                        onChange={(_, v) => updateSurface(surface.id, { params: { follow: v as number } })}
                        marks={[{ value: 0, label: 'Through each' }, { value: 1, label: 'Smooth' }]}
                        sx={{ mx: 1, width: 'calc(100% - 16px)', '& .MuiSlider-markLabel': { fontSize: 11 }, '& .MuiSlider-markLabel[data-index="0"]': { transform: 'translateX(-8px)' }, '& .MuiSlider-markLabel[data-index="1"]': { transform: 'translateX(calc(-100% + 8px))' } }}
                    />
                </>
            )}

            {!body && <Typography variant="caption" sx={label}>Where it stops</Typography>}
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
            {surface.rule.kind === 'shell' && shellInputs && shellInputs.holes > 0 && (
                <ShellCheckNote surfaceId={surface.id} rule={surface.rule} fitKey={result?.key} ready={result?.state === 'ready'} averaged={shellInputs.holes > 0} />
            )}
            {!body && surface.params.extent === 'near' && auto > 0 && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                    <Tooltip title="How far the surface runs past its points. Automatic: the widest gap between neighbouring points (about the hole spacing), so it fills in between them.">
                        <Typography variant="caption" color="text.secondary" sx={{ width: 92, flexShrink: 0, whiteSpace: 'nowrap' }}>
                            Within {formatMetres(reach)}
                        </Typography>
                    </Tooltip>
                    {/* Logarithmic, about the gap between neighbouring points */}
                    <Slider
                        size="small" min={-REACH_DECADES} max={REACH_DECADES} step={0.02} aria-label="How far it reaches from its points"
                        value={Math.min(REACH_DECADES, Math.max(-REACH_DECADES, Math.log10(reach / auto)))}
                        onChange={(_, v) => updateSurface(surface.id, { params: { reach: Number((auto * 10 ** (v as number)).toPrecision(3)) } })}
                    />
                    {surface.params.reach !== null && (
                        <Tooltip title="Back to the automatic reach: the widest gap between neighbouring points">
                            <Button size="small" sx={smallButton} onClick={() => updateSurface(surface.id, { params: { reach: null } })}>Auto</Button>
                        </Tooltip>
                    )}
                </Box>
            )}

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                <Typography variant="caption" color="text.secondary" sx={{ width: 92, flexShrink: 0 }}>
                    {surface.opacity === 0 ? 'Edges only' : `Opacity ${Math.round(surface.opacity * 100)}%`}
                </Typography>
                <Slider size="small" min={0} max={1} step={0.05} value={surface.opacity} aria-label="Opacity" onChange={(_, v) => updateSurface(surface.id, { opacity: v as number })} />
            </Box>

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

            <Typography variant="caption" sx={label}>Tag every sample with</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                {([
                    ['side', 'Its side', `A column saying which side of the surface each sample is on: “${namedSides[0]}” or “${namedSides[1]}”. Colour or filter any plot by it.`],
                    ['distance', 'Its distance', `A column of each sample's distance to the surface in metres, negative on the “${namedSides[1]}” side. Plot any element against it.`],
                ] as [SurfaceColumnKind, string, string][]).map(([kind, text, tip]) => {
                    const column = surface.columns[kind];
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

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 1.25 }}>
                <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>Save the mesh as</Typography>
                {MESH_FORMATS.map(f => (
                    <Tooltip key={f.format} title={`${f.label}: opens in Leapfrog, Micromine, QGIS and other 3D packages`}>
                        <span><Button size="small" variant="outlined" sx={smallButton} disabled={!result?.part?.triangles.length} onClick={() => exportSurfaces([surface.id], f.format)}>{f.format.toUpperCase()}</Button></span>
                    </Tooltip>
                ))}
            </Box>
            <Button size="small" color="error" startIcon={<DeleteOutline fontSize="small" />} sx={{ ...smallButton, mt: 1 }} onClick={() => removeSurface(surface.id)}>
                Delete this surface
            </Button>
        </Box>
    );
};

export const SurfacePanel: React.FC<SurfacePanelProps> = ({
    height, here, sceneColumns, blocked, selectedCount, canSlice, onNew, onDraw, outlining, onOutline, onFromSelection, onUseSceneColumns, onZoomTo, onClose, children,
    contactBlocked, onContact, onBody, onShell, onGround, onReadings, trendOnSlice, onTrendOnSlice,
}) => {
    const surfaces = useModelStore(s => s.scene.surfaces);
    const openId = useModelStore(s => s.editingId);
    const fits = useModelCache(s => s.byId);
    const { updateSurface, setEditing } = useModelStore.getState();
    const [note, setNote] = useState<{ severity: 'info' | 'warning'; text: string } | null>(null);
    const [help, setHelp] = useState(false);

    // Closing the panel closes the open surface (its columns are then brought up to date)
    useEffect(() => () => useModelStore.getState().setEditing(null), []);

    const cannotBuild = blocked ?? (selectedCount < 2 ? 'Select the samples the surface should run through first (lasso or box select).' : null);

    // The buttons and the list scroll as one, and an opened surface is brought to the top: its settings get the whole panel
    const scroller = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const box = scroller.current;
        const row = openId && box ? box.querySelector<HTMLElement>(`[data-surface="${openId}"]`) : null;
        if (box && row) box.scrollTo?.({ top: box.scrollTop + row.getBoundingClientRect().top - box.getBoundingClientRect().top });
    }, [openId]);

    return (
        <Paper data-testid="surface-panel" variant="outlined" sx={{ width: SURFACE_PANEL_WIDTH, flexShrink: 0, height, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <Box sx={{ p: 0.75, pl: 1, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Typography variant="subtitle2" sx={{ flex: 1 }}>Surfaces</Typography>
                <Tooltip describeChild title="How surfaces are fitted: a short guide with pictures you can change">
                    <Button size="small" sx={smallButton} onClick={() => setHelp(true)}>How it works</Button>
                </Tooltip>
                <Tooltip title="Close this panel"><IconButton size="small" aria-label="Close the surface list" onClick={onClose}><Close fontSize="small" /></IconButton></Tooltip>
            </Box>
            <SurfaceHelp open={help} onClose={() => setHelp(false)} />
            <Box ref={scroller} data-testid="surface-scroll" sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            <Box sx={{ px: 1, pb: 1 }}>
                <Tooltip title={blocked ?? 'Start a surface and click on drillholes to place the points it runs through. Three clicks make a plane; more make it bend.'}>
                    <span>
                        <Button size="small" variant="contained" fullWidth disabled={!!blocked} startIcon={<Add fontSize="small" />} sx={{ textTransform: 'none' }} onClick={() => { setNote(null); onNew(); }}>
                            New surface: click on holes
                        </Button>
                    </span>
                </Tooltip>
                <Tooltip title={cannotBuild ?? 'Fit a surface through the selected samples. It can bend and fold to follow them.'}>
                    <span>
                        <Button size="small" variant="outlined" fullWidth disabled={!!cannotBuild} sx={{ textTransform: 'none', mt: 0.75 }} onClick={() => setNote(onFromSelection())}>
                            Surface through the selection{selectedCount >= 2 && !blocked ? ` (${selectedCount.toLocaleString()})` : ''}
                        </Button>
                    </span>
                </Tooltip>
                <Tooltip title={blocked ?? contactBlocked ?? 'From a logging column: the surface is put where one group of units gives way to another down each drillhole. The base of oxidation, a lithological contact.'}>
                    <span>
                        <Button size="small" variant="outlined" fullWidth disabled={!!(blocked ?? contactBlocked)} sx={{ textTransform: 'none', mt: 0.75 }} onClick={() => { setNote(null); onContact(); }}>
                            Surface between logged units
                        </Button>
                    </span>
                </Tooltip>
                <Tooltip title={blocked ?? contactBlocked ?? 'From a logging column: a closed surface round one or more units, with its volume. A vein, an intrusion, an ore zone. Every sample can then be tagged as inside or outside it.'}>
                    <span>
                        <Button size="small" variant="outlined" fullWidth disabled={!!(blocked ?? contactBlocked)} sx={{ textTransform: 'none', mt: 0.75 }} onClick={() => { setNote(null); onBody(); }}>
                            Body round logged units
                        </Button>
                    </span>
                </Tooltip>
                <Tooltip title={blocked ?? 'From a column of numbers: a closed surface round everything at or above a cut-off, with its volume. A grade shell, an alteration halo, an anomaly.'}>
                    <span>
                        <Button size="small" variant="outlined" fullWidth disabled={!!blocked} sx={{ textTransform: 'none', mt: 0.75 }} onClick={() => { setNote(null); onShell(); }}>
                            Shell round high values
                        </Button>
                    </span>
                </Tooltip>
                <Tooltip title={blocked ?? contactBlocked ?? 'A surface through the top of every drillhole: the ground, as far as the holes know it. It can be reshaped like any surface.'}>
                    <span>
                        <Button size="small" variant="outlined" fullWidth disabled={!!(blocked ?? contactBlocked)} sx={{ textTransform: 'none', mt: 0.75 }} onClick={() => setNote(onGround())}>
                            Ground from the hole collars
                        </Button>
                    </span>
                </Tooltip>
                {note && <Alert severity={note.severity} sx={{ mt: 0.75, py: 0, '& .MuiAlert-message': { fontSize: 12 } }} onClose={() => setNote(null)}>{note.text}</Alert>}
                {!here && surfaces.length > 0 && (
                    <Alert severity="warning" sx={{ mt: 0.75, py: 0, '& .MuiAlert-message': { fontSize: 12 } }} action={<Button size="small" color="inherit" sx={smallButton} onClick={onUseSceneColumns}>Show them</Button>}>
                        The surfaces were built in the columns {sceneColumns}. This view shows other columns, so they are not drawn here.
                    </Alert>
                )}
            </Box>

            <StructurePanel blocked={blocked} onFromColumns={onReadings} showOnSlice={trendOnSlice} onShowOnSlice={onTrendOnSlice} />

            <Box data-testid="surface-list" sx={{ borderTop: 1, borderColor: 'divider' }}>
                {surfaces.length === 0 ? (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', p: 1 }}>
                        No surfaces yet. Start one and click along a fault, a contact or any other boundary on the drillholes;
                        select the samples it runs through and fit it through the selection;
                        or have one put between logged units, round them, or round the high values of a column.
                        Surfaces are saved with the project and shown in every 3D view.
                    </Typography>
                ) : surfaces.map(surface => {
                    const open = surface.id === openId;
                    const result = fits[surface.id];
                    return (
                        <Box key={surface.id} data-surface={surface.id} sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: open ? 'action.hover' : undefined }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, pl: 0.25, pr: 0.5 }}>
                                <Checkbox size="small" checked={surface.visible} sx={{ p: 0.5 }} inputProps={{ 'aria-label': `Show ${surface.name}` }} onChange={e => updateSurface(surface.id, { visible: e.target.checked })} />
                                <Tooltip title="Colour">
                                    <input
                                        type="color" value={surface.color} aria-label={`Colour of ${surface.name}`}
                                        onChange={e => updateSurface(surface.id, { color: e.target.value })}
                                        style={{ width: 22, height: 22, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer', flexShrink: 0 }}
                                    />
                                </Tooltip>
                                <Typography
                                    variant="body2" noWrap role="button" tabIndex={0} aria-expanded={open}
                                    onClick={() => setEditing(open ? null : surface.id)}
                                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditing(open ? null : surface.id); } }}
                                    sx={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: open ? 600 : 400, cursor: 'pointer', py: 0.5 }}
                                >
                                    {surface.name}
                                </Typography>
                                {result?.state === 'fitting' && <CircularProgress size={12} sx={{ flexShrink: 0 }} />}
                                <Tooltip title="Show the triangle edges">
                                    <IconButton size="small" sx={{ p: 0.25 }} color={surface.showEdges ? 'primary' : 'default'} onClick={() => updateSurface(surface.id, { showEdges: !surface.showEdges })}><GridOn fontSize="small" /></IconButton>
                                </Tooltip>
                                <Tooltip title="Zoom to">
                                    <span><IconButton size="small" sx={{ p: 0.25 }} disabled={!here || !result?.part?.triangles.length} onClick={() => result?.part && onZoomTo(result.part.bounds)}><CenterFocusStrong fontSize="small" /></IconButton></span>
                                </Tooltip>
                                <Tooltip title={open ? 'Close' : 'Shape it, name its sides, tag samples, export'}>
                                    <IconButton size="small" sx={{ p: 0.25 }} aria-label={open ? `Close ${surface.name}` : `Open ${surface.name}`} onClick={() => setEditing(open ? null : surface.id)}>
                                        {open ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
                                    </IconButton>
                                </Tooltip>
                            </Box>
                            <Collapse in={open} unmountOnExit>
                                <SurfaceDetails surface={surface} here={here} canSlice={canSlice} onDraw={onDraw} outlining={outlining} onOutline={onOutline} onContact={onContact} onShell={onShell} />
                            </Collapse>
                        </Box>
                    );
                })}
            </Box>
            </Box>
            {children && <Box sx={{ flexShrink: 0, maxHeight: '45%', overflowY: 'auto', borderTop: 1, borderColor: 'divider' }}>{children}</Box>}
        </Paper>
    );
};
