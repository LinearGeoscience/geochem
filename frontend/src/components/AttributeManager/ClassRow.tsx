/**
 * One row of the class list: drag handle, eye, symbol (colour + shape + size
 * together, as the plots draw it), name and visible / total rows. Memoised:
 * a change to one class re-renders only that row.
 */
import React, { useRef, useState } from 'react';
import { Box, InputBase, Typography } from '@mui/material';
import { DragIndicator, Visibility, VisibilityOff, Brush } from '@mui/icons-material';
import { AttributeEntry, AttributeType, formatBreak } from '../../store/attributeStore';
import { ShapeMarker } from '../ShapeMarker';

export const ROW_HEIGHT = 26;

export interface RowCounts { total: number; visible: number }

interface Props {
    entry: AttributeEntry;
    tab: AttributeType;
    selected: boolean;
    focused: boolean;
    paintTarget: boolean;
    counts: RowCounts | null;
    /** 'name' = rename, 'breaks' = edit min / max */
    editing: 'name' | 'breaks' | null;
    draggable: boolean;
    dropMark: 'before' | 'after' | null;
    onRowMouseDown: (id: string, e: React.MouseEvent) => void;
    onToggleVisible: (id: string) => void;
    onSymbolClick: (id: string, el: HTMLElement) => void;
    onContextMenu: (id: string, e: React.MouseEvent) => void;
    onStartEdit: (id: string, what: 'name' | 'breaks') => void;
    onCommitName: (id: string, name: string | null) => void;
    onCommitBreaks: (id: string, min: number | null, max: number | null) => void;
    onDragStart: (id: string, e: React.DragEvent) => void;
    onDragOver: (id: string, e: React.DragEvent) => void;
    onDrop: (id: string, e: React.DragEvent) => void;
    onHover: (id: string | null) => void;
}

/** The marker as the plots draw it for this tab's property (painted groups: everything they set) */
export const ClassSymbol: React.FC<{ entry: AttributeEntry; tab: AttributeType }> = ({ entry, tab }) => {
    const all = entry.isCustom;
    const colour = (tab === 'color' || all) && entry.color ? entry.color : '#9e9e9e';
    const shape = (tab === 'shape' || all) && entry.shape ? entry.shape : 'circle';
    const size = (tab === 'size' || all) && entry.size ? Math.max(6, Math.min(18, entry.size * 1.1)) : 13;
    return (
        <Box sx={{ width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: entry.opacity ?? 1 }}>
            {tab === 'filter' && !all
                ? <Box sx={{ width: 12, height: 12, borderRadius: 0.5, border: '1px solid', borderColor: 'text.secondary' }} />
                : <ShapeMarker shape={shape} color={colour} size={size} />}
        </Box>
    );
};

const BreakEditor: React.FC<{ entry: AttributeEntry; onCommit: (min: number | null, max: number | null) => void }> = ({ entry, onCommit }) => {
    const [min, setMin] = useState(entry.min !== undefined ? formatBreak(entry.min) : '');
    const [max, setMax] = useState(entry.max !== undefined ? formatBreak(entry.max) : '');
    const done = useRef(false);
    const commit = (ok: boolean) => {
        if (done.current) return;
        done.current = true;
        const parse = (s: string) => (s.trim() === '' || Number.isNaN(Number(s)) ? null : Number(s));
        onCommit(ok ? parse(min) : null, ok ? parse(max) : null);
    };
    const keys = (e: React.KeyboardEvent) => {
        e.stopPropagation();
        if (e.key === 'Enter') commit(true);
        if (e.key === 'Escape') commit(false);
    };
    const input = { fontSize: '0.72rem', px: 0.5, border: '1px solid', borderColor: 'primary.main', borderRadius: 0.5, width: 64, height: 20 };
    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) commit(true); }}>
            <InputBase autoFocus value={min} onChange={(e) => setMin(e.target.value)} onKeyDown={keys} sx={input} inputProps={{ 'aria-label': 'Class minimum' }} />
            <Typography variant="caption">–</Typography>
            <InputBase value={max} onChange={(e) => setMax(e.target.value)} onKeyDown={keys} sx={input} inputProps={{ 'aria-label': 'Class maximum' }} />
        </Box>
    );
};

const NameEditor: React.FC<{ name: string; onCommit: (name: string | null) => void }> = ({ name, onCommit }) => {
    const [value, setValue] = useState(name);
    const done = useRef(false);
    const commit = (v: string | null) => {
        if (done.current) return;
        done.current = true;
        onCommit(v);
    };
    return (
        <InputBase
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onFocus={(e) => e.target.select()}
            onBlur={() => commit(value.trim() || null)}
            onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') commit(value.trim() || null);
                if (e.key === 'Escape') commit(null);
            }}
            inputProps={{ 'aria-label': 'Class name' }}
            sx={{ flex: 1, fontSize: '0.75rem', px: 0.5, border: '1px solid', borderColor: 'primary.main', borderRadius: 0.5, height: 20 }}
        />
    );
};

