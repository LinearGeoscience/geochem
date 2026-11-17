/**
 * Display settings that apply on top of the classes: global opacity, the
 * value filter and high-grade emphasis. Collapsed by default with a one-line
 * summary of what is on. Sliders show their value while dragging and commit
 * on release (one undo step, one redraw of the plots).
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
    Box, Checkbox, Collapse, FormControlLabel, IconButton, MenuItem, Select, Slider, Switch, TextField,
    ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import { ExpandLess, ExpandMore, RestartAlt } from '@mui/icons-material';
import { useShallow } from 'zustand/react/shallow';
import { EmphasisMode, useAttributeStore } from '../../store/attributeStore';
import { useAppStore, useAnalyticalStore } from '../../store/appStore';
import { useUIStore } from '../../store/uiStore';
import { formatBreak } from '../../store/attributeStore';
import { isNumericColumn } from '../../types/columnarData';

/** Slider that keeps its own value while dragging and commits on release */
const CommitSlider: React.FC<{
    value: number; min: number; max: number; step: number; label: string;
    format: (v: number) => string; onCommit: (v: number) => void; disabled?: boolean;
}> = ({ value, min, max, step, label, format, onCommit, disabled }) => {
    const [v, setV] = useState(value);
    useEffect(() => setV(value), [value]);
    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {label && <Typography variant="caption" sx={{ width: 92, flexShrink: 0 }} noWrap>{label}</Typography>}
            <Slider
                size="small" min={min} max={max} step={step} value={v} disabled={disabled}
                onChange={(_, x) => setV(x as number)}
                onChangeCommitted={(_, x) => onCommit(x as number)}
                aria-label={label}
            />
            <Typography variant="caption" sx={{ width: 38, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{format(v)}</Typography>
        </Box>
    );
};

/** Number box that commits on blur / Enter (not on every keystroke) */
const CommitNumber: React.FC<{ label: string; value: number | null; onCommit: (v: number | null) => void }> = ({ label, value, onCommit }) => {
    const [text, setText] = useState(value === null ? '' : formatBreak(value));
    useEffect(() => setText(value === null ? '' : formatBreak(value)), [value]);
    const commit = () => {
        const t = text.trim();
        const v = t === '' ? null : Number(t);
        if (v === null || Number.isFinite(v)) { if (v !== value) onCommit(v); }
        else setText(value === null ? '' : formatBreak(value));
    };
    return (
        <TextField
            size="small" label={label} value={text} placeholder="none"
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
            inputProps={{ inputMode: 'decimal', style: { fontSize: '0.75rem', padding: '4px 8px' } }}
            InputLabelProps={{ shrink: true }}
            sx={{ flex: 1 }}
        />
    );
};

export const DisplaySettings: React.FC = () => {
    const open = useUIStore(s => s.displayOpen);
    const setOpen = useUIStore(s => s.setDisplayOpen);
    const columns = useAppStore(s => s.columns);
    const analytical = useAnalyticalStore();
    const a = useAttributeStore(useShallow(s => ({
        globalOpacity: s.globalOpacity, valueFilter: s.valueFilter, emphasis: s.emphasis, colourField: s.color.field,
        hasColourClasses: s.color.entries.some(e => !e.isDefault),
    })));
    const store = () => useAttributeStore.getState();
    const numeric = useMemo(
        () => columns.filter(c => c.type === 'numeric' || c.type === 'float' || c.type === 'integer'),
        [columns],
    );

    const vf = a.valueFilter;
    const vfColumn = vf.column || a.colourField;
    // Range and in-range count straight from the cached analytical column
    const vfStats = useMemo(() => {
        const col = vfColumn ? analytical.columns.get(vfColumn) : undefined;
        if (!col || !isNumericColumn(col)) return null;
        let lo = Infinity, hi = -Infinity, total = 0, inRange = 0;
        for (let i = 0; i < col.length; i++) {
            const v = col[i];
            if (!Number.isFinite(v)) continue;
            total++;
            if (v < lo) lo = v;
            if (v > hi) hi = v;
            if ((vf.min === null || v >= vf.min) && (vf.max === null || v <= vf.max)) inRange++;
        }
        return total ? { lo, hi, total, inRange } : null;
    }, [analytical, vfColumn, vf.min, vf.max]);

    const [range, setRange] = useState<[number, number]>([0, 1]);
    useEffect(() => {
        if (vfStats) setRange([vf.min ?? vfStats.lo, vf.max ?? vfStats.hi]);
    }, [vfStats, vf.min, vf.max]);

    const em = a.emphasis;
    const on: string[] = [];
    if (a.globalOpacity < 1) on.push(`opacity ${Math.round(a.globalOpacity * 100)}%`);
    if (vf.enabled) on.push(vfStats ? `filter ${vfStats.inRange.toLocaleString()}/${vfStats.total.toLocaleString()}` : 'filter');
    if (em.enabled) on.push('emphasis');

    return (
        <Box sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
            <Box
                onClick={() => setOpen(!open)}
                sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, height: 26, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
            >
                <Typography variant="caption" fontWeight={600}>Display</Typography>
                <Typography variant="caption" color={on.length ? 'primary' : 'text.secondary'} noWrap sx={{ flex: 1, minWidth: 0 }}>
                    {on.length ? `· ${on.join(' · ')}` : ''}
                </Typography>
                {open ? <ExpandLess sx={{ fontSize: 18 }} /> : <ExpandMore sx={{ fontSize: 18 }} />}
            </Box>
            <Collapse in={open} unmountOnExit>
                <Box sx={{ px: 1.25, pb: 1, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                    <CommitSlider
                        label="Point opacity" value={Math.round(a.globalOpacity * 100)} min={10} max={100} step={5}
                        format={(v) => `${v}%`} onCommit={(v) => store().setGlobalOpacity(v / 100)}
                    />

                    {/* Value filter */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Typography variant="caption" fontWeight={600} sx={{ flex: 1 }}>
                            Value filter{vf.enabled && vfStats ? ` (${vfStats.inRange.toLocaleString()} of ${vfStats.total.toLocaleString()})` : ''}
                        </Typography>
                        <Switch size="small" checked={vf.enabled} onChange={(e) => store().setValueFilterEnabled(e.target.checked)} inputProps={{ 'aria-label': 'Value filter' }} />
                    </Box>
                    {vf.enabled && (
                        <>
                            <Select
                                size="small" value={vf.column || ''} displayEmpty
                                onChange={(e) => store().setValueFilterColumn((e.target.value as string) || null)}
                                sx={{ fontSize: '0.75rem' }}
                                inputProps={{ 'aria-label': 'Value filter column' }}
                            >
                                <MenuItem value=""><em>Colour field{a.colourField ? ` (${a.colourField})` : ''}</em></MenuItem>
                                {numeric.map(c => <MenuItem key={c.name} value={c.name}>{c.alias || c.name}</MenuItem>)}
                            </Select>
                            {vfStats ? (
                                <>
                                    <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}>
                                        <CommitNumber label="Min" value={vf.min} onCommit={(v) => store().setValueFilterRange(v, vf.max)} />
                                        <CommitNumber label="Max" value={vf.max} onCommit={(v) => store().setValueFilterRange(vf.min, v)} />
                                        <Tooltip title="Whole range">
                                            <IconButton size="small" onClick={() => store().setValueFilterRange(null, null)} aria-label="Reset value filter">
                                                <RestartAlt fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                    </Box>
                                    {vfStats.hi > vfStats.lo && (
                                        <Slider
                                            size="small" min={vfStats.lo} max={vfStats.hi} step={(vfStats.hi - vfStats.lo) / 500}
                                            value={range} disableSwap
                                            onChange={(_, v) => setRange(v as [number, number])}
                                            onChangeCommitted={(_, v) => {
                                                const [lo, hi] = v as number[];
                                                store().setValueFilterRange(
                                                    lo <= vfStats.lo ? null : Number(lo.toPrecision(4)),
                                                    hi >= vfStats.hi ? null : Number(hi.toPrecision(4)),
                                                );
                                            }}
                                            valueLabelDisplay="auto" valueLabelFormat={(v) => formatBreak(v)}
                                            getAriaLabel={(i) => (i === 0 ? "Value filter minimum" : "Value filter maximum")}
                                        />
                                    )}
                                </>
                            ) : (
                                <Typography variant="caption" color="warning.main">Choose a numeric column (or a numeric colour field).</Typography>
                            )}
                        </>
                    )}

                    {/* Emphasis */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Typography variant="caption" fontWeight={600} sx={{ flex: 1 }}>High-grade emphasis</Typography>
                        <Switch size="small" checked={em.enabled} onChange={(e) => store().setEmphasisEnabled(e.target.checked)} inputProps={{ 'aria-label': 'High-grade emphasis' }} />
                    </Box>
                    {em.enabled && (
                        <>
                            <ToggleButtonGroup
                                size="small" exclusive fullWidth value={em.mode}
                                onChange={(_, m: EmphasisMode | null) => m && store().setEmphasisMode(m)}
                                sx={{ '& .MuiToggleButton-root': { py: 0.25, fontSize: '0.7rem', textTransform: 'none' } }}
                            >
                                <ToggleButton value="category" disabled={!a.hasColourClasses}>By colour class</ToggleButton>
                                <ToggleButton value="percentile">Percentile</ToggleButton>
                                <ToggleButton value="linear">Linear</ToggleButton>
                            </ToggleButtonGroup>
                            {em.mode !== 'category' && (
                                <Select
                                    size="small" value={em.column || ''} displayEmpty
                                    onChange={(e) => store().setEmphasisColumn((e.target.value as string) || null)}
                                    sx={{ fontSize: '0.75rem' }}
                                    inputProps={{ 'aria-label': 'Emphasis column' }}
                                >
                                    <MenuItem value=""><em>Colour field{a.colourField ? ` (${a.colourField})` : ''}</em></MenuItem>
                                    {numeric.map(c => <MenuItem key={c.name} value={c.name}>{c.alias || c.name}</MenuItem>)}
                                </Select>
                            )}
                            <CommitSlider label="Full from" value={em.threshold} min={50} max={99} step={1}
                                format={(v) => `${v}%`} onCommit={(v) => store().setEmphasisThreshold(v)} />
                            <CommitSlider label="Lowest opacity" value={Math.round(em.minOpacity * 100)} min={5} max={50} step={5}
                                format={(v) => `${v}%`} onCommit={(v) => store().setEmphasisMinOpacity(v / 100)} />
                            <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                <FormControlLabel
                                    control={<Checkbox size="small" checked={em.boostSize} onChange={(e) => store().setEmphasisBoostSize(e.target.checked)} />}
                                    label={<Typography variant="caption">Enlarge</Typography>}
                                    sx={{ mr: 0.5, width: 92 }}
                                />
                                <Box sx={{ flex: 1 }}>
                                    <CommitSlider label="" value={em.sizeBoostFactor} min={1} max={3} step={0.1} disabled={!em.boostSize}
                                        format={(v) => `${v.toFixed(1)}×`} onCommit={(v) => store().setEmphasisSizeBoostFactor(v)} />
                                </Box>
                            </Box>
                        </>
                    )}
                </Box>
            </Collapse>
        </Box>
    );
};
