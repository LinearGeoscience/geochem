/** Controls shared by the method panels (sample-order fields, visible-rows switch). */
import React from 'react';
import { FormControlLabel, Stack, Switch, TextField, Typography } from '@mui/material';
import { ColumnPicker } from '../../../components/ColumnPicker';
import { useSequenceSettings } from './methodsCommon';

/** Hole / position / gap fields, shared across panels */
export const SequenceFields: React.FC<{ help?: string }> = ({ help }) => {
    const s = useSequenceSettings();
    return (
        <Stack spacing={0.5}>
            <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap alignItems="center">
                <ColumnPicker label="Hole (optional)" value={s.holeColumn} onChange={v => s.set({ holeColumn: v })} filter="categorical" allowNone noneLabel="None (one sequence)" minWidth={190} />
                <ColumnPicker label="Order by (depth / sample no.)" value={s.positionColumn} onChange={v => s.set({ positionColumn: v })} filter="all" allowNone noneLabel="Row order" minWidth={230} />
                <TextField size="small" label="New run if step >" value={s.maxGap} onChange={e => s.set({ maxGap: e.target.value })} sx={{ width: 150 }} placeholder="never" />
            </Stack>
            <Typography variant="caption" color="text.secondary">
                {help ?? 'Samples are ordered by hole, then position. A text ID orders by its trailing number. Neighbours are never taken across holes or across a step larger than the limit.'}
            </Typography>
        </Stack>
    );
};

export const VisibleOnlySwitch: React.FC<{ value: boolean; onChange: (v: boolean) => void }> = ({ value, onChange }) => (
    <FormControlLabel control={<Switch size="small" checked={value} onChange={e => onChange(e.target.checked)} />} label="Visible rows only" />
);

