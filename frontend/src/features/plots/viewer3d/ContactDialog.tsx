/**
 * A surface from logging: choose the logging column and its units.
 *  - Between logged units: which units lie on either side. The surface is put
 *    where one side gives way to the other down each drillhole
 *    (features/model/contacts).
 *  - A body round logged units: which units it is made of. A closed surface
 *    is put round them (features/model/body).
 * Also used to change the choice for a surface made either way.
 */
import React, { useMemo, useState } from 'react';
import {
    Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel, MenuItem, Select, TextField,
    ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import { useModelStore } from '../../../store/modelStore';
import { findContacts, sidesRule } from '../../model/contacts';
import { formatMetres } from '../../model/describe';
import { holeLog, loggingColumns, loggingProblem, unitCounts } from '../../model/logging';
import { bodySurface, contactSurface, unitsLabel } from '../../model/sceneActions';
import type { BodyRule, ContactRule, SceneCoords } from '../../model/types';

interface Props {
    open: boolean;
    /** The view's coordinate, hole and depth columns (for a new surface) */
    coords: SceneCoords | null;
    /** The surface whose choice is being changed (null: a new surface) */
    surfaceId: string | null;
    /** What a new surface is to be: one between units (the default), or a closed body round units */
    kind?: 'contact' | 'body';
    onClose: () => void;
}

/** a = the first side, or part of the body; b = the second side, or (for a body) a unit that says nothing either way */
type Side = 'a' | 'b';

/** At most this many units are listed (the ones with most intervals): a column of free text can hold thousands */
const MAX_LISTED = 200;

/** A length typed by the user: a number that is not negative, or nothing. */
const typed = (text: string): number | null => {
    const v = Number(text.trim());
    return text.trim() !== '' && Number.isFinite(v) && v >= 0 ? v : null;
};

export const ContactDialog: React.FC<Props> = ({ open, onClose, ...rest }) => {
    // Each time it opens it starts from the surface's choices (or none): the form is made anew
    const [opened, setOpened] = useState(0);
    const [wasOpen, setWasOpen] = useState(false);
    if (open !== wasOpen) {
        setWasOpen(open);
        if (open) setOpened(n => n + 1);
    }
    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            {opened > 0 && <ContactForm key={opened} onClose={onClose} {...rest} />}
        </Dialog>
    );
};

