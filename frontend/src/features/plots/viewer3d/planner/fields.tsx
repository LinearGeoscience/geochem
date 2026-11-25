/**
 * Small inputs for the drillhole planner. Number fields keep what is being
 * typed ("-", "6500") and pass on a number only once it reads as one.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography } from '@mui/material';
import type { RateLimits } from '../../../../utils/drillholePlan';

export const NumField: React.FC<{
    label: string;
    value: number | null;
    onChange: (v: number | null) => void;
    width?: number | string;
    disabled?: boolean;
    error?: boolean;
    helper?: string;
    title?: string;
    /** Called when typing ends (the field is left, or Enter) */
    onCommit?: () => void;
}> = ({ label, value, onChange, width = 110, disabled, error, helper, title, onCommit }) => {
    // Shown to the millimetre (a dragged point is not a round number)
    const shown = (v: number | null) => (v === null ? '' : String(Math.round(v * 1000) / 1000));
    const [text, setText] = useState(shown(value));
    const focused = useRef(false);
    /** Something was typed since the field was entered */
    const typed = useRef(false);
    const commit = () => { if (typed.current) { typed.current = false; onCommit?.(); } };
    // A value set from elsewhere (a drag, a solve, an import) shows unless this field is being typed in
    useEffect(() => {
        if (focused.current) return;
        setText(shown(value));
    }, [value]);
    return (
        <TextField
            size="small" label={label} value={text} disabled={disabled} error={error} helperText={helper} title={title}
            sx={{ width, '& input': { fontVariantNumeric: 'tabular-nums' } }}
            inputProps={{ inputMode: 'decimal', spellCheck: false }}
            onFocus={() => { focused.current = true; }}
            onKeyDown={e => { if (e.key === 'Enter') commit(); }}
            onBlur={() => {
                focused.current = false;
                setText(shown(value));
                commit();
            }}
            onChange={e => {
                const s = e.target.value;
                typed.current = true;
                setText(s);
                if (s.trim() === '') { onChange(null); return; }
                const v = Number(s);
                if (Number.isFinite(v)) onChange(v);
            }}
        />
    );
};

/** A wedge daughter's lift and drift limits (°/100 m), each a min and a max */
export const RateLimitsFields: React.FC<{ value: RateLimits; onChange: (v: RateLimits) => void; disabled?: boolean; prefix?: string }> = ({ value, onChange, disabled, prefix = '' }) => {
    const field = (k: keyof RateLimits, label: string, title: string) => (
        <NumField label={`${prefix}${label}`} value={value[k]} width={92} disabled={disabled} title={title}
            error={k.startsWith('lift') ? value.liftMin > value.liftMax : value.driftMin > value.driftMax}
            onChange={v => { if (v !== null) onChange({ ...value, [k]: v }); }} />
    );
    return (
        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
            {field('liftMin', 'Lift min', 'The most the hole may steepen, °/100 m (negative)')}
            {field('liftMax', 'Lift max', 'The most the hole may flatten, °/100 m')}
            {field('driftMin', 'Drift min', 'The most the hole may turn anticlockwise, °/100 m (negative)')}
            {field('driftMax', 'Drift max', 'The most the hole may turn clockwise, °/100 m')}
        </Box>
    );
};

/** Stops keys typed in the planner from reaching the 3D view's and the app's shortcuts */
export const stopKeys = {
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key !== 'Escape') e.stopPropagation(); },
    onKeyUp: (e: React.KeyboardEvent) => { e.stopPropagation(); },
    onKeyPress: (e: React.KeyboardEvent) => { e.stopPropagation(); },
};

export const fixed = (v: number | null | undefined, dp: number) => (v === null || v === undefined || !Number.isFinite(v) ? '–' : v.toFixed(dp));

/** Save text as a file the browser downloads */
export function download(text: string, name: string, type = 'text/csv') {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A yes / no question before something that can't be undone (the viewer shows no browser dialogs) */
export const ConfirmDialog: React.FC<{ open: boolean; title: string; text: string; confirm: string; onConfirm: () => void; onClose: () => void }> = ({ open, title, text, confirm, onConfirm, onClose }) => (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth {...stopKeys}>
        <DialogTitle>{title}</DialogTitle>
        <DialogContent><Typography variant="body2">{text}</Typography></DialogContent>
        <DialogActions>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="contained" color="error" onClick={() => { onConfirm(); onClose(); }}>{confirm}</Button>
        </DialogActions>
    </Dialog>
);
