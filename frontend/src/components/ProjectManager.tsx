import React, { useState, useEffect } from 'react';
import {
    Box,
    Button,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    TextField,
    Typography,
    List,
    ListItem,
    ListItemButton,
    ListItemText,
    ListItemSecondaryAction,
    IconButton,
    Divider,
    Alert,
    Chip,
    Menu,
    MenuItem,
    FormControlLabel,
    Switch,
    Slider,
    Paper,
    Tooltip,
    CircularProgress,
    Snackbar,
} from '@mui/material';
import {
    Save,
    SaveAs,
    FolderOpen,
    Add,
    Delete,
    MoreVert,
    History,
    Warning,
    Settings,
    Schedule,
    CheckCircle,
} from '@mui/icons-material';
import { useProjectStore, autosaveManager, PROJECT_FILE_EXTENSION } from '../store/projectStore';

interface ProjectManagerProps {
    variant?: 'menu' | 'toolbar' | 'statusbar';
}

export const ProjectManager: React.FC<ProjectManagerProps> = ({ variant = 'toolbar' }) => {
    const {
        currentProject,
        isDirty,
        lastSaved,
        fileHandle,
        autosaveEnabled,
        autosaveIntervalMinutes,
        lastAutosave,
        recentProjects,
        isLoading,
        loadError,
        createNewProject,
        saveProjectToFile,
        loadProjectFromFile,
        removeRecentProject,
        setAutosaveEnabled,
        setAutosaveInterval,
        setLoadError,
    } = useProjectStore();

    // Check if File System Access API is supported (Chromium browsers)
    const hasFileSystemAccess = 'showSaveFilePicker' in window;

    const [newProjectDialogOpen, setNewProjectDialogOpen] = useState(false);
    const [newProjectName, setNewProjectName] = useState('');
    const [newProjectDescription, setNewProjectDescription] = useState('');
    const [recentProjectsOpen, setRecentProjectsOpen] = useState(false);
    const [unsavedWarningOpen, setUnsavedWarningOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [pendingAction, setPendingAction] = useState<'new' | 'load' | null>(null);
    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
    const [saveSuccess, setSaveSuccess] = useState(false);

    // Start autosave manager on mount
    useEffect(() => {
        autosaveManager.start();
        return () => autosaveManager.stop();
    }, []);

    // Show save success notification
    useEffect(() => {
        if (lastSaved && !isDirty) {
            setSaveSuccess(true);
        }
    }, [lastSaved, isDirty]);

    const handleMenuOpen = (event: React.MouseEvent<HTMLButtonElement>) => {
        setAnchorEl(event.currentTarget);
    };

    const handleMenuClose = () => {
        setAnchorEl(null);
    };

    const checkUnsavedChanges = (action: 'new' | 'load') => {
        if (isDirty) {
            setPendingAction(action);
            setUnsavedWarningOpen(true);
        } else {
            if (action === 'new') {
                setNewProjectDialogOpen(true);
            } else {
                handleLoad();
            }
        }
    };

    const handleWarningConfirm = () => {
        setUnsavedWarningOpen(false);
        if (pendingAction === 'new') {
            setNewProjectDialogOpen(true);
        } else if (pendingAction === 'load') {
            handleLoad();
        }
        setPendingAction(null);
    };

    const handleWarningSave = async () => {
        await saveProjectToFile();
        setUnsavedWarningOpen(false);
        if (pendingAction === 'new') {
            setNewProjectDialogOpen(true);
        } else if (pendingAction === 'load') {
            handleLoad();
        }
        setPendingAction(null);
    };

    const handleNewProject = () => {
        if (newProjectName.trim()) {
            createNewProject(newProjectName.trim());
            // Set description if provided
            if (newProjectDescription.trim()) {
                useProjectStore.setState((s) => ({
                    currentProject: s.currentProject ? {
                        ...s.currentProject,
                        description: newProjectDescription.trim()
                    } : null
                }));
            }
            setNewProjectDialogOpen(false);
            setNewProjectName('');
            setNewProjectDescription('');
        }
    };

    const handleSave = async () => {
        await saveProjectToFile(false); // false = regular save (use existing handle if available)
        handleMenuClose();
    };

    const handleSaveAs = async () => {
        await saveProjectToFile(true); // true = save as (always show picker)
        handleMenuClose();
    };

    const handleLoad = async () => {
        await loadProjectFromFile();
        handleMenuClose();
    };

    const handleLoadRecent = async () => {
        setRecentProjectsOpen(false);
        await loadProjectFromFile();
    };

    const formatLastSaved = (isoDate: string | null) => {
        if (!isoDate) return 'Never';
        const date = new Date(isoDate);
        const now = new Date();
        const diff = now.getTime() - date.getTime();

        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
        if (diff < 86400000) return date.toLocaleTimeString();
        return date.toLocaleDateString();
    };

    // Status bar variant - shows at bottom of screen
    if (variant === 'statusbar') {
        return (
            <Paper
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                    px: 2,
                    py: 0.5,
                    borderRadius: 0,
                    bgcolor: 'background.default',
                    borderTop: 1,
                    borderColor: 'divider',
                }}
                elevation={0}
            >
                {/* Project name */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="caption" color="text.secondary">
                        Project:
                    </Typography>
                    <Typography variant="caption" fontWeight={500}>
                        {currentProject?.name || 'Untitled'}
                    </Typography>
                    {isDirty && (
                        <Chip label="•" size="small" color="warning" sx={{ height: 16, '& .MuiChip-label': { px: 0.5 } }} />
                    )}
                </Box>

                <Divider orientation="vertical" flexItem />

                {/* File path */}
                {currentProject?.filePath && (
                    <>
                        <Tooltip title={currentProject.filePath}>
                            <Typography variant="caption" color="text.secondary" sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {currentProject.filePath}
                            </Typography>
                        </Tooltip>
                        <Divider orientation="vertical" flexItem />
                    </>
                )}

                {/* Last saved */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="caption" color="text.secondary">
                        Saved:
                    </Typography>
                    <Typography variant="caption">
                        {formatLastSaved(lastSaved)}
                    </Typography>
                </Box>

                {/* Autosave status */}
                {autosaveEnabled && fileHandle && (
                    <>
                        <Divider orientation="vertical" flexItem />
                        <Tooltip title={`Autosave every ${autosaveIntervalMinutes} min - saves to existing file`}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <Schedule fontSize="inherit" sx={{ color: 'success.main', fontSize: 14 }} />
                                <Typography variant="caption" color="success.main">
                                    Autosave ON
                                </Typography>
                            </Box>
                        </Tooltip>
                    </>
                )}
                {autosaveEnabled && !fileHandle && currentProject?.filePath && (
                    <>
                        <Divider orientation="vertical" flexItem />
                        <Tooltip title="Save project to enable autosave">
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <Schedule fontSize="inherit" sx={{ color: 'text.disabled', fontSize: 14 }} />
                                <Typography variant="caption" color="text.disabled">
                                    Autosave (save first)
                                </Typography>
                            </Box>
                        </Tooltip>
                    </>
                )}

                {/* Loading indicator */}
                {isLoading && (
                    <>
                        <Divider orientation="vertical" flexItem />
                        <CircularProgress size={14} />
                    </>
                )}

                {/* Spacer */}
                <Box sx={{ flexGrow: 1 }} />

                {/* Data info */}
                {currentProject && (
                    <Typography variant="caption" color="text.secondary">
                        {currentProject.rowCount} rows × {currentProject.columnCount} columns
                    </Typography>
                )}
            </Paper>
        );
    }

    if (variant === 'menu') {
        return (
            <>
                <IconButton onClick={handleMenuOpen} size="small" color="inherit">
                    <MoreVert />
                </IconButton>
                <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={handleMenuClose}>
                    <MenuItem onClick={() => { handleMenuClose(); checkUnsavedChanges('new'); }}>
                        <Add sx={{ mr: 1 }} /> New Project
                    </MenuItem>
                    <MenuItem onClick={handleSave} disabled={isLoading}>
                        <Save sx={{ mr: 1 }} /> Save{fileHandle ? '' : ' As...'}
                    </MenuItem>
                    {fileHandle && (
                        <MenuItem onClick={handleSaveAs} disabled={isLoading}>
                            <SaveAs sx={{ mr: 1 }} /> Save As...
                        </MenuItem>
                    )}
                    <MenuItem onClick={() => { handleMenuClose(); checkUnsavedChanges('load'); }} disabled={isLoading}>
                        <FolderOpen sx={{ mr: 1 }} /> Open Project
                    </MenuItem>
                    <Divider />
                    <MenuItem onClick={() => { handleMenuClose(); setSettingsOpen(true); }}>
                        <Settings sx={{ mr: 1 }} /> Project Settings
                    </MenuItem>
                    {recentProjects.length > 0 && (
                        <>
                            <Divider />
                            <MenuItem onClick={() => { handleMenuClose(); setRecentProjectsOpen(true); }}>
                                <History sx={{ mr: 1 }} /> Recent Projects
                            </MenuItem>
                        </>
                    )}
                </Menu>

                {renderDialogs()}
            </>
        );
    }

    // Toolbar variant (default)
    return (
        <>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {/* Project name display */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {currentProject?.name || 'No Project'}
                    </Typography>
                    {isDirty && (
                        <Chip label="Unsaved" size="small" color="warning" sx={{ height: 20 }} />
                    )}
                </Box>

                <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />

                {/* Action buttons */}
                <Button
                    size="small"
                    color="inherit"
                    startIcon={<Add />}
                    onClick={() => checkUnsavedChanges('new')}
                    disabled={isLoading}
                >
                    New
                </Button>
                <Tooltip title={fileHandle ? 'Save to current file' : 'Save as new file'}>
                    <Button
                        size="small"
                        startIcon={isLoading ? <CircularProgress size={16} /> : <Save />}
                        onClick={handleSave}
                        variant={isDirty ? 'contained' : 'text'}
                        color={isDirty ? 'primary' : 'inherit'}
                        disabled={isLoading}
                    >
                        Save
                    </Button>
                </Tooltip>
                {fileHandle && (
                    <Tooltip title="Save to a new location">
                        <Button
                            size="small"
                            color="inherit"
                            startIcon={<SaveAs />}
                            onClick={handleSaveAs}
                            disabled={isLoading}
                        >
                            Save As
                        </Button>
                    </Tooltip>
                )}
                <Button
                    size="small"
                    color="inherit"
                    startIcon={<FolderOpen />}
                    onClick={() => checkUnsavedChanges('load')}
                    disabled={isLoading}
                >
                    Open
                </Button>
                <IconButton size="small" color="inherit" onClick={() => setSettingsOpen(true)}>
                    <Settings fontSize="small" />
                </IconButton>
                {recentProjects.length > 0 && (
                    <Button
                        size="small"
                        color="inherit"
                        startIcon={<History />}
                        onClick={() => setRecentProjectsOpen(true)}
                    >
                        Recent
                    </Button>
                )}
            </Box>

            {renderDialogs()}
        </>
    );

    function renderDialogs() {
        return (
            <>
                {/* New Project Dialog */}
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

                {/* Project Settings Dialog */}
                <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)} maxWidth="sm" fullWidth>
                    <DialogTitle>Project Settings</DialogTitle>
                    <DialogContent>
                        {/* Current Project Info */}
                        <Box sx={{ mb: 3 }}>
                            <Typography variant="subtitle2" gutterBottom>Current Project</Typography>
                            <Paper variant="outlined" sx={{ p: 2 }}>
                                <Typography variant="body2">
                                    <strong>Name:</strong> {currentProject?.name || 'Untitled Project'}
                                </Typography>
                                {currentProject?.description && (
                                    <Typography variant="body2" color="text.secondary">
                                        {currentProject.description}
                                    </Typography>
                                )}
                                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                                    <strong>File:</strong> {currentProject?.filePath || 'Not saved yet'}
                                </Typography>
                                <Typography variant="body2" color="text.secondary">
                                    <strong>Last saved:</strong> {lastSaved ? new Date(lastSaved).toLocaleString() : 'Never'}
                                </Typography>
                            </Paper>
                        </Box>

                        {/* Autosave Settings */}
                        <Box>
                            <Typography variant="subtitle2" gutterBottom>Autosave</Typography>
                            <Paper variant="outlined" sx={{ p: 2 }}>
                                {!hasFileSystemAccess && (
                                    <Alert severity="warning" sx={{ mb: 2 }}>
                                        Your browser (Firefox/Safari) doesn't support save-in-place.
                                        Autosave is disabled. Use Chrome or Edge for full save functionality.
                                    </Alert>
                                )}
                                <FormControlLabel
                                    control={
                                        <Switch
                                            checked={autosaveEnabled}
                                            onChange={(e) => setAutosaveEnabled(e.target.checked)}
                                            disabled={!hasFileSystemAccess}
                                        />
                                    }
                                    label="Enable autosave"
                                />
                                {autosaveEnabled && hasFileSystemAccess && (
                                    <Box sx={{ mt: 2, px: 1 }}>
                                        <Typography variant="body2" gutterBottom>
                                            Save every {autosaveIntervalMinutes} minutes
                                        </Typography>
                                        <Slider
                                            value={autosaveIntervalMinutes}
                                            onChange={(_, value) => setAutosaveInterval(value as number)}
                                            min={1}
                                            max={30}
                                            step={1}
                                            marks={[
                                                { value: 1, label: '1' },
                                                { value: 5, label: '5' },
                                                { value: 10, label: '10' },
                                                { value: 15, label: '15' },
                                                { value: 30, label: '30' },
                                            ]}
                                            valueLabelDisplay="auto"
                                        />
                                        <Typography variant="caption" color="text.secondary">
                                            Autosave only works after the project has been saved at least once.
                                        </Typography>
                                        {fileHandle ? (
                                            <Typography variant="caption" color="success.main" sx={{ display: 'block', mt: 1 }}>
                                                Save location set - autosave will update the existing file.
                                            </Typography>
                                        ) : (
                                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                                                Save the project first to enable autosave.
                                            </Typography>
                                        )}
                                    </Box>
                                )}
                                {lastAutosave && (
                                    <Typography variant="caption" color="success.main" sx={{ display: 'block', mt: 1 }}>
                                        Last autosave: {new Date(lastAutosave).toLocaleTimeString()}
                                    </Typography>
                                )}
                            </Paper>
                        </Box>
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={() => setSettingsOpen(false)}>Close</Button>
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

                {/* Recent Projects Dialog */}
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
                                <Alert severity="info" sx={{ mb: 2 }}>
                                    Click on a project to open the file picker. Due to browser security, we cannot directly reopen files - you'll need to select it again.
                                </Alert>
                                <List>
                                    {recentProjects.map((project) => (
                                        <ListItem key={project.filePath} disablePadding>
                                            <ListItemButton onClick={handleLoadRecent}>
                                                <ListItemText
                                                    primary={project.name}
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
                        <Button onClick={handleLoadRecent} variant="contained" startIcon={<FolderOpen />}>
                            Open File...
                        </Button>
                    </DialogActions>
                </Dialog>

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
    }
};

export default ProjectManager;
