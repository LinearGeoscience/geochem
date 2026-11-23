/**
 * Common detection limit: one column on a single censoring level for the
 * chosen groups, so raw thresholds can be set across surveys that used
 * different limits. The level can never be set below a chosen group's limit.
 */
import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
    Alert, Box, Button, Checkbox, Chip, MenuItem, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    TextField, Tooltip, Typography,
} from '@mui/material';
import { useAppStore } from '../../../store/appStore';
import { useAuditStore } from '../../../store/auditStore';
import { notify } from '../../../store/notificationStore';
import { combineLabels } from '../../../utils/groupLabels';
import { clearHalfDl, groupDetectionLimits, type FloorReading } from '../../../utils/groupDl';
import { censorToCommonDl, commonDlColumnName, defaultCommonLevel, groupsAboveLevel, groupsWithoutLimit } from '../../../utils/commonDl';
import { GroupByFields } from './GroupByFields';
import { useSurveyColumns } from './surveyColumns';

const fmt = (v: number) => (v >= 1000 ? v.toLocaleString() : String(+v.toPrecision(3)));
const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)} %` : '—');

export const CommonDlTab: React.FC = () => {
    const { columnarData, mappings, assayColumns, groupOptions } = useSurveyColumns();
    const [element, setElement] = useState(() => assayColumns.find(c => /^Au[_\s(]/i.test(c)) ?? assayColumns[0] ?? '');
    const [groupBy, setGroupBy] = useState<string[]>(() => {
        const method = groupOptions.find(o => o.kind === 'method')?.name ?? groupOptions[0]?.name;
        const medium = groupOptions.find(o => o.kind === 'medium')?.name;
        return [method, medium].filter((x): x is string => !!x).filter((x, i, a) => a.indexOf(x) === i);
    });
    const unit = mappings.find(m => m.originalName === element)?.detectedUnit ?? '';

    // A repeated lowest value in a group that shows no limit: half the limit (safe) or the limit
    const [floorAs, setFloorAs] = useState<FloorReading>('half');
    const deferred = useDeferredValue({ element, groupBy, floorAs });
    const analysis = useMemo(() => {
        const raw = columnarData.columns.get(deferred.element);
        if (!(raw instanceof Float64Array) || !deferred.groupBy.length) return null;
        const groupCols = deferred.groupBy.map(c => columnarData.columns.get(c)).filter((c): c is NonNullable<typeof c> => !!c);
        if (groupCols.length !== deferred.groupBy.length) return null;
        const groups = combineLabels(groupCols);
        // ½-DL values are found within the same groups, clear-cut cases only
        const halfDl = clearHalfDl(raw, groups);
        const stats = groupDetectionLimits(raw, groups, { halfDl, halfDlGroups: groups, floorAs: deferred.floorAs }).filter(s => s.nValues > 0);
        return { raw, groups, halfDl, stats };
    }, [deferred, columnarData]);

    const [excluded, setExcluded] = useState<Set<string>>(new Set());
    // Unticked groups reset only when the element or grouping changes (not when a column is added)
    const groupingKey = `${element}|${groupBy.join('|')}`;
    useEffect(() => setExcluded(new Set()), [groupingKey]);
    const include = useMemo(() => new Set((analysis?.stats ?? []).map(s => s.group).filter(g => !excluded.has(g))), [analysis, excluded]);
    const minLevel = analysis ? defaultCommonLevel(analysis.stats, include) : null;
    const setBy = minLevel === null || !analysis ? [] : analysis.stats.filter(s => include.has(s.group) && s.assumedDl === minLevel).map(s => s.group);
    const unknown = analysis ? groupsWithoutLimit(analysis.stats, include) : [];
    const anyFloor = !!analysis?.stats.some(s => s.floor);

    const [levelText, setLevelText] = useState('');
    const level = levelText.trim() ? Number(levelText) : minLevel;
    const tooLow = analysis && level !== null && Number.isFinite(level) ? groupsAboveLevel(analysis.stats, include, level) : [];
    const valid = analysis && level !== null && Number.isFinite(level) && level > 0 && !tooLow.length && include.size > 0;

    const preview = useMemo(() => (valid && analysis
        ? censorToCommonDl(analysis.raw, analysis.groups, { include, level: level!, halfDl: analysis.halfDl, halfDlGroups: analysis.groups })
        : null), [valid, analysis, include, level]);

    const defaultName = level ? commonDlColumnName(element, level) : '';
    const [nameText, setNameText] = useState('');
    const name = nameText.trim() || defaultName;
    const exists = useAppStore(s => s.columns.some(c => c.name === name));

    const toggle = (g: string) => setExcluded(prev => { const n = new Set(prev); if (n.has(g)) n.delete(g); else n.add(g); return n; });

    const add = () => {
        if (!preview || !analysis || !valid) return;
        const groupsUsed = analysis.stats.filter(s => include.has(s.group)).map(s => s.group);
        const description = `${element} censored at a common detection limit of ${fmt(level!)} ${unit} for ${groupsUsed.length} group${groupsUsed.length === 1 ? '' : 's'} of ${groupBy.join(' × ')}`;
        useAppStore.getState().applyColumnEdits({
            add: [{
                name, values: preview.values, replace: true, mapAs: element,
                derivation: {
                    kind: 'other', description, created: new Date().toISOString(),
                    params: { commonDl: { source: element, groupColumns: groupBy, groups: groupsUsed, level, unit } },
                },
            }],
        });
        useAuditStore.getState().recordAudit({
            category: 'column-operation',
            operation: 'Common detection limit',
            description,
            details: `${preview.changed.toLocaleString()} measured values below the level and ${preview.restated.toLocaleString()} below-detection values now <${fmt(level!)}; `
                + `${preview.dropped.toLocaleString()} censored at a coarser limit and ${preview.excluded.toLocaleString()} rows of other groups left blank.`,
            parameters: { level, groupColumns: groupBy, groups: groupsUsed.length },
            inputColumns: [element, ...groupBy],
            outputColumns: [name],
            rowsAffected: preview.kept,
        });
        notify(`Added ${name}: ${preview.kept.toLocaleString()} values on one scale (<${fmt(level!)} ${unit})`, 'success');
    };

    if (!assayColumns.length) return <Alert severity="info">No element columns to work with.</Alert>;
    return (
        <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
                Surveys reported with different detection limits cannot share a threshold: a value of 3 is real in one and below detection in
                another. This puts the chosen groups on one scale — everything below the coarsest limit becomes below detection — so raw
                thresholds and percentiles mean the same in every group. Values censored at a stray coarser limit are left blank.
            </Typography>
            <Stack direction="row" spacing={1.5} alignItems="flex-start" flexWrap="wrap" useFlexGap>
                <TextField select size="small" label="Element" value={element} onChange={e => { setElement(e.target.value); setLevelText(''); setNameText(''); }} sx={{ minWidth: 160 }}>
                    {assayColumns.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                </TextField>
                <GroupByFields options={groupOptions} value={groupBy} onChange={v => { setGroupBy(v); setLevelText(''); }}
                    help="limits usually change by lab batch or method" />
                {anyFloor && (
                    <TextField select size="small" label="Repeated lowest value (limit not shown)" value={floorAs}
                        onChange={e => { setFloorAs(e.target.value as FloorReading); setLevelText(''); }} sx={{ minWidth: 270 }}
                        helperText="half the limit is the safe reading">
                        <MenuItem value="half">is half the limit (½DL)</MenuItem>
                        <MenuItem value="limit">is the limit</MenuItem>
                    </TextField>
                )}
            </Stack>
            {!analysis ? <Alert severity="info">Choose a grouping column.</Alert> : (
                <>
                    <TableContainer sx={{ maxHeight: 320, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                        <Table size="small" stickyHeader>
                            <TableHead>
                                <TableRow>
                                    <TableCell padding="checkbox" />
                                    <TableCell>Group</TableCell>
                                    <TableCell align="right">Values</TableCell>
                                    <TableCell align="right">Below DL</TableCell>
                                    <TableCell>Detection limit ({unit || 'units'})</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {analysis.stats.map(s => (
                                    <TableRow key={s.group} hover selected={setBy.includes(s.group)}>
                                        <TableCell padding="checkbox"><Checkbox size="small" checked={include.has(s.group)} onChange={() => toggle(s.group)} /></TableCell>
                                        <TableCell>{s.group}</TableCell>
                                        <TableCell align="right">{s.nValues.toLocaleString()}</TableCell>
                                        <TableCell align="right">{pct(s.nBdl, s.nValues)}</TableCell>
                                        <TableCell>
                                            <Stack direction="row" spacing={0.5} alignItems="center">
                                                <span>{s.maxDl !== null ? fmt(s.maxDl) : s.assumedDl !== null ? `${fmt(s.assumedDl)} (assumed)` : 'not shown'}</span>
                                                {s.floor && (
                                                    <Tooltip title={`No value is marked below detection, but the lowest value ${fmt(s.floor.value)} repeats on ${s.floor.count.toLocaleString()} rows: `
                                                        + `it is the limit or half of it. Read as ${floorAs === 'half' ? 'half the limit (limit ' + fmt(2 * s.floor.value) + ')' : 'the limit'}.`}>
                                                        <Chip size="small" color="info" variant="outlined" label={`floor ${fmt(s.floor.value)} ×${s.floor.count}`} />
                                                    </Tooltip>
                                                )}
                                                {s.assumedDl === null && (
                                                    <Tooltip title="No value below detection and no repeated lowest value: this group's limit cannot be read from the data">
                                                        <Chip size="small" color="warning" variant="outlined" label="limit unknown" />
                                                    </Tooltip>
                                                )}
                                                {s.mixed && (
                                                    <Tooltip title={s.dls.map(d => `${fmt(d.dl)} ×${d.count}`).join(', ')}>
                                                        <Chip size="small" variant="outlined" label="several" />
                                                    </Tooltip>
                                                )}
                                                {s.strayAbove > 0 && (
                                                    <Tooltip title="Rows censored at a coarser, rare limit (re-assays): they become blank">
                                                        <Chip size="small" color="warning" variant="outlined" label={`${s.strayAbove} stray`} />
                                                    </Tooltip>
                                                )}
                                                {s.halfDl && <Chip size="small" variant="outlined" label="½DL" />}
                                                {setBy.includes(s.group) && <Chip size="small" color="primary" label="sets the level" />}
                                            </Stack>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                    <Stack direction="row" spacing={1.5} alignItems="flex-start" flexWrap="wrap" useFlexGap>
                        <TextField size="small" label={`Common limit (${unit || 'units'})`} value={levelText} placeholder={minLevel !== null ? fmt(minLevel) : ''}
                            InputLabelProps={{ shrink: true }} onChange={e => setLevelText(e.target.value)} sx={{ width: 190 }}
                            error={!!tooLow.length || (!!levelText.trim() && !(Number(levelText) > 0))}
                            helperText={tooLow.length ? `below the limit of ${tooLow.slice(0, 2).join(', ')}${tooLow.length > 2 ? '…' : ''}` : 'blank = coarsest limit of the chosen groups'} />
                        <TextField size="small" label="Column name" value={nameText} placeholder={defaultName} InputLabelProps={{ shrink: true }}
                            onChange={e => setNameText(e.target.value)} sx={{ minWidth: 220 }}
                            helperText={exists ? 'Exists: will be replaced' : ' '} FormHelperTextProps={{ sx: { color: exists ? 'warning.main' : undefined } }} />
                        <Button variant="contained" onClick={add} disabled={!preview || !name}>Add column</Button>
                    </Stack>
                    {minLevel === null && <Alert severity="info">No chosen group shows its detection limit, so there is no limit to align to. Enter a level.</Alert>}
                    {unknown.length > 0 && (
                        <Alert severity="warning">
                            {unknown.length} chosen group{unknown.length === 1 ? '' : 's'} show{unknown.length === 1 ? 's' : ''} no detection limit
                            ({unknown.slice(0, 4).join(', ')}{unknown.length > 4 ? '…' : ''}): the level cannot be checked against
                            {unknown.length === 1 ? ' it' : ' them'}. Check the lab certificates, or untick {unknown.length === 1 ? 'it' : 'them'}.
                        </Alert>
                    )}
                    {analysis.stats.some(s => s.mixed && include.has(s.group)) && (
                        <Typography variant="caption" color="text.secondary" component="div">
                            Groups marked “several” hold more than one limit: grouping by lab batch (instead of method) usually separates them,
                            so fewer values are censored.
                        </Typography>
                    )}
                    {setBy.length > 0 && !levelText.trim() && (
                        <Typography variant="caption" color="text.secondary">
                            The level is set by {setBy.join(', ')}. Untick a group with a coarse limit to keep more detail in the others.
                        </Typography>
                    )}
                    {preview && (
                        <Box data-testid="common-dl-preview">
                            <Typography variant="body2">
                                {preview.kept.toLocaleString()} values on one scale: {preview.changed.toLocaleString()} measured values and{' '}
                                {preview.restated.toLocaleString()} below-detection values become &lt;{fmt(level!)} {unit}
                                {preview.dropped ? `; ${preview.dropped.toLocaleString()} censored at a coarser limit left blank` : ''}
                                {preview.excluded ? `; ${preview.excluded.toLocaleString()} values of unticked groups left blank` : ''}.
                            </Typography>
                        </Box>
                    )}
                </>
            )}
        </Stack>
    );
};
