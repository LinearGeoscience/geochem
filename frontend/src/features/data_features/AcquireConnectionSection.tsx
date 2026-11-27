import React, { useState } from 'react';
import {
    Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions,
    DialogContent, DialogTitle, IconButton, MenuItem, Paper, TextField, Tooltip, Typography,
} from '@mui/material';
import { Add, ContentCopy, Delete, DriveFileRenameOutline, ExpandMore, NetworkCheck, Save } from '@mui/icons-material';
import type { ProfilesIndex } from '../../services/acquireApi';
import {
    AcquireProfile, TestResult, databaseProblem, fieldMapProblems, profileNameProblem, serverProblem,
} from '../../utils/acquireProfiles';

type NameAction = 'new' | 'duplicate' | 'rename' | 'delete';

interface Props {
    index: ProfilesIndex;
    selected: string | null;
    isNew: boolean;
    draft: AcquireProfile | null;
    dirty: boolean;
    onDraft: (p: AcquireProfile) => void;
    onSelect: (name: string) => void;
    onNew: (name: string) => void;
    onDuplicate: (name: string) => Promise<void>;
    onRename: (name: string) => Promise<void>;
    onDelete: () => Promise<void>;
    test: TestResult | null;
    testCurrent: boolean;
    testing: boolean;
    onTest: () => void;
    saving: boolean;
    onSave: () => void;
    editorOpen: boolean;
    setEditorOpen: (open: boolean) => void;
    editor: React.ReactNode;
}

function TestOutcome({ test, current }: { test: TestResult; current: boolean }) {
    if (!test.ok) return <Alert severity="error">{test.message}</Alert>;
    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Alert severity={current ? 'success' : 'info'}>
                {test.message} SQL Server {test.version}{test.edition ? ` (${test.edition})` : ''}.
                {!current && ' Something has changed since this test: test again.'}
            </Alert>
            {test.can_write ? (
                <Alert severity="warning">
                    This Windows login can change data in this database
                    {test.write_permissions?.length ? ` (${test.write_permissions.join(', ')})` : ''}. The app only ever
                    reads, but a read-only login is safer: ask the database administrator for one.
                </Alert>
            ) : (
                <Chip size="small" color="success" variant="outlined" label="Read-only login" sx={{ alignSelf: 'flex-start' }} />
            )}
            {test.map_problems.length > 0 && <Alert severity="error">{test.map_problems.join('; ')}</Alert>}
        </Box>
    );
}

/**
 * The Connection section of Data Import > Acquire (SQL): which connection
 * profile, its SQL Server and database, the connection test and the field map.
 * Windows sign-in only: there are no user name or password fields.
 * In server mode it only shows the administrator's profile.
 */
