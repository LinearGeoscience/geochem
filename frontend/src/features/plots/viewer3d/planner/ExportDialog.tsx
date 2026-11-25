/**
 * Export planned holes: collar CSV, survey CSV and (optionally) a trace DXF.
 * Holes with errors have no trace and are left out.
 */
import React, { useState } from 'react';
import {
    Alert, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Radio, RadioGroup, Stack, Typography,
} from '@mui/material';
import { collarCsv, surveyCsv, traceDxf, type ExportHole } from '../../../../utils/drillholePlanIO';
import { notify } from '../../../../store/notificationStore';
import { usePlanStore } from './planStore';
import { NumField, download, stopKeys } from './fields';
import type { Planner } from './usePlans';

export const ExportDialog: React.FC<{ open: boolean; onClose: () => void; planner: Planner }> = ({ open, onClose, planner }) => {
    const selectedId = usePlanStore(s => s.selectedId);
    const interval = usePlanStore(s => s.settings.surveyInterval);
    const setSettings = usePlanStore(s => s.setSettings);
    const markExported = usePlanStore(s => s.markExported);
    const [scope, setScope] = useState<'all' | 'selected'>('all');
    const [dxf, setDxf] = useState(false);

    const chosen = planner.holes.filter(h => scope === 'all' || h.hole.id === selectedId);
    const ok = chosen.filter(h => h.result.ok);
    const left = chosen.length - ok.length;

    const run = () => {
        const holes: ExportHole[] = ok.map(h => ({ name: h.hole.input.name, input: h.hole.input, result: h.result, topography: h.topoName, parentName: h.parentName }));
        if (holes.length === 0) return;
        const stem = scope === 'selected' && holes.length === 1 ? `planned_${holes[0].name}` : 'planned_holes';
        download(collarCsv(holes), `${stem}_collar.csv`);
        download(surveyCsv(holes, interval > 0 ? interval : 30), `${stem}_survey.csv`);
        if (dxf) download(traceDxf(holes), `${stem}_traces.dxf`, 'application/dxf');
        if (scope === 'all' && left === 0) markExported();
        notify(`Exported ${holes.length} planned hole${holes.length === 1 ? '' : 's'}${left ? ` (${left} with errors left out)` : ''}.`, left ? 'warning' : 'success');
        onClose();
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth {...stopKeys}>
            <DialogTitle>Export planned holes</DialogTitle>
            <DialogContent>
                <Stack spacing={1.5}>
                    <RadioGroup row value={scope} onChange={e => setScope(e.target.value as 'all' | 'selected')}>
                        <FormControlLabel value="all" control={<Radio size="small" />} label={`All (${planner.holes.length})`} />
                        <FormControlLabel value="selected" control={<Radio size="small" />} label="Selected hole" disabled={!selectedId} />
                    </RadioGroup>
                    <Typography variant="body2">
                        Collar CSV (one row per hole: the source of truth for importing again) and survey CSV (depth, dip, azimuth).
                    </Typography>
                    <NumField label="Survey interval m" value={interval} width={150} onChange={v => { if (v !== null && v > 0) setSettings({ surveyInterval: v }); }} />
                    <FormControlLabel control={<Checkbox size="small" checked={dxf} onChange={e => setDxf(e.target.checked)} />} label="Also a DXF of the traces (3D polylines)" />
                    <Alert severity="info" sx={{ '& .MuiAlert-message': { fontSize: 12 } }}>
                        Azimuths are grid azimuths (clockwise from grid north), not true or magnetic. Coordinates and depths to 3 decimals; dip, azimuth, lift and drift to 4.
                    </Alert>
                    {left > 0 && <Alert severity="warning" sx={{ '& .MuiAlert-message': { fontSize: 12 } }}>{left} hole{left === 1 ? ' has' : 's have'} errors and will be left out.</Alert>}
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="contained" disabled={ok.length === 0} onClick={run}>Export {ok.length}</Button>
            </DialogActions>
        </Dialog>
    );
};
