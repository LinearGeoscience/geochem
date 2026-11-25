/**
 * How a geological model is built, step by step, on a small cross-section
 * the reader can change. The surfaces are fitted with the solver the app's
 * surfaces are fitted with, and the units between them are worked out with
 * the rule the models are built with (modelHelpMaths).
 */
import React, { useMemo, useRef, useState } from 'react';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MobileStepper, Slider, Switch, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import type { RuleStep } from '../model/geoModel';
import type { ContactKind } from '../model/types';
import { zeroPieces } from '../plots/viewer3d/surfaceHelpMaths';
import { bodyRound, byBlock, CELL, CHECK_HOLES, gridAt, HEIGHT, joinPieces, leftOut, lineThrough, onlyWhere, rollingContact, unitRuns, unitShares, unitSquares, unitsOfSquares, WIDTH, type Pt } from './modelHelpMaths';

const Y = (z: number) => HEIGHT - z;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const percent = (v: number | undefined) => `${Math.round(100 * (v ?? 0))}%`;

/** The units of the pictures: by the number of the contact whose unit it is (-1: the oldest ground) */
interface Look { name: string; color: string }

interface SectionProps {
    label: string;
    squares: Int16Array;
    looks: ReadonlyMap<number, Look>;
    /** Surfaces drawn as lines: the number at the grid's corners */
    lines?: { values: Float64Array | null; color?: string; dashed?: boolean; /** Drawn only where this says */ only?: (x: number, z: number) => boolean }[];
    points?: Pt[];
    onMove?: (k: number, p: Pt) => void;
    children?: React.ReactNode;
}

/** The cross-section: every unit in its colour, the surfaces as lines, and points that can be dragged */
const Section: React.FC<SectionProps> = ({ label, squares, looks, lines = [], points = [], onMove, children }) => {
    const theme = useTheme();
    const svg = useRef<SVGSVGElement>(null);
    const dragging = useRef<number | null>(null);
    const fills = useMemo(() => [...unitRuns(squares)].map(([u, runs]) => {
        let d = '';
        for (let q = 0; q < runs.length; q += 3) d += `M${runs[q]} ${Y(runs[q + 1] + CELL)}h${runs[q + 2]}v${CELL + 0.3}h${-runs[q + 2]}z`;
        return { u, d };
    }), [squares]);
    const drawn = useMemo(() => lines.map(l => {
        if (!l.values) return '';
        const all = zeroPieces(l.values);
        const pieces: number[] = [];
        for (let q = 0; q < all.length; q += 4) {
            if (!l.only || l.only((all[q] + all[q + 2]) / 2, (all[q + 1] + all[q + 3]) / 2)) pieces.push(all[q], all[q + 1], all[q + 2], all[q + 3]);
        }
        // Joined end to end, so that a dashed line is dashed along its length
        let d = '';
        for (const run of joinPieces(pieces)) for (let q = 0; q < run.length; q += 2) d += `${q ? 'L' : 'M'}${run[q].toFixed(1)} ${Y(run[q + 1]).toFixed(1)}`;
        return d;
    }), [lines]);
    const move = (e: React.PointerEvent) => {
        if (dragging.current === null || !onMove || !svg.current) return;
        const box = svg.current.getBoundingClientRect();
        const x = ((e.clientX - box.left) / (box.width || WIDTH)) * WIDTH, z = HEIGHT - ((e.clientY - box.top) / (box.height || HEIGHT)) * HEIGHT;
        onMove(dragging.current, [clamp(x, 10, WIDTH - 10), clamp(z, 10, HEIGHT - 10)]);
    };
    const nudge = (k: number, p: Pt, e: React.KeyboardEvent) => {
        const by = e.shiftKey ? 25 : 5;
        const d = e.key === 'ArrowLeft' ? [-by, 0] : e.key === 'ArrowRight' ? [by, 0] : e.key === 'ArrowUp' ? [0, by] : e.key === 'ArrowDown' ? [0, -by] : null;
        if (!d || !onMove) return;
        e.preventDefault();
        onMove(k, [clamp(p[0] + d[0], 10, WIDTH - 10), clamp(p[1] + d[1], 10, HEIGHT - 10)]);
    };
    return (
        <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden', bgcolor: 'background.default', lineHeight: 0 }}>
            <svg
                ref={svg} role="img" aria-label={label} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={{ width: '100%', display: 'block', touchAction: 'none' }}
                onPointerMove={move} onPointerUp={() => { dragging.current = null; }} onPointerCancel={() => { dragging.current = null; }}
            >
                {fills.map(f => <path key={f.u} data-testid="help-unit" data-unit={looks.get(f.u)?.name ?? ''} d={f.d} fill={looks.get(f.u)?.color ?? '#999999'} />)}
                {drawn.map((d, k) => d && (
                    <path key={k} data-testid="help-line" data-dashed={lines[k].dashed ? 'yes' : undefined} d={d} fill="none" stroke={lines[k].color ?? theme.palette.common.black} strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={lines[k].dashed ? '7 6' : undefined} />
                ))}
                {children}
                {points.map((p, k) => (
                    <g
                        key={k} role="button" tabIndex={0} aria-label={`Point ${k + 1}: drag it, or move it with the arrow keys`} style={{ cursor: 'grab', outline: 'none' }}
                        onPointerDown={e => { dragging.current = k; svg.current?.setPointerCapture?.(e.pointerId); }} onKeyDown={e => nudge(k, p, e)}
                    >
                        <circle cx={p[0]} cy={Y(p[1])} r={16} fill="transparent" />
                        <circle cx={p[0]} cy={Y(p[1])} r={6.5} fill="#ffffff" stroke="#000000" strokeWidth={2} />
                    </g>
                ))}
            </svg>
        </Box>
    );
};

