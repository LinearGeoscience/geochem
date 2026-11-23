/**
 * Hole finder: a panel beside the 3D view listing every hole ID, with a search
 * box. Pointing at a hole in the list shows where it is in the view; clicking
 * it (or Enter) zooms to it, lights it up for a moment and leaves a name tag on
 * its collar until the list is closed or the tag is removed. Presentational: Viewer3D owns
 * the found hole and what the actions do.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, IconButton, InputAdornment, Paper, TextField, Tooltip, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Clear, Close, Search } from '@mui/icons-material';
import { HoleInfo, searchHoles, holeSummary } from './holes';

/** Colour of a found hole's line and name in the view, and of its row here. */
export const HOLE_MARK_COLOR = '#c2185b';

export const HOLE_PANEL_WIDTH = 236;
const ROW_HEIGHT = 26;
/** Rows drawn above and below the visible part of the list */
const OVERSCAN = 6;

export interface HolePanelProps {
    holes: HoleInfo[];
    height: number;
    /** ID of the hole with the name tag in the view */
    found: string | null;
    /** A hole just clicked in the view: the list scrolls to it */
    pointedAt: string | null;
    /** Changes when the search box should take the keyboard (Ctrl+F in the view) */
    focusSignal: number;
    canSection: boolean;
    /** Show where a hole is while the pointer or the arrow keys are on it (null: none) */
    onPreview: (id: string | null) => void;
    /** Tag a hole and zoom to it */
    onFind: (id: string) => void;
    onClearFound: () => void;
    onZoom: (id: string) => void;
    /** Select the hole's samples (`add`: keep the current selection too) */
    onSelect: (id: string, add: boolean) => void;
    /** Show the hole on its own */
    onIsolate: (id: string) => void;
    /** Cut the vertical section through the hole */
    onSection: (id: string) => void;
    onClose: () => void;
}

const actionButton = { minWidth: 0, px: 0.75, py: 0, height: 24, fontSize: 12, textTransform: 'none' } as const;

