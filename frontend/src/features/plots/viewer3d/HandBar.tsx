/**
 * One bar in the view for everything put on a surface by hand (Phase 309), shown while a surface made from the
 * logging is open for editing: a place on either side, a link from one place to another (an intrusion), a hole the
 * surface keeps clear of, its contacts moved along their holes; how far a place is held and how far along its
 * sheets it reaches. The same store state as the surface's properties (`marking`, `markBy`, `markAlong`), so the
 * two always agree. Esc or Done puts the tool down.
 */
import React, { useEffect, useState } from 'react';
import { Box, Button, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import { useModelStore, type HandTool } from '../../../store/modelStore';
import { useModelCache } from '../../model/modelCache';
import { CUT_ALONG, SIDE_COLORS } from '../../model/contactControl';
import { surfaceSides } from '../../model/surfaceColumns';
import type { BodyRule } from '../../model/types';

const small = { textTransform: 'none', py: 0, px: 0.9, height: 28, fontSize: 12.5, gap: 0.5, whiteSpace: 'nowrap' } as const;
const numberOf = (text: string): number | null => {
    const v = Number(text.trim().replace(',', '.'));
    return text.trim() && Number.isFinite(v) ? v : null;
};

export const HandBar: React.FC = () => {
    const surface = useModelStore(s => s.scene.surfaces.find(o => o.id === s.editingId) ?? null);
    const tool = useModelStore(s => s.marking);
    const markBy = useModelStore(s => s.markBy);
    const markAlong = useModelStore(s => s.markAlong);
    const trend = useModelCache(s => (surface ? s.byId[surface.id]?.trend ?? null : null));
    const [byText, setByText] = useState(markBy !== null ? String(markBy) : '');
    const [alongText, setAlongText] = useState(markAlong !== null ? String(markAlong) : '');
    // (Typed in the properties: shown here too)
    useEffect(() => setByText(t => (numberOf(t) === markBy ? t : markBy !== null ? String(markBy) : '')), [markBy]);
    useEffect(() => setAlongText(t => (numberOf(t) === markAlong ? t : markAlong !== null ? String(markAlong) : '')), [markAlong]);

    if (!surface || (surface.rule.kind !== 'contact' && surface.rule.kind !== 'body')) return null;
    const rule = surface.rule;
    const body = rule.kind === 'body';
    const lenses = body && !(rule as BodyRule).vein;
    const [a, b] = surfaceSides(surface, trend).map(n => n.replace(/ side$/, ''));
    const st = useModelStore.getState();
    const choose = (next: HandTool | null) => st.setMarking(next === tool ? null : next);

    const tools: { value: HandTool; label: React.ReactNode; tip: string }[] = [
        { value: 1, label: <><Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: SIDE_COLORS[1] }} />{a}</>, tip: `Click places (a hole, or the slice) on the ${a} side: the surface is kept the other side of each${lenses ? ': inside it, a lens is made part of it' : ''}. Shift+click: a row from the last one.` },
        { value: -1, label: <><Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: SIDE_COLORS[-1] }} />{b}</>, tip: `Click places on the ${b} side${lenses ? ': outside it, held by a distance, a lens is cut out of it (a cut)' : ''}. Shift+click: a row from the last one.` },
        ...(lenses ? [{ value: 'link' as const, label: 'Link', tip: 'Click where a link starts (a stretch down a hole), then where it ends: the body is held along the line between, as thick as twice the distance given (0.5 m if none).' }] : []),
        { value: 'hole', label: 'Hole', tip: `Click a hole the surface must not cross: it keeps the whole hole on the ${a} side (Shift+click: the ${b} side). Click it again to let it go.` },
        { value: 'contact', label: 'Contacts', tip: 'Shows its logged contacts: drag one along its hole to move it; Delete leaves the one pointed at out (again: uses it).' },
    ];
    const giveBy = () => st.setMarkBy(numberOf(byText));
    const giveAlong = () => st.setMarkAlong(numberOf(alongText));
    const keys = (give: () => void) => (e: React.KeyboardEvent<HTMLInputElement>) => {
        e.stopPropagation();
        if (e.key === 'Enter' || e.key === 'Escape') { give(); (e.target as HTMLInputElement).blur(); }
    };
    const input = { inputMode: 'decimal', style: { fontSize: 12.5, textAlign: 'right', padding: 0 } } as const;

    return (
        <Box
            data-testid="hand-bar" role="toolbar" aria-label={`By hand on ${surface.name}`}
            onPointerDown={e => e.stopPropagation()}
            sx={{
                position: 'absolute', left: 12, bottom: 30, zIndex: 5, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.75,
                maxWidth: 'calc(100% - 24px)', px: 1, py: 0.5, borderRadius: 1, bgcolor: 'background.paper', boxShadow: 3, border: 1, borderColor: 'divider',
            }}
        >
            <Typography variant="caption" sx={{ fontWeight: 600 }}>By hand</Typography>
            <ToggleButtonGroup size="small" exclusive value={tool} onChange={(_, v: HandTool | null) => choose(v ?? tool)} aria-label="Hand tool">
                {tools.map(t => (
                    <Tooltip key={String(t.value)} title={t.tip}>
                        <ToggleButton value={t.value} sx={small} aria-label={typeof t.label === 'string' ? t.label : `${t.value === 1 ? a : b} side`}>{t.label}</ToggleButton>
                    </Tooltip>
                ))}
            </ToggleButtonGroup>
            <Tooltip title={lenses ? 'How far across a place (or a link: half its thickness) is held. Empty: a place only just clear, a link 0.5 m thick.' : 'How far on its side a place is held, at least. Empty: only just clear.'}>
                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
                    <Typography variant="caption" color="text.secondary">Held by</Typography>
                    <TextField
                        size="small" variant="standard" value={byText} placeholder="just" sx={{ width: 40 }}
                        onChange={e => setByText(e.target.value)} onBlur={giveBy} onKeyDown={keys(giveBy)}
                        inputProps={{ ...input, 'aria-label': 'Held by, m, from now on' }}
                    />
                    <Typography variant="caption" color="text.secondary">m</Typography>
                </Box>
            </Tooltip>
            {lenses && (
                <Tooltip title={`How many times as far along its sheets as across a place reaches from now on. Empty: inside as far as the body is carried, outside ${CUT_ALONG} times.`}>
                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
                        <Typography variant="caption" color="text.secondary">Along</Typography>
                        <TextField
                            size="small" variant="standard" value={alongText} placeholder="usual" sx={{ width: 40 }}
                            onChange={e => setAlongText(e.target.value)} onBlur={giveAlong} onKeyDown={keys(giveAlong)}
                            inputProps={{ ...input, 'aria-label': 'Times as far along its sheets, from now on' }}
                        />
                        <Typography variant="caption" color="text.secondary">×</Typography>
                    </Box>
                </Tooltip>
            )}
            {tool !== null && <Button size="small" sx={small} onClick={() => st.setMarking(null)}>Done</Button>}
        </Box>
    );
};
