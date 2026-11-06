/**
 * "Plot" menu for elements picked on a ranked eigenvector plot: opens a new
 * spider / probability / histogram / scatter-matrix plot of them (raw element
 * columns or the PCA inputs) and keeps the list in the variable selection
 * history so any column picker's History can reuse it.
 */
import React, { useState } from 'react';
import { Button, Menu, MenuItem, ListItemIcon, ListItemText, Divider, ToggleButton, ToggleButtonGroup, Box, Typography } from '@mui/material';
import { ShowChart, History } from '@mui/icons-material';
import { useAppStore, PLOT_TYPE_LABEL, type PlotType } from '../../../store/appStore';
import { useVariableSelectionStore } from '../../../store/variableSelectionStore';
import type { FullPCAResult } from '../../../types/compositional';
import { columnsForElements, sideOf } from './pcaElementPicks';
import { ELEMENT_PLOTS } from './elementPlots';


interface Props {
    result: FullPCAResult;
    componentIndex: number;
    /** Picked element labels, in plot order */
    labels: string[];
    onDone: (message: string, openPlots: boolean) => void;
}

export const PlotElementsMenu: React.FC<Props> = ({ result, componentIndex, labels, onDone }) => {
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const [source, setSource] = useState<'raw' | 'inputs'>('raw');
    const mappings = useAppStore(s => s.geochemMappings);

    const side = sideOf(result, componentIndex, labels);
    const name = `PC${componentIndex + 1}${side === 'positive' ? '+' : '−'} ${labels.join('-')}`;
    const columns = () => columnsForElements(result, labels, mappings, source);

    const plot = (type: PlotType, key: string) => {
        const cols = columns();
        useVariableSelectionStore.getState().push(cols, name);
        const title = `${PLOT_TYPE_LABEL[type]} PC${componentIndex + 1}${side === 'positive' ? '+' : '−'}`;
        useAppStore.getState().addPlot(type, { settings: { [key]: cols }, title });
        setAnchor(null);
        onDone(`${title}: ${cols.length} columns`, true);
    };

    const remember = () => {
        useVariableSelectionStore.getState().push(columns(), name);
        setAnchor(null);
        onDone(`Saved to the variable selection history as “${name}”`, false);
    };

    return (
        <>
            <Button size="small" variant="contained" startIcon={<ShowChart />} onClick={e => setAnchor(e.currentTarget)}>
                Plot
            </Button>
            <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
                <Box sx={{ px: 2, pt: 0.5, pb: 1 }}>
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>Columns</Typography>
                    <ToggleButtonGroup size="small" exclusive value={source} onChange={(_, v) => v && setSource(v)}>
                        <ToggleButton value="raw">Raw elements</ToggleButton>
                        <ToggleButton value="inputs">PCA inputs</ToggleButton>
                    </ToggleButtonGroup>
                </Box>
                <Divider />
                {ELEMENT_PLOTS.map(p => (
                    <MenuItem key={p.type} onClick={() => plot(p.type, p.key)}>
                        <ListItemIcon>{p.icon}</ListItemIcon>
                        <ListItemText>New {PLOT_TYPE_LABEL[p.type].toLowerCase()} plot</ListItemText>
                    </MenuItem>
                ))}
                <Divider />
                <MenuItem onClick={remember}>
                    <ListItemIcon><History fontSize="small" /></ListItemIcon>
                    <ListItemText primary="Save to variable history" secondary="Pick it from History in any plot" />
                </MenuItem>
            </Menu>
        </>
    );
};
