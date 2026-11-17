/**
 * How surfaces are fitted, step by step, on a small cross-section the reader
 * can change: drag the points, move the sliders. Every picture is worked out
 * with the solver the surfaces themselves are fitted with (surfaceHelpMaths).
 */
import React, { createContext, useContext, useMemo, useRef, useState } from 'react';
import {
    Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MobileStepper, Slider, Switch, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { useModelStore } from '../../../store/modelStore';
import { surfaceStatus } from '../../model/describe';
import { contactInputsFor, shellInputsFor, useModelCache } from '../../model/modelCache';
import {
    aboveTrend, demoHoles, dippingHoles, dippingMiddle, directionDemo, ERRATIC_STEP, erraticHoles, FOLD_HOLES, foldedHoles, foldMiddle, foldReadings, gridValues, HEIGHT,
    layeredDemo, levelLines, positiveParts, positiveRuns, sheetDemo, shellDemo, STEP, suggestedReadings, valuesAt, wayDemo, WIDTH, zeroPieces,
    type DemoReading, type DemoSample, type Pt, type ShellWay,
} from './surfaceHelpMaths';

/** Elevation to the picture's y (which runs downwards) */
const Y = (z: number) => HEIGHT - z;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const whole = (v: number) => Math.round(v).toLocaleString();
/** An area on the section, to the nearest hundred square metres */
const hundreds = (v: number) => (Math.round(v / 100) * 100).toLocaleString();

/** Lets a handle inside a picture say it is being dragged */
const Drag = createContext<(id: string, e: React.PointerEvent) => void>(() => undefined);

interface PictureProps {
    label: string;
    /** The number at the grid's corners (null: nothing to draw) */
    values: Float64Array | null;
    /** Tint the side where the number is above zero */
    shade?: boolean;
    /** Draw the zero line only on the pieces this lets through */
    keep?: (x: number, z: number) => boolean;
    onMove?: (id: string, p: Pt) => void;
    children?: React.ReactNode;
}

/** The cross-section: the tinted side, the surface (where the number is zero), and whatever the step adds */
const Picture: React.FC<PictureProps> = ({ label, values, shade = false, keep, onMove, children }) => {
    const theme = useTheme();
    const svg = useRef<SVGSVGElement>(null);
    const dragging = useRef<string | null>(null);
    const drawn = useMemo(() => {
        if (!values) return { line: '', faint: '', tint: '' };
        const pieces = zeroPieces(values);
        let line = '', faint = '';
        for (let q = 0; q < pieces.length; q += 4) {
            const d = `M${pieces[q].toFixed(1)} ${Y(pieces[q + 1]).toFixed(1)}L${pieces[q + 2].toFixed(1)} ${Y(pieces[q + 3]).toFixed(1)}`;
            if (!keep || keep((pieces[q] + pieces[q + 2]) / 2, (pieces[q + 1] + pieces[q + 3]) / 2)) line += d;
            else faint += d;
        }
        const runs = shade ? positiveRuns(values).runs : [];
        // One shape for the whole tinted side, so rows that overlap a hair do not show as stripes
        let tint = '';
        for (let q = 0; q < runs.length; q += 3) tint += `M${runs[q]} ${Y(runs[q + 1] + STEP)}h${runs[q + 2]}v${STEP + 0.4}h${-runs[q + 2]}z`;
        return { line, faint, tint };
    }, [values, shade, keep]);
    const move = (e: React.PointerEvent) => {
        if (!dragging.current || !onMove || !svg.current) return;
        const box = svg.current.getBoundingClientRect();
        const x = ((e.clientX - box.left) / (box.width || WIDTH)) * WIDTH, z = HEIGHT - ((e.clientY - box.top) / (box.height || HEIGHT)) * HEIGHT;
        onMove(dragging.current, [clamp(x, 10, WIDTH - 10), clamp(z, 10, HEIGHT - 10)]);
    };
    const start = (id: string, e: React.PointerEvent) => {
        dragging.current = id;
        svg.current?.setPointerCapture?.(e.pointerId);
    };
    return (
        <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden', bgcolor: 'background.default', lineHeight: 0 }}>
            <svg
                ref={svg} role="img" aria-label={label} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={{ width: '100%', display: 'block', touchAction: 'none' }}
                onPointerMove={move} onPointerUp={() => { dragging.current = null; }} onPointerCancel={() => { dragging.current = null; }}
            >
                {drawn.tint && <path data-testid="help-tint" d={drawn.tint} fill={alpha(theme.palette.primary.main, 0.13)} />}
                {drawn.faint && <path d={drawn.faint} fill="none" stroke={alpha(theme.palette.primary.main, 0.25)} strokeWidth={1.5} strokeDasharray="2 4" />}
                {drawn.line && <path data-testid="help-surface" d={drawn.line} fill="none" stroke={theme.palette.primary.main} strokeWidth={2.5} strokeLinecap="round" />}
                <Drag.Provider value={start}>{children}</Drag.Provider>
            </svg>
        </Box>
    );
};

/** A point of the picture that can be dragged, or moved with the arrow keys */
const Handle: React.FC<{ id: string; p: Pt; name: string; onMove: (id: string, p: Pt) => void; cross?: boolean }> = ({ id, p, name, onMove, cross = false }) => {
    const theme = useTheme();
    const start = useContext(Drag);
    const nudge = (e: React.KeyboardEvent) => {
        const by = e.shiftKey ? 25 : 5;
        const d = e.key === 'ArrowLeft' ? [-by, 0] : e.key === 'ArrowRight' ? [by, 0] : e.key === 'ArrowUp' ? [0, by] : e.key === 'ArrowDown' ? [0, -by] : null;
        if (!d) return;
        e.preventDefault();
        onMove(id, [clamp(p[0] + d[0], 10, WIDTH - 10), clamp(p[1] + d[1], 10, HEIGHT - 10)]);
    };
    return (
        <g
            role="button" tabIndex={0} aria-label={`${name}: drag it, or move it with the arrow keys`} style={{ cursor: 'grab', outline: 'none' }}
            onPointerDown={e => start(id, e)} onKeyDown={nudge}
        >
            {/* A generous target under the mark */}
            <circle cx={p[0]} cy={Y(p[1])} r={16} fill="transparent" />
            {cross ? (
                <path d={`M${p[0] - 7} ${Y(p[1]) - 7}L${p[0] + 7} ${Y(p[1]) + 7}M${p[0] - 7} ${Y(p[1]) + 7}L${p[0] + 7} ${Y(p[1]) - 7}`} stroke={theme.palette.text.primary} strokeWidth={2.5} strokeLinecap="round" />
            ) : (
                <circle cx={p[0]} cy={Y(p[1])} r={6.5} fill={theme.palette.background.paper} stroke={theme.palette.text.primary} strokeWidth={2} />
            )}
        </g>
    );
};

const Note: React.FC<{ x: number; z: number; children: string; anchor?: 'start' | 'end' | 'middle' }> = ({ x, z, children, anchor = 'start' }) => {
    const theme = useTheme();
    return <text x={x} y={Y(z)} fontSize={12} textAnchor={anchor} fill={theme.palette.text.secondary} style={{ userSelect: 'none', fontFamily: theme.typography.fontFamily }}>{children}</text>;
};

const Reading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <Typography data-testid="help-reading" variant="body2" sx={{ mt: 1, fontWeight: 500 }}>{children}</Typography>
);

