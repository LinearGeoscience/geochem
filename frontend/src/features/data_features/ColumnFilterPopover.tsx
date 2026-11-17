/**
 * Per-column filter editor for the Data view: number range (with below-
 * detection and blank handling), category checklist, text contains, or date
 * range — whichever suits the column.
 */
import React, { useMemo, useState } from 'react';
import {
    Box, Button, Checkbox, FormControlLabel, MenuItem, Popover, Stack, TextField, Typography,
} from '@mui/material';
import { ColumnData, isNumericColumn } from '../../types/columnarData';
import {
    BlankMode, ColumnFilter, FilterKind, categoryCounts, fmtDate,
} from './dataFilters';

interface Props {
    anchorEl: HTMLElement | null;
    onClose: () => void;
    column: string;
    label: string;
    kind: FilterKind;
    col: ColumnData | undefined;
    /** Parsed dates (epoch ms) for a date column */
    dates?: Float64Array;
    value: ColumnFilter | undefined;
    onApply: (filter: ColumnFilter | null) => void;
}

const DAY = 86400000;
const SHOWN = 300;

function numOrUndef(s: string): number | undefined {
    const t = s.trim();
    if (!t) return undefined;
    const v = Number(t);
    return Number.isFinite(v) ? v : undefined;
}

function dateInput(ms: number | undefined) { return ms === undefined ? '' : fmtDate(ms); }
function fromInput(s: string): number | undefined {
    if (!s) return undefined;
    const t = Date.parse(`${s}T00:00:00Z`);
    return Number.isFinite(t) ? t : undefined;
}

function rangeOf(arr: ArrayLike<number>): { min: number; max: number; n: number } | null {
    let min = Infinity, max = -Infinity, n = 0;
    for (let i = 0; i < arr.length; i++) {
        const v = arr[i];
        if (Number.isNaN(v)) continue;
        n++;
        if (v < min) min = v;
        if (v > max) max = v;
    }
    return n ? { min, max, n } : null;
}

export const ColumnFilterPopover: React.FC<Props> = ({ anchorEl, onClose, column, label, kind, col, dates, value, onApply }) => {
    const open = !!anchorEl;
    return (
        <Popover open={open} anchorEl={anchorEl} onClose={onClose}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
            {open && (
                <Box sx={{ p: 1.5, width: 300 }}>
                    <Typography variant="subtitle2" noWrap title={column} sx={{ mb: 1 }}>Filter: {label}</Typography>
                    {kind === 'number' && <NumberEditor col={col} value={value?.kind === 'number' ? value : undefined} onApply={onApply} onClose={onClose} />}
                    {kind === 'category' && <CategoryEditor col={col} value={value?.kind === 'category' ? value : undefined} onApply={onApply} onClose={onClose} />}
                    {kind === 'text' && <TextEditor value={value?.kind === 'text' ? value : undefined} onApply={onApply} onClose={onClose} />}
                    {kind === 'date' && <DateEditor dates={dates} value={value?.kind === 'date' ? value : undefined} onApply={onApply} onClose={onClose} />}
                </Box>
            )}
        </Popover>
    );
};

interface EditorProps<F> { value: F | undefined; onApply: (f: ColumnFilter | null) => void; onClose: () => void }

const Actions: React.FC<{ onClear: () => void; onApply: () => void }> = ({ onClear, onApply }) => (
    <Stack direction="row" justifyContent="flex-end" spacing={1} sx={{ mt: 1.5 }}>
        <Button size="small" onClick={onClear}>Clear</Button>
        <Button size="small" variant="contained" onClick={onApply}>Apply</Button>
    </Stack>
);