const Legend: React.FC<{ looks: ReadonlyMap<number, Look>; shares: ReadonlyMap<number, number> }> = ({ looks, shares }) => (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mt: 0.75 }}>
        {[...looks].filter(([u]) => (shares.get(u) ?? 0) > 0).map(([u, look]) => (
            <Box key={u} data-testid="help-share" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Box sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: look.color, border: 1, borderColor: 'divider' }} />
                <Typography variant="caption">{look.name} {percent(shares.get(u))}</Typography>
            </Box>
        ))}
    </Box>
);

const Reading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <Typography data-testid="help-reading" variant="body2" sx={{ mt: 1, fontWeight: 500 }}>{children}</Typography>
);
const Try: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}><b>Try it:</b> {children}</Typography>
);

const BASEMENT: Look = { name: 'Basement', color: '#8d8fb5' };
const SEDIMENTS: Look = { name: 'Sediments', color: '#7fb38f' };
const COVER: Look = { name: 'Cover', color: '#e3cf85' };
const GRANITE: Look = { name: 'Granite', color: '#d98a8a' };

function useTwoLines(lower: Pt[], upper: Pt[]) {
    const [points, setPoints] = useState<Pt[]>([...lower, ...upper]);
    const move = (k: number, p: Pt) => setPoints(now => now.map((q, i) => (i === k ? p : q)));
    const a = useMemo(() => lineThrough(points.slice(0, lower.length)), [points, lower.length]);
    const b = useMemo(() => lineThrough(points.slice(lower.length)), [points, lower.length]);
    return { points, move, a, b };
}

// --- 1 ---------------------------------------------------------------------

const AgeOrder: React.FC = () => {
    const { points, move, a, b } = useTwoLines([[40, 90], [250, 110], [460, 95]], [[40, 200], [250, 185], [460, 210]]);
    const squares = useMemo(() => (a && b ? unitSquares([{ kind: 'deposit', young: 1 }, { kind: 'deposit', young: 1 }], [a, b]) : new Int16Array(0)), [a, b]);
    const looks = new Map([[-1, BASEMENT], [0, SEDIMENTS], [1, COVER]]);
    const shares = unitShares(squares);
    return (
        <>
            <Typography variant="body2">
                A geological model is a list of <b>surfaces in order of age</b>. Each surface has an older side and a younger side, and a <b>unit</b> named
                on its younger side. The oldest ground, under everything, is the background lithology. From that list the app can say which unit is at
                <b> every place</b>: it starts with the background lithology and lets each younger surface, in turn, claim its younger side.
            </Typography>
            <Try>drag the points. The units are whatever lies between the surfaces: you never draw a unit, only its contacts.</Try>
            <Box sx={{ mt: 1.5 }}>
                <Section label="A cross-section: two contacts and the three units between them" squares={squares} looks={looks} lines={[{ values: a }, { values: b }]} points={points} onMove={move} />
            </Box>
            <Legend looks={looks} shares={shares} />
            <Reading>On this section: Basement {percent(shares.get(-1))}, Sediments {percent(shares.get(0))}, Cover {percent(shares.get(1))}. In the app the same sums, in 3D, are each unit’s volume.</Reading>
        </>
    );
};

