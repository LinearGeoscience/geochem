/**
 * How surfaces are fitted, step by step, on a small cross-section the reader
 * can change: drag the points, move the sliders. Every picture is worked out
 * with the solver the surfaces themselves are fitted with (surfaceHelpMaths).
 */
import React, { createContext, useContext, useMemo, useRef, useState } from 'react';
import {
    Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Link, MobileStepper, Slider, Switch, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { useModelStore } from '../../../store/modelStore';
import { surfaceStatus } from '../../model/describe';
import { contactInputsFor, shellInputsFor, useModelCache } from '../../model/modelCache';
import {
    aboveTrend, bodyDemo, CHRONO_BASES, CHRONO_COVER, CHRONO_PILE, chronoFold, chronologyDemo, chronoOutline, demoHoles, dippingHoles, dippingMiddle, directionDemo, ERRATIC_STEP, erraticHoles, FOLD_HOLES, foldedHoles, foldMiddle, foldReadings, gridValues, HEIGHT,
    layeredDemo, levelLines, lodesDemo, NX, NZ, positiveParts, positiveRuns, sheetDemo, shellDemo, SLAB_DIP, SLAB_TREND, STEP, suggestedReadings, THIN_DIP, THIN_HOLES, THIN_REACH, THIN_THICK, THIN_TRUE,
    thinDemo, valuesAt, VEIN_HOLES, veinDemo, wayDemo, WIDTH, zeroPieces,
    type ChronoCase, type DemoReading, type DemoSample, type Pt, type ShellWay, type ThinWay,
} from './surfaceHelpMaths';
import { gradeDemo, GRADE_HOLES, ZONE_HALF, zoneMiddle, zoneOutline } from './gradeHelpMaths';
import { gradeText, shareText } from '../../model/gradeTable';

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

const VEIN_HOLE_XS = VEIN_HOLES;

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
                The slider is the panel’s “Smoothing”. Tight, the surface passes through every point. Loosened, it may miss
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
                <Slider size="small" min={0} max={1} step={0.05} value={follow} aria-label="Smoothing" onChange={(_, v) => setFollow(v as number)} />
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
                A point only says <i>the surface is here</i>. A <b>dip measurement</b>, or a <b>line drawn on a slice</b>, also says <i>and this is how it lies here</i>.
                That is the only way to make a surface turn back on itself: points alone can always be joined by something simpler.
            </Typography>
            <Try>turn the measurement at the middle point. Past 90° the surface is overturned there, and it folds.</Try>
            <Box sx={{ mt: 1.5 }}>
                <Picture label="A cross-section: a surface through three points, with a dip measurement at the middle one" values={values} shade onMove={move}>
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
                {dip === 0 ? 'The measurement is level.' : dip > 90 ? `The measurement is overturned: ${180 - dip}° past upright. The tinted side is still its upper side.` : `The measurement dips ${Math.abs(dip)}° to the ${dip > 0 ? 'right' : 'left'}.`}
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
                Each surface has a <b>“Surface extent”</b> setting: near its points (within a reach you set), across the whole of the data,
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
            <Typography variant="body2" sx={{ mt: 1.5 }}>
                A <b>geological model</b> has a boundary too (the Boundary tab of its properties). Given no box, it takes the box of the holes
                its lithologies are logged in, with a margin: holes that were never logged are not ground it knows anything of. Its box can be
                typed side by side, or moved in a 3D view: with the model picked, each face has a handle to drag. And it can be kept
                <b> only near its drilling</b>: ground further than a distance from every hole it reads is left out, so its units are not
                carried into ground no hole is near. The distance offered is how far apart its holes are; gaps between holes narrower than it
                are filled, so the ground is whole where it is drilled. With the limit off, the Boundary tab says how much of the box is
                further than that from every hole.
            </Typography>
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

const ThinBodies: React.FC = () => {
    const theme = useTheme();
    const [thick, setThick] = useState(14);
    const [how, setHow] = useState<'walls' | 'volume'>('walls');
    const [missed, setMissed] = useState(false);
    const demo = useMemo(() => veinDemo(thick, missed), [thick, missed]);
    const values = useMemo(() => {
        const field = how === 'walls' ? demo.walls : demo.volume;
        return field ? gridValues(field) : null;
    }, [demo, how]);
    const parts = values ? positiveParts(values) : 0;
    return (
        <>
            <Typography variant="body2">
                A <b>vein</b>, a dyke or a shear zone is thin against the gaps between the holes. Fitted as a volume, the number is above 0 only for a few
                metres down each hole, and nothing says it should stay above 0 all the way to the next hole: it comes out as beads round the holes.
            </Typography>
            <Typography variant="body2" sx={{ mt: 1 }}>
                So a vein is built from its <b>two walls</b> instead. A surface is fitted through the middle of it at every hole, like any other surface.
                Then how far each wall is from that surface is carried from hole to hole. The vein is whatever lies between the two walls.
            </Typography>
            <Try>switch between the two ways, and make it thinner. Then let the middle hole miss it.</Try>
            <Box sx={{ mt: 1.5 }}>
                <Picture label="A cross-section: five drillholes through a thin vein, drawn from its walls or as a volume" values={values} shade>
                    {VEIN_HOLE_XS.map(x => <line key={x} x1={x} y1={Y(290)} x2={x} y2={Y(20)} stroke={theme.palette.text.disabled} strokeWidth={1.5} />)}
                    {demo.hits.map(h => <line key={h.x} data-testid="help-vein-hit" x1={h.x} y1={Y(h.top)} x2={h.x} y2={Y(h.bottom)} stroke={theme.palette.primary.main} strokeWidth={6} />)}
                    {demo.miss && <circle data-testid="help-vein-miss" cx={demo.miss[0]} cy={Y(demo.miss[1])} r={5} fill={theme.palette.background.paper} stroke={theme.palette.text.secondary} strokeWidth={1.5} />}
                </Picture>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 1, flexWrap: 'wrap' }}>
                <ToggleButtonGroup size="small" exclusive value={how} aria-label="How it is made" onChange={(_, v) => { if (v) setHow(v); }}>
                    <ToggleButton value="walls" sx={{ textTransform: 'none', py: 0.25 }}>From its walls</ToggleButton>
                    <ToggleButton value="volume" sx={{ textTransform: 'none', py: 0.25 }}>As a volume</ToggleButton>
                </ToggleButtonGroup>
                <FormControlLabel
                    control={<Switch size="small" checked={missed} onChange={e => setMissed(e.target.checked)} />}
                    label={<Typography variant="caption">The middle hole finds none</Typography>}
                />
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>Thickness</Typography>
                <Slider size="small" min={10} max={40} step={2} value={thick} aria-label="Thickness of the vein" valueLabelDisplay="auto" onChange={(_, v) => setThick(v as number)} />
            </Box>
            <Reading>
                {how === 'walls'
                    ? (missed
                        ? `From its walls: ${parts === 2 ? 'it stops before the hole that found none, and carries on beyond it' : `${parts} pieces`}. A hole through where it would be is as good as a measurement that it is not there.`
                        : `From its walls: ${parts === 1 ? 'one piece' : `${parts} pieces`}, ${thick} m thick at every hole and between them.`)
                    : `As a volume: ${parts === 1 ? 'one piece' : `${parts} separate pieces`}${parts > 1 ? ', one round each hole' : ''}. The holes are 100 m apart and it is ${thick} m thick.`}
            </Reading>
            <Typography variant="body2" sx={{ mt: 1 }}>
                A vein is drawn as it was fitted: each wall where the fit has it, and more finely round the holes, where its thickness is known. In a geological
                model whose cells are wider than the vein, the vein keeps this mesh of its own, and so does an intrusion thinner than two cells: what it
                holds is then measured from that mesh, not from the cells.
            </Typography>
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
                None of the three is right for every deposit. “Cross-validation”, under a shell in the panel, fits it again without some of its holes and
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
                Under <b>Structural data</b> in the project tree, the <b>Global trend</b> says which way the ground runs (a dip and a dip direction, and a long direction within that if there is one)
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
                The direction is yours to give, and the model takes it at its word: a wrong one joins the wrong samples. “Cross-validation”
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
        way: 'readings', name: 'Measurements',
        how: 'The direction is taken from the measurements, place by place (the dark bars: the layering as measured down the holes). The faint lines are the way the ground runs as worked out from them.',
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
                One direction cannot follow ground that is folded, or a structure that swings round. <b>Measurements</b> can: dips and dip directions measured down the
                holes or at surface, of the bedding, say, or a foliation. They come in from columns of a table, or you place them by hand in the 3D view.
                Between measurements the direction changes smoothly from one to the next.
            </Typography>
            <ToggleButtonGroup size="small" exclusive fullWidth value={way} onChange={(_, v) => { if (v) setWay(v); }} sx={{ mt: 1.5 }} aria-label="What the shell follows">
                {FOLLOWING.map(w => <ToggleButton key={w.way} value={w.way} sx={{ textTransform: 'none', py: 0.25 }}>{w.name}</ToggleButton>)}
            </ToggleButtonGroup>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1, minHeight: 60 }}>{FOLLOWING.find(w => w.way === way)!.how}</Typography>
            <Box sx={{ mt: 1 }}>
                <Picture label="A cross-section: seven drillholes through a folded zone, measurements of the layering down them, and the shell" values={values} shade>
                    {lines && <path data-testid="help-layers" d={lines} fill="none" stroke={alpha(theme.palette.text.primary, 0.16)} strokeWidth={1} />}
                    <Holes samples={samples} cutoff={1} />
                    <Ticks readings={readings} />
                </Picture>
            </Box>
            <Reading>{joined(parts, inside, BETWEEN_FOLD.length)}</Reading>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                From the measurements of planes the model gives every place a height through the layers (the faint lines are its levels). Two places on one level
                are near each other for the fit, however far round the fold. Two on different levels are not.
            </Typography>
            <Typography variant="body2" component="ul" sx={{ pl: 2.5, mt: 1, mb: 0, '& li': { mb: 0.5 } }}>
                <li>Tick the measurements of <b>one thing</b> to be followed (the bedding, say), not of things that cut across each other.</li>
                <li>Sheets and contacts lie as the measurements say where they pass near them. Shells follow measurements of planes round folds. Bodies from logging follow only the one direction.</li>
                <li>Past the distance a measurement carries, the one direction set for the model is used, if there is one.</li>
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
                Where nothing was measured, <b>Suggest</b> (under Measurements in the panel) works measurements out from what is in the model: from the faces of a fitted
                surface or a mesh, or from where a shell’s column is high.
            </Typography>
            <Typography variant="body2" sx={{ mt: 1 }}>
                For the highs, each run of high samples down a hole counts as one place. Round each, the runs in the holes a couple of spacings about are
                taken together: where they are flattened, more than the drilling there would make them look, the plane they are flattened in is suggested,
                and the panel says how flat they are (a thin sheet is many times as wide as it is thick, a thick zone only a little). A thick zone shows
                its lie only over a longer distance, so where nothing shows close by, it is looked for further out. Where, within the plane, the highs go
                much further one way than the other, and the drilling does not, that direction is suggested as a line.
            </Typography>
            <Box sx={{ mt: 1.5 }}>
                <Picture label="A cross-section: seven drillholes through a folded zone, measurements suggested from its high samples, and the shell" values={values} shade>
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
                <li>A shell that follows directions suggested from its own highs agrees with itself. Use real measurements where you have them, and cross-validate.</li>
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
                <li>The line under each surface’s name says how well it honours its data: “Passes through all 23 points”, or how many logged intervals are on the wrong side of it. An interval much longer than the rest is checked every few metres along it, so that a surface cannot cut deep into it unnoticed.</li>
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