const NumberEditor: React.FC<EditorProps<Extract<ColumnFilter, { kind: 'number' }>> & { col: ColumnData | undefined }> = ({ col, value, onApply, onClose }) => {
    const [min, setMin] = useState(value?.min !== undefined ? String(value.min) : '');
    const [max, setMax] = useState(value?.max !== undefined ? String(value.max) : '');
    const [blanks, setBlanks] = useState<BlankMode>(value?.blanks ?? 'any');
    const [bdl, setBdl] = useState<BlankMode>(value?.bdl ?? 'any');
    const stats = useMemo(() => (col && isNumericColumn(col) ? rangeOf(col) : null), [col]);
    const hasBdl = useMemo(() => !!col && isNumericColumn(col) && Array.prototype.some.call(col, (v: number) => v < 0), [col]);
    const apply = () => { onApply({ kind: 'number', min: numOrUndef(min), max: numOrUndef(max), blanks, bdl }); onClose(); };
    return (
        <>
            {stats && <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
                Range {stats.min.toPrecision(4)} – {stats.max.toPrecision(4)} ({stats.n.toLocaleString()} values)
            </Typography>}
            <Stack direction="row" spacing={1}>
                <TextField size="small" label="Min (≥)" value={min} onChange={e => setMin(e.target.value)} autoFocus
                    onKeyDown={e => e.key === 'Enter' && apply()} />
                <TextField size="small" label="Max (≤)" value={max} onChange={e => setMax(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && apply()} />
            </Stack>
            {hasBdl && (
                <TextField select size="small" fullWidth label="Below detection (stored as −DL)" value={bdl}
                    onChange={e => setBdl(e.target.value as BlankMode)} sx={{ mt: 1.5 }}>
                    <MenuItem value="any">Include (as negative values)</MenuItem>
                    <MenuItem value="exclude">Exclude</MenuItem>
                    <MenuItem value="only">Only below detection</MenuItem>
                </TextField>
            )}
            <TextField select size="small" fullWidth label="Blank cells" value={blanks}
                onChange={e => setBlanks(e.target.value as BlankMode)} sx={{ mt: 1.5 }}>
                <MenuItem value="any">Keep when no range is set</MenuItem>
                <MenuItem value="exclude">Exclude</MenuItem>
                <MenuItem value="only">Only blanks</MenuItem>
            </TextField>
            <Actions onClear={() => { onApply(null); onClose(); }} onApply={apply} />
        </>
    );
};

const CategoryEditor: React.FC<EditorProps<Extract<ColumnFilter, { kind: 'category' }>> & { col: ColumnData | undefined }> = ({ col, value, onApply, onClose }) => {
    const counts = useMemo(() => categoryCounts(col) ?? [], [col]);
    const [picked, setPicked] = useState<Set<string>>(() => new Set(value ? value.values : counts.map(c => c.value)));
    const [q, setQ] = useState('');
    const shown = useMemo(() => {
        const needle = q.trim().toLowerCase();
        return needle ? counts.filter(c => c.value.toLowerCase().includes(needle)) : counts;
    }, [counts, q]);
    const setAll = (on: boolean) => setPicked(prev => {
        const next = new Set(prev);
        for (const c of shown) { if (on) next.add(c.value); else next.delete(c.value); }
        return next;
    });
    const toggle = (v: string) => setPicked(prev => {
        const next = new Set(prev);
        if (next.has(v)) next.delete(v); else next.add(v);
        return next;
    });
    const apply = () => {
        onApply(picked.size === counts.length ? null : { kind: 'category', values: [...picked] });
        onClose();
    };
    return (
        <>
            <TextField size="small" fullWidth placeholder={`Search ${counts.length} values`} value={q} onChange={e => setQ(e.target.value)} autoFocus />
            <Stack direction="row" spacing={1} sx={{ my: 0.5 }}>
                <Button size="small" onClick={() => setAll(true)}>All{q ? ' shown' : ''}</Button>
                <Button size="small" onClick={() => setAll(false)}>None{q ? ' shown' : ''}</Button>
                <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center', ml: 'auto !important' }}>{picked.size} picked</Typography>
            </Stack>
            <Box sx={{ maxHeight: 260, overflow: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}>
                {shown.slice(0, SHOWN).map(c => (
                    <FormControlLabel key={c.value} sx={{ display: 'flex', mx: 0, pr: 1, '& .MuiFormControlLabel-label': { flex: 1, fontSize: 13, minWidth: 0 } }}
                        control={<Checkbox size="small" sx={{ p: 0.5 }} checked={picked.has(c.value)} onChange={() => toggle(c.value)} />}
                        label={<Box sx={{ display: 'flex', gap: 1 }}>
                            <Box component="span" sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontStyle: c.value ? undefined : 'italic' }}>{c.value || '(blank)'}</Box>
                            <Box component="span" sx={{ color: 'text.secondary' }}>{c.count.toLocaleString()}</Box>
                        </Box>} />
                ))}
                {shown.length > SHOWN && <Typography variant="caption" color="text.secondary" sx={{ p: 1, display: 'block' }}>
                    {shown.length - SHOWN} more — type to narrow the list
                </Typography>}
            </Box>
            <Actions onClear={() => { onApply(null); onClose(); }} onApply={apply} />
        </>
    );
};

