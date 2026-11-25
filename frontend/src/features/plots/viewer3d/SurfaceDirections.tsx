/**
 * Directions a surface runs in, in its properties: the points and nodes
 * picked out in the 3D view (click, Shift-click; Shift-click a line for all
 * its nodes) are given one direction together: the line the view looks along
 * now ("80° → 120°"), or one typed in. A node's direction says how the surface
 * leaves its line there (Leapfrog's ribbon); a point's, a line the surface
 * holds at the point.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, TextField, Tooltip, Typography } from '@mui/material';
import { useModelStore } from '../../../store/modelStore';
import { cleanDirection, directionFromPlunge, formatDirection, trueDirection } from '../../model/attitudes';
import { liveSelection, nodesOfLines, useEditSession } from '../../model/editSession';
import { directionsSummary } from '../../model/ribbons';
import type { SurfaceObject, Vec3 } from '../../model/types';
import type { ThreeViewport } from './ThreeViewport';

const small = { minWidth: 0, px: 0.75, py: 0, height: 24, fontSize: 12, textTransform: 'none' } as const;
const count = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const typed = (text: string): number | null => {
    const t = text.trim();
    if (t === '') return null;
    const v = Number(t);
    return Number.isFinite(v) ? v : null;
};

interface Props {
    surface: SurfaceObject;
    /** The 3D view (null: not ready), and its vertical exaggeration: the line it looks along */
    viewport: ThreeViewport | null;
    vex: number;
    /** Points and nodes can be picked out in the view now */
    picking: boolean;
}

/** The line the view looks along, in true space, as the camera turns (null: no view) */
function useViewLine(viewport: ThreeViewport | null, vex: number): Vec3 | null {
    const [line, setLine] = useState<Vec3 | null>(null);
    const frame = useRef(0);
    useEffect(() => {
        if (!viewport) { setLine(null); return; }
        const read = () => {
            frame.current = 0;
            const now = trueDirection(viewport.viewDirection(), vex);
            setLine(prev => (prev && now && Math.abs(prev[0] - now[0]) + Math.abs(prev[1] - now[1]) + Math.abs(prev[2] - now[2]) < 1e-4 ? prev : now));
        };
        read();
        const off = viewport.addCameraListener(() => { if (!frame.current) frame.current = requestAnimationFrame(read); });
        return () => { off(); cancelAnimationFrame(frame.current); frame.current = 0; };
    }, [viewport, vex]);
    return line;
}

