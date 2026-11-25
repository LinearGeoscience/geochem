/**
 * The versions of the scene, from the Modelling page's toolbar (Phase 212):
 * a button that says how many are kept, and opens the list to keep the scene
 * as it is now, go back to a version, or open a model's Leapfrog export as
 * one. (They were at the foot of the properties with nothing picked, where
 * nobody looked for them.)
 */
import React, { useState } from 'react';
import { Box, Button, Popover, Tooltip } from '@mui/material';
import { History } from '@mui/icons-material';
import { useSceneVersions } from '../../store/sceneVersionsStore';
import { SceneVersions } from './properties/SceneVersions';

export const VersionsMenu: React.FC = () => {
    const count = useSceneVersions(s => s.versions.length);
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    return (
        <>
            <Tooltip describeChild title={anchor ? '' : 'The whole scene, kept under a name to go back to: before a change you may want to undo next week'}>
                <Button size="small" startIcon={<History />} data-action="scene-versions" aria-haspopup="dialog" aria-expanded={!!anchor} onClick={e => setAnchor(e.currentTarget)}>
                    Versions{count > 0 ? ` (${count})` : ''}
                </Button>
            </Tooltip>
            <Popover
                open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }} transformOrigin={{ vertical: 'top', horizontal: 'left' }}
                slotProps={{ paper: { 'aria-label': 'Versions of the scene', role: 'dialog' } as object }}
            >
                <Box sx={{ width: 400, maxWidth: '90vw', maxHeight: '70vh', overflow: 'auto', px: 1.5, pb: 1.5, '& [data-testid="scene-versions"]': { mt: 1 } }}>
                    <SceneVersions />
                </Box>
            </Popover>
        </>
    );
};