const ClassRowImpl: React.FC<Props> = (p) => {
    const { entry, tab, selected, focused, counts, editing } = p;
    const hidden = !entry.visible;
    const id = entry.id;
    const title = entry.type === 'range' && entry.min !== undefined && entry.max !== undefined
        ? `${entry.name}  (${entry.min} ≤ value < ${entry.max})`
        : entry.name;

    return (
        <Box
            role="option"
            aria-selected={selected}
            data-entry-id={id}
            onMouseDown={(e) => p.onRowMouseDown(id, e)}
            onContextMenu={(e) => p.onContextMenu(id, e)}
            onDoubleClick={() => !entry.isDefault && p.onStartEdit(id, 'name')}
            onMouseEnter={() => p.onHover(id)}
            onMouseLeave={() => p.onHover(null)}
            onDragOver={(e) => p.onDragOver(id, e)}
            onDrop={(e) => p.onDrop(id, e)}
            sx={{
                display: 'flex', alignItems: 'center', gap: 0.25, height: ROW_HEIGHT, pr: 0.75, pl: 0.25,
                cursor: 'default', userSelect: 'none', position: 'relative',
                bgcolor: selected ? 'action.selected' : 'transparent',
                outline: focused ? '1px solid' : 'none', outlineColor: 'primary.main', outlineOffset: -1,
                '&:hover': { bgcolor: selected ? 'action.selected' : 'action.hover' },
                '&:hover .drag': { opacity: 0.6 },
                boxShadow: p.dropMark === 'before' ? 'inset 0 2px 0 0 #1976d2' : p.dropMark === 'after' ? 'inset 0 -2px 0 0 #1976d2' : 'none',
            }}
        >
            <Box
                className="drag"
                draggable={p.draggable}
                onDragStart={(e) => p.onDragStart(id, e)}
                onMouseDown={(e) => e.stopPropagation()}
                sx={{ width: 14, display: 'flex', opacity: 0, cursor: p.draggable ? 'grab' : 'default', visibility: p.draggable ? 'visible' : 'hidden' }}
                aria-label="Drag to reorder"
            >
                <DragIndicator sx={{ fontSize: 14 }} />
            </Box>
            <Box
                role="button"
                aria-label={hidden ? 'Show class' : 'Hide class'}
                onMouseDown={(e) => { e.stopPropagation(); p.onToggleVisible(id); }}
                sx={{ width: 22, display: 'flex', justifyContent: 'center', cursor: 'pointer', color: hidden ? 'text.disabled' : 'text.secondary' }}
            >
                {hidden ? <VisibilityOff sx={{ fontSize: 15 }} /> : <Visibility sx={{ fontSize: 15 }} />}
            </Box>
            <Box
                role="button"
                aria-label="Edit style"
                onMouseDown={(e) => { e.stopPropagation(); p.onSymbolClick(id, e.currentTarget); }}
                sx={{ cursor: tab === 'filter' && !entry.isCustom ? 'default' : 'pointer', borderRadius: 0.5, '&:hover': { bgcolor: 'action.hover' }, opacity: hidden ? 0.35 : 1 }}
            >
                <ClassSymbol entry={entry} tab={tab} />
            </Box>
            <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 0.5, ml: 0.5 }}>
                {entry.isCustom && <Brush sx={{ fontSize: 12, color: p.paintTarget ? 'success.main' : 'text.disabled', flexShrink: 0 }} />}
                {editing === 'name'
                    ? <NameEditor name={entry.name} onCommit={(n) => p.onCommitName(id, n)} />
                    : editing === 'breaks'
                        ? <BreakEditor entry={entry} onCommit={(a, b) => p.onCommitBreaks(id, a, b)} />
                        : (
                            <Typography
                                variant="body2"
                                noWrap
                                title={title}
                                sx={{
                                    fontSize: '0.75rem',
                                    fontStyle: entry.isDefault ? 'italic' : 'normal',
                                    color: hidden ? 'text.disabled' : entry.isDefault ? 'text.secondary' : 'text.primary',
                                    fontWeight: p.paintTarget ? 600 : 400,
                                }}
                            >
                                {entry.name}
                            </Typography>
                        )}
            </Box>
            {counts && (
                <Typography
                    variant="caption"
                    title={`${counts.visible.toLocaleString()} visible of ${counts.total.toLocaleString()} rows`}
                    sx={{ fontVariantNumeric: 'tabular-nums', color: 'text.secondary', fontSize: '0.68rem', flexShrink: 0, ml: 0.5 }}
                >
                    {counts.visible === counts.total ? counts.total.toLocaleString() : `${counts.visible.toLocaleString()}/${counts.total.toLocaleString()}`}
                </Typography>
            )}
        </Box>
    );
};

export const ClassRow = React.memo(ClassRowImpl);
