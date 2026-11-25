/**
 * A number typed for a side of a box or the size of a cell: taken when the
 * field is left or Enter is pressed; left empty it is "not set", and the
 * value that is then used is shown greyed in its place.
 */
import React, { useEffect, useState } from 'react';
import { TextField } from '@mui/material';
import type { TermKey } from '../../model/terms';

interface Props {
    label: string;
    value: number | null;
    /** What is used while it is empty (null: nothing to show) */
    hint: number | null;
    onCommit: (v: number | null) => void;
    term?: TermKey;
    fontSize?: number;
    /** The hint is shown as it is (to three figures), not to the metre: for a size of a few metres */
    exact?: boolean;
}

export const BoxField: React.FC<Props> = ({ label, value, hint, onCommit, term, fontSize = 12, exact = false }) => {
    const shown = value === null ? '' : String(value);
    const [text, setText] = useState(shown);
    useEffect(() => setText(shown), [shown]);
    const commit = () => {
        const v = Number(text);
        const next = text.trim() !== '' && Number.isFinite(v) ? v : null;
        if (next !== value) onCommit(next); else setText(shown);
    };
    return (
        <TextField
            size="small" variant="standard" value={text} placeholder={hint === null ? '' : String(exact ? Number(hint.toPrecision(3)) : Math.round(hint))} sx={{ flex: 1, minWidth: 0 }}
            onChange={e => setText(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLElement).blur(); }}
            inputProps={{ inputMode: 'decimal', 'aria-label': label, ...(term ? { 'data-term': term } : {}), style: { fontSize } }}
        />
    );
};
