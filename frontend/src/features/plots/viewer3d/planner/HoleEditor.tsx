/**
 * The drillhole planner's form for the selected hole, in one of three ways:
 * by collar; target to surface; collar to target (lift and drift given, the
 * collar dip and azimuth solved). Targets and collars are placed on the
 * active 3D slice (drag them there, or Place …); typing a target moves the
 * slice through it. Moving the slice never moves a target: Snap target to
 * slice plane does that when asked.
 */
import React, { useEffect, useState } from 'react';
import {
    Alert, Autocomplete, Box, Button, Checkbox, CircularProgress, FormControl, FormControlLabel, InputLabel, Link, MenuItem, Select, Slider, Stack,
    TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import { AdsClick } from '@mui/icons-material';
import { HoleInput, OPTION_LABELS, PlanOption, PlanPoint, optionOf, withOption } from '../../../../utils/drillholePlan';
import { rangesText } from '../../../../utils/drillholePlanWedge';
import { ADVICE_REACH, DEFAULT_BALANCE, limitsText } from '../../../../utils/drillholePlanWedgeRates';
import { WedgeChart } from './WedgeChart';
import { notify } from '../../../../store/notificationStore';
import type { Slice } from '../slices';
import { usePlanStore, TopoRef } from './planStore';
import { NumField, RateLimitsFields, fixed } from './fields';
import type { ComputedHole, Planner } from './usePlans';
import { holeOffSlice, OFF_SLICE, SliceLink, snapTargetToSlice } from './planSlice';

const row = { display: 'flex', gap: 0.75, flexWrap: 'wrap' } as const;
const smallButton = { textTransform: 'none', minWidth: 0, px: 1 } as const;

export const TopoSelect: React.FC<{ planner: Planner; value: TopoRef | null; onChange: (v: TopoRef | null) => void; label?: string; disabled?: boolean }> = ({ planner, value, onChange, label = 'Topography', disabled }) => {
    const key = !value ? '' : value.kind === 'flat' ? 'flat' : value.key;
    return (
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'flex-start' }}>
            <FormControl size="small" sx={{ flex: 1, minWidth: 0 }} disabled={disabled}>
                <InputLabel>{label}</InputLabel>
                <Select
                    label={label} value={planner.topoOptions.some(o => o.key === key) || key === '' || key === 'flat' ? key : ''}
                    onChange={e => {
                        const k = String(e.target.value);
                        onChange(k === '' ? null : k === 'flat' ? { kind: 'flat', rl: value?.kind === 'flat' ? value.rl : Math.round(planner.dataBounds?.max[2] ?? 0) } : { kind: 'mesh', key: k });
                    }}
                >
                    <MenuItem value=""><em>None</em></MenuItem>
                    {planner.topoOptions.map(o => <MenuItem key={o.key} value={o.key}>{o.name} <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>{o.kind}</Typography></MenuItem>)}
                    <MenuItem value="flat">Flat RL (rough)</MenuItem>
                </Select>
            </FormControl>
            {value?.kind === 'flat' && <NumField label="Flat RL" value={value.rl} width={96} disabled={disabled} onChange={v => { if (v !== null) onChange({ kind: 'flat', rl: v }); }} />}
        </Stack>
    );
};

