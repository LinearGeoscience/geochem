/**
 * File menu (UI Refresh R2) — consolidates the old AppBar button cluster
 * (New / Save / Save As / Open / Settings / Provenance / Recent) into one
 * menu, plus all project dialogs, the Ctrl+S / Ctrl+Shift+S / Ctrl+O
 * shortcuts, and the crash-recovery offer.
 *
 * Mounted ONCE (in the Layout AppBar) — replaces the old double-mounted
 * ProjectManager and its module-flag single-registration hacks.
 */
import React, { useState, useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
    Button, CircularProgress, Stack, Dialog, DialogTitle, DialogContent,
    DialogActions, Divider, IconButton, List, ListItem, ListItemButton,
    ListItemSecondaryAction, ListItemText, ListSubheader, Menu, MenuItem,
    Snackbar, TextField, Tooltip, Typography, Alert, styled,
} from '@mui/material';
import {
    Add, Save, SaveAs, FolderOpen, Settings, Description, History, Delete,
    Warning, CheckCircle, ExpandMore, SystemUpdateAlt, NewReleases,
} from '@mui/icons-material';
import { useProjectStore, PROJECT_FILE_EXTENSION } from '../../store/projectStore';
import { useAppStore } from '../../store/appStore';
import { useUpdateStore } from '../../store/updateStore';
import { useAuditStore } from '../../store/auditStore';
import { generateProvenanceReport } from '../../utils/generateProvenanceReport';
import { loadSnapshot, clearSnapshot, ProjectSnapshot } from '../../utils/projectSnapshot';
import { registerShortcut } from '../../utils/shortcuts';
import { projectFilesAvailable, listUnsavedRecoveries } from '../../services/projectFiles';

const DirtyDot = styled('span')(({ theme }) => ({
    display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
    backgroundColor: theme.palette.warning.main,
}));

// Guard against React 18 StrictMode double-running the mount effect
let recoveryOffered = false;

const ShortcutHint: React.FC<{ keys: string }> = ({ keys }) => (
    <Typography variant="caption" color="text.disabled" sx={{ ml: 'auto', pl: 3 }}>
        {keys}
    </Typography>
);

