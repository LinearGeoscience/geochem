/**
 * Mass change (MacLean single precursor / isocon with one immobile monitor):
 * per group, a least-altered precursor (median of chosen samples); every
 * sample's mass change % and element gains / losses in ppm.
 */
import React, { useState } from 'react';
import {
    Alert, Box, Button, FormControlLabel, MenuItem, Paper, Radio, RadioGroup, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import { useAppStore } from '../../../store/appStore';
import { ColumnPicker } from '../../../components/ColumnPicker';
import { MultiColumnSelector } from '../../../components/MultiColumnSelector';
import { notify } from '../../../store/notificationStore';
import { massChange, precursorByPercentile, type MassChangeResult } from '../../../utils/massChange';
import { useMethodData, addResultColumn, addReportTable, fmt } from './methodsCommon';

type Source = 'rule' | 'selection';

export const MassChangePanel: React.FC = () => {
    const data = useMethodData();
    const selection = useAppStore(s => s.selectedIndices);
    const [monitor, setMonitor] = useState('');
    const [groupColumn, setGroupColumn] = useState('');
    const [elements, setElements] = useState<string[]>([]);
    const [source, setSource] = useState<Source>('rule');
    const [measure, setMeasure] = useState('');
    const [percentile, setPercentile] = useState('25');
    const [requireBelow, setRequireBelow] = useState('');
    const [requireMode, setRequireMode] = useState<'below' | 'above'>('below');
    const [minN, setMinN] = useState('5');
    const [result, setResult] = useState<MassChangeResult | null>(null);

    if (!data.rowCount) return <Typography color="text.secondary">Load data to calculate mass change.</Typography>;
    const options = data.numericColumns.map(name => ({ name, alias: data.display(name) === name ? null : data.display(name) }));
    const groups = groupColumn ? data.text(groupColumn) : null;

    const precursorMask = (): Uint8Array | null => {
        if (source === 'selection') {
            const m = new Uint8Array(data.rowCount);
            for (const i of selection ?? []) m[i] = 1;
            return m;
        }
        const meas = data.values(measure);
        if (!meas) return null;
        let also: Uint8Array | null = null;
        if (requireBelow) {
            const raw = data.rawValues(requireBelow);
            if (raw) also = Uint8Array.from(raw, v => (requireMode === 'below' ? (v < 0 || v === 0 ? 1 : 0) : (v > 0 ? 1 : 0)));
        }
        return precursorByPercentile(groups, {
            measure: meas, percentile: Math.min(100, Math.max(1, parseFloat(percentile) || 25)), alsoRequire: also,
            minPrecursors: Math.max(1, parseInt(minN, 10) || 5),
        });
    };

    const run = () => {
        const mon = data.values(monitor);
        const prec = precursorMask();
        if (!mon || !prec) return;
        const els = elements.map(e => ({ name: e, values: data.values(e) })).filter((e): e is { name: string; values: Float64Array } => !!e.values);
        setResult(massChange({ monitor: mon, elements: els, groups, precursor: prec }));
    };

    const add = () => {
        if (!result) return;
        const params = { method: 'MacLean single precursor', monitor, groupColumn: groupColumn || null, precursor: source === 'selection' ? 'selected rows' : { measure, percentile, alsoRequire: requireBelow || null, requireMode, minPrecursors: minN } };
        const made = [addResultColumn(`mass_change_pct_${monitor}`, result.massChangePct, `Mass change % (monitor ${monitor})`, params)];
        for (const e of Object.keys(result.delta)) made.push(addResultColumn(`d${e}_${monitor}`, result.delta[e], `Gain (+) / loss (−) of ${e}, ppm of precursor mass (monitor ${monitor})`, params));
        notify(`Added ${made.filter(Boolean).join(', ')}`, 'success');
    };

    const toReport = () => {
        if (!result) return;
        const els = Object.keys(result.delta);
        addReportTable(`Mass change precursors (monitor ${data.display(monitor)})`,
            `Least-altered precursor of each ${groupColumn || 'dataset'}: median of ${source === 'selection' ? 'the selected samples' : `samples at or below the ${percentile}th percentile of ${data.display(measure)}${requireBelow ? ` and with ${data.display(requireBelow)} ${requireMode === 'below' ? 'below detection' : 'detected'}` : ''}`}. Mass change % = 100 (monitor of precursor / monitor of sample − 1); element change = X · factor − X of precursor (MacLean 1990).`,
            ['Group', 'Precursor samples', data.display(monitor), ...els.map(data.display)],
            result.precursors.map(p => [p.group || 'all', p.n, p.monitor, ...els.map(e => p.medians[e])]));
        notify('Precursor table added to the report', 'success');
    };

    return (
        <Box>
            <Typography variant="h6" sx={{ mb: 0.5 }}>Mass change</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                An immobile element cannot be added or removed, so if it is more concentrated than in the least-altered rock of the
                same type, the sample lost mass (leaching); if less, it gained mass (silica, carbonate, sulphide added). Choose the monitor
                with the Variation matrix first. Each group (rock type) gets its own precursor.
            </Typography>
            <Paper sx={{ p: 2, mb: 2 }}>
                <Stack spacing={1.5}>
                    <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                        <ColumnPicker label="Immobile monitor" value={monitor} onChange={setMonitor} minWidth={190} />
                        <ColumnPicker label="Rock type (group)" value={groupColumn} onChange={setGroupColumn} filter="categorical" allowNone noneLabel="One precursor" minWidth={210} />
                    </Stack>
                    <MultiColumnSelector columns={options} selectedColumns={elements} onChange={setElements} label="Elements for gains / losses" />
                    <Typography variant="subtitle2">Least-altered precursor</Typography>
                    <RadioGroup row value={source} onChange={e => setSource(e.target.value as Source)}>
                        <FormControlLabel value="rule" control={<Radio size="small" />} label="Lowest values of an alteration measure" />
                        <FormControlLabel value="selection" control={<Radio size="small" />} label={`Selected rows (${(selection ?? []).length})`} />
                    </RadioGroup>
                    {source === 'rule' && (
                        <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap alignItems="center">
                            <ColumnPicker label="Alteration measure (e.g. K/Ti)" value={measure} onChange={setMeasure} minWidth={230} />
                            <TextField size="small" label="At or below percentile" value={percentile} onChange={e => setPercentile(e.target.value)} sx={{ width: 170 }} />
                            <ColumnPicker label="And (optional)" value={requireBelow} onChange={setRequireBelow} allowNone minWidth={160} />
                            {requireBelow && (
                                <TextField select size="small" label="is" value={requireMode} onChange={e => setRequireMode(e.target.value as 'below' | 'above')} sx={{ width: 170 }}>
                                    <MenuItem value="below">below detection</MenuItem>
                                    <MenuItem value="above">detected</MenuItem>
                                </TextField>
                            )}
                            <TextField size="small" label="Drop the 'and' if fewer than" value={minN} onChange={e => setMinN(e.target.value)} sx={{ width: 200 }} />
                        </Stack>
                    )}
                    <Stack direction="row" spacing={1.5}>
                        <Button variant="contained" onClick={run} disabled={!monitor || (source === 'rule' ? !measure : !(selection ?? []).length)}>Calculate</Button>
                        {result && <Button variant="outlined" onClick={add}>Add columns</Button>}
                        {result && <Button variant="outlined" onClick={toReport}>Add to report</Button>}
                    </Stack>
                </Stack>
            </Paper>
            {result && (
                <>
                    {result.groupsWithoutPrecursor.length > 0 && (
                        <Alert severity="warning" sx={{ mb: 1 }}>No precursor samples in: {result.groupsWithoutPrecursor.map(g => g || '(blank)').join(', ')}. Their samples are left blank.</Alert>
                    )}
                    <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
                        <Table size="small">
                            <TableHead>
                                <TableRow>
                                    <TableCell>Group</TableCell><TableCell align="right">Precursor samples</TableCell><TableCell align="right">{data.display(monitor)}</TableCell>
                                    {Object.keys(result.delta).map(e => <TableCell key={e} align="right">{data.display(e)}</TableCell>)}
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {result.precursors.map(p => (
                                    <TableRow key={p.group}>
                                        <TableCell>{p.group || 'all'}</TableCell><TableCell align="right">{p.n}</TableCell><TableCell align="right">{fmt(p.monitor, 4)}</TableCell>
                                        {Object.keys(result.delta).map(e => <TableCell key={e} align="right">{fmt(p.medians[e], 4)}</TableCell>)}
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </Paper>
                </>
            )}
        </Box>
    );
};
