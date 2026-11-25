/**
 * The plunge finder, beside the 3D view: scans the samples of a column for
 * the direction their highs line up along (features/model/plungeScan) and
 * shows the result as stereonets, one for each cut-off. Clicking a net looks
 * down that direction in the view, where the X-ray (highs in front) shows
 * whether the highs really collapse into a tight shape; the answer can be
 * kept as a line reading for the model.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
    Alert, Box, Button, Checkbox, Collapse, FormControl, FormControlLabel, IconButton, InputLabel, LinearProgress,
    MenuItem, Paper, Select, TextField, Tooltip, Typography,
} from '@mui/material';
import { Close, ExpandLess, ExpandMore } from '@mui/icons-material';
import type { ThreeViewport } from './ThreeViewport';
import { viewLine, viewLineDirection, plungingLine } from './geometry';
import { PlungeNet, ANSWER } from './PlungeNet';
import { usePlungeScan } from '../../model/plungeClient';
import { AGREE, CLEAR, planeOf, type PlungeNet as Net, type PlungeSamples, type Vec3 } from '../../model/plungeScan';

export const PLUNGE_PANEL_WIDTH = 330;
/** The big net: as large as fits beside a short plot (the data grid below it), up to this */
const BIG = 296, LEAST_BIG = 170, SMALL = 54;

const bearing = (t: number) => String(Math.round(t) % 360).padStart(3, '0');
const pct = (share: number) => `${Number((share * 100).toFixed(1))}%`;
const grade = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toPrecision(2));

interface Props {
    height: number;
    viewport: ThreeViewport | null;
    vex: number;
    /** Numeric columns that can be scanned */
    columns: string[];
    /** The column offered first (the one the view is coloured by) */
    initialColumn: string | null;
    selectedCount: number;
    /** Why a scan cannot be run here (no Z, no hole column), or null */
    blocked: string | null;
    /** The samples of a column (only the selected ones when asked), or null */
    gather: (column: string, onlySelected: boolean) => PlungeSamples | null;
    /** Keep a line as a reading; returns what happened, in words */
    onKeep: (plunge: number, trend: number) => string;
    onClose: () => void;
}

