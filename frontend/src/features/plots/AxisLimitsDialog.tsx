/**
 * Fixed axis limits for a scatter plot, saved with the plot and the project
 * ("locked" axes in the reference software). Empty = autoscale that end. Points beyond the limits
 * are counted in each chart title.
 */
import React, { useEffect, useState } from 'react';
import {
    Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, TextField, Typography,
} from '@mui/material';
import { parseLimit, type AxisLimits } from '../../utils/axisLimits';

interface Props {
    open: boolean;
    onClose: () => void;
    xLabel: string;
    yAxes: { name: string; label: string }[];
    xLimits: AxisLimits | null;
    yLimits: Record<string, AxisLimits>;
    onApply: (x: AxisLimits | null, y: Record<string, AxisLimits>) => void;
    /** Ranges of the charts the user zoomed or panned (data units) */
    currentView?: () => { x: AxisLimits | null; y: Record<string, AxisLimits> };
}

const txt = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(+v.toPrecision(4)));
type Pair = [string, string];

export const AxisLimitsDialog: React.FC<Props> = ({ open, onClose, xLabel, yAxes, xLimits, yLimits, onApply, currentView }) => {
    const [x, setX] = useState<Pair>(['', '']);
    const [ys, setYs] = useState<Record<string, Pair>>({});
    const [same, setSame] = useState(false);
    useEffect(() => {
        if (!open) return;
        setX([txt(xLimits?.[0]), txt(xLimits?.[1])]);
        setYs(Object.fromEntries(yAxes.map(a => [a.name, [txt(yLimits[a.name]?.[0]), txt(yLimits[a.name]?.[1])] as Pair])));
        setSame(false);
    }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

    const toLimits = (p: Pair): AxisLimits | null => {
        const l: AxisLimits = [parseLimit(p[0]), parseLimit(p[1])];
        return l[0] === null && l[1] === null ? null : l;
    };
    const apply = () => {
        const y: Record<string, AxisLimits> = {};
        const first = yAxes[0] ? ys[yAxes[0].name] : undefined;
        for (const a of yAxes) {
            const l = toLimits(same && first ? first : ys[a.name] ?? ['', '']);
            if (l) y[a.name] = l;
        }
        onApply(toLimits(x), y);
        onClose();
    };
    const view = open && currentView ? currentView() : null;
    const hasView = !!view && (!!view.x || Object.keys(view.y).length > 0);
    const useView = () => {
        if (!view) return;
        if (view.x) setX([txt(view.x[0]), txt(view.x[1])]);
        setYs(s => ({ ...s, ...Object.fromEntries(Object.entries(view.y).map(([k, l]) => [k, [txt(l[0]), txt(l[1])] as Pair])) }));
    };
    const row = (label: string, p: Pair, set: (p: Pair) => void, disabled = false) => (
        <Box key={label} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="body2" sx={{ width: 140, flexShrink: 0 }} noWrap title={label}>{label}</Typography>
            <TextField size="small" label="Min" value={p[0]} disabled={disabled} onChange={(e) => set([e.target.value, p[1]])} sx={{ width: 120 }} />
            <TextField size="small" label="Max" value={p[1]} disabled={disabled} onChange={(e) => set([p[0], e.target.value])} sx={{ width: 120 }} />
        </Box>
    );

    return (
        <Dialog open={open} onClose={onClose}>
            <DialogTitle>Axis limits</DialogTitle>
            <DialogContent>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Saved with the plot. Leave a box empty to autoscale that end. Points beyond the limits are counted in the chart title.
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
                    {row(`X: ${xLabel}`, x, setX)}
                    {yAxes.length > 1 && (
                        <FormControlLabel control={<Checkbox size="small" checked={same} onChange={(e) => setSame(e.target.checked)} />}
                            label={<Typography variant="body2">Same Y limits for every chart (from the first)</Typography>} />
                    )}
                    {yAxes.map((a, i) => row(`Y: ${a.label}`, ys[a.name] ?? ['', ''], (p) => setYs(s => ({ ...s, [a.name]: p })), same && i > 0))}
                </Box>
            </DialogContent>
            <DialogActions>
                <Button disabled={!hasView} onClick={useView} title="Fill the boxes from charts you have zoomed or panned">Use current zoom</Button>
                <Button onClick={() => { onApply(null, {}); onClose(); }}>Clear all</Button>
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="contained" onClick={apply}>Apply</Button>
            </DialogActions>
        </Dialog>
    );
};