/** Dips and lines on a body's skin: a dipping slab in five holes, with and without them */
const ByHand: React.FC = () => {
    const theme = useTheme();
    const [dips, setDips] = useState(false);
    const [measured, setMeasured] = useState(SLAB_DIP);
    const [line, setLine] = useState(false);
    const [trend, setTrend] = useState(false);
    const demo = useMemo(() => bodyDemo(dips, measured, line, trend), [dips, measured, line, trend]);
    const values = useMemo(() => (demo.field ? gridValues(demo.field) : null), [demo]);
    const parts = values ? positiveParts(values) : 0;
    const rad = measured * Math.PI / 180;
    return (
        <>
            <Typography variant="body2">
                Between the holes a body or a vein is the fit’s own guess. You can tell it how it lies. Put a <b>dip measurement</b> on a place
                on its skin, give a place a <b>direction</b> it runs along, or <b>draw a line</b> on a section where you see its edge.
            </Typography>
            <Typography variant="body2" sx={{ mt: 1 }}>
                Here a slab dips {SLAB_DIP}° across five holes. From one hole to the next it steps down further than it is thick, so the logging
                alone does not say which way it runs.
            </Typography>
            <Try>tick the dip measurements: its skin turns to them at the holes, and it is still in pieces. Then give it a trend of its own along that dip. Then change the angle.</Try>
            <Box sx={{ mt: 1.5 }}>
                <Picture label="A cross-section: five drillholes through a dipping slab, fitted as a body, with dip measurements and a drawn line" values={values} shade>
                    {demo.hits.map(h => <line key={h.x} x1={h.x} y1={Y(295)} x2={h.x} y2={Y(5)} stroke={theme.palette.text.disabled} strokeWidth={1.5} />)}
                    {demo.hits.map(h => <line key={h.x} data-testid="help-slab-hit" x1={h.x} y1={Y(h.top)} x2={h.x} y2={Y(h.bottom)} stroke={theme.palette.primary.main} strokeWidth={6} />)}
                    {dips && demo.hits.flatMap(h => [h.top, h.bottom].map(z => (
                        <line
                            key={`${h.x}-${z}`} data-testid="help-slab-dip" x1={h.x - 16 * Math.cos(rad)} y1={Y(z + 16 * Math.sin(rad))} x2={h.x + 16 * Math.cos(rad)} y2={Y(z - 16 * Math.sin(rad))}
                            stroke={theme.palette.secondary.main} strokeWidth={3} strokeLinecap="round"
                        />
                    )))}
                    {demo.line.length > 1 && (
                        <polyline data-testid="help-slab-line" points={demo.line.map(p => `${p[0]},${Y(p[1])}`).join(' ')} fill="none" stroke={theme.palette.secondary.main} strokeWidth={3} strokeDasharray="6 4" />
                    )}
                </Picture>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 1, flexWrap: 'wrap' }}>
                <FormControlLabel control={<Switch size="small" checked={dips} onChange={e => setDips(e.target.checked)} />} label={<Typography variant="caption">A dip measurement at every contact</Typography>} />
                <FormControlLabel control={<Switch size="small" checked={trend} onChange={e => setTrend(e.target.checked)} />} label={<Typography variant="caption">A trend of its own, along that dip</Typography>} />
                <FormControlLabel control={<Switch size="small" checked={line} onChange={e => setLine(e.target.checked)} />} label={<Typography variant="caption">Draw its top between two holes</Typography>} />
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>Dip measured</Typography>
                <Slider size="small" min={0} max={50} step={5} value={measured} disabled={!dips && !trend} aria-label="The dip measured at the contacts" valueLabelDisplay="auto" onChange={(_, v) => setMeasured(v as number)} />
            </Box>
            <Reading>
                {parts === 1 ? 'One piece.' : `${parts} pieces.`}{' '}
                {dips
                    ? `At the holes its skin lies within ${demo.off < 1 ? 'a degree' : `${Math.round(demo.off)}°`} of the ${measured}° measured.`
                    : `At the holes its skin lies up to ${Math.round(demo.off)}° from the ${SLAB_DIP}° the slab dips.`}
            </Reading>
            <Typography variant="body2" sx={{ mt: 1 }}>
                A dip measurement says how the skin lies <b>at its place</b>, and no further. What joins a thin body from hole to hole is its
                <b> trend</b>: things carry {SLAB_TREND} times further along it than across it here. Where the skin is between two holes is said by a
                drawn line or a place. Which side of a dip or a line is the inside is taken from the logging near it, and a line can be turned over (R).
            </Typography>
            <Typography variant="subtitle2" sx={{ mt: 2 }}>What each kind of surface takes</Typography>
            <Typography variant="body2" component="ul" sx={{ pl: 2.5, mt: 0.5, mb: 0, '& li': { mb: 0.5 } }}>
                <li><b>A surface or a contact</b>: places, lines, dip measurements, directions.</li>
                <li><b>A body</b>: the same, on its skin.</li>
                <li><b>A vein</b>: a place with a dip measurement or a direction, and every line, is on the surface through the middle of it and says how the vein lies; the vein is carried along a line. A plain place is on one of its walls.</li>
                <li><b>A shell</b> takes nothing by hand: it follows its values, and the trend.</li>
            </Typography>
            <Typography variant="subtitle2" sx={{ mt: 2 }}>Its own trend</Typography>
            <Typography variant="body2">
                Under <b>Trend</b> each surface can follow structural data of its own choosing, and have a global trend of its own: a dip, a plunge and how
                much further things carry along them than across. So a set of dykes can follow a shear fabric while a contact beside it follows bedding.
                With a plunge, shells and bodies join further down it than across it, and a vein’s thickness is carried further down it.
            </Typography>
        </>
    );
};

