/**
 * Asked when a CSV loaded as a plain table looks like a handheld XRF (Vanta)
 * export: the converter reads 0 as below detection, pairs each element with
 * its 1-sigma error and leaves out elements never detected. A plain load keeps
 * the file as it is (element columns are still recognised).
 */
import React from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';

export const VantaPromptDialog: React.FC<{
    fileName: string | null;
    onAnswer: (convert: boolean | null) => void;
}> = ({ fileName, onAnswer }) => (
    <Dialog open={fileName !== null} onClose={() => onAnswer(null)}>
        <DialogTitle>Read as a handheld XRF export?</DialogTitle>
        <DialogContent>
            <Typography variant="body2" sx={{ mb: 1 }}>
                {fileName} has the columns of a Vanta pXRF export (each element's concentration and its 1-sigma error).
            </Typography>
            <Typography variant="body2" color="text.secondary">
                The pXRF converter reads 0 as below detection, keeps each element's error column beside it and leaves out
                elements never detected. Load as a plain table to keep every column and value exactly as in the file.
            </Typography>
        </DialogContent>
        <DialogActions>
            <Button onClick={() => onAnswer(null)}>Cancel</Button>
            <Button onClick={() => onAnswer(false)}>Plain table</Button>
            <Button variant="contained" onClick={() => onAnswer(true)}>Use the pXRF converter</Button>
        </DialogActions>
    </Dialog>
);
