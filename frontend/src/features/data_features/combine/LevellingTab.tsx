/**
 * Levelling: score each value against its own group (protocol, medium x
 * method, batch) so surveys can share one whole-area map. Groups too small
 * or mostly below detection are left blank with the reason; nothing falls
 * back to whole-dataset statistics.
 */
import React, { useDeferredValue, useMemo, useState } from 'react';
import {
    Alert, Box, Button, Chip, MenuItem, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    TextField, Tooltip, Typography,
} from '@mui/material';
import { useAppStore } from '../../../store/appStore';
import { useUIStore } from '../../../store/uiStore';
import { useAuditStore } from '../../../store/auditStore';
import { useReportStore } from '../../../store/reportStore';
import { notify } from '../../../store/notificationStore';
import { MultiColumnSelector } from '../../../components/MultiColumnSelector';
import { combineLabels } from '../../../utils/groupLabels';
import { clearHalfDl, type FloorReading } from '../../../utils/groupDl';
import {
    BLANKING_FLAGS, FLAG_TEXT, LEVEL_BREAKS, levelColumn, levelledColumnName, type LevelMethod, type LevelResult,
} from '../../../utils/levelling';
import { configureTab, setRangeClasses } from '../../../utils/attributeClassify';
import { tilePlotsWhenReady } from '../../workspace/workspaceApi';
import { GroupByFields } from './GroupByFields';
import { initialGroupBy, useSurveyColumns } from './surveyColumns';
import { useCombineStore, poolKey } from './combineStore';

const fmt = (v: number | null) => (v === null ? '—' : v >= 1000 ? Math.round(v).toLocaleString() : String(+v.toPrecision(3)));
const q = (v: number | null, limit: number | null) => (v === null ? (limit !== null ? `<${fmt(limit)}` : '<DL') : fmt(v));

export const LEVEL_NOTE = 'Levelling removes the differences between groups — including real ones: a survey that sat over a mineralised '
    + 'area gets the same top 5 % as one over barren ground. Check groups that share ground with the Overlap check, and pool those that agree.';

