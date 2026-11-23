/**
 * One row of the project tree: the arrow that opens it, an icon for its
 * kind, its colour, its name and note, its state, and at the right its lock
 * and its eye (shown or hidden in the model view the tree acts on).
 * Memoised: a change to one row re-renders that row only.
 */
import React, { useRef, useState } from 'react';
import { Box, IconButton, InputBase, Tooltip, Typography } from '@mui/material';
import {
    AccountTree, CallSplit, Category, ChevronRight, CropFree, DonutLarge, ErrorOutline, ExpandMore, Explore, FolderOpenOutlined, FolderOutlined, FormatListNumbered, Grain,
    HorizontalSplit, HourglassEmpty, Layers, Lock, LockOpen, NorthEast, Place, Polyline, ScatterPlot, SubdirectoryArrowRight, TableRows,
    Update, ViewInAr, ViewStream, Visibility, VisibilityOff, WarningAmber,
} from '@mui/icons-material';
import type { ModelGroupPart } from '../../model/objectKeys';
import type { ObjectType } from '../../model/objectTypes';
import type { NodeStatus, TreeNode, TreeRow as Row } from '../../model/projectTree';
import { statusTip } from '../../model/treeRules';
import { TypeIcon as ObjectTypeIcon } from '../typeIcons';

export const ROW_HEIGHT = 24;
const INDENT = 14;
const icon = { fontSize: 16, flexShrink: 0 } as const;

const ROOT_ICONS: Record<string, React.ReactNode> = {
    'root:drillholes': <Place sx={icon} />,
    'root:structure': <Explore sx={icon} />,
    'root:points': <ScatterPlot sx={icon} />,
    'root:lines': <Polyline sx={icon} />,
    'root:surfaces': <Layers sx={icon} />,
    'root:models': <AccountTree sx={icon} />,
    'root:numeric': <DonutLarge sx={icon} />,
    'root:sections': <HorizontalSplit sx={icon} />,
    'root:meshes': <ViewInAr sx={icon} />,
};

/** The parts a geological model is laid out in */
const GROUP_ICON: Record<ModelGroupPart, typeof Layers> = { boundary: CropFree, lithologies: Category, faults: CallSplit, chronology: FormatListNumbered, volumes: ViewInAr };

/** What a surface, a contact or a fault is to a geologist (the same icon as in the head of its editor) */
function TypeIcon({ type, faint }: { type: ObjectType; faint?: boolean }) {
    return <ObjectTypeIcon type={type} sx={{ ...icon, ...(faint ? { opacity: 0.7 } : {}) }} />;
}

function KindIcon({ node, open }: { node: TreeNode; open: boolean }) {
    switch (node.kind) {
        case 'root': return <>{ROOT_ICONS[node.key] ?? null}</>;
        case 'folder': return open ? <FolderOpenOutlined sx={icon} /> : <FolderOutlined sx={icon} />;
        case 'link': return <SubdirectoryArrowRight sx={{ ...icon, color: 'text.secondary' }} />;
        case 'surface': return node.type ? <TypeIcon type={node.type} /> : <Layers sx={icon} />;
        case 'inputs': return node.sub === 'lines' ? <Polyline sx={icon} /> : <ScatterPlot sx={icon} />;
        case 'readings': return <Explore sx={icon} />;
        case 'structure': return <NorthEast sx={icon} />;
        case 'wireframe': return <ViewInAr sx={icon} />;
        case 'table': return <TableRows sx={icon} />;
        case 'unitMap': return <Category sx={icon} />;
        case 'model': return <AccountTree sx={icon} />;
        case 'numericModel': return <DonutLarge sx={icon} />;
        case 'veinSystem': return <ViewStream sx={icon} />;
        case 'modelGroup': { const Icon = GROUP_ICON[node.sub as ModelGroupPart] ?? FolderOutlined; return <Icon sx={{ ...icon, color: 'text.secondary' }} />; }
        case 'modelContact': return node.type ? <TypeIcon type={node.type} faint /> : <Layers sx={{ ...icon, opacity: 0.7 }} />;
        case 'modelFault': return <TypeIcon type="fault" faint />;
        case 'volume': return <ViewInAr sx={{ ...icon, opacity: 0.7 }} />;
        case 'sectionSet': return <HorizontalSplit sx={icon} />;
        case 'collars': return <Place sx={icon} />;
        case 'dataset': return <Grain sx={icon} />;
        default: return null;
    }
}