export const SurfaceDirections: React.FC<Props> = ({ surface, viewport, vex, picking }) => {
    const { setNodeDirections, setPointDirections } = useModelStore.getState();
    const selection = useEditSession(s => s.selection);
    const picked = useMemo(() => liveSelection(selection, surface), [selection, surface]);
    const view = useViewLine(viewport, vex);
    const [plunge, setPlunge] = useState('');
    const [towards, setTowards] = useState('');
    const [said, setSaid] = useState<string | null>(null);
    useEffect(() => setSaid(null), [selection]);

    const summary = useMemo(() => directionsSummary(surface.points, surface.polylines), [surface.points, surface.polylines]);
    const n = picked.nodes.length, p = picked.points.length;
    const any = n + p > 0;
    // What the picked ones have now: one direction they share, if they do
    const now = useMemo(() => {
        const lines = new Map(surface.polylines.map(l => [l.id, l]));
        const points = new Map(surface.points.map(q => [q.id, q]));
        const dirs = [
            ...picked.nodes.map(k => lines.get(k.line)?.nodes?.[k.vertex]?.direction ?? null),
            ...picked.points.map(id => points.get(id)?.direction ?? null),
        ];
        if (dirs.length === 0) return null;
        const first = dirs[0] && cleanDirection(dirs[0]);
        const same = first && dirs.every(d => {
            const u = d && cleanDirection(d);
            return u && Math.abs(u[0] * first[0] + u[1] * first[1] + u[2] * first[2]) > 1 - 1e-9;
        });
        return { some: dirs.filter(Boolean).length, same: same ? first : null };
    }, [picked, surface.polylines, surface.points]);

    const apply = (dir: Vec3 | null) => {
        const nodes = picked.nodes.map(({ line, vertex }) => ({ line, vertex }));
        const a = n > 0 ? setNodeDirections(surface.id, nodes, dir) : { changed: 0, locked: 0 };
        const b = p > 0 ? setPointDirections(surface.id, picked.points, dir) : { changed: 0, locked: 0 };
        const changed = a.changed + b.changed, locked = a.locked + b.locked;
        const parts: string[] = [];
        if (changed > 0) {
            const what = [a.changed > 0 ? count(a.changed, 'node', 'nodes') : '', b.changed > 0 ? count(b.changed, 'point', 'points') : ''].filter(Boolean).join(' and ');
            parts.push(dir ? `${what} now ${changed === 1 ? 'runs' : 'run'} ${formatDirection(dir)}.` : `${what}: direction taken off.`);
        } else if (locked === 0) {
            parts.push(dir ? `They already run ${formatDirection(dir)}.` : 'They have no direction to take off.');
        }
        if (locked > 0) parts.push(locked === 1 ? '1 of them is in a locked set and was left as it was.' : `${locked.toLocaleString()} of them are in a locked set and were left as they were.`);
        setSaid(parts.join(' '));
    };

    const pl = typed(plunge), tw = typed(towards);
    const typedDir = pl !== null && tw !== null && pl >= 0 && pl <= 90 ? directionFromPlunge(pl, tw) : null;
    const allNodes = nodesOfLines(surface.polylines);

    return (
        <Box sx={{ mt: 1 }} data-testid="surface-directions">
            <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>Directions it runs in</Typography>
            <Typography variant="caption" sx={{ display: 'block', lineHeight: 1.35 }}>
                {any
                    ? `${[n > 0 ? count(n, 'node', 'nodes') : '', p > 0 ? count(p, 'point', 'points') : ''].filter(Boolean).join(' and ')} picked out${now && now.some > 0 ? (now.same ? ` · ${now.some === n + p ? '' : 'some '}running ${formatDirection(now.same)}` : ' · running different ways') : ''}.`
                    : picking
                        ? 'Click nodes and points in the view to pick them out (Shift: as well; Shift-click a line: all its nodes).'
                        : 'Turn on placing points, then click nodes and points in the view to pick them out.'}
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, flexWrap: 'wrap' }}>
                {allNodes.length > 0 && (
                    <Tooltip describeChild title="Pick out every node of every line of this surface">
                        <Button size="small" variant="outlined" sx={small} onClick={() => useEditSession.getState().select(surface.id, { nodes: allNodes })}>All nodes</Button>
                    </Tooltip>
                )}
                {any && <Button size="small" sx={small} onClick={() => useEditSession.getState().clearSelection()}>Let go</Button>}
            </Box>
            <Tooltip
                describeChild
                title="Each one picked out is given the line the view looks along now. Turn the view until you look along the way the surface runs there (down its plunge, along a fold axis), then press this. At a node the surface leaves its line in that direction; at a point it holds that line."
            >
                <span>
                    <Button
                        size="small" variant="contained" fullWidth disableElevation disabled={!any || !view} sx={{ ...small, mt: 0.5, height: 26 }}
                        onClick={() => view && apply(view)}
                    >
                        Set to the view line{view ? ` · ${formatDirection(view)}` : ''}
                    </Button>
                </span>
            </Tooltip>
            <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.5, mt: 0.75 }}>
                <TextField
                    size="small" variant="standard" label="Plunge" value={plunge} onChange={e => setPlunge(e.target.value)} sx={{ width: 58 }}
                    inputProps={{ inputMode: 'decimal', 'aria-label': 'Plunge of the direction', style: { fontSize: 13 } }}
                    error={pl !== null && (pl < 0 || pl > 90)}
                />
                <TextField
                    size="small" variant="standard" label="Towards" value={towards} onChange={e => setTowards(e.target.value)} sx={{ width: 64 }}
                    inputProps={{ inputMode: 'decimal', 'aria-label': 'Bearing the direction plunges towards', style: { fontSize: 13 } }}
                    onKeyDown={e => { if (e.key === 'Enter' && typedDir && any) apply(typedDir); }}
                />
                <Button size="small" sx={small} disabled={!any || !typedDir} onClick={() => typedDir && apply(typedDir)}>Set</Button>
                <Box sx={{ flex: 1 }} />
                <Tooltip title="Take the direction off each one picked out">
                    <span><Button size="small" sx={small} disabled={!any || !now || now.some === 0} onClick={() => apply(null)}>Clear</Button></span>
                </Tooltip>
            </Box>
            {said && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }} data-testid="directions-said">{said}</Typography>}
            {summary.ignored.length > 0 && (
                <Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: 0.5 }}>
                    {count(summary.ignored.length, 'node has a direction that runs', 'nodes have directions that run')} along {summary.ignored.length === 1 ? 'its' : 'their'} line: it says nothing of how the surface leaves the line, and is not used. Look across the line more to set {summary.ignored.length === 1 ? 'it' : 'them'}.
                </Typography>
            )}
            {summary.overruled.length > 0 && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                    {count(summary.overruled.length, 'point has', 'points have')} a dip measurement as well as a direction: the measurement is used.
                </Typography>
            )}
        </Box>
    );
};