export const LevellingTab: React.FC = () => {
    const { columns, columnarData, mappings, assayColumns, groupOptions } = useSurveyColumns();
    const rowCount = columnarData.rowCount;
    // Default elements: present in at least half the rows (the ones a whole-area map can show)
    const [elements, setElements] = useState<string[]>(() => assayColumns.filter(c => {
        const col = columnarData.columns.get(c) as Float64Array | undefined;
        let k = 0;
        if (col) for (let i = 0; i < col.length; i++) if (Number.isFinite(col[i])) k++;
        return k >= rowCount / 2;
    }).slice(0, 8));
    const [groupBy, setGroupByState] = useState<string[]>(() => initialGroupBy(columns, groupOptions));
    const setGroupBy = (cols: string[]) => { setGroupByState(cols); useCombineStore.getState().setGroupBy(cols); };
    const [method, setMethod] = useState<LevelMethod>('percentile');
    const [minSize, setMinSize] = useState('30');
    const [informativeAt, setInformativeAt] = useState('90');
    const [floorAs, setFloorAs] = useState<FloorReading>('half');
    const key = poolKey(groupBy);
    const pool = useCombineStore(s => s.pools[key]);

    const params = useDeferredValue({ elements, groupBy, method, minSize, informativeAt, floorAs, pool });
    const results = useMemo(() => {
        const groupCols = params.groupBy.map(c => columnarData.columns.get(c));
        if (!params.groupBy.length || groupCols.some(c => !c)) return null;
        const groups = combineLabels(groupCols as ArrayLike<unknown>[]);
        const min = Math.max(5, parseInt(params.minSize, 10) || 30);
        const inf = Math.min(100, Math.max(50, parseFloat(params.informativeAt) || 90));
        const out = new Map<string, LevelResult>();
        for (const el of params.elements) {
            const raw = columnarData.columns.get(el);
            if (!(raw instanceof Float64Array)) continue;
            out.set(el, levelColumn(raw, groups, {
                method: params.method, minGroupSize: min, informativeAt: inf, floorAs: params.floorAs,
                halfDl: clearHalfDl(raw, groups), pool: params.pool ? new Map(Object.entries(params.pool)) : undefined,
            }));
        }
        return { groups, out, min, inf };
    }, [params, columnarData]);

    const [shown, setShown] = useState<string>('');
    const view = results?.out.get(shown) ? shown : elements[0] ?? '';
    const viewResult = results?.out.get(view);
    const unit = (el: string) => mappings.find(m => m.originalName === el)?.detectedUnit ?? '';
    const [made, setMade] = useState<string[]>([]);

    const add = () => {
        if (!results) return;
        const created = new Date().toISOString();
        const adds = [...results.out.entries()].map(([el, r]) => ({
            name: levelledColumnName(el, method),
            values: r.values,
            replace: true,
            derivation: {
                kind: 'calculation' as const,
                description: `${el} levelled within ${groupBy.join(' × ')} (${method === 'percentile' ? 'percentile 0–100' : 'robust log z-score'})`,
                created,
                params: {
                    levelling: {
                        source: el, method, groupColumns: groupBy, minGroupSize: results.min, informativeAt: results.inf, floorAs,
                        pool: params.pool ?? null,
                        groups: r.groups.map(g => ({ group: g.group, n: g.nValues, censored: g.nCensored, limit: g.limit, p95: g.p95, flags: g.flags })),
                    },
                },
            },
        }));
        useAppStore.getState().applyColumnEdits({ add: adds });
        const names = adds.map(a => a.name);
        const blanked = [...results.out.values()].reduce((s, r) => s + r.blanked, 0);
        useAuditStore.getState().recordAudit({
            category: 'calculation',
            operation: 'Levelling',
            description: `${names.length} column${names.length === 1 ? '' : 's'} levelled within ${groupBy.join(' × ')} (${method})`,
            details: `Minimum ${results.min} values per group; groups with >= ${results.inf} % below detection left blank (${blanked.toLocaleString()} values). ${LEVEL_NOTE}`,
            parameters: { method, groupColumns: groupBy, minGroupSize: results.min, informativeAt: results.inf, floorAs, pooled: params.pool ? Object.keys(params.pool).length : 0 },
            inputColumns: [...results.out.keys(), ...groupBy],
            outputColumns: names,
            rowsAffected: rowCount,
        });
        setMade(names);
        notify(`Added ${names.join(', ')}`, 'success');
    };

    const mapIt = () => {
        const col = made.find(n => n.startsWith(view)) ?? made[0];
        if (!col) return;
        if (method === 'percentile') setRangeClasses('color', col, [0, ...LEVEL_BREAKS, 100]);
        else configureTab('color', { field: col, method: 'stdDev' });
        const medium = groupOptions.find(o => o.kind === 'medium' && groupBy.includes(o.name))?.name;
        if (medium) configureTab('shape', { field: medium });
        const app = useAppStore.getState();
        const east = app.columns.find(c => c.role === 'East')?.name;
        const north = app.columns.find(c => c.role === 'North')?.name;
        if (!east || !north) { notify('No East / North columns to map', 'warning'); return; }
        const title = `Levelled ${col}`;
        const existing = app.plots.find(p => p.type === 'map' && p.title === title);
        const id = existing?.id ?? app.addPlot('map', { settings: { xAxis: east, yAxis: north }, title });
        app.setCurrentView('plots');
        tilePlotsWhenReady([id]);
        useUIStore.getState().setCombineSurveys(null);
    };

    const toReport = async () => {
        if (!results) return;
        const els = [...results.out.keys()];
        const report = useReportStore.getState();
        report.addNote(`Levelling (${groupBy.join(' × ')})`, [
            `${els.join(', ')} ${els.length === 1 ? 'was' : 'were'} levelled within each ${groupBy.join(' × ')} group so that surveys, lab methods and sample media can share one whole-area map. `
            + (method === 'percentile'
                ? 'Each value is its percentile within its own group (0–100); all values below the group\'s detection limit are tied at the bottom.'
                : 'Each value is a robust z-score of log10 within its own group (median and upper-half spread, unaffected by censoring below the median).'),
            `Groups with fewer than ${results.min} values, or with ${results.inf} % or more below detection, were left blank rather than compared with the whole dataset.`
            + (params.pool ? ` Groups judged equivalent by the overlap check were pooled (${Object.keys(params.pool).length}).` : ''),
            LEVEL_NOTE,
        ].join('\n\n'));
        const groupNames = [...new Set([...results.out.values()].flatMap(r => r.groups.map(g => g.group)))];
        const stat = new Map([...results.out.entries()].map(([el, r]) => [el, new Map(r.groups.map(g => [g.group, g]))]));
        const rows = groupNames.slice(0, 40).map(g => [g, ...els.map(el => {
            const s = stat.get(el)!.get(g);
            if (!s) return '';
            const blank = s.flags.find(f => BLANKING_FLAGS.includes(f));
            return blank ? `blank: ${FLAG_TEXT[blank]}` : `${s.nValues} · p95 ${q(s.p95, s.limit)}`;
        })]);
        report.addTable({
            title: `Levelling groups (${groupBy.join(' × ')})`,
            caption: `Values and 95th percentile per group, in original units (${els.map(e => `${e} ${unit(e)}`).join(', ')}); blank = left out, with the reason.`,
            columns: ['Group', ...els], rows,
        });
        const app = useAppStore.getState();
        const maps = app.plots.filter(p => p.type === 'map' && (p.title ?? '').startsWith('Levelled '));
        const { addPlotToReport } = await import('../../../utils/reportCapture');
        let figs = 0;
        for (const m of maps) if (await addPlotToReport(m.id)) figs++;
        notify(`Report: levelling note, group table${figs ? ` and ${figs} map${figs === 1 ? '' : 's'}` : ''} added`, 'success');
    };

    if (!assayColumns.length) return <Alert severity="info">No element columns to work with.</Alert>;
    return (
        <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
                Scores every value against its own group, so surveys, lab methods and sample media can share one map: the top 5 % of a
                soil survey and of a stream survey both map as “above 95”. Values below a group's detection limit are tied at the bottom;
                groups too small or mostly below detection are left blank, never compared with the whole dataset.
            </Typography>
            <MultiColumnSelector columns={assayColumns.map(name => ({ name, alias: null }))} selectedColumns={elements} onChange={setElements} label="Elements" />
            <Stack direction="row" spacing={1.5} alignItems="flex-start" flexWrap="wrap" useFlexGap>
                <GroupByFields options={groupOptions} value={groupBy} onChange={setGroupBy} help="protocol groups, or sample medium × lab method" />
                <TextField select size="small" label="Score" value={method} onChange={e => setMethod(e.target.value as LevelMethod)} sx={{ minWidth: 200 }}>
                    <MenuItem value="percentile">Percentile in group (0–100)</MenuItem>
                    <MenuItem value="zlog">Robust log z-score</MenuItem>
                </TextField>
                <TextField size="small" label="Smallest group" value={minSize} onChange={e => setMinSize(e.target.value)} sx={{ width: 120 }} />
                <TextField size="small" label="Blank when below DL ≥" value={informativeAt} onChange={e => setInformativeAt(e.target.value)} sx={{ width: 170 }}
                    InputProps={{ endAdornment: <Typography variant="caption">%</Typography> }} />
                <TextField select size="small" label="Repeated lowest value" value={floorAs} onChange={e => setFloorAs(e.target.value as FloorReading)} sx={{ minWidth: 190 }}>
                    <MenuItem value="half">is half the limit</MenuItem>
                    <MenuItem value="limit">is the limit</MenuItem>
                </TextField>
            </Stack>
            {pool && (
                <Alert severity="info" action={<Button size="small" onClick={() => useCombineStore.getState().setPool(key, null)}>Clear</Button>}>
                    {Object.keys(pool).length} group{Object.keys(pool).length === 1 ? '' : 's'} pooled with groups they agree with (overlap check).
                </Alert>
            )}
            {!results || !elements.length ? <Alert severity="info">Choose elements and a grouping column.</Alert> : (
                <>
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                        {[...results.out.entries()].map(([el, r]) => (
                            <Chip key={el} size="small" clickable color={el === view ? 'primary' : 'default'} onClick={() => setShown(el)}
                                label={`${el}: ${r.scored.toLocaleString()} scored${r.blanked ? `, ${r.blanked.toLocaleString()} blank` : ''}`} />
                        ))}
                    </Stack>
                    {viewResult && (
                        <TableContainer sx={{ maxHeight: 320, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                            <Table size="small" stickyHeader>
                                <TableHead>
                                    <TableRow>
                                        <TableCell>Group</TableCell>
                                        <TableCell align="right">Values</TableCell>
                                        <TableCell align="right">Below DL</TableCell>
                                        <TableCell align="right">Median</TableCell>
                                        <TableCell align="right">P90</TableCell>
                                        <TableCell align="right">P95</TableCell>
                                        <TableCell align="right">P98</TableCell>
                                        <TableCell>{view} ({unit(view)})</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {viewResult.groups.map(g => (
                                        <TableRow key={g.group} sx={{ opacity: g.levelled ? 1 : 0.6 }}>
                                            <TableCell>{g.group}</TableCell>
                                            <TableCell align="right">{g.nValues.toLocaleString()}</TableCell>
                                            <TableCell align="right">{Math.round((100 * g.nCensored) / g.nValues)} %</TableCell>
                                            <TableCell align="right">{q(g.median, g.limit)}</TableCell>
                                            <TableCell align="right">{q(g.p90, g.limit)}</TableCell>
                                            <TableCell align="right">{q(g.p95, g.limit)}</TableCell>
                                            <TableCell align="right">{q(g.p98, g.limit)}</TableCell>
                                            <TableCell>
                                                <Stack direction="row" spacing={0.5}>
                                                    {g.flags.map(f => (
                                                        <Tooltip key={f} title={FLAG_TEXT[f]}>
                                                            <Chip size="small" variant="outlined" color={BLANKING_FLAGS.includes(f) ? 'warning' : 'default'}
                                                                label={BLANKING_FLAGS.includes(f) ? `blank: ${FLAG_TEXT[f]}` : FLAG_TEXT[f]} />
                                                        </Tooltip>
                                                    ))}
                                                    {!g.flags.length && <Typography variant="caption" color="text.secondary">levelled</Typography>}
                                                </Stack>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    )}
                    <Alert severity="warning" variant="outlined">{LEVEL_NOTE}</Alert>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                        <Button variant="contained" onClick={add} disabled={!results.out.size}>
                            Add {results.out.size} column{results.out.size === 1 ? '' : 's'}
                        </Button>
                        {made.length > 0 && (
                            <>
                                <Chip size="small" color="success" label={`${made.length} added`} />
                                <Tooltip title={`Colour by the levelled ${view} (classes ${LEVEL_BREAKS.join(' / ')}), shape by medium, on a map`}>
                                    <Button size="small" variant="outlined" onClick={mapIt}>Map it</Button>
                                </Tooltip>
                                <Tooltip title="Method note, the group table and any levelled maps, into the report">
                                    <Button size="small" variant="outlined" onClick={toReport}>Add to report</Button>
                                </Tooltip>
                            </>
                        )}
                    </Box>
                </>
            )}
        </Stack>
    );
};