const Try: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}><b>Try it:</b> {children}</Typography>
);

const START: Pt[] = [[50, 120], [150, 165], [250, 150], [350, 185], [450, 150]];

/** The points of a picture, and the way to move one */
function usePoints(initial: Pt[]) {
    const [points, setPoints] = useState(initial);
    const move = (id: string, p: Pt) => setPoints(now => now.map((q, k) => (`p${k}` === id ? p : q)));
    return { points, move };
}

const handles = (points: Pt[], move: (id: string, p: Pt) => void) => points.map((p, k) => <Handle key={k} id={`p${k}`} p={p} name={`Point ${k + 1}`} onMove={move} />);

// --- 1 ---------------------------------------------------------------------

const NumberEverywhere: React.FC = () => {
    const { points, move } = usePoints(START);
    const [cross, setCross] = useState<Pt>([300, 240]);
    const demo = useMemo(() => sheetDemo(points), [points]);
    const values = useMemo(() => (demo.field ? gridValues(demo.field) : null), [demo.field]);
    const here = demo.field ? valuesAt(demo.field, [cross])[0] : 0;
    return (
        <>
            <Typography variant="body2">
                To draw a surface, the app first gives <b>every place in the ground a number</b>: how far that place is above the surface (+) or below it (−).
                The surface itself is simply where the number is 0, the way a shoreline is where the height of the land above the sea is 0.
            </Typography>
            <Try>drag the cross: its number says how far it is from the surface, and on which side. Drag a point and the surface moves with it.</Try>
            <Box sx={{ mt: 1.5 }}>
                <Picture label="A cross-section: a surface through five points, the ground above it tinted" values={values} shade onMove={(id, p) => (id === 'cross' ? setCross(p) : move(id, p))}>
                    <Note x={12} z={HEIGHT - 20}>above: the number is +</Note>
                    <Note x={12} z={12}>below: the number is −</Note>
                    {handles(points, move)}
                    <Handle id="cross" p={cross} name="The cross" onMove={(_, p) => setCross(p)} cross />
                </Picture>
            </Box>
            <Reading>
                At the cross the number is {here >= 0 ? '+' : '−'}{whole(Math.abs(here))}: about {whole(Math.abs(here))} m {here >= 0 ? 'above' : 'below'} the surface.
            </Reading>
        </>
    );
};

// --- 2 ---------------------------------------------------------------------

