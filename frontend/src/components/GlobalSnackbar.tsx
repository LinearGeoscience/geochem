/**
 * Renders the global notification queue (store/notificationStore.ts).
 * Mounted once in App.
 */
import React from 'react';
import { Snackbar, Alert, Button } from '@mui/material';
import { useNotificationStore } from '../store/notificationStore';

export const GlobalSnackbar: React.FC = () => {
    const current = useNotificationStore(s => s.current);
    const dismiss = useNotificationStore(s => s.dismiss);

    return (
        <Snackbar
            key={current?.id}
            open={current !== null}
            autoHideDuration={current?.action ? 12000 : current?.severity === 'error' ? 8000 : 4000}
            onClose={(_, reason) => { if (reason !== 'clickaway') dismiss(); }}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
            <Alert
                severity={current?.severity ?? 'info'}
                variant="filled"
                onClose={dismiss}
                action={current?.action ? (
                    <Button color="inherit" size="small" onClick={() => { current.action!.run(); dismiss(); }}>
                        {current.action.label}
                    </Button>
                ) : undefined}
                sx={{ maxWidth: 560 }}
            >
                {current?.message}
            </Alert>
        </Snackbar>
    );
};
