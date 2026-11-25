/**
 * Every place and link put on a surface by hand, in its properties (Phase 307): what kind, its side, how long, how
 * high, what it is held by, what logging it takes; shown by kind and sorted. Picked here and in the view alike
 * (controlPicks): a click picks a row, Ctrl+click adds it or takes it back out, Shift+click picks the run from the
 * last one picked; a row pointed at lights up in the view; a double-click brings it into view. What is picked is
 * brought into view or removed in one step.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, IconButton, MenuItem, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import { CenterFocusStrong, Close } from '@mui/icons-material';
import { ALONG_MOST, CUT_ALONG, SIDE_COLORS } from '../../model/contactControl';
import { changedMarks, controlRows, KIND_NAMES, shownRows, type ControlChange, type ControlKind, type ControlRow, type ControlSort, type KindFilter } from '../../model/controlMarks';
import { pickedOn, useControlPicks } from '../../model/controlPicks';
import type { SideMark, Vec3 } from '../../model/types';

/** At most this many rows are drawn at once (the rest by kind or sort) */
const ROWS_DRAWN = 600;
const ROW_H = 30;

const smallButton = { minWidth: 0, px: 0.75, py: 0, height: 26, fontSize: 12.5, textTransform: 'none' } as const;
const metres = (v: number) => `${Number(v.toFixed(v < 10 ? 2 : 1))} m`;

interface Props {
    surfaceId: string;
    marks: readonly SideMark[];
    /** An intrusion: a place held outside by a distance is a cut */
    lenses: boolean;
    /** The names of its two sides, without "side" */
    sideName: (side: 1 | -1) => string;
    /** How many logged pieces of its own holes each mark puts on the other side, by id (null: not known) */
    takes: ReadonlyMap<string, number> | null;
    onRemove: (ids: string[] | null) => void;
    /** The marks changed (a distance, a length, a side given to those picked) */
    onChange?: (marks: SideMark[]) => void;
    /** How many times along its sheets a place reaches unless it says (null: not carried along a plane, no length) */
    usualAlong?: number | null;
    /** Bring a place into view, `reach` m round it (absent: the usual share of the data) */
    onZoom?: (p: Vec3, reach?: number) => void;
}

const numberOf = (text: string): number | null => {
    const v = Number(text.trim().replace(',', '.'));
    return text.trim() && Number.isFinite(v) ? v : null;
};
/** What all of them have, or null where they differ */
const shared = <T,>(values: T[]): T | null => (values.length > 0 && values.every(v => v === values[0]) ? values[0] : null);

/**
 * What the picked controls are held by, how far along the sheets they reach, which side they are on: shown as they
 * are (empty where they differ) and typed for all at once; Enter or leaving the field gives it to them, Esc puts it
 * back. One step back undoes each change.
 */
