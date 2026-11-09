/**
 * Shown when "Add PC scores" would overwrite another PCA's score columns:
 * replace them, or keep both by giving this PCA's columns a prefix.
 */
import React, { useState } from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, TextField } from '@mui/material';
import { addPcScoresToData, pcScoreName, type AddPcScoresResult } from './addPcScores';

interface Props {
    conflict: string[] | null;
    onClose: () => void;
    onDone: (r: AddPcScoresResult) => void;
}

export const AddPcScoresDialog: React.FC<Props> = ({ conflict, onClose, onDone }) => {
    const [prefix, setPrefix] = useState('');
    const run = (opts: { prefix?: string; replace?: boolean }) => {
        const r = addPcScoresToData(opts);
        if (r.conflict) { onDone({ ok: false, message: `${r.message} Choose another prefix.` }); return; }
        onDone(r);
        onClose();
    };
    return (
        <Dialog open={!!conflict} onClose={onClose}>
            <DialogTitle>PC score columns already exist</DialogTitle>
            <DialogContent>
                <DialogContentText sx={{ mb: 2 }}>
                    {conflict?.length} columns ({conflict?.slice(0, 4).join(', ')}{conflict && conflict.length > 4 ? ', …' : ''}) hold the scores
                    of a different PCA. Replace them, or keep both by adding this PCA's scores with a prefix.
                </DialogContentText>
                <TextField
                    autoFocus fullWidth size="small" label="Prefix" value={prefix} onChange={(e) => setPrefix(e.target.value)}
                    helperText={prefix.trim() ? `Columns: ${pcScoreName(prefix, 1)}, ${pcScoreName(prefix, 1, true)}, …` : 'e.g. IES, Regional'}
                />
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button color="warning" onClick={() => run({ replace: true })}>Replace</Button>
                <Button variant="contained" disabled={!prefix.trim()} onClick={() => run({ prefix })}>Add with prefix</Button>
            </DialogActions>
        </Dialog>
    );
};