export const HolePanel: React.FC<HolePanelProps> = ({
    holes, height, found, pointedAt, focusSignal, canSection,
    onPreview, onFind, onClearFound, onZoom, onSelect, onIsolate, onSection, onClose,
}) => {
    const [query, setQuery] = useState('');
    /** The row the arrow keys are on (in the filtered list); -1: none */
    const [cursor, setCursor] = useState(-1);
    const [scrollTop, setScrollTop] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const [listHeight, setListHeight] = useState(200);

    const shown = useMemo(() => searchHoles(holes, query), [holes, query]);
    const foundHole = useMemo(() => (found === null ? null : holes.find(h => h.id === found) ?? null), [holes, found]);

    useEffect(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        el.select();
    }, [focusSignal]);

    // The list's own height (the panel's, less the search box and the found hole's card)
    useEffect(() => {
        const el = listRef.current;
        if (!el) return;
        const measure = () => setListHeight(el.clientHeight);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    const scrollToRow = (row: number) => {
        const el = listRef.current;
        if (!el || row < 0) return;
        const top = row * ROW_HEIGHT;
        if (top < el.scrollTop) el.scrollTop = top;
        else if (top + ROW_HEIGHT > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_HEIGHT - el.clientHeight;
    };

    // A new search starts at its best match
    useEffect(() => {
        setCursor(query.trim() && shown.length ? 0 : -1);
        if (listRef.current) listRef.current.scrollTop = 0;
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the text changes
    }, [query]);

    // A hole clicked in the view: bring its row into view
    useEffect(() => {
        if (pointedAt === null) return;
        const row = shown.findIndex(h => h.id === pointedAt);
        if (row < 0) return;
        setCursor(row);
        const el = listRef.current;
        if (el) el.scrollTop = Math.max(0, row * ROW_HEIGHT - el.clientHeight / 2 + ROW_HEIGHT / 2);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only when another hole is clicked
    }, [pointedAt]);

    const moveCursor = (to: number) => {
        if (shown.length === 0) return;
        const row = Math.min(shown.length - 1, Math.max(0, to));
        setCursor(row);
        scrollToRow(row);
        onPreview(shown[row].id);
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
        const page = Math.max(1, Math.floor(listHeight / ROW_HEIGHT) - 1);
        if (e.key === 'ArrowDown') { e.preventDefault(); moveCursor(cursor + 1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); moveCursor(cursor - 1); }
        else if (e.key === 'PageDown') { e.preventDefault(); moveCursor(cursor + page); }
        else if (e.key === 'PageUp') { e.preventDefault(); moveCursor(cursor - page); }
        else if (e.key === 'Enter') {
            const hole = shown[cursor] ?? shown[0];
            if (hole) { e.preventDefault(); onPreview(null); onFind(hole.id); }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onPreview(null);
            if (query) setQuery('');
            else onClose();
        }
    };

    const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const last = Math.min(shown.length, Math.ceil((scrollTop + listHeight) / ROW_HEIGHT) + OVERSCAN);

    return (
        <Paper
            data-testid="hole-panel" variant="outlined"
            sx={{ width: HOLE_PANEL_WIDTH, flexShrink: 0, height, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
            onPointerLeave={() => onPreview(null)}
        >
            <Box sx={{ p: 0.75, pb: 0.5, display: 'flex', alignItems: 'center', gap: 0.25 }}>
                <TextField
                    size="small" fullWidth placeholder="Find a hole" value={query} inputRef={inputRef}
                    onChange={e => setQuery(e.target.value)} onKeyDown={onKeyDown}
                    inputProps={{ 'aria-label': 'Find a hole', spellCheck: false, autoComplete: 'off' }}
                    InputProps={{
                        sx: { height: 30, fontSize: 13 },
                        startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment>,
                        endAdornment: query ? (
                            <InputAdornment position="end">
                                <IconButton size="small" edge="end" aria-label="Clear the search" onClick={() => { setQuery(''); inputRef.current?.focus(); }}><Clear fontSize="small" /></IconButton>
                            </InputAdornment>
                        ) : undefined,
                    }}
                />
                <Tooltip title="Close the hole list"><IconButton size="small" aria-label="Close the hole list" onClick={onClose}><Close fontSize="small" /></IconButton></Tooltip>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ px: 1, pb: 0.25 }}>
                {query.trim()
                    ? `${shown.length.toLocaleString()} of ${holes.length.toLocaleString()} holes`
                    : `${holes.length.toLocaleString()} hole${holes.length === 1 ? '' : 's'}`}
                {shown.length > 0 ? ' · ↑ ↓ Enter' : ''}
            </Typography>

            <Box
                ref={listRef} role="listbox" aria-label="Holes" data-testid="hole-list"
                onScroll={e => setScrollTop((e.target as HTMLDivElement).scrollTop)}
                sx={{ flex: 1, minHeight: 0, overflowY: 'auto', borderTop: 1, borderColor: 'divider' }}
            >
                {shown.length === 0 ? (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', p: 1 }}>No hole matches “{query.trim()}”.</Typography>
                ) : (
                    // Only the rows in view are drawn: thousands of holes stay quick
                    <Box sx={{ height: shown.length * ROW_HEIGHT, position: 'relative' }}>
                        {shown.slice(first, last).map((hole, k) => {
                            const row = first + k;
                            const isFound = hole.id === found;
                            return (
                                <Box
                                    key={hole.id} role="option" aria-selected={isFound} data-hole={hole.id}
                                    onPointerEnter={() => onPreview(hole.id)}
                                    onClick={() => { setCursor(row); onFind(hole.id); }}
                                    sx={theme => ({
                                        position: 'absolute', top: row * ROW_HEIGHT, left: 0, right: 0, height: ROW_HEIGHT,
                                        display: 'flex', alignItems: 'center', gap: 1, px: 1, cursor: 'pointer', userSelect: 'none',
                                        borderLeft: '3px solid', borderLeftColor: isFound ? HOLE_MARK_COLOR : 'transparent',
                                        bgcolor: isFound ? alpha(HOLE_MARK_COLOR, 0.12) : row === cursor ? theme.palette.action.selected : undefined,
                                        '&:hover': { bgcolor: isFound ? alpha(HOLE_MARK_COLOR, 0.18) : theme.palette.action.hover },
                                    })}
                                >
                                    <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: isFound ? 600 : 400 }}>{hole.id}</Typography>
                                    <Typography variant="caption" color="text.secondary" noWrap sx={{ flexShrink: 0 }}>{holeSummary(hole)}</Typography>
                                </Box>
                            );
                        })}
                    </Box>
                )}
            </Box>

            {foundHole && (
                <Box data-testid="hole-found" onPointerEnter={() => onPreview(foundHole.id)} sx={{ borderTop: 1, borderColor: 'divider', p: 0.75, bgcolor: alpha(HOLE_MARK_COLOR, 0.06) }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: HOLE_MARK_COLOR, flexShrink: 0 }} />
                        <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0, fontWeight: 600 }}>{foundHole.id}</Typography>
                        <Tooltip title="Remove the tag from this hole (closing the list removes it too)"><IconButton size="small" sx={{ p: 0.25 }} aria-label="Remove the tag from this hole" onClick={onClearFound}><Close fontSize="small" /></IconButton></Tooltip>
                    </Box>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                        {foundHole.rows.length.toLocaleString()} sample{foundHole.rows.length === 1 ? '' : 's'}
                        {foundHole.depthFrom !== null && foundHole.depthTo !== null && foundHole.depthTo > foundHole.depthFrom ? ` · ${holeSummary(foundHole)}` : ''}
                    </Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                        <Tooltip title="Zoom to this hole, keeping the direction you are looking in, and light it up for a moment">
                            <Button size="small" variant="outlined" sx={actionButton} onClick={() => onZoom(foundHole.id)}>Zoom</Button>
                        </Tooltip>
                        <Tooltip title="Select its samples, here and in every other plot and the data grid (Shift: add to the selection)">
                            <Button size="small" variant="outlined" sx={actionButton} onClick={e => onSelect(foundHole.id, e.shiftKey)}>Select</Button>
                        </Tooltip>
                        <Tooltip title="Show this hole on its own (selects it and hides the rest; the “Selection only” chip brings the rest back)">
                            <Button size="small" variant="outlined" sx={actionButton} onClick={() => onIsolate(foundHole.id)}>Only this</Button>
                        </Tooltip>
                        <Tooltip title={canSection ? 'Slice the vertical section through this hole ( L then looks at it )' : 'Needs coordinates in three dimensions'}>
                            <span><Button size="small" variant="outlined" sx={actionButton} disabled={!canSection} onClick={() => onSection(foundHole.id)}>Section</Button></span>
                        </Tooltip>
                    </Box>
                </Box>
            )}
        </Paper>
    );
};