export const FileMenu: React.FC = () => {
    const {
        currentProject,
        isDirty,
        lastSaved,
        fileHandle,
        recentProjects,
        isLoading,
        loadError,
        createNewProject,
        saveProjectToFile,
        loadProjectFromFile,
        openProjectPath,
        removeRecentProject,
        setLoadError,
        importProject,
    } = useProjectStore(useShallow(s => ({
        currentProject: s.currentProject,
        isDirty: s.isDirty,
        lastSaved: s.lastSaved,
        fileHandle: s.fileHandle,
        recentProjects: s.recentProjects,
        isLoading: s.isLoading,
        loadError: s.loadError,
        createNewProject: s.createNewProject,
        saveProjectToFile: s.saveProjectToFile,
        loadProjectFromFile: s.loadProjectFromFile,
        openProjectPath: s.openProjectPath,
        removeRecentProject: s.removeRecentProject,
        setLoadError: s.setLoadError,
        importProject: s.importProject,
    })));

    // Live data counts (not stale metadata)
    const liveRowCount = useAppStore(state => state.columnarData.rowCount);
    const liveColumnCount = useAppStore(state => state.columns.length);
    const auditEntries = useAuditStore(state => state.entries);

    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
    const [newProjectDialogOpen, setNewProjectDialogOpen] = useState(false);
    const [newProjectName, setNewProjectName] = useState('');
    const [newProjectDescription, setNewProjectDescription] = useState('');
    const [recentProjectsOpen, setRecentProjectsOpen] = useState(false);
    const [unsavedWarningOpen, setUnsavedWarningOpen] = useState(false);
    const [pendingAction, setPendingAction] = useState<'new' | 'load' | null>(null);
    // Project to open after the unsaved-changes check (null = show the Open dialog)
    const [pendingPath, setPendingPath] = useState<string | null>(null);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [recoverySnapshot, setRecoverySnapshot] = useState<ProjectSnapshot | null>(null);

    // Save-success notification: only when a save just finished (opening a
    // project also sets lastSaved, to the file's date)
    const isSaving = useProjectStore(s => s._isSaving);
    const savedBefore = useRef(lastSaved);
    useEffect(() => {
        if (!isSaving && lastSaved && lastSaved !== savedBefore.current && !isDirty) setSaveSuccess(true);
        if (!isSaving) savedBefore.current = lastSaved;
        // eslint-disable-next-line react-hooks/exhaustive-deps -- fires on the end of a save
    }, [isSaving]);

    // Offer crash/refresh recovery once per page load (appStore has no
    // persistence — the autosave snapshot is the backup)
    useEffect(() => {
        if (recoveryOffered) return;
        recoveryOffered = true;
        if (useAppStore.getState().columnarData.rowCount > 0) return;
        let cancelled = false;
        const noData = () => useAppStore.getState().columnarData.rowCount === 0;
        (async () => {
            if (await projectFilesAvailable()) {
                const [latest] = await listUnsavedRecoveries().catch(() => []);
                if (!cancelled && latest && noData()) {
                    useProjectStore.getState().setRecoveryOffer({
                        kind: 'unsaved', key: latest.key, modified: latest.modified, name: 'Unsaved project',
                    });
                }
                return;
            }
            const snap = await loadSnapshot().catch(() => null);
            if (!cancelled && snap && snap.rowCount > 0 && noData()) setRecoverySnapshot(snap);
        })();
        return () => { cancelled = true; };
    }, []);

    // Closing or reloading the window with unsaved changes asks first
    useEffect(() => {
        const warn = (e: BeforeUnloadEvent) => {
            if (!useProjectStore.getState().isDirty) return;
            e.preventDefault();
            e.returnValue = '';
        };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, []);

    const recoveryOffer = useProjectStore(s => s.recoveryOffer);

    const handleRecoverSnapshot = () => {
        if (recoverySnapshot && importProject(recoverySnapshot.data)) {
            // Keep the snapshot until the user saves to a real file
            useProjectStore.getState().setDirty(true);
        }
        setRecoverySnapshot(null);
    };

    const handleDiscardSnapshot = () => {
        clearSnapshot().catch(() => { /* best-effort */ });
        setRecoverySnapshot(null);
    };

    const closeMenu = () => setAnchorEl(null);

    const checkUnsavedChanges = (action: 'new' | 'load', path: string | null = null) => {
        if (isDirty) {
            setPendingAction(action);
            setPendingPath(path);
            setUnsavedWarningOpen(true);
        } else {
            if (action === 'new') {
                setNewProjectDialogOpen(true);
            } else {
                void openProject(path);
            }
        }
    };

    // Recent projects come from the backend (full paths) when it is running
    useEffect(() => { void useProjectStore.getState().refreshRecents(); }, []);

    // Open requests from elsewhere (Home page recents, Open button)
    const openRequest = useProjectStore(s => s.openRequest);
    const checkRef = useRef(checkUnsavedChanges);
    checkRef.current = checkUnsavedChanges;
    useEffect(() => {
        if (!openRequest) return;
        useProjectStore.getState().clearOpenRequest();
        checkRef.current('load', openRequest.path);
    }, [openRequest]);

    const handleWarningConfirm = () => {
        setUnsavedWarningOpen(false);
        if (pendingAction === 'new') {
            setNewProjectDialogOpen(true);
        } else if (pendingAction === 'load') {
            void openProject(pendingPath);
        }
        setPendingAction(null);
    };

    const handleWarningSave = async () => {
        const success = await saveProjectToFile();
        setUnsavedWarningOpen(false);
        if (!success) {
            // Save failed or was cancelled — don't discard unsaved changes
            setPendingAction(null);
            return;
        }
        if (pendingAction === 'new') {
            setNewProjectDialogOpen(true);
        } else if (pendingAction === 'load') {
            void openProject(pendingPath);
        }
        setPendingAction(null);
    };

    const handleNewProject = () => {
        if (newProjectName.trim()) {
            createNewProject(newProjectName.trim());
            if (newProjectDescription.trim()) {
                useProjectStore.setState((s) => ({
                    currentProject: s.currentProject ? {
                        ...s.currentProject,
                        description: newProjectDescription.trim(),
                    } : null,
                }));
            }
            setNewProjectDialogOpen(false);
            setNewProjectName('');
            setNewProjectDescription('');
        }
    };

    const handleSave = async () => {
        closeMenu();
        await saveProjectToFile(false);
    };

    const handleSaveAs = async () => {
        closeMenu();
        await saveProjectToFile(true);
    };

    /** Open a project by full path, or show the Open dialog (null) */
    async function openProject(path: string | null) {
        closeMenu();
        if (path) await openProjectPath(path);
        else await loadProjectFromFile();
    }

    // Recent entries with a full path open directly; older name-only entries show the Open dialog
    const handleLoadRecent = (project?: { path?: string }) => {
        setRecentProjectsOpen(false);
        closeMenu();
        checkUnsavedChanges('load', project?.path ?? null);
    };

    // Ctrl+S / Ctrl+Shift+S / Ctrl+O through the global shortcut listener;
    // handlers are registered once and read the latest callbacks via a ref.
    const shortcutActions = useRef({ saveProjectToFile, checkUnsavedChanges });
    shortcutActions.current = { saveProjectToFile, checkUnsavedChanges };
    useEffect(() => {
        const off = [
            registerShortcut('save', () => { void shortcutActions.current.saveProjectToFile(false); }),
            registerShortcut('saveAs', () => { void shortcutActions.current.saveProjectToFile(true); }),
            registerShortcut('open', () => shortcutActions.current.checkUnsavedChanges('load')),
        ];
        return () => off.forEach(f => f());
    }, []);

    const handleExportProvenance = () => {
        closeMenu();
        const projectName = currentProject?.name || 'Untitled';
        const report = generateProvenanceReport(auditEntries, {
            projectName,
            rowCount: liveRowCount,
            columnCount: liveColumnCount,
            originalDataSource: currentProject?.originalDataPath,
        });
        const blob = new Blob([report], { type: 'text/plain' });
        const dateStr = new Date().toISOString().slice(0, 10);
        const safeName = projectName.replace(/[^a-z0-9]/gi, '_');
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${safeName}_provenance_${dateStr}.txt`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
    };

    // New Project Dialog (own expression: keeps JSX type-checking tractable)
    const newProjectDialog = (
        <Dialog open={newProjectDialogOpen} onClose={() => setNewProjectDialogOpen(false)} maxWidth="sm" fullWidth>
            <DialogTitle>Create New Project</DialogTitle>
            <DialogContent>
                <TextField
                    autoFocus
                    margin="dense"
                    label="Project Name"
                    fullWidth
                    variant="outlined"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleNewProject()}
                />
                <TextField
                    margin="dense"
                    label="Description (optional)"
                    fullWidth
                    variant="outlined"
                    multiline
                    rows={2}
                    value={newProjectDescription}
                    onChange={(e) => setNewProjectDescription(e.target.value)}
                />
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                    Project will be saved as {PROJECT_FILE_EXTENSION} file
                </Typography>
            </DialogContent>
            <DialogActions>
                <Button onClick={() => setNewProjectDialogOpen(false)}>Cancel</Button>
                <Button onClick={handleNewProject} variant="contained" disabled={!newProjectName.trim()}>
                    Create
                </Button>
            </DialogActions>
        </Dialog>
    );

    // Recent Projects Dialog (own expression: keeps JSX type-checking tractable)
    const recentProjectsDialog = (
        <Dialog
            open={recentProjectsOpen}
            onClose={() => setRecentProjectsOpen(false)}
            maxWidth="sm"
            fullWidth
        >
            <DialogTitle>Recent Projects</DialogTitle>
            <DialogContent>
                {recentProjects.length === 0 ? (
                    <Typography color="text.secondary">No recent projects</Typography>
                ) : (
                    <>
                        <List>
                            {recentProjects.map((project) => (
                                <ListItem key={project.filePath} disablePadding>
                                    <ListItemButton onClick={() => handleLoadRecent(project)} disabled={project.exists === false}>
                                        <ListItemText
                                            primary={project.exists === false ? `${project.name} (moved or deleted)` : project.name}
                                            secondary={
                                                <>
                                                    <Typography variant="caption" component="span" display="block">
                                                        {project.filePath}
                                                    </Typography>
                                                    <Typography variant="caption" component="span" color="text.secondary">
                                                        Opened: {new Date(project.lastOpened).toLocaleDateString()}
                                                    </Typography>
                                                </>
                                            }
                                        />
                                    </ListItemButton>
                                    <ListItemSecondaryAction>
                                        <IconButton
                                            edge="end"
                                            onClick={() => removeRecentProject(project.filePath)}
                                            size="small"
                                        >
                                            <Delete fontSize="small" />
                                        </IconButton>
                                    </ListItemSecondaryAction>
                                </ListItem>
                            ))}
                        </List>
                    </>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={() => setRecentProjectsOpen(false)}>Close</Button>
                <Button onClick={() => handleLoadRecent()} variant="contained" startIcon={<FolderOpen />}>
                    Open File...
                </Button>
            </DialogActions>
        </Dialog>
    );

    return (
        <>
            <Stack direction="row" alignItems="center" spacing={1}>
                <Button
                    color="inherit"
                    endIcon={<ExpandMore sx={{ fontSize: 16 }} />}
                    onClick={(e) => setAnchorEl(e.currentTarget)}
                >
                    File
                </Button>
                <Stack
                    direction="row"
                    alignItems="center"
                    spacing={0.75}
                    sx={{ cursor: 'pointer' }}
                    onClick={(e: React.MouseEvent<HTMLElement>) => setAnchorEl(e.currentTarget)}
                >
                    <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>
                        {currentProject?.name || 'No Project'}
                    </Typography>
                    {isDirty && (
                        <Tooltip title="Unsaved changes — Ctrl+S to save">
                            <DirtyDot />
                        </Tooltip>
                    )}
                    {isLoading && <CircularProgress size={13} />}
                </Stack>
            </Stack>

            <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={closeMenu}>
                <MenuItem onClick={() => { closeMenu(); checkUnsavedChanges('new'); }} disabled={isLoading}>
                    <Add fontSize="small" sx={{ mr: 1 }} /> New Project
                </MenuItem>
                <MenuItem onClick={() => { closeMenu(); checkUnsavedChanges('load'); }} disabled={isLoading} sx={{ minWidth: 260 }}>
                    <FolderOpen fontSize="small" sx={{ mr: 1 }} /> Open… <ShortcutHint keys="Ctrl+O" />
                </MenuItem>
                <Divider />
                <MenuItem onClick={handleSave} disabled={isLoading}>
                    <Save fontSize="small" sx={{ mr: 1 }} /> Save{fileHandle ? '' : ' As…'} <ShortcutHint keys="Ctrl+S" />
                </MenuItem>
                {fileHandle && (
                    <MenuItem onClick={handleSaveAs} disabled={isLoading}>
                        <SaveAs fontSize="small" sx={{ mr: 1 }} /> Save As… <ShortcutHint keys="Ctrl+Shift+S" />
                    </MenuItem>
                )}
                <Divider />
                <MenuItem onClick={() => { closeMenu(); useAppStore.getState().setCurrentView('settings'); }}>
                    <Settings fontSize="small" sx={{ mr: 1 }} /> Project Settings…
                </MenuItem>
                <MenuItem onClick={() => { closeMenu(); void useUpdateStore.getState().checkAndReport(); }}>
                    <SystemUpdateAlt fontSize="small" sx={{ mr: 1 }} /> Check for Updates
                </MenuItem>
                <MenuItem onClick={() => { closeMenu(); useUpdateStore.getState().setDialog('current'); }}>
                    <NewReleases fontSize="small" sx={{ mr: 1 }} /> What's New
                </MenuItem>
                <MenuItem onClick={handleExportProvenance} disabled={auditEntries.length === 0}>
                    <Description fontSize="small" sx={{ mr: 1 }} /> Export Provenance Report
                </MenuItem>
                {recentProjects.length > 0 && ([
                    <Divider key="recent-div" />,
                    <ListSubheader key="recent-header" sx={{ lineHeight: '28px', bgcolor: 'transparent' }}>
                        <Typography variant="overline" color="text.secondary">Recent</Typography>
                    </ListSubheader>,
                    ...recentProjects.slice(0, 5).map((project) => (
                        <MenuItem key={project.filePath} onClick={() => handleLoadRecent(project)} dense disabled={project.exists === false}
                            title={project.path ?? project.filePath}>
                            <History fontSize="small" sx={{ mr: 1, color: 'text.disabled' }} />
                            <ListItemText
                                primary={project.name}
                                primaryTypographyProps={{ variant: 'body2', noWrap: true }}
                            />
                        </MenuItem>
                    )),
                    recentProjects.length > 5 ? (
                        <MenuItem key="recent-more" onClick={() => { closeMenu(); setRecentProjectsOpen(true); }} dense>
                            <Typography variant="body2" color="text.secondary" sx={{ ml: 3.5 }}>
                                All recent projects…
                            </Typography>
                        </MenuItem>
                    ) : null,
                ])}
            </Menu>

            {newProjectDialog}


            {/* Autosave newer than the saved project, or an unsaved session (backend recovery copies) */}
            <Dialog open={recoveryOffer !== null} onClose={() => { void useProjectStore.getState().dismissRecovery(false); }}>
                <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <History color="primary" /> Restore autosaved work?
                </DialogTitle>
                <DialogContent>
                    <Alert severity="info" sx={{ mb: 2 }}>
                        {recoveryOffer?.kind === 'project'
                            ? <>"{recoveryOffer.name}" has autosaved changes from {new Date(recoveryOffer.modified).toLocaleString()} that
                                were never saved to the project file.</>
                            : <>Work from {recoveryOffer ? new Date(recoveryOffer.modified).toLocaleString() : ''} was autosaved before it
                                was saved to a project file.</>}
                    </Alert>
                    <Typography variant="body2" color="text.secondary">
                        Restore loads the autosave (save it to keep it). {recoveryOffer?.kind === 'project'
                            ? 'Keep saved version leaves the project as it was last saved.'
                            : 'Discard deletes the autosave.'}
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button color="error" onClick={() => { void useProjectStore.getState().dismissRecovery(true); }}>
                        {recoveryOffer?.kind === 'project' ? 'Keep saved version' : 'Discard'}
                    </Button>
                    <Button onClick={() => { void useProjectStore.getState().dismissRecovery(false); }}>Not now</Button>
                    <Button variant="contained" onClick={() => { void useProjectStore.getState().restoreRecovery(); }}>Restore</Button>
                </DialogActions>
            </Dialog>

            {/* Crash/refresh recovery (browser snapshot when the backend file service is not available) */}
            <Dialog open={recoverySnapshot !== null} onClose={handleDiscardSnapshot}>
                <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <History color="primary" /> Recover Unsaved Work?
                </DialogTitle>
                <DialogContent>
                    <Alert severity="info" sx={{ mb: 2 }}>
                        An autosaved snapshot of "{recoverySnapshot?.projectName}" was found
                        ({recoverySnapshot?.rowCount.toLocaleString()} rows, saved{' '}
                        {recoverySnapshot ? new Date(recoverySnapshot.savedAt).toLocaleString() : ''}).
                        This usually means the browser was closed or refreshed with unsaved changes.
                    </Alert>
                    <Typography variant="body2" color="text.secondary">
                        Restore it to continue where you left off, or discard it to start fresh.
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleDiscardSnapshot} color="error">Discard</Button>
                    <Button onClick={handleRecoverSnapshot} variant="contained">Restore</Button>
                </DialogActions>
            </Dialog>

            {/* Unsaved Changes Warning */}
            <Dialog open={unsavedWarningOpen} onClose={() => setUnsavedWarningOpen(false)}>
                <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Warning color="warning" /> Unsaved Changes
                </DialogTitle>
                <DialogContent>
                    <Alert severity="warning" sx={{ mb: 2 }}>
                        You have unsaved changes in "{currentProject?.name || 'your project'}". What would you like to do?
                    </Alert>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setUnsavedWarningOpen(false)}>Cancel</Button>
                    <Button onClick={handleWarningConfirm} color="error">
                        Discard Changes
                    </Button>
                    <Button onClick={handleWarningSave} variant="contained">
                        Save First
                    </Button>
                </DialogActions>
            </Dialog>

            {recentProjectsDialog}

            {/* Error Snackbar */}
            <Snackbar
                open={!!loadError}
                autoHideDuration={6000}
                onClose={() => setLoadError(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert onClose={() => setLoadError(null)} severity="error" sx={{ width: '100%' }}>
                    {loadError}
                </Alert>
            </Snackbar>

            {/* Save Success Snackbar */}
            <Snackbar
                open={saveSuccess}
                autoHideDuration={3000}
                onClose={() => setSaveSuccess(false)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert
                    onClose={() => setSaveSuccess(false)}
                    severity="success"
                    icon={<CheckCircle />}
                    sx={{ width: '100%' }}
                >
                    Project saved successfully
                </Alert>
            </Snackbar>
        </>
    );
};
