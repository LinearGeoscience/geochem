/**
 * A slider whose value is taken when it is let go, not at every step on the
 * way: a setting that fits a surface again (how closely it follows its
 * points, how far it reaches) would otherwise start a fit for every step of
 * the drag, and each step would be one more thing to undo. While it is
 * dragged it shows where it is (`onShow`, for a read-out beside it); let go,
 * or moved by a key, it commits once.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Box, Slider, Typography, type SliderProps } from '@mui/material';

export interface CommitSliderProps extends Omit<SliderProps, 'value' | 'defaultValue' | 'onChange' | 'onChangeCommitted'> {
    /** The value as it is set now */
    value: number;
    /** It was let go at this value (not called when that is where it was) */
    onCommit: (value: number) => void;
    /** Where it is while it is dragged (null: let go, so `value` is what counts again) */
    onShow?: (value: number | null) => void;
}

export const CommitSlider: React.FC<CommitSliderProps> = ({ value, onCommit, onShow, ...rest }) => {
    // Where the thumb is while it is held (null: where `value` says)
    const [held, setHeld] = useState<number | null>(null);
    const show = useRef(onShow);
    show.current = onShow;
    // The value changed under it (undo, another surface opened): it follows
    useEffect(() => { setHeld(null); show.current?.(null); }, [value]);
    return (
        <Slider
            {...rest}
            value={held ?? value}
            onChange={(_, v) => { setHeld(v as number); onShow?.(v as number); }}
            onChangeCommitted={(_, v) => {
                setHeld(null);
                onShow?.(null);
                if (v !== value) onCommit(v as number);
            }}
        />
    );
};

/** How see-through an object is drawn: read out as it is dragged, set when it is let go (nothing: its edges only) */
export const OpacityRow: React.FC<{ value: number; onCommit: (opacity: number) => void; label?: string; none?: string }> = ({ value, onCommit, label = 'Opacity', none = 'Edges only' }) => {
    const [shown, setShown] = useState<number | null>(null);
    const now = shown ?? value;
    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
            <Typography variant="caption" color="text.secondary" sx={{ width: 92, flexShrink: 0 }}>
                {now === 0 ? none : `Opacity ${Math.round(now * 100)}%`}
            </Typography>
            <CommitSlider size="small" min={0} max={1} step={0.05} value={value} aria-label={label} onShow={setShown} onCommit={onCommit} />
        </Box>
    );
};
