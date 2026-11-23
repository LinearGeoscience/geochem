/**
 * Control by hand of a surface made from logging, in its properties
 * (features/model/contactControl): its contacts hole by hole, each used, left
 * out or moved along its hole; places it must pass on one side of, marked
 * with a click in the view; holes it must not cross.
 *
 * Every change is one step back, and is kept by hole and depth with the
 * surface, so it is still there after the drillholes are imported again.
 */
import React, { useMemo, useState } from 'react';
import { Box, Button, Checkbox, Collapse, IconButton, MenuItem, TextField, ToggleButton, Tooltip, Typography } from '@mui/material';
import { CenterFocusStrong, Close, ExpandLess, ExpandMore, Replay } from '@mui/icons-material';
import { useModelStore } from '../../../store/modelStore';
import { controlCounts, CUT_ALONG, lensesTake, lensPlane, SIDE_COLORS, withContactEdit, withoutMarks, withUncrossed } from '../../model/contactControl';
import { useModelCache } from '../../model/modelCache';
import type { ContactInputs, FoundContact } from '../../model/contacts';
import type { BodyRule, ContactRule, SurfaceObject, Vec3 } from '../../model/types';
import { SurfaceLinks } from './SurfaceLinks';

/** At most this many marked places are listed: the last ones marked */
const MARKS_SHOWN = 12;
/** At most this many contacts are listed at once: type part of a hole's name for the rest */
const MAX_ROWS = 60;

const smallButton = { minWidth: 0, px: 0.75, py: 0, height: 24, fontSize: 12, textTransform: 'none' } as const;
const metres = (v: number) => `${Number(v.toFixed(2))} m`;

interface Props {
    surface: SurfaceObject;
    found: ContactInputs;
    /** The view acted in shows the scene's coordinates: places can be marked in it */
    here: boolean;
    /** The names of its two sides */
    sides: [string, string];
    /** Bring a place into view (absent: no view to do it in) */
    onZoom?: (p: Vec3) => void;
}

const STATE: Record<FoundContact['state'], string> = { kept: '', moved: 'moved', ignored: 'left out', uncrossed: 'not used' };

/** One contact: used or not, its depth, back as logged, into view */
const ContactRow: React.FC<{ c: FoundContact; onChange: (change: { ignore?: boolean; to?: number | null }) => void; onZoom?: (p: Vec3) => void }> = ({ c, onChange, onZoom }) => {
    const [depth, setDepth] = useState<string | null>(null);
    const where = `the contact in ${c.hole} at ${metres(c.depth)}`;
    const commit = () => {
        if (depth === null) return;
        const to = Number(depth);
        setDepth(null);
        if (depth.trim() !== '' && Number.isFinite(to) && to >= 0 && Math.abs(to - c.at) > 1e-9) onChange({ to });
    };
    const fixed = c.state === 'uncrossed';
    return (
        <Box data-testid="contact-row" sx={{ display: 'flex', alignItems: 'center', gap: 0.25, opacity: c.state === 'ignored' || fixed ? 0.6 : 1 }}>
            <Tooltip title={fixed ? 'Its hole is one the surface must not cross (below): none of its contacts are used' : c.state === 'ignored' ? 'Left out: the surface is not put through it, and the logging either side of it in this hole is not held to its side. Tick to use it again.' : 'Used: the surface passes through it. Untick to leave it out.'}>
                <span>
                    <Checkbox
                        size="small" sx={{ p: 0.25 }} disabled={fixed} checked={c.state === 'kept' || c.state === 'moved'}
                        onChange={e => onChange(e.target.checked ? {} : { ignore: true })} inputProps={{ 'aria-label': `Use ${where}` }}
                    />
                </span>
            </Tooltip>
            <Typography variant="caption" noWrap sx={{ flex: 1, minWidth: 0 }} title={`${c.hole} · logged at ${metres(c.depth)}${c.state === 'uncrossed' ? ' · not used: the surface must not cross this hole' : STATE[c.state] ? ` · ${STATE[c.state]}` : ''}`}>
                {c.hole}{STATE[c.state] ? <Box component="span" sx={{ color: 'text.secondary' }}> · {STATE[c.state]}</Box> : null}
            </Typography>
            <Tooltip title="Its depth down the hole, m. Type another to move it along the hole: the logging between the two depths then counts as the other side.">
                <TextField
                    size="small" variant="standard" disabled={fixed || c.state === 'ignored'} value={depth ?? String(Number(c.at.toFixed(2)))}
                    onChange={e => setDepth(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLElement).blur(); }}
                    sx={{ width: 58, flexShrink: 0 }} inputProps={{ 'aria-label': `Depth of ${where}`, inputMode: 'decimal', style: { fontSize: 12, textAlign: 'right', padding: 0 } }}
                />
            </Tooltip>
            {c.state === 'moved' ? (
                <Tooltip title={`Back to where the logging puts it: ${metres(c.depth)}`}>
                    <IconButton size="small" aria-label={`Put ${where} back`} onClick={() => onChange({})}><Replay sx={{ fontSize: 16 }} /></IconButton>
                </Tooltip>
            ) : <Box sx={{ width: 26, flexShrink: 0 }} />}
            {onZoom && (
                <Tooltip title="Bring it into view">
                    <IconButton size="small" aria-label={`Show ${where}`} onClick={() => onZoom(c.p)}><CenterFocusStrong sx={{ fontSize: 16 }} /></IconButton>
                </Tooltip>
            )}
        </Box>
    );
};

