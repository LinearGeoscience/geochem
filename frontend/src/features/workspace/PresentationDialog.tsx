/**
 * Graph properties for one plot (the reference software: title, axis labels, axis ranges,
 * font size, legend, background) and figure export (SVG / PNG of every
 * chart in the plot). Edits apply live and are saved with the plot.
 */
import React from 'react';
import {
    Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, FormControlLabel,
    InputLabel, MenuItem, Select, TextField, Typography,
} from '@mui/material';
import { usePlotSetting } from '../../hooks/usePlotSetting';
import { Presentation } from '../../utils/plotPresentation';
import { exportPlotImages } from '../../utils/plotExport';
import { notify } from '../../store/notificationStore';

const num = (s: string): number | null => (s.trim() === '' || !Number.isFinite(Number(s)) ? null : Number(s));

export const PresentationDialog: React.FC<{ plotId: string; open: boolean; onClose: () => void }> = ({ plotId, open, onClose }) => {
    const [p, setP] = usePlotSetting<Presentation>(plotId, 'presentation', {});
    const set = (patch: Partial<Presentation>) => setP(prev => ({ ...prev, ...patch }));
    const rangeField = (axis: 'xRange' | 'yRange', k: 0 | 1, label: string) => (
        <TextField
            size="small" type="number" label={label} sx={{ width: 110 }}
            value={p[axis]?.[k] ?? ''}
            onChange={(e) => {
                const r: [number | null, number | null] = [...(p[axis] ?? [null, null])] as [number | null, number | null];
                r[k] = num(e.target.value);
                set({ [axis]: r });
            }}
        />
    );
    const exportAs = (format: 'svg' | 'png') => {
        const n = exportPlotImages(plotId, format);
        if (!n) notify('No chart to export in this plot', 'warning');
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
            <DialogTitle>Graph properties</DialogTitle>
            <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Typography variant="caption" color="text.secondary">Blank fields keep the plot's own values. Applies to every chart in this plot.</Typography>
                <TextField size="small" label="Title" value={p.title ?? ''} onChange={e => set({ title: e.target.value })} />
                <TextField size="small" label="X axis label" value={p.xTitle ?? ''} onChange={e => set({ xTitle: e.target.value })} />
                <TextField size="small" label="Y axis label" value={p.yTitle ?? ''} onChange={e => set({ yTitle: e.target.value })} />
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                    <Typography variant="body2" sx={{ width: 50 }}>X range</Typography>
                    {rangeField('xRange', 0, 'Min')}{rangeField('xRange', 1, 'Max')}
                </Box>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                    <Typography variant="body2" sx={{ width: 50 }}>Y range</Typography>
                    {rangeField('yRange', 0, 'Min')}{rangeField('yRange', 1, 'Max')}
                </Box>
                <Box sx={{ display: 'flex', gap: 1 }}>
                    <TextField size="small" type="number" label="Font size" sx={{ width: 110 }} value={p.fontSize ?? ''}
                        onChange={e => set({ fontSize: num(e.target.value) ?? undefined })} />
                    <FormControl size="small" sx={{ minWidth: 140 }}>
                        <InputLabel>Legend</InputLabel>
                        <Select label="Legend" value={p.legend ?? 'auto'} onChange={e => set({ legend: e.target.value as Presentation['legend'] })}>
                            <MenuItem value="auto">As plotted</MenuItem>
                            <MenuItem value="right">Right</MenuItem>
                            <MenuItem value="bottom">Bottom</MenuItem>
                            <MenuItem value="hide">Hidden</MenuItem>
                        </Select>
                    </FormControl>
                </Box>
                <FormControlLabel control={<Checkbox size="small" checked={!!p.whiteBackground} onChange={e => set({ whiteBackground: e.target.checked })} />}
                    label={<Typography variant="body2">White background (figures)</Typography>} />
            </DialogContent>
            <DialogActions>
                <Button onClick={() => setP({})}>Reset</Button>
                <Box sx={{ flex: 1 }} />
                <Button onClick={() => exportAs('svg')}>Export SVG</Button>
                <Button onClick={() => exportAs('png')}>Export PNG</Button>
                <Button variant="contained" onClick={onClose}>Done</Button>
            </DialogActions>
        </Dialog>
    );
};
