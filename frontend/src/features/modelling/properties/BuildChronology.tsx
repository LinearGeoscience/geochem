/**
 * "Build chronology from lithologies", in a model's Chronology tab: what
 * each unit is and in what order they lie, and the surfaces made from that.
 * Before anything is made the logging is read (contactMatrix.ts): how much
 * of it the plan as it stands could match at the very best, an order and
 * kinds the holes agree with better (taken up by hand, never by itself),
 * and a small figure of which unit lies on which.
 */
import React, { useMemo, useState } from 'react';
import { Alert, Box, Button, Checkbox, FormControlLabel, IconButton, MenuItem, TextField, Tooltip, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { ArrowDownward, ArrowUpward } from '@mui/icons-material';
import { useAppStore } from '../../../store/appStore';
import { useModelStore } from '../../../store/modelStore';
import { alternating, bestAgreement, betterBound, boundText, contactMatrix, orderNotSaid, passOver, planParts, proposeChronology, shapeProposal, type LoggedRuns, type UnitShape } from '../../model/contactMatrix';
import { makeModelContacts, unitHasShare, unitShapes } from '../../model/geoModelActions';
import { CONTACT_KINDS, contactsFromUnits, cutsAcross, cuttersFirst, KIND_NAME, unitColor, type UnitPlan } from '../../model/geoModel';
import { backText, comesBack } from '../../model/layerCheck';
import { occurrenceNames, occurrenceText, unitsThatComeBack } from '../../model/occurrences';
import { t } from '../../model/terms';
import type { GeoModel, UnitMap } from '../../model/types';
import { PLAN_NAME, rebuildUnitAs, unitBuiltAs } from '../../model/unitBuild';
import { mapLayerCheck, mapRuns, splitMapOccurrences } from '../../model/unitActions';
import { cleans } from '../../model/units';
import { coordsFor, useTargetView } from '../targetView';

const select = { SelectDisplayProps: { style: { fontSize: 13, paddingTop: 2, paddingBottom: 2 } } } as const;
const small = { p: 0.125 } as const;
/** With more layers than this the figure is not drawn (it would not fit the column) */
const FIGURE_LAYERS = 10;

/** The layer a unit is just under in the list (the youngest first): the nearest above it that is a layer. Null: none is */
function layerOver(names: readonly string[], kinds: Readonly<Record<string, UnitPlan | undefined>>, unit: string): string | null {
    for (let i = names.indexOf(unit) - 1; i >= 0; i--) if (!cutsAcross(kinds[names[i]]) && kinds[names[i]] !== 'none') return names[i];
    return null;
}

const list = (names: readonly string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/**
 * Which unit lies on which, going down the holes: a number for each pair of
 * layers, in the order of the plan. In a pile of layers in order every
 * number is above the line of dots.
 */
const OverFigure: React.FC<{ runs: LoggedRuns; layers: readonly string[]; color: (unit: string) => string }> = ({ runs, layers, color }) => {
    const key = layers.join('|');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for the layers (a new list every render)
    const m = useMemo(() => contactMatrix(passOver(runs, new Set(runs.units.filter(u => !layers.includes(u))))), [runs, key]);
    const at = layers.map(u => m.units.indexOf(u));
    const count = (a: number, b: number) => (at[a] >= 0 && at[b] >= 0 ? m.over[at[a]][at[b]] : 0);
    let most = 1, wrong = 0;
    layers.forEach((_, a) => layers.forEach((__, b) => { most = Math.max(most, count(a, b)); if (a > b) wrong += count(a, b); }));
    const CELL = 26;
    return (
        <Box data-testid="over-figure" data-wrong={wrong} sx={{ mt: 0.75 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.3, mb: 0.5 }}>
                How many times each layer (down the side) lies directly on each other one (along the top), going down the holes:
            </Typography>
            <Box role="table" aria-label="Which layer lies on which" sx={{ display: 'grid', gridTemplateColumns: `minmax(0, 1fr) repeat(${layers.length}, ${CELL}px)`, alignItems: 'center', rowGap: '2px', columnGap: '2px' }}>
                <Box />
                {layers.map(u => (
                    <Tooltip key={u} title={u}><Box sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: color(u), justifySelf: 'center' }} /></Tooltip>
                ))}
                {layers.map((a, i) => (
                    <React.Fragment key={a}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                            <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: color(a), flexShrink: 0 }} />
                            <Typography variant="caption" noWrap title={a} sx={{ minWidth: 0 }}>{a}</Typography>
                        </Box>
                        {layers.map((b, j) => {
                            const c = count(i, j);
                            if (i === j) return <Typography key={b} variant="caption" color="text.disabled" sx={{ textAlign: 'center' }}>·</Typography>;
                            return (
                                <Tooltip key={b} title={c ? `${a} lies directly on ${b} ${c === 1 ? 'once' : `${c.toLocaleString()} times`}${i > j ? ': the other way up from the order here' : ''}` : ''}>
                                    <Box
                                        data-over={`${a}>${b}`} data-out-of-order={i > j && c > 0 ? true : undefined}
                                        sx={{
                                            height: 20, borderRadius: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11,
                                            color: c ? 'text.primary' : 'text.disabled',
                                            bgcolor: th => (c ? alpha(i > j ? th.palette.warning.main : th.palette.primary.main, 0.12 + 0.5 * c / most) : 'transparent'),
                                        }}
                                    >
                                        {c ? c.toLocaleString() : ''}
                                    </Box>
                                </Tooltip>
                            );
                        })}
                    </React.Fragment>
                ))}
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.3, mt: 0.5 }}>
                {wrong === 0
                    ? 'Every number is above the line of dots: down every hole the layers are met in this order.'
                    : 'Above the line of dots: met in the order here. Below it (shaded as a warning): an older layer lying on a younger one.'}
            </Typography>
        </Box>
    );
};