const PickedEditor: React.FC<{
    rows: ControlRow[]; usualAlong: number | null; sideName: (side: 1 | -1) => string;
    onChange: (ids: ReadonlySet<string>, change: ControlChange) => void;
}> = ({ rows, usualAlong, sideName, onChange }) => {
    // (The rows are new on every render: what is picked is told by its ids)
    const key = rows.map(r => r.id).join(' ');
    const ids = useMemo(() => new Set(key.split(' ')), [key]);
    const by = shared(rows.map(r => r.by ?? 0));
    const along = shared(rows.map(r => r.along ?? 0));
    const places = rows.filter(r => r.kind !== 'link');
    const side = shared(places.map(r => r.side));
    const [byText, setByText] = useState('');
    const [alongText, setAlongText] = useState('');
    // Shown afresh when the picks or their values change
    useEffect(() => setByText(by ? String(Number(by.toFixed(2))) : ''), [by, ids]);
    useEffect(() => setAlongText(along ? String(Number(along.toFixed(1))) : ''), [along, ids]);
    const giveBy = () => {
        const v = numberOf(byText);
        if (byText.trim() === '' ? by === 0 || by === null : v === by) return;
        onChange(ids, { by: v !== null && v > 0 ? v : null });
    };
    const giveAlong = () => {
        const v = numberOf(alongText);
        if (alongText.trim() === '' ? along === 0 || along === null : v === along) return;
        onChange(ids, { along: v !== null && v >= 1 ? v : null });
    };
    const keys = (give: () => void, reset: () => void) => (e: React.KeyboardEvent<HTMLInputElement>) => {
        e.stopPropagation();
        if (e.key === 'Enter') { give(); (e.target as HTMLInputElement).blur(); }
        if (e.key === 'Escape') { reset(); (e.target as HTMLInputElement).blur(); }
    };
    const field = { size: 'small', variant: 'standard', sx: { width: 52, flexShrink: 0 } } as const;
    const input = { inputMode: 'decimal', style: { fontSize: 12, textAlign: 'right', padding: 0 } } as const;
    return (
        <Box data-testid="control-picked-edit" sx={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 0.75, rowGap: 0.25, mt: 0.25 }}>
            <Typography variant="caption" color="text.secondary">Held by</Typography>
            <Tooltip title="How far across each of them is held: for a link, half its thickness. Empty: only just clear (a link keeps its own). The same for all of them; empty here where they differ.">
                <TextField
                    {...field} value={byText} placeholder={by === null ? 'mixed' : 'just'} onChange={e => setByText(e.target.value)} onBlur={giveBy}
                    onKeyDown={keys(giveBy, () => setByText(by ? String(Number(by.toFixed(2))) : ''))}
                    inputProps={{ ...input, 'aria-label': 'Held clear by, m, for every one picked' }}
                />
            </Tooltip>
            <Typography variant="caption" color="text.secondary">m</Typography>
            {usualAlong !== null && (
                <>
                    <Typography variant="caption" color="text.secondary">· along its sheets</Typography>
                    <Tooltip title={`How many times as far along its sheets as across each reaches (at most ${ALONG_MOST}). Empty: as usual (${Number(usualAlong.toFixed(1))} inside, ${CUT_ALONG} outside). Only those held by a distance take it.`}>
                        <TextField
                            {...field} value={alongText} placeholder={along === null ? 'mixed' : 'usual'} onChange={e => setAlongText(e.target.value)} onBlur={giveAlong}
                            onKeyDown={keys(giveAlong, () => setAlongText(along ? String(Number(along.toFixed(1))) : ''))}
                            inputProps={{ ...input, 'aria-label': 'Times as far along its sheets, for every one picked' }}
                        />
                    </Tooltip>
                    <Typography variant="caption" color="text.secondary">×</Typography>
                </>
            )}
            {places.length > 0 && (
                <ToggleButtonGroup
                    size="small" exclusive value={side} aria-label="The side the picked places are on" sx={{ ml: 'auto' }}
                    onChange={(_, v: 1 | -1 | null) => v && onChange(ids, { side: v })}
                >
                    {([1, -1] as const).map(s => (
                        <ToggleButton key={s} value={s} sx={{ ...smallButton, px: 0.75, gap: 0.5 }}>
                            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: SIDE_COLORS[s] }} />{sideName(s)}
                        </ToggleButton>
                    ))}
                </ToggleButtonGroup>
            )}
        </Box>
    );
};

const SORT_NAMES: Record<ControlSort, string> = { placed: 'Last placed first', length: 'Longest first', level: 'Highest first', takes: 'Takes logging first' };

/** How far round a control is shown when it is brought into view, m: its length a few times over, and enough to see the holes beside it */
const reachOf = (r: Pick<ControlRow, 'length' | 'by'>): number => Math.max(8, 2.5 * r.length, 6 * (r.by ?? 0));

const middle = (r: Pick<ControlRow, 'p' | 'to'>): Vec3 => (r.to ? [(r.p[0] + r.to[0]) / 2, (r.p[1] + r.to[1]) / 2, (r.p[2] + r.to[2]) / 2] : r.p);

/** What a row's handlers do, read when they are called (so a row need not be drawn again when they change) */
interface RowActs {
    click: (e: React.MouseEvent, r: ControlRow) => void;
    zoom: ((r: ControlRow) => void) | null;
    remove: (r: ControlRow) => void;
    hot: (id: string) => void;
}
/** Everything a row shows of its control */
const rowSign = (r: ControlRow) => `${r.kind}|${r.n}|${r.side}|${r.length}|${r.z}|${r.by ?? ''}|${r.along ?? ''}|${r.p.join(',')}|${r.to?.join(',') ?? ''}`;