const FlatFirst: React.FC = () => {
    const theme = useTheme();
    const { points, move } = usePoints(START);
    const demo = useMemo(() => sheetDemo(points), [points]);
    const { trend } = demo;
    const [nx, , nz] = trend.normal;
    // The trend line from one side of the picture to the other
    const zAt = (x: number) => trend.point[2] - (nx / nz) * (x - trend.point[0]);
    const misses = points.map(p => aboveTrend(trend, p));
    const worst = Math.max(...misses.map(Math.abs));
    const dip = Math.round((Math.atan(Math.abs(nx / nz)) * 180) / Math.PI);
    return (
        <>
            <Typography variant="body2">
                With nothing else to go on, the simplest surface through a set of points is a flat one. So the app first finds
                the <b>flat plane that lies closest to all the points</b>, and starts the number off as the distance from that plane.
                Its tilt is what the panel reports as “Overall it dips 12° towards 090°”.
            </Typography>
            <Typography variant="body2" sx={{ mt: 1 }}>
                The plane does not pass through the points. The short lines show how far each one is from it.
            </Typography>
            <Try>drag a point away from the others and watch the plane tilt to stay as close as it can to all of them.</Try>
            <Box sx={{ mt: 1.5 }}>
                <Picture label="A cross-section: the flat plane that best fits five points, and how far each point is from it" values={null} onMove={move}>
                    <line data-testid="help-trend" x1={0} y1={Y(zAt(0))} x2={WIDTH} y2={Y(zAt(WIDTH))} stroke={theme.palette.text.secondary} strokeWidth={2} strokeDasharray="7 5" />
                    {points.map((p, k) => (
                        <line key={k} x1={p[0]} y1={Y(p[1])} x2={p[0] - misses[k] * nx} y2={Y(p[1] - misses[k] * nz)} stroke={theme.palette.error.main} strokeWidth={2} />
                    ))}
                    {handles(points, move)}
                </Picture>
            </Box>
            <Reading>
                The flat plane misses its points by up to {whole(worst)} m. {dip === 0 ? 'It is level.' : `It dips ${dip}° to the ${nx > 0 ? 'right' : 'left'}.`}
            </Reading>
        </>
    );
};

// --- 3 ---------------------------------------------------------------------

const BendToFit: React.FC = () => {
    const theme = useTheme();
    const { points, move } = usePoints(START);
    const [follow, setFollow] = useState(0);
    const demo = useMemo(() => sheetDemo(points, follow), [points, follow]);
    const values = useMemo(() => (demo.field ? gridValues(demo.field) : null), [demo.field]);
    const { trend } = demo;
    const zAt = (x: number) => trend.point[2] - (trend.normal[0] / trend.normal[2]) * (x - trend.point[0]);
    return (
        <>
            <Typography variant="body2">
                Now each point pulls the surface towards itself. Every point adds a <b>correction</b> to the number that is strongest at that point
                and fades steadily with distance from it. The app works out how hard each point must pull, all of them at once, so that the
                number comes out as exactly 0 at every point. What you get is the simplest surface that honours them all: it goes from point to point
                without bulges the points do not ask for.
            </Typography>
            <Typography variant="body2" sx={{ mt: 1 }}>
                The slider is the panel’s “How closely it follows its points”. Tight, the surface passes through every point. Loosened, it may miss
                points a little in return for a gentler shape: right for scattered samples, wrong for places you picked with care.
            </Typography>
            <Box sx={{ mt: 1.5 }}>
                <Picture label="A cross-section: the flat plane, and the surface bent from it to pass through its points" values={values} onMove={move}>
                    <line x1={0} y1={Y(zAt(0))} x2={WIDTH} y2={Y(zAt(WIDTH))} stroke={theme.palette.text.disabled} strokeWidth={1.5} strokeDasharray="7 5" />
                    {handles(points, move)}
                </Picture>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 1 }}>
                <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>Through every point</Typography>
                <Slider size="small" min={0} max={1} step={0.05} value={follow} aria-label="How closely it follows its points" onChange={(_, v) => setFollow(v as number)} />
                <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>Looser</Typography>
            </Box>
            <Reading>{demo.worst < 0.05 ? `Passes through all ${points.length} points.` : `Passes within ${demo.worst < 10 ? demo.worst.toFixed(1) : whole(demo.worst)} m of its points.`}</Reading>
        </>
    );
};

// --- 4 ---------------------------------------------------------------------

const WhichWayItFaces: React.FC = () => {
    const theme = useTheme();
    const { points, move } = usePoints([[90, 150], [250, 150], [410, 150]]);
    const [dip, setDip] = useState(30);
    const demo = useMemo(() => sheetDemo(points, 0, { at: 1, dip }), [points, dip]);
    const values = useMemo(() => (demo.field ? gridValues(demo.field) : null), [demo.field]);
    const a = (dip * Math.PI) / 180;
    const [mx, mz] = points[1];
    // The reading's mark: a bar along the surface, and a tick on its upper side
    const bar: Pt[] = [[mx - 28 * Math.cos(a), mz + 28 * Math.sin(a)], [mx + 28 * Math.cos(a), mz - 28 * Math.sin(a)]];
    const tick: Pt = [mx + 14 * Math.sin(a), mz + 14 * Math.cos(a)];
    return (
        <>
            <Typography variant="body2">
                A point only says <i>the surface is here</i>. A <b>dip reading</b>, or a <b>line drawn on a slice</b>, also says <i>and this is how it lies here</i>.
                That is the only way to make a surface turn back on itself: points alone can always be joined by something simpler.
            </Typography>
            <Try>turn the reading at the middle point. Past 90° the surface is overturned there, and it folds.</Try>
            <Box sx={{ mt: 1.5 }}>
                <Picture label="A cross-section: a surface through three points, with a dip reading at the middle one" values={values} shade onMove={move}>
                    <line x1={bar[0][0]} y1={Y(bar[0][1])} x2={bar[1][0]} y2={Y(bar[1][1])} stroke={theme.palette.error.main} strokeWidth={3.5} strokeLinecap="round" />
                    <line x1={mx} y1={Y(mz)} x2={tick[0]} y2={Y(tick[1])} stroke={theme.palette.error.main} strokeWidth={3.5} strokeLinecap="round" />
                    {handles(points, move)}
                </Picture>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 1 }}>
                <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>Dip at the middle point</Typography>
                <Slider size="small" min={-80} max={150} step={5} value={dip} aria-label="Dip at the middle point" onChange={(_, v) => setDip(v as number)} />
            </Box>
            <Reading>
                {dip === 0 ? 'The reading is level.' : dip > 90 ? `The reading is overturned: ${180 - dip}° past upright. The tinted side is still its upper side.` : `The reading dips ${Math.abs(dip)}° to the ${dip > 0 ? 'right' : 'left'}.`}
            </Reading>
        </>
    );
};

