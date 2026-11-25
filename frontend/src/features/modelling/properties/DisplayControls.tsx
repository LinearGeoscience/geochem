/**
 * How a view draws a mesh (or several at once): drawn as solid, solid with
 * its triangle edges, its edges only or its outline; how see-through its
 * faces are; and what a slice does with it (cuts it, leaves it whole, draws
 * its line on the slice's plane, or its section filled there). These are the view's own
 * (features/model/viewDisplay): another view draws the same object as that
 * view has it. Used in the properties of what has no look of its own (a
 * model's solids, its contacts and faults as cut) and in the Scene tab.
 */
import React from 'react';
import { Box, Button, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, ToggleButton, Tooltip, Typography } from '@mui/material';
import { AllOut, ArrowDropDown, BorderOuter, ContentCut, FormatColorFill, Grid4x4, GridOn, HorizontalRule, MoreHoriz, Square } from '@mui/icons-material';
import type { ViewDisplayState } from '../../../hooks/useViewDisplay';
import { useModelStore } from '../../../store/modelStore';
import { defaultOnSlice, DRAWN_AS, DRAWN_AS_NAME, DRAWN_AS_TIP, drawnOf, isSolidKey, ON_SLICE, ON_SLICE_NAME, ON_SLICE_TIP, type DrawnAs, type OnSlice, type OwnLook } from '../../model/viewDisplay';
import { CommitSlider } from './CommitSlider';

const ICON: Record<DrawnAs, React.ReactElement> = {
    solid: <Square sx={{ fontSize: 15 }} />,
    edges: <GridOn sx={{ fontSize: 15 }} />,
    wire: <Grid4x4 sx={{ fontSize: 15 }} />,
    outline: <BorderOuter sx={{ fontSize: 15 }} />,
};

const SLICE_ICON: Record<OnSlice, React.ReactElement> = {
    cut: <ContentCut sx={{ fontSize: 15 }} />,
    line: <HorizontalRule sx={{ fontSize: 15 }} />,
    filled: <FormatColorFill sx={{ fontSize: 15 }} />,
    whole: <AllOut sx={{ fontSize: 15 }} />,
};

/** Across, a choice is said in a word or two on its button (the menu says it in full, with what it does) */
const DRAWN_SHORT: Record<DrawnAs, string> = { solid: 'Solid', edges: 'With edges', wire: 'Edges only', outline: 'Outline' };
const SLICE_SHORT: Record<OnSlice, string> = { line: 'Line', filled: 'Filled', cut: 'Cut', whole: 'Whole' };

/** A choice across a row: its picture and its word, opening the menu of all of them */
const Choice: React.FC<{ icon: React.ReactElement; word: string; label: string; tip: string; off: boolean; marked: boolean; data: Record<string, string>; onOpen: (el: HTMLElement) => void }> = ({ icon, word, label, tip, off, marked, data, onOpen }) => (
    <Tooltip title={tip} enterDelay={600}>
        <span>
            <Button
                size="small" variant="outlined" color={marked ? 'primary' : 'inherit'} disabled={off} aria-haspopup="menu" aria-label={label} {...data}
                startIcon={icon} endIcon={<ArrowDropDown />} onClick={e => onOpen(e.currentTarget)}
                sx={{
                    height: 28, width: 122, px: 1, fontSize: 13, textTransform: 'none', whiteSpace: 'nowrap', justifyContent: 'flex-start', flexShrink: 0,
                    borderColor: marked ? undefined : 'divider', '& .MuiButton-startIcon': { mr: 0.75 }, '& .MuiButton-endIcon': { ml: 'auto', mr: -0.5 },
                    '& .MuiButton-startIcon svg': { fontSize: 17 },
                }}
            >
                {word}
            </Button>
        </span>
    </Tooltip>
);

export interface Shown {
    key: string;
    /** Its own look (a model's solid: opaque, no edges) */
    own: OwnLook;
}

interface Props {
    /** What it acts on: one object, or all of a group */
    objects: readonly Shown[];
    /** What they are called, for the names of the controls */
    name: string;
    view: ViewDisplayState;
    /** In a row of a list: no words, the slider short */
    dense?: boolean;
    /** In a row of a wide list (the Scene list under the views): each choice a button that says it in words, the opacity as a number */
    across?: boolean;
}