export const HoleEditor: React.FC<{ planner: Planner; item: ComputedHole; slice: Slice | null; link: SliceLink }> = ({ planner, item, slice, link }) => {
    const { hole, result } = item;
    const input = hole.input;
    const option = optionOf(input);
    const locked = !slice; // nothing is placed without a slice to place it on
    const updateHole = usePlanStore(s => s.updateHole);
    const setHoleMeta = usePlanStore(s => s.setHoleMeta);
    const tool = usePlanStore(s => s.tool);
    const setTool = usePlanStore(s => s.setTool);
    const others = usePlanStore(s => s.holes).filter(h => h.id !== hole.id).map(h => h.input.name);
    const set = (patch: Partial<HoleInput>) => updateHole(hole.id, patch);
    // Wedges: rates solved (default) or typed; the balance while the slider moves
    const solving = input.ratesMode !== 'fixed';
    const settings = usePlanStore(s => s.settings);
    // This hole's own lift / drift limits, else the planner's
    const wedgeLimits = input.rateLimits ?? settings.wedgeLimits;
    // A wedge that can't be made: what each kick-off would need, and the smallest changes that would do
    const advice = solving ? result.wedgeAdvice ?? null : null;
    const [balance, setBalance] = useState(input.balance ?? DEFAULT_BALANCE);
    useEffect(() => setBalance(input.balance ?? DEFAULT_BALANCE), [input.balance, hole.id]);
    const undo = (ids: string[]) => {
        const back = usePlanStore.getState().undoWedges(ids);
        notify(back.length ? `Back as before: ${back.map(r => (r.from === r.to ? r.to : `${r.from} → ${r.to}`)).join(', ')}.` : 'Nothing to undo.', 'info');
    };
    const [moreSolve, setMoreSolve] = useState(input.mode === 'target' && (input.method === 'target-angles' || input.method === 'collar-angles'));

    // The Hole ID is kept only when it is unique among the planned holes
    const [name, setName] = useState(input.name);
    useEffect(() => setName(input.name), [input.name, hole.id]);
    const nameProblem = !name.trim() ? 'A hole needs an ID.' : others.includes(name.trim()) ? 'Another planned hole has this ID.' : null;

    const point = (which: 'collar' | 'target', k: keyof PlanPoint, v: number | null) => {
        const next = { ...input[which], [k]: v };
        set({ [which]: next, ...(which === 'collar' ? { collarHole: null } : {}) } as Partial<HoleInput>);
    };
    /** A typed target moves the slice through it (the slice moves, not the target), once typing ends */
    const targetTyped = () => {
        const t = usePlanStore.getState().holes.find(h => h.id === hole.id)?.input.target;
        if (t && t.e !== null && t.n !== null && t.rl !== null) link.moveThrough([t.e, t.n, t.rl]);
    };
    const placeButton = (what: 'target' | 'collar') => (
        <Tooltip title={`Click on the 3D slice to put the ${what} there (or drag its marker). Esc cancels.`}>
            <span>
                <Button size="small" variant={tool === what ? 'contained' : 'outlined'} disabled={locked} startIcon={<AdsClick fontSize="small" />} sx={smallButton}
                    onClick={() => setTool(tool === what ? null : what)}>
                    {tool === what ? 'Click the slice…' : `Place ${what}`}
                </Button>
            </span>
        </Tooltip>
    );

    const existing = [...planner.existingCollars.keys()];
    const collarFields = (
        <>
            <Box sx={{ ...row, alignItems: 'center' }}>
                <Typography variant="caption" sx={{ fontWeight: 600, flex: 1 }}>Collar</Typography>
                {placeButton('collar')}
            </Box>
            <Autocomplete
                size="small" options={existing} disabled={locked || existing.length === 0} value={input.collarHole ?? null}
                onChange={(_, id) => {
                    const p = id ? planner.existingCollars.get(id) : null;
                    if (p) set({ collar: { e: p[0], n: p[1], rl: p[2] }, rlFromTopo: false, collarHole: id });
                    else set({ collarHole: null });
                }}
                renderInput={params => <TextField {...params} label="At an existing hole's collar" placeholder={existing.length ? 'Hole ID' : 'No drillholes in this view'} />}
            />
            <Box sx={row}>
                <NumField label="Collar E" value={input.collar.e} width={128} disabled={locked} onChange={v => point('collar', 'e', v)} />
                <NumField label="Collar N" value={input.collar.n} width={128} disabled={locked} onChange={v => point('collar', 'n', v)} />
            </Box>
            <Box sx={{ ...row, alignItems: 'center' }}>
                <NumField label="Collar RL" value={input.rlFromTopo ? (result.collar?.[2] ?? null) : input.collar.rl} width={110} disabled={locked || input.rlFromTopo} onChange={v => point('collar', 'rl', v)} />
                <FormControlLabel sx={{ mr: 0 }} control={<Checkbox size="small" disabled={locked} checked={input.rlFromTopo} onChange={e => set({ rlFromTopo: e.target.checked, collarHole: null })} />} label={<Typography variant="body2">RL from topography</Typography>} />
            </Box>
        </>
    );

    const off = holeOffSlice(result, slice);
    const isOff = off !== null && Math.abs(off) > OFF_SLICE;
    const targetFields = (
        <>
            <Box sx={{ ...row, alignItems: 'center' }}>
                <Typography variant="caption" sx={{ fontWeight: 600, flex: 1 }}>Target</Typography>
                {placeButton('target')}
            </Box>
            <Box sx={row}>
                <NumField label="Target E" value={input.target.e} width={128} disabled={locked} onChange={v => point('target', 'e', v)} onCommit={targetTyped} />
                <NumField label="Target N" value={input.target.n} width={128} disabled={locked} onChange={v => point('target', 'n', v)} onCommit={targetTyped} />
                <NumField label="Target RL" value={input.target.rl} width={100} disabled={locked} onChange={v => point('target', 'rl', v)} onCommit={targetTyped} />
            </Box>
            {result.target && slice && (
                <Box sx={{ ...row, alignItems: 'center' }}>
                    <Typography variant="caption" color={isOff ? 'warning.main' : 'text.secondary'} sx={{ flex: '1 1 100%' }}>
                        {isOff ? `The target is ${fixed(Math.abs(off!), 2)} m off the slice (it stays where it is when the slice moves).` : 'The target is on the slice.'}
                    </Typography>
                    <Tooltip title="Move the target straight onto the slice plane">
                        <span><Button size="small" variant={isOff ? 'contained' : 'outlined'} disabled={!isOff} sx={smallButton} onClick={() => snapTargetToSlice(hole.id, result, slice)}>Snap target to slice plane</Button></span>
                    </Tooltip>
                    <Tooltip title="Move the slice (as it lies) through the target">
                        <span><Button size="small" variant="outlined" disabled={!isOff} sx={smallButton} onClick={() => link.moveThrough(result.target!)}>Slice through target</Button></span>
                    </Tooltip>
                </Box>
            )}
        </>
    );
    const rates = (
        <Box sx={row}>
            <NumField label="Lift °/100 m" value={input.lift} width={110} disabled={locked} onChange={v => set({ lift: v })} />
            <NumField label="Drift °/100 m" value={input.drift} width={110} disabled={locked} onChange={v => set({ drift: v })} />
        </Box>
    );
    const errors = result.issues.filter(i => i.level === 'error');
    const warnings = result.issues.filter(i => i.level === 'warning');

    return (
        <Stack spacing={1} sx={{ pt: 1 }}>
            <TextField
                size="small" label="Hole ID" value={name} sx={{ width: 150 }} error={!!nameProblem} helperText={nameProblem ?? undefined}
                inputProps={{ spellCheck: false }}
                onChange={e => { setName(e.target.value); const v = e.target.value.trim(); if (v && !others.includes(v)) set({ name: v }); }}
            />
            <ToggleButtonGroup size="small" exclusive fullWidth value={option} disabled={locked}
                onChange={(_, v: PlanOption | null) => { if (v) { set({ ...withOption(input, v, result), ...(v !== 'surface' && hole.topo && !input.collarHole ? { rlFromTopo: true } : {}) }); setMoreSolve(false); } }}>
                {(Object.keys(OPTION_LABELS) as (keyof typeof OPTION_LABELS)[]).map(o => <ToggleButton key={o} value={o} sx={{ textTransform: 'none', px: 0.5 }}>{OPTION_LABELS[o]}</ToggleButton>)}
            </ToggleButtonGroup>
            <Typography variant="caption" color="text.secondary">
                {option === 'collar' ? 'A collar, its dip, azimuth and depth.'
                    : option === 'surface' ? 'A target and the hole\'s dip and azimuth there, back-projected up to the topography (lift and drift 0: straight).'
                        : option === 'wedge' ? 'A wedge: it leaves its parent at the deepest kick-off that reaches the target with a kick no bigger than the maximum. Changing the lift and drift moves the kick-off. (Pick another way above to make it a hole of its own.)'
                            : 'A collar and a target, with the lift and drift: the collar dip and azimuth are solved.'}
            </Typography>
            {option !== 'wedge' && <TopoSelect planner={planner} value={hole.topo} disabled={locked} onChange={v => setHoleMeta(hole.id, { topo: v })} />}
            {input.collarPad && option !== 'surface' && option !== 'wedge' && (
                <Typography variant="caption" color="text.secondary">Collar at pad <b>{input.collarPad}</b> (its own RL).</Typography>
            )}

            {option === 'collar' && <>
                {collarFields}
                <Box sx={row}>
                    <NumField label="Dip" value={input.dip} width={80} disabled={locked} onChange={v => set({ dip: v })} />
                    <NumField label="Grid azi" value={input.azi} width={80} disabled={locked} onChange={v => set({ azi: v })} />
                    <NumField label="EOH m" value={input.eoh} width={90} disabled={locked} onChange={v => set({ eoh: v })} />
                </Box>
                {rates}
            </>}
            {option === 'surface' && <>
                {targetFields}
                <Box sx={row}>
                    <NumField label="Dip at target" value={input.targetDip} width={110} disabled={locked} onChange={v => set({ targetDip: v })} />
                    <NumField label="Grid azi at target" value={input.targetAzi} width={130} disabled={locked} onChange={v => set({ targetAzi: v })} />
                </Box>
                {rates}
            </>}
            {option === 'collar-target' && <>
                {collarFields}
                {targetFields}
                {input.method === 'lift-drift' && rates}
                {input.method === 'target-angles' && (
                    <Box sx={row}>
                        <NumField label="Dip at target" value={input.targetDip} width={110} disabled={locked} onChange={v => set({ targetDip: v })} />
                        <NumField label="Grid azi at target" value={input.targetAzi} width={130} disabled={locked} onChange={v => set({ targetAzi: v })} />
                    </Box>
                )}
                {input.method === 'collar-angles' && (
                    <Box sx={row}>
                        <NumField label="Collar dip" value={input.dip} width={100} disabled={locked} onChange={v => set({ dip: v })} />
                        <NumField label="Collar grid azi" value={input.azi} width={120} disabled={locked} onChange={v => set({ azi: v })} />
                    </Box>
                )}
                {moreSolve ? (
                    <FormControl size="small" fullWidth disabled={locked}>
                        <InputLabel>Given</InputLabel>
                        <Select label="Given" value={input.method} onChange={e => set({ method: e.target.value as HoleInput['method'] })}>
                            <MenuItem value="lift-drift">Lift and drift (solve the collar dip and azimuth)</MenuItem>
                            <MenuItem value="target-angles">Dip and azimuth at the target (solve lift and drift)</MenuItem>
                            <MenuItem value="collar-angles">Collar dip and azimuth (solve lift and drift)</MenuItem>
                        </Select>
                    </FormControl>
                ) : (
                    <Link component="button" variant="caption" underline="hover" sx={{ alignSelf: 'flex-start' }} onClick={() => setMoreSolve(true)}>Instead of lift and drift, give…</Link>
                )}
            </>}
            {option === 'wedge' && <>
                <Typography variant="caption">
                    Wedge off <b>{item.parentName || '(parent not found)'}</b>{input.fromTarget && input.fromTarget !== input.name ? ` · from target ${input.fromTarget}` : ''}
                </Typography>
                {targetFields}
                <ToggleButtonGroup size="small" exclusive fullWidth value={solving ? 'solve' : 'fixed'} disabled={locked}
                    onChange={(_, v: 'solve' | 'fixed' | null) => { if (v) set({ ratesMode: v, kopDepth: null }); }}>
                    <ToggleButton value="solve" sx={{ textTransform: 'none', px: 0.5 }}>Solve lift and drift</ToggleButton>
                    <ToggleButton value="fixed" sx={{ textTransform: 'none', px: 0.5 }}>Fixed lift and drift</ToggleButton>
                </ToggleButtonGroup>
                {solving ? (
                    <Box>
                        <Typography variant="caption" color="text.secondary" component="div">
                            The parent's lift and drift where they work ({fixed(result.wedge?.parentRates?.lift ?? null, 2)} / {fixed(result.wedge?.parentRates?.drift ?? null, 2)} °/100 m); else the nearest with {limitsText(wedgeLimits)} °/100 m (steering).
                        </Typography>
                        <FormControlLabel sx={{ mr: 0 }} disabled={locked}
                            control={<Checkbox size="small" checked={!!input.rateLimits} onChange={e => set({ rateLimits: e.target.checked ? { ...settings.wedgeLimits } : null })} />}
                            label={<Typography variant="body2">Own lift and drift limits for this hole</Typography>} />
                        {input.rateLimits
                            ? <RateLimitsFields value={input.rateLimits} disabled={locked} onChange={v => set({ rateLimits: v })} />
                            : <Typography variant="caption" color="text.secondary" component="div">Using the limits in Settings.</Typography>}
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1 }}>
                            <Typography variant="caption" sx={{ whiteSpace: 'nowrap' }}>Parent's rates</Typography>
                            <Slider size="small" min={0} max={1} step={0.05} disabled={locked}
                                value={balance} onChange={(_, v) => setBalance(v as number)} onChangeCommitted={(_, v) => set({ balance: v as number, kopDepth: null })} />
                            <Typography variant="caption" sx={{ whiteSpace: 'nowrap' }}>Deeper kick-off</Typography>
                        </Box>
                    </Box>
                ) : rates}
                <Box sx={{ ...row, alignItems: 'center' }}>
                    <NumField label="Max kick °" value={input.kickMax ?? null} width={90} disabled={locked} onChange={v => set({ kickMax: v })} title="The largest deflection the wedge gives" />
                    <NumField label="Kick-off m" value={input.kopDepth ?? null} width={100} disabled={locked} onChange={v => set({ kopDepth: v })} title={solving ? 'Empty: picked by the balance (every 5 m)' : 'Empty: the deepest that works (every 5 m)'} />
                    <Button size="small" variant="outlined" sx={smallButton} disabled={locked || input.kopDepth === null || input.kopDepth === undefined} onClick={() => set({ kopDepth: null })}>{solving ? 'By balance' : 'Deepest'}</Button>
                </Box>
                {result.wedge?.profile && (
                    <WedgeChart profile={result.wedge.profile} parentRates={result.wedge.parentRates ?? { lift: 0, drift: 0 }} limits={result.wedge.limits ?? wedgeLimits}
                        kop={result.wedge.kop} ranges={result.wedge.ranges} onPick={kop => set({ kopDepth: kop })} />
                )}
                {advice && <>
                    <WedgeChart profile={advice.profile} parentRates={advice.parentRates} limits={advice.limits} />
                    <Alert severity="info" icon={false} sx={{ py: 0.25, '& .MuiAlert-message': { fontSize: 12, width: '100%' } }}>
                        <Typography variant="caption" component="div" sx={{ fontWeight: 600, mb: 0.25 }}>
                            To reach this target{advice.profile.length ? ' (the chart: what each kick-off would need; red crosses are past your limits)' : ''}:
                        </Typography>
                        {advice.options.map(o => (
                            <Box key={o.change} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}>
                                <Typography variant="caption" sx={{ flex: 1 }}>{o.text}: kick-offs {rangesText(o.ranges)}</Typography>
                                <Button size="small" variant="outlined" sx={smallButton} disabled={locked}
                                    onClick={() => set(o.limits ? { rateLimits: o.limits, kopDepth: null } : { kickMax: o.kickMax ?? input.kickMax, kopDepth: null })}>
                                    Use
                                </Button>
                            </Box>
                        ))}
                        {advice.options.length === 0 && (
                            <Typography variant="caption" component="div">Even lift ±{ADVICE_REACH.lift} and drift ±{ADVICE_REACH.drift} °/100 m don't reach it: try another parent, or a target nearer this one.</Typography>
                        )}
                    </Alert>
                </>}
                {result.wedge && (
                    <Typography variant="caption" color="text.secondary">Kick-offs that work (every 5 m): {rangesText(result.wedge.ranges)}. Deepest: {result.wedge.deepest} m.{result.wedge.profile ? ' Click the chart to choose one.' : ''}</Typography>
                )}
                <Box sx={row}>
                    <Tooltip title="Back to the hole it was before it became a wedge: its name, way of planning, collar, pad, lift and drift">
                        <span><Button size="small" variant="outlined" sx={smallButton} disabled={locked} onClick={() => undo([hole.id])}>Undo this wedge</Button></span>
                    </Tooltip>
                    <Tooltip title={`Every wedge off ${item.parentName ?? 'this parent'} back to the hole it was`}>
                        <span><Button size="small" variant="outlined" sx={smallButton} disabled={locked} onClick={() => undo(planner.holes.filter(h => h.hole.input.mode === 'wedge' && h.parentName === item.parentName).map(h => h.hole.id))}>Undo all wedges off {item.parentName}</Button></span>
                    </Tooltip>
                </Box>
                <Tooltip title="Name this parent's wedges W1, W2 … again, from the deepest kick-off up">
                    <span><Button size="small" variant="outlined" sx={{ ...smallButton, alignSelf: 'flex-start' }} disabled={locked} onClick={() => {
                        const kops = new Map(planner.holes.filter(h => h.hole.input.mode === 'wedge').map(h => [h.hole.id, h.result.wedge?.kop ?? null] as [string, number | null]));
                        const renamed = usePlanStore.getState().renumberWedges(item.parentName ?? '', kops);
                        notify(renamed.length ? `Renamed: ${renamed.map(r => `${r.from} → ${r.to}`).join(', ')}.` : 'The wedges are already numbered from the deepest kick-off.', renamed.length ? 'warning' : 'info');
                    }}>Renumber wedges by depth</Button></span>
                </Tooltip>
            </>}
            {option !== 'collar' && <NumField label="Past the target m" value={input.extension} width={130} disabled={locked} onChange={v => set({ extension: v })} title="Drilled past the target at the same lift and drift: EOH = target depth + this" />}

            {item.pending && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <CircularProgress size={14} />
                    <Typography variant="caption">Working out this wedge…{result.wedge ? ' (the values shown are the last ones)' : ''}</Typography>
                </Box>
            )}
            {errors.map((i, k) => <Alert key={`e${k}`} severity="error" sx={{ py: 0, '& .MuiAlert-message': { fontSize: 12 } }}>{i.text}</Alert>)}
            {warnings.map((i, k) => <Alert key={`w${k}`} severity="warning" sx={{ py: 0, '& .MuiAlert-message': { fontSize: 12 } }}>{i.text}</Alert>)}

            <Box sx={{ bgcolor: 'action.hover', borderRadius: 1, p: 0.75, display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 1.5, rowGap: 0.25, fontVariantNumeric: 'tabular-nums' }}>
                {result.wedge && <>
                    <Typography variant="caption" color="text.secondary">Kick-off on {result.wedge.parentName}</Typography>
                    <Typography variant="caption">{fixed(result.wedge.kop, 0)} m</Typography>
                    <Typography variant="caption" color="text.secondary">Kick / toolface</Typography>
                    <Typography variant="caption">{fixed(result.wedge.kick, 2)}° / {fixed(result.wedge.toolface, 0)}° (from high side, clockwise)</Typography>
                    <Typography variant="caption" color="text.secondary">Kick-off to target</Typography>
                    <Typography variant="caption">{fixed(result.wedge.length, 1)} m</Typography>
                </>}
                <Typography variant="caption" color="text.secondary">Collar E / N / RL{result.wedge ? ' (parent\'s)' : ''}</Typography>
                <Typography variant="caption">{result.collar ? `${fixed(result.collar[0], 2)} / ${fixed(result.collar[1], 2)} / ${fixed(result.collar[2], 2)}` : '–'}</Typography>
                <Typography variant="caption" color="text.secondary">Collar dip / grid azi{option === 'collar-target' && input.method === 'lift-drift' ? ' (solved)' : ''}</Typography>
                <Typography variant="caption">{fixed(result.collarDip, 2)}° / {fixed(result.collarAzi, 2)}°</Typography>
                {result.target && <>
                    <Typography variant="caption" color="text.secondary">Target dip / grid azi</Typography>
                    <Typography variant="caption">{fixed(result.targetDip, 2)}° / {fixed(result.targetAzi, 2)}°</Typography>
                    <Typography variant="caption" color="text.secondary">Target depth</Typography>
                    <Typography variant="caption">{fixed(result.targetDepth, 2)} m</Typography>
                </>}
                <Typography variant="caption" color="text.secondary">Lift / drift{result.solvedRates ? ' (solved)' : ''}</Typography>
                <Typography variant="caption">{fixed(result.lift, 3)} / {fixed(result.drift, 3)} °/100 m</Typography>
                <Typography variant="caption" color="text.secondary">EOH</Typography>
                <Typography variant="caption">{fixed(result.eoh, 2)} m</Typography>
                {result.miss && <>
                    <Typography variant="caption" color="error">Closest miss</Typography>
                    <Typography variant="caption" color="error">{fixed(result.miss.distance, 3)} m</Typography>
                </>}
            </Box>

            <Box sx={{ ...row, alignItems: 'center' }}>
                <Typography variant="caption" color="text.secondary">Colour</Typography>
                <input type="color" aria-label="Colour" value={hole.style.color} onChange={e => setHoleMeta(hole.id, { style: { ...hole.style, color: e.target.value } })}
                    style={{ width: 26, height: 22, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }} />
                <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>Width</Typography>
                <Slider size="small" min={1} max={8} step={0.5} value={hole.style.width} sx={{ width: 90 }} onChange={(_, v) => setHoleMeta(hole.id, { style: { ...hole.style, width: v as number } })} />
            </Box>
        </Stack>
    );
};