/** Several thin sheets side by side: one zone round them all, or a vein of each, kept as a vein system */
const SideBySide: React.FC = () => {
    const theme = useTheme();
    const [how, setHow] = useState<'zone' | 'each'>('zone');
    const [stops, setStops] = useState(false);
    const demo = useMemo(() => lodesDemo(how, stops), [how, stops]);
    const parts = demo.values ? positiveParts(demo.values) : 0;
    const shades = [theme.palette.primary.main, theme.palette.success.main, theme.palette.secondary.main];
    return (
        <>
            <Typography variant="body2">
                Veins and dykes often come <b>several side by side</b>: a hole goes through two or three of them, a few metres apart. One vein cannot
                pass through them all, so there are two ways to build them.
            </Typography>
            <Typography variant="body2" component="ul" sx={{ pl: 2.5, mt: 0.5, mb: 0, '& li': { mb: 0.5 } }}>
                <li><b>As one zone.</b> Stretches less than a <b>join length</b> apart down a hole are joined into one, and one vein is built round the lot. It is in one piece and easy to carry between holes, but much of what it holds is the rock between the sheets.</li>
                <li><b>A vein of each.</b> The stretches that are level with each other across the sheets, from one hole to the next, are taken as one vein, and a vein is made of each. Together they are a <b>vein system</b>.</li>
            </Typography>
            <Try>switch between the two. Then make the branch stop at the vein it leaves.</Try>
            <Box sx={{ mt: 1.5 }}>
                <Picture label="A cross-section: five drillholes through two veins one above the other and a branch between them, built as one zone or as a vein of each" values={demo.values} shade>
                    {VEIN_HOLE_XS.map(x => <line key={x} x1={x} y1={Y(290)} x2={x} y2={Y(20)} stroke={theme.palette.text.disabled} strokeWidth={1.5} />)}
                    {demo.hits.map(h => (
                        <line key={`${h.x}-${h.vein}`} data-testid="help-lode-hit" data-vein={h.vein} x1={h.x} y1={Y(h.top)} x2={h.x} y2={Y(h.bottom)} stroke={how === 'each' ? shades[h.vein] : shades[0]} strokeWidth={6} />
                    ))}
                </Picture>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 1, flexWrap: 'wrap' }}>
                <ToggleButtonGroup size="small" exclusive value={how} aria-label="How the veins are built" onChange={(_, v) => { if (v) setHow(v); }}>
                    <ToggleButton value="zone" sx={{ textTransform: 'none', py: 0.25 }}>As one zone</ToggleButton>
                    <ToggleButton value="each" sx={{ textTransform: 'none', py: 0.25 }}>A vein of each</ToggleButton>
                </ToggleButtonGroup>
                <FormControlLabel
                    control={<Switch size="small" checked={stops} disabled={how !== 'each'} onChange={e => setStops(e.target.checked)} />}
                    label={<Typography variant="caption">The branch stops at the upper vein</Typography>}
                />
            </Box>
            <Reading>
                {how === 'zone'
                    ? `One zone, in ${parts === 1 ? 'one piece' : `${parts} pieces`}. Down the five holes it is ${Math.round(demo.enclosed)} m thick in all, and ${Math.round(demo.vein)} m of that is vein: ${Math.round(100 * (1 - demo.vein / demo.enclosed))}% of it is the rock between.`
                    : `Three veins, each through its own stretches: down the holes all ${Math.round(demo.vein)} m of what they hold is vein. ${stops ? 'The branch ends at the vein it leaves.' : `The branch runs on through the vein it leaves, and out the other side of it (about ${Math.round(demo.beyond).toLocaleString()} m² of this section).`}`}
            </Reading>
            <Typography variant="subtitle2" sx={{ mt: 2 }}>Telling them apart</Typography>
            <Typography variant="body2">
                When you make a vein from logging that looks like several, its dialog says so: how many veins, with the holes and metres in each. Nothing is
                made until you press <b>Make a vein of each</b>. Where two veins are closer than the join length it says it cannot tell them apart, and a
                stretch it got wrong can be given to another vein from the vein’s properties or by a click on it in the view.
            </Typography>
            <Typography variant="subtitle2" sx={{ mt: 2 }}>A vein system</Typography>
            <Typography variant="body2" component="ul" sx={{ pl: 2.5, mt: 0.5, mb: 0, '& li': { mb: 0.5 } }}>
                <li>Its veins are in an <b>order</b>. A vein can be made to <b>stop at</b> one above it in the list: it is then on one side of that vein only, and runs into it.</li>
                <li>Each vein is fitted on its own. Changing one builds that one again and no other.</li>
                <li>A zone can also be built to its <b>net thickness</b>: as thick as the vein in it, not as the zone. It then holds about the right amount of ground, but not the right places: thin sheets outside its walls are counted apart from misfits.</li>
                <li>In a <b>geological model</b> the veins of a system are one unit that cuts through what is older. A vein thinner than the model’s cells is drawn and measured from its own surface; it stops at the model’s faults, boundary and younger units, and what it holds is taken out of the unit it is in.</li>
            </Typography>
        </>
    );
};

