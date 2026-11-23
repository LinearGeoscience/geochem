/**
 * Where a surface misses what it was built from, in its properties
 * (features/model/misfit): the points, contacts and line nodes it passes
 * further from than a few centimetres, and the logging on the wrong side of
 * it, the worst first, each brought into view with a click.
 */
import React, { useMemo, useState } from 'react';
import { Box, Button, Collapse, IconButton, Tooltip, Typography } from '@mui/material';
import { CenterFocusStrong, ExpandLess, ExpandMore } from '@mui/icons-material';
import type { ContactInputs } from '../../model/contacts';
import { misfitText, surfaceMisfit, type Miss } from '../../model/misfit';
import type { FittedField } from '../../model/rbf';
import type { SurfaceObject, Vec3 } from '../../model/types';

/** At most this many rows are shown at once */
const MAX_ROWS = 60;

const KIND: Record<Miss['kind'], string> = {
    point: 'The surface does not pass through this point', contact: 'The surface does not pass through this contact',
    node: 'The surface does not pass through this node of a line', interval: 'This logged interval is on the wrong side of the surface',
    held: 'Held to a side by hand, and on the wrong side of the surface',
};

interface Props {
    surface: SurfaceObject;
    /** The surface as fitted (null: not fitted yet, or being fitted) */
    field: FittedField | null;
    found: ContactInputs | null;
    /** The names of its two sides */
    sides: [string, string];
    /** Bring a place into view (absent: no view to do it in) */
    onZoom?: (p: Vec3) => void;
}

export const SurfaceMisfit: React.FC<Props> = ({ surface, field, found, sides, onZoom }) => {
    const [open, setOpen] = useState(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the sides by their names, not the pair's identity
    const report = useMemo(() => (field ? surfaceMisfit(surface, field, found, sides) : null), [surface.points, surface.polylines, surface.rule.kind, field, found, sides[0], sides[1]]);
    if (!report || report.inputs + report.checked === 0) return null;
    const count = report.missed + report.wrong;
    const metres = (v: number) => (v >= 100 ? `${Math.round(v).toLocaleString()} m` : `${Number(v.toPrecision(2))} m`);

    return (
        <Box data-testid="surface-misfit" sx={{ mt: 0.75 }}>
            <Button
                size="small" fullWidth onClick={() => setOpen(o => !o)} aria-expanded={open}
                endIcon={open ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
                sx={{ textTransform: 'none', justifyContent: 'space-between', py: 0, fontSize: 12, color: count > 0 ? 'warning.main' : 'text.primary' }}
            >
                {count > 0 ? `Where it misses (${count.toLocaleString()})` : 'Where it misses: nowhere'}
            </Button>
            <Collapse in={open} unmountOnExit>
                <Box sx={{ pl: 0.5, maxHeight: 260, overflowY: 'auto' }}>
                    {misfitText(report).map(line => <Typography key={line} variant="caption" color="text.secondary" sx={{ display: 'block' }}>{line}</Typography>)}
                    {report.list.slice(0, MAX_ROWS).map((m, i) => (
                        <Box key={i} data-testid="misfit-row" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <Tooltip title={`${m.label}. ${KIND[m.kind]}.`} placement="left">
                                <Typography variant="caption" noWrap sx={{ flex: 1, minWidth: 0 }}>{m.label}</Typography>
                            </Tooltip>
                            <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>{m.kind === 'interval' || m.kind === 'held' ? 'wrong by' : 'by'} {metres(m.by)}</Typography>
                            {onZoom && (
                                <Tooltip title="Bring it into view">
                                    <IconButton size="small" aria-label={`Show ${m.label}`} onClick={() => onZoom(m.p)}><CenterFocusStrong sx={{ fontSize: 16 }} /></IconButton>
                                </Tooltip>
                            )}
                        </Box>
                    ))}
                    {count > MAX_ROWS && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            The worst {Math.min(MAX_ROWS, report.list.length)} are listed, of {count.toLocaleString()}.
                        </Typography>
                    )}
                </Box>
            </Collapse>
        </Box>
    );
};
