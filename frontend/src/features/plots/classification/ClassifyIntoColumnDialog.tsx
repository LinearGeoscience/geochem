/**
 * One step of a sequential classification: write the diagram's field names
 * into an existing (or new) class column, optionally only over some current
 * classes ("only overwrite Unclassified") and only for the visible rows.
 * Rows outside every field keep their class.
 */
import React, { useMemo, useState } from 'react';
import {
    Autocomplete, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, TextField, Typography,
} from '@mui/material';
import { useAppStore } from '../../../store/appStore';
import { getStyleArraysColumnar } from '../../../utils/attributeUtils';
import { mergeFieldsIntoColumn } from './classifySamples';

interface Props {
    open: boolean;
    onClose: () => void;
    /** Field name per dataset row (null = outside every field), or null when axes are unset */
    classify: () => (string | null)[] | null;
    defaultColumn: string;
    onDone: (message: string) => void;
}

function distinctClasses(column: string): string[] {
    const col = useAppStore.getState().getRawColumn(column);
    if (!col) return [];
    const set = new Set<string>();
    for (let i = 0; i < col.length && set.size <= 200; i++) {
        const v = col[i] as unknown;
        set.add(v === null || v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v)) ? 'Unclassified' : String(v));
    }
    return [...set].sort();
}

export const ClassifyIntoColumnDialog: React.FC<Props> = ({ open, onClose, classify, defaultColumn, onDone }) => {
    const columns = useAppStore(s => s.columns);
    const [column, setColumn] = useState('');
    const [onlyWhere, setOnlyWhere] = useState<string[]>([]);
    const [visibleOnly, setVisibleOnly] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const target = column || defaultColumn;
    const classColumns = useMemo(() => columns.filter(c => c.type === 'categorical' || c.role === 'Classification').map(c => c.name), [columns]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const existing = useMemo(() => (open && target ? distinctClasses(target) : []), [open, target, columns]);

    const apply = () => {
        const fields = classify();
        if (!fields) { setError('Set all axes before classifying.'); return; }
        const app = useAppStore.getState();
        const n = app.columnarData.rowCount;
        const mask = visibleOnly ? getStyleArraysColumnar(n, c => app.getColumn(c)).visible : undefined;
        const only = onlyWhere.filter(c => existing.includes(c));
        const { values, changed } = mergeFieldsIntoColumn(app.getRawColumn(target) as ArrayLike<unknown> | undefined, fields, {
            onlyWhere: only, rowMask: mask,
        });
        app.addColumn(target, values, 'categorical', 'Classification');
        const notes = [visibleOnly ? 'visible rows only' : '', only.length ? `only over ${only.join(', ')}` : ''].filter(Boolean);
        onDone(`"${target}": ${changed.toLocaleString()} rows changed${notes.length ? ` (${notes.join('; ')})` : ''}.`);
        setError(null);
        onClose();
    };

    return (
        <Dialog open={open} onClose={onClose}>
            <DialogTitle>Classify into a column</DialogTitle>
            <DialogContent sx={{ minWidth: 360 }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
                    <Typography variant="body2" color="text.secondary">
                        Writes each sample's field into the column. Samples outside every field keep their class, so diagrams can be
                        applied one after another.
                    </Typography>
                    <Autocomplete
                        freeSolo
                        options={classColumns}
                        value={target}
                        onChange={(_, v) => setColumn(v || '')}
                        onInputChange={(_, v) => setColumn(v)}
                        renderInput={(params) => <TextField {...params} label="Class column" helperText="Existing column or a new name" />}
                    />
                    {existing.length > 0 && (
                        <Autocomplete
                            multiple
                            options={existing}
                            value={onlyWhere.filter(c => existing.includes(c))}
                            onChange={(_, v) => setOnlyWhere(v)}
                            renderInput={(params) => (
                                <TextField {...params} label="Only overwrite rows currently in" helperText="Empty = any class" />
                            )}
                        />
                    )}
                    <FormControlLabel
                        control={<Checkbox checked={visibleOnly} onChange={(e) => setVisibleOnly(e.target.checked)} />}
                        label="Visible rows only (respect Attribute Manager hiding and filters)"
                    />
                    {error && <Typography color="error" variant="body2">{error}</Typography>}
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="contained" onClick={apply} disabled={!target.trim()}>Classify</Button>
            </DialogActions>
        </Dialog>
    );
};
