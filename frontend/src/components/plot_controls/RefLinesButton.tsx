/**
 * Reference ratio lines for XY plots (pyrite Fe:S, calcite Ca:C, V/Sc = 7,
 * Zr/Hf = 36, or a custom y = k x). A line shows on the panels whose axes
 * are its two elements, converted to the plotted columns' units.
 */
import React, { useState } from 'react';
import {
    Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel,
    IconButton, TextField, Tooltip, Typography,
} from '@mui/material';
import { Timeline, Delete } from '@mui/icons-material';
import { REF_LINE_PRESETS, type RefLine } from '../../utils/scatterOverlays';

export const RefLinesButton: React.FC<{ value: RefLine[]; onChange: (lines: RefLine[]) => void }> = ({ value, onChange }) => {
    const [open, setOpen] = useState(false);
    const [custom, setCustom] = useState<RefLine>({ label: '', num: '', den: '', ratio: 1, molar: false });
    const has = (l: RefLine) => value.some(v => v.label === l.label);
    const toggle = (l: RefLine) => onChange(has(l) ? value.filter(v => v.label !== l.label) : [...value, l]);
    const addCustom = () => {
        const isValue = custom.kind === 'value';
        if (!Number.isFinite(custom.ratio) || (!isValue && !(custom.ratio > 0))) return;
        const label = custom.label.trim()
            || (isValue ? `${custom.num?.trim() || 'y'} = ${custom.ratio}`
                : custom.num && custom.den ? `${custom.num}/${custom.den} = ${custom.ratio}${custom.molar ? ' (molar)' : ''}` : `y = ${custom.ratio}x`);
        onChange([...value.filter(v => v.label !== label), { ...custom, label, num: custom.num?.trim() || undefined, den: custom.den?.trim() || undefined }]);
        setCustom({ label: '', num: '', den: '', ratio: 1, molar: false });
    };
    const customLines = value.filter(v => !REF_LINE_PRESETS.some(p => p.label === v.label));

    return (
        <>
            <Tooltip title="Reference lines (mineral and element ratios)">
                <IconButton size="small" color={value.length ? 'primary' : 'default'} aria-label="Reference lines" onClick={() => setOpen(true)}>
                    <Timeline fontSize="small" />
                </IconButton>
            </Tooltip>
            <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
                <DialogTitle>Reference lines</DialogTitle>
                <DialogContent dividers>
                    <Typography variant="caption" color="text.secondary">
                        Shown on panels plotting the two elements, in the columns' units.
                    </Typography>
                    {REF_LINE_PRESETS.map(l => (
                        <FormControlLabel key={l.label} sx={{ display: 'flex' }}
                            control={<Checkbox size="small" checked={has(l)} onChange={() => toggle(l)} />}
                            label={<Typography variant="body2">{l.label}</Typography>} />
                    ))}
                    {customLines.map(l => (
                        <Box key={l.label} sx={{ display: 'flex', alignItems: 'center' }}>
                            <Typography variant="body2" sx={{ flex: 1 }}>{l.label}</Typography>
                            <IconButton size="small" aria-label={`Remove ${l.label}`} onClick={() => onChange(value.filter(v => v.label !== l.label))}><Delete fontSize="small" /></IconButton>
                        </Box>
                    ))}
                    <Typography variant="subtitle2" sx={{ mt: 2 }}>Custom line</Typography>
                    <FormControlLabel control={<Checkbox size="small" checked={custom.kind === 'value'} onChange={e => setCustom({ ...custom, kind: e.target.checked ? 'value' : 'ratio' })} />}
                        label={<Typography variant="body2">Constant value (e.g. Sr/Y = 40, Ba = 1000)</Typography>} />
                    {custom.kind === 'value' ? (
                        <Box sx={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 1, mt: 1 }}>
                            <TextField size="small" label="Column" placeholder="e.g. Sr/Y (blank = every Y)" value={custom.num} onChange={e => setCustom({ ...custom, num: e.target.value })} />
                            <TextField size="small" label="Value" type="number" value={custom.ratio} onChange={e => setCustom({ ...custom, ratio: Number(e.target.value) })} />
                        </Box>
                    ) : (
                        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1, mt: 1 }}>
                            <TextField size="small" label="Numerator" placeholder="e.g. S" value={custom.num} onChange={e => setCustom({ ...custom, num: e.target.value })} />
                            <TextField size="small" label="Denominator" placeholder="e.g. Fe" value={custom.den} onChange={e => setCustom({ ...custom, den: e.target.value })} />
                            <TextField size="small" label="Ratio" type="number" value={custom.ratio} onChange={e => setCustom({ ...custom, ratio: Number(e.target.value) })} />
                        </Box>
                    )}
                    <TextField size="small" fullWidth sx={{ mt: 1 }} label="Label (optional)" value={custom.label} onChange={e => setCustom({ ...custom, label: e.target.value })} />
                    {custom.kind !== 'value' && <FormControlLabel control={<Checkbox size="small" checked={custom.molar} onChange={e => setCustom({ ...custom, molar: e.target.checked })} />}
                        label={<Typography variant="body2">Molar ratio</Typography>} />}
                    <Typography variant="caption" color="text.secondary" component="div">
                        Leave the elements blank for y = ratio × x on every panel.
                    </Typography>
                    <Button size="small" sx={{ mt: 1 }} onClick={addCustom}>Add line</Button>
                </DialogContent>
                <DialogActions>
                    {value.length > 0 && <Button onClick={() => onChange([])}>Clear all</Button>}
                    <Button onClick={() => setOpen(false)}>Close</Button>
                </DialogActions>
            </Dialog>
        </>
    );
};