// --- 5 ---------------------------------------------------------------------

const WhereItStops: React.FC = () => {
    const theme = useTheme();
    const { points, move } = usePoints([[150, 140], [210, 165], [270, 150], [330, 175]]);
    const [reach, setReach] = useState(70);
    const demo = useMemo(() => sheetDemo(points), [points]);
    const values = useMemo(() => (demo.field ? gridValues(demo.field) : null), [demo.field]);
    const keep = useMemo(() => (x: number, z: number) => points.some(p => Math.hypot(p[0] - x, p[1] - z) <= reach), [points, reach]);
    return (
        <>
            <Typography variant="body2">
                The number exists everywhere, so the surface could be drawn right across the data. Often that claims more than you know.
                Each surface has a <b>“Where it stops”</b> setting: near its points (within a reach you set), across the whole of the data,
                or inside an outline you draw in the view.
            </Typography>
            <Try>change the reach. The dotted line is where the surface would carry on if you let it.</Try>
            <Box sx={{ mt: 1.5 }}>
                <Picture label="A cross-section: a surface drawn only within reach of its four points" values={values} keep={keep} onMove={move}>
                    {points.map((p, k) => <circle key={k} cx={p[0]} cy={Y(p[1])} r={reach} fill={alpha(theme.palette.text.primary, 0.035)} stroke={theme.palette.divider} strokeDasharray="3 4" />)}
                    {handles(points, move)}
                </Picture>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 1 }}>
                <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>Reach</Typography>
                <Slider size="small" min={20} max={320} step={10} value={reach} aria-label="Reach" onChange={(_, v) => setReach(v as number)} />
            </Box>
            <Reading>Drawn within {reach} m of its points.</Reading>
        </>
    );
};

// --- 6 and 7 ---------------------------------------------------------------

const Holes: React.FC<{ samples: ReturnType<typeof demoHoles>; cutoff: number }> = ({ samples, cutoff }) => {
    const theme = useTheme();
    const xs = Array.from(new Set(samples.map(s => s.p[0])));
    return (
        <>
            {xs.map(x => <line key={x} x1={x} y1={Y(290)} x2={x} y2={Y(30)} stroke={theme.palette.text.disabled} strokeWidth={1.5} />)}
            {samples.map((s, k) => (s.v >= cutoff
                ? <circle key={k} cx={s.p[0]} cy={Y(s.p[1])} r={5} fill={theme.palette.primary.main} />
                : <circle key={k} cx={s.p[0]} cy={Y(s.p[1])} r={3.5} fill={theme.palette.background.paper} stroke={theme.palette.text.secondary} strokeWidth={1.2} />))}
        </>
    );
};

function useShell(extra: boolean, cutoff: number) {
    const samples = useMemo(() => demoHoles(extra), [extra]);
    const values = useMemo(() => {
        const field = shellDemo(samples, cutoff);
        return field ? gridValues(field) : null;
    }, [samples, cutoff]);
    const area = values ? positiveRuns(values).squares * STEP * STEP : 0;
    const parts = values ? positiveParts(values) : 0;
    const above = samples.filter(s => s.v >= cutoff).length;
    return { samples, values, area, parts, above };
}

const ClosedSurfaces: React.FC = () => {
    const [cutoff, setCutoff] = useState(1);
    const { samples, values, area, above } = useShell(false, cutoff);
    return (
        <>
            <Typography variant="body2">
                A <b>shell</b> or a <b>body</b> is the same idea with the number meaning something else. For a shell it is the value of the column you chose,
                less the cut-off: above 0 inside, below 0 outside. The values are carried through the space between the holes just as before, each sample
                pulling on its surroundings, and the shell is drawn where the number is 0.
            </Typography>
            <Typography variant="body2" sx={{ mt: 1 }}>
                A body round logged units uses the logging instead: the number is positive down the intervals logged as the unit and negative down the others.
            </Typography>
            <Try>move the cut-off. Filled samples are at or above it; the shell goes round them and through the gaps between the holes.</Try>
            <Box sx={{ mt: 1.5 }}>
                <Picture label="A cross-section: four drillholes with samples, and a shell round the samples at or above the cut-off" values={values} shade>
                    <Holes samples={samples} cutoff={cutoff} />
                </Picture>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 1 }}>
                <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>Cut-off</Typography>
                <Slider size="small" min={0.3} max={2.6} step={0.1} value={cutoff} aria-label="Cut-off" valueLabelDisplay="auto" onChange={(_, v) => setCutoff(v as number)} />
            </Box>
            <Reading>
                {above} of {samples.length} samples are at or above {cutoff}. {area > 0 ? `On this section the shell covers about ${hundreds(area)} m².` : 'Nothing reaches it: there is no shell.'}
            </Reading>
        </>
    );
};