export const PlungePanel: React.FC<Props> = ({ height, viewport, vex, columns, initialColumn, selectedCount, blocked, gather, onKeep, onClose }) => {
    const { running, progress, result, about, error, run, stop } = usePlungeScan();
    const [column, setColumn] = useState<string>(initialColumn && columns.includes(initialColumn) ? initialColumn : columns[0] ?? '');
    const [onlySelected, setOnlySelected] = useState(false);
    const [spacing, setSpacing] = useState('');
    const [shown, setShown] = useState(-1);
    const [said, setSaid] = useState('');
    const [help, setHelp] = useState(false);
    const [problem, setProblem] = useState('');
    const [looking, setLooking] = useState<Vec3 | null>(null);
    const frame = useRef(0);

    useEffect(() => { if (!columns.includes(column) && columns.length) setColumn(initialColumn && columns.includes(initialColumn) ? initialColumn : columns[0]); }, [columns, column, initialColumn]);
    // A new result: show the net it believes
    useEffect(() => { setShown(result?.ok ? result.chosen : -1); setSaid(''); }, [result]);
    // The line the view looks along now, as a cross on the net
    useEffect(() => {
        if (!viewport) { setLooking(null); return; }
        const read = () => {
            frame.current = 0;
            const l = viewLine(viewport.viewDirection(), vex);
            if (!l) { setLooking(null); return; }
            const p = plungingLine(l);
            setLooking(viewLineDirection({ plunge: p.plunge, trend: p.trend, up: false }));
        };
        read();
        const off = viewport.addCameraListener(() => { if (!frame.current) frame.current = requestAnimationFrame(read); });
        return () => { off(); cancelAnimationFrame(frame.current); frame.current = 0; };
    }, [viewport, vex]);

    const scan = () => {
        setProblem('');
        const samples = gather(column, onlySelected && selectedCount > 0);
        if (!samples) { setProblem('This column has no values to scan.'); return; }
        const typed = Number(spacing.trim());
        run(samples, { column, selected: onlySelected && selectedCount > 0 ? selectedCount : null }, spacing.trim() !== '' && typed > 0 ? typed : null);
    };
    const lookDown = (dir: Vec3) => viewport?.lookDown(dir);

    const net: Net | null = result?.ok && shown >= 0 ? result.nets[shown] : null;
    const big = Math.max(LEAST_BIG, Math.min(BIG, height - 200));
    const sureHere = !!net?.sure;

    return (
        <Paper data-testid="plunge-panel" variant="outlined" sx={{ width: PLUNGE_PANEL_WIDTH, flexShrink: 0, height, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <Box sx={{ p: 0.75, pl: 1, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Tooltip title="Finds the direction the highs of a column line up along: looking down it, the highs of different holes stack on top of each other (the X-ray plunge projection, by count).">
                    <Typography variant="subtitle2" sx={{ flex: 1 }}>Plunge finder</Typography>
                </Tooltip>
                <Tooltip title="Close the plunge finder"><IconButton size="small" aria-label="Close the plunge finder" onClick={onClose}><Close fontSize="small" /></IconButton></Tooltip>
            </Box>
            <Box sx={{ px: 1, pt: 0.75, pb: 1, overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
                {blocked ? <Alert severity="info" sx={{ py: 0 }}>{blocked}</Alert> : <>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <FormControl size="small" sx={{ flex: 1, minWidth: 0 }}>
                            <InputLabel id="plunge-column">Column</InputLabel>
                            <Select labelId="plunge-column" label="Column" value={columns.includes(column) ? column : ''} onChange={e => setColumn(String(e.target.value))} disabled={running}>
                                {columns.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                            </Select>
                        </FormControl>
                        {running
                            ? <Button size="small" variant="outlined" onClick={stop}>Stop</Button>
                            : <Button variant="contained" size="small" disabled={!column} onClick={scan} sx={{ whiteSpace: 'nowrap' }}>Find the plunge</Button>}
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Tooltip title="Scan one part of the deposit at a time, where it may have more than one plunge">
                            <FormControlLabel
                                sx={{ mr: 0, flex: 1 }}
                                control={<Checkbox size="small" checked={onlySelected && selectedCount > 0} disabled={selectedCount === 0 || running} onChange={e => setOnlySelected(e.target.checked)} />}
                                label={<Typography variant="caption">Only the {selectedCount > 0 ? `${selectedCount.toLocaleString()} ` : ''}selected samples</Typography>}
                            />
                        </Tooltip>
                        <Tooltip title="The usual distance between holes. Left empty, it is worked out from the samples.">
                            <TextField size="small" label="Hole spacing (m)" placeholder="auto" value={spacing} onChange={e => setSpacing(e.target.value)} disabled={running} sx={{ width: 120 }} inputProps={{ inputMode: 'decimal' }} />
                        </Tooltip>
                    </Box>
                    {running && <>
                        <LinearProgress variant="determinate" value={progress * 100} />
                        <Typography variant="caption" color="text.secondary">Scanning 1,500 directions at five cut-offs, and each half of the holes on its own…</Typography>
                    </>}
                </>}
                {problem && <Alert severity="warning" sx={{ py: 0 }}>{problem}</Alert>}
                {error && <Alert severity="error" sx={{ py: 0 }}>{error}</Alert>}
                {result && !result.ok && (
                    <Alert severity="warning" sx={{ py: 0 }}>
                        {result.reason === 'holes' ? 'It needs at least three holes with values in this column.' : 'It could not tell how far apart the holes are: type the hole spacing in.'}
                    </Alert>
                )}

                {result?.ok && about && (
                    <>
                        <Typography variant="caption" color="text.secondary">
                            {about.column}, {about.selected ? `${result.samples.toLocaleString()} of the selected samples` : `${result.samples.toLocaleString()} samples`} in {result.holes.toLocaleString()} holes, about {Math.round(result.spacing)} m apart.
                        </Typography>
                        {net ? (
                            <>
                                <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                                    <PlungeNet net={net} size={big} looking={looking} showBand onPick={lookDown} title={`Top ${pct(net.share)}: click a place to look down it`} />
                                </Box>
                                <Box data-testid="plunge-answer">
                                    {net.axis && net.plunge !== null && net.trend !== null ? (
                                        <Typography variant="body2" fontWeight={600} color={sureHere ? 'success.main' : 'warning.main'}>
                                            {sureHere ? 'The highs line up plunging ' : 'Not sure. Best guess: plunging '}{Math.round(net.plunge)}° towards {bearing(net.trend)}°
                                        </Typography>
                                    ) : <Typography variant="body2" fontWeight={600} color="warning.main">Too few highs at this cut-off.</Typography>}
                                    <Typography variant="caption" color="text.secondary" component="div">
                                        Top {pct(net.share)} of the samples ({about.column} ≥ {grade(net.cutoff)}).
                                        {net.axis && <> The peak stands {net.clear.toFixed(1)}× clearer than anywhere else{net.clear < CLEAR ? ` (${CLEAR}× is needed)` : ''}; two halves of the holes, scanned apart, give answers {Math.round(net.halves)}° apart{net.halves > AGREE ? ` (within ${AGREE}° is needed)` : ''}.</>}
                                        {shown !== result.chosen && result.chosen >= 0 && ` The cut-off it believes is the top ${pct(result.nets[result.chosen].share)}.`}
                                    </Typography>
                                    {net.band >= 0.5 && net.pole && (() => {
                                        const pl = planeOf(net.pole);
                                        return (
                                            <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
                                                The bright directions form a band (dashed): the highs lie in a plane dipping {Math.round(pl.dip)}° towards {bearing(pl.direction)}°. A brighter spot on the band is a line within that plane.
                                            </Typography>
                                        );
                                    })()}
                                </Box>
                                <Box sx={{ display: 'flex', gap: 1 }}>
                                    <Button size="small" variant="outlined" disabled={!net.axis || !viewport} onClick={() => net.axis && lookDown(net.axis)}>Look down it</Button>
                                    <Button size="small" variant="outlined" disabled={net.plunge === null} onClick={() => { if (net.plunge !== null && net.trend !== null) setSaid(onKeep(net.plunge, net.trend)); }}>Keep as a line measurement</Button>
                                </Box>
                                {said && <Typography data-testid="plunge-said" variant="caption" color="text.secondary">{said}</Typography>}
                            </>
                        ) : <Typography variant="body2" color="warning.main">No cut-off had enough highs in different holes to scan.</Typography>}

                        <Typography variant="caption" color="text.secondary">Each cut-off (click one to show it):</Typography>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                            {result.nets.map((n, i) => (
                                <Box key={n.share} sx={{ textAlign: 'center', cursor: 'pointer', opacity: i === shown ? 1 : 0.85 }} onClick={() => setShown(i)} data-testid={`plunge-cutoff-${i}`}>
                                    <PlungeNet net={n} size={SMALL} ring={i === shown ? '#fff' : '#888'} title={`Top ${pct(n.share)}`} />
                                    <Typography variant="caption" component="div" sx={{ lineHeight: 1.2, fontWeight: i === result.chosen ? 700 : 400 }}>
                                        {pct(n.share)}{n.sure ? ' ✓' : ''}
                                    </Typography>
                                </Box>
                            ))}
                        </Box>
                        <Typography variant="caption" color="text.secondary">✓ clear, and two halves of the holes agree · bold: the one it believes</Typography>
                    </>
                )}

                <Box>
                    <Button size="small" sx={{ textTransform: 'none', px: 0 }} endIcon={help ? <ExpandLess /> : <ExpandMore />} onClick={() => setHelp(!help)}>How to read the net</Button>
                    <Collapse in={help}>
                        <Typography variant="caption" color="text.secondary" component="div" sx={{ '& p': { m: 0, mb: 0.75 } }}>
                            <p>The circle is every direction you can look down, seen from above: north at the top, straight down in the middle, level at the rim (a lower-hemisphere stereonet).</p>
                            <p>Bright means: looking down that way, the high samples of different holes sit on top of each other more often than the drilling alone would make them. Each direction is compared with samples taken at random from the same holes, so looking down the holes, or along a row of them, does not count. Grey: the drilling cannot see that way.</p>
                            <p>A bright spot is a direction the highs line up along: the plunge (ringed in <span style={{ color: ANSWER }}>pink</span>). A bright band is a plane they lie in. The cross is where the view looks now.</p>
                            <p>Click any place to look down it, with High-grade emphasis on: if it is the plunge, the highs collapse into a tight shape.</p>
                            <p>It is sure only when the peak stands out and two halves of the holes, scanned apart (split at random, five times), find the same line. On real drilling that is often not so: the highs may follow more than one direction, or none. "Not sure" with its best guess is then the honest answer; look down the guess, and try part of the deposit at a time (select it first).</p>
                            <p>Coarse drilling, or holes drilled near the strike of a lode, can line the highs up along the strike or along the drill sections.</p>
                        </Typography>
                    </Collapse>
                </Box>
            </Box>
        </Paper>
    );
};
