/**
 * Every PC end as an element group (|loading| >= threshold): tick any number
 * of them, open plots of their elements (one per group or all combined), keep
 * them in the variable selection history, and colour the samples by the
 * matching score column (PCn for the + end, negPCn for the − end).
 */
import React, { useMemo, useState } from 'react';
import {
    Box, Button, Checkbox, Chip, Divider, FormControlLabel, ListItemIcon, ListItemText, Menu, MenuItem,
    Paper, Snackbar, Alert, Switch, Table, TableBody, TableCell, TableHead, TableRow, ToggleButton,
    ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import { ShowChart, History, Palette } from '@mui/icons-material';
import { useAppStore, PLOT_TYPE_LABEL, type PlotType } from '../../../store/appStore';
import { useVariableSelectionStore } from '../../../store/variableSelectionStore';
import type { FullPCAResult } from '../../../types/compositional';
import { columnsForElements, endElements, PcEnd } from './pcaElementPicks';
import { ELEMENT_PLOTS } from './elementPlots';
import { colourByPcScore, scoreColumn } from './pcScoreColour';
import { BuildIndexDialog } from './BuildIndexDialog';

interface EndGroup {
    id: string;
    componentIndex: number;
    side: PcEnd;
    label: string;      // "PC1−"
    elements: string[]; // from the end inward
}

export const PcEndGroups: React.FC<{ pcaResult: FullPCAResult; nComponents: number; threshold: number }> = ({
    pcaResult, nComponents, threshold,
}) => {
    const mappings = useAppStore(s => s.geochemMappings);
    const columnNames = useAppStore(s => s.columns);
    const groups = useMemo<EndGroup[]>(() => {
        const out: EndGroup[] = [];
        for (let i = 0; i < nComponents; i++) {
            for (const side of ['positive', 'negative'] as PcEnd[]) {
                const elements = endElements(pcaResult, i, side, threshold);
                if (elements.length) {
                    const label = `PC${i + 1}${side === 'positive' ? '+' : '−'}`;
                    out.push({ id: label, componentIndex: i, side, label, elements });
                }
            }
        }
        return out;
    }, [pcaResult, nComponents, threshold]);

    const [ticked, setTicked] = useState<Set<string>>(new Set());
    const [source, setSource] = useState<'raw' | 'inputs'>('raw');
    const [combine, setCombine] = useState(false);
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const [snack, setSnack] = useState<{ message: string; ok: boolean; showPlots?: boolean } | null>(null);
    const [indexGroup, setIndexGroup] = useState<EndGroup | null>(null);

    const chosen = groups.filter(g => ticked.has(g.id));
    const toggle = (id: string) => setTicked(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });
    const nameOf = (g: EndGroup) => `${g.label} ${g.elements.join('-')}`;
    const colsOf = (g: EndGroup) => columnsForElements(pcaResult, g.elements, mappings, source);

    const plot = (type: PlotType, key: string) => {
        setAnchor(null);
        const history = useVariableSelectionStore.getState();
        const app = useAppStore.getState();
        if (combine) {
            const cols = [...new Set(chosen.flatMap(colsOf))];
            const label = chosen.map(g => g.label).join(' ');
            history.push(cols, `${label} ${chosen.flatMap(g => g.elements).join('-')}`);
            app.addPlot(type, { settings: { [key]: cols }, title: `${PLOT_TYPE_LABEL[type]} ${label}` });
            setSnack({ message: `${PLOT_TYPE_LABEL[type]} ${label}: ${cols.length} columns`, ok: true, showPlots: true });
            return;
        }
        for (const g of chosen) {
            const cols = colsOf(g);
            history.push(cols, nameOf(g));
            app.addPlot(type, { settings: { [key]: cols }, title: `${PLOT_TYPE_LABEL[type]} ${g.label}` });
        }
        setSnack({ message: `${chosen.length} ${PLOT_TYPE_LABEL[type].toLowerCase()} plot${chosen.length > 1 ? 's' : ''}: ${chosen.map(g => g.label).join(', ')}`, ok: true, showPlots: true });
    };

    const remember = () => {
        const history = useVariableSelectionStore.getState();
        // Oldest first, so the list reads PC1 first at the top of History
        for (const g of [...chosen].reverse()) history.push(colsOf(g), nameOf(g));
        setSnack({ message: `${chosen.length} group${chosen.length > 1 ? 's' : ''} saved to the variable selection history`, ok: true });
    };

    const colour = (g: EndGroup) => {
        const r = colourByPcScore(g.componentIndex, g.side);
        setSnack({ message: r.message, ok: r.ok });
    };

    if (!groups.length) {
        return (
            <Alert severity="info" sx={{ mb: 2 }}>No element has |loading| ≥ {threshold} on the plotted PCs. Lower the threshold.</Alert>
        );
    }

    return (
        <Paper variant="outlined" sx={{ p: 1.5, mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1 }}>
                <Typography variant="subtitle2" sx={{ mr: 1 }}>End groups (|loading| ≥ {threshold})</Typography>
                <Button size="small" onClick={() => setTicked(new Set(groups.map(g => g.id)))}>Tick all</Button>
                <Button size="small" onClick={() => setTicked(new Set())} disabled={!ticked.size}>Clear</Button>
                <Box sx={{ flex: 1 }} />
                <ToggleButtonGroup size="small" exclusive value={source} onChange={(_, v) => v && setSource(v)}>
                    <ToggleButton value="raw">Raw elements</ToggleButton>
                    <ToggleButton value="inputs">PCA inputs</ToggleButton>
                </ToggleButtonGroup>
                <Button size="small" variant="contained" startIcon={<ShowChart />} disabled={!chosen.length} onClick={e => setAnchor(e.currentTarget)}>
                    Plot ticked ({chosen.length})
                </Button>
                <Button size="small" variant="outlined" startIcon={<History />} disabled={!chosen.length} onClick={remember}>
                    Save ticked to History
                </Button>
            </Box>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                A group is a set of elements (columns). Samples are sorted out by their score: colour by PCn for a + end
                or negPCn for a − end and the top class holds the samples where that group is strongest. Plot the group
                coloured that way to see it.
            </Typography>
            <Table size="small">
                <TableHead>
                    <TableRow>
                        <TableCell padding="checkbox" />
                        <TableCell>End</TableCell>
                        <TableCell>Elements (end inward)</TableCell>
                        <TableCell>Samples by</TableCell>
                        <TableCell>Index</TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {groups.map(g => {
                        const score = scoreColumn(g.componentIndex, g.side);
                        const hasScore = columnNames.some(c => c.name === score);
                        return (
                            <TableRow key={g.id} hover selected={ticked.has(g.id)} onClick={() => toggle(g.id)} sx={{ cursor: 'pointer' }}>
                                <TableCell padding="checkbox"><Checkbox size="small" checked={ticked.has(g.id)} /></TableCell>
                                <TableCell>
                                    <Chip size="small" label={g.label} color={g.side === 'positive' ? 'success' : 'error'} variant="outlined" />
                                </TableCell>
                                <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                                    {g.elements.join('-')} <Typography component="span" variant="caption" color="text.secondary">({g.elements.length})</Typography>
                                </TableCell>
                                <TableCell onClick={e => e.stopPropagation()}>
                                    <Tooltip title={hasScore ? `Colour samples by ${score} (quantile classes)` : `Adds the PC scores, then colours samples by ${score}`}>
                                        <Button size="small" startIcon={<Palette fontSize="small" />} onClick={() => colour(g)}>
                                            {score}
                                        </Button>
                                    </Tooltip>
                                </TableCell>
                                <TableCell onClick={e => e.stopPropagation()}>
                                    <Tooltip title="Add an additive index column (Σ CLR or Σ log10) of this group">
                                        <Button size="small" onClick={() => setIndexGroup(g)}>Build</Button>
                                    </Tooltip>
                                </TableCell>
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>

            <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
                <Box sx={{ px: 2, py: 0.5 }}>
                    <FormControlLabel
                        control={<Switch size="small" checked={combine} onChange={e => setCombine(e.target.checked)} />}
                        label={<Typography variant="body2">{combine ? 'One plot of all ticked elements' : 'One plot per group'}</Typography>}
                    />
                </Box>
                <Divider />
                {ELEMENT_PLOTS.map(p => (
                    <MenuItem key={p.type} onClick={() => plot(p.type, p.key)}>
                        <ListItemIcon>{p.icon}</ListItemIcon>
                        <ListItemText>New {PLOT_TYPE_LABEL[p.type].toLowerCase()} plot{combine || chosen.length < 2 ? '' : 's'}</ListItemText>
                    </MenuItem>
                ))}
            </Menu>

            {indexGroup && (
                <BuildIndexDialog
                    open
                    onClose={() => setIndexGroup(null)}
                    result={pcaResult}
                    labels={indexGroup.elements}
                    source={indexGroup.label}
                />
            )}

            <Snackbar open={!!snack} autoHideDuration={5000} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
                <Alert
                    severity={snack?.ok ? 'success' : 'warning'}
                    variant="filled"
                    onClose={() => setSnack(null)}
                    action={snack?.showPlots && useAppStore.getState().currentView !== 'plots' ? (
                        <Button color="inherit" size="small" onClick={() => { useAppStore.getState().setCurrentView('plots'); setSnack(null); }}>Show</Button>
                    ) : undefined}
                >
                    {snack?.message}
                </Alert>
            </Snackbar>
        </Paper>
    );
};
