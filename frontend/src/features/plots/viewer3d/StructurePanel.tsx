/**
 * The structure of the ground, set by hand for the whole model: a plane
 * that things run along and, within it, a direction they run furthest in
 * (features/model/structure). Shells and bodies are fitted along it unless
 * they are told not to follow it; changing it fits them all again.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Box, Button, Checkbox, Collapse, IconButton, Slider, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useModelStore } from '../../../store/modelStore';
import { sceneTrendField, useModelCache } from '../../model/modelCache';
import { structureFromSet } from '../../model/sceneActions';
import { discardSuggested, keepSuggested, suggestFrom, suggestSources } from '../../model/suggestActions';
import { useWireframeFiles } from '../../model/wireframeFiles';
import { DEFAULT_LINE_STRENGTH, DEFAULT_STRENGTH, MAX_LINE_STRENGTH, MAX_STRENGTH, structureText } from '../../model/structure';
import { anglesText, cleanLine, cleanPlane, setText } from '../../model/structureReadings';
import type { OverallStructure, ReadingSet } from '../../model/types';

const smallButton = { minWidth: 0, px: 0.75, py: 0, height: 24, fontSize: 12, textTransform: 'none', whiteSpace: 'nowrap' } as const;
const label = { display: 'block', mt: 1, color: 'text.secondary' } as const;

const typed = (text: string): number | null => {
    const v = Number(text.trim());
    return text.trim() !== '' && Number.isFinite(v) ? v : null;
};
const shown = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(Number(v.toFixed(1))));

const NO_SETS: ReadingSet[] = [];

interface Props {
    /** Why readings cannot be added in this view (null: they can) */
    blocked?: string | null;
    /** Bring up the dialog that takes readings from columns */
    onFromColumns?: () => void;
    /** The direction from place to place is drawn on the slice of the view (left out: the view has no such choice) */
    showOnSlice?: boolean;
    onShowOnSlice?: (on: boolean) => void;
}

/** How the direction is taken from place to place, and how far a reading carries */
const Field: React.FC<Pick<Props, 'showOnSlice' | 'onShowOnSlice'>> = ({ showOnSlice, onShowOnSlice }) => {
    const structure = useModelStore(s => s.scene.structure);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the field is kept for the structure as it is now
    const field = useMemo(() => sceneTrendField(), [structure]);
    const given = structure?.range ?? null;
    const [typedRange, setTypedRange] = useState(shown(given));
    useEffect(() => setTypedRange(shown(given)), [given]);
    if (!field || field.planes + field.lines === 0) {
        return (
            <Typography data-testid="structure-field-text" variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
                The model follows none of these yet. Tick the readings of the one thing it should follow (the bedding, say) to have its direction change from place to place.
            </Typography>
        );
    }
    const commit = () => {
        const v = typed(typedRange);
        useModelStore.getState().setStructureRange(v !== null && v > 0 ? v : null);
        if (v === null || !(v > 0)) setTypedRange('');
    };
    const n = field.planes + field.lines;
    return (
        <Box data-testid="structure-field" sx={{ mt: 0.75 }}>
            <Typography data-testid="structure-field-text" variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                From place to place the direction is taken from the {n.toLocaleString()} {n === 1 ? 'reading' : 'readings'} ticked, each carrying {field.autoRange ? 'about ' : ''}
                {Number(field.range.toPrecision(3)).toLocaleString()} m{field.autoRange ? ' (from how they are spaced)' : ''}. Away from them it is{' '}
                {field.overall ? 'the one direction above.' : 'not known: set the one direction above to have one there too.'}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1, mt: 0.5 }}>
                <Tooltip title="How far from a reading its direction still counts: fully at the reading, less and less out to this distance. Longer smooths over more of the ground; shorter follows each reading more closely. Empty: twice the usual distance between readings.">
                    <TextField
                        size="small" variant="standard" label="A reading carries (m)" value={typedRange} onChange={e => setTypedRange(e.target.value)} onBlur={commit}
                        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLElement).blur(); }} placeholder={`${Number(field.range.toPrecision(3))}`} sx={{ width: 130 }}
                        inputProps={{ inputMode: 'decimal', spellCheck: false, autoComplete: 'off' }} InputLabelProps={{ shrink: true }}
                    />
                </Tooltip>
                {onShowOnSlice && (
                    <Tooltip title="With a slice on: short lines across it, each along the ground as it lies there. Dark where readings say how it lies, pale where it is the one direction above.">
                        <Box component="label" sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                            <Checkbox size="small" sx={{ p: 0.25 }} checked={!!showOnSlice} onChange={e => onShowOnSlice(e.target.checked)} inputProps={{ 'aria-label': 'Show it on the slice' }} />
                            <Typography variant="caption">Show it on the slice</Typography>
                        </Box>
                    </Tooltip>
                )}
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                Clicking a sample says how the ground lies there. Sheets and contacts lie as it says where they pass near readings, and shells
                follow readings of planes from place to place, round folds (each has a switch for it). Bodies from logging follow only the
                one direction above.
            </Typography>
        </Box>
    );
};