const WAYS: { way: ShellWay; name: string; how: string }[] = [
    {
        way: 'values', name: 'From the values',
        how: 'The values are carried between the samples, and the shell is where they equal the cut-off. Every sample at or above it gets a shell round it, however alone it stands, and none of the lower ones is taken in.',
    },
    {
        way: 'counted', name: 'By counting',
        how: 'Each sample counts as at or above the cut-off or not, whatever its value, and the shell is where enough of the samples round about are. Ones standing alone are left out; a lower one among many high ones is taken in.',
    },
    {
        way: 'runs', name: 'Round intercepts',
        how: 'Down each hole the runs that average the cut-off over a least length are found first (the thick bars), the way results are reported: "40 m at 2.6". The shell goes round those: lower samples inside a run are taken in, a single poor one over the cut-off is not.',
    },
];

const ThreeWays: React.FC = () => {
    const theme = useTheme();
    const [way, setWay] = useState<ShellWay>('values');
    const samples = useMemo(() => erraticHoles(), []);
    const { values, flags, counts } = useMemo(() => {
        const { field, flags } = wayDemo(samples, 1, way);
        const at = field ? valuesAt(field, samples.map(s => s.p)) : null;
        const counts = { high: 0, highIn: 0, lowIn: 0 };
        samples.forEach((s, k) => {
            const inside = !!at && at[k] >= 0;
            if (s.v >= 1) {
                counts.high++;
                if (inside) counts.highIn++;
            } else if (inside) counts.lowIn++;
        });
        return { values: field ? gridValues(field) : null, flags, counts };
    }, [samples, way]);
    const parts = values ? positiveParts(values) : 0;
    const chosen = WAYS.find(w => w.way === way)!;
    return (
        <>
            <Typography variant="body2">
                Where single assays are erratic, as with gold, high and low samples lie side by side, and what a shell should go round is a matter of choice.
                There are three ways to find one. Here a zone runs across the middle, about two samples in three of it high, with a few samples just over the cut-off alone above and below it.
            </Typography>
            <ToggleButtonGroup size="small" exclusive fullWidth value={way} onChange={(_, v) => { if (v) setWay(v); }} sx={{ mt: 1.5 }} aria-label="How the shell is found">
                {WAYS.map(w => <ToggleButton key={w.way} value={w.way} sx={{ textTransform: 'none', py: 0.25 }}>{w.name}</ToggleButton>)}
            </ToggleButtonGroup>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1, minHeight: 60 }}>{chosen.how}</Typography>
            <Box sx={{ mt: 1 }}>
                <Picture label={`A cross-section: five drillholes through an erratic zone, and the shell found ${chosen.name.toLowerCase()}`} values={values} shade>
                    {flags && samples.map((s, k) => (flags[k] === 1
                        ? <line key={k} x1={s.p[0]} y1={Y(s.p[1] + ERRATIC_STEP / 2)} x2={s.p[0]} y2={Y(s.p[1] - ERRATIC_STEP / 2)} stroke={theme.palette.primary.main} strokeWidth={7} strokeOpacity={0.45} />
                        : null))}
                    <Holes samples={samples} cutoff={1} />
                </Picture>
            </Box>
            <Reading>
                {counts.highIn} of the {counts.high} samples at or above 1 are inside it{counts.lowIn > 0 ? `, with ${counts.lowIn} lower ${counts.lowIn === 1 ? 'one' : 'ones'}` : ', and no lower ones'}. It is in {parts === 1 ? 'one piece' : `${parts} pieces`}.
            </Reading>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                None of the three is right for every deposit. “Check it against holes left out”, under a shell in the panel, fits it again without some of its holes and
                counts what it finds in them: compare the ways, and their settings, by that.
            </Typography>
        </>
    );
};

// --- 8, 9 and 10: the way the ground runs -----------------------------------

/** How the ground lies at places: a short bar along it at each */
const Ticks: React.FC<{ readings: readonly DemoReading[]; ghost?: boolean }> = ({ readings, ghost = false }) => {
    const theme = useTheme();
    let d = '';
    for (const r of readings) {
        const along = 11 / Math.hypot(1, r.slope);
        d += `M${(r.p[0] - along).toFixed(1)} ${Y(r.p[1] - along * r.slope).toFixed(1)}L${(r.p[0] + along).toFixed(1)} ${Y(r.p[1] + along * r.slope).toFixed(1)}`;
    }
    return <path data-testid={ghost ? 'help-ghosts' : 'help-ticks'} d={d} fill="none" stroke={ghost ? alpha(theme.palette.text.primary, 0.45) : theme.palette.text.primary} strokeWidth={ghost ? 3 : 2.5} strokeLinecap="round" />;
};