// --- 2 ---------------------------------------------------------------------

const KINDS: { kind: ContactKind; name: string; how: string }[] = [
    { kind: 'deposit', name: 'Deposit', how: 'Laid on what was there. It cuts nothing: where an older surface rises above it, the older ground carries on up.' },
    { kind: 'erosion', name: 'Erosion', how: 'Cut down into what was there. Everything older on its younger side is gone, whatever it was.' },
];

const ThreeKinds: React.FC = () => {
    const { points, move, a, b } = useTwoLines([[40, 60], [250, 150], [460, 250]], [[40, 170], [250, 160], [460, 175]]);
    const [kind, setKind] = useState<ContactKind>('deposit');
    const [granite, setGranite] = useState(false);
    const body = useMemo(() => bodyRound([330, 150], 55), []);
    const squares = useMemo(() => {
        if (!a || !b) return new Int16Array(0);
        const steps: RuleStep[] = [{ kind: 'deposit', young: 1 }, { kind, young: 1 }, ...(granite ? [{ kind: 'intrusion' as const, young: 1 as const }] : [])];
        return unitSquares(steps, granite ? [a, b, body] : [a, b]);
    }, [a, b, kind, granite, body]);
    const looks = new Map([[-1, BASEMENT], [0, SEDIMENTS], [1, COVER], [2, GRANITE]]);
    const shares = unitShares(squares);
    return (
        <>
            <Typography variant="body2">
                Where two surfaces cross, one of them has to give way. Which one is not a matter of geometry but of <b>what happened</b>, so
                every contact in the chronology is given a kind. Here the older contact (the base of the sediments) climbs to the right until it
                crosses the younger one (the base of the cover).
            </Typography>
            <ToggleButtonGroup size="small" exclusive value={kind} onChange={(_, v) => { if (v) setKind(v); }} sx={{ mt: 1 }} aria-label="The kind of the base of the cover">
                {KINDS.map(k => <ToggleButton key={k.kind} value={k.kind} sx={{ textTransform: 'none', py: 0.25 }}>{k.name}</ToggleButton>)}
            </ToggleButtonGroup>
            <FormControlLabel sx={{ ml: 1.5 }} control={<Switch size="small" checked={granite} onChange={e => setGranite(e.target.checked)} />} label={<Typography variant="body2">An intrusion, the youngest</Typography>} />
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{KINDS.find(k => k.kind === kind)!.how}{granite ? ' An intrusion cuts through everything older than itself, on every side.' : ''}</Typography>
            <Box sx={{ mt: 1.5 }}>
                <Section label="A cross-section: an older contact crossing a younger one, and an intrusion" squares={squares} looks={looks} lines={[{ values: a }, { values: b }, ...(granite ? [{ values: body }] : [])]} points={points} onMove={move} />
            </Box>
            <Legend looks={looks} shares={shares} />
            <Reading>
                {kind === 'deposit'
                    ? `As a deposit, the cover covers ${percent(shares.get(1))} of the section: on the right the sediments stand above its base, and it stops against them.`
                    : `As an erosion surface, the cover covers ${percent(shares.get(1))} of the section: it has cut the sediments away wherever they stood above its base.`}
            </Reading>
        </>
    );
};

// --- 3 ---------------------------------------------------------------------