const STRAIGHT_THROUGH = 'It is taken as passing straight through the slice: right when the slice cuts square across the structure, as a section across the strike does.';

/** Readings put in by hand: the angles typed and each click in the view placing one, or a stroke drawn along the structure on the slice */
const ByHand: React.FC = () => {
    const tool = useModelStore(s => s.structureTool);
    const { setStructureTool } = useModelStore.getState();
    const [kind, setKind] = useState<'plane' | 'line'>('plane');
    const [dip, setDip] = useState('');
    const [direction, setDirection] = useState('');
    const d = typed(dip), a = typed(direction);
    const angles = d === null || a === null || d < 0 || d > 90 ? null : kind === 'plane' ? cleanPlane(d, a) : cleanLine(d, a);
    const placing = tool?.mode === 'place', drawing = tool?.mode === 'stroke' && tool.target !== 'overall';
    // What is typed while placing is what the next click places
    useEffect(() => {
        const now = useModelStore.getState().structureTool;
        if (now?.mode !== 'place') return;
        if (!angles) setStructureTool(null);
        else if (now.kind !== kind || now.dip !== angles.dip || now.direction !== angles.direction) setStructureTool({ mode: 'place', kind, ...angles });
        // eslint-disable-next-line react-hooks/exhaustive-deps -- by what the angles are, not the object they come in
    }, [kind, angles?.dip, angles?.direction]);
    // The stroke gives the kind chosen here
    useEffect(() => {
        const now = useModelStore.getState().structureTool;
        if (now?.mode === 'stroke' && now.target !== 'overall' && now.target !== kind) setStructureTool({ mode: 'stroke', target: kind });
        // eslint-disable-next-line react-hooks/exhaustive-deps -- when the kind changes
    }, [kind]);
    const field = { size: 'small', variant: 'standard', inputProps: { inputMode: 'decimal', spellCheck: false, autoComplete: 'off' }, InputLabelProps: { shrink: true } } as const;
    const one = kind === 'plane' ? 'plane' : 'line';
    return (
        <Box data-testid="readings-by-hand" sx={{ mt: 0.5, p: 0.75, border: 1, borderColor: 'divider', borderRadius: 1 }}>
            <ToggleButtonGroup size="small" exclusive fullWidth value={kind} onChange={(_, v) => { if (v) setKind(v); }} aria-label="What is being set">
                <ToggleButton value="plane" sx={{ textTransform: 'none', py: 0, fontSize: 12 }}>A plane</ToggleButton>
                <ToggleButton value="line" sx={{ textTransform: 'none', py: 0, fontSize: 12 }}>A line</ToggleButton>
            </ToggleButtonGroup>
            <Box sx={{ display: 'flex', gap: 1, mt: 0.75 }}>
                <TextField {...field} label={kind === 'plane' ? 'Dip (°)' : 'Plunge (°)'} value={dip} onChange={e => setDip(e.target.value)} error={dip.trim() !== '' && (d === null || d < 0 || d > 90)} placeholder="0 to 90" />
                <TextField {...field} label={kind === 'plane' ? 'Dips towards (°)' : 'Plunges towards (°)'} value={direction} onChange={e => setDirection(e.target.value)} error={direction.trim() !== '' && a === null} placeholder="0 to 360" />
            </Box>
            <Box sx={{ display: 'flex', gap: 0.5, mt: 0.75 }}>
                <Tooltip title={`Type the angles, then click where the ${one} was measured: on a drillhole or, with a slice on, on the slice. Every click places one more.`}>
                    <span style={{ flex: 1 }}>
                        <Button
                            size="small" fullWidth variant={placing ? 'contained' : 'outlined'} sx={smallButton} disabled={!angles && !placing}
                            onClick={() => setStructureTool(placing || !angles ? null : { mode: 'place', kind, ...angles })}
                        >
                            {placing ? 'Stop placing' : 'Place by clicking'}
                        </Button>
                    </span>
                </Tooltip>
                <Tooltip title={`With a slice on, drag along the ${one} where it shows on the slice: no angles are needed. ${kind === 'plane' ? STRAIGHT_THROUGH : 'The line is taken as lying in the slice.'}`}>
                    <span style={{ flex: 1 }}>
                        <Button size="small" fullWidth variant={drawing ? 'contained' : 'outlined'} sx={smallButton} onClick={() => setStructureTool(drawing ? null : { mode: 'stroke', target: kind })}>
                            {drawing ? 'Stop drawing' : 'Draw on the slice'}
                        </Button>
                    </span>
                </Tooltip>
            </Box>
            {(placing || drawing) && (
                <Typography data-testid="by-hand-doing" variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                    {placing && tool?.mode === 'place'
                        ? `Each click on a drillhole, or on the slice, puts a ${one} ${anglesText(tool.kind, tool)} there.`
                        : `Each drag along the ${one} on the slice puts one there. ${kind === 'plane' ? STRAIGHT_THROUGH : 'It is taken as lying in the slice.'}`}
                    {' '}Right-click one set by hand to remove it. Esc when done.
                </Typography>
            )}
        </Box>
    );
};