const area = (m2: number) => `${(Math.round(m2 / 100) * 100).toLocaleString('en-US')} m²`;

const TooThinToDraw: React.FC = () => {
    const theme = useTheme();
    const [way, setWay] = useState<ThinWay>('intrusion');
    const [at, setAt] = useState(8);
    const demo = useMemo(() => thinDemo(way, at / 100), [way, at]);
    // The share as a wash, a square at a time: the more of the ground is dyke, the stronger
    const wash = useMemo(() => {
        if (!demo.share) return [];
        const out: { x: number; z: number; s: number }[] = [];
        for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
            const q = j * (NX + 1) + i;
            const v = (demo.share[q] + demo.share[q + 1] + demo.share[q + NX + 1] + demo.share[q + NX + 2]) / 4;
            if (v > 0.01) out.push({ x: i * STEP, z: j * STEP, s: v });
        }
        return out;
    }, [demo.share]);
    const percent = (part: number, whole: number) => `${Math.round(100 * part / whole)}%`;
    return (
        <>
            <Typography variant="body2">
                Some units are <b>too thin and too many to draw one by one</b>: dykes or veins a few centimetres to a few metres thick, several to a hole,
                with holes much further apart than they are thick. There are three ways to build them, and each is right about a different thing.
            </Typography>
            <Typography variant="body2" component="ul" sx={{ pl: 2.5, mt: 0.5, mb: 0, '& li': { mb: 0.5 } }}>
                <li><b>An intrusion.</b> One body round all of it. It finds the ground they are in, and most of what it holds is the rock between them.</li>
                <li><b>An intrusion of thin sheets.</b> Every logged stretch is held as it is and carried along the sheets, only as far as a reach from the holes. Nearly all it holds is the unit; between holes far apart it draws nothing.</li>
                <li><b>A proportion.</b> No solid of the unit at all: a number at every place for <b>how much of the ground is the unit</b>, and a shell round the ground where it is a share or more. It says how much, not where the sheets are.</li>
            </Typography>
            <Try>switch between the three, then move the share the proportion’s shell is drawn at.</Try>
            <Box sx={{ mt: 1.5 }}>
                <Picture label="A cross-section: five drillholes through four thin dykes side by side, built as an intrusion, as thin sheets or as a proportion" values={demo.values} shade={way === 'intrusion'}>
                    {wash.map(c => <rect key={`${c.x}-${c.z}`} data-testid="help-share-square" x={c.x} y={Y(c.z + STEP)} width={STEP + 0.3} height={STEP + 0.3} fill={alpha(theme.palette.primary.main, Math.min(0.75, 2.2 * c.s))} />)}
                    {THIN_HOLES.map(x => <line key={x} x1={x} y1={Y(290)} x2={x} y2={Y(10)} stroke={theme.palette.text.disabled} strokeWidth={1.5} />)}
                    {way === 'sheets' && demo.hits.map(h => {
                        const z = (h.top + h.bottom) / 2;
                        return (
                            <ellipse
                                key={`${h.x}-${h.top}`} data-testid="help-thin-sheet" cx={h.x} cy={Y(z)} rx={THIN_REACH} ry={THIN_THICK / 2 + 0.6} transform={`rotate(${THIN_DIP} ${h.x} ${Y(z)})`}
                                fill={alpha(theme.palette.primary.main, 0.35)} stroke={theme.palette.primary.main} strokeWidth={1}
                            />
                        );
                    })}
                    {demo.hits.map(h => <line key={`${h.x}-${h.top}`} data-testid="help-thin-hit" x1={h.x} y1={Y(h.top)} x2={h.x} y2={Y(h.bottom)} stroke={theme.palette.text.primary} strokeWidth={5} />)}
                </Picture>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 1, flexWrap: 'wrap' }}>
                <ToggleButtonGroup size="small" exclusive value={way} aria-label="How the dykes are built" onChange={(_, v) => { if (v) setWay(v); }}>
                    <ToggleButton value="intrusion" sx={{ textTransform: 'none', py: 0.25 }}>An intrusion</ToggleButton>
                    <ToggleButton value="sheets" sx={{ textTransform: 'none', py: 0.25 }}>Thin sheets</ToggleButton>
                    <ToggleButton value="share" sx={{ textTransform: 'none', py: 0.25 }}>A proportion</ToggleButton>
                </ToggleButtonGroup>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1, minWidth: 180, opacity: way === 'share' ? 1 : 0.4 }}>
                    <Typography variant="caption" sx={{ flexShrink: 0 }}>Shell at {at}%</Typography>
                    <Slider size="small" min={4} max={16} step={4} value={at} disabled={way !== 'share'} aria-label="The share the shell is drawn at" onChange={(_, v) => setAt(v as number)} />
                </Box>
            </Box>
            <Reading>
                {way === 'intrusion'
                    ? `One body: ${area(demo.ground)} of this section, where there is ${area(THIN_TRUE)} of dyke. Down the five holes it holds ${Math.round(demo.enclosed)} m, and ${Math.round(demo.inDyke)} m of that is dyke (${percent(demo.inDyke, demo.enclosed)}).`
                    : way === 'sheets'
                        ? `Twenty thin sheets: ${area(demo.ground)} of this section, where there is ${area(THIN_TRUE)} of dyke. Down the holes all ${Math.round(demo.inDyke)} m of what they hold is dyke; between the holes, past their reach, nothing is drawn.`
                        : !(demo.ground > 0) ? `Nowhere on this section is ${at}% or more of the ground dyke. It says there is ${area(demo.all ?? 0)} of dyke in all; there is ${area(THIN_TRUE)}.`
                        : `The ground where ${at}% or more is dyke: ${area(demo.ground)} of this section. On average ${percent(demo.dyke, demo.ground)} of it is dyke: about ${area(demo.dyke)}, and ${area(demo.all ?? 0)} with the ground outside the shell. There is ${area(THIN_TRUE)} of dyke.`}
            </Reading>
            <Typography variant="subtitle2" sx={{ mt: 2 }}>Which one to trust, and for what</Typography>
            <Typography variant="body2" component="ul" sx={{ pl: 2.5, mt: 0.5, mb: 0, '& li': { mb: 0.5 } }}>
                <li>For <b>how much</b> of the unit there is in ground that is drilled: the proportion. A plain intrusion holds several times too much, and thin sheets hold only what is near a hole. Far from every hole (a level not drilled yet) the proportion says little more than the average of the whole.</li>
                <li>For <b>where</b> the unit is, to draw and to edit, and for the ground between drilled levels: a vein system, where its sheets can be told apart (a vein of each). It is the one form carried a long way along its sheets. Thin sheets with a <b>join length</b> hold together near the holes, and stop at their reach.</li>
                <li>Where the sheets <b>cannot be told apart</b> (dykes that split and rejoin within metres: more than a third of their stretches are then in no vein), a vein of each comes out as wedges between the drilled levels, two to three times as wide as the holes log. The chronology step of a geological model then proposes thin sheets, and says how many stretches it could not place: about as wide as logged, near their holes, and nothing past their reach. It proposes thin sheets too for an intrusion that is thin against the gaps between its holes and is carried from hole to hole in one plane; as a plain intrusion that comes out as beads round its holes.</li>
                <li>Whichever it is, <b>look at it on sections</b> against the logging before trusting a score: a model can agree with most of its holes and still be drawn as no geologist would draw it. A section set draws a model with the logging on its holes, each interval in its lithology's colour, with a wider bright edge where the model has another unit there, and says how much of the logging on each section the model has as logged.</li>
                <li>No way of building it places a single thin sheet between holes much further apart than it is thick. That is the drilling, not the method.</li>
                <li>What you know and no hole says, you <b>put in by hand</b>. In an intrusion’s properties, under its contacts, mark places <b>inside</b> or <b>outside</b> it with a click on a hole or on the slice, each <b>held clear by</b> a distance. Inside, a lens that far across each way is made part of it (longer along its sheets, as it is carried); Shift+click runs a row of them from the last place, which is a sheet twice the distance thick: “the dyke runs through here, a metre thick” is a row held by half a metre. Outside, a lens is cut out of it: “nothing here”. A cut is short, twice as far along the sheets as across, because a long one takes the body’s own logged ground with it: it trims. To take more away, give it a length <b>along its sheets</b> beside the distance. Each place says what logging of its own holes its lens takes, and those that take any can be removed in one step. Nothing else of the model changes and the fit is not made again. A place marked with no distance is held only just clear by the fit itself: on thin sheets that is a bead or a pinhole, it joins whatever the model nearly had beside it, and it moves the sheets a little everywhere. Places held by hand are drawn on the model’s sections, each lens as its outline there.</li>
                <li>An intrusion of thin sheets can <b>look for links</b> between its holes: pairs of its logged stretches, in different holes, that lie in one plane of its sheets no more than 8 m apart, with no hole between that logs other ground, and that it does not join now. Each is listed with its two holes and its length, shown in the view, and taken or left; nothing is placed until you take one. A link taken is the body held along the line between the two: a ribbon as thick as the thinner of the two stretches and 2 m to each side of the line. It is one place in the list above, and removed there. A longer length can be typed, and is less sure. Tried on thin dykes drilled a few metres apart with holes left out: where a hole left out passed through a link under 8 m, it logged the dyke there three times in four; from 8 to 12 m two times in three; from 12 to 20 m, half the time. A link says two intercepts are one sheet; the drilling does not say it, and a sheet 3 m to the side is often another dyke of the same stack.</li>
            </Typography>
            <Typography variant="subtitle2" sx={{ mt: 2 }}>Checking it against holes left out</Typography>
            <Typography variant="body2">
                Each of these has a check in its properties (<b>Cross-validation</b>). Some holes are left out, it is built again without them, and their logging is read against it. Holes that lie together
                (a line of holes on one level, a fan from one collar) are left out together: one of them left out alone would be read from its neighbours a few metres away, and any model would look good.
                It says four things:
            </Typography>
            <Typography variant="body2" component="ul" sx={{ pl: 2.5, mt: 0.5, mb: 0, '& li': { mb: 0.5 } }}>
                <li><b>Found:</b> of the unit logged in the holes left out, the share it took in.</li>
                <li><b>Of what it took in, the unit:</b> the rest is other ground. A fat body finds a lot and is mostly other ground.</li>
                <li><b>How much:</b> the shortest stretch of hole over which it says how much of the unit there is better than quoting the overall share everywhere would.</li>
                <li><b>Where:</b> how well it follows where there is more and where less, from 0 (not at all) to 1 (exactly).</li>
            </Typography>
            <Typography variant="body2" sx={{ mt: 0.5 }}>
                When the same units are built in more than one way, their checks are set side by side there, and the table can be put in the report.
            </Typography>
        </>
    );
};