const STATUS: Record<NodeStatus, { color: string; Icon: typeof ErrorOutline }> = {
    fitting: { color: 'text.secondary', Icon: HourglassEmpty },
    failed: { color: 'error.main', Icon: ErrorOutline },
    empty: { color: 'warning.main', Icon: WarningAmber },
    missing: { color: 'error.main', Icon: WarningAmber },
    stale: { color: 'info.main', Icon: Update },
    problem: { color: 'warning.main', Icon: WarningAmber },
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
            onChange={e => setValue(e.target.value)}
            onFocus={e => e.target.select()}
            onBlur={() => commit(value)}
            onMouseDown={e => e.stopPropagation()}
            onKeyDown={e => {
                e.stopPropagation();
                if (e.key === 'Enter') commit(value);
                if (e.key === 'Escape') commit(null);
            }}
            inputProps={{ 'aria-label': 'New name' }}
            sx={{ flex: 1, minWidth: 0, fontSize: 13, px: 0.5, border: '1px solid', borderColor: 'primary.main', borderRadius: 0.5, height: 20 }}
        />
    );
};

export type Eye = 'shown' | 'hidden' | 'some' | null;

export interface TreeRowProps {
    row: Row;
    selected: boolean;
    focused: boolean;
    editing: boolean;
    eye: Eye;
    /** The view the eye acts on (null: none open; the eye is greyed) */
    viewTitle: string | null;
    draggable: boolean;
    /** What a drop here would do (null: this row is not where something would go) */
    dropHint: string | null;
    /** The drop is not taken here, and `dropHint` says why */
    dropRefused?: boolean;
    onMouseDown: (key: string, e: React.MouseEvent) => void;
    onClick: (key: string, e: React.MouseEvent) => void;
    onToggle: (key: string) => void;
    onEye: (key: string) => void;
    onLock: (key: string) => void;
    onContextMenu: (key: string, e: React.MouseEvent) => void;
    onDoubleClick: (key: string) => void;
    onCommitName: (key: string, name: string | null) => void;
    onDragStart: (key: string, e: React.DragEvent) => void;
    onDragOver: (key: string, e: React.DragEvent) => void;
    onDrop: (key: string, e: React.DragEvent) => void;
}