const NOT_SUGGESTED = {
    holes: 'It needs the hole and depth columns: the highs are taken hole by hole.',
    nothing: 'Nothing there lies close enough to one plane to suggest any.',
    gone: 'It is no longer there.',
} as const;

/** Readings worked out from something in the model: asked for here, then kept or thrown away one set at a time */
const Suggest: React.FC<{ open: boolean }> = ({ open }) => {
    const suggestion = useModelStore(s => s.suggestion);
    const surfaces = useModelStore(s => s.scene.surfaces);
    const wireframes = useModelStore(s => s.scene.wireframes);
    const fits = useModelCache(s => s.byId);
    const files = useWireframeFiles(s => s.byFile);
    // (What can be suggested from changes with the surfaces, their fits and the wireframes)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- they are what the list is read from
    const sources = useMemo(() => suggestSources(), [surfaces, wireframes, fits, files]);
    const [from, setFrom] = useState('');
    const [said, setSaid] = useState<string | null>(null);
    const chosen = sources.find(s => s.key === from) ?? sources[0] ?? null;
    const go = () => {
        if (!chosen) return;
        const got = suggestFrom(chosen.source);
        setSaid(got.ok ? null : NOT_SUGGESTED[got.reason]);
    };
    const keep = (i: number) => setSaid(keepSuggested(i) ? null : 'The model has as many sets of readings as it can hold: remove one first.');
    if (!open && !suggestion) return null;
    return (
        <Box data-testid="readings-suggest" sx={{ mt: 0.5, p: 0.75, border: 1, borderColor: 'divider', borderRadius: 1 }}>
            {open && (sources.length === 0 ? (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    Nothing to suggest from yet: it takes a fitted surface, a shell or a wireframe.
                </Typography>
            ) : (
                <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.5 }}>
                    <TextField
                        select size="small" variant="standard" label="From" value={chosen?.key ?? ''} onChange={e => setFrom(e.target.value)} sx={{ flex: 1, minWidth: 0 }}
                        SelectProps={{ native: true }} InputLabelProps={{ shrink: true }} inputProps={{ 'aria-label': 'Suggest readings from' }}
                    >
                        {sources.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </TextField>
                    <Tooltip title="Work out readings from it and draw them in grey in the view. Nothing in the model changes until you keep them.">
                        <span><Button size="small" variant="outlined" sx={smallButton} onClick={go}>Suggest</Button></span>
                    </Tooltip>
                </Box>
            ))}
            {said && <Typography data-testid="suggest-said" variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>{said}</Typography>}
            {suggestion && (
                <Box data-testid="suggested" sx={{ mt: open ? 0.75 : 0 }}>
                    {suggestion.sets.map((set, i) => (
                        <Box key={set.name} sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, mt: 0.25 }}>
                            <Box sx={{ width: 10, height: 10, borderRadius: set.kind === 'plane' ? '50%' : 0, bgcolor: '#9e9e9e', mt: '6px', flexShrink: 0 }} />
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography variant="body2" sx={{ fontSize: 13 }} noWrap title={set.name}>{set.name}</Typography>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.3 }}>{setText(set)}</Typography>
                            </Box>
                            <Button size="small" variant="outlined" sx={smallButton} aria-label={`Keep ${set.name}`} onClick={() => keep(i)}>Keep</Button>
                            <Button size="small" sx={smallButton} aria-label={`Discard ${set.name}`} onClick={() => discardSuggested(i)}>Discard</Button>
                        </Box>
                    ))}
                    {suggestion.note && suggestion.sets.some(s => s.kind === 'plane') && (
                        <Typography data-testid="suggest-note" variant="caption" sx={{ display: 'block', mt: 0.5 }}>{suggestion.note}</Typography>
                    )}
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                        Suggested, and drawn in grey in the 3D view: they say what shape it has, not what made it that shape. Nothing is added to the
                        model until you keep them, and what you keep is not followed until you tick it.
                    </Typography>
                </Box>
            )}
        </Box>
    );
};