// --- What the holes say a unit is ---------------------------------------------

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** Where each layer's name is written, at the left of the picture */
const CHRONO_NAMES_AT = [272, 227, 180, 135, 90, 32];

const FromTheHoles: React.FC = () => {
    const theme = useTheme();
    const [kind, setKind] = useState<ChronoCase>('stock');
    const [holes, setHoles] = useState(9);
    const demo = useMemo(() => chronologyDemo(kind, holes), [kind, holes]);
    const bases = useMemo(() => CHRONO_BASES.map(base => {
        let d = '';
        for (let x = 0; x <= WIDTH; x += STEP) d += `${x === 0 ? 'M' : 'L'}${x} ${Y(base + chronoFold(x)).toFixed(1)}`;
        return d;
    }), []);
    const outline = useMemo(() => `${chronoOutline(kind).map((p, k) => `${k === 0 ? 'M' : 'L'}${p[0].toFixed(1)} ${Y(p[1]).toFixed(1)}`).join('')}z`, [kind]);
    const said = demo.cuts
        ? `${demo.name}: proposed as an intrusion. ${capital(demo.why)}. Its age: ${demo.age}.${kind !== 'sill' ? '' : demo.follows ? ` ${capital(demo.follows)}.` : ' Nothing says it follows the layers: it is met in too few holes (that takes five).'}`
        : `${demo.name}: left a layer. ${demo.across ? capital(demo.across) : 'No hole shows what lies above and below it'}${kind === 'stock' ? ': too few holes to say it cuts across (that takes three)' : ''}.`;
    return (
        <>
            <Typography variant="body2">
                When a geological model is made, its <b>chronology</b> step reads the logging and proposes what each unit is (a layer, an erosion surface, a body that cuts across the layers)
                and where it comes in the chronology. It works from <b>counts down the holes</b>, and it gives them, so that each proposal can be checked. Three of the things it looks for:
            </Typography>
            <Typography variant="body2" component="ul" sx={{ pl: 2.5, mt: 0.5, mb: 0, '& li': { mb: 0.5 } }}>
                <li><b>Inside one unit.</b> The same unit above a stretch and below it, again and again: a body in that unit (a sill, a dyke).</li>
                <li><b>In the place of layers.</b> One layer above it, a much older one below, and the layers the other holes have between those two not there: a stock, which cuts the pile and lies inside no one unit.</li>
                <li><b>At one height in the pile.</b> A body that keeps its place in a layer from hole to hole follows the layers (a sill), and is built along them.</li>
            </Typography>
            <Typography variant="body2" sx={{ mt: 0.5 }}>A unit that shows none of these is left a layer, between the layer above it and the layer below.</Typography>
            <Try>switch what the unit truly is, then drill fewer holes.</Try>
            <Box sx={{ mt: 1.5 }}>
                <Picture label="A cross-section: a folded pile of layers under a flat cover, drillholes through it, and a unit that is a stock, a sill or a lens" values={null}>
                    <path d={`M0 ${Y(CHRONO_COVER)}H${WIDTH}`} fill="none" stroke={theme.palette.text.disabled} strokeWidth={1} />
                    {bases.map((d, k) => <path key={k} d={d} fill="none" stroke={theme.palette.text.disabled} strokeWidth={1} />)}
                    <path d={outline} fill={theme.palette.background.default} />
                    <path data-testid="help-chrono-unit" d={outline} fill={alpha(theme.palette.primary.main, 0.18)} stroke={theme.palette.primary.main} strokeWidth={1.5} />
                    {CHRONO_PILE.map((name, k) => <Note key={name} x={6} z={CHRONO_NAMES_AT[k]}>{name}</Note>)}
                    {demo.holes.map(h => <line key={h.x} x1={h.x} y1={Y(295)} x2={h.x} y2={Y(5)} stroke={theme.palette.text.disabled} strokeWidth={1.5} />)}
                    {demo.holes.map(h => h.hits.map(s => <line key={`${h.x}-${s.top}`} data-testid="help-chrono-hit" x1={h.x} y1={Y(s.top)} x2={h.x} y2={Y(s.bottom)} stroke={theme.palette.text.primary} strokeWidth={5} />))}
                </Picture>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 1, flexWrap: 'wrap' }}>
                <ToggleButtonGroup size="small" exclusive value={kind} aria-label="What the unit truly is" onChange={(_, v) => { if (v) setKind(v); }}>
                    <ToggleButton value="stock" sx={{ textTransform: 'none', py: 0.25 }}>A stock</ToggleButton>
                    <ToggleButton value="sill" sx={{ textTransform: 'none', py: 0.25 }}>A sill</ToggleButton>
                    <ToggleButton value="lens" sx={{ textTransform: 'none', py: 0.25 }}>A lens</ToggleButton>
                </ToggleButtonGroup>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1, minWidth: 180 }}>
                    <Typography variant="caption" sx={{ flexShrink: 0 }}>{holes} holes</Typography>
                    <Slider size="small" min={5} max={13} step={2} value={holes} aria-label="Holes drilled" onChange={(_, v) => setHoles(v as number)} />
                </Box>
            </Box>
            <Reading>{said}</Reading>
            <Typography variant="subtitle2" sx={{ mt: 2 }}>What it cannot tell</Typography>
            <Typography variant="body2" component="ul" sx={{ pl: 2.5, mt: 0.5, mb: 0, '& li': { mb: 0.5 } }}>
                <li><b>It needs the holes.</b> A stock met in fewer than three holes that show what is above and below it is left a layer. A sill in fewer than five is not said to follow the layers.</li>
                <li><b>An age is what the logging shows, no more.</b> A body is put older than a layer it is never logged in. A sill may be younger than the layers over its host: move it in the list.</li>
                <li><b>Stray intervals.</b> A few intervals in a hundred logged as the wrong unit are read through. At one in ten it goes wrong: a layer is offered as several, or a base as an erosion surface.</li>
                <li><b>Faults.</b> Nothing in the logging says which units run across a fault unbroken (a cover, a late dyke). That is set by hand in the model.</li>
            </Typography>
            <Typography variant="body2" sx={{ mt: 0.5 }}>
                Nothing is made until a proposal is taken, and every unit can be set by hand in the same list. Read the counts: a proposal resting on three holes is three holes’ worth of sure.
            </Typography>
        </>
    );
};

