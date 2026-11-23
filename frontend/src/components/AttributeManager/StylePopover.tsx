/**
 * Style of one or more classes: colour, shape, size and opacity in one
 * popover (edits each in its own dialog). Edits apply to every target
 * class as one store update; the colour follows the picker live (debounced)
 * and sliders commit on release, so a drag is one undo step.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Box, Popover, Slider, TextField, Typography } from '@mui/material';
import { HexColorPicker } from 'react-colorful';
import { AttributeEntry, AttributeType, MARKER_SHAPES, useAttributeStore } from '../../store/attributeStore';
import { generateColorsFromPalette } from '../../utils/colorPalettes';
import { ShapeMarker } from '../ShapeMarker';

const QUICK = generateColorsFromPalette('Set1', 9);
const HEX = /^#[0-9a-fA-F]{6}$/;

interface Props {
    anchorEl: HTMLElement | null;
    tab: AttributeType;
    /** Entries being styled (tab classes, painted groups and/or the Default row) */
    targets: AttributeEntry[];
    onClose: () => void;
}

export const StylePopover: React.FC<Props> = ({ anchorEl, tab, targets, onClose }) => {
    const first = targets[0];
    const painted = targets.some(e => e.isCustom);
    const showColour = tab === 'color' || painted;
    const showShape = tab === 'shape' || painted;
    const showSize = tab === 'size' || painted;
    const recentColors = useAttributeStore(s => s.recentColors);

    const [colour, setColour] = useState(first?.color ?? '#808080');
    const [hex, setHex] = useState(colour);
    const [size, setSize] = useState(first?.size ?? 8);
    const [opacity, setOpacity] = useState(Math.round((first?.opacity ?? 1) * 100));
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingColour = useRef<string | null>(null);

    const openKey = anchorEl ? targets.map(t => t.id).join('|') : '';
    useEffect(() => {
        if (!first) return;
        setColour(first.color ?? '#808080');
        setHex(first.color ?? '#808080');
        setSize(first.size ?? 8);
        setOpacity(Math.round((first.opacity ?? 1) * 100));
        // re-initialise only when opened for other targets
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [openKey]);

    const apply = (updates: Partial<AttributeEntry>) => {
        if (!targets.length) return;
        useAttributeStore.getState().batchUpdateEntries(tab, targets.map(t => t.id), updates);
    };

    const flushColour = () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        const c = pendingColour.current;
        pendingColour.current = null;
        if (c) {
            apply({ color: c });
            useAttributeStore.getState().addRecentColor(c);
        }
    };

    const pickColour = (c: string, immediate = false) => {
        setColour(c);
        setHex(c);
        pendingColour.current = c;
        if (timer.current) clearTimeout(timer.current);
        if (immediate) flushColour();
        else timer.current = setTimeout(flushColour, 150);
    };

    const close = () => {
        flushColour();
        onClose();
    };

    if (!first) return null;
    const label = targets.length > 1 ? `${targets.length} classes` : first.name;

    return (
        <Popover
            open={!!anchorEl}
            anchorEl={anchorEl}
            onClose={close}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
            slotProps={{ paper: { sx: { width: 232, p: 1.25 } } }}
        >
            <Typography variant="caption" fontWeight={600} noWrap component="div" sx={{ mb: 0.75 }} title={label}>
                {label}
            </Typography>

            {showColour && (
                <Box sx={{ mb: 1 }}>
                    <HexColorPicker color={colour} onChange={(c) => pickColour(c)} style={{ width: '100%', height: 130 }} />
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.75 }}>
                        <Box sx={{ width: 22, height: 22, borderRadius: '50%', bgcolor: colour, border: '1px solid', borderColor: 'divider', flexShrink: 0 }} />
                        <TextField
                            value={hex}
                            size="small"
                            onChange={(e) => { setHex(e.target.value); if (HEX.test(e.target.value)) pickColour(e.target.value, true); }}
                            inputProps={{ 'aria-label': 'Hex colour', style: { padding: '3px 6px', fontFamily: 'monospace', fontSize: '0.75rem' } }}
                            sx={{ flex: 1 }}
                        />
                    </Box>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.75 }}>
                        {[...QUICK, ...recentColors.filter(c => !QUICK.includes(c))].slice(0, 16).map(c => (
                            <Box
                                key={c}
                                role="button"
                                aria-label={`Colour ${c}`}
                                onClick={() => pickColour(c, true)}
                                sx={{
                                    width: 16, height: 16, borderRadius: '50%', bgcolor: c, cursor: 'pointer',
                                    outline: c.toLowerCase() === colour.toLowerCase() ? '2px solid' : 'none', outlineColor: 'text.primary',
                                    border: '1px solid rgba(0,0,0,0.2)',
                                }}
                            />
                        ))}
                    </Box>
                </Box>
            )}

            {showShape && (
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.25, mb: 1 }}>
                    {MARKER_SHAPES.map(s => (
                        <Box
                            key={s.value}
                            role="button"
                            aria-label={s.label}
                            title={s.label}
                            onClick={() => apply({ shape: s.value })}
                            sx={{
                                p: 0.25, display: 'flex', justifyContent: 'center', borderRadius: 0.5, cursor: 'pointer',
                                bgcolor: first.shape === s.value ? 'action.selected' : 'transparent',
                                '&:hover': { bgcolor: 'action.hover' },
                            }}
                        >
                            <ShapeMarker shape={s.value} size={16} color={showColour ? colour : undefined} />
                        </Box>
                    ))}
                </Box>
            )}

            {showSize && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="caption" sx={{ width: 48 }}>Size {size}</Typography>
                    <Slider
                        size="small" min={2} max={30} step={1} value={size}
                        onChange={(_, v) => setSize(v as number)}
                        onChangeCommitted={(_, v) => apply({ size: v as number })}
                        aria-label="Size"
                    />
                </Box>
            )}

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="caption" sx={{ width: 48 }}>Opacity</Typography>
                <Slider
                    size="small" min={5} max={100} step={5} value={opacity}
                    onChange={(_, v) => setOpacity(v as number)}
                    onChangeCommitted={(_, v) => apply({ opacity: (v as number) / 100 })}
                    valueLabelDisplay="auto" valueLabelFormat={(v) => `${v}%`}
                    aria-label="Opacity"
                />
            </Box>
        </Popover>
    );
};