/** The one value all have, or null when they differ */
function common<T>(values: readonly T[]): T | null {
    return values.length > 0 && values.every(v => v === values[0]) ? values[0] : null;
}

export const DisplayControls: React.FC<Props> = ({ objects, name, view, dense: narrow, across }) => {
    // (Across: as a row of a list, with the choices as buttons)
    const dense = narrow || across;
    const [shown, setShown] = React.useState<number | null>(null);
    const [menu, setMenu] = React.useState<HTMLElement | null>(null);
    const [sliceMenu, setSliceMenu] = React.useState<HTMLElement | null>(null);
    const surfaces = useModelStore(s => s.scene.surfaces);
    if (objects.length === 0) return null;
    const usualOf = (key: string) => defaultOnSlice(key, isSolidKey({ surfaces }, key));
    const drawn = objects.map(o => drawnOf(o.own, view.display[o.key], usualOf(o.key)));
    const as = common(drawn.map(d => d.as));
    const opacity = common(drawn.map(d => d.opacity)) ?? drawn[0].opacity;
    const filled = drawn.some(d => d.as === 'solid' || d.as === 'edges');
    const onSlice = common(drawn.map(d => d.onSlice));
    const keys = objects.map(o => o.key);
    // How a slice draws them unless told (their line, a model's solid filled): what is the usual is kept as nothing
    const usual = common(keys.map(usualOf));
    const setSlice = (s: OnSlice) => {
        for (const u of new Set(keys.map(usualOf))) view.set(keys.filter(k => usualOf(k) === u), { slice: s === u ? undefined : s });
    };
    const off = !view.plotId;
    const now = shown ?? opacity;
    return (
        <Box data-testid="display-controls" sx={{ display: 'flex', alignItems: 'center', gap: dense ? 0.5 : 1, minWidth: 0, flexWrap: dense ? 'nowrap' : 'wrap' }}>
            {across && (
                <Choice
                    icon={as ? ICON[as] : <MoreHoriz />} word={as ? DRAWN_SHORT[as] : 'Mixed'} off={off} marked={false} onOpen={setMenu}
                    label={`How ${name} is drawn: ${as ? DRAWN_AS_NAME[as].toLowerCase() : 'not all the same'}`}
                    tip={`Drawn as: ${as ? DRAWN_AS_TIP[as] : 'not all the same'}`} data={{ 'data-action': 'drawn-as', 'data-as': as ?? 'mixed' }}
                />
            )}
            {dense && !across && (
                <>
                    <Tooltip title={`Drawn as: ${as ? DRAWN_AS_NAME[as].toLowerCase() : 'not all the same'}. Click to change.`} enterDelay={600}>
                        <span>
                            <IconButton
                                size="small" disabled={off} data-action="drawn-as" data-as={as ?? 'mixed'} aria-haspopup="menu"
                                aria-label={`How ${name} is drawn: ${as ? DRAWN_AS_NAME[as].toLowerCase() : 'not all the same'}`}
                                onClick={e => setMenu(e.currentTarget)} sx={{ p: 0.25 }}
                            >
                                {as ? ICON[as] : <MoreHoriz sx={{ fontSize: 15 }} />}
                            </IconButton>
                        </span>
                    </Tooltip>
                </>
            )}
            {dense && (
                <>
                    <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)} MenuListProps={{ dense: true, 'aria-label': `How ${name} is drawn` }}>
                        {DRAWN_AS.map(a => (
                            <MenuItem key={a} selected={as === a} onClick={() => { setMenu(null); if (as !== a) view.set(keys, { as: a }); }}>
                                <ListItemIcon sx={{ minWidth: 28 }}>{ICON[a]}</ListItemIcon>
                                <ListItemText primary={DRAWN_AS_NAME[a]} secondary={DRAWN_AS_TIP[a].slice(DRAWN_AS_NAME[a].length + 2)} primaryTypographyProps={{ fontSize: 13 }} secondaryTypographyProps={{ fontSize: 11 }} />
                            </MenuItem>
                        ))}
                    </Menu>
                </>
            )}
            {!dense && <Box role="group" aria-label={`How ${name} is drawn`} sx={{ display: 'flex', flexShrink: 0, '& .MuiToggleButton-root': { p: 0.25, minWidth: 22, height: 22, borderRadius: 0, ml: '-1px' } }}>
                {DRAWN_AS.map(a => (
                    <Tooltip key={a} title={DRAWN_AS_TIP[a]}>
                        <span>
                            <ToggleButton
                                size="small" value={a} selected={as === a} disabled={off} color="primary" aria-label={`${DRAWN_AS_NAME[a]}: ${name}`} data-as={a}
                                onChange={() => { if (as !== a) view.set(keys, { as: a }); }}
                            >
                                {ICON[a]}
                            </ToggleButton>
                        </span>
                    </Tooltip>
                ))}
            </Box>}
            <Tooltip title={filled ? `How see-through its faces are: ${Math.round(now * 100)}%` : 'It has no faces drawn (edges or outline only)'}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flex: across ? '0 0 150px' : dense ? '0 1 56px' : '1 1 150px', minWidth: 40, ...(dense ? { mx: 0.75 } : {}) }}>
                    {!dense && <Typography variant="caption" color="text.secondary" noWrap sx={{ width: 84, flexShrink: 0 }}>{filled ? `Opacity ${Math.round(now * 100)}%` : 'No faces'}</Typography>}
                    <CommitSlider
                        size="small" min={0.05} max={1} step={0.05} value={Math.max(0.05, opacity)} disabled={off || !filled} aria-label={`Opacity of ${name}`}
                        onShow={setShown} onCommit={v => view.set(keys, { opacity: v })}
                        sx={{ py: 0.75 }}
                    />
                    {across && <Typography variant="caption" color="text.secondary" noWrap data-testid="opacity-number" sx={{ width: 34, flexShrink: 0, textAlign: 'right', fontSize: 12 }}>{filled ? `${Math.round(now * 100)}%` : '\u2013'}</Typography>}
                </Box>
            </Tooltip>
            {across && (
                <Choice
                    icon={onSlice ? SLICE_ICON[onSlice] : <MoreHoriz />} word={onSlice ? SLICE_SHORT[onSlice] : 'Mixed'} off={off} onOpen={setSliceMenu}
                    marked={!!onSlice && onSlice !== usual}
                    label={`On a slice, ${name}: ${onSlice ? ON_SLICE_NAME[onSlice].toLowerCase() : 'not all the same'}`}
                    tip={`On a slice: ${onSlice ? ON_SLICE_TIP[onSlice] : 'not all the same'}${onSlice && onSlice === usual ? ' (as usual)' : ''}`}
                    data={{ 'data-action': 'on-slice', 'data-slice': onSlice ?? 'mixed' }}
                />
            )}
            {!across && <Tooltip title={`On a slice: ${onSlice ? ON_SLICE_NAME[onSlice].toLowerCase() : 'not all the same'}. Click to change.`} enterDelay={600}>
                <span>
                    <IconButton
                        size="small" disabled={off} data-action="on-slice" data-slice={onSlice ?? 'mixed'} aria-haspopup="menu"
                        aria-label={`On a slice, ${name}: ${onSlice ? ON_SLICE_NAME[onSlice].toLowerCase() : 'not all the same'}`}
                        color={onSlice && onSlice !== usual ? 'primary' : 'default'} onClick={e => setSliceMenu(e.currentTarget)} sx={{ p: 0.25 }}
                    >
                        {onSlice ? SLICE_ICON[onSlice] : <MoreHoriz sx={{ fontSize: 15 }} />}
                    </IconButton>
                </span>
            </Tooltip>}
            <Menu anchorEl={sliceMenu} open={!!sliceMenu} onClose={() => setSliceMenu(null)} MenuListProps={{ dense: true, 'aria-label': `On a slice, ${name}` }}>
                {ON_SLICE.map(s => (
                    <MenuItem key={s} selected={onSlice === s} onClick={() => { setSliceMenu(null); if (onSlice !== s) setSlice(s); }}>
                        <ListItemIcon sx={{ minWidth: 28 }}>{SLICE_ICON[s]}</ListItemIcon>
                        <ListItemText primary={`${ON_SLICE_NAME[s]}${usual === s ? ' (as usual)' : ''}`} secondary={ON_SLICE_TIP[s].slice(ON_SLICE_NAME[s].length + 2)} primaryTypographyProps={{ fontSize: 13 }} secondaryTypographyProps={{ fontSize: 11, sx: { whiteSpace: 'normal', maxWidth: 300 } }} />
                    </MenuItem>
                ))}
            </Menu>
        </Box>
    );
};