export const AcquireConnectionSection: React.FC<Props> = (props) => {
    const { index, selected, isNew, draft, dirty, onDraft, onSelect, test, testCurrent, testing, onTest, saving, onSave,
        editorOpen, setEditorOpen, editor } = props;
    const [dialog, setDialog] = useState<NameAction | null>(null);
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false);

    if (index.server_mode) {
        return (
            <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="subtitle2" gutterBottom>Connection (set by the administrator)</Typography>
                {index.admin ? (
                    <Typography variant="body2">
                        Profile <strong>{index.admin.name}</strong> · SQL Server <strong>{index.admin.server}</strong> ·
                        Database <strong>{index.admin.database}</strong> · Windows sign-in
                    </Typography>
                ) : (
                    <Alert severity="info">{index.admin_error ?? "Acquire isn't set up on this server."}</Alert>
                )}
                {test && <Box sx={{ mt: 1.5 }}><TestOutcome test={test} current={testCurrent} /></Box>}
            </Paper>
        );
    }

    const names = index.profiles.map(p => p.name);
    const serverMsg = draft ? serverProblem(draft.server) : null;
    const dbMsg = draft ? databaseProblem(draft.database) : null;
    const incomplete = draft ? fieldMapProblems(draft.field_map) : [];
    const canTest = !!draft && !serverMsg && !dbMsg && !testing;
    const canSave = !!draft && !serverMsg && !dbMsg && incomplete.length === 0 && (dirty || isNew) && !saving;

    const open = (action: NameAction) => {
        setName(action === 'duplicate' ? `${selected} copy` : action === 'rename' ? selected ?? '' : '');
        setDialog(action);
    };
    const others = names.filter(n => dialog !== 'rename' || n.toLowerCase() !== (selected ?? '').toLowerCase());
    const nameMsg = dialog && dialog !== 'delete' ? profileNameProblem(name, others) : null;
    const confirm = async () => {
        setBusy(true);
        try {
            if (dialog === 'new') props.onNew(name.trim());
            if (dialog === 'duplicate') await props.onDuplicate(name.trim());
            if (dialog === 'rename') await props.onRename(name.trim());
            if (dialog === 'delete') await props.onDelete();
            setDialog(null);
        } finally {
            setBusy(false);
        }
    };

    return (
        <Paper variant="outlined" sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography variant="subtitle2">Connection</Typography>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                <TextField select size="small" label="Profile" sx={{ minWidth: 240, flex: 1 }}
                    value={isNew ? '__new__' : selected ?? ''}
                    onChange={e => { if (e.target.value !== '__new__') onSelect(e.target.value); }}
                    helperText={isNew ? 'New profile, not saved yet' : dirty ? 'Unsaved changes' : ' '}>
                    {isNew && draft && <MenuItem value="__new__">{draft.name} (new)</MenuItem>}
                    {index.profiles.map(p => (
                        <MenuItem key={p.name} value={p.name}>
                            {p.name}{!p.complete ? ' (field map incomplete)' : ''}{p.error ? ' (unreadable)' : ''}
                        </MenuItem>
                    ))}
                </TextField>
                <Tooltip title="New profile"><span><IconButton onClick={() => open('new')}><Add /></IconButton></span></Tooltip>
                <Tooltip title="Duplicate"><span><IconButton disabled={!selected || isNew} onClick={() => open('duplicate')}><ContentCopy /></IconButton></span></Tooltip>
                <Tooltip title="Rename"><span><IconButton disabled={!selected || isNew} onClick={() => open('rename')}><DriveFileRenameOutline /></IconButton></span></Tooltip>
                <Tooltip title="Delete"><span><IconButton disabled={!selected || isNew} onClick={() => open('delete')}><Delete /></IconButton></span></Tooltip>
            </Box>

            {draft && (
                <>
                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
                        <TextField size="small" label="SQL Server" placeholder="sqlserver.example.com or sqlserver\INSTANCE"
                            value={draft.server} error={!!draft.server && !!serverMsg}
                            helperText={(draft.server && serverMsg) || 'Host name or IP, optionally \\INSTANCE and ,port'}
                            onChange={e => onDraft({ ...draft, server: e.target.value.trim() })} />
                        <TextField size="small" label="Database" placeholder="AcquireDatabase"
                            value={draft.database} error={!!draft.database && !!dbMsg}
                            helperText={(draft.database && dbMsg) || 'Signed in with your Windows account'}
                            onChange={e => onDraft({ ...draft, database: e.target.value.trim() })} />
                    </Box>
                    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                        <Button variant="outlined" startIcon={testing ? <CircularProgress size={16} /> : <NetworkCheck />}
                            disabled={!canTest} onClick={onTest}>
                            Test connection
                        </Button>
                        <Button variant="contained" startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <Save />}
                            disabled={!canSave} onClick={onSave}>
                            Save profile
                        </Button>
                    </Box>
                    {test && <TestOutcome test={test} current={testCurrent} />}
                    {incomplete.length > 0 && (
                        <Alert severity="info">
                            The field map isn't complete yet: {incomplete.slice(0, 4).join('; ')}
                            {incomplete.length > 4 ? ` (and ${incomplete.length - 4} more)` : ''}. Use Detect fields, or choose them below.
                        </Alert>
                    )}
                    <Accordion expanded={editorOpen} onChange={(_, e) => setEditorOpen(e)} disableGutters variant="outlined">
                        <AccordionSummary expandIcon={<ExpandMore />}>
                            <Typography variant="body2">
                                Field map: where collars, surveys, assays and the filter fields are
                                {incomplete.length === 0 ? ' (complete)' : ''}
                            </Typography>
                        </AccordionSummary>
                        <AccordionDetails>{editorOpen && editor}</AccordionDetails>
                    </Accordion>
                </>
            )}
            {!draft && names.length === 0 && (
                <Alert severity="info">No connection profiles yet. Choose + to make one for your Acquire database.</Alert>
            )}

            {/* disableRestoreFocus: Enter in the name box would otherwise go on to "press" the + button that opened it */}
            <Dialog open={dialog !== null} onClose={() => !busy && setDialog(null)} maxWidth="xs" fullWidth disableRestoreFocus>
                <DialogTitle>
                    {dialog === 'new' ? 'New connection profile' : dialog === 'duplicate' ? 'Duplicate profile'
                        : dialog === 'rename' ? 'Rename profile' : 'Delete profile?'}
                </DialogTitle>
                <DialogContent>
                    {dialog === 'delete' ? (
                        <Typography variant="body2">
                            Delete the connection profile <strong>{selected}</strong>? Its server, database and field map
                            are removed from this computer. This can't be undone.
                        </Typography>
                    ) : (
                        <TextField autoFocus fullWidth size="small" label="Profile name" sx={{ mt: 1 }} value={name}
                            onChange={e => setName(e.target.value)} error={!!name && !!nameMsg}
                            helperText={(name && nameMsg) || ' '}
                            onKeyDown={e => {
                                if (e.key !== 'Enter') return;
                                e.preventDefault();
                                e.stopPropagation();
                                if (!nameMsg) void confirm();
                            }} />
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDialog(null)} disabled={busy}>Cancel</Button>
                    <Button variant="contained" color={dialog === 'delete' ? 'error' : 'primary'}
                        disabled={busy || (dialog !== 'delete' && !!nameMsg)} onClick={() => void confirm()}>
                        {dialog === 'delete' ? 'Delete' : dialog === 'new' ? 'Create' : dialog === 'duplicate' ? 'Duplicate' : 'Rename'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Paper>
    );
};