const TextEditor: React.FC<EditorProps<Extract<ColumnFilter, { kind: 'text' }>>> = ({ value, onApply, onClose }) => {
    const [text, setText] = useState(value?.contains ?? '');
    const [exclude, setExclude] = useState(!!value?.exclude);
    const [caseSensitive, setCaseSensitive] = useState(!!value?.caseSensitive);
    const apply = () => { onApply({ kind: 'text', contains: text, exclude, caseSensitive }); onClose(); };
    return (
        <>
            <TextField size="small" fullWidth label="Contains" value={text} onChange={e => setText(e.target.value)} autoFocus
                onKeyDown={e => e.key === 'Enter' && apply()} />
            <FormControlLabel control={<Checkbox size="small" checked={exclude} onChange={e => setExclude(e.target.checked)} />} label="Does NOT contain" />
            <FormControlLabel control={<Checkbox size="small" checked={caseSensitive} onChange={e => setCaseSensitive(e.target.checked)} />} label="Match case" />
            <Actions onClear={() => { onApply(null); onClose(); }} onApply={apply} />
        </>
    );
};

const DateEditor: React.FC<EditorProps<Extract<ColumnFilter, { kind: 'date' }>> & { dates?: Float64Array }> = ({ dates, value, onApply, onClose }) => {
    const [from, setFrom] = useState(dateInput(value?.from));
    const [to, setTo] = useState(dateInput(value?.to));
    const [blanks, setBlanks] = useState<BlankMode>(value?.blanks ?? 'exclude');
    const stats = useMemo(() => (dates ? rangeOf(dates) : null), [dates]);
    const quick = (a: number, b: number) => { setFrom(fmtDate(a)); setTo(fmtDate(b)); };
    const latest = stats?.max ?? Date.now();
    const yr = new Date(latest).getUTCFullYear();
    const apply = () => {
        const t = fromInput(to);
        // "To" includes the whole day
        onApply({ kind: 'date', from: fromInput(from), to: t !== undefined ? t + DAY - 1 : undefined, blanks });
        onClose();
    };
    return (
        <>
            {stats && <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
                {fmtDate(stats.min)} → {fmtDate(stats.max)} ({stats.n.toLocaleString()} dated rows)
            </Typography>}
            <Stack direction="row" spacing={1}>
                <TextField size="small" type="date" label="From" value={from} onChange={e => setFrom(e.target.value)} InputLabelProps={{ shrink: true }} />
                <TextField size="small" type="date" label="To" value={to} onChange={e => setTo(e.target.value)} InputLabelProps={{ shrink: true }} />
            </Stack>
            <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ mt: 1 }}>
                <Button size="small" onClick={() => quick(latest - 30 * DAY, latest)}>Last 30 days</Button>
                <Button size="small" onClick={() => quick(latest - 365 * DAY, latest)}>Last 12 months</Button>
                <Button size="small" onClick={() => quick(Date.UTC(yr, 0, 1), Date.UTC(yr, 11, 31))}>{yr}</Button>
                <Button size="small" onClick={() => quick(Date.UTC(yr - 1, 0, 1), Date.UTC(yr - 1, 11, 31))}>{yr - 1}</Button>
            </Stack>
            <Typography variant="caption" color="text.secondary">Quick ranges count back from the latest date in the column.</Typography>
            <TextField select size="small" fullWidth label="Undated rows" value={blanks}
                onChange={e => setBlanks(e.target.value as BlankMode)} sx={{ mt: 1.5 }}>
                <MenuItem value="exclude">Exclude</MenuItem>
                <MenuItem value="any">Include</MenuItem>
                <MenuItem value="only">Only undated</MenuItem>
            </TextField>
            <Actions onClear={() => { onApply(null); onClose(); }} onApply={apply} />
        </>
    );
};