/** One row: drawn again only when what it shows changes (the list of a few hundred is drawn afresh on every change and every hover otherwise) */
const ListRow = React.memo<{ r: ControlRow; on: boolean; lit: boolean; took: number; sideText: string; zoomable: boolean; acts: React.MutableRefObject<RowActs> }>(
    ({ r, on, lit, took, sideText, zoomable, acts }) => (
        <Box
            data-control={r.id} data-testid="control-row" role="option" aria-selected={on}
            onClick={e => acts.current.click(e, r)} onDoubleClick={() => acts.current.zoom?.(r)} onMouseEnter={() => acts.current.hot(r.id)}
            sx={{
                display: 'flex', alignItems: 'center', gap: 0.75, height: ROW_H, px: 0.75, cursor: 'pointer', userSelect: 'none',
                bgcolor: on ? 'action.selected' : lit ? 'action.hover' : undefined, borderBottom: 1, borderColor: 'divider',
            }}
        >
            <Box sx={{ width: 12, height: 12, borderRadius: r.kind === 'link' ? '3px' : '50%', bgcolor: SIDE_COLORS[r.side], flexShrink: 0 }} />
            <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0, fontSize: 13 }} title={`${Math.round(r.p[0]).toLocaleString()} E, ${Math.round(r.p[1]).toLocaleString()} N, ${Math.round(r.p[2]).toLocaleString()} m`}>
                <b>{KIND_NAMES[r.kind]} {r.n}</b>
                <Box component="span" sx={{ color: 'text.secondary' }}>
                    {r.kind === 'link' ? ` · ${metres(r.length)}` : ` · ${sideText} side`}
                    {` · RL ${Math.round(r.z).toLocaleString()}`}
                    {r.by ? ` · by ${metres(r.by)}` : ' · just clear'}
                    {r.along ? ` · ${Number(r.along.toFixed(1))}× along` : ''}
                </Box>
                {took > 0 && <Box component="span" sx={{ color: 'warning.main' }}> · takes {took.toLocaleString()} logged</Box>}
            </Typography>
            {zoomable && (
                <Tooltip title="Bring it into view (or double-click the row)">
                    <IconButton size="small" aria-label={`Show ${KIND_NAMES[r.kind].toLowerCase()} ${r.n}`} onClick={e => { e.stopPropagation(); acts.current.zoom?.(r); }}>
                        <CenterFocusStrong sx={{ fontSize: 18 }} />
                    </IconButton>
                </Tooltip>
            )}
            <Tooltip title="Remove it (one step back brings it again)">
                <IconButton size="small" aria-label={`Remove ${KIND_NAMES[r.kind].toLowerCase()} ${r.n}`} onClick={e => { e.stopPropagation(); acts.current.remove(r); }}>
                    <Close sx={{ fontSize: 18 }} />
                </IconButton>
            </Tooltip>
        </Box>
    ),
    (a, b) => a.on === b.on && a.lit === b.lit && a.took === b.took && a.sideText === b.sideText && a.zoomable === b.zoomable && a.acts === b.acts
        && (a.r === b.r || (a.r.id === b.r.id && rowSign(a.r) === rowSign(b.r))),
);
ListRow.displayName = 'ListRow';