// --- A shell kept inside other ground ------------------------------------------

const KeptInside: React.FC = () => {
    const theme = useTheme();
    const [kept, setKept] = useState(false);
    const [left, setLeft] = useState(3);
    const [cutoff, setCutoff] = useState(0.5);
    const demo = useMemo(() => gradeDemo(left < 0 ? null : left, cutoff, kept), [left, cutoff, kept]);
    const zone = useMemo(() => `${zoneOutline().map((p, k) => `${k === 0 ? 'M' : 'L'}${p[0].toFixed(1)} ${Y(p[1]).toFixed(1)}`).join('')}z`, []);
    const hole = left < 0 ? null : GRADE_HOLES[left];
    const said = hole === null
        ? `Shown every hole${kept ? ' and kept inside the zone' : ''}, the shell holds ${demo.found === null ? 'nothing' : `${shareText(demo.found)} of the metal at or above ${cutoff}`}. It was made from these samples: this says how it fits them, not how it would do in the next hole.`
        : demo.found === null ? `Hole ${left + 1} was not shown to the shell, and has nothing at or above ${cutoff} to find.`
            : `Hole ${left + 1} was not shown to the shell. Found: ${shareText(demo.found)} of its metal at or above ${cutoff} is inside the shell. ${demo.right === null ? 'The shell does not reach the hole.' : `Right: ${shareText(demo.right)} of its metres inside the shell are at or above ${cutoff}.`}`;
    const button = { textTransform: 'none', py: 0.25 } as const;
    return (
        <>
            <Typography variant="body2">
                A shell, or a numeric model with all its shells, can be <b>kept inside</b> other ground: lithologies of a geological model, or solids (a vein, a vein system, an intrusion,
                another shell, a closed mesh from a file). It is then made only from the samples inside that ground, and cut at its faces.
            </Typography>
            <Typography variant="body2" sx={{ mt: 1 }}>
                That is a choice about the geology, not a gain in itself. Kept inside, a shell cannot take in ground outside the solid, and it cannot find grade outside it either.
                Which is better is tested the way anything here is: against a hole the shell was <b>not shown</b>. Two numbers say how it did there:
            </Typography>
            <Typography variant="body2" component="ul" sx={{ pl: 2.5, mt: 0.5, mb: 0, '& li': { mb: 0.5 } }}>
                <li><b>Found.</b> Of the metal at or above the cut-off in that hole, the share inside the shell. Low: the shell misses grade.</li>
                <li><b>Right.</b> Of the metres of that hole inside the shell, the share at or above the cut-off. Low: the shell takes in barren ground.</li>
            </Typography>
            <Try>leave hole 4 or 5 out, then keep the shell inside the zone and see what each number does. Most of the grade here is in the zone; a pod of it lies below the zone between those two holes.</Try>
            <Box sx={{ mt: 1.5 }}>
                <Picture label="A cross-section: drillholes with samples, a zone through them, and a shell made without one of the holes" values={demo.values} shade>
                    <path data-testid="help-grade-zone" d={zone} fill={kept ? alpha(theme.palette.text.primary, 0.05) : 'none'} stroke={theme.palette.text.secondary} strokeWidth={1} strokeDasharray="5 4" />
                    <Holes samples={demo.shown} cutoff={cutoff} />
                    {hole !== null && <line x1={hole} y1={Y(290)} x2={hole} y2={Y(30)} stroke={theme.palette.text.primary} strokeWidth={1.5} strokeDasharray="3 4" />}
                    {demo.hidden.map((h, k) => (
                        <rect
                            key={k} data-testid="help-grade-hidden" x={h.p[0] - 4.5} y={Y(h.p[1]) - 4.5} width={9} height={9}
                            fill={h.v >= cutoff ? theme.palette.text.primary : theme.palette.background.paper} stroke={theme.palette.text.primary} strokeWidth={1.2}
                        />
                    ))}
                    <Note x={60} z={zoneMiddle(60) + ZONE_HALF + 24}>The zone</Note>
                    {hole !== null && <Note x={hole} z={12} anchor="middle">not shown</Note>}
                </Picture>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 1, flexWrap: 'wrap' }}>
                <ToggleButtonGroup size="small" exclusive value={kept ? 'kept' : 'free'} aria-label="Where the shell may go" onChange={(_, v) => { if (v) setKept(v === 'kept'); }}>
                    <ToggleButton value="free" sx={button}>Free</ToggleButton>
                    <ToggleButton value="kept" sx={button}>Kept inside the zone</ToggleButton>
                </ToggleButtonGroup>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="caption" color="text.secondary">Hole not shown</Typography>
                    <ToggleButtonGroup size="small" exclusive value={left} aria-label="The hole it is not shown" onChange={(_, v) => { if (v !== null) setLeft(v as number); }}>
                        <ToggleButton value={-1} sx={button}>None</ToggleButton>
                        {GRADE_HOLES.map((x, k) => <ToggleButton key={x} value={k} sx={button}>{k + 1}</ToggleButton>)}
                    </ToggleButtonGroup>
                </Box>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 1 }}>
                <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>Cut-off</Typography>
                <Slider size="small" min={0.3} max={1.5} step={0.1} value={cutoff} aria-label="Cut-off" valueLabelDisplay="auto" onChange={(_, v) => setCutoff(v as number)} />
            </Box>
            <Reading>{said}</Reading>
            <Box
                component="table" data-testid="help-grade-table"
                sx={{ borderCollapse: 'collapse', fontSize: 12, mt: 1, '& td, & th': { textAlign: 'left', pr: 2, py: 0.25, fontWeight: 'inherit' }, '& th': { color: 'text.secondary' } }}
            >
                <thead>
                    <tr><th>{hole === null ? 'Every sample' : `Hole ${left + 1}`}</th><th>Metres</th><th>Mean grade</th><th>Share of the metal</th></tr>
                </thead>
                <tbody>
                    {[...demo.table.rows, demo.table.all].map(r => <tr key={r.name}><td>{r.name}</td><td>{Math.round(r.metres)}</td><td>{gradeText(r.grade)}</td><td>{shareText(r.metal)}</td></tr>)}
                </tbody>
            </Box>
            <Typography variant="body2" sx={{ mt: 1 }}>
                The table is the one a numeric model gives of its own samples (<b>Grade inside its shells</b>, in its properties). A geological model gives the same by lithology, as
                logged and as modelled, and a closed mesh from a file gives it for what is inside it. Each can be added to the report.
            </Typography>
            <Typography variant="subtitle2" sx={{ mt: 2 }}>What to keep in mind</Typography>
            <Typography variant="body2" component="ul" sx={{ pl: 2.5, mt: 0.5, mb: 0, '& li': { mb: 0.5 } }}>
                <li><b>Kept inside is only as good as the solid.</b> A solid drawn between holes is itself partly a guess; a shell kept inside it inherits that. Where much of the grade lies outside the solid, a free shell finds more.</li>
                <li><b>A solid must be closed.</b> A mesh with an open edge has no inside. A mesh from a file says in its properties whether it is closed and what it holds, and where it is not: how many edges are open, and where the largest gap is.</li>
                <li><b>Along the sheets of a body or a vein.</b> Highs that sit in dykes or veins carry further along the plane of the sheets than across it. With no plane a shell is a bubble round each run of high samples. A numeric model can take the plane a vein, a vein system or an intrusion of thin sheets says its sheets lie in, in one step, when it is made or after: its shells are then drawn as lenses along the sheets. It is offered, not set by itself: on holes left out such shells find about as much as the plain ones, so it is the look of the model that is put right, not a better guess between holes. Four times further along the plane than across it is the usual; much more and single samples are drawn out into streaks.</li>
                <li><b>The plunge of its highs.</b> A numeric model can look for the line its high values run along, from its own samples, and set it in one step. It is offered only when two halves of the holes give the same answer; with holes far apart they often do not, and then nothing is set.</li>
                <li><b>At its own holes a shell always looks good.</b> The table of every sample says what the shell holds, not how well it would find the next hole. Leave holes out to learn that.</li>
            </Typography>
        </>
    );
};