const FaultBlocks: React.FC = () => {
    const [fault, setFault] = useState<Pt[]>([[230, 40], [290, 260]]);
    const [thrown, setThrown] = useState(50);
    const [cut, setCut] = useState(true);
    const f = useMemo(() => lineThrough(fault), [fault]);
    const left = useMemo(() => lineThrough([[20, 150], [250, 160], [480, 150]]), []);
    const right = useMemo(() => lineThrough([[20, 150 - thrown], [250, 160 - thrown], [480, 150 - thrown]]), [thrown]);
    const squares = useMemo(() => {
        if (!f || !left || !right) return new Int16Array(0);
        return cut ? unitsOfSquares([{ kind: 'deposit', young: 1 }], [byBlock(f, left, right)]) : unitSquares([{ kind: 'deposit', young: 1 }], [left]);
    }, [f, left, right, cut]);
    // The contact of each block, drawn on its own side of the fault
    const contacts = cut && f
        ? [{ values: left, only: (x: number, z: number) => gridAt(f, x, z) > 0 }, { values: right, only: (x: number, z: number) => gridAt(f, x, z) <= 0 }, { values: f, color: '#c62828' }]
        : [{ values: left }];
    const looks = new Map([[-1, BASEMENT], [0, SEDIMENTS]]);
    return (
        <>
            <Typography variant="body2">
                A <b>fault</b> is a surface too, but it is not in the chronology. It cuts the model into <b>fault blocks</b>, and each block has
                its own contacts: the same contact is fitted once from the holes on one side and once from those on the other, so its step
                across the fault is whatever the data on each side says. A fault can end on another fault, and then cuts only one of that
                fault’s sides. A fault can also be told to <b>stop</b>: it is then there only so far past the places it is known at. Beside
                it a layer is offset, less and less towards its end, and round the end the layer runs unbroken. And a fault can be
                <b> offset by a younger fault</b> that has moved it: it is then fitted on each side of the younger fault apart, as a
                contact is, and is in a different place on each.
            </Typography>
            <Try>drag the two points of the fault (red), and change how far one side is thrown down. Turn the fault off: the contact is then one surface through both sides.</Try>
            <Box sx={{ mt: 1.5 }}>
                <Section label="A cross-section: a contact stepped across a fault" squares={squares} looks={looks} lines={contacts} points={fault} onMove={(k, p) => setFault(now => now.map((q, i) => (i === k ? p : q)))} />
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 1 }}>
                <FormControlLabel control={<Switch size="small" checked={cut} onChange={e => setCut(e.target.checked)} />} label={<Typography variant="caption" noWrap>Fault in the model</Typography>} sx={{ flexShrink: 0, mr: 0 }} />
                <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>Thrown down</Typography>
                <Slider size="small" min={0} max={100} step={5} value={thrown} aria-label="How far the far side is thrown down" onChange={(_, v) => setThrown(v as number)} />
            </Box>
            <Reading>{cut ? `Two fault blocks: the contact is ${thrown} m lower on one side of the fault than on the other.` : 'One block: the fault is not in the model, and the contact runs straight across.'}</Reading>
        </>
    );
};

// --- 4 ---------------------------------------------------------------------

