/**
 * The survey rules: a site's own survey codes, hole statuses and grid zone
 * (utils/drillTrackSurveys TrackRules), kept with the project. Start from a
 * preset (./presets) or set each by hand.
 */
import React, { useEffect, useState } from 'react';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, TextField, Typography } from '@mui/material';
import { useDrillTrackingStore } from '../../store/drillTrackingStore';
import { notify } from '../../store/notificationStore';
import { presetRules, TRACK_DEFAULTS, type TrackRules } from '../../utils/drillTrackSurveys';
import { stopKeys } from '../plots/viewer3d/planner/fields';
import { RULE_PRESETS } from './presets';

const BLANK = '\u0000blank';

const LIST_FIELDS: { key: 'dropMethods' | 'copyMethods' | 'methodRank' | 'activeStatuses' | 'finishedStatuses'; label: string; help: string }[] = [
    { key: 'dropMethods', label: 'Survey methods that aren\'t surveys of the hole', help: 'Left out (e.g. planned or collar rows)' },
    { key: 'copyMethods', label: 'Start / end of hole copies', help: 'Copies of the first and last survey: left out of the rates and projections' },
    { key: 'methodRank', label: 'Survey methods, best first', help: 'Two surveys at one depth: the better is kept' },
    { key: 'activeStatuses', label: 'Hole statuses: being drilled', help: 'Compared without case, spaces or punctuation' },
    { key: 'finishedStatuses', label: 'Hole statuses: finished', help: 'Holes with these never count as being drilled' },
];

const toText = (v: readonly string[] | undefined) => (v ?? []).join(', ');
const toList = (t: string) => t.split(/[,\n]/).map(s => s.trim()).filter(Boolean);

export const SurveyRulesDialog: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
    const rules = useDrillTrackingStore(s => s.tracking.rules);
    const [text, setText] = useState<Record<string, string>>({});
    const [zone, setZone] = useState('');
    useEffect(() => {
        if (!open) return;
        setText(Object.fromEntries(LIST_FIELDS.map(f => [f.key, toText(rules[f.key])])));
        setZone(rules.gridZone === null || rules.gridZone === undefined ? '' : String(rules.gridZone));
    }, [open, rules]);
    const fill = (r: TrackRules) => {
        setText(Object.fromEntries(LIST_FIELDS.map(f => [f.key, toText(r[f.key])])));
        setZone(r.gridZone === null || r.gridZone === undefined ? '' : String(r.gridZone));
    };
    const save = () => {
        const next: TrackRules = { ...rules, gridZone: zone.trim() ? Number(zone) : null };
        for (const f of LIST_FIELDS) next[f.key] = toList(text[f.key] ?? '');
        useDrillTrackingStore.getState().setTracking({ rules: next });
        notify('Survey rules saved with the project.', 'success');
        onClose();
    };
    const zoneBad = zone.trim() !== '' && !/^\d{1,2}$/.test(zone.trim());
    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth {...stopKeys}>
            <DialogTitle>Survey rules</DialogTitle>
            <DialogContent>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Each site's survey and hole codes are its own. These are kept with the project; start from a preset or set them by hand.
                </Typography>
                <TextField select size="small" label="Start from a preset" value="" sx={{ mb: 1.5, minWidth: 260 }}
                    onChange={e => {
                        if (e.target.value === BLANK) { fill({ ...TRACK_DEFAULTS }); return; }
                        const p = RULE_PRESETS.find(x => x.name === e.target.value);
                        if (p) fill(presetRules({ ...rules }, p));
                    }}>
                    <MenuItem value={BLANK}>Blank (no site codes)</MenuItem>
                    {RULE_PRESETS.map(p => <MenuItem key={p.name} value={p.name}>{p.name}</MenuItem>)}
                </TextField>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                    {LIST_FIELDS.map(f => (
                        <TextField key={f.key} size="small" label={f.label} helperText={`${f.help}; separated by commas`} value={text[f.key] ?? ''}
                            onChange={e => setText(t => ({ ...t, [f.key]: e.target.value }))} />
                    ))}
                    <TextField size="small" label="Grid zone" value={zone} sx={{ width: 160 }} error={zoneBad}
                        helperText={zoneBad ? 'A zone number, or blank' : 'Survey rows naming another zone are left out (blank: any)'}
                        onChange={e => setZone(e.target.value)} />
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="contained" disabled={zoneBad} onClick={save}>Save</Button>
            </DialogActions>
        </Dialog>
    );
};
