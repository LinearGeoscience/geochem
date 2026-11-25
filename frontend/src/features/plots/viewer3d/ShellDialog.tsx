/**
 * A shell round high values: choose a column of numbers and a cut-off. A
 * closed surface is put round everything at or above it
 * (features/model/shell). Also used to change the choice for a shell, and
 * (`numeric`) to make or change a numeric model: the same choices with
 * several cut-offs, a shell for each (features/model/numericModels).
 *
 * How the samples are prepared is chosen here too: averaged down the hole
 * or as sampled, a top cut, and whether extreme values are kept from moving
 * the shell's edge. The cut-offs offered and the counts follow those
 * choices: they are of what the shell will be fitted to.
 */
import React, { useMemo, useState } from 'react';
import {
    Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, FormControlLabel, InputLabel, MenuItem, Radio, RadioGroup,
    Select, TextField, Typography,
} from '@mui/material';
import { useModelStore } from '../../../store/modelStore';
import { useModellingStore } from '../../../store/modellingStore';
import { modelUnits } from '../../model/geoModel';
import { findIntercepts } from '../../model/intercepts';
import { shellColumns, shellSamples } from '../../model/logging';
import { cleanCutoffs, formatCutoffs, MAX_CUTOFFS, numericHome, numericRule, parseCutoffs, shellRuleAt } from '../../model/numericModels';
import { lieText, PLANE_STRENGTH, planeTrend } from '../../model/numericPlane';
import { keys } from '../../model/objectKeys';
import { numericModelFrom, shellName, shellSurface } from '../../model/sceneActions';
import { defaultSheets, sheetsSources } from '../../model/sheetsSources';
import { useModelCache } from '../../model/modelCache';
import { evaluateField } from '../../model/rbf';
import { DEFAULT_LOCAL, DEFAULT_SHARE, preparedValues, prepareSamples } from '../../model/shell';
import { makeDomain, makeSolids, solidChoices } from '../../model/shellDomains';
import { t } from '../../model/terms';
import type { Domain, SceneCoords, ShellRule } from '../../model/types';

interface Props {
    open: boolean;
    /** The view's coordinate, hole and depth columns (for a new shell) */
    coords: SceneCoords | null;
    /** The shell whose choice is being changed (null: a new one) */
    surfaceId: string | null;
    /** It makes or changes a numeric model: several cut-offs, a shell for each */
    numeric?: boolean;
    /** The numeric model being changed (null: a new one) */
    numericId?: string | null;
    onClose: () => void;
}

/** Cut-offs offered: the value this share of the samples reach */
const PICKS: [string, number][] = [['Top half', 0.5], ['Top quarter', 0.25], ['Top 10%', 0.1], ['Top 5%', 0.05], ['Top 1%', 0.01]];
/** Top cuts offered: the value all but this share of the samples are under */
const TOP_CUTS: [string, number][] = [['Highest 2.5%', 0.025], ['Highest 1%', 0.01], ['Highest 0.5%', 0.005]];
/** Averaging lengths offered, in usual sample lengths */
const AVERAGES = [2, 3, 5];
/** Found by counting: the shares offered, and how many samples each way are taken together */
const SHARES = [0.3, 0.4, 0.5];
const LOCALS: [string, number][] = [['Few: 2 each way', 2], ['3 each way', 3], ['Many: 6 each way', 6]];

const metres = (v: number) => `${Number(v.toPrecision(2))} m`;
const hint = (text: string) => <Typography component="span" variant="caption" color="text.secondary" sx={{ display: 'block' }}>{text}</Typography>;

const typed = (text: string): number | null => {
    const v = Number(text.trim());
    return text.trim() !== '' && Number.isFinite(v) ? v : null;
};

/** A value for a text box: three figures are plenty for a cut-off */
const tidy = (v: number) => String(Number(v.toPrecision(3)));