export const SurfaceContacts: React.FC<Props> = ({ surface, found, here, sides, onZoom }) => {
    const rule = surface.rule as ContactRule | BodyRule;
    const marking = useModelStore(s => (s.editingId === surface.id ? s.marking : null));
    const markBy = useModelStore(s => s.markBy);
    const markAlong = useModelStore(s => s.markAlong);
    const { updateSurface, setMarking, setMarkBy, setMarkAlong } = useModelStore.getState();
    const [byText, setByText] = useState(markBy ? String(markBy) : '');
    const [alongText, setAlongText] = useState(markAlong ? String(markAlong) : '');
    const fitted = useModelCache(s => s.byId[surface.id]?.field);
    /** An intrusion: a place held clear by a distance is a lens put into it or cut out of it; one of thin sheets: held only just clear it is a bead or a pinhole */
    const lenses = rule.kind === 'body' && !rule.vein;
    const thin = lenses && !!rule.sheets;
    const [open, setOpen] = useState(false);
    const [filter, setFilter] = useState('');
    const [hole, setHole] = useState('');
    const [holeSide, setHoleSide] = useState<1 | -1>(1);
    const counts = controlCounts(rule.control);
    const sideName = (side: 1 | -1) => sides[side === 1 ? 0 : 1].replace(/ side$/, '');
    const set = (next: ContactRule | BodyRule) => updateSurface(surface.id, { rule: next });

    const shown = useMemo(() => {
        const f = filter.trim().toLowerCase();
        return f ? found.list.filter(c => c.hole.toLowerCase().includes(f)) : found.list;
    }, [found.list, filter]);
    // Holes that can be marked as not to be crossed: every hole with a contact, and any hole typed that the logging has
    const holes = useMemo(() => Array.from(new Set(found.list.map(c => c.hole))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [found.list]);
    const marks = rule.control?.marks;
    // The plane its lenses lie along, and what each place held by a distance has against the logging of its own holes
    const plane = useMemo(() => (lenses ? lensPlane(fitted) : null), [lenses, fitted]);
    const takes = useMemo(() => (lenses && marks?.length ? lensesTake(marks, found.checks, plane) : null), [lenses, marks, found.checks, plane]);
    const against = useMemo(() => {
        const ids: string[] = [];
        let pieces = 0;
        takes?.forEach((n, i) => { if (n > 0 && marks) { ids.push(marks[i].id); pieces += n; } });
        return { ids, pieces };
    }, [takes, marks]);
    const uncrossed = rule.control?.uncrossed ?? [];
    const listed = marks ?? [];
    const summary = [
        counts.ignored > 0 ? `${counts.ignored} left out` : '', counts.moved > 0 ? `${counts.moved} moved` : '',
        counts.marks > 0 ? `${counts.marks} place${counts.marks === 1 ? '' : 's'} marked` : '', counts.uncrossed > 0 ? `${counts.uncrossed} hole${counts.uncrossed === 1 ? '' : 's'} not crossed` : '',
    ].filter(Boolean).join(' · ');

    return (
        <Box data-testid="surface-contacts" sx={{ mt: 0.75 }}>
            <Button
                size="small" fullWidth onClick={() => setOpen(o => !o)} aria-expanded={open}
                endIcon={open ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
                sx={{ textTransform: 'none', justifyContent: 'space-between', py: 0, fontSize: 12, color: 'text.primary' }}
            >
                Its contacts, one by one ({found.list.length.toLocaleString()})
            </Button>
            {summary && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', pl: 0.5 }}>{summary}</Typography>}
            <Collapse in={open} unmountOnExit>
                <Box sx={{ pl: 0.5 }}>
                    {found.list.length > 8 && (
                        <TextField
                            size="small" variant="standard" fullWidth placeholder="Find a hole" value={filter} onChange={e => setFilter(e.target.value)}
                            inputProps={{ 'aria-label': 'Find a hole among the contacts', spellCheck: false, autoComplete: 'off', style: { fontSize: 12 } }}
                        />
                    )}
                    {shown.slice(0, MAX_ROWS).map(c => (
                        <ContactRow key={`${c.hole}:${c.depth}`} c={c} onZoom={onZoom} onChange={change => set(withContactEdit(rule, c.hole, c.depth, change))} />
                    ))}
                    {shown.length > MAX_ROWS && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            {(shown.length - MAX_ROWS).toLocaleString()} more: type part of a hole's name above to find them.
                        </Typography>
                    )}
                    {shown.length === 0 && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>No contact in a hole of that name.</Typography>}
                    {found.stale.edits.map(e => (
                        <Box key={`${e.hole}:${e.depth}`} sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                            <Typography variant="caption" color="warning.main" sx={{ flex: 1, minWidth: 0 }}>
                                {e.hole} at {metres(e.depth)}: {e.ignore ? 'left out' : `moved to ${metres(e.to ?? e.depth)}`}, but the logging has no contact there now.
                            </Typography>
                            <Tooltip title="Forget this change">
                                <IconButton size="small" aria-label={`Forget the change to the contact in ${e.hole} at ${metres(e.depth)}`} onClick={() => set(withContactEdit(rule, e.hole, e.depth, {}))}>
                                    <Close sx={{ fontSize: 16 }} />
                                </IconButton>
                            </Tooltip>
                        </Box>
                    ))}

                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>Places it must pass on one side of</Typography>
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                        {([1, -1] as const).map(side => (
                            <Tooltip key={side} title={!here ? 'This view shows other coordinate columns than the surface was built in' : `Then click places in the view (a drillhole, or the slice) that are on the ${sideName(side)} side: the surface is kept the other side of each. Esc when done.`}>
                                <span style={{ flex: 1, minWidth: 0 }}>
                                    <ToggleButton
                                        size="small" fullWidth value={side} selected={marking === side} disabled={!here} onChange={() => setMarking(marking === side ? null : side)}
                                        aria-label={`Mark places on the ${sideName(side)} side`}
                                        sx={{ textTransform: 'none', py: 0, px: 0.5, fontSize: 11.5, gap: 0.5, whiteSpace: 'nowrap', overflow: 'hidden' }}
                                    >
                                        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: SIDE_COLORS[side], flexShrink: 0 }} />
                                        <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{sideName(side)} side</Box>
                                    </ToggleButton>
                                </span>
                            </Tooltip>
                        ))}
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, mt: 0.25 }}>
                        <Typography variant="caption" color="text.secondary">Held clear by</Typography>
                        <Tooltip title={lenses
                            ? "How far across each place marked from now on is held. Inside: a lens that thick each way is made part of it (longer along its sheets, as it is carried), so a row of them is a sheet twice the distance thick: give half the thickness you mean. Outside: a lens is cut out of it, a short one unless you give it a length. Nothing else of it changes. Empty: only just clear of its skin, by the fit."
                            : "How far on its side each place marked from now on is, at least: the surface is bent to pass that far from it. Empty: only just clear of it."}>
                            <TextField
                                size="small" variant="standard" value={byText} placeholder="just" sx={{ width: 48, flexShrink: 0 }}
                                onChange={e => { setByText(e.target.value); const v = Number(e.target.value.replace(',', '.')); setMarkBy(e.target.value.trim() && Number.isFinite(v) && v > 0 ? v : null); }}
                                inputProps={{ 'aria-label': 'How far clear of the surface a marked place is held, m', inputMode: 'decimal', style: { fontSize: 12, textAlign: 'right', padding: 0 } }}
                            />
                        </Tooltip>
                        <Typography variant="caption" color="text.secondary">m. Shift+click: a row from the last place.</Typography>
                    </Box>
                    {plane && (
                        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
                            <Typography variant="caption" color="text.secondary">Along its sheets</Typography>
                            <Tooltip title={`How many times as far along its sheets as across them a place marked from now on reaches. Empty: a place inside is carried as far as the body is, ${Number(plane.times.toFixed(1))} times, so that a row of them is a sheet; a place outside ${CUT_ALONG} times, which trims it. A longer cut takes more of the body with it, logged or not: each place below says what logging it takes.`}>
                                <TextField
                                    size="small" variant="standard" value={alongText} placeholder={`${Number(plane.times.toFixed(1))} / ${CUT_ALONG}`} sx={{ width: 48, flexShrink: 0 }}
                                    onChange={e => { setAlongText(e.target.value); const v = Number(e.target.value.replace(',', '.')); setMarkAlong(e.target.value.trim() && Number.isFinite(v) && v >= 1 ? v : null); }}
                                    inputProps={{ 'aria-label': 'How many times as far along its sheets as across a marked place reaches', inputMode: 'decimal', style: { fontSize: 12, textAlign: 'right', padding: 0 } }}
                                />
                            </Tooltip>
                            <Typography variant="caption" color="text.secondary">times as far (inside / outside).</Typography>
                        </Box>
                    )}
                    {thin && !markBy && (
                        <Typography variant="caption" color="warning.main" data-testid="mark-thin" sx={{ display: 'block' }}>
                            On thin sheets a place held only just clear is a bead or a pinhole, and moves its sheets elsewhere: give a distance.
                        </Typography>
                    )}
                    {against.ids.length > 0 && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <Typography variant="caption" color="warning.main" data-testid="marks-take" sx={{ flex: 1, minWidth: 0 }}>
                                {against.ids.length === 1 ? '1 place takes' : `${against.ids.length.toLocaleString()} places take`} logging: {against.pieces.toLocaleString()} logged piece{against.pieces === 1 ? '' : 's'} of its own holes {against.pieces === 1 ? 'is' : 'are'} put on the other side. The hand is followed, not the logging.
                            </Typography>
                            <Button size="small" sx={smallButton} onClick={() => set(withoutMarks(rule, against.ids))}>Remove {against.ids.length === 1 ? 'it' : 'those'}</Button>
                        </Box>
                    )}
                    {listed.length > MARKS_SHOWN && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <Typography variant="caption" color="text.secondary" data-testid="side-marks-more" sx={{ flex: 1, minWidth: 0 }}>
                                {listed.length.toLocaleString()} places marked; the last {MARKS_SHOWN} are listed.
                            </Typography>
                            <Button size="small" sx={smallButton} onClick={() => set(withoutMarks(rule, null))}>Remove all</Button>
                        </Box>
                    )}
                    {listed.map((m, i) => (i < listed.length - MARKS_SHOWN ? null : (
                        <Box key={m.id} data-testid="side-mark" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: SIDE_COLORS[m.side], flexShrink: 0 }} />
                            <Typography
                                variant="caption" noWrap sx={{ flex: 1, minWidth: 0 }}
                                title={`${Math.round(m.p[0]).toLocaleString()} E, ${Math.round(m.p[1]).toLocaleString()} N, ${Math.round(m.p[2]).toLocaleString()} m`}
                            >
                                {m.to ? 'Link' : 'Place'} {i + 1} · {sideName(m.side)} side · {Math.round(m.p[2]).toLocaleString()} m{m.to ? ` · ${Number(Math.hypot(m.to[0] - m.p[0], m.to[1] - m.p[1], m.to[2] - m.p[2]).toFixed(1))} m long` : ''}{m.by ? ` · clear by ${metres(m.by)}` : ''}{m.by && m.along ? ` · ${Number(m.along.toFixed(1))} times along` : ''}
                                {takes && takes[i] > 0 ? <Box component="span" sx={{ color: 'warning.main' }}> · takes {takes[i].toLocaleString()} logged</Box> : null}
                            </Typography>
                            {onZoom && <IconButton size="small" aria-label={`Show place ${i + 1}`} onClick={() => onZoom(m.p)}><CenterFocusStrong sx={{ fontSize: 16 }} /></IconButton>}
                            <IconButton size="small" aria-label={`Remove place ${i + 1}`} onClick={() => set(withoutMarks(rule, [m.id]))}><Close sx={{ fontSize: 16 }} /></IconButton>
                        </Box>
                    )))}

                    {thin && plane && rule.kind === 'body' && (
                        <SurfaceLinks rule={rule} found={found} field={fitted ?? null} plane={plane} onRule={set} onZoom={onZoom} />
                    )}

                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>Holes it must not cross</Typography>
                    <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.5 }}>
                        <TextField
                            size="small" variant="standard" value={hole} onChange={e => setHole(e.target.value)} placeholder="Hole" sx={{ flex: 1, minWidth: 0 }}
                            inputProps={{ 'aria-label': 'A hole it must not cross', list: `holes-${surface.id}`, spellCheck: false, autoComplete: 'off', style: { fontSize: 12 } }}
                        />
                        <datalist id={`holes-${surface.id}`}>{holes.map(h => <option key={h} value={h} />)}</datalist>
                        <TextField
                            select size="small" variant="standard" value={holeSide} onChange={e => setHoleSide(Number(e.target.value) === 1 ? 1 : -1)} sx={{ width: 96, flexShrink: 0 }}
                            SelectProps={{ SelectDisplayProps: { 'aria-label': 'The side the hole lies on', style: { fontSize: 12 } } as React.HTMLAttributes<HTMLDivElement> }}
                        >
                            <MenuItem dense value={1}>{sideName(1)} side</MenuItem>
                            <MenuItem dense value={-1}>{sideName(-1)} side</MenuItem>
                        </TextField>
                        <Tooltip title="The whole of this hole lies on that side: its own contacts are left out, and the surface is kept from crossing it">
                            <span>
                                <Button size="small" variant="outlined" sx={smallButton} disabled={hole.trim() === ''} onClick={() => { set(withUncrossed(rule, hole.trim(), holeSide)); setHole(''); }}>Add</Button>
                            </span>
                        </Tooltip>
                    </Box>
                    {uncrossed.map(u => (
                        <Box key={u.hole} data-testid="uncrossed-hole" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: SIDE_COLORS[u.side], flexShrink: 0 }} />
                            <Typography variant="caption" noWrap color={found.stale.holes.includes(u.hole) ? 'warning.main' : 'text.primary'} sx={{ flex: 1, minWidth: 0 }}>
                                {u.hole} · all on the {sideName(u.side)} side{found.stale.holes.includes(u.hole) ? ' · not in the drilling now' : ''}
                            </Typography>
                            <IconButton size="small" aria-label={`Let it cross ${u.hole} again`} onClick={() => set(withUncrossed(rule, u.hole, null))}><Close sx={{ fontSize: 16 }} /></IconButton>
                        </Box>
                    ))}
                </Box>
            </Collapse>
        </Box>
    );
};
