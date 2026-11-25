/**
 * A surface whose fit was stopped before it was done (Phase 223): what is
 * shown of it is said, with the button that fits it now. Nothing when its
 * fit was not stopped.
 */
import React from 'react';
import { Alert, Button } from '@mui/material';
import { stoppedNote } from '../../model/describe';
import { refitSurface, useModelCache } from '../../model/modelCache';

export const StoppedFit: React.FC<{ surfaceId: string }> = ({ surfaceId }) => {
    const result = useModelCache(s => s.byId[surfaceId]);
    const note = stoppedNote(result);
    if (!note) return null;
    return (
        <Alert
            severity="warning" data-testid="fit-stopped" sx={{ mt: 0.5, py: 0, '& .MuiAlert-message': { fontSize: 12 } }}
            action={<Button size="small" color="inherit" data-action="fit-now" sx={{ textTransform: 'none', fontSize: 12, whiteSpace: 'nowrap' }} onClick={() => refitSurface(surfaceId)}>Fit now</Button>}
        >
            {note}
        </Alert>
    );
};