const pathOf = (pieces: number[]) => {
    let d = '';
    for (let q = 0; q < pieces.length; q += 4) d += `M${pieces[q].toFixed(1)} ${Y(pieces[q + 1]).toFixed(1)}L${pieces[q + 2].toFixed(1)} ${Y(pieces[q + 3]).toFixed(1)}`;
    return d;
};

/** "One piece. All 4 of the places in the middle of the zone between holes are inside it." */
const joined = (parts: number, inside: number, of: number) => `${parts === 1 ? 'One piece' : `${parts} pieces`}. ${inside === of ? `All ${of}` : inside === 0 ? `None of the ${of}` : `${inside} of the ${of}`} places in the middle of the zone, half-way between holes, ${inside === 1 ? 'is' : 'are'} inside it.`;
const insideOf = (values: ArrayLike<number>) => { let n = 0; for (let i = 0; i < values.length; i++) if (values[i] >= 0) n++; return n; };

const BETWEEN_DIPPING: Pt[] = [107.5, 202.5, 297.5, 392.5].map(x => [x, dippingMiddle(x)]);
const BETWEEN_FOLD: Pt[] = FOLD_HOLES.slice(0, -1).map(x => [x + 35, foldMiddle(x + 35)]);

const OneDirection: React.FC = () => {
    const theme = useTheme();
    const [dip, setDip] = useState(0);
    const [strength, setStrength] = useState(1);
    const samples = useMemo(() => dippingHoles(), []);
    const { values, inside } = useMemo(() => {
        const field = directionDemo(samples, 1, dip, strength);
        return { values: field ? gridValues(field) : null, inside: field ? insideOf(valuesAt(field, BETWEEN_DIPPING)) : 0 };
    }, [samples, dip, strength]);
    const parts = values ? positiveParts(values) : 0;
    return (
        <>
            <Typography variant="body2">
                Holes sample the ground every metre or two down their length, and then not at all for tens of metres to the next hole. With nothing to say
                otherwise, a sample counts for as far up and down as it does sideways: every hole gets a bead of its own, and the beads do not join.
            </Typography>
            <Typography variant="body2" sx={{ mt: 1 }}>
                Under <b>Structure</b> in the panel you say which way the ground runs (a dip and a dip direction, and a long direction within that if there is one)
                and how many times further things carry along it than across it. Shells and bodies are then fitted along it. The oval shows how far one sample
                counts, each way.
            </Typography>
            <Try>raise “how much further” to 4, then turn the direction. Along the zone the beads join into one. Across it they do not.</Try>
            <Box sx={{ mt: 1.5 }}>
                <Picture label="A cross-section: five drillholes through a dipping zone, and the shell fitted along a direction" values={values} shade>
                    <ellipse
                        data-testid="help-oval" cx={107} cy={45} rx={34} ry={34 / strength} transform={`rotate(${dip} 107 45)`}
                        fill={alpha(theme.palette.text.primary, 0.05)} stroke={theme.palette.text.secondary} strokeWidth={1.2}
                    />
                    <Holes samples={samples} cutoff={1} />
                </Picture>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 1 }}>
                <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0, width: 150 }}>
                    {dip === 0 ? 'The ground runs level' : `It runs down to the ${dip > 0 ? 'right' : 'left'} at ${Math.abs(dip)}°`}
                </Typography>
                <Slider size="small" min={-40} max={40} step={5} value={dip} aria-label="Which way the ground runs" onChange={(_, v) => setDip(v as number)} />
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0, width: 150 }}>
                    {strength === 1 ? 'The same every way' : `${strength} times further along`}
                </Typography>
                <Slider size="small" min={1} max={8} step={1} value={strength} aria-label="How much further along than across" onChange={(_, v) => setStrength(v as number)} />
            </Box>
            <Reading>{joined(parts, inside, BETWEEN_DIPPING.length)}</Reading>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                The direction is yours to give, and the model takes it at its word: a wrong one joins the wrong samples. “Check it against holes left out”
                says whether a direction finds more of what is in the holes it was not shown.
            </Typography>
        </>
    );
};

type Following = 'none' | 'one' | 'readings';
const FOLLOWING: { way: Following; name: string; how: string }[] = [
    { way: 'none', name: 'The same every way', how: 'Nothing says which way the ground runs: a bead on every hole.' },
    { way: 'one', name: 'One direction', how: 'One direction for the whole model, here level: right at the tops and bottoms of the folds, wrong on the limbs between them.' },
    {
        way: 'readings', name: 'Readings',
        how: 'The direction is taken from the readings, place by place (the dark bars: the layering as measured down the holes). The faint lines are the way the ground runs as worked out from them.',
    },
];
/** The shells of these pictures carry this many times further along the ground than across it: what the panel starts with */
const USUAL_STRENGTH = 4;

/** The shell of the folded pictures, following nothing, one level direction, or readings */
function useFolded(samples: readonly DemoSample[], way: Following, readings: readonly DemoReading[]) {
    return useMemo(() => {
        if (way === 'readings') {
            const demo = layeredDemo(samples, 1, readings, USUAL_STRENGTH);
            if (demo) return { values: demo.values, inside: insideOf(demo.at(BETWEEN_FOLD)), lines: pathOf(levelLines(demo.heights, 30)) };
        }
        const field = directionDemo(samples, 1, 0, way === 'one' ? USUAL_STRENGTH : 1);
        return { values: field ? gridValues(field) : null, inside: field ? insideOf(valuesAt(field, BETWEEN_FOLD)) : 0, lines: '' };
    }, [samples, way, readings]);
}

