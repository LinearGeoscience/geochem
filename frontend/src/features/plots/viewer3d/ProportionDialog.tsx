/**
 * A proportion (features/model/proportion): how much of the ground is a
 * logged unit, for units too thin and too broken up to draw as solids.
 * Choose the logging column and the units to count, and the shares to put
 * shells round. It is kept as a numeric model: a shell for each share, all
 * found the same way. Also used to change one.
 */
import React, { useMemo, useState } from 'react';
import {
    Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel, MenuItem, Select, TextField, ToggleButton, ToggleButtonGroup,
    Typography,
} from '@mui/material';
import { useDrillholeStore } from '../../../store/drillholeStore';
import { useModelStore } from '../../../store/modelStore';
import { useModellingStore } from '../../../store/modellingStore';
import { sceneDataBox } from '../../model/modelCache';
import { SHARE_CAVEAT, sheetsPlaneNote } from '../../model/describe';
import { holeLog, loggingColumns, loggingProblem, loggingTables, unitCounts } from '../../model/logging';
import { MAX_CUTOFFS } from '../../model/numericModels';
import { keys } from '../../model/objectKeys';
import { parseShares, SHARE_LENGTH, SHARE_LOCAL, SHARE_SHELLS, SHARE_STRENGTH, shareFrame, sharePercent, shareRule, shareSamples } from '../../model/proportion';
import { numericModelFrom } from '../../model/sceneActions';
import { listText } from '../../model/shellDomains';
import { plain, t } from '../../model/terms';
import type { SceneCoords, ShareOf } from '../../model/types';

interface Props {
    open: boolean;
    /** The view's coordinate, hole and depth columns (for a new one) */
    coords: SceneCoords | null;
    /** The numeric model being changed (null: a new one) */
    numericId: string | null;
    onClose: () => void;
}

const MAX_LISTED = 60;
/** Counted, or not logging at all (anything else is other ground) */
type Counts = 'in' | 'unknown';

const typed = (text: string): number | null => {
    const v = Number(text.trim());
    return text.trim() !== '' && Number.isFinite(v) ? v : null;
};
const percents = (shares: readonly number[]) => shares.map(s => Number((100 * s).toPrecision(4))).join(', ');

export const ProportionDialog: React.FC<Props> = ({ open, onClose, ...rest }) => {
    // Each time it opens it starts from the model's choices (or none): the form is made anew
    const [opened, setOpened] = useState(0);
    const [wasOpen, setWasOpen] = useState(false);
    if (open !== wasOpen) {
        setWasOpen(open);
        if (open) setOpened(n => n + 1);
    }
    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            {opened > 0 && <ProportionForm key={opened} onClose={onClose} {...rest} />}
        </Dialog>
    );
};