export const ControlList: React.FC<Props> = ({ surfaceId, marks, lenses, sideName, takes, onRemove, onChange, usualAlong = null, onZoom }) => {
    const rows = useMemo(() => controlRows(marks, lenses), [marks, lenses]);
    const kinds = useMemo(() => (['link', 'place', 'cut'] as ControlKind[]).filter(k => rows.some(r => r.kind === k)), [rows]);
    const [kind, setKind] = useState<KindFilter>('all');
    const [sort, setSort] = useState<ControlSort>('placed');
    const shown = useMemo(() => shownRows(rows, kinds.includes(kind as ControlKind) ? kind : 'all', sort, takes ?? undefined), [rows, kinds, kind, sort, takes]);
    const pickSurface = useControlPicks(s => s.surface);
    const pickIds = useControlPicks(s => s.ids);
    const hot = useControlPicks(s => s.hot);
    const picked = useMemo(() => pickedOn(surfaceId, marks, { surface: pickSurface, ids: pickIds }), [surfaceId, marks, pickSurface, pickIds]);
    const { pick, setHot } = useControlPicks.getState();

    // Picked in the view: the first of them brought into sight in the list
    const box = useRef<HTMLDivElement>(null);
    const first = shown.find(r => picked.has(r.id))?.id ?? null;
    useEffect(() => {
        if (!first || !box.current) return;
        const row = box.current.querySelector(`[data-control="${first}"]`);
        if (row && typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' });
    }, [first]);

    const click = (e: React.MouseEvent, r: ControlRow) => {
        if (e.shiftKey) {
            const anchor = useControlPicks.getState().anchor;
            const a = shown.findIndex(x => x.id === anchor), b = shown.findIndex(x => x.id === r.id);
            if (a >= 0 && b >= 0) {
                pick(surfaceId, shown.slice(Math.min(a, b), Math.max(a, b) + 1).map(x => x.id), e.ctrlKey || e.metaKey ? 'add' : 'replace');
                return;
            }
        }
        pick(surfaceId, [r.id], e.ctrlKey || e.metaKey ? 'toggle' : 'replace');
    };
    const acts = useRef<RowActs>(null!);
    acts.current = {
        click,
        zoom: onZoom ? (r: ControlRow) => onZoom(middle(r), reachOf(r)) : null,
        remove: (r: ControlRow) => onRemove([r.id]),
        hot: (id: string) => setHot(id),
    };
    const pickedRows = rows.filter(r => picked.has(r.id));
    const zoomPicked = () => {
        if (!onZoom || pickedRows.length === 0) return;
        // Round all of them: their middle, and as far as the furthest end from it
        const ends = pickedRows.flatMap(r => (r.to ? [r.p, r.to] : [r.p]));
        const c = [0, 1, 2].map(k => ends.reduce((s, p) => s + p[k], 0) / ends.length) as Vec3;
        const far = Math.max(...ends.map(p => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2])));
        onZoom(c, Math.max(far * 1.2, ...pickedRows.map(reachOf)));
    };
    const counts = kinds.map(k => {
        const n = rows.filter(r => r.kind === k).length;
        return `${n.toLocaleString()} ${KIND_NAMES[k].toLowerCase()}${n === 1 ? '' : 's'}`;
    }).join(', ');

    if (rows.length === 0) {
        return (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }} data-testid="control-list-empty">
                Nothing placed by hand yet.
            </Typography>
        );
    }
    return (
        <Box data-testid="control-list">
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', mb: 0.5 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{rows.length.toLocaleString()} by hand</Typography>
                <Typography variant="caption" color="text.secondary">{counts}</Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', mb: 0.5 }}>
                {kinds.length > 1 && (
                    <ToggleButtonGroup size="small" exclusive value={kinds.includes(kind as ControlKind) ? kind : 'all'} onChange={(_, v) => v && setKind(v)} aria-label="Which are listed">
                        <ToggleButton value="all" sx={{ ...smallButton, px: 1 }}>All</ToggleButton>
                        {kinds.map(k => <ToggleButton key={k} value={k} sx={{ ...smallButton, px: 1 }}>{KIND_NAMES[k]}s</ToggleButton>)}
                    </ToggleButtonGroup>
                )}
                <TextField
                    select size="small" variant="standard" value={sort} onChange={e => setSort(e.target.value as ControlSort)} sx={{ minWidth: 150 }}
                    SelectProps={{ SelectDisplayProps: { 'aria-label': 'Order of the list', style: { fontSize: 13 } } as React.HTMLAttributes<HTMLDivElement> }}
                >
                    {(Object.keys(SORT_NAMES) as ControlSort[]).filter(s => s !== 'takes' || takes).map(s => <MenuItem key={s} dense value={s}>{SORT_NAMES[s]}</MenuItem>)}
                </TextField>
            </Box>
            <Box
                ref={box} role="listbox" aria-multiselectable="true" aria-label="Placed by hand"
                sx={{ maxHeight: 8.5 * ROW_H, overflowY: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}
                onMouseLeave={() => setHot(null)}
                tabIndex={0}
                onKeyDown={e => {
                    if ((e.key === 'Delete' || e.key === 'Backspace') && pickedRows.length > 0) { e.preventDefault(); onRemove(pickedRows.map(r => r.id)); }
                    if (e.key === 'Escape' && pickedRows.length > 0) { e.stopPropagation(); useControlPicks.getState().clear(); }
                }}
            >
                {shown.slice(0, ROWS_DRAWN).map(r => (
                    <ListRow
                        key={r.id} r={r} on={picked.has(r.id)} lit={hot === r.id} took={takes?.get(r.id) ?? 0}
                        sideText={r.kind === 'link' ? '' : sideName(r.side)} zoomable={!!onZoom} acts={acts}
                    />
                ))}
                {shown.length > ROWS_DRAWN && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', p: 0.75 }}>
                        {(shown.length - ROWS_DRAWN).toLocaleString()} more: list them by kind or in another order.
                    </Typography>
                )}
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.5, minHeight: 28 }} data-testid="control-picked">
                {pickedRows.length > 0 ? (
                    <>
                        <Typography variant="caption" sx={{ flex: 1, minWidth: 0 }}>{pickedRows.length.toLocaleString()} picked</Typography>
                        {onZoom && <Button size="small" sx={smallButton} onClick={zoomPicked}>Show</Button>}
                        <Button size="small" sx={smallButton} color="error" onClick={() => onRemove(pickedRows.map(r => r.id))}>Remove</Button>
                        <Button size="small" sx={smallButton} onClick={() => useControlPicks.getState().clear()}>Let go</Button>
                    </>
                ) : (
                    <>
                        <Typography variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 0 }}>
                            Click one here or in the view to pick it; Ctrl adds, Shift picks a run (in the view: Shift+drag a box). In the view a place or a link's end is dragged to another place; Delete removes what is picked.
                        </Typography>
                        <Button size="small" sx={smallButton} color="error" onClick={() => onRemove(null)}>Remove all</Button>
                    </>
                )}
            </Box>
            {pickedRows.length > 0 && onChange && (
                <PickedEditor
                    rows={pickedRows} usualAlong={lenses ? usualAlong : null} sideName={sideName}
                    onChange={(ids, change) => onChange(changedMarks(marks, ids, change))}
                />
            )}
        </Box>
    );
};
