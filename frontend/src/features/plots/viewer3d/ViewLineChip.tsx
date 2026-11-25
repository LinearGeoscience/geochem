/**
 * The line the 3D view looks along, read as a geologist reads a line: how
 * steeply it goes down and the bearing it heads towards ("Looking down 28°
 * towards 135°"). It follows the camera.
 *
 * With the highs drawn in front (high-grade emphasis), the view is turned
 * until the highs line up into one tight shape: the view then looks down
 * their plunge (the X-ray plunge projection of Cowan 2014), and this is where
 * that plunge is read off. Clicking it opens a small panel to type a line in
 * and look down it, to turn the view a degree at a time, and to keep the line
 * as a reading for the model.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Box, Button, FormControlLabel, IconButton, Popover, Switch, TextField, Tooltip, Typography } from '@mui/material';
import { Add, Remove } from '@mui/icons-material';
import type { ThreeViewport } from './ThreeViewport';
import { viewLine, viewLineDirection, viewLineText, plungingLine, ViewLine, viewLineShort } from './geometry';

const turn = (v: number) => ((v % 360) + 360) % 360;

const typed = (text: string): number | null => {
    const t = text.trim();
    if (t === '') return null;
    const v = Number(t);
    return Number.isFinite(v) ? v : null;
};

interface Props {
    /** The viewport once it is ready, else null */
    viewport: ThreeViewport | null;
    vex: number;
    ortho: boolean;
    onOrtho: (on: boolean) => void;
    /** Keep a line (plunge, the bearing it plunges towards) as a reading; returns what happened, in words */
    onKeep: (plunge: number, trend: number) => string;
    /** Where the bar has little room: the line in short ("Down 28° → 135°"), its words as its name */
    short?: boolean;
}

export const ViewLineChip: React.FC<Props> = ({ viewport, vex, ortho, onOrtho, onKeep, short }) => {
    const [line, setLine] = useState<ViewLine | null>(null);
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const [plunge, setPlunge] = useState('');
    const [trend, setTrend] = useState('');
    const [said, setSaid] = useState('');
    const frame = useRef(0);

    // Follow the camera (at most once a frame)
    useEffect(() => {
        if (!viewport) { setLine(null); return; }
        const read = () => {
            frame.current = 0;
            const now = viewLine(viewport.viewDirection(), vex);
            setLine(prev => (prev && now && prev.up === now.up && Math.abs(prev.plunge - now.plunge) < 0.05 && Math.abs(prev.trend - now.trend) < 0.05 ? prev : now));
        };
        read();
        const off = viewport.addCameraListener(() => { if (!frame.current) frame.current = requestAnimationFrame(read); });
        return () => { off(); cancelAnimationFrame(frame.current); frame.current = 0; };
    }, [viewport, vex]);

    const fill = (l: ViewLine) => {
        const p = plungingLine(l);
        setPlunge(String(Number(p.plunge.toFixed(1))));
        setTrend(String(Number(turn(p.trend).toFixed(1)) % 360));
    };
    const look = (l: ViewLine) => {
        if (!viewport) return;
        viewport.lookDown(viewLineDirection(l));
        setLine(l);
        fill(l);
        setSaid('');
    };

    const p = typed(plunge), t = typed(trend);
    const valid = p !== null && t !== null && p >= 0 && p <= 90;
    /** What is typed, looked at from above (down the plunge) or from the other end */
    const typedLine = (up: boolean): ViewLine | null => (valid ? { plunge: p!, trend: up ? turn(t! + 180) : turn(t!), up } : null);
    const nudge = (dPlunge: number, dTrend: number) => {
        const now = line ?? { plunge: 0, trend: 0, up: false };
        look({ plunge: Math.min(90, Math.max(0, Math.round(now.plunge) + dPlunge)), trend: turn(Math.round(now.trend) + dTrend), up: now.up });
    };

    if (!viewport || !line) return null;
    const field = { size: 'small', variant: 'standard', inputProps: { inputMode: 'decimal', spellCheck: false, autoComplete: 'off' }, InputLabelProps: { shrink: true } } as const;
    const step = (label: string, dPlunge: number, dTrend: number, icon: React.ReactNode) => (
        <Tooltip title={label}><IconButton size="small" aria-label={label} onClick={() => nudge(dPlunge, dTrend)}>{icon}</IconButton></Tooltip>
    );
    return (
        <>
            <Tooltip title="The line you are looking along. With the highs in front (Display, high-grade emphasis), turn the view until the highs line up: you are then looking down their plunge. Click to type a line in.">
                <Button
                    size="small" variant="outlined" data-testid="view-line" {...(short ? { 'aria-label': viewLineText(line) } : {})}
                    onClick={e => { fill(line); setSaid(''); setAnchor(e.currentTarget); }}
                    sx={{ textTransform: 'none', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}
                >
                    {short ? viewLineShort(line) : viewLineText(line)}
                </Button>
            </Tooltip>
            <Popover open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
                <Box data-testid="view-line-panel" sx={{ p: 1.5, width: 280, display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                        A line to look along: how steeply it plunges, and the bearing it plunges towards.
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                        <TextField {...field} label="Plunge (°)" value={plunge} onChange={e => setPlunge(e.target.value)} error={plunge.trim() !== '' && (p === null || p < 0 || p > 90)} placeholder="0 to 90" />
                        <TextField {...field} label="Plunges towards (°)" value={trend} onChange={e => setTrend(e.target.value)} error={trend.trim() !== '' && t === null} placeholder="0 to 360" />
                    </Box>
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                        <Button size="small" variant="contained" disabled={!valid} sx={{ textTransform: 'none', flex: 1 }} onClick={() => { const l = typedLine(false); if (l) look(l); }}>
                            Look down this line
                        </Button>
                        <Tooltip title="The same line, seen from its lower end looking up">
                            <span><Button size="small" variant="outlined" disabled={!valid} sx={{ textTransform: 'none' }} onClick={() => { const l = typedLine(true); if (l) look(l); }}>Other end</Button></span>
                        </Tooltip>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                        <Typography variant="caption" sx={{ flex: 1 }}>Turn the view 1° at a time</Typography>
                        {step('1° shallower', -1, 0, <Remove fontSize="inherit" />)}
                        <Typography variant="caption">steepness</Typography>
                        {step('1° steeper', 1, 0, <Add fontSize="inherit" />)}
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                        <Typography variant="caption" sx={{ flex: 1 }}>{viewLineText(line)}</Typography>
                        {step('1° anticlockwise', 0, -1, <Remove fontSize="inherit" />)}
                        <Typography variant="caption">bearing</Typography>
                        {step('1° clockwise', 0, 1, <Add fontSize="inherit" />)}
                    </Box>
                    {!ortho && (
                        <FormControlLabel
                            control={<Switch size="small" checked={ortho} onChange={e => onOrtho(e.target.checked)} />}
                            label={<Typography variant="caption">Parallel view (no perspective): things in line with the view stack up exactly</Typography>}
                        />
                    )}
                    <Tooltip title="Adds the line you are looking along to the model's lines set by hand, at the middle of the view. From there it can steer the surfaces and shells (Structural data, on the Modelling page).">
                        <Button
                            size="small" variant="outlined" sx={{ textTransform: 'none' }}
                            onClick={() => { const k = plungingLine(line); setSaid(onKeep(k.plunge, k.trend)); }}
                        >
                            Keep as a line measurement
                        </Button>
                    </Tooltip>
                    {said && <Typography data-testid="view-line-said" variant="caption" color="text.secondary">{said}</Typography>}
                </Box>
            </Popover>
        </>
    );
};