const InsideAUnit: React.FC = () => {
    const { points, move, a, b } = useTwoLines([[40, 120], [250, 100], [460, 130]], [[40, 230], [250, 170], [460, 215]]);
    const [inside, setInside] = useState(true);
    const [shell, setShell] = useState(false);
    const squares = useMemo(() => {
        if (!a || !b) return new Int16Array(0);
        const rock = unitSquares([{ kind: 'deposit', young: 1 }], [a]);
        // The second model: oxide above its own surface, fresh below, only inside the sediments
        const alt = unitSquares([{ kind: 'deposit', young: 1 }], [b]);
        return inside ? onlyWhere(Int16Array.from(alt, u => 10 + u), q => rock[q] === 0, -1) : Int16Array.from(alt, u => 10 + u);
    }, [a, b, inside]);
    const looks = new Map<number, Look>([[-1, BASEMENT], [9, { name: 'Fresh sediments', color: '#7fb38f' }], [10, { name: 'Oxidised sediments', color: '#d9b98a' }]]);
    const ore = useMemo(() => bodyRound([250, 110], 70), []);
    // Kept inside the sediments: the shell is the less of "inside the shell" and "inside the unit"
    const kept = useMemo(() => (a ? Float64Array.from(ore, (v, q) => Math.min(v, a[q])) : null), [ore, a]);
    const shares = unitShares(squares);
    return (
        <>
            <Typography variant="body2">
                Some things only make sense <b>inside one unit</b>. Oxidation of the sediments is not a rock type of its own: it is a second model
                that has ground only where the first model has sediments. Set a model’s “Refined model of” (under Boundary) to a unit of another model, and its units
                split that one unit up. Their volumes add up to the unit’s.
            </Typography>
            <Typography variant="body2" sx={{ mt: 1 }}>
                A grade shell can be kept inside a unit the same way (its “Domain”): only the samples in that unit are used, and the
                shell stops at the unit’s faces, so grade does not smear across a contact.
            </Typography>
            <Box sx={{ mt: 1 }}>
                <FormControlLabel control={<Switch size="small" checked={inside} onChange={e => setInside(e.target.checked)} />} label={<Typography variant="body2">The oxidation model is inside Sediments</Typography>} />
                <FormControlLabel control={<Switch size="small" checked={shell} onChange={e => setShell(e.target.checked)} />} label={<Typography variant="body2">A grade shell, kept inside Sediments</Typography>} />
            </Box>
            <Box sx={{ mt: 1 }}>
                <Section
                    label="A cross-section: an oxidation front inside the sediments only, and a grade shell cut off at the contact" squares={squares} looks={looks}
                    lines={[{ values: a }, { values: b, dashed: true }, ...(shell ? [{ values: kept, color: '#c62828' }, { values: ore, color: '#c62828', dashed: true }] : [])]} points={points} onMove={move}
                />
            </Box>
            <Legend looks={looks} shares={shares} />
            <Reading>
                {inside ? 'The oxidation front (dashed) divides the sediments only: the basement is left as it is.' : 'On its own the oxidation model fills its whole box, basement and all.'}
                {shell ? ' The shell (red) stops at the base of the sediments; dashed is where it would go if left free.' : ''}
            </Reading>
        </>
    );
};

// --- 5 ---------------------------------------------------------------------

const HolesLeftOut: React.FC = () => {
    const theme = useTheme();
    const [hole, setHole] = useState(3);
    const all = useMemo(() => lineThrough(CHECK_HOLES.map(x => [x, rollingContact(x)] as Pt)), []);
    const without = useMemo(() => leftOut(hole), [hole]);
    const squares = useMemo(() => (all ? unitSquares([{ kind: 'deposit', young: 1 }], [all]) : new Int16Array(0)), [all]);
    const looks = new Map([[-1, BASEMENT], [0, SEDIMENTS]]);
    const truth = useMemo(() => { let d = ''; for (let x = 0; x <= WIDTH; x += 5) d += `${x ? 'L' : 'M'}${x} ${Y(rollingContact(x)).toFixed(1)}`; return d; }, []);
    const miss = Math.abs(without.miss);
    return (
        <>
            <Typography variant="body2">
                A model always agrees with the holes it was built from: it was made to. The honest question is how well it carries
                <b> between</b> holes. “Cross-validation” answers that the only way it can be answered without drilling: it
                takes some holes away, fits the contacts again from the rest, and asks the model what it has down the holes it never saw.
            </Typography>
            <Try>choose which hole to leave out. The dashed red line is the contact fitted without it; the red ring is where that hole logged the contact. The faint dotted line is the real contact, which nobody gets to see.</Try>
            <Box sx={{ mt: 1.5 }}>
                <Section label="A cross-section: a contact fitted with one hole left out, against where that hole logged it" squares={squares} looks={looks} lines={[{ values: all }, { values: without.field, dashed: true, color: '#c62828' }]}>
                    <path d={truth} fill="none" stroke={theme.palette.common.white} strokeOpacity={0.55} strokeWidth={1} strokeDasharray="2 3" />
                    {CHECK_HOLES.map((x, k) => (
                        <g key={x} opacity={k === hole ? 0.35 : 1}>
                            <line x1={x} y1={Y(HEIGHT - 12)} x2={x} y2={Y(12)} stroke="#000000" strokeWidth={1.5} />
                            <circle cx={x} cy={Y(rollingContact(x))} r={4} fill="#ffffff" stroke="#000000" strokeWidth={1.5} />
                        </g>
                    ))}
                    <circle data-testid="help-logged" cx={without.logged[0]} cy={Y(without.logged[1])} r={6} fill="none" stroke="#c62828" strokeWidth={2.5} />
                </Section>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 1 }}>
                <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>Leave out hole</Typography>
                <Slider size="small" min={1} max={CHECK_HOLES.length} step={1} marks value={hole + 1} aria-label="The hole left out" onChange={(_, v) => setHole((v as number) - 1)} />
            </Box>
            <Reading>
                Without hole {hole + 1}, the model puts the contact {miss < 0.75 ? 'where that hole logged it' : `${Math.round(miss)} m ${without.miss > 0 ? 'above' : 'below'} where that hole logged it`}.
                {' '}{hole === 0 || hole === CHECK_HOLES.length - 1 ? 'A hole at the edge has neighbours on one side only, so it is the hardest to do without.' : 'The app adds this up, in metres of hole in the right unit, over every hole it leaves out.'}
            </Reading>
        </>
    );
};

