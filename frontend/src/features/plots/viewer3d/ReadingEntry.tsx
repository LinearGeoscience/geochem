/**
 * A dip reading typed in place, in the 3D view: Alt+click or double-click a
 * point or a node of a line (or empty ground, which puts a point there) and a
 * small box opens beside the cursor for its dip, the bearing it dips towards
 * and how far it holds (its reach; blank: worked out from the spacing).
 * Enter keeps it, Esc leaves it as it was.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, Paper, TextField, Typography } from '@mui/material';
import { useModelStore } from '../../../store/modelStore';
import { useEditSession } from '../../model/editSession';
import type { PointReading } from '../../model/types';
import { READING_ENTRY_WIDTH, typedReading } from './readingEntryForm';

const small = { minWidth: 0, px: 0.75, py: 0, height: 24, fontSize: 12, textTransform: 'none' } as const;
const field = { size: 'small', variant: 'standard' } as const;
const text = (v: number | undefined) => (v === undefined ? '' : String(Number(v.toFixed(2))));

export const ReadingEntry: React.FC = () => {
    const entry = useEditSession(s => s.entry);
    const surface = useModelStore(s => (entry ? s.scene.surfaces.find(x => x.id === entry.surface) ?? null : null));
    const was = useMemo((): PointReading | null | undefined => {
        if (!entry || !surface) return undefined;
        if (entry.point) {
            const p = surface.points.find(q => q.id === entry.point);
            return p ? p.reading ?? null : undefined;
        }
        const line = entry.node ? surface.polylines.find(l => l.id === entry.node!.line) : null;
        if (!line || line.points.length !== entry.node!.of) return undefined;
        return line.nodes?.[entry.node!.vertex]?.reading ?? null;
    }, [entry, surface]);
    const onVein = surface?.rule.kind === 'body' && !!surface.rule.vein;
    const [dip, setDip] = useState('');
    const [towards, setTowards] = useState('');
    const [reach, setReach] = useState('');
    const first = useRef<HTMLInputElement>(null);
    // A fresh box for each place, filled with what it has now
    useEffect(() => {
        setDip(text(was?.dip));
        setTowards(text(was?.dipDirection));
        setReach(text(was?.reach));
        // eslint-disable-next-line react-hooks/exhaustive-deps -- once a place, not as it changes under the box
    }, [entry]);
    useEffect(() => { if (entry) setTimeout(() => first.current?.focus(), 0); }, [entry]);
    // The place has gone (undone, removed): so has the box
    useEffect(() => { if (entry && was === undefined) useEditSession.getState().openEntry(null); }, [entry, was]);
    if (!entry || was === undefined) return null;

    const close = () => useEditSession.getState().openEntry(null);
    const { reading, blank } = typedReading(dip, towards, reach, was?.overturned);
    const keep = (r: PointReading | null) => {
        const m = useModelStore.getState();
        if (entry.point) m.setPointReading(entry.surface, entry.point, r);
        else if (entry.node) m.setNodeReading(entry.surface, entry.node.line, entry.node.vertex, r);
        close();
    };
    const ok = () => { if (reading) keep(reading); else if (blank && was) keep(null); };
    const where = entry.point ? 'this point' : `node ${entry.node!.vertex + 1} of this line`;

    return (
        <Paper
            elevation={6} data-testid="reading-entry"
            sx={{ position: 'absolute', left: entry.x, top: entry.y, width: READING_ENTRY_WIDTH, p: 1, zIndex: 5 }}
            onPointerDown={e => e.stopPropagation()}
            onKeyDown={e => {
                if (e.key === 'Escape') { e.stopPropagation(); close(); }
                if (e.key === 'Enter') { e.stopPropagation(); ok(); }
            }}
        >
            <Typography variant="caption" sx={{ display: 'block', fontWeight: 500 }}>Dip measurement at {where}</Typography>
            <Box sx={{ display: 'flex', gap: 1, mt: 0.25 }}>
                <TextField {...field} label="Dip" value={dip} onChange={e => setDip(e.target.value)} inputRef={first}
                    inputProps={{ inputMode: 'decimal', 'aria-label': 'Dip', style: { fontSize: 13 } }} error={dip.trim() !== '' && !(Number(dip) >= 0 && Number(dip) <= 90)} />
                <TextField {...field} label="Towards" value={towards} onChange={e => setTowards(e.target.value)}
                    inputProps={{ inputMode: 'decimal', 'aria-label': 'Dips towards', style: { fontSize: 13 } }} error={towards.trim() !== '' && !Number.isFinite(Number(towards))} />
                <TextField {...field} label="Reach (m)" value={reach} onChange={e => setReach(e.target.value)} placeholder="auto"
                    inputProps={{ inputMode: 'decimal', 'aria-label': 'Reach in metres', style: { fontSize: 13 } }} error={reach.trim() !== '' && !(Number(reach) > 0)} />
            </Box>
            {onVein && (
                <Typography variant="caption" color="text.secondary" data-testid="reading-entry-vein" sx={{ display: 'block', mt: 0.5, lineHeight: 1.25 }}>
                    On a vein the reach is how far the dip is carried: every stretch of the vein within it lies this way, where its hole has it. Blank: to the stretches next to it.
                </Typography>
            )}
            <Box sx={{ display: 'flex', gap: 0.5, mt: 1, alignItems: 'center' }}>
                <Button size="small" variant="contained" disableElevation sx={small} disabled={!reading && !(blank && was)} onClick={ok}>
                    {blank && was ? 'Take it off' : 'Keep'}
                </Button>
                {was && !blank && <Button size="small" sx={small} onClick={() => keep(null)}>Take it off</Button>}
                <Box sx={{ flex: 1 }} />
                <Button size="small" sx={small} onClick={close}>Cancel</Button>
            </Box>
        </Paper>
    );
};
