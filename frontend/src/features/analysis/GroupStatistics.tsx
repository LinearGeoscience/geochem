/**
 * Summary statistics by colour group (the reference software: Summary Statistics, split by
 * colour attribute). One statistic per group and variable over the visible
 * rows; copy as CSV, or save each group's medians as User nodes to show on
 * any plot's Mineral and rock nodes.
 */
import React, { useMemo, useState } from 'react';
import {
    Box, Button, FormControl, InputLabel, MenuItem, Paper, Select, Table, TableBody, TableCell, TableContainer,
    TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import { Download, Diamond } from '@mui/icons-material';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../store/appStore';
import { useAttributeStore } from '../../store/attributeStore';
import { useUserNodeStore } from '../../store/userNodeStore';
import { notify } from '../../store/notificationStore';
import { attributeColumnValues, getStyleArraysColumnar } from '../../utils/attributeUtils';
import { GROUP_STAT_LABELS, GroupStat, groupStatistics, groupStatsCsv } from '../../utils/groupStatistics';
import { makeUserNode } from '../../utils/nodeLibrary';
import { useStyleInputs } from '../../hooks/useStyleInputs';

const fmt = (v: number | null) => (v == null ? '' : Math.abs(v) >= 1000 || Math.abs(v) < 0.01 ? v.toPrecision(3) : +v.toFixed(3));

export const GroupStatistics: React.FC<{ columns: string[] }> = ({ columns }) => {
    const rowCount = useAppStore(s => s.columnarData.rowCount);
    const { getColumn, getRawColumn, geochemMappings } = useAppStore(useShallow(s => ({
        getColumn: s.getColumn, getRawColumn: s.getRawColumn, geochemMappings: s.geochemMappings,
    })));
    const attr = useStyleInputs();
    const [stat, setStat] = useState<GroupStat>('median');
    const [nodeGroup, setNodeGroup] = useState('');

    const table = useMemo(() => {
        void attr;
        if (!rowCount || !columns.length) return null;
        const style = getStyleArraysColumnar(rowCount, n => getColumn(n));
        const visible: number[] = [];
        for (let i = 0; i < rowCount; i++) if (style.visible[i]) visible.push(i);
        const names = attributeColumnValues('color', rowCount, n => getRawColumn(n));
        const order = [...useAttributeStore.getState().color.entries, ...useAttributeStore.getState().customEntries].map(e => e.name);
        const cols = columns.map(name => ({ name, values: (getColumn(name) ?? []) as ArrayLike<number | null> }));
        return groupStatistics(visible, r => names[r] ?? '', cols, stat, order);
    }, [rowCount, columns, stat, getColumn, getRawColumn, attr]);

    const colourOf = useMemo(() => {
        const m = new Map<string, string>();
        for (const e of [...attr.color.entries, ...attr.customEntries]) if (e.color && !m.has(e.name)) m.set(e.name, e.color);
        return m;
    }, [attr]);

    if (!columns.length) return null;

    const download = () => {
        if (!table) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([groupStatsCsv(table, columns, stat)], { type: 'text/csv' }));
        a.download = `group_${stat}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    const saveNodes = () => {
        if (!table) return;
        const group = nodeGroup.trim() || `${attr.color.field ?? 'Colour'} ${stat}s`;
        const nodes = table.groups.map((g, i) => makeUserNode(
            g.name, group, Object.fromEntries(columns.map((c, k) => [c, table.values[i][k] ?? NaN])), geochemMappings,
        )).filter(n => Object.keys(n.values ?? {}).length);
        if (!nodes.length) { notify('None of the variables is an element or oxide, so no nodes were made', 'warning'); return; }
        useUserNodeStore.getState().addNodes(nodes);
        notify(`Saved ${nodes.length} user nodes in "${group}" (Mineral and rock nodes › User)`, 'success');
    };

    return (
        <Box sx={{ mt: 4 }} data-testid="group-statistics">
            <Typography variant="h6" gutterBottom>By colour group</Typography>
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap', mb: 1.5 }}>
                <FormControl size="small" sx={{ minWidth: 170 }}>
                    <InputLabel>Statistic</InputLabel>
                    <Select value={stat} label="Statistic" onChange={e => setStat(e.target.value as GroupStat)}>
                        {(Object.keys(GROUP_STAT_LABELS) as GroupStat[]).map(k => <MenuItem key={k} value={k}>{GROUP_STAT_LABELS[k]}</MenuItem>)}
                    </Select>
                </FormControl>
                <Button size="small" startIcon={<Download />} onClick={download} disabled={!table?.groups.length}>CSV</Button>
                <TextField size="small" label="Node set name" placeholder={`${attr.color.field ?? 'Colour'} ${stat}s`} value={nodeGroup} onChange={e => setNodeGroup(e.target.value)} sx={{ width: 200 }} />
                <Tooltip title="Save each group's values as a User node (element and oxide columns), to plot on XY, ternary and diagrams">
                    <span>
                        <Button size="small" variant="outlined" startIcon={<Diamond />} onClick={saveNodes} disabled={!table?.groups.length}>Save as user nodes</Button>
                    </span>
                </Tooltip>
            </Box>
            {!table?.groups.length ? (
                <Typography variant="body2" color="text.secondary">
                    No colour groups among the visible rows. Colour the data in the Attribute Manager (e.g. Auto-Attribute on a lithology column).
                </Typography>
            ) : (
                <TableContainer component={Paper} sx={{ maxHeight: 480 }}>
                    <Table size="small" stickyHeader>
                        <TableHead>
                            <TableRow>
                                <TableCell><strong>Group</strong></TableCell>
                                <TableCell align="right"><strong>n</strong></TableCell>
                                {columns.map(c => <TableCell key={c} align="right"><strong>{c}</strong></TableCell>)}
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {table.groups.map((g, i) => (
                                <TableRow key={g.name}>
                                    <TableCell>
                                        <Box component="span" sx={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', mr: 1, bgcolor: colourOf.get(g.name) ?? 'grey.500' }} />
                                        {g.name}
                                    </TableCell>
                                    <TableCell align="right">{g.n}</TableCell>
                                    {table.values[i].map((v, k) => <TableCell key={columns[k]} align="right">{fmt(v)}</TableCell>)}
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            )}
        </Box>
    );
};