/** A page of the guide: the part of the guide it is in, a line for the contents page, the pages it leads to (by their titles) */
interface Step { title: string; part: string; about: string; see: readonly string[]; body: React.FC }

const FITTED = 'How a surface is fitted', CLOSED = 'Closed surfaces and grade shells', RUNS = 'The direction of the ground';
const UNITS = 'Veins, dykes and the units of a model', GRADE = 'Grade', LIMITS = 'What to trust';

const STEPS: Step[] = [
    {
        title: 'A number for every place', part: FITTED, body: NumberEverywhere,
        about: 'A surface is where a number worked out for every place in the ground is 0.',
        see: ['Closed surfaces: shells and bodies'],
    },
    {
        title: 'Start with the flat plane that fits best', part: FITTED, body: FlatFirst,
        about: 'The fit starts from the one flat plane that lies closest to all the points.',
        see: ['Which way the ground runs'],
    },
    {
        title: 'Bend it to pass through every point', part: FITTED, body: BendToFit,
        about: 'Each point pulls the surface to itself; smoothing lets it pass near them instead.',
        see: ['What it cannot know'],
    },
    {
        title: 'Tell it which way it faces', part: FITTED, body: WhichWayItFaces,
        about: 'A dip measurement says how the surface lies where it is put, and can turn it over.',
        see: ['Where the ground changes direction', 'Dips and lines on bodies and veins'],
    },
    {
        title: 'Surface extent', part: FITTED, body: WhereItStops,
        about: 'A surface is drawn only as far from its data as you let it.',
        see: ['What it cannot know'],
    },
    {
        title: 'Closed surfaces: shells and bodies', part: CLOSED, body: ClosedSurfaces,
        about: 'The same number, meaning a grade less a cut-off, or inside a logged unit: a closed surface.',
        see: ['Three ways to find a shell', 'Veins and dykes: built from two walls'],
    },
    {
        title: 'Three ways to find a shell', part: CLOSED, body: ThreeWays,
        about: 'From the values, by counting, or round intercepts: the same erratic samples three ways.',
        see: ['Which way the ground runs', 'A shell kept inside other ground'],
    },
    {
        title: 'Which way the ground runs', part: RUNS, body: OneDirection,
        about: 'One direction for a surface: samples count for further along it than across it.',
        see: ['Start with the flat plane that fits best', 'Where the ground changes direction'],
    },
    {
        title: 'Where the ground changes direction', part: RUNS, body: PlaceToPlace,
        about: 'Measurements followed from place to place, for ground that is folded.',
        see: ['Measurements worked out from the data', 'Dips and lines on bodies and veins'],
    },
    {
        title: 'Measurements worked out from the data', part: RUNS, body: SuggestedReadings,
        about: 'Where nothing was measured: directions worked out from a surface, a mesh or the highs.',
        see: ['Where the ground changes direction'],
    },
    {
        title: 'Veins and dykes: built from two walls', part: UNITS, body: ThinBodies,
        about: 'A thin body is a surface through its middle and a wall on each side.',
        see: ['Dips and lines on bodies and veins', 'Several veins side by side'],
    },
    {
        title: 'Dips and lines on bodies and veins', part: UNITS, body: ByHand,
        about: 'Telling a body or a vein how it lies between the holes: a dip, a direction, a drawn line.',
        see: ['Tell it which way it faces', 'Which way the ground runs'],
    },
    {
        title: 'Several veins side by side', part: UNITS, body: SideBySide,
        about: 'One zone round them all, or a vein of each: a vein system.',
        see: ['Too thin and too many to draw'],
    },
    {
        title: 'Too thin and too many to draw', part: UNITS, body: TooThinToDraw,
        about: 'Thin sheets, a vein system or a proportion: three forms of one unit, and how each is checked.',
        see: ['Several veins side by side', 'What the holes say a unit is'],
    },
    {
        title: 'What the holes say a unit is', part: UNITS, body: FromTheHoles,
        about: 'How the chronology step of a geological model reads a layer, a stock, a sill or a lens from the logging.',
        see: ['Veins and dykes: built from two walls', 'Too thin and too many to draw'],
    },
    {
        title: 'A shell kept inside other ground', part: GRADE, body: KeptInside,
        about: 'A grade shell kept inside a lithology or a solid, and the grade counted inside it.',
        see: ['Three ways to find a shell', 'Several veins side by side'],
    },
    {
        title: 'What it cannot know', part: LIMITS, body: WhatItCannotKnow,
        about: 'What one more hole changes, and what to check on your own surfaces.',
        see: ['Bend it to pass through every point', 'Surface extent', 'Too thin and too many to draw'],
    },
];