const ProportionForm: React.FC<Omit<Props, 'open'>> = ({ coords: viewCoords, numericId, onClose }) => {
    const scene = useModelStore(s => s.scene);
    const db = useDrillholeStore(s => s.db);
    const model = numericId ? scene.numericModels?.find(m => m.id === numericId) ?? null : null;
    const editing = model?.rule.of ?? null;
    // One that exists is in the scene's columns; a new one takes the view's
    const coords = model ? scene.coords : viewCoords;

    /* eslint-disable-next-line react-hooks/exhaustive-deps -- `db`: the tables are read from the store, and are others when it is another */
    const tables = useMemo(() => loggingTables(), [db]);
    const [table, setTable] = useState(() => editing?.table ?? '');
    /* eslint-disable-next-line react-hooks/exhaustive-deps -- as above */
    const columns = useMemo(() => loggingColumns(coords, table || null), [coords, table, db]);
    const [column, setColumn] = useState(() => editing?.column ?? columns[0] ?? '');
    const [counted, setCounted] = useState<Record<string, Counts>>(() => ({
        ...Object.fromEntries((editing?.ignore ?? []).map(u => [u, 'unknown' as const])),
        ...Object.fromEntries((editing?.inside ?? []).map(u => [u, 'in' as const])),
    }));
    const [shares, setShares] = useState(() => percents(model ? model.shells.map(s => s.cutoff) : SHARE_SHELLS));
    const [length, setLength] = useState(() => (editing && editing.length !== SHARE_LENGTH ? String(editing.length) : ''));
    const [local, setLocal] = useState(() => (model?.rule.local ? String(model.rule.local) : ''));
    const [strength, setStrength] = useState(() => (editing?.strength !== undefined ? String(editing.strength) : ''));

    const problem = loggingProblem(coords, table || null);
    /* eslint-disable-next-line react-hooks/exhaustive-deps -- as above */
    const units = useMemo(() => (column ? unitCounts(column, table || null) : []), [column, table, db]);
    const inside = units.filter(u => counted[u.unit] === 'in').map(u => u.unit);
    const ignore = units.filter(u => counted[u.unit] === 'unknown').map(u => u.unit);
    const piece = (typed(length) ?? 0) > 0 ? typed(length)! : SHARE_LENGTH;
    const together = (typed(local) ?? 0) > 0 ? typed(local)! : null;
    const along = typed(strength) !== null && typed(strength)! >= 1 ? typed(strength)! : null;
    const insideKey = inside.join('\n'), ignoreKey = ignore.join('\n');
    const of: ShareOf | null = useMemo(
        () => (column && insideKey ? {
            ...(table ? { table } : {}), column, inside: insideKey.split('\n'), ...(ignoreKey ? { ignore: ignoreKey.split('\n') } : {}), length: piece,
            ...(along !== null ? { strength: along } : {}), ...(editing?.plane ? { plane: editing.plane } : {}),
        } : null),
        [table, column, insideKey, ignoreKey, piece, along, editing],
    );
    /* eslint-disable-next-line react-hooks/exhaustive-deps -- `db`: as above */
    const log = useMemo(() => (column ? holeLog(coords, column, table || null) : null), [coords, column, table, db]);
    const samples = useMemo(() => (log && of ? shareSamples(log, of) : null), [log, of]);
    const frame = useMemo(() => (log && of ? shareFrame(of, log, sceneDataBox()) : null), [log, of]);
    const wanted = parseShares(shares);
    const summary = useMemo(() => {
        if (!samples) return null;
        let sum = 0;
        const holes = new Set<string>();
        for (let i = 0; i < samples.value.length; i++) { sum += samples.value[i]; if (samples.hole) holes.add(samples.hole[i]); }
        const n = samples.value.length;
        return { n, holes: holes.size, mean: n > 0 ? sum / n : 0, at: (share: number) => { let c = 0; for (let i = 0; i < n; i++) if (samples.value[i] >= share) c++; return c; } };
    }, [samples]);
    const each = wanted && summary ? wanted.map(s => ({ share: s, above: summary.at(s) })) : null;
    const usable = !!coords && !!of && !!summary && summary.n > 0 && !!each && each.length > 0 && each.length <= MAX_CUTOFFS && each.every(e => e.above > 0 && e.above < summary.n);
    const named = listText(inside);

    const accept = () => {
        if (!coords || !of || !wanted || !usable) return;
        const rule = shareRule(of, together);
        const store = useModelStore.getState();
        if (model) store.updateNumericModel(model.id, { rule, cutoffs: wanted, ...(model.name === model.rule.column ? { name: rule.column } : {}) });
        else {
            const id = numericModelFrom(coords, rule, wanted);
            if (id) {
                const tree = useModellingStore.getState();
                tree.setExpanded([...new Set([...tree.expanded, keys.root('numeric'), keys.numericModel(id)])]);
                tree.setSelected([keys.numericModel(id)]);
            }
        }
        onClose();
    };

    return (
        <>
            <DialogTitle>{model ? 'Change the proportion' : 'Proportion of logged units'}</DialogTitle>
            <DialogContent>
                {problem ? <Alert severity="warning">{problem}</Alert> : columns.length === 0 ? (
                    <Alert severity="warning">{table ? 'This table has no column to read logging from.' : 'This dataset has no text column to read logging from.'}</Alert>
                ) : (
                    <>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                            {plain('proportion')} Say which logged units to count. The logging is cut into pieces down each hole, each piece counts as the share of
                            it that is those units, and a shell is put round the ground where that share is at or above each share asked for.
                        </Typography>
                        {(tables.length > 0 || table) && (
                            <FormControl size="small" fullWidth sx={{ mb: 1.5 }}>
                                <InputLabel id="proportion-table">Logging from</InputLabel>
                                <Select
                                    labelId="proportion-table" label="Logging from" value={table}
                                    onChange={e => { setTable(e.target.value); setColumn(loggingColumns(coords, e.target.value || null)[0] ?? ''); setCounted({}); }}
                                >
                                    <MenuItem value="">The samples (columns of the dataset)</MenuItem>
                                    {tables.map(x => <MenuItem key={x.id} value={x.id}>{x.name} (as logged, {x.rows.toLocaleString()} intervals)</MenuItem>)}
                                    {table && !tables.some(x => x.id === table) && <MenuItem value={table} disabled>A table that is no longer in the project</MenuItem>}
                                </Select>
                            </FormControl>
                        )}
                        <FormControl size="small" fullWidth>
                            <InputLabel id="proportion-column">Logging column</InputLabel>
                            <Select labelId="proportion-column" label="Logging column" value={columns.includes(column) ? column : ''} onChange={e => { setColumn(e.target.value); setCounted({}); }}>
                                {columns.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                            </Select>
                        </FormControl>
                        <Box data-testid="proportion-units" sx={{ mt: 1.5, maxHeight: 220, overflowY: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}>
                            {units.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>This column is empty.</Typography>}
                            {units.slice(0, MAX_LISTED).map(({ unit, count }) => (
                                <Box key={unit} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 0.25, borderBottom: 1, borderColor: 'divider', '&:last-child': { borderBottom: 0 } }}>
                                    <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>{unit}</Typography>
                                    <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>{count.toLocaleString()}</Typography>
                                    <ToggleButtonGroup
                                        size="small" exclusive value={counted[unit] ?? null} aria-label={`How ${unit} counts`}
                                        onChange={(_, v: Counts | null) => setCounted(s => {
                                            const next = { ...s };
                                            if (v) next[unit] = v;
                                            else delete next[unit];
                                            return next;
                                        })}
                                    >
                                        <ToggleButton value="in" sx={{ textTransform: 'none', py: 0, fontSize: 12 }}>Count it</ToggleButton>
                                        <ToggleButton value="unknown" sx={{ textTransform: 'none', py: 0, fontSize: 12 }}>Unknown</ToggleButton>
                                    </ToggleButtonGroup>
                                </Box>
                            ))}
                            {units.length > MAX_LISTED && (
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', p: 1 }}>
                                    {(units.length - MAX_LISTED).toLocaleString()} more, with fewer intervals each, are not listed.
                                </Typography>
                            )}
                        </Box>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                            Every other unit is other ground. Mark as Unknown a code that says nothing of what the ground is (not logged, core loss): it is left out of the pieces.
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 1.5, mt: 2 }}>
                            <TextField
                                size="small" fullWidth label="Shells at (% of the ground)" value={shares} onChange={e => setShares(e.target.value)}
                                inputProps={{ 'data-testid': 'proportion-shares' }} InputLabelProps={{ shrink: true }} placeholder={percents(SHARE_SHELLS)}
                                error={shares.trim() !== '' && wanted === null}
                                helperText={wanted === null ? 'Percentages above 0 and under 100, with commas between.' : `A shell round the ground where the units are that share of it or more. At most ${MAX_CUTOFFS}.`}
                            />
                            <TextField
                                size="small" fullWidth label="Piece of hole (m)" value={length} onChange={e => setLength(e.target.value)}
                                inputProps={{ 'data-testid': 'proportion-length', inputMode: 'decimal' }} InputLabelProps={{ shrink: true }} placeholder={String(SHARE_LENGTH)}
                                helperText="Each piece counts as the share of it that is the units."
                            />
                        </Box>
                        <Box sx={{ display: 'flex', gap: 1.5, mt: 1.5 }}>
                            <TextField
                                size="small" fullWidth label="Pieces taken together, each way" value={local} onChange={e => setLocal(e.target.value)}
                                inputProps={{ 'data-testid': 'proportion-local', inputMode: 'decimal' }} InputLabelProps={{ shrink: true }} placeholder={String(SHARE_LOCAL)}
                                helperText="More: an evener share that single sheets move less."
                            />
                            <TextField
                                size="small" fullWidth label="Carried along its sheets (times)" value={strength} onChange={e => setStrength(e.target.value)}
                                inputProps={{ 'data-testid': 'proportion-strength', inputMode: 'decimal' }} InputLabelProps={{ shrink: true }} placeholder={String(SHARE_STRENGTH)}
                                helperText="How many times further along the plane of the sheets than across them. 1: evenly, or along the model’s trend."
                            />
                        </Box>
                        <Typography data-testid="proportion-summary" variant="body2" sx={{ mt: 2 }} color={of && summary && each && !usable ? 'warning.main' : 'text.primary'}>
                            {!of ? 'Choose the units to count.'
                                : !summary ? 'The columns this needs are not in the dataset.'
                                    : summary.n === 0 ? 'Nothing is logged down a hole in this column.'
                                        : `${summary.n.toLocaleString()} pieces of hole in ${summary.holes.toLocaleString()} ${summary.holes === 1 ? 'hole' : 'holes'}; on average ${sharePercent(summary.mean, true)} of a piece is ${named}.`
                                            + (each ? ` ${each.map(e => `${e.above.toLocaleString()} are ${sharePercent(e.share)} or more`).join(', ')}.` : '')
                                            + (each && each.some(e => e.above === 0) ? ' No piece reaches the highest: there would be nothing in that shell.' : '')
                                            + (each && each.length > MAX_CUTOFFS ? ` A model has at most ${MAX_CUTOFFS} shells.` : '')}
                        </Typography>
                        {of && frame && frame.plane && frame.planeFrom && frame.strength > 1 && (
                            <Typography data-testid="proportion-plane" variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                                {sheetsPlaneNote(frame.planeFrom, frame.plane)}
                            </Typography>
                        )}
                        {of && frame && !frame.plane && (along ?? SHARE_STRENGTH) > 1 && (
                            <Typography data-testid="proportion-plane" variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                                Too few holes meet it to say how its sheets lie: it is carried evenly, or along the model’s trend.
                            </Typography>
                        )}
                        <Alert severity="info" sx={{ mt: 1.5, py: 0 }}>{SHARE_CAVEAT}</Alert>
                    </>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="contained" data-action="accept-proportion" disabled={!usable} onClick={accept}>{model ? 'Change it' : `Make the ${t('proportion').toLowerCase()}`}</Button>
            </DialogActions>
        </>
    );
};