/** The sets of readings measured place by place: shown, hidden, removed; a set's average made the model's direction */
const Readings: React.FC<Props & { hasPlane: boolean }> = ({ blocked = null, onFromColumns, hasPlane, showOnSlice, onShowOnSlice }) => {
    const sets = useModelStore(s => s.scene.structure?.sets ?? NO_SETS);
    const { updateReadingSet, removeReadingSet } = useModelStore.getState();
    const [byHand, setByHand] = useState(false);
    const [suggesting, setSuggesting] = useState(false);
    const closeByHand = () => {
        const tool = useModelStore.getState().structureTool;
        if (tool && !(tool.mode === 'stroke' && tool.target === 'overall')) useModelStore.getState().setStructureTool(null);
        setByHand(false);
    };
    return (
        <Box data-testid="structure-readings" sx={{ mt: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 0.5 }}>
                <Typography variant="caption" sx={{ flex: 1, fontWeight: 600 }}>Readings</Typography>
                {onFromColumns && (
                    <Tooltip title={blocked ?? 'Dips and dip directions (or strikes), or plunges and trends, from columns of the open data or of a CSV file.'}>
                        <span><Button size="small" variant="outlined" sx={smallButton} disabled={!!blocked} onClick={onFromColumns}>From columns</Button></span>
                    </Tooltip>
                )}
                <Tooltip title={blocked ?? 'Put readings in yourself: type the angles and click where each was measured, or draw along the structure on a slice.'}>
                    <span><Button size="small" variant={byHand ? 'contained' : 'outlined'} sx={smallButton} disabled={!!blocked} onClick={() => (byHand ? closeByHand() : setByHand(true))}>By hand</Button></span>
                </Tooltip>
                <Tooltip title={blocked ?? 'Have readings worked out from what is in the model: the faces of a fitted surface or a wireframe, or the places a shell\'s column is high. They are offered for you to keep or throw away.'}>
                    <span><Button size="small" variant={suggesting ? 'contained' : 'outlined'} sx={smallButton} disabled={!!blocked} onClick={() => setSuggesting(!suggesting)}>Suggest</Button></span>
                </Tooltip>
            </Box>
            {byHand && !blocked && <ByHand />}
            {!blocked && <Suggest open={suggesting} />}
            {sets.length === 0 ? (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    None yet: the lie of the ground measured place by place, as planes (bedding, veins) or lines (a lineation, fold axes).
                </Typography>
            ) : (
                <>
                    {sets.map(set => (
                        <Box key={set.id} data-testid={`reading-set-${set.id}`} sx={{ display: 'flex', alignItems: 'flex-start', mt: 0.25 }}>
                            <Checkbox
                                size="small" sx={{ p: 0.25, mt: '1px' }} checked={set.visible} onChange={e => updateReadingSet(set.id, { visible: e.target.checked })}
                                inputProps={{ 'aria-label': `Show ${set.name}` }}
                            />
                            <Box sx={{ width: 10, height: 10, borderRadius: set.kind === 'plane' ? '50%' : 0, bgcolor: set.color, mt: '8px', mx: 0.5, flexShrink: 0 }} />
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography variant="body2" sx={{ fontSize: 13 }} noWrap title={set.name}>{set.name}</Typography>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.3 }}>{set.source === 'suggested' ? 'Suggested, not measured. ' : ''}{setText(set)}</Typography>
                                <Tooltip title="Ticked, these readings are part of the direction the model takes from place to place. Tick the readings of one thing (the bedding, say), not of things that cut across each other.">
                                    <Box component="label" sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer', mt: 0.25 }}>
                                        <Checkbox
                                            size="small" sx={{ p: 0, mr: 0.5 }} checked={set.follow !== false} onChange={e => updateReadingSet(set.id, { follow: e.target.checked })}
                                            inputProps={{ 'aria-label': `The model follows ${set.name}` }}
                                        />
                                        <Typography variant="caption">The model follows these</Typography>
                                    </Box>
                                </Tooltip>
                                <Tooltip title={set.kind === 'plane'
                                    ? 'Make the plane these lie closest to the one direction above. Shells and bodies that follow it are fitted again.'
                                    : hasPlane ? 'Make the bearing these plunge towards the long direction within the plane above.' : 'Set the plane above first: a long direction lies within it.'}>
                                    <span>
                                        <Button size="small" sx={{ ...smallButton, px: 0, mt: 0.25 }} disabled={set.kind === 'line' && !hasPlane} onClick={() => structureFromSet(set.id)}>
                                            {set.kind === 'plane' ? 'Use as the direction above' : 'Use as the long direction above'}
                                        </Button>
                                    </span>
                                </Tooltip>
                            </Box>
                            <Tooltip title="Remove these readings from the model">
                                <IconButton size="small" sx={{ p: 0.25 }} aria-label={`Remove ${set.name}`} onClick={() => removeReadingSet(set.id)}><CloseIcon sx={{ fontSize: 14 }} /></IconButton>
                            </Tooltip>
                        </Box>
                    ))}
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                        Readings are drawn in the 3D view: planes as discs with a tick down the dip, lines as arrows down the plunge.
                    </Typography>
                    <Field showOnSlice={showOnSlice} onShowOnSlice={onShowOnSlice} />
                </>
            )}
        </Box>
    );
};