// --- 6 ---------------------------------------------------------------------

const OutOfTheApp: React.FC = () => (
    <>
        <Typography variant="body2">A model is only useful once it leaves the app. There are four ways out, each from the tree or the properties.</Typography>
        {[
            ['Each sample’s unit, as a column', 'The model’s properties, “Write each sample’s unit to a column”. The column is redone whenever the model is built, so plots and statistics by unit keep up with the model.'],
            ['Sections and plans, into the report', 'A section set’s properties, “A geological model drawn on it”: the units filled, faults, the holes near the section, a grid, a scale and a legend, true to scale. One section, or every section of the set in order. The same section as a picture (.svg) or as linework (.dxf).'],
            ['Meshes', 'Right-click a model, a unit’s solid or a contact: “Export”. Leapfrog (.msh), GOCAD (.ts), .obj and DXF.'],
            ['The whole model, to build again', 'The model’s “Leapfrog export (.zip)”: a note, its chronology, faults and units as tables, every surface’s own kit, and its solids. The same zip opens again here, as a version of the scene.'],
        ].map(([what, how]) => (
            <Typography key={what} variant="body2" sx={{ mt: 1 }}><b>{what}.</b> {how}</Typography>
        ))}
        <Typography variant="body2" sx={{ mt: 1.5 }}>
            <b>Versions of the scene.</b> “Versions”, in the toolbar over the views, keeps the whole scene under a name. Keep one before a change
            you may regret; “Go back to it” puts the scene back as it was.
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
            What a model cannot know: anything between the holes that no hole, point, line or measurement speaks for. It gives the simplest ground
            that honours what it was given. The check against holes left out says how far that can be trusted; it does not make it true.
        </Typography>
    </>
);

const STEPS: { title: string; body: React.FC }[] = [
    { title: 'Surfaces in order of age make the units', body: AgeOrder },
    { title: 'Deposit, erosion or intrusion', body: ThreeKinds },
    { title: 'Faults cut it into blocks', body: FaultBlocks },
    { title: 'Inside one unit: refined units and shells', body: InsideAUnit },
    { title: 'How well does it carry between holes?', body: HolesLeftOut },
    { title: 'Getting it out of the app', body: OutOfTheApp },
];

export const ModelHelp: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
    const [step, setStep] = useState(0);
    const Body = STEPS[step].body;
    // Opened again, it starts at its first page
    const close = () => { setStep(0); onClose(); };
    return (
        <Dialog open={open} onClose={close} maxWidth="sm" fullWidth>
            <DialogTitle sx={{ pb: 0.5 }}>
                <Typography variant="overline" color="text.secondary" sx={{ display: 'block', lineHeight: 1.6 }}>How a geological model is built · {step + 1} of {STEPS.length}</Typography>
                {STEPS[step].title}
            </DialogTitle>
            <DialogContent>
                {/* Each step starts afresh when it is come back to */}
                <Body key={step} />
            </DialogContent>
            <DialogActions sx={{ px: 2 }}>
                <MobileStepper
                    variant="dots" steps={STEPS.length} position="static" activeStep={step} sx={{ flex: 1, bgcolor: 'transparent', p: 0 }}
                    backButton={<Button size="small" disabled={step === 0} onClick={() => setStep(step - 1)}>Back</Button>}
                    nextButton={step < STEPS.length - 1
                        ? <Button size="small" variant="contained" onClick={() => setStep(step + 1)}>Next</Button>
                        : <Button size="small" variant="contained" onClick={close}>Done</Button>}
                />
            </DialogActions>
        </Dialog>
    );
};
