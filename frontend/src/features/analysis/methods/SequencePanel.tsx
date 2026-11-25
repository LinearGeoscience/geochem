/**
 * Along-hole tools (any sequence of samples whose order means something):
 *  - moving median / mean of chosen columns inside each run, added as columns
 *  - lag-1 test: is each sample like the next one? (if so, the order is real
 *    and samples are not independent: validate by hole or block)
 */
import React, { useState } from 'react';
import {
    Alert, Box, Button, CircularProgress, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import { MultiColumnSelector } from '../../../components/MultiColumnSelector';
import { notify } from '../../../store/notificationStore';
import { movingWindow, type WindowStat, type LagOneResult } from '../../../utils/statistics/sequence';
import { analysisInWorker } from '../../../utils/analysisWorker';
import { useSequenceSettings, useMethodData, sequenceOptions, addResultColumn, addReportTable, fmt } from './methodsCommon';
import { SequenceFields } from './methodsControls';

export const SequencePanel: React.FC = () => {
    const data = useMethodData();
    const seq = useSequenceSettings();
    const [smoothCols, setSmoothCols] = useState<string[]>([]);
    const [windowSize, setWindowSize] = useState('3');
    const [stat, setStat] = useState<WindowStat>('median');
    const [testCols, setTestCols] = useState<string[]>([]);
    const [clipBelow, setClipBelow] = useState('');
    const [running, setRunning] = useState(false);
    const [lag, setLag] = useState<Array<{ name: string; result: LagOneResult }> | null>(null);

    if (!data.rowCount) return <Typography color="text.secondary">Load data to use the along-hole tools.</Typography>;
    const opts = () => sequenceOptions(data, seq);
    const options = data.numericColumns.map(name => ({ name, alias: data.display(name) === name ? null : data.display(name) }));

    const smooth = () => {
        const w = Math.max(1, parseInt(windowSize, 10) || 3);
        const made: string[] = [];
        for (const c of smoothCols) {
            const v = data.values(c);
            if (!v) continue;
            const out = movingWindow(v, { ...opts(), window: w, stat });
            const name = addResultColumn(`${c}_${stat === 'median' ? 'mm' : 'ma'}${w}`, out,
                `Moving ${stat} of ${c} over ${w} samples along the sequence`,
                { method: `moving ${stat}`, source: c, window: w, hole: seq.holeColumn || null, orderBy: seq.positionColumn || null, maxGap: seq.maxGap || null });
            if (name) made.push(name);
        }
        if (made.length) notify(`Added ${made.join(', ')}`, 'success');
    };

    const test = async () => {
        setRunning(true);
        try {
            const clip = parseFloat(clipBelow);
            const columns = testCols.map(c => ({ name: c, values: data.values(c) })).filter(c => c.values) as Array<{ name: string; values: Float64Array }>;
            const o = opts();
            setLag(await analysisInWorker('lagOneTests', {
                columns,
                options: { groups: o.groups ? Array.from(o.groups as ArrayLike<unknown>, v => String(v ?? '')) : null, position: o.position, maxGap: o.maxGap,
                    clipBelow: Number.isFinite(clip) ? clip : null, permutations: 2000, seed: 42 },
            }));
        } catch (err) {
            notify(`Lag-1 test failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
        } finally {
            setRunning(false);
        }
    };

    const toReport = () => {
        if (!lag) return;
        addReportTable('Is the sample order meaningful? (lag-1 test)',
            `Spearman correlation between each sample and the next in its run (${seq.holeColumn ? `by ${seq.holeColumn}, ` : ''}ordered by ${seq.positionColumn || 'row order'}), against 2,000 random orders. A correlation well above the random 95th percentile means neighbours are alike: the order is real and samples are not independent.`,
            ['Column', 'Lag-1 ρ', 'Pairs', 'Random 95th pct', 'p'],
            lag.map(r => [data.display(r.name), r.result.rho, r.result.pairs, r.result.nullP95, r.result.pValue]));
        notify('Lag-1 table added to the report', 'success');
    };

    return (
        <Box>
            <Typography variant="h6" sx={{ mb: 0.5 }}>Along-hole tools</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                For samples in a meaningful order: down a hole, or consecutive sample numbers. Set the order once; it is shared with
                Score vs target and Variable screening.
            </Typography>
            <Paper sx={{ p: 2, mb: 2 }}><SequenceFields /></Paper>

            <Paper sx={{ p: 2, mb: 2 }}>
                <Typography variant="subtitle1" sx={{ mb: 1 }}>Is the order meaningful? (lag-1 test)</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                    Rocks are continuous, so immobile elements (Ti, Zr) in true down-hole order are much more like their neighbours than
                    chance allows. If they are, samples are not independent: random train/test splits and ordinary bootstraps flatter any
                    model. Use blocks or whole holes instead.
                </Typography>
                <MultiColumnSelector columns={options} selectedColumns={testCols} onChange={setTestCols} label="Columns to test" />
                <Stack direction="row" spacing={1.5} sx={{ mt: 1.5 }} alignItems="center">
                    <TextField size="small" label="Raise values below to" value={clipBelow} onChange={e => setClipBelow(e.target.value)} sx={{ width: 180 }} placeholder="no change" />
                    <Button variant="contained" onClick={test} disabled={running || !testCols.length}>{running ? <CircularProgress size={18} /> : 'Run test'}</Button>
                    {lag && <Button variant="outlined" onClick={toReport}>Add to report</Button>}
                </Stack>
                {lag && (
                    <Table size="small" sx={{ mt: 1.5 }}>
                        <TableHead><TableRow><TableCell>Column</TableCell><TableCell align="right">Lag-1 ρ</TableCell><TableCell align="right">Pairs</TableCell><TableCell align="right">Random 95th pct</TableCell><TableCell align="right">p</TableCell></TableRow></TableHead>
                        <TableBody>
                            {lag.map(r => (
                                <TableRow key={r.name}>
                                    <TableCell>{data.display(r.name)}</TableCell>
                                    <TableCell align="right" sx={{ fontWeight: r.result.rho > r.result.nullP95 ? 600 : 400 }}>{fmt(r.result.rho)}</TableCell>
                                    <TableCell align="right">{r.result.pairs}</TableCell>
                                    <TableCell align="right">{fmt(r.result.nullP95)}</TableCell>
                                    <TableCell align="right">{r.result.pValue === 0 ? '< 0.0005' : fmt(r.result.pValue)}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </Paper>

            <Paper sx={{ p: 2 }}>
                <Typography variant="subtitle1" sx={{ mb: 1 }}>Moving median / mean</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                    Each sample with its neighbours inside its run (centred window). Cancels single-sample noise when the feature is
                    wider than a sample, such as an alteration halo; blurs sharp contacts. Use the smoothed column for interval or
                    bench calls, the raw one to pick single samples.
                </Typography>
                <MultiColumnSelector columns={options} selectedColumns={smoothCols} onChange={setSmoothCols} label="Columns to smooth" />
                <Stack direction="row" spacing={1.5} sx={{ mt: 1.5 }} alignItems="center">
                    <TextField size="small" label="Window (samples)" value={windowSize} onChange={e => setWindowSize(e.target.value)} sx={{ width: 140 }} />
                    <TextField select size="small" label="Statistic" value={stat} onChange={e => setStat(e.target.value as WindowStat)} sx={{ width: 130 }}>
                        <MenuItem value="median">Median</MenuItem>
                        <MenuItem value="mean">Mean</MenuItem>
                    </TextField>
                    <Button variant="contained" onClick={smooth} disabled={!smoothCols.length}>Add smoothed columns</Button>
                </Stack>
                {!seq.positionColumn && !seq.holeColumn && <Alert severity="info" sx={{ mt: 1.5 }}>No hole or order column: the dataset's row order is used as one sequence.</Alert>}
            </Paper>
        </Box>
    );
};
