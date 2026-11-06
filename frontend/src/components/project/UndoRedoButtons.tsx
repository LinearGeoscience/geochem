/**
 * Undo / redo buttons for the app bar. Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z) are
 * handled by useGlobalShortcuts, which ignores them while typing in a field
 * so text inputs keep their own undo.
 */
import React from 'react';
import { IconButton, Tooltip } from '@mui/material';
import { Undo, Redo } from '@mui/icons-material';
import { useHistoryStore } from '../../store/historyStore';

export const UndoRedoButtons: React.FC = () => {
    const canUndo = useHistoryStore(s => s.canUndo);
    const canRedo = useHistoryStore(s => s.canRedo);
    const undoLabel = useHistoryStore(s => s.past.at(-1)?.label);
    const redoLabel = useHistoryStore(s => s.future.at(-1)?.label);

    return (
        <>
            <Tooltip title={canUndo ? `Undo ${undoLabel ?? ''} (Ctrl+Z)` : 'Nothing to undo'}>
                <span>
                    <IconButton color="inherit" size="small" disabled={!canUndo} onClick={() => useHistoryStore.getState().undo()}>
                        <Undo fontSize="small" />
                    </IconButton>
                </span>
            </Tooltip>
            <Tooltip title={canRedo ? `Redo ${redoLabel ?? ''} (Ctrl+Y)` : 'Nothing to redo'}>
                <span>
                    <IconButton color="inherit" size="small" disabled={!canRedo} onClick={() => useHistoryStore.getState().redo()}>
                        <Redo fontSize="small" />
                    </IconButton>
                </span>
            </Tooltip>
        </>
    );
};