/** The guide as its contents page gives it: each page's name, part, line, and the pages it leads to */
export const GUIDE_PAGES: readonly { title: string; part: string; about: string; see: readonly string[] }[] = STEPS.map(({ title, part, about, see }) => ({ title, part, about, see }));

export const SurfaceHelp: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
    const [step, setStep] = useState(0);
    // The contents page: every page by name, reached from every page
    const [contents, setContents] = useState(false);
    const Body = STEPS[step].body;
    const close = () => { setStep(0); setContents(false); onClose(); };
    const goTo = (title: string) => { const at = STEPS.findIndex(x => x.title === title); if (at >= 0) { setStep(at); setContents(false); } };
    const parts = STEPS.map(x => x.part).filter((part, i, all) => all.indexOf(part) === i);
    return (
        <Dialog open={open} onClose={close} maxWidth="sm" fullWidth>
            <DialogTitle sx={{ pb: 0.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                    <Typography variant="overline" color="text.secondary" sx={{ display: 'block', lineHeight: 1.6 }}>
                        How surfaces are fitted · {contents ? `${STEPS.length} pages` : `${step + 1} of ${STEPS.length}`}
                    </Typography>
                    {!contents && <Link component="button" type="button" variant="caption" underline="hover" data-action="guide-contents" onClick={() => setContents(true)}>Contents</Link>}
                </Box>
                {contents ? 'Contents' : STEPS[step].title}
            </DialogTitle>
            <DialogContent>
                {contents ? (
                    <Box data-testid="guide-contents">
                        {parts.map(part => (
                            <Box key={part} sx={{ mb: 1.5 }}>
                                <Typography variant="subtitle2">{part}</Typography>
                                {STEPS.map((x, i) => x.part !== part ? null : (
                                    <Box key={x.title} data-page={i + 1} sx={{ display: 'flex', gap: 1, mt: 0.5 }}>
                                        <Typography variant="body2" color="text.secondary" sx={{ width: 20, flexShrink: 0, textAlign: 'right' }}>{i + 1}</Typography>
                                        <Box>
                                            <Link component="button" type="button" variant="body2" underline="hover" sx={{ textAlign: 'left', fontWeight: i === step ? 600 : 400 }} onClick={() => goTo(x.title)}>{x.title}</Link>
                                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{x.about}</Typography>
                                        </Box>
                                    </Box>
                                ))}
                            </Box>
                        ))}
                    </Box>
                ) : (
                    <>
                        {/* Each step starts afresh when it is come back to */}
                        <Body key={step} />
                        <Typography data-testid="guide-see" variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
                            {'See also: '}
                            {STEPS[step].see.map((title, k) => (
                                <React.Fragment key={title}>
                                    {k > 0 && ' · '}
                                    <Link component="button" type="button" variant="caption" underline="hover" onClick={() => goTo(title)}>{title}</Link>
                                </React.Fragment>
                            ))}
                        </Typography>
                    </>
                )}
            </DialogContent>
            <DialogActions sx={{ px: 2 }}>
                {contents ? <Button size="small" onClick={() => setContents(false)}>Back to page {step + 1}</Button> : (
                    <MobileStepper
                        variant="dots" steps={STEPS.length} position="static" activeStep={step} sx={{ flex: 1, bgcolor: 'transparent', p: 0 }}
                        backButton={<Button size="small" disabled={step === 0} onClick={() => setStep(step - 1)}>Back</Button>}
                        nextButton={step < STEPS.length - 1
                            ? <Button size="small" variant="contained" onClick={() => setStep(step + 1)}>Next</Button>
                            : <Button size="small" variant="contained" onClick={close}>Done</Button>}
                    />
                )}
            </DialogActions>
        </Dialog>
    );
};