const PlaceToPlace: React.FC = () => {
    const theme = useTheme();
    const [way, setWay] = useState<Following>('none');
    const samples = useMemo(() => foldedHoles(), []);
    const readings = useMemo(() => foldReadings(), []);
    const { values, inside, lines } = useFolded(samples, way, readings);
    const parts = values ? positiveParts(values) : 0;
    return (
        <>
            <Typography variant="body2">
                One direction cannot follow ground that is folded, or a structure that swings round. <b>Readings</b> can: dips and dip directions measured down the
                holes or at surface, of the bedding, say, or a foliation. They come in from columns of a table, or you place them by hand in the 3D view.
                Between readings the direction changes smoothly from one to the next.
            </Typography>
            <ToggleButtonGroup size="small" exclusive fullWidth value={way} onChange={(_, v) => { if (v) setWay(v); }} sx={{ mt: 1.5 }} aria-label="What the shell follows">
                {FOLLOWING.map(w => <ToggleButton key={w.way} value={w.way} sx={{ textTransform: 'none', py: 0.25 }}>{w.name}</ToggleButton>)}
            </ToggleButtonGroup>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1, minHeight: 60 }}>{FOLLOWING.find(w => w.way === way)!.how}</Typography>
            <Box sx={{ mt: 1 }}>
                <Picture label="A cross-section: seven drillholes through a folded zone, readings of the layering down them, and the shell" values={values} shade>
                    {lines && <path data-testid="help-layers" d={lines} fill="none" stroke={alpha(theme.palette.text.primary, 0.16)} strokeWidth={1} />}
                    <Holes samples={samples} cutoff={1} />
                    <Ticks readings={readings} />
                </Picture>
            </Box>
            <Reading>{joined(parts, inside, BETWEEN_FOLD.length)}</Reading>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                From the readings of planes the model gives every place a height through the layers (the faint lines are its levels). Two places on one level
                are near each other for the fit, however far round the fold. Two on different levels are not.
            </Typography>
            <Typography variant="body2" component="ul" sx={{ pl: 2.5, mt: 1, mb: 0, '& li': { mb: 0.5 } }}>
                <li>Tick the readings of <b>one thing</b> to be followed (the bedding, say), not of things that cut across each other.</li>
                <li>Sheets and contacts lie as the readings say where they pass near them. Shells follow readings of planes round folds. Bodies from logging follow only the one direction.</li>
                <li>Past the distance a reading carries, the one direction set for the model is used, if there is one.</li>
            </Typography>
        </>
    );
};

const SuggestedReadings: React.FC = () => {
    const [suggested, setSuggested] = useState(false);
    const [followed, setFollowed] = useState(false);
    const samples = useMemo(() => foldedHoles(), []);
    const offered = useMemo(() => suggestedReadings(samples, 1), [samples]);
    const { values, inside } = useFolded(samples, suggested && followed ? 'readings' : 'none', offered);
    const parts = values ? positiveParts(values) : 0;
    const count = `${offered.length} ${offered.length === 1 ? 'plane' : 'planes'}`;
    return (
        <>
            <Typography variant="body2">
                Where nothing was measured, <b>Suggest</b> (under Readings in the panel) works readings out from what is in the model: from the faces of a fitted
                surface or a wireframe, or from where a shell’s column is high.
            </Typography>
            <Typography variant="body2" sx={{ mt: 1 }}>
                For the highs, each run of high samples down a hole counts as one place. Round each, the runs in the holes a couple of spacings about are
                taken together: where they are flattened, more than the drilling there would make them look, the plane they are flattened in is suggested,
                and the panel says how flat they are (a thin sheet is many times as wide as it is thick, a thick zone only a little). A thick zone shows
                its lie only over a longer distance, so where nothing shows close by, it is looked for further out. Where, within the plane, the highs go
                much further one way than the other, and the drilling does not, that direction is suggested as a line.
            </Typography>
            <Box sx={{ mt: 1.5 }}>
                <Picture label="A cross-section: seven drillholes through a folded zone, readings suggested from its high samples, and the shell" values={values} shade>
                    <Holes samples={samples} cutoff={1} />
                    {suggested && <Ticks readings={offered} ghost={!followed} />}
                </Picture>
            </Box>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2, mt: 0.5 }}>
                <FormControlLabel
                    control={<Switch size="small" checked={suggested} onChange={e => { setSuggested(e.target.checked); if (!e.target.checked) setFollowed(false); }} />}
                    label={<Typography variant="body2">Suggest from the high samples</Typography>}
                />
                <FormControlLabel
                    control={<Switch size="small" checked={followed} disabled={!suggested} onChange={e => setFollowed(e.target.checked)} />}
                    label={<Typography variant="body2">Keep them and follow them</Typography>}
                />
            </Box>
            <Reading>
                {!suggested ? `Nothing suggested. ${joined(parts, inside, BETWEEN_FOLD.length)}`
                    : !followed ? `${count} suggested, in grey. Nothing has changed: ${parts === 1 ? 'one piece' : `${parts} pieces`}, as before.`
                        : `${count} kept and followed. ${joined(parts, inside, BETWEEN_FOLD.length)}`}
            </Reading>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                (A plane cannot be told from the holes of one section alone: for this picture the same holes are taken to be drilled on five sections, 70 m apart.)
            </Typography>
            <Typography variant="subtitle2" sx={{ mt: 1.5 }}>What a suggestion is, and is not</Typography>
            <Typography variant="body2" component="ul" sx={{ pl: 2.5, mt: 0.5, mb: 0, '& li': { mb: 0.5 } }}>
                <li>It is drawn in grey and is no part of the model until you keep it. Kept, it is listed as “Suggested, not measured”, and is not followed until you tick it.</li>
                <li>It says what shape the highs have, not what made them that shape.</li>
                <li>Each is worked out from holes a couple of spacings round about, so a tight bend comes out flatter than it is.</li>
                <li>A shell that follows readings taken from its own highs agrees with itself. Use measurements where you have them, and check against holes left out.</li>
            </Typography>
        </>
    );
};