export const ShellDialog: React.FC<Props> = ({ open, onClose, ...rest }) => {
    // Each time it opens it starts from the shell's choices (or none): the form is made anew
    const [opened, setOpened] = useState(0);
    const [wasOpen, setWasOpen] = useState(false);
    if (open !== wasOpen) {
        setWasOpen(open);
        if (open) setOpened(n => n + 1);
    }
    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            {opened > 0 && <ShellForm key={opened} onClose={onClose} {...rest} />}
        </Dialog>
    );
};

const ShellForm: React.FC<Omit<Props, 'open'>> = ({ coords: viewCoords, surfaceId, numeric = false, numericId = null, onClose }) => {
    const scene = useModelStore(s => s.scene);
    const surface = !numeric && surfaceId ? scene.surfaces.find(s => s.id === surfaceId) ?? null : null;
    const numericModel = numeric && numericId ? scene.numericModels?.find(m => m.id === numericId) ?? null : null;
    const editing = numericModel ? shellRuleAt(numericModel.rule, numericModel.shells[0]?.cutoff ?? 0) : surface?.rule.kind === 'shell' ? surface.rule : null;
    /** The numeric model the shell being changed is one of (null: it is a shell of its own) */
    const owner = surface ? numericHome(scene, surface.id) : null;
    // A shell that exists is in the scene's columns; a new one takes the view's
    const coords = surface || numericModel ? scene.coords : viewCoords;

    // The dataset does not change while this is up (it is modal): its columns are read once
    const [columns] = useState(() => shellColumns(coords));
    const [column, setColumn] = useState(() => editing?.column ?? '');
    // What a new numeric model is kept inside (Phase 276: it could only be set after, in its properties): a lithology
    // of a geological model, or a solid of the scene
    const grounds = useMemo(() => {
        if (!numeric || numericModel) return [];
        const list: { key: string; label: string; domain: Domain | null }[] = [];
        for (const g of scene.models ?? []) for (const unit of modelUnits(scene, g)) list.push({ key: `u:${g.id}:${unit}`, label: `${unit} of ${g.name}`, domain: makeDomain(g.id, [unit]) });
        for (const c of solidChoices(scene)) list.push({ key: `s:${c.ref.kind}:${c.ref.id}`, label: `${c.name} (${c.what})`, domain: makeSolids([c.ref]) });
        return list.filter(g => g.domain);
    }, [numeric, numericModel, scene]);
    const [inside, setInside] = useState('');
    // The body or vein whose sheets a new numeric model lies along (Phase 283). Since Phase 305 one is chosen as the
    // dialog opens where there is one (the one the column's highs sit in most); '' is Nothing; null: as chosen for it
    const planes = useMemo(() => (numeric && !numericModel ? sheetsSources(scene) : []), [numeric, numericModel, scene]);
    const [alongPicked, setAlong] = useState<string | null>(null);
    const [typedCutoff, setTypedCutoff] = useState(() => (numericModel ? formatCutoffs(numericModel.shells.map(s => s.cutoff)) : editing && !numeric ? String(editing.cutoff) : ''));
    /** The share of the values the cut-off was picked by (null: it was typed). A picked cut-off follows the averaging and the top cut */
    const [pick, setPick] = useState<number | null>(null);
    /** null: not chosen by hand, so it follows what the column looks like */
    const [log, setLog] = useState<boolean | null>(() => (editing ? editing.log : null));
    const [average, setAverage] = useState(() => (editing && editing.composite !== null ? String(editing.composite) : ''));
    const [top, setTop] = useState(() => (editing && editing.topCut !== null ? String(editing.topCut) : ''));
    const [band, setBand] = useState(() => editing?.band ?? true);
    /** How the shell is found: from the values, by counting those at or above the cut-off, or round intercepts down the holes */
    const [method, setMethod] = useState<'values' | 'counted' | 'runs'>(() => (editing?.method === 'indicator' ? 'counted' : editing?.method === 'intercepts' ? 'runs' : 'values'));
    const counted = method === 'counted', byRuns = method === 'runs';
    const [least, setLeast] = useState(() => (editing?.minLength !== undefined ? String(editing.minLength) : ''));
    const [waste, setWaste] = useState(() => (editing?.maxWaste !== undefined ? String(editing.maxWaste) : ''));
    const [share, setShare] = useState(() => editing?.share ?? DEFAULT_SHARE);
    const [local, setLocal] = useState(() => editing?.local ?? DEFAULT_LOCAL);

    /** The column's samples, in order down their holes */
    const samples = useMemo(() => (column ? shellSamples(coords, column) : null), [coords, column]);
    const prepared = useMemo(() => (samples ? prepareSamples(samples) : null), [samples]);
    const offered = useMemo(() => defaultSheets(planes, samples, (id, positions) => {
        const field = useModelCache.getState().byId[id]?.field;
        return field ? evaluateField(field, positions) : null;
    }), [planes, samples]);
    const along = alongPicked ?? offered?.id ?? '';
    // Intercepts are their own averaging down the hole
    const composite = !byRuns && prepared && prepared.holes > 0 && (typed(average) ?? 0) > 0 ? typed(average) : null;
    const topCut = typed(top);
    /** What the shell would be fitted to: the samples, or their averages, top cut */
    const data = useMemo(() => (prepared ? preparedValues(prepared, composite, topCut) : null), [prepared, composite, topCut]);
    const shareOf = (sorted: Float64Array, share: number) => (sorted.length > 0 ? sorted[Math.min(sorted.length - 1, Math.floor((1 - share) * sorted.length))] : NaN);
    const reachedBy = (share: number) => (data ? shareOf(data.sorted, share) : NaN);
    // Values spread over more than a power of ten between the middle and the top are carried better as logarithms
    const spread = prepared && prepared.count > 0 && shareOf(prepared.sorted, 0.5) > 0 && shareOf(prepared.sorted, 0.02) / shareOf(prepared.sorted, 0.5) > 10;
    const cutoff = !numeric && pick !== null && data && data.sorted.length > 0 ? tidy(reachedBy(pick)) : typedCutoff;
    /** A numeric model's cut-offs, the lowest first (null: one shell, or what is typed is not numbers) */
    const several = useMemo(() => (numeric ? parseCutoffs(cutoff) : null), [numeric, cutoff]);
    // (Of several, the lowest: it is what decides whether logarithms can be used, and the first that is counted)
    const value = numeric ? several?.[0] ?? null : typed(cutoff);
    const highest = numeric ? several?.[several.length - 1] ?? null : value;
    const useLog = (log ?? !!spread) && value !== null && value > 0;
    const one = composite !== null ? `averages over ${metres(composite)}` : 'samples';

    const counts = useMemo(() => {
        if (!data || !prepared || value === null) return null;
        const withHigh = new Set<number>();
        let above = 0;
        data.value.forEach((v, i) => {
            if (v >= value) {
                above++;
                withHigh.add(data.hole[i]);
            }
        });
        return { above, n: data.value.length, holes: prepared.holes, withHigh: withHigh.size };
    }, [data, prepared, value]);
    /** For a numeric model: how many samples reach each cut-off, and in how many holes */
    const each = useMemo(() => {
        if (!several || !data) return null;
        return several.map(c => {
            const withHigh = new Set<number>();
            let above = 0;
            data.value.forEach((v, i) => { if (v >= c) { above++; withHigh.add(data.hole[i]); } });
            return { cutoff: c, above, withHigh: withHigh.size };
        });
    }, [several, data]);
    // A top cut at or below the cut-off leaves nothing above it
    const cutTooLow = topCut !== null && highest !== null && topCut <= highest;
    const lengths = prepared?.lengths ?? null;
    // Intercepts: at least two samples long, with as much lower ground inside, unless typed
    const usualRun = lengths ? Number((2 * lengths.usual).toPrecision(2)) : 2;
    const minLength = (typed(least) ?? 0) > 0 ? typed(least)! : usualRun;
    const maxWaste = typed(waste) !== null && typed(waste)! >= 0 ? typed(waste)! : usualRun;
    const found = useMemo(
        () => (byRuns && samples && value !== null ? findIntercepts(samples, { cutoff: value, minLength, maxWaste, topCut }) : null),
        [byRuns, samples, value, minLength, maxWaste, topCut],
    );
    /** For a numeric model found round intercepts: how many each cut-off has */
    const runsEach = useMemo(
        () => (byRuns && samples && several ? several.map(c => findIntercepts(samples, { cutoff: c, minLength, maxWaste, topCut })?.list.length ?? 0) : null),
        [byRuns, samples, several, minLength, maxWaste, topCut],
    );
    const one1 = !!counts && counts.above > 0 && counts.above < counts.n && !cutTooLow && (!byRuns || (!!found && found.list.length > 0));
    const usable = numeric
        ? one1 && !!each && !!counts && each.every(e => e.above > 0 && e.above < (counts?.n ?? 0)) && (!byRuns || (!!runsEach && runsEach.every(n => n > 0)))
        : one1;

    const accept = () => {
        if (!coords || !usable || value === null) return;
        const rule: ShellRule = {
            kind: 'shell', column, cutoff: value, log: useLog, composite, topCut, band, reach: editing?.reach ?? null,
            ...(counted ? { method: 'indicator' as const, share, local } : byRuns ? { method: 'intercepts' as const, minLength, maxWaste } : {}),
        };
        const model = useModelStore.getState();
        if (numeric) {
            if (!several || several.length === 0) return;
            const kept = { ...numericRule(rule), reach: numericModel?.rule.reach ?? null };
            if (numericModel) model.updateNumericModel(numericModel.id, { rule: kept, cutoffs: several });
            else {
                const id = numericModelFrom(coords, kept, several, grounds.find(g => g.key === inside)?.domain ?? null);
                if (id) {
                    const lie = planes.find(p => p.id === along)?.lie;
                    if (lie) model.updateNumericModel(id, { trend: planeTrend(lie, null) });
                    const tree = useModellingStore.getState();
                    tree.setExpanded([...new Set([...tree.expanded, keys.root('numeric'), keys.numericModel(id)])]);
                    tree.setSelected([keys.numericModel(id)]);
                }
            }
        } else if (surface && editing) {
            // A name still the one made from the column and cut-off follows them
            model.updateSurface(surface.id, { rule, ...(surface.name === shellName(editing) ? { name: shellName(rule) } : {}) });
        } else {
            const id = shellSurface(coords, rule);
            if (id) model.setEditing(id);
        }
        onClose();
    };

    return (
        <>
            <DialogTitle>{numeric ? (numericModel ? 'Change the numeric model' : 'Numeric model') : editing ? 'Change the shell' : 'Grade shell'}</DialogTitle>
            <DialogContent>
                {!coords ? <Alert severity="warning">Surfaces need East, North and Elevation columns.</Alert> : columns.length === 0 ? (
                    <Alert severity="warning">This dataset has no column of numbers to put a shell round.</Alert>
                ) : (
                    <>
                        {owner && (
                            <Alert severity="info" data-testid="shell-owned" sx={{ mb: 1.5, py: 0 }}>
                                This shell is one of the numeric model {owner.name}. Its cut-off is its own; everything else chosen here is changed for every shell of that model.
                            </Alert>
                        )}
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                            {numeric
                                ? 'Choose a column and its cut-offs. A numeric model keeps a grade shell for each cut-off: a closed surface round everything at or above it. All of them are found the same way, as chosen below, so a higher cut-off should sit inside a lower one.'
                                : 'Choose a column and a cut-off. A closed surface is put round everything at or above the cut-off: the column is carried from sample to sample through the space between the holes, and the shell is where it equals the cut-off. It stays near the samples at or above the cut-off: it does not run on into ground with no samples.'}
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 1.5 }}>
                            <FormControl size="small" fullWidth>
                                <InputLabel id="shell-column">Column</InputLabel>
                                <Select labelId="shell-column" label="Column" value={columns.includes(column) ? column : ''} onChange={e => { setColumn(e.target.value); setTypedCutoff(''); setPick(null); setTop(''); setLog(null); }}>
                                    {columns.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                                </Select>
                            </FormControl>
                            <TextField
                                size="small" label={numeric ? 'Cut-offs' : 'Cut-off'} value={cutoff} onChange={e => { setTypedCutoff(e.target.value); setPick(null); }}
                                sx={{ width: numeric ? 240 : 180, flexShrink: 0 }} inputProps={{ inputMode: numeric ? 'text' : 'decimal' }} InputLabelProps={{ shrink: true }}
                                placeholder={numeric ? 'Several: 0.5, 1, 2' : 'At or above'}
                            />
                        </Box>
                        {data && data.sorted.length > 0 && (
                            <Box data-testid="shell-picks" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
                                {PICKS.map(([text, share]) => {
                                    const at = Number(tidy(reachedBy(share)));
                                    const on = numeric ? !!several?.includes(at) : pick === share;
                                    // (For a numeric model each one clicked is another cut-off, and clicked again it is taken away)
                                    const click = numeric
                                        ? () => setTypedCutoff(formatCutoffs(on ? (several ?? []).filter(c => c !== at) : cleanCutoffs([...(several ?? []), at])))
                                        : () => { setPick(share); setTypedCutoff(tidy(reachedBy(share))); };
                                    return <Chip key={text} size="small" variant={on ? 'filled' : 'outlined'} color={on ? 'primary' : 'default'} label={`${text}: ${tidy(reachedBy(share))}`} onClick={click} />;
                                })}
                            </Box>
                        )}
                        <Typography variant="body2" sx={{ mt: 1.5 }}>{numeric ? 'How the shells are found' : 'How the shell is found'}</Typography>
                        <RadioGroup value={method} onChange={e => setMethod(e.target.value as typeof method)}>
                            <FormControlLabel
                                value="values" sx={{ alignItems: 'flex-start' }} control={<Radio size="small" sx={{ pt: 0.5 }} />}
                                label={(
                                    <Typography variant="body2">
                                        From the values
                                        {hint('The values are carried from sample to sample, and the shell is where they equal the cut-off. Every sample at or above it gets a shell round it, however alone it stands.')}
                                    </Typography>
                                )}
                            />
                            <FormControlLabel
                                value="counted" sx={{ alignItems: 'flex-start' }} control={<Radio size="small" sx={{ pt: 0.5 }} />}
                                label={(
                                    <Typography variant="body2">
                                        By counting the samples at or above it
                                        {hint('Each sample counts as at or above the cut-off or not, whatever its value, and the shell is put where enough of the samples round about are. A high sample alone among low ones is left out; a low one among many high ones is taken in. Fewer, broader shells: the usual choice where single assays are erratic, as with gold.')}
                                    </Typography>
                                )}
                            />
                            <FormControlLabel
                                value="runs" sx={{ alignItems: 'flex-start' }} control={<Radio size="small" sx={{ pt: 0.5 }} />} disabled={!!prepared && prepared.holes === 0}
                                label={(
                                    <Typography variant="body2">
                                        Round the intercepts down each hole
                                        {hint(prepared && prepared.holes === 0 ? 'This needs the hole and depth columns.'
                                            : 'Down each hole the runs that average the cut-off or more over a least length are found, the way drilling results are reported ("12 m at 3.1"), and the shell is put round those. Lower values inside a run are taken in with it; high samples too thin and too poor to make a run are left out.')}
                                    </Typography>
                                )}
                            />
                        </RadioGroup>
                        {byRuns && (
                            <Box sx={{ ml: 3.5, mb: 0.5, mt: 0.75, display: 'flex', gap: 1.5 }}>
                                <TextField
                                    size="small" fullWidth label="A run is at least (m)" value={least} onChange={e => setLeast(e.target.value)} placeholder={String(usualRun)}
                                    InputLabelProps={{ shrink: true }} inputProps={{ inputMode: 'decimal' }} helperText="Shorter counts only when rich enough to average the cut-off over this length."
                                />
                                <TextField
                                    size="small" fullWidth label="Lower values inside it, at most (m)" value={waste} onChange={e => setWaste(e.target.value)} placeholder={String(usualRun)}
                                    InputLabelProps={{ shrink: true }} inputProps={{ inputMode: 'decimal' }} helperText="In a row. Runs are joined across them while the whole still averages the cut-off."
                                />
                            </Box>
                        )}
                        {counted && (
                            <Box sx={{ ml: 3.5, mb: 0.5 }}>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>Where at least this share of the samples round about are at or above it</Typography>
                                <Box data-testid="shell-shares" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.25 }}>
                                    {SHARES.map(s => <Chip key={s} size="small" variant={share === s ? 'filled' : 'outlined'} color={share === s ? 'primary' : 'default'} label={`${Math.round(100 * s)}%`} onClick={() => setShare(s)} />)}
                                    {!SHARES.includes(share) && <Chip size="small" variant="filled" color="primary" label={`${Math.round(100 * share)}%`} />}
                                </Box>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>How many samples down a hole are taken together</Typography>
                                <Box data-testid="shell-locals" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.25 }}>
                                    {LOCALS.map(([text, n]) => <Chip key={n} size="small" variant={local === n ? 'filled' : 'outlined'} color={local === n ? 'primary' : 'default'} label={text} onClick={() => setLocal(n)} />)}
                                    {!LOCALS.some(([, n]) => n === local) && <Chip size="small" variant="filled" color="primary" label={`${local} each way`} />}
                                </Box>
                                {hint('Both can be changed afterwards with sliders in the panel, where the shell says how many high and low samples it takes in.')}
                            </Box>
                        )}
                        {method === 'values' && <FormControlLabel
                            sx={{ mt: 1, alignItems: 'flex-start' }} disabled={value === null || value <= 0}
                            control={<Checkbox size="small" checked={useLog} onChange={e => setLog(e.target.checked)} sx={{ pt: 0.5 }} />}
                            label={(
                                <Typography variant="body2">
                                    Work with the logarithms of the values
                                    {hint('For values spread over powers of ten, as most assays are: one very high sample then does not swell the shell far out into low ground.')}
                                </Typography>
                            )}
                        />}
                        {method === 'values' && <FormControlLabel
                            sx={{ mt: 0.5, alignItems: 'flex-start' }}
                            control={<Checkbox size="small" checked={band} onChange={e => setBand(e.target.checked)} sx={{ pt: 0.5 }} />}
                            label={(
                                <Typography variant="body2">
                                    Keep very high and very low values from moving its edge
                                    {hint('The edge then sits about halfway between a sample at or above the cut-off and a lower one beside it. Without this, a very low value beside a high one shrinks the shell round it to a speck, and a very high one swells it.')}
                                </Typography>
                            )}
                        />}
                        {!byRuns && <TextField
                            size="small" fullWidth label="Average the samples down each hole over (m)" value={average} onChange={e => setAverage(e.target.value)} sx={{ mt: 1.5 }}
                            placeholder="Not averaged: as sampled" InputLabelProps={{ shrink: true }} disabled={!!prepared && prepared.holes === 0}
                            helperText={prepared && prepared.holes === 0 ? 'This needs the hole and depth columns.'
                                : `${!lengths ? '' : lengths.long <= 1.25 * lengths.short ? `The samples are about ${metres(lengths.usual)} long. ` : `Most samples are ${metres(lengths.usual)} long (one in ten is under ${metres(lengths.short)}, one in ten over ${metres(lengths.long)}). `}Longer averages join single high samples into wider zones, and lose the narrow ones.`}
                        />}
                        {lengths && !byRuns && (
                            <Box data-testid="shell-averages" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                                <Chip size="small" variant={composite === null ? 'filled' : 'outlined'} color={composite === null ? 'primary' : 'default'} label="As sampled" onClick={() => setAverage('')} />
                                {AVERAGES.map(times => {
                                    const length = Number((times * lengths.usual).toPrecision(2));
                                    return <Chip key={times} size="small" variant={composite === length ? 'filled' : 'outlined'} color={composite === length ? 'primary' : 'default'} label={metres(length)} onClick={() => setAverage(String(length))} />;
                                })}
                            </Box>
                        )}
                        <TextField
                            size="small" fullWidth label="Top cut: no sample counts as more than" value={top} onChange={e => setTop(e.target.value)} sx={{ mt: 1.5 }}
                            placeholder="No top cut" InputLabelProps={{ shrink: true }} inputProps={{ inputMode: 'decimal' }}
                            helperText="A few extreme assays then cannot carry an average over the cut-off on their own."
                        />
                        {prepared && prepared.count > 0 && (
                            <Box data-testid="shell-topcuts" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                                <Chip size="small" variant={topCut === null ? 'filled' : 'outlined'} color={topCut === null ? 'primary' : 'default'} label="None" onClick={() => setTop('')} />
                                {TOP_CUTS.map(([text, share]) => {
                                    const at = tidy(shareOf(prepared.sorted, share));
                                    return <Chip key={text} size="small" variant={top === at ? 'filled' : 'outlined'} color={top === at ? 'primary' : 'default'} label={`${text}: ${at}`} onClick={() => setTop(at)} />;
                                })}
                            </Box>
                        )}
                        {grounds.length > 0 && (
                            <Box data-testid="numeric-inside" sx={{ mt: 2 }}>
                                <TextField
                                    select size="small" fullWidth label={t('domain')} value={inside} onChange={e => setInside(e.target.value)} InputLabelProps={{ shrink: true }}
                                    SelectProps={{ native: true }} inputProps={{ 'aria-label': 'What the shells are kept inside', 'data-field': 'numeric-inside' }}
                                >
                                    <option value="">Nothing: the shells go where their samples take them</option>
                                    {grounds.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
                                </TextField>
                                {inside && (
                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                                        Only the samples inside it are used, and each shell stops at its faces. The counts here are of every sample. Several lithologies or solids, or one fault block: in its properties, once it is made.
                                    </Typography>
                                )}
                            </Box>
                        )}
                        {planes.length > 0 && (
                            <Box data-testid="numeric-along" sx={{ mt: 2 }}>
                                <TextField
                                    select size="small" fullWidth label="Along the sheets of" value={along} onChange={e => setAlong(e.target.value)} InputLabelProps={{ shrink: true }}
                                    SelectProps={{ native: true }} inputProps={{ 'aria-label': 'The body or vein whose sheets the shells lie along', 'data-field': 'numeric-along' }}
                                >
                                    <option value="">Nothing: a shell is drawn round each run of highs as it comes</option>
                                    {planes.map(p => <option key={p.id} value={p.id}>{`${p.name}: ${lieText(p.lie)}`}</option>)}
                                </TextField>
                                {along && (
                                    <Typography data-testid="numeric-along-said" variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                                        {(alongPicked === null ? `Chosen as it is made${planes.length > 1 ? `, as the highest ${column || 'values'} sit in ${offered?.name} most` : ''}: highs in thin sheets are drawn along them, not as bubbles round each run. ` : '')
                                            + `Every shell is carried ${PLANE_STRENGTH} times further along that plane than across it. Changed, or taken away, in its properties.`}
                                    </Typography>
                                )}
                            </Box>
                        )}
                        {numeric && each && counts && data && data.sorted.length > 0 && !cutTooLow && (
                            <Box data-testid="numeric-preview" sx={{ mt: 2 }}>
                                {each.map((e, i) => {
                                    const runs = runsEach?.[i] ?? null;
                                    const bad = e.above === 0 || e.above === counts.n || runs === 0;
                                    return (
                                        <Typography key={e.cutoff} variant="body2" data-cutoff={e.cutoff} color={bad ? 'warning.main' : 'text.primary'}>
                                            {`≥ ${e.cutoff}: `}
                                            {e.above === 0 ? `no ${composite !== null ? 'average' : 'sample'} reaches it`
                                                : e.above === counts.n ? `every ${composite !== null ? 'average' : 'sample'} reaches it: nothing would be outside its shell`
                                                    : runs === 0 ? `no run down a hole averages it over ${metres(minLength)}`
                                                        : `${e.above.toLocaleString()} of ${counts.n.toLocaleString()} ${one}${counts.holes > 0 ? `, in ${e.withHigh.toLocaleString()} of ${counts.holes.toLocaleString()} holes` : ''}${runs !== null ? `, ${runs.toLocaleString()} ${runs === 1 ? 'intercept' : 'intercepts'}` : ''}`}
                                        </Typography>
                                    );
                                })}
                                {each.length === MAX_CUTOFFS && <Typography variant="caption" color="text.secondary">A model has at most {MAX_CUTOFFS} cut-offs.</Typography>}
                            </Box>
                        )}
                        {!(numeric && each && counts && data && data.sorted.length > 0 && !cutTooLow) && <Typography data-testid="shell-preview" variant="body2" sx={{ mt: 2 }} color={counts && !usable ? 'warning.main' : 'text.primary'}>
                            {!column ? 'Choose a column.'
                                : !data || !prepared ? 'The columns this needs are not in the dataset.'
                                    : data.sorted.length === 0 ? 'No sample has a value in this column.'
                                        : !counts ? `Type a cut-off, or choose one above. The values run from ${tidy(data.sorted[0])} to ${tidy(data.sorted[data.sorted.length - 1])}.`
                                            : cutTooLow ? 'The top cut is at or below the cut-off: nothing would be above the cut-off.'
                                                : counts.above === 0 ? `${composite !== null ? `No average over ${metres(composite)}` : 'No sample'} reaches it.`
                                                    : counts.above === counts.n ? `Every ${composite !== null ? 'average' : 'sample'} reaches it: there would be nothing outside the shell.`
                                                        : byRuns ? (!found || found.list.length === 0
                                                            ? `No run down a hole averages it over ${metres(minLength)}.`
                                                            : `${found.list.length.toLocaleString()} ${found.list.length === 1 ? 'intercept' : 'intercepts'} in ${found.holesWith.toLocaleString()} of ${found.holes.toLocaleString()} holes: ${metres(found.length)} in all, averaging ${tidy(found.grade)}. ${found.flags.reduce((n, f) => n + f, 0).toLocaleString()} of ${counts.n.toLocaleString()} samples are in one.`)
                                                            : `${counts.above.toLocaleString()} of ${counts.n.toLocaleString()} ${one} are at or above it${counts.holes > 0 ? `, in ${counts.withHigh.toLocaleString()} of ${counts.holes.toLocaleString()} holes` : ''}.`}
                        </Typography>}
                    </>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="contained" data-action="accept-shell" disabled={!usable} onClick={accept}>{editing ? 'Change it' : numeric ? 'Make the model' : 'Make the shell'}</Button>
            </DialogActions>
        </>
    );
};
