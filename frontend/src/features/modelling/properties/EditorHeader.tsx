/**
 * The head of an object's editor (Phase 209): what it is, its name, its
 * colour, whether it is shown in the view and framing it there, locked or
 * not, how it stands (and why, when something is the matter), and deleting
 * it. The same for every kind of object, so that these are always found in
 * the same place; what is particular to the object comes under it.
 */
import React, { useState } from 'react';
import { Alert, Box, IconButton, Tooltip, Typography } from '@mui/material';
import { DeleteOutline, Lock, LockOpen } from '@mui/icons-material';
import { requestDelete } from '../../model/deleteObjects';
import { typeTerm, type ObjectType } from '../../model/objectTypes';
import { t } from '../../model/terms';
import { TypeIcon } from '../typeIcons';
import { ColourField, LookRow, NameField } from './parts';

export interface EditorStatus {
    /** How it stands, in a line */
    text: string;
    /** Something is the matter: the line is the reason */
    problem?: boolean;
    /** What else there is to say of it */
    notes?: readonly string[];
}

interface Props {
    objectKey: string;
    name: string;
    /** What it is: its icon and its name for a geologist */
    type?: ObjectType;
    /** What it is, in words, when it has no type of its own */
    what?: string;
    /** Its icon, when it has no type of its own */
    icon?: React.ReactNode;
    color?: string;
    onColor?: (color: string) => void;
    /** Locked or not (`onLock` left out: it is not a thing that is locked) */
    locked?: boolean;
    onLock?: (locked: boolean) => void;
    status?: EditorStatus | null;
    /** The keys its eye covers, when not its own alone */
    visKeys?: readonly string[];
    /** It can be deleted from here (the default) */
    deletable?: boolean;
    /** How it is drawn, under its shown-or-not line (its opacity, its triangle edges) */
    look?: React.ReactNode;
    /** At the right of its first line (Done, while it is being edited) */
    children?: React.ReactNode;
}

export const EditorHeader: React.FC<Props> = ({ objectKey, name, type, what, icon, color, onColor, locked, onLock, status, visKeys, deletable = true, look, children }) => {
    const [refused, setRefused] = useState<string | null>(null);
    const kind = type ? t(typeTerm(type)) : what;
    return (
        <Box data-testid="editor-header">
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minHeight: 24 }}>
                {type ? <TypeIcon type={type} sx={{ fontSize: 18, color: 'text.secondary' }} /> : icon}
                <Typography variant="body2" color="text.secondary" noWrap data-testid="editor-type" sx={{ flex: 1, minWidth: 0 }}>{kind}</Typography>
                {children}
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.75, mt: 0.5 }}>
                {color !== undefined && onColor && <ColourField value={color} name={name} onChange={onColor} />}
                <Box sx={{ flex: 1, minWidth: 0 }}><NameField objectKey={objectKey} name={name} /></Box>
                {onLock && (
                    <Tooltip title={locked ? 'Locked: it stays as it is, and cannot be deleted. Unlock it.' : 'Lock it as it is: it is not fitted again, and cannot be deleted, until it is unlocked'}>
                        <IconButton size="small" data-action="lock" aria-label={locked ? `Unlock ${name}` : `Lock ${name}`} aria-pressed={!!locked} color={locked ? 'primary' : 'default'} onClick={() => onLock(!locked)}>
                            {locked ? <Lock fontSize="small" /> : <LockOpen fontSize="small" />}
                        </IconButton>
                    </Tooltip>
                )}
                {deletable && (
                    <Tooltip title={locked ? 'It is locked: unlock it to delete it.' : 'Delete it… (what depends on it is said first)'}>
                        <span>
                            <IconButton size="small" data-action="delete" aria-label={`Delete ${name}`} disabled={!!locked} onClick={() => setRefused(requestDelete([objectKey]))}>
                                <DeleteOutline fontSize="small" />
                            </IconButton>
                        </span>
                    </Tooltip>
                )}
            </Box>
            <LookRow objectKeys={[objectKey]} visKeys={visKeys} />
            {look}
            {status && (
                <Box data-testid="editor-status" sx={{ mt: 0.5 }}>
                    <Typography variant="body2" color={status.problem ? 'warning.main' : 'text.primary'}>{status.text}</Typography>
                    {status.notes?.map(note => <Typography key={note} variant="caption" color="text.secondary" sx={{ display: 'block' }}>{note}</Typography>)}
                </Box>
            )}
            {refused && <Alert severity="warning" sx={{ mt: 0.5, py: 0 }} onClose={() => setRefused(null)}>{refused}</Alert>}
        </Box>
    );
};
