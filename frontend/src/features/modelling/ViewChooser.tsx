/**
 * The model view a pane speaks of or acts on (the project tree's eyes, the
 * Scene tab's list): what the pane says of it, its name, and where several
 * are open the choice of another, which brings that view to the front too.
 */
import React from 'react';
import { Box, MenuItem, Select, Typography } from '@mui/material';
import { chooseModelView } from './modellingApi';
import { useModelViewNames } from './targetView';

export const ViewChooser: React.FC<{
    /** What the pane does there, said before the view's name ("What is drawn in") */
    says: string;
    /** The chooser's name to a screen reader */
    label: string;
    viewId: string;
    title: string;
}> = ({ says, label, viewId, title }) => {
    const views = useModelViewNames();
    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
            <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>{says}</Typography>
            {views.length > 1 ? (
                <Select
                    size="small" variant="standard" value={viewId} onChange={e => chooseModelView(e.target.value)}
                    inputProps={{ 'aria-label': label }} sx={{ fontSize: 13, minWidth: 0, flex: 1 }}
                >
                    {views.map(v => <MenuItem key={v.id} value={v.id} dense>{v.title}</MenuItem>)}
                </Select>
            ) : <Typography variant="body2" noWrap sx={{ fontWeight: 600, fontSize: 13 }}>{title}</Typography>}
        </Box>
    );
};