const WhatItCannotKnow: React.FC = () => {
    const [extra, setExtra] = useState(false);
    const { samples, values, area, parts } = useShell(extra, 1);
    const surfaces = useModelStore(s => s.scene.surfaces);
    const fits = useModelCache(s => s.byId);
    return (
        <>
            <Typography variant="body2">
                Between the holes a surface is <b>the simplest shape that agrees with the data</b>: an estimate, not an observation. More data changes it.
            </Typography>
            <Try>drill one more hole between the two in the middle. It finds much less than its neighbours suggested.</Try>
            <Box sx={{ mt: 1.5 }}>
                <Picture label="A cross-section: the shell before and after one more hole is drilled through the middle of it" values={values} shade>
                    <Holes samples={samples} cutoff={1} />
                </Picture>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 0.5 }}>
                <FormControlLabel control={<Switch size="small" checked={extra} onChange={e => setExtra(e.target.checked)} />} label={<Typography variant="body2">Drill one more hole</Typography>} />
            </Box>
            <Reading>On this section the shell covers about {hundreds(area)} m²{parts > 1 ? `, in ${parts} separate parts.` : ', in one piece.'}</Reading>
            <Typography variant="subtitle2" sx={{ mt: 2 }}>What to check on your own surfaces</Typography>
            <Typography variant="body2" component="ul" sx={{ pl: 2.5, mt: 0.5, mb: 0, '& li': { mb: 0.5 } }}>
                <li>The line under each surface’s name says how well it honours its data: “Passes through all 23 points”, or how many logged intervals are on the wrong side of it.</li>
                <li>Far from any hole a surface is only the trend carried on. Keep it near its points unless you mean it.</li>
                <li>A unit thinner than the gap between holes may be drawn with gaps, or not at all. The panel says so when that is likely.</li>
            </Typography>
            {surfaces.length > 0 && (
                <Box data-testid="help-yours" sx={{ mt: 1.5 }}>
                    <Typography variant="subtitle2">Yours, now</Typography>
                    {surfaces.slice(0, 6).map(s => (
                        <Typography key={s.id} variant="body2" color="text.secondary">
                            <Box component="span" sx={{ display: 'inline-block', width: 10, height: 10, borderRadius: '2px', bgcolor: s.color, mr: 0.75 }} />
                            <b>{s.name}</b>: {surfaceStatus(s, fits[s.id], contactInputsFor(s), shellInputsFor(s)).headline}
                        </Typography>
                    ))}
                </Box>
            )}
            <Typography variant="subtitle2" sx={{ mt: 2 }}>In shorthand</Typography>
            <Typography variant="body2" color="text.secondary">
                The number at a place = the flat plane’s distance there + a constant + the sum, over the points, of (how hard that point pulls × the distance from the place to that point).
                Other software calls this an implicit model, and the corrections radial basis functions (RBF).
            </Typography>
        </>
    );
};

const STEPS: { title: string; body: React.FC }[] = [
    { title: 'A number for every place', body: NumberEverywhere },
    { title: 'Start with the flat plane that fits best', body: FlatFirst },
    { title: 'Bend it to pass through every point', body: BendToFit },
    { title: 'Tell it which way it faces', body: WhichWayItFaces },
    { title: 'Where it stops', body: WhereItStops },
    { title: 'Closed surfaces: shells and bodies', body: ClosedSurfaces },
    { title: 'Three ways to find a shell', body: ThreeWays },
    { title: 'Which way the ground runs', body: OneDirection },
    { title: 'Where the ground changes direction', body: PlaceToPlace },
    { title: 'Readings worked out from the data', body: SuggestedReadings },
    { title: 'What it cannot know', body: WhatItCannotKnow },
];

export const SurfaceHelp: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
    const [step, setStep] = useState(0);
    const Body = STEPS[step].body;
    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle sx={{ pb: 0.5 }}>
                <Typography variant="overline" color="text.secondary" sx={{ display: 'block', lineHeight: 1.6 }}>How surfaces are fitted · {step + 1} of {STEPS.length}</Typography>
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
                        : <Button size="small" variant="contained" onClick={onClose}>Done</Button>}
                />
            </DialogActions>
        </Dialog>
    );
};
