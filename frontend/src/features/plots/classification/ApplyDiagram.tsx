/**
 * "Apply diagram…" for scatter and ternary plots: turns the plot into a
 * classification plot showing the chosen diagram (its computed axes take
 * over). The previous type and settings are kept so the classification
 * plot's "Clear diagram" can restore them.
 */
import React, { useState } from 'react';
import { Button, Tooltip } from '@mui/material';
import { LibraryBooks } from '@mui/icons-material';
import { applyDiagramToPlot } from './applyDiagramToPlot';
import { DiagramGallery } from './DiagramGallery';

export const ApplyDiagramButton: React.FC<{ plotId: string; kind: 'xy' | 'ternary' }> = ({ plotId, kind }) => {
    const [open, setOpen] = useState(false);
    return (
        <>
            <Tooltip title="Plot these samples on a classification diagram from the library">
                <Button size="small" variant="outlined" startIcon={<LibraryBooks />} onClick={() => setOpen(true)}>
                    Apply diagram…
                </Button>
            </Tooltip>
            <DiagramGallery
                open={open}
                onClose={() => setOpen(false)}
                onSelect={(id) => applyDiagramToPlot(plotId, id)}
                kind={kind}
                title={kind === 'ternary' ? 'Apply a ternary diagram' : 'Apply a classification diagram'}
            />
        </>
    );
};
