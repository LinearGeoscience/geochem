/**
 * Links between the holes of an intrusion of thin sheets, offered from its
 * logging (features/model/linkProposals): pairs of logged stretches in one
 * plane of its sheets, a few metres apart, that it does not join. Each is
 * taken or left; nothing is placed until one is taken. A link taken is the
 * body held along the line between the two (contactControl `withLink`), one
 * step back.
 */
import React, { useMemo, useState } from 'react';
import { Box, Button, IconButton, TextField, Tooltip, Typography } from '@mui/material';
import { CenterFocusStrong } from '@mui/icons-material';
import { withLink } from '../../model/contactControl';
import type { ContactInputs } from '../../model/contacts';
import { bodyLinks, LINK_MOST, type BodyLink } from '../../model/linkProposals';
import type { FittedField } from '../../model/rbf';
import type { BodyRule, Vec3 } from '../../model/types';

/** At most this many links are listed: the shortest */
const LINKS_SHOWN = 12;
/** A link is never offered longer than this, m, whatever is typed */
const LINKS_LONGEST = 30;

const smallButton = { minWidth: 0, px: 0.75, py: 0, height: 24, fontSize: 12, textTransform: 'none' } as const;
const metres = (v: number) => `${Number(v.toFixed(1))} m`;

interface Props {
    rule: BodyRule;
    found: ContactInputs;
    /** The body as fitted now (null: not yet) */
    field: FittedField | null;
    /** The plane its sheets lie in, and how many times as far it is carried along it */
    plane: { normal: Vec3; times: number };
    onRule: (next: BodyRule) => void;
    onZoom?: (p: Vec3) => void;
}

export const SurfaceLinks: React.FC<Props> = ({ rule, found, field, plane, onRule, onZoom }) => {
    const [looking, setLooking] = useState(false);
    const [mostText, setMostText] = useState(String(LINK_MOST));
    const typed = Number(mostText.replace(',', '.'));
    const most = Number.isFinite(typed) && typed > 0 ? Math.min(LINKS_LONGEST, typed) : LINK_MOST;
    const offered = useMemo(() => (looking ? bodyLinks(found, field, plane, most) : null), [looking, found, field, plane, most]);
    const take = (links: readonly BodyLink[]) => onRule(links.reduce((next, l) => withLink(next, l.from, l.to, 1, l.by, l.along).rule, rule));
    const n = offered?.links.length ?? 0;

    return (
        <Box data-testid="surface-links">
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>Links between its holes</Typography>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
                <Tooltip describeChild title="Pairs of its logged stretches, in different holes, that lie in one plane of its sheets no further apart than the length given, with no hole between them that logs other ground, and that it does not join now. A link taken is the body held along the line between the two: a ribbon as thick as the thinner of the two stretches and 2 m to each side of the line along the sheets; it is listed with the places above and removed there. Short links are the sure ones. Tried on thin dykes drilled a few metres apart, with holes left out: where a hole left out passed through a link under 8 m, it logged the dyke there three times in four; from 12 to 20 m, half the time.">
                    <Button size="small" variant="outlined" sx={smallButton} onClick={() => setLooking(l => !l)} aria-pressed={looking}>{looking ? 'Hide the links' : 'Look for links'}</Button>
                </Tooltip>
                <Typography variant="caption" color="text.secondary">no longer than</Typography>
                <TextField
                    size="small" variant="standard" value={mostText} sx={{ width: 40, flexShrink: 0 }} onChange={e => setMostText(e.target.value)}
                    inputProps={{ 'aria-label': 'The longest link offered, m', inputMode: 'decimal', style: { fontSize: 12, textAlign: 'right', padding: 0 } }}
                />
                <Typography variant="caption" color="text.secondary">m</Typography>
            </Box>
            {offered && (
                <Typography variant="caption" color={most > LINK_MOST && n > 0 ? 'warning.main' : 'text.secondary'} data-testid="links-offered" sx={{ display: 'block' }}>
                    {n === 0 ? 'None offered' : `${n.toLocaleString()} offered`}
                    {offered.joined > 0 ? `; ${offered.joined.toLocaleString()} more it joins already` : ''}
                    {offered.stopped > 0 ? `; ${offered.stopped.toLocaleString()} left out, a hole logs other ground beside them` : ''}
                    {offered.thin > 0 ? `; ${offered.thin.toLocaleString()} left out, thinner than a link can be drawn` : ''}.
                    {most > LINK_MOST && n > 0 ? ` Over ${LINK_MOST} m a link is less sure: look at each.` : ''}
                </Typography>
            )}
            {offered && n > 1 && (
                <Button size="small" sx={smallButton} onClick={() => take(offered.links)}>Take all {n.toLocaleString()}</Button>
            )}
            {offered?.links.slice(0, LINKS_SHOWN).map(l => (
                <Box key={`${l.a}:${l.b}`} data-testid="link-row" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="caption" noWrap sx={{ flex: 1, minWidth: 0 }} title={`${l.holes[0]} to ${l.holes[1]}: ${metres(l.length)} apart, ${metres(l.across)} of it across the sheets`}>
                        {l.holes[0]} to {l.holes[1]} · {metres(l.length)} · held by {Number(l.by.toFixed(2))} m
                    </Typography>
                    {onZoom && (
                        <IconButton size="small" aria-label={`Show the link from ${l.holes[0]} to ${l.holes[1]}`} onClick={() => onZoom([(l.from[0] + l.to[0]) / 2, (l.from[1] + l.to[1]) / 2, (l.from[2] + l.to[2]) / 2])}>
                            <CenterFocusStrong sx={{ fontSize: 16 }} />
                        </IconButton>
                    )}
                    <Button size="small" sx={smallButton} aria-label={`Take the link from ${l.holes[0]} to ${l.holes[1]}`} onClick={() => take([l])}>Take</Button>
                </Box>
            ))}
            {offered && n > LINKS_SHOWN && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    {(n - LINKS_SHOWN).toLocaleString()} more, longer than these.
                </Typography>
            )}
        </Box>
    );
};