export const BuildChronology: React.FC<{ model: GeoModel; map: UnitMap }> = ({ model, map }) => {
    const scene = useModelStore(s => s.scene);
    const data = useAppStore(s => s.columnarData);
    const target = useTargetView();
    // What each unit is and the order they are in, as chosen here; and what came of making them
    const [plan, setPlan] = useState<Record<string, UnitPlan>>({});
    const [order, setOrder] = useState<string[] | null>(null);
    const [planning, setPlanning] = useState(false);
    const [made, setMade] = useState<{ text: string; notes: string[]; bad: boolean } | null>(null);
    // The units also given a proportion: how much of the ground each is, beside what it is built as
    const [shares, setShares] = useState<Record<string, boolean>>({});
    // The units that cut across and follow the layers of the model (a sill, a lode that keeps to one bed). (Not chosen by hand: as the logging says)
    const [followPick, setFollowPick] = useState<Record<string, boolean>>({});
    // (Null: not chosen by hand, so as the logging suggests)
    const [togetherPick, setTogether] = useState<boolean | null>(null);
    const [asPile, setAsPile] = useState(true);

    const listed = map.units.map(u => u.name);
    // What each unit is: as chosen here, else as its contact in the model is. What it is built as is read from
    // the contact itself and not kept beside it, so it cannot say one thing while the model is another
    // (A vein that is one of a vein system: the unit is the system; a body of thin sheets: thin sheets)
    const madeAs = (u: string): UnitPlan | null => unitBuiltAs(scene, model, u);
    const kindOf = (u: string): UnitPlan => {
        const made = madeAs(u);
        // (A unit that cuts across and has its contact is the form that was made: a vein system asked for may have come out one vein)
        if (made && cutsAcross(made) && cutsAcross(plan[u])) return made;
        return plan[u] ?? made ?? 'deposit';
    };
    // The list is the age order, the youngest first. (An order chosen here holds as long as it is of the units as they
    // are now; until one is chosen, a unit that cuts across is at the top: with nothing said of its age it cuts everything)
    const names = order && order.length === listed.length && order.every(u => listed.includes(u)) ? order : cuttersFirst(listed, Object.fromEntries(listed.map(u => [u, kindOf(u)])));
    const all = Object.fromEntries(names.map(u => [u, kindOf(u)]));
    const { base, proposals } = contactsFromUnits(names, all);
    const todo = proposals.filter(p => !model.contacts.some(c => c.unit === p.unit));
    // (A proportion is for a unit that cuts across the layers, and is made once)
    const hasShare = (u: string) => unitHasShare(scene, map, u);
    const todoShares = names.filter(u => shares[u] && cutsAcross(all[u]) && !hasShare(u));
    const systems = todo.filter(p => p.system).length;
    const makeLabel = list([
        ...(todo.length - systems > 0 ? [`${todo.length - systems} surface${todo.length - systems === 1 ? '' : 's'}`] : []),
        ...(systems > 0 ? [systems === 1 ? 'a vein system' : `${systems} vein systems`] : []),
        ...(todoShares.length > 0 ? [todoShares.length === 1 ? 'a proportion' : `${todoShares.length} proportions`] : []),
    ]);
    const coords = coordsFor(target);
    const { layers, cutting } = planParts(names, all);

    // Do the units taken as layers lie in the holes as layers do? (Looked at only while the plan is open)
    const lie = planning ? mapLayerCheck(coords, map, new Set(layers)) ?? [] : [];
    const back = new Map(lie.filter(comesBack).map(u => [u.unit, u]));

    // What the logging says: read once while the plan is open, for the data as it is. `runs`: as the model reads it (the
    // short stretches of its cleaned units read as the unit round them or left out); `logged`: as logged
    const cleaned = cleans(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `data` is the change signal of the dataset the runs are read from
    const runs = useMemo(() => (planning ? mapRuns(coords, map) : null), [planning, map, data, coords?.x, coords?.y, coords?.z, coords?.hole, coords?.from, coords?.to]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- as above
    const logged = useMemo(() => (planning && cleaned ? mapRuns(coords, map, true) : runs), [runs, cleaned]);
    const planKey = names.map(u => `${u}=${all[u]}`).join('|');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `planKey` stands for the order and the kinds
    const bound = useMemo(() => (logged ? bestAgreement(logged, layers, cutting) : null), [logged, planKey]);
    // (Of the logging as cleaned: what the proposal is weighed against)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- as above
    const readBound = useMemo(() => (cleaned && runs ? bestAgreement(runs, layers, cutting) : bound), [runs, cleaned, bound, planKey]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- as above
    const raw = useMemo(() => (runs ? proposeChronology(runs, names, all) : null), [runs, planKey]);
    // ... with the form the places of its cutting units ask for (thin sheets where a vein system cannot be told apart, or an
    // intrusion is thin against its holes): looked at once for the data as it is
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `runs` stands for the data the shapes are read from
    const shapesKept = useMemo(() => new Map<string, UnitShape>(), [runs]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- as above
    const proposal = useMemo(() => (raw ? shapeProposal(raw, unitShapes(coords, map, raw, all, shapesKept), all) : null), [raw, shapesKept]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- as above
    const alternates = useMemo(() => (runs ? alternating(runs, layers) : []), [runs, planKey]);
    // Layers next to one another in the pile that are hardly ever in one hole: nothing says which is over which
    // eslint-disable-next-line react-hooks/exhaustive-deps -- as above
    const unsaid = useMemo(() => (runs ? orderNotSaid(runs, layers) : []), [runs, planKey]);
    // Layers that come and go down the holes give contacts that step from hole to hole: held to one another's shape, the layers fit those badly
    const together = togetherPick ?? alternates.length === 0;
    // (Shown only where it would match more of the logging than the plan as it stands)
    const better = readBound && proposal && betterBound(proposal.bound, readBound) ? proposal : null;
    // ... or where it matches as much and says something the plan does not have: where a unit that cuts across goes in
    // the age order, or that a layer's base is an erosion surface
    const says = !!proposal && (
        Object.entries(proposal.age).some(([c, a]) => a.placed && cutsAcross(all[c]) && layerOver(names, all, c) !== a.under)
        || names.some(u => proposal.kinds[u] === 'erosion' && all[u] === 'deposit')
    );
    const offer = better ?? (says && proposal && readBound && !betterBound(readBound, proposal.bound) ? proposal : null);
    /** Whether what is made of a unit that cuts across will follow the layers of the model */
    const followsLayers = (u: string) => followPick[u] ?? !!proposal?.follows[u];
    const proposed = offer ? planParts(offer.order, offer.kinds) : null;

    // A unit that is in the pile several times (occurrences.ts): basalt, a sediment, basalt again. Looked for among every
    // unit of the plan but those not in the model and the thin sheets, whatever the plan has them as: a layer between two
    // occurrences of another lies "inside" it, and is otherwise taken for an intrusion
    const thin = (u: string) => all[u] === 'vein' || all[u] === 'veinSystem' || all[u] === 'sheets' || raw?.kinds[u] === 'veinSystem';
    const searched = names.filter(u => all[u] !== 'none' && !thin(u));
    const searchKey = `${searched.join('|')}#${[...back.keys()].join('|')}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `searchKey` stands for the units looked among and those asked about
    const comeBack = useMemo(() => (runs && searched.length >= 3 ? unitsThatComeBack(runs, searched, [...back.keys()]) : null), [runs, searchKey]);
    // (Offered while none of those units has its contact: a contact is of a unit by its name)
    const several = comeBack?.proposal && comeBack.proposal.units.every(u => !model.contacts.some(c => c.unit === u.unit)) ? comeBack.proposal : null;
    /** What its place in the list means for a unit that cuts across: what it is older than, and what cuts it */
    const placeText = (u: string): string => {
        const over = layerOver(names, all, u);
        if (over === null) return 'The youngest: it cuts everything under it.';
        const above = names.slice(0, names.indexOf(u)).reverse().find(x => all[x] === 'erosion' || cutsAcross(all[x]));
        if (!above) return `Older than ${over}, but a deposit does not bury it: make ${over} an erosion surface for it to stop there.`;
        return above === over ? `Older than ${over}, whose base cuts it.` : `Older than ${over}; ${above} cuts it.`;
    };

    const move = (u: string, by: number) => {
        const i = names.indexOf(u), j = i + by;
        if (i < 0 || j < 0 || j >= names.length) return;
        const next = [...names];
        [next[i], next[j]] = [next[j], next[i]];
        setOrder(next);
    };
    /** What a unit is: planned, for one with no contact yet; for one that has its contact, built that way at once (unitBuild.ts), and what came of it said */
    const choose = (u: string, to: UnitPlan) => {
        if (!model.contacts.some(c => c.unit === u)) { setPlan(p => ({ ...p, [u]: to })); return; }
        const done = rebuildUnitAs(model.id, coords, u, to);
        // (What it is built as is read from its contact from here on)
        setPlan(p => { const { [u]: _was, ...rest } = p; return rest; });
        if (!done.ok) setMade({ text: done.reason, notes: [], bad: true });
        else if (done.changed && to !== 'none') setMade({ text: `${u} is now built as ${PLAN_NAME[to]}: the same surface, in its place in the chronology, with what was placed on it by hand.`, notes: done.notes, bad: false });
    };
    const use = () => {
        if (!offer) return;
        // (A unit that has its contact in the model already keeps the kind that contact has)
        const free = Object.fromEntries(Object.entries(offer.kinds).filter(([u]) => !model.contacts.some(c => c.unit === u)));
        setPlan(p => ({ ...p, ...free }));
        setOrder(offer.order);
    };
    const split = () => {
        if (!several) return;
        const done = splitMapOccurrences(coords, map.id, several.pile);
        if (!done.ok) { setMade({ text: done.reason, notes: [], bad: true }); return; }
        // The plan follows: the pile in its order, each of its units a layer, the others where they were over it
        const pile = occurrenceNames(several.pile);
        // (Over it: the units not looked among, and those passed over as bodies inside one of them)
        setOrder([...names.filter(u => !several.pile.includes(u)), ...pile]);
        setPlan(p => ({ ...p, ...Object.fromEntries(pile.map(u => [u, p[u] === 'erosion' ? 'erosion' : 'deposit'] as [string, UnitPlan])) }));
        setMade({
            text: `${list(Object.entries(done.units).map(([u, parts]) => `${u} is now ${list(parts)}`))}.`,
            notes: [
                `${done.given.toLocaleString()} stretch${done.given === 1 ? '' : 'es'} of hole ${done.given === 1 ? 'was' : 'were'} given to one of them${done.moved > 0 ? ` (${done.moved.toLocaleString()} hole${done.moved === 1 ? '' : 's'} read by where the holes round ${done.moved === 1 ? 'it' : 'them'} have the contacts)` : ''}: any can be given to another in Lithologies, as a stretch is given to a unit by hand.`,
                'Nothing else is made yet: the plan above has them as layers, in their order.',
            ],
            bad: false,
        });
    };
    const make = () => {
        const done = makeModelContacts(model.id, coords, all, together, names, asPile, todoShares, names.filter(u => cutsAcross(all[u]) && layers.length > 1 && followsLayers(u)));
        setMade(done.ok
            ? { text: done.made ? `${done.made} surface${done.made === 1 ? '' : 's'} made from the logging and put in the chronology.` : 'Every unit has its contact already.', notes: done.notes, bad: false }
            : { text: done.reason, notes: [], bad: true });
        if (done.ok) setPlanning(false);
    };

    return (
        <Box data-testid="contacts-from-units" sx={{ mt: 1 }}>
            <Button size="small" variant="outlined" fullWidth sx={{ textTransform: 'none' }} aria-expanded={planning} data-action="build-chronology" onClick={() => { setPlanning(p => !p); setMade(null); }}>
                {t('buildChronology')}…
            </Button>
            {planning && (
                <Box sx={{ mt: 0.5, p: 0.75, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                        The units, the youngest first. Say what each is: a contact is made at the bottom of each layer, a closed body round each intrusion, and a vein or a dyke from its two walls.
                        A unit that cuts across the layers cuts everything under it in the list.
                        Thin sheets side by side (a dyke set, a vein set) can be a vein system, a vein of each sheet that can be told apart, or an intrusion of thin sheets, which holds the logging as it is and is drawn only near the holes.
                    </Typography>
                    {bound && bound.of > 0 && (
                        <Tooltip title="Going down a hole a layer is met once, so the layers met can only get older. Where a hole says otherwise, part of it cannot be matched whatever shape the surfaces take. A unit that cuts across (an intrusion, a vein) can be anywhere, and counts whole.">
                            <Typography data-testid="chronology-bound" variant="caption" sx={{ display: 'block', mb: 0.5, lineHeight: 1.3 }}>
                                From the logging: as planned here, a model can match {boundText(bound)}.
                            </Typography>
                        </Tooltip>
                    )}
                    {cleaned && readBound && readBound.of > 0 && (
                        <Typography data-testid="chronology-bound-cleaned" variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5, lineHeight: 1.3 }}>
                            The model reads the logging with its short stretches cleaned (Lithologies): of that, {boundText(readBound, true)}. What follows is of the logging read that way.
                        </Typography>
                    )}
                    {readBound && readBound.up > 0 && (
                        <Typography data-testid="chronology-upward" variant="caption" color={readBound.up * 2 > readBound.holes ? 'warning.main' : 'text.secondary'} sx={{ display: 'block', mb: 0.5, lineHeight: 1.3 }}>
                            {readBound.up.toLocaleString()} of the {readBound.holes.toLocaleString()} holes with two layers or more {readBound.up === 1 ? 'is' : 'are'} read from the bottom up: going down {readBound.up === 1 ? 'it' : 'them'} the layers get younger.
                            {readBound.up * 2 > readBound.holes ? ' Either the order here is upside down, or the layers are overturned or drilled from underneath.' : ''}
                        </Typography>
                    )}
                    {alternates.length > 0 && (
                        <Typography data-testid="chronology-alternates" variant="caption" color="warning.main" sx={{ display: 'block', mb: 0.5, lineHeight: 1.3 }}>
                            {list(alternates.map(a => `${a.unit} (${Math.round(a.each)} stretches a hole)`))} {alternates.length === 1 ? 'comes and goes' : 'come and go'} down the holes.
                            Layers that alternate cannot all be matched, in any order: grouping them in Lithologies raises what a model can match.
                        </Typography>
                    )}
                    {unsaid.map(u => (
                        <Typography key={`${u.upper}/${u.lower}`} data-testid="chronology-order-unsaid" variant="caption" color="warning.main" sx={{ display: 'block', mb: 0.5, lineHeight: 1.3 }}>
                            {u.why}. They may lie side by side, or be one rock under two codes. As two layers the contact between them rests on those holes alone,
                            and one of them can be given little or no ground: grouping them in Lithologies avoids it; else look at Outputs once the model is made.
                        </Typography>
                    ))}
                    {several && (
                        <Alert data-testid="chronology-occurrences" severity="info" icon={false} sx={{ py: 0, mb: 0.75, fontSize: 12, '& .MuiAlert-message': { width: '100%' } }}>
                            {several.units.map(u => <Box key={u.unit} data-testid="occurrence-why" sx={{ mt: 0.25 }}>{occurrenceText(several, u.unit)}.</Box>)}
                            <Box sx={{ mt: 0.25 }}>Read that way, the youngest first: <b>{occurrenceNames(several.pile).join(', ')}</b>. What lies between is then a layer, not a body that cuts it.</Box>
                            <Button size="small" variant="outlined" fullWidth data-action="split-occurrences" sx={{ textTransform: 'none', mt: 0.5, py: 0 }} onClick={split}>
                                Make each a lithology of its own (every stretch is given to one; nothing else is made yet)
                            </Button>
                        </Alert>
                    )}
                    {offer && proposed && (
                        <Alert data-testid="chronology-proposal" severity="info" icon={false} sx={{ py: 0, mb: 0.75, fontSize: 12, '& .MuiAlert-message': { width: '100%' } }}>
                            {better ? (
                                <>
                                    {readBound && better.bound.metres > readBound.metres + 1e-6 ? 'The holes agree better with' : 'Fewer holes are read from the bottom up with'}{' '}
                                    {proposed.layers.length <= 8 ? <>the layers in the order <b>{proposed.layers.join(', ')}</b> (the youngest first)</> : 'the layers in another order'}
                                    {proposed.cutting.length > 0 && <>, and with <b>{list(proposed.cutting)}</b> cutting across them</>}
                                    : {boundText(better.bound, cleaned)}.
                                </>
                            ) : 'The holes say more than the plan has:'}
                            {/* (Where the plan matches as much already, only what it does not have is said) */}
                            {Object.entries(offer.why).filter(([u]) => !!better || offer.kinds[u] !== all[u]).map(([u, why]) => <Box key={u} data-testid="proposal-why" sx={{ mt: 0.25 }}>{u}: {why}.</Box>)}
                            {Object.entries(offer.age).filter(([u, age]) => !!better || (age.placed && layerOver(names, all, u) !== age.under)).map(([u, age]) => <Box key={u} data-testid="proposal-age" sx={{ mt: 0.25 }}>{u}, its age: {age.why}.</Box>)}
                            {Object.entries(offer.follows).filter(([u]) => !!better || offer.kinds[u] !== all[u]).map(([u, why]) => <Box key={u} data-testid="proposal-follows" sx={{ mt: 0.25 }}>{u}: {why}.</Box>)}
                            <Button size="small" variant="outlined" fullWidth data-action="use-proposal" sx={{ textTransform: 'none', mt: 0.5, py: 0 }} onClick={use}>
                                Put the plan that way (nothing is made yet)
                            </Button>
                        </Alert>
                    )}
                    {names.map((u, i) => (
                        <Box key={u} data-plan-unit={u} sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5, flexWrap: 'wrap' }}>
                            <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: unitColor(scene, model, u), flexShrink: 0, alignSelf: 'center' }} />
                            <Typography variant="caption" noWrap sx={{ flex: 1, minWidth: 0 }}>{u}{u === base ? ' (the base)' : ''}</Typography>
                            <Box sx={{ display: 'flex', alignSelf: 'center', flexShrink: 0 }}>
                                <IconButton size="small" sx={small} aria-label={`Move ${u} up: younger`} data-action="plan-up" disabled={i === 0} onClick={() => move(u, -1)}><ArrowUpward sx={{ fontSize: 14 }} /></IconButton>
                                <IconButton size="small" sx={small} aria-label={`Move ${u} down: older`} data-action="plan-down" disabled={i === names.length - 1} onClick={() => move(u, 1)}><ArrowDownward sx={{ fontSize: 14 }} /></IconButton>
                            </Box>
                            <TextField
                                select size="small" variant="standard" value={kindOf(u)} sx={{ width: 150, flexShrink: 0 }}
                                onChange={e => choose(u, e.target.value as UnitPlan)}
                                SelectProps={{ SelectDisplayProps: { ...select.SelectDisplayProps, 'aria-label': `What ${u} is` } as React.HTMLAttributes<HTMLDivElement> }}
                            >
                                {CONTACT_KINDS.map(k => <MenuItem key={k} dense value={k}>{KIND_NAME[k]}</MenuItem>)}
                                <MenuItem dense value="sheets">Intrusion, thin sheets</MenuItem>
                                <MenuItem dense value="vein">Vein or dyke</MenuItem>
                                <MenuItem dense value="veinSystem">Vein system</MenuItem>
                                <MenuItem dense value="none">Not in the model</MenuItem>
                            </TextField>
                            {cutsAcross(kindOf(u)) && !model.contacts.some(c => c.unit === u) && (
                                <Typography data-testid="cut-age" variant="caption" color="text.secondary" sx={{ flexBasis: '100%', pl: 2.25, lineHeight: 1.2 }}>
                                    {placeText(u)}
                                </Typography>
                            )}
                            {cutsAcross(kindOf(u)) && layers.length > 1 && !model.contacts.some(c => c.unit === u) && (
                                <FormControlLabel
                                    data-testid="plan-follows" sx={{ flexBasis: '100%', ml: 1.5, mr: 0, mt: -0.25, alignItems: 'flex-start' }}
                                    control={<Checkbox
                                        size="small" sx={{ p: 0.25 }} checked={followsLayers(u)}
                                        onChange={e => setFollowPick(v => ({ ...v, [u]: e.target.checked }))}
                                        inputProps={{ 'aria-label': `${u} follows the layers` }}
                                    />}
                                    label={(
                                        <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.2, display: 'block', pt: 0.25 }}>
                                            {proposal?.follows[u] ? `it follows the layers: ${proposal.follows[u]}` : 'it follows the layers of the model (a sill, a lode that keeps to one bed)'}
                                        </Typography>
                                    )}
                                />
                            )}
                            {cutsAcross(kindOf(u)) && (
                                <FormControlLabel
                                    data-testid="plan-share" sx={{ flexBasis: '100%', ml: 1.5, mr: 0, mt: -0.25 }}
                                    control={<Checkbox
                                        size="small" sx={{ p: 0.25 }} checked={hasShare(u) || !!shares[u]} disabled={hasShare(u)}
                                        onChange={e => setShares(v => ({ ...v, [u]: e.target.checked }))}
                                        inputProps={{ 'aria-label': `Also how much of the ground is ${u}` }}
                                    />}
                                    label={<Typography variant="caption" color="text.secondary">{hasShare(u) ? 'it has a proportion: how much of the ground it is' : 'and a proportion: how much of the ground it is'}</Typography>}
                                />
                            )}
                            {back.has(u) && (
                                <Typography data-testid="comes-back" variant="caption" color="warning.main" sx={{ flexBasis: '100%', pl: 2.25, lineHeight: 1.2, mb: 0.25 }}>
                                    {backText(back.get(u)!)}
                                </Typography>
                            )}
                            {back.has(u) && !!comeBack?.not[u] && (
                                <Typography data-testid="not-occurrences" variant="caption" color="text.secondary" sx={{ flexBasis: '100%', pl: 2.25, lineHeight: 1.2, mb: 0.25 }}>
                                    Not two layers of it either: {comeBack.not[u]}.
                                </Typography>
                            )}
                        </Box>
                    ))}
                    {back.size > 0 && (
                        <Alert data-testid="not-layers" severity="warning" sx={{ py: 0, mt: 0.5, fontSize: 12 }}>
                            {back.size === 1 ? 'A layer is met once down a hole, and one of these is not' : 'A layer is met once down a hole, and these are not'}: as layers, the model cannot match the logging where a unit comes back.
                            What lies between may be a body that cuts it (make that unit an intrusion, or a vein or dyke), part of the same unit (group the two in Lithologies), a stray interval or two (give the unit a length under Short stretches, in Lithologies), or not for this model (Not in the model). The marks go as the plan changes.
                        </Alert>
                    )}
                    {runs && layers.length >= 2 && layers.length <= FIGURE_LAYERS && <OverFigure runs={runs} layers={layers} color={u => unitColor(scene, model, u)} />}
                    <Tooltip describeChild placement="left" title="Layers laid down one on another are fitted together: the contact with the most holes through it is fitted first, and each of the others is conformable to its neighbour. They take one another's shape between the holes and cannot cross; a layer missing in some holes pinches out. An erosion surface cuts what is under it, and is fitted on its own.">
                        <FormControlLabel
                            sx={{ mt: 0.5, ml: -0.75 }}
                            control={<Checkbox size="small" sx={{ p: 0.5 }} checked={together} onChange={e => setTogether(e.target.checked)} />}
                            label={<Typography variant="caption">The layers are one sequence: they cannot cross</Typography>}
                        />
                    </Tooltip>
                    {togetherPick === null && alternates.length > 0 && (
                        <Typography data-testid="sequence-not-suggested" variant="caption" color="text.secondary" sx={{ display: 'block', ml: 2.5, mt: -0.25, mb: 0.25, lineHeight: 1.3 }}>
                            Not ticked to begin with: these layers come and go down the holes, so their contacts step from hole to hole, and layers held to one another&apos;s shape fit that badly.
                        </Typography>
                    )}
                    {layers.length > 1 && (
                        <Tooltip describeChild placement="left" title="Along a hole a layer is met once. A stretch of a layer that is out of order (a stray interval, a lens, a unit that comes back) is read as the layer round it, or left out between two layers, so each contact is met at most once in a hole and all the contacts agree with one another: what is kept is what the line above says a model can match. Unticked, every change of unit down a hole is a contact, and a surface is pulled through all of them. It can be changed for each surface afterwards.">
                            <FormControlLabel
                                sx={{ ml: -0.75, display: 'flex' }}
                                control={<Checkbox size="small" sx={{ p: 0.5 }} checked={asPile} onChange={e => setAsPile(e.target.checked)} inputProps={{ 'data-action': 'as-pile' } as React.InputHTMLAttributes<HTMLInputElement>} />}
                                label={<Typography variant="caption">Each hole is read as one pile of the layers</Typography>}
                            />
                        </Tooltip>
                    )}
                    <Button size="small" variant="contained" fullWidth sx={{ textTransform: 'none', mt: 0.75 }} disabled={!base || (todo.length === 0 && todoShares.length === 0)} onClick={make}>
                        {!base ? 'One unit at least must be a layer' : makeLabel ? `Make ${makeLabel}` : 'Every unit has its contact already'}
                    </Button>
                </Box>
            )}
            {made && (
                <Alert severity={made.bad ? 'warning' : 'success'} sx={{ py: 0, mt: 0.5, fontSize: 12 }}>
                    {made.text}
                    {made.notes.map(note => <Box key={note} data-testid="made-note" sx={{ mt: 0.25 }}>{note}</Box>)}
                </Alert>
            )}
        </Box>
    );
};