const ContactForm: React.FC<Omit<Props, 'open'>> = ({ coords: viewCoords, surfaceId, kind, onClose }) => {
    const scene = useModelStore(s => s.scene);
    const surface = surfaceId ? scene.surfaces.find(s => s.id === surfaceId) ?? null : null;
    const editing = surface && (surface.rule.kind === 'contact' || surface.rule.kind === 'body') ? surface.rule : null;
    const body = editing ? editing.kind === 'body' : kind === 'body';
    // A surface that exists is in the scene's columns; a new one takes the view's
    const coords = surface ? scene.coords : viewCoords;

    // The dataset does not change while this is up (it is modal): its columns are read once
    const [columns] = useState(() => loggingColumns(coords));
    const [column, setColumn] = useState(() => editing?.column ?? columns[0] ?? '');
    const [sides, setSides] = useState<Record<string, Side>>(
        () => (!editing ? {} : Object.fromEntries(editing.kind === 'body'
            ? [...editing.inside.map(u => [u, 'a']), ...editing.ignore.map(u => [u, 'b'])]
            : [...editing.sideA.map(u => [u, 'a']), ...editing.sideB.map(u => [u, 'b'])])),
    );
    const [gap, setGap] = useState(() => (editing && editing.maxGap !== null ? String(editing.maxGap) : ''));
    const [thin, setThin] = useState(() => (editing && editing.minRun !== null ? String(editing.minRun) : ''));

    const units = useMemo(() => (column ? unitCounts(column) : []), [column]);
    const rule = useMemo((): ContactRule | BodyRule => {
        const a = units.filter(u => sides[u.unit] === 'a').map(u => u.unit), b = units.filter(u => sides[u.unit] === 'b').map(u => u.unit);
        const gaps = { maxGap: typed(gap), minRun: typed(thin) || null };
        return body ? { kind: 'body', column, inside: a, ignore: b, ...gaps } : { kind: 'contact', column, sideA: a, sideB: b, ...gaps };
    }, [body, column, units, sides, gap, thin]);
    const problem = loggingProblem(coords);
    // A body needs something it is made of and something left outside it; a surface between units, a unit on each side
    const chosen = rule.kind === 'body'
        ? rule.inside.length > 0 && units.some(u => !sides[u.unit])
        : rule.sideA.length > 0 && rule.sideB.length > 0;
    const found = useMemo(() => {
        if (!chosen || problem) return null;
        const log = holeLog(coords, column);
        return log ? findContacts(log, sidesRule(rule)) : null;
    }, [chosen, problem, coords, column, rule]);
    const contacts = found ? found.contacts.length / 3 : 0;

    const accept = () => {
        if (!coords || !chosen) return;
        const model = useModelStore.getState();
        if (surface && editing && rule.kind === 'body' && editing.kind === 'body') {
            // A name still the one made from the units follows the new units
            model.updateSurface(surface.id, { rule, ...(surface.name === unitsLabel(editing.inside) ? { name: unitsLabel(rule.inside) } : {}) });
        } else if (surface && editing && rule.kind === 'contact' && editing.kind === 'contact') {
            // Side names still the ones made from the units follow the new units
            const automatic = surface.sides && surface.sides[0] === unitsLabel(editing.sideA) && surface.sides[1] === unitsLabel(editing.sideB);
            model.updateSurface(surface.id, { rule, ...(automatic || !surface.sides ? { sides: [unitsLabel(rule.sideA), unitsLabel(rule.sideB)] } : {}) });
        } else {
            const id = rule.kind === 'body' ? bodySurface(coords, rule) : contactSurface(coords, rule);
            if (id) model.setEditing(id);
        }
        onClose();
    };

    return (
        <>
            <DialogTitle>
                {body ? (editing ? 'Change the units it is made of' : 'Body round logged units') : editing ? 'Change the units either side' : 'Surface between logged units'}
            </DialogTitle>
            <DialogContent>
                {problem ? <Alert severity="warning">{problem}</Alert> : columns.length === 0 ? (
                    <Alert severity="warning">This dataset has no text column to read logging from.</Alert>
                ) : (
                    <>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                            {body
                                ? 'Say which logged units it is made of. A closed surface is put round them: it passes through every place a hole goes into or out of them, and every other logged unit is kept outside it. Mark as Unknown any unit that says nothing either way (not logged, core loss).'
                                : 'Say which logged units lie on each side. The surface is put where one side gives way to the other down each drillhole, and runs from hole to hole. Units left out are not used.'}
                        </Typography>
                        <FormControl size="small" fullWidth>
                            <InputLabel id="contact-column">Logging column</InputLabel>
                            <Select
                                labelId="contact-column" label="Logging column" value={columns.includes(column) ? column : ''}
                                onChange={e => { setColumn(e.target.value); setSides({}); }}
                            >
                                {columns.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                            </Select>
                        </FormControl>
                        <Box data-testid="contact-units" sx={{ mt: 1.5, maxHeight: 280, overflowY: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}>
                            {units.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>This column is empty.</Typography>}
                            {units.slice(0, MAX_LISTED).map(({ unit, count }) => (
                                <Box key={unit} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 0.25, borderBottom: 1, borderColor: 'divider', '&:last-child': { borderBottom: 0 } }}>
                                    <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>{unit}</Typography>
                                    <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>{count.toLocaleString()}</Typography>
                                    <ToggleButtonGroup
                                        size="small" exclusive value={sides[unit] ?? null} aria-label={`Side of ${unit}`}
                                        onChange={(_, v: Side | null) => setSides(s => {
                                            const next = { ...s };
                                            if (v) next[unit] = v;
                                            else delete next[unit];
                                            return next;
                                        })}
                                    >
                                        <ToggleButton value="a" sx={{ textTransform: 'none', py: 0, fontSize: 12 }}>{body ? 'Inside' : 'First side'}</ToggleButton>
                                        <ToggleButton value="b" sx={{ textTransform: 'none', py: 0, fontSize: 12 }}>{body ? 'Unknown' : 'Second side'}</ToggleButton>
                                    </ToggleButtonGroup>
                                </Box>
                            ))}
                            {units.length > MAX_LISTED && (
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', p: 1 }}>
                                    {(units.length - MAX_LISTED).toLocaleString()} more, with fewer intervals each, are not listed.
                                </Typography>
                            )}
                        </Box>
                        <Box sx={{ display: 'flex', gap: 1.5, mt: 2 }}>
                            <TextField
                                size="small" fullWidth label="Longest unlogged gap to bridge (m)" value={gap} onChange={e => setGap(e.target.value)}
                                placeholder={found ? `Automatic: ${formatMetres(found.maxGap)}` : 'Automatic'} InputLabelProps={{ shrink: true }}
                                helperText="With more than this between the two sides, the contact could be anywhere in the gap: no point is made."
                            />
                            <TextField
                                size="small" fullWidth label="Leave out units thinner than (m)" value={thin} onChange={e => setThin(e.target.value)}
                                placeholder="None" InputLabelProps={{ shrink: true }}
                                helperText={body ? 'A thin band of it in other rock, or of other rock in it, is passed over.' : 'A thin band of one side inside the other would put a pocket in the surface.'}
                            />
                        </Box>
                        <Typography data-testid="contact-preview" variant="body2" sx={{ mt: 2 }} color={chosen && found && contacts === 0 ? 'warning.main' : 'text.primary'}>
                            {!chosen ? (!body ? 'Choose at least one unit for each side.' : rule.kind === 'body' && rule.inside.length > 0 ? 'Leave at least one unit outside it.' : 'Choose at least one unit it is made of.')
                                : !found ? 'The columns this needs are not in the dataset.'
                                    : contacts === 0 ? (body ? 'No hole passes into or out of these units.' : 'No contacts: no hole passes from one side to the other.')
                                        : `${contacts.toLocaleString()} contact${contacts === 1 ? '' : 's'} in ${found.holesWithContact.toLocaleString()} of ${found.holes.toLocaleString()} holes.`}
                            {found && found.gapsLeftOut > 0 ? ` ${found.gapsLeftOut.toLocaleString()} left out: the gap between the two sides is too long.` : ''}
                        </Typography>
                    </>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="contained" disabled={!!problem || !chosen || !found || contacts === 0} onClick={accept}>
                    {editing ? 'Change it' : body ? 'Make the body' : 'Make the surface'}
                </Button>
            </DialogActions>
        </>
    );
};
