/**
 * The classes of one tab: Default, painted groups, then the field classes
 * (draw order: later rows on top). Click / Shift / Ctrl select; drag the
 * handle to reorder; double-click renames; the symbol opens the style
 * popover for every selected class; right-click for the class menu.
 *
 * Keys (list focused): Up/Down move (Shift extends), Space show/hide,
 * Enter style, F2 rename, Delete remove, Ctrl+A select all,
 * Alt+Up/Down reorder, Esc clear selection.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Divider, ListItemIcon, ListItemText, Menu, MenuItem, Typography } from '@mui/material';
import {
    Visibility, CenterFocusStrong, HighlightAlt, Brush, Palette, Edit, Straighten, MergeType,
    VerticalAlignTop, VerticalAlignBottom, ContentCopy, Delete,
} from '@mui/icons-material';
import { AttributeConfig, AttributeEntry, AttributeType, TAB_NAMES, useAttributeStore } from '../../store/attributeStore';
import { useAppStore, useAnalyticalStore } from '../../store/appStore';
import { useStyleInputs } from '../../hooks/useStyleInputs';
import { entryRowCounts, entryRows } from '../../utils/attributeUtils';
import { copyClassificationTo } from '../../utils/attributeClassify';
import { useUIStore } from '../../store/uiStore';
import { ClassRow, ROW_HEIGHT } from './ClassRow';
import { StylePopover } from './StylePopover';

const WINDOW_FROM = 200;   // rows before the list renders only what is on screen
const OVERSCAN = 12;

type Section = 'default' | 'custom' | 'class';

export const ClassList: React.FC<{ tab: AttributeType; config: AttributeConfig }> = ({ tab, config }) => {
    const customEntries = useAttributeStore(s => s.customEntries);
    const selectedIds = useAttributeStore(s => s.selectedEntryIds);
    const paintMode = useAttributeStore(s => s.paintMode);
    const activeEntryId = useAttributeStore(s => s.activeEntryId);
    const columnarData = useAppStore(s => s.columnarData);
    const analytical = useAnalyticalStore();
    const styleInputs = useStyleInputs();

    const entries = useMemo(() => {
        const def = config.entries.filter(e => e.isDefault);
        return [...def, ...customEntries, ...config.entries.filter(e => !e.isDefault)];
    }, [config.entries, customEntries]);
    const ids = useMemo(() => entries.map(e => e.id), [entries]);
    const byId = useMemo(() => new Map(entries.map(e => [e.id, e])), [entries]);
    const sectionOf = useCallback((e: AttributeEntry): Section => (e.isDefault ? 'default' : e.isCustom ? 'custom' : 'class'), []);

    // Live counts from the shared style result (no extra passes over the data)
    const counts = useMemo(() => {
        void styleInputs;
        const n = columnarData.rowCount;
        return n ? entryRowCounts(tab, n, c => analytical.columns.get(c)) : null;
    }, [tab, columnarData, analytical, styleInputs]);
    const countOf = (e: AttributeEntry) => (counts ? counts.get(e.isDefault ? '' : e.id) ?? { total: 0, visible: 0 } : null);

    // ---- focus, editing, popovers -------------------------------------------------
    const [focusId, setFocusId] = useState<string | null>(null);
    const [editing, setEditing] = useState<{ id: string; what: 'name' | 'breaks' } | null>(null);
    const [style, setStyle] = useState<{ el: HTMLElement; ids: string[] } | null>(null);
    const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
    const [drop, setDrop] = useState<{ id: string; pos: 'before' | 'after' } | null>(null);
    const dragId = useRef<string | null>(null);
    const listRef = useRef<HTMLDivElement>(null);
    // latest values for the stable row callbacks
    const live = useRef({ entries, ids, byId, selectedIds, paintMode, tab, focusId });
    live.current = { entries, ids, byId, selectedIds, paintMode, tab, focusId };

    useEffect(() => { setEditing(null); setMenu(null); setStyle(null); }, [tab]);

    const store = () => useAttributeStore.getState();
    const targetsFor = (id: string) => {
        const { selectedIds: sel } = live.current;
        return sel.includes(id) ? sel : [id];
    };

    const toggleVisible = useCallback((id: string) => {
        const { byId: m, tab: t } = live.current;
        const e = m.get(id);
        if (!e) return;
        const ids2 = targetsFor(id);
        store().batchToggleVisibility(t, ids2, !e.visible);
    }, []);

    const select = useCallback((id: string, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => {
        const s = store();
        const { ids: all, byId: m, paintMode: paint, tab: t } = live.current;
        const entry = m.get(id);
        if (paint && entry && !entry.isDefault) {
            // Paint target: a painted group, or a class (rows join a group with its name and style)
            if (entry.isCustom) s.setActiveEntryId(id);
            else s.paintIntoEntry(t, entry.name);
        }
        if (e.ctrlKey || e.metaKey) s.toggleSelectedEntryId(id);
        else if (e.shiftKey) s.selectEntryRange(id, all);
        else s.setSelectedEntryIds([id]);
        setFocusId(id);
    }, []);

    const onRowMouseDown = useCallback((id: string, e: React.MouseEvent) => {
        if (e.button !== 0) return;
        listRef.current?.focus({ preventScroll: true });
        select(id, e);
    }, [select]);

    const onSymbolClick = useCallback((id: string, el: HTMLElement) => {
        const { byId: m, tab: t } = live.current;
        const e = m.get(id);
        if (!e || (t === 'filter' && !e.isCustom)) return;
        const sel = live.current.selectedIds;
        if (!sel.includes(id)) store().setSelectedEntryIds([id]);
        setFocusId(id);
        setStyle({ el, ids: sel.includes(id) ? sel : [id] });
    }, []);

    const onContextMenu = useCallback((id: string, e: React.MouseEvent) => {
        e.preventDefault();
        if (!live.current.selectedIds.includes(id)) store().setSelectedEntryIds([id]);
        setFocusId(id);
        setMenu({ x: e.clientX, y: e.clientY, id });
    }, []);

    const onStartEdit = useCallback((id: string, what: 'name' | 'breaks') => setEditing({ id, what }), []);

    const onCommitName = useCallback((id: string, name: string | null) => {
        setEditing(null);
        listRef.current?.focus({ preventScroll: true });
        const e = live.current.byId.get(id);
        if (!e || name === null || name === e.name) return;
        if (e.isCustom) store().updateCustomEntry(id, { name });
        else store().updateEntry(live.current.tab, id, { name });
    }, []);

    const onCommitBreaks = useCallback((id: string, min: number | null, max: number | null) => {
        setEditing(null);
        listRef.current?.focus({ preventScroll: true });
        const e = live.current.byId.get(id);
        if (!e) return;
        if (min !== null && min !== e.min) store().setBreak(live.current.tab, id, 'min', min);
        if (max !== null && max !== e.max) store().setBreak(live.current.tab, id, 'max', max);
    }, []);

    // ---- reorder ----------------------------------------------------------------
    const moveTo = useCallback((moving: string[], targetId: string, pos: 'before' | 'after') => {
        const { entries: all, byId: m, tab: t } = live.current;
        const target = m.get(targetId);
        if (!target) return;
        const section = sectionOf(target);
        if (section === 'default') return;
        const same = all.filter(e => sectionOf(e) === section);
        const movingSet = new Set(moving.filter(id => m.get(id) && sectionOf(m.get(id)!) === section));
        if (!movingSet.size || movingSet.has(targetId)) return;
        const rest = same.filter(e => !movingSet.has(e.id)).map(e => e.id);
        const at = rest.indexOf(targetId) + (pos === 'after' ? 1 : 0);
        const ordered = same.filter(e => movingSet.has(e.id)).map(e => e.id);
        rest.splice(at, 0, ...ordered);
        store().reorderEntries(t, rest);
    }, [sectionOf]);

    const step = (dir: -1 | 1) => {
        const { entries: all, selectedIds: sel, byId: m } = live.current;
        if (!sel.length) return;
        const first = m.get(sel[0]);
        if (!first) return;
        const section = sectionOf(first);
        const same = all.filter(e => sectionOf(e) === section).map(e => e.id);
        const idx = sel.map(id => same.indexOf(id)).filter(i => i >= 0).sort((a, b) => a - b);
        if (!idx.length) return;
        if (dir === -1 && idx[0] === 0) return;
        if (dir === 1 && idx[idx.length - 1] === same.length - 1) return;
        const target = dir === -1 ? same[idx[0] - 1] : same[idx[idx.length - 1] + 1];
        moveTo(sel, target, dir === -1 ? 'before' : 'after');
    };

    const onDragStart = useCallback((id: string, e: React.DragEvent) => {
        dragId.current = id;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', id);
    }, []);

    const onDragOver = useCallback((id: string, e: React.DragEvent) => {
        const from = dragId.current;
        if (!from) return;
        const { byId: m } = live.current;
        const a = m.get(from), b = m.get(id);
        if (!a || !b || sectionOf(a) !== sectionOf(b) || sectionOf(b) === 'default') return;
        e.preventDefault();
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const pos = e.clientY < r.top + r.height / 2 ? 'before' : 'after';
        setDrop(d => (d && d.id === id && d.pos === pos ? d : { id, pos }));
    }, [sectionOf]);

    const onDrop = useCallback((id: string, e: React.DragEvent) => {
        e.preventDefault();
        const from = dragId.current;
        dragId.current = null;
        setDrop(null);
        if (!from) return;
        const sel = live.current.selectedIds.includes(from) ? live.current.selectedIds : [from];
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        moveTo(sel, id, e.clientY < r.top + r.height / 2 ? 'before' : 'after');
    }, [moveTo]);

    // Pointing at a class rings its points in every plot; a short delay so
    // sweeping the pointer across the list does not redraw every plot per row
    const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const onHover = useCallback((id: string | null) => {
        if (hoverTimer.current) clearTimeout(hoverTimer.current);
        const e = id ? live.current.byId.get(id) : undefined;
        const next = e ? { tab: live.current.tab, id: e.isDefault ? '' : e.id } : null;
        hoverTimer.current = setTimeout(() => useUIStore.getState().setHoveredClass(next), next ? 180 : 60);
    }, []);
    useEffect(() => () => {
        if (hoverTimer.current) clearTimeout(hoverTimer.current);
        useUIStore.getState().setHoveredClass(null);
    }, []);

    // ---- actions ----------------------------------------------------------------
    const removeIds = (rm: string[]) => {
        const { byId: m, tab: t } = live.current;
        const del = rm.filter(id => m.get(id) && !m.get(id)!.isDefault);
        if (del.length) store().batchDeleteEntries(t, del);
    };

    const selectRowsInPlots = (sel: string[]) => {
        const rows = new Set<number>();
        for (const id of sel) {
            const e = live.current.byId.get(id);
            if (e) for (const r of entryRows(live.current.tab, e.isDefault ? '' : id)) rows.add(r);
        }
        useAppStore.getState().setSelection([...rows].sort((a, b) => a - b));
    };

    const paintSelectionInto = (id: string) => {
        const e = live.current.byId.get(id);
        const rows = useAppStore.getState().selectedIndices;
        if (!e || e.isDefault || !rows.length) return;
        const s = store();
        if (e.isCustom) s.setActiveEntryId(id);
        else s.paintIntoEntry(live.current.tab, e.name);
        store().paintIndicesToActiveEntry(rows);
    };

    // ---- keyboard ---------------------------------------------------------------
    const onKeyDown = (e: React.KeyboardEvent) => {
        if (editing) return;
        const { ids: all, selectedIds: sel, focusId: f } = live.current;
        const s = store();
        const cur = f && all.includes(f) ? all.indexOf(f) : -1;
        const handled = () => { e.preventDefault(); e.stopPropagation(); };
        if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && e.altKey) {
            handled();
            step(e.key === 'ArrowUp' ? -1 : 1);
            return;
        }
        switch (e.key) {
            case 'ArrowDown':
            case 'ArrowUp': {
                handled();
                if (!all.length) return;
                const next = all[Math.max(0, Math.min(all.length - 1, cur + (e.key === 'ArrowDown' ? 1 : -1)))] ?? all[0];
                if (e.shiftKey) s.selectEntryRange(next, all);
                else s.setSelectedEntryIds([next]);
                setFocusId(next);
                return;
            }
            case 'Home': case 'End': {
                handled();
                const next = e.key === 'Home' ? all[0] : all[all.length - 1];
                if (next) { s.setSelectedEntryIds([next]); setFocusId(next); }
                return;
            }
            case ' ':
                handled();
                if (f) toggleVisible(f);
                return;
            case 'Enter': {
                handled();
                if (!f) return;
                const el = listRef.current?.querySelector(`[data-entry-id="${CSS.escape(f)}"] [aria-label="Edit style"]`) as HTMLElement | null;
                if (el) onSymbolClick(f, el);
                return;
            }
            case 'F2':
                handled();
                if (f && !live.current.byId.get(f)?.isDefault) setEditing({ id: f, what: 'name' });
                return;
            case 'Delete':
            case 'Backspace':
                handled();
                removeIds(sel.length ? sel : f ? [f] : []);
                return;
            case 'Escape':
                if (sel.length) { handled(); s.clearSelection(); }
                return;
            case 'a':
            case 'A':
                if (e.ctrlKey || e.metaKey) { handled(); s.setSelectedEntryIds(all.filter(id => !live.current.byId.get(id)?.isDefault)); }
                return;
        }
    };

    // ---- windowing --------------------------------------------------------------
    const [scrollTop, setScrollTop] = useState(0);
    const [viewH, setViewH] = useState(400);
    useEffect(() => {
        const el = listRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => setViewH(el.clientHeight));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    // keep the focused row on screen (rows outside the window are not rendered)
    useEffect(() => {
        const el = listRef.current;
        if (!el || !focusId) return;
        const k = ids.indexOf(focusId);
        if (k < 0) return;
        const top = k * ROW_HEIGHT, bottom = top + ROW_HEIGHT;
        if (top < el.scrollTop) el.scrollTop = top;
        else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
    }, [focusId, ids]);

    const windowed = entries.length > WINDOW_FROM;
    const start = windowed ? Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN) : 0;
    const end = windowed ? Math.min(entries.length, Math.ceil((scrollTop + viewH) / ROW_HEIGHT) + OVERSCAN) : entries.length;

    const selSet = useMemo(() => new Set(selectedIds), [selectedIds]);
    const menuEntry = menu ? byId.get(menu.id) : undefined;
    const menuTargets = menu ? targetsFor(menu.id) : [];
    const mergeable = menuTargets.filter(id => byId.get(id)?.type === 'category').length >= 2;
    const hasSelection = useAppStore(s => s.selectedIndices.length > 0);
    const act = (fn: () => void) => () => { setMenu(null); fn(); };
    const otherTabs = (['color', 'shape', 'size', 'filter'] as AttributeType[]).filter(t => t !== tab);

    return (
        <Box
            ref={listRef}
            role="listbox"
            aria-label={`${TAB_NAMES[tab]} classes`}
            aria-multiselectable
            tabIndex={0}
            onKeyDown={onKeyDown}
            onScroll={windowed ? (e) => setScrollTop((e.target as HTMLElement).scrollTop) : undefined}
            onDragEnd={() => { dragId.current = null; setDrop(null); }}
            sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', outline: 'none', py: 0.25 }}
        >
            {windowed && <Box sx={{ height: start * ROW_HEIGHT }} />}
            {entries.slice(start, end).map(e => (
                <ClassRow
                    key={e.id}
                    entry={e}
                    tab={tab}
                    selected={selSet.has(e.id)}
                    focused={focusId === e.id}
                    paintTarget={paintMode && activeEntryId === e.id}
                    counts={countOf(e)}
                    editing={editing?.id === e.id ? editing.what : null}
                    draggable={!e.isDefault}
                    dropMark={drop?.id === e.id ? drop.pos : null}
                    onRowMouseDown={onRowMouseDown}
                    onToggleVisible={toggleVisible}
                    onSymbolClick={onSymbolClick}
                    onContextMenu={onContextMenu}
                    onStartEdit={onStartEdit}
                    onCommitName={onCommitName}
                    onCommitBreaks={onCommitBreaks}
                    onDragStart={onDragStart}
                    onDragOver={onDragOver}
                    onDrop={onDrop}
                    onHover={onHover}
                />
            ))}
            {windowed && <Box sx={{ height: (entries.length - end) * ROW_HEIGHT }} />}
            {entries.length <= 1 && (
                <Typography variant="caption" color="text.secondary" component="div" sx={{ px: 1.5, py: 1 }}>
                    {config.field
                        ? 'No classes: the field has no values.'
                        : `Choose a field above to classify by ${TAB_NAMES[tab].toLowerCase()}, or paint groups with the brush.`}
                </Typography>
            )}

            <StylePopover
                anchorEl={style?.el ?? null}
                tab={tab}
                targets={(style?.ids ?? []).map(id => byId.get(id)).filter((e): e is AttributeEntry => !!e)}
                onClose={() => { setStyle(null); listRef.current?.focus({ preventScroll: true }); }}
            />

            <Menu
                open={!!menu}
                onClose={() => setMenu(null)}
                anchorReference="anchorPosition"
                anchorPosition={menu ? { top: menu.y, left: menu.x } : undefined}
                slotProps={{ paper: { sx: { minWidth: 220 } } }}
                MenuListProps={{ dense: true }}
            >
                <MenuItem onClick={act(() => store().showOnly(tab, menuTargets))}>
                    <ListItemIcon><CenterFocusStrong fontSize="small" /></ListItemIcon>
                    <ListItemText>{menuTargets.length > 1 ? 'Show only these' : 'Show only this'}</ListItemText>
                </MenuItem>
                <MenuItem onClick={act(() => store().batchToggleVisibility(tab, ids, true))}>
                    <ListItemIcon><Visibility fontSize="small" /></ListItemIcon>
                    <ListItemText>Show all</ListItemText>
                </MenuItem>
                <MenuItem onClick={act(() => selectRowsInPlots(menuTargets))}>
                    <ListItemIcon><HighlightAlt fontSize="small" /></ListItemIcon>
                    <ListItemText>Select these rows in plots</ListItemText>
                </MenuItem>
                {menuEntry && !menuEntry.isDefault && (
                    <MenuItem disabled={!hasSelection} onClick={act(() => paintSelectionInto(menuEntry.id))}>
                        <ListItemIcon><Brush fontSize="small" /></ListItemIcon>
                        <ListItemText>Paint selected rows into this</ListItemText>
                    </MenuItem>
                )}
                <Divider />
                {menuEntry && !(tab === 'filter' && !menuEntry.isCustom) && (
                    <MenuItem onClick={act(() => {
                        const el = listRef.current?.querySelector(`[data-entry-id="${CSS.escape(menuEntry.id)}"] [aria-label="Edit style"]`) as HTMLElement | null;
                        if (el) setStyle({ el, ids: menuTargets });
                    })}>
                        <ListItemIcon><Palette fontSize="small" /></ListItemIcon>
                        <ListItemText>Style…</ListItemText>
                        <Typography variant="caption" color="text.secondary">Enter</Typography>
                    </MenuItem>
                )}
                {menuEntry && !menuEntry.isDefault && (
                    <MenuItem onClick={act(() => setEditing({ id: menuEntry.id, what: 'name' }))}>
                        <ListItemIcon><Edit fontSize="small" /></ListItemIcon>
                        <ListItemText>Rename</ListItemText>
                        <Typography variant="caption" color="text.secondary">F2</Typography>
                    </MenuItem>
                )}
                {menuEntry?.type === 'range' && (
                    <MenuItem onClick={act(() => setEditing({ id: menuEntry.id, what: 'breaks' }))}>
                        <ListItemIcon><Straighten fontSize="small" /></ListItemIcon>
                        <ListItemText>Edit breaks…</ListItemText>
                    </MenuItem>
                )}
                {mergeable && (
                    <MenuItem onClick={act(() => store().mergeEntries(tab, menuTargets))}>
                        <ListItemIcon><MergeType fontSize="small" /></ListItemIcon>
                        <ListItemText>Merge {menuTargets.length} classes</ListItemText>
                    </MenuItem>
                )}
                {menuEntry && !menuEntry.isDefault && [
                    <MenuItem key="top" onClick={act(() => {
                        const first = entries.find(e => sectionOf(e) === sectionOf(menuEntry) && !menuTargets.includes(e.id));
                        if (first) moveTo(menuTargets, first.id, 'before');
                    })}>
                        <ListItemIcon><VerticalAlignTop fontSize="small" /></ListItemIcon>
                        <ListItemText>Move to top (drawn first)</ListItemText>
                    </MenuItem>,
                    <MenuItem key="bottom" onClick={act(() => {
                        const last = [...entries].reverse().find(e => sectionOf(e) === sectionOf(menuEntry) && !menuTargets.includes(e.id));
                        if (last) moveTo(menuTargets, last.id, 'after');
                    })}>
                        <ListItemIcon><VerticalAlignBottom fontSize="small" /></ListItemIcon>
                        <ListItemText>Move to bottom (drawn on top)</ListItemText>
                    </MenuItem>,
                ]}
                {config.field && <Divider />}
                {config.field && otherTabs.map(t => (
                    <MenuItem key={t} onClick={act(() => copyClassificationTo(tab, [t]))}>
                        <ListItemIcon><ContentCopy fontSize="small" /></ListItemIcon>
                        <ListItemText>Same classes on {TAB_NAMES[t]}</ListItemText>
                    </MenuItem>
                ))}
                {menuEntry && !menuEntry.isDefault && <Divider />}
                {menuEntry && !menuEntry.isDefault && (
                    <MenuItem onClick={act(() => removeIds(menuTargets))}>
                        <ListItemIcon><Delete fontSize="small" /></ListItemIcon>
                        <ListItemText>{menuTargets.length > 1 ? `Remove ${menuTargets.length} classes` : 'Remove'}</ListItemText>
                        <Typography variant="caption" color="text.secondary">Del</Typography>
                    </MenuItem>
                )}
            </Menu>
        </Box>
    );
};