const TreeRowImpl: React.FC<TreeRowProps> = (p) => {
    const { row, selected, focused, eye } = p;
    const { node, depth, hasChildren, open } = row;
    /** Something dragged would go here */
    const taking = !!p.dropHint && !p.dropRefused;
    const key = node.key;
    const status = node.status ? STATUS[node.status] : null;
    const asCut = node.kind === 'modelContact' || node.kind === 'modelFault';
    const eyeTip = !p.viewTitle ? 'Open a 3D view to show and hide objects in it'
        // (Its surface, on the row under it, has its own eye)
        : asCut ? (eye === 'hidden' ? `The part of it the model uses is not drawn in ${p.viewTitle}. Draw it there.` : `The part of it the model uses is drawn in ${p.viewTitle}. Stop drawing it there.`)
        : eye === 'hidden' ? `Hidden in ${p.viewTitle}. Show it there.`
            : eye === 'some' ? `Partly shown in ${p.viewTitle}. Show all of it there.`
                : `Shown in ${p.viewTitle}. Hide it there.`;
    return (
        <Box
            role="treeitem"
            aria-level={depth + 1}
            aria-expanded={hasChildren ? open : undefined}
            aria-selected={selected}
            aria-label={node.name}
            data-key={key}
            draggable={p.draggable && !p.editing}
            onMouseDown={e => p.onMouseDown(key, e)}
            onClick={e => p.onClick(key, e)}
            onContextMenu={e => p.onContextMenu(key, e)}
            onDoubleClick={() => p.onDoubleClick(key)}
            onDragStart={e => p.onDragStart(key, e)}
            onDragOver={e => p.onDragOver(key, e)}
            onDrop={e => p.onDrop(key, e)}
            sx={{
                display: 'flex', alignItems: 'center', gap: 0.5, pl: `${4 + depth * INDENT}px`, pr: 0.5, height: ROW_HEIGHT,
                cursor: 'default', userSelect: 'none',
                bgcolor: taking ? 'action.focus' : selected ? 'action.selected' : undefined,
                outline: taking ? '1px dashed' : focused ? '1px solid' : 'none', outlineColor: 'primary.main', outlineOffset: -1,
                '&:hover': { bgcolor: taking ? 'action.focus' : selected ? 'action.selected' : 'action.hover' },
                '&:hover .tree-lock, & .tree-lock:focus-visible': { opacity: 1 },
            }}
        >
            {hasChildren ? (
                <IconButton
                    size="small" tabIndex={-1} aria-label={`${open ? 'Close' : 'Open'} ${node.name}`} sx={{ p: 0 }}
                    onMouseDown={e => e.stopPropagation()}
                    onClick={e => { e.stopPropagation(); p.onToggle(key); }}
                >
                    {open ? <ExpandMore fontSize="small" /> : <ChevronRight fontSize="small" />}
                </IconButton>
            ) : <Box sx={{ width: 20, flexShrink: 0 }} />}
            <KindIcon node={node} open={open} />
            {node.color && <Box sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: node.color, flexShrink: 0 }} />}
            {p.editing ? (
                <NameEditor name={node.name} onCommit={name => p.onCommitName(key, name)} />
            ) : (
                <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 0.75, overflow: 'hidden' }}>
                    <Typography
                        variant="body2" noWrap title={node.name}
                        sx={{
                            fontSize: 13, fontWeight: node.kind === 'root' ? 600 : undefined, flexShrink: 1, minWidth: 0,
                            // (A contact or a fault as its model cuts it is drawn only where it is asked for: off is how it starts, not a thing to grey)
                            color: node.status === 'missing' ? 'error.main' : node.link ? 'text.secondary' : eye === 'hidden' && !asCut ? 'text.disabled' : undefined,
                        }}
                    >
                        {node.name}
                    </Typography>
                    {p.dropHint
                        ? <Typography variant="caption" data-testid={p.dropRefused ? 'drop-refused' : 'drop-hint'} color={p.dropRefused ? 'warning.main' : 'primary'} noWrap title={p.dropHint} sx={p.dropRefused ? { flexShrink: 1, minWidth: 0 } : { flexShrink: 0 }}>{p.dropHint}</Typography>
                        // (The name keeps its width: what is said after it gives way first, and is read in full on hover)
                        : node.detail && <Typography variant="caption" color="text.secondary" noWrap title={node.detail} sx={{ flexShrink: 1000, minWidth: 0 }}>{node.detail}</Typography>}
                </Box>
            )}
            {status && (
                <Tooltip title={statusTip(node)}>
                    <status.Icon aria-label={statusTip(node)} data-status={node.status} sx={{ ...icon, fontSize: 15, color: status.color }} />
                </Tooltip>
            )}
            {node.lockable && (
                <Tooltip title={node.locked ? 'Locked: nothing in it can be moved or removed. Unlock it.' : 'Lock it'}>
                    <IconButton
                        size="small" tabIndex={-1} className="tree-lock" aria-label={`${node.locked ? 'Unlock' : 'Lock'} ${node.name}`}
                        sx={{ p: 0.25, opacity: node.locked ? 1 : 0 }} color={node.locked ? 'primary' : 'default'}
                        onMouseDown={e => e.stopPropagation()}
                        onClick={e => { e.stopPropagation(); p.onLock(key); }}
                    >
                        {node.locked ? <Lock sx={{ fontSize: 15 }} /> : <LockOpen sx={{ fontSize: 15 }} />}
                    </IconButton>
                </Tooltip>
            )}
            {eye && (
                <Tooltip title={eyeTip}>
                    <span>
                        <IconButton
                            size="small" tabIndex={-1} disabled={!p.viewTitle} aria-label={`${eye === 'shown' ? 'Hide' : 'Show'} ${node.name}`}
                            sx={{ p: 0.25, opacity: eye === 'some' ? 0.55 : 1 }}
                            onMouseDown={e => e.stopPropagation()}
                            onClick={e => { e.stopPropagation(); p.onEye(key); }}
                        >
                            {eye === 'hidden' ? <VisibilityOff sx={{ fontSize: 15 }} /> : <Visibility sx={{ fontSize: 15 }} />}
                        </IconButton>
                    </span>
                </Tooltip>
            )}
        </Box>
    );
};

export const TreeRow = React.memo(TreeRowImpl);
