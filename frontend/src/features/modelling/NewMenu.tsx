/**
 * The Modelling page's New menu: everything that can be made, under the
 * group of the tree it goes in (the one list of features/model/newObjects,
 * which the tree's right-click menus and the groups' buttons in the
 * properties are drawn from too), and what there is to say of a thing once
 * it is made from a menu.
 */
import React, { useState } from 'react';
import { Alert, Button, ListItemText, ListSubheader, Menu, MenuItem, Snackbar, Tooltip } from '@mui/material';
import { Add, ArrowDropDown } from '@mui/icons-material';
import { GROUP_TERM, NEW_GROUPS, newActionOf, newIn, newMenuLabel } from '../model/newObjects';
import { t } from '../model/terms';
import { cannotMake, makeFromMenu, sayMade, useMadeNote, useMakeInputs } from './newActions';
import { useTargetView } from './targetView';

/** Everything that can be made, by the group of the tree it goes in (the same list as the tree's menus and the groups' buttons) */
export const NewMenu: React.FC = () => {
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const target = useTargetView();
    useMakeInputs();
    return (
        <>
            <Tooltip describeChild title={anchor ? '' : 'Make something new: a geological model, a surface, a set of points or lines, sections, or logging and meshes from files'}>
                <Button size="small" variant="contained" disableElevation startIcon={<Add />} endIcon={<ArrowDropDown />} data-action="new-menu" aria-haspopup="menu" aria-expanded={!!anchor} onClick={e => setAnchor(e.currentTarget)}>
                    New
                </Button>
            </Tooltip>
            <Menu
                anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}
                MenuListProps={{ dense: true, 'aria-label': 'New' }} slotProps={{ paper: { sx: { minWidth: 260, maxWidth: 340, maxHeight: '80vh' } } }}
            >
                {anchor && NEW_GROUPS.flatMap(group => [
                    <ListSubheader key={`group:${group}`} sx={{ lineHeight: '26px', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}>{t(GROUP_TERM[group])}</ListSubheader>,
                    ...newIn(group).map(made => {
                        const why = cannotMake(made.id, target);
                        return (
                            <MenuItem key={made.id} data-action={newActionOf(made.id)} disabled={!!why} onClick={() => { setAnchor(null); makeFromMenu(made.id, target); }}>
                                <ListItemText primary={newMenuLabel(made)} secondary={why} secondaryTypographyProps={{ sx: { whiteSpace: 'normal', fontSize: 11 } }} />
                            </MenuItem>
                        );
                    }),
                ])}
            </Menu>
        </>
    );
};

/** What was said of the last thing made from a menu */
export const MadeNote: React.FC = () => {
    const note = useMadeNote(s => s.note);
    return (
        <Snackbar open={!!note} onClose={(_, why) => { if (why !== 'clickaway') sayMade(null); }} autoHideDuration={12000} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
            {note ? <Alert severity={note.severity} variant="filled" data-testid="made-note" onClose={() => sayMade(null)} sx={{ maxWidth: 560 }}>{note.text}</Alert> : undefined}
        </Snackbar>
    );
};