export const StructurePanel: React.FC<Props> = ({ blocked, onFromColumns, showOnSlice, onShowOnSlice }) => {
    const overall = useModelStore(s => s.scene.structure?.overall ?? null);
    const strokeForIt = useModelStore(s => s.structureTool?.mode === 'stroke' && s.structureTool.target === 'overall');
    const followers = useModelStore(s => s.scene.surfaces.filter(x => (x.rule.kind === 'shell' || x.rule.kind === 'body') && x.params.trend !== false).length);
    const { setStructure } = useModelStore.getState();
    const [open, setOpen] = useState(false);
    const [dip, setDip] = useState(shown(overall?.dip));
    const [direction, setDirection] = useState(shown(overall?.dipDirection));
    const [trend, setTrend] = useState(shown(overall?.lineTrend));
    const [strength, setStrength] = useState(overall?.strength ?? DEFAULT_STRENGTH);
    const [lineStrength, setLineStrength] = useState(overall?.lineStrength ?? DEFAULT_LINE_STRENGTH);
    // What is typed follows the scene when that changes from elsewhere (undo, a project opened)
    useEffect(() => {
        setDip(shown(overall?.dip));
        setDirection(shown(overall?.dipDirection));
        setTrend(shown(overall?.lineTrend));
        setStrength(overall?.strength ?? DEFAULT_STRENGTH);
        setLineStrength(overall?.lineStrength ?? DEFAULT_LINE_STRENGTH);
    }, [overall]);

    const d = typed(dip), a = typed(direction), t = typed(trend);
    const valid = d !== null && a !== null && d >= 0 && d <= 90;
    /** Set it from what is typed (with one of the sliders at a new place) */
    const commit = (patch: Partial<OverallStructure> = {}) => {
        if (!valid) return;
        setStructure({ dip: d, dipDirection: a, lineTrend: trend.trim() === '' ? null : t, strength, lineStrength, ...patch });
    };
    const onKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter') (e.target as HTMLElement).blur(); };
    const field = { size: 'small', variant: 'standard', onBlur: () => commit(), onKeyDown: onKey, inputProps: { inputMode: 'decimal', spellCheck: false, autoComplete: 'off' }, InputLabelProps: { shrink: true } } as const;

    return (
        <Box data-testid="structure-panel" sx={{ borderTop: 1, borderColor: 'divider', px: 1, py: 0.75 }}>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="subtitle2" sx={{ fontSize: 13 }}>Structure</Typography>
                    <Typography data-testid="structure-summary" variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {overall ? `${structureText(overall).replace(/^./, c => c.toUpperCase())}. ${followers === 0 ? 'No shell or body follows it yet.' : `${followers} ${followers === 1 ? 'surface follows' : 'surfaces follow'} it.`}`
                            : 'None set: shells and bodies are fitted the same in every direction.'}
                    </Typography>
                </Box>
                <Button size="small" sx={smallButton} onClick={() => setOpen(!open)}>{open ? 'Done' : overall ? 'Change' : 'Set'}</Button>
            </Box>
            <Collapse in={open} unmountOnExit>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                    The plane the rocks, veins or grades run along. A shell or body that follows it joins from hole to hole along the plane and stays
                    thin across it, where otherwise it gathers in a bead round each hole.
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, mt: 0.75 }}>
                    <TextField {...field} label="Dip (°)" value={dip} onChange={e => setDip(e.target.value)} error={dip.trim() !== '' && (d === null || d < 0 || d > 90)} placeholder="0 to 90" />
                    <TextField {...field} label="Dips towards (°)" value={direction} onChange={e => setDirection(e.target.value)} error={direction.trim() !== '' && a === null} placeholder="0 to 360" />
                </Box>
                <Typography variant="caption" sx={label}>How much further along it than across it</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ width: 56, flexShrink: 0 }}>{strength === 1 ? 'No further' : `${strength} times`}</Typography>
                    <Slider
                        size="small" min={1} max={MAX_STRENGTH} step={0.5} value={strength} aria-label="How much further along it than across it"
                        onChange={(_, v) => setStrength(v as number)} onChangeCommitted={(_, v) => commit({ strength: v as number })}
                    />
                </Box>
                <Tooltip title="A lineation, a fold axis, the plunge of a shoot: the direction within the plane that things run furthest in. Leave it empty when there is none. Give the bearing it plunges towards; how steeply it plunges follows from the plane.">
                    <TextField {...field} fullWidth sx={{ mt: 1 }} label="Long direction within it: plunges towards (°)" value={trend} onChange={e => setTrend(e.target.value)} error={trend.trim() !== '' && t === null} placeholder="None" />
                </Tooltip>
                {trend.trim() !== '' && t !== null && (
                    <>
                        <Typography variant="caption" sx={label}>How much further along that than across it, within the plane</Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography variant="caption" color="text.secondary" sx={{ width: 56, flexShrink: 0 }}>{lineStrength === 1 ? 'No further' : `${lineStrength} times`}</Typography>
                            <Slider
                                size="small" min={1} max={MAX_LINE_STRENGTH} step={0.5} value={lineStrength} aria-label="How much further along the long direction"
                                onChange={(_, v) => setLineStrength(v as number)} onChangeCommitted={(_, v) => commit({ lineStrength: v as number })}
                            />
                        </Box>
                    </>
                )}
                <Box sx={{ display: 'flex', gap: 0.5, mt: 0.75 }}>
                    {!overall && <Button size="small" variant="outlined" sx={smallButton} disabled={!valid} onClick={() => commit()}>Set it</Button>}
                    <Tooltip title={blocked ?? `Rather than typing: with a slice on, drag along the structure where it shows on the slice. ${STRAIGHT_THROUGH}`}>
                        <span>
                            <Button
                                size="small" variant={strokeForIt ? 'contained' : 'outlined'} sx={smallButton} disabled={!!blocked}
                                onClick={() => useModelStore.getState().setStructureTool(strokeForIt ? null : { mode: 'stroke', target: 'overall' })}
                            >
                                {strokeForIt ? 'Stop drawing' : 'Draw it on the slice'}
                            </Button>
                        </span>
                    </Tooltip>
                    {overall && <Button size="small" sx={smallButton} onClick={() => setStructure(null)}>Remove it</Button>}
                </Box>
                {strokeForIt && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                        Drag along the structure on the slice: the plane through the stroke becomes the direction. {STRAIGHT_THROUGH} Esc cancels.
                    </Typography>
                )}
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                    It is drawn in the view as a squeezed ball: the shape that counts as equally near in every direction. Each shell and body has a
                    tick box to follow it or not.
                </Typography>
            </Collapse>
            <Readings blocked={blocked} onFromColumns={onFromColumns} hasPlane={!!overall} showOnSlice={showOnSlice} onShowOnSlice={onShowOnSlice} />
        </Box>
    );
};
