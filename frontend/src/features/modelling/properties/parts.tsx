/**
 * Pieces every editor of the properties pane is made of: the object's name
 * (renamed as F2 in the tree does), its colour, shown or hidden in the view
 * the pane acts on, and framing it there.
 */
import React, { useEffect, useState } from 'react';
import { Box, Button, Checkbox, FormControlLabel, TextField, Tooltip, Typography } from '@mui/material';
import { CenterFocusStrong } from '@mui/icons-material';
import { setViewDisplay, useViewDisplay } from '../../../hooks/useViewDisplay';
import { useShownObjects } from '../../../hooks/useViewVisibility';
import { useModelStore } from '../../../store/modelStore';
import { defaultOnSlice, DRAWN_AS_NAME, drawnOf, isSolidKey, type ObjectDisplay, type OwnLook } from '../../model/viewDisplay';
import { useModelCache } from '../../model/modelCache';
import { useWireframeFiles } from '../../model/wireframeFiles';
import { boundsOfKeys, targetViewNow, useTargetView, zoomToKeys } from '../targetView';
import { renameKeepingPicks } from '../tree/treeCommands';
import { smallButton } from './styles';

/** A heading over a few settings */
export const Caption: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.25, mb: 0.25 }}>{children}</Typography>
);

/** A line of plain facts about the object */
export const Fact: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <Typography variant="caption" sx={{ display: 'block' }}>{children}</Typography>
);

/** The object's name: renamed when the box is left or on Enter; Esc puts it back */
export const NameField: React.FC<{ objectKey: string; name: string }> = ({ objectKey, name }) => {
    const [text, setText] = useState(name);
    useEffect(() => setText(name), [name]);
    const commit = () => {
        if (text.trim() && text.trim() !== name) renameKeepingPicks(objectKey, text);
        else setText(name);
    };
    return (
        <TextField
            size="small" variant="standard" fullWidth label="Name" value={text}
            onChange={e => setText(e.target.value)} onBlur={commit}
            onKeyDown={e => {
                if (e.key === 'Enter') (e.target as HTMLElement).blur();
                if (e.key === 'Escape') { setText(name); e.stopPropagation(); }
            }}
            inputProps={{ spellCheck: false, autoComplete: 'off', 'aria-label': 'Name' }}
        />
    );
};

export const ColourField: React.FC<{ value: string; name: string; onChange: (color: string) => void }> = ({ value, name, onChange }) => (
    <Tooltip title="Its colour">
        <Box
            component="input" type="color" value={value} aria-label={`Colour of ${name}`}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
            sx={{ width: 24, height: 24, p: 0, border: 'none', bgcolor: 'transparent', cursor: 'pointer', flexShrink: 0 }}
        />
    </Tooltip>
);

/** Shown or hidden in the view the pane acts on (every object in a folder or group, for those). `what`: what is shown, when not the object itself ("Traces") */
export const ShownBox: React.FC<{ visKeys: readonly string[]; what?: string }> = ({ visKeys, what }) => {
    const target = useTargetView();
    const view = useShownObjects();
    if (visKeys.length === 0) return null;
    const off = visKeys.filter(k => view.hidden.has(k)).length;
    const shown = what ? `${what} shown` : 'Shown';
    return (
        <Tooltip describeChild title={target.id ? `Shown in ${target.title} (each view shows and hides for itself)` : 'Open a 3D view to show and hide objects in it.'}>
            <FormControlLabel
                sx={{ ml: -0.75, mr: 0 }}
                control={(
                    <Checkbox
                        size="small" sx={{ p: 0.5 }} disabled={!target.id} checked={off === 0} indeterminate={off > 0 && off < visKeys.length}
                        onChange={e => view.setShown(visKeys, e.target.checked)}
                    />
                )}
                label={<Typography variant="caption">{target.title ? `${shown} in ${target.title}` : shown}</Typography>}
            />
        </Tooltip>
    );
};

/** Frame the objects in the view the pane acts on */
export const ZoomButton: React.FC<{ objectKeys: readonly string[] }> = ({ objectKeys }) => {
    const target = useTargetView();
    // What has a place changes as surfaces are fitted and files read
    useModelCache(s => s.byId);
    useWireframeFiles(s => s.byFile);
    const why = !target.status?.ready ? 'Open a 3D view first.' : !target.status.here ? 'The view shows other coordinate columns than the model is in.'
        : !boundsOfKeys(objectKeys) ? 'Nothing here has a place yet.' : null;
    return (
        <Tooltip title={why ?? `Frame it in ${target.title}`}>
            <span>
                <Button size="small" sx={smallButton} startIcon={<CenterFocusStrong fontSize="small" />} disabled={!!why} onClick={() => zoomToKeys(target.id, objectKeys)}>
                    Zoom to
                </Button>
            </span>
        </Tooltip>
    );
};

/** The row under an object's name: its colour, shown or not, and framing it */
export const LookRow: React.FC<{ objectKeys: readonly string[]; visKeys?: readonly string[]; children?: React.ReactNode }> = ({ objectKeys, visKeys, children }) => (
    <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, mt: 0.75 }}>
        {children}
        <ShownBox visKeys={visKeys ?? objectKeys} />
        <Box sx={{ flex: 1 }} />
        <ZoomButton objectKeys={objectKeys} />
    </Box>
);

/**
 * An object's own look was changed in the properties: the view the pane acts on draws it so (what that view had of
 * its own for these fields is let go, or the change would not be seen there)
 */
export function ownLookChanged(objectKey: string, fields: readonly (keyof ObjectDisplay)[]): void {
    setViewDisplay(targetViewNow().id, [objectKey], Object.fromEntries(fields.map(f => [f, undefined])));
}

/** Said under an object's own look when the view the pane acts on draws it another way, with the way back */
export const ViewLookNote: React.FC<{ objectKey: string; own: OwnLook }> = ({ objectKey, own }) => {
    const target = useTargetView();
    const view = useViewDisplay(target.id);
    const has = view.display[objectKey];
    if (!has || !target.title) return null;
    const drawn = drawnOf(own, has, defaultOnSlice(objectKey, isSolidKey(useModelStore.getState().scene, objectKey)));
    const said = [
        ...(has.as !== undefined ? [DRAWN_AS_NAME[drawn.as].toLowerCase()] : []),
        ...(has.opacity !== undefined && drawn.faces ? [`${Math.round(drawn.opacity * 100)}% opaque`] : []),
        ...(has.slice === undefined ? [] : drawn.onSlice === 'whole' ? ['whole on a slice'] : drawn.onSlice === 'line' ? ['its line on a slice'] : drawn.onSlice === 'filled' ? ['filled on a slice'] : ['cut by a slice']),
    ];
    return (
        <Typography data-testid="view-look" variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            {`${target.title} draws it its own way (${said.join(', ')}; the Scene tab). `}
            <Button size="small" sx={{ ...smallButton, verticalAlign: 'baseline' }} data-action="own-look" onClick={() => view.set([objectKey], null)}>As it is here</Button>
        </Typography>
    );
};

/** Said when there is no model view for the pane to act in */
export const NoViewNote: React.FC<{ what: string }> = ({ what }) => {
    const target = useTargetView();
    if (target.status) return null;
    return (
        <Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: 0.75 }}>
            {target.id ? 'The 3D view is still opening.' : `Open a 3D view (New 3D view) to ${what}.`}
        </Typography>
    );
};
