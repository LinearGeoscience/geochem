/**
 * Asks before objects are deleted, naming them and what depends on them
 * (features/model/treeRules deleteSummary), and says whether it can be
 * undone. `DeleteRequestDialog` is the one mounted for the whole app: every
 * delete button asks through features/model/deleteObjects `requestDelete`.
 */
import React, { useMemo } from 'react';
import { Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Typography } from '@mui/material';
import { useAppStore } from '../../../store/appStore';
import { useDrillholeStore } from '../../../store/drillholeStore';
import { useModelStore } from '../../../store/modelStore';
import { cancelDelete, confirmDelete, setDeleteAlso, useDeleteRequest } from '../../model/deleteObjects';
import { nameOfKey } from '../../model/projectTree';
import { sceneLinks } from '../../model/sceneLinks';
import { deleteSummary, type DeleteSummary } from '../../model/treeRules';

const MAX_LISTED = 12;

const Listed: React.FC<{ items: string[] }> = ({ items }) => (
    <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
        {items.slice(0, MAX_LISTED).map((t, i) => <Typography key={i} component="li" variant="body2">{t}</Typography>)}
        {items.length > MAX_LISTED && <Typography component="li" variant="body2" color="text.secondary">and {items.length - MAX_LISTED} more</Typography>}
    </Box>
);

/** Surfaces that can go with the models being deleted: only they use them */
export interface DeleteAlso { names: string[]; on: boolean; onChange: (on: boolean) => void }

export const DeleteObjectsDialog: React.FC<{ summary: DeleteSummary | null; also?: DeleteAlso | null; onCancel: () => void; onDelete: () => void }> = ({ summary, also, onCancel, onDelete }) => (
    <Dialog open={!!summary} onClose={onCancel} maxWidth="xs" fullWidth aria-labelledby="delete-objects-title">
        {summary && (
            <>
                <DialogTitle id="delete-objects-title" sx={{ pb: 1 }}>
                    {summary.names.length === 1 ? `Delete ${summary.names[0]}?` : `Delete ${summary.names.length} objects?`}
                </DialogTitle>
                <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                    {summary.names.length > 1 && <Listed items={summary.names} />}
                    {also && also.names.length > 0 && (
                        <Box data-testid="delete-also">
                            <FormControlLabel
                                sx={{ ml: -0.75, alignItems: 'flex-start' }}
                                control={<Checkbox size="small" sx={{ p: 0.5 }} checked={also.on} onChange={e => also.onChange(e.target.checked)} />}
                                label={(
                                    <Typography variant="body2" sx={{ pt: 0.25 }}>
                                        Also delete the {also.names.length === 1 ? 'surface' : `${also.names.length} surfaces`} only {summary.names.length === 1 ? 'it uses' : 'they use'}
                                    </Typography>
                                )}
                            />
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', pl: 2.75 }}>
                                {also.names.slice(0, MAX_LISTED).join(', ')}{also.names.length > MAX_LISTED ? ` and ${also.names.length - MAX_LISTED} more` : ''}.
                                {also.on ? '' : ` Unticked, ${also.names.length === 1 ? 'it stays' : 'they stay'} in the project, under Surfaces.`}
                            </Typography>
                        </Box>
                    )}
                    {summary.dependents.length > 0 && (
                        <Box>
                            <Typography variant="body2" sx={{ mb: 0.5 }}>These depend on {summary.names.length === 1 ? 'it' : 'them'}:</Typography>
                            <Listed items={summary.dependents} />
                        </Box>
                    )}
                    {summary.undoable
                        ? <Typography variant="body2" color="text.secondary">Undo (Ctrl+Z) puts it all back.</Typography>
                        : <Alert severity="warning" sx={{ py: 0 }}>A logging table is not part of the undo history: deleting it cannot be undone.</Alert>}
                </DialogContent>
                <DialogActions>
                    <Button onClick={onCancel}>Cancel</Button>
                    <Button color="error" variant="contained" onClick={onDelete} autoFocus>Delete</Button>
                </DialogActions>
            </>
        )}
    </Dialog>
);

/** The dialog for the delete being asked about (features/model/deleteObjects), wherever it was asked from */
export const DeleteRequestDialog: React.FC = () => {
    const asked = useDeleteRequest(s => s.keys);
    const scene = useModelStore(s => s.scene);
    const db = useDrillholeStore(s => s.db);
    const also = useDeleteRequest(s => s.also);
    const withAlso = useDeleteRequest(s => s.withAlso);
    const summary = useMemo(() => {
        if (!asked) return null;
        // What depends on what goes is told of everything that goes; the dialog is still headed by what was asked for
        const all = deleteSummary(scene, db, sceneLinks(scene, db, useAppStore.getState().columns.map(c => c.name)), withAlso ? [...asked, ...also] : asked);
        return { ...all, names: all.names.slice(0, asked.length) };
    }, [asked, also, withAlso, scene, db]);
    const offered = asked && also.length > 0 ? { names: also.map(k => nameOfKey(scene, db, k)), on: withAlso, onChange: setDeleteAlso } : null;
    return <DeleteObjectsDialog summary={summary} also={offered} onCancel={cancelDelete} onDelete={confirmDelete} />;
};
