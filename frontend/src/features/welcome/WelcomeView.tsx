/**
 * Welcome landing (UI Refresh R3) — the first-impression screen.
 * Drag-and-drop import, recent projects, and quick actions. Replaces the
 * bare import form as the default view; the full Data Import view (Vanta
 * PXRF options, drillhole flows) stays reachable.
 */
import React, { useRef, useState } from 'react';
import {
    Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
    IconButton, LinearProgress, List, ListItem, ListItemButton, ListItemText,
    Paper, Tooltip, Typography,
} from '@mui/material';
import {
    UploadFile, FolderOpen, Add, Layers, Edit, Delete, History,
} from '@mui/icons-material';
import { useAppStore } from '../../store/appStore';
import { useShallow } from 'zustand/react/shallow';
import { useProjectStore } from '../../store/projectStore';
import { shortFolder } from '../../services/projectFiles';
import { useUIStore } from '../../store/uiStore';
import { useFlatFileUpload } from '../data_features/useFlatFileUpload';

function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days} days ago`;
    return new Date(iso).toLocaleDateString();
}

export const WelcomeView: React.FC = () => {
    const { isLoading, uploadProgress, streamingStatus, error } = useAppStore(useShallow(s => ({
        isLoading: s.isLoading, uploadProgress: s.uploadProgress,
        streamingStatus: s.streamingStatus, error: s.error,
    })));
    const setCurrentView = useAppStore(s => s.setCurrentView);
    const recentProjects = useProjectStore(s => s.recentProjects);
    const removeRecentProject = useProjectStore(s => s.removeRecentProject);
    const requestOpen = useProjectStore(s => s.requestOpen);
    const themeMode = useUIStore(s => s.themeMode);

    const { submitFile, confirmAction, setConfirmAction } = useFlatFileUpload();

    const [dragOver, setDragOver] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file) submitFile(file);
    };

    return (
        <Box sx={{ maxWidth: 960, mx: 'auto', pt: 6, px: 2 }}>
            {/* Header */}
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mb: 5 }}>
                <img
                    src="/logo-linear-geoscience.png"
                    alt="Linear Geoscience"
                    style={{ height: 44, marginBottom: 16, filter: themeMode === 'light' ? 'invert(0.8)' : 'none' }}
                />
                <Typography variant="h2" component="h1" gutterBottom>
                    GeoChem
                </Typography>
                <Typography variant="body1" color="text.secondary">
                    Interactive geochemical analysis — import data or pick up where you left off.
                </Typography>
            </Box>

            {(isLoading || error) && (
                <Box sx={{ mb: 3 }}>
                    {isLoading && (
                        <>
                            <LinearProgress variant={uploadProgress > 0 ? 'determinate' : 'indeterminate'} value={uploadProgress} />
                            {streamingStatus && (
                                <Typography variant="caption" color="text.secondary">{streamingStatus}</Typography>
                            )}
                        </>
                    )}
                    {error && <Alert severity="error" onClose={() => useAppStore.setState({ error: null })}>{error}</Alert>}
                </Box>
            )}

            {/* Two-column body */}
            <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'stretch' }}>
                {/* Drop zone */}
                <Box sx={{ flex: '1 1 420px', display: 'flex', flexDirection: 'column' }}>
                    <Paper
                        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={handleDrop}
                        onClick={() => fileInputRef.current?.click()}
                        sx={{
                            flex: 1,
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 1.5,
                            p: 6,
                            minHeight: 240,
                            cursor: 'pointer',
                            border: '2px dashed',
                            borderColor: dragOver ? 'primary.main' : 'divider',
                            borderRadius: 2,
                            bgcolor: dragOver ? 'action.selected' : 'transparent',
                            transition: 'border-color 0.15s, background-color 0.15s',
                            '&:hover': { borderColor: 'primary.light' },
                        }}
                    >
                        <UploadFile sx={{ fontSize: 44, color: dragOver ? 'primary.main' : 'text.disabled' }} />
                        <Typography variant="h5" component="div">
                            Drop a data file here
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                            .csv, .xlsx, .xls, or a .gas project — or click to browse
                        </Typography>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".csv,.xlsx,.xls,.gas"
                            style={{ display: 'none' }}
                            onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) submitFile(file);
                                e.target.value = '';
                            }}
                        />
                    </Paper>
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 1, textAlign: 'center' }}>
                        Need Vanta PXRF options or drillhole (collar/survey/assay) import?{' '}
                        <Box
                            component="span"
                            onClick={() => setCurrentView('import')}
                            sx={{ color: 'primary.main', cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
                        >
                            More import options →
                        </Box>
                    </Typography>
                </Box>

                {/* Recent projects */}
                <Paper sx={{ flex: '1 1 340px', p: 2.5, display: 'flex', flexDirection: 'column' }}>
                    <Typography variant="h5" gutterBottom>
                        Recent projects
                    </Typography>
                    {recentProjects.length === 0 ? (
                        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Typography variant="body2" color="text.secondary">
                                No recent projects yet — save your first .chem project and it will appear here.
                            </Typography>
                        </Box>
                    ) : (
                        <>
                            <List sx={{ flex: 1, overflowY: 'auto', mx: -1 }}>
                                {recentProjects.slice(0, 6).map((project) => (
                                    <ListItem
                                        key={project.filePath}
                                        disablePadding
                                        secondaryAction={
                                            <IconButton edge="end" size="small" onClick={() => removeRecentProject(project.filePath)}>
                                                <Delete fontSize="small" />
                                            </IconButton>
                                        }
                                    >
                                        <ListItemButton
                                            onClick={() => requestOpen(project.path ?? null)}
                                            disabled={project.exists === false}
                                            title={project.path ?? project.filePath}
                                        >
                                            <History fontSize="small" sx={{ mr: 1.5, color: 'text.disabled' }} />
                                            <ListItemText
                                                primary={project.name}
                                                secondary={project.exists === false
                                                    ? 'Moved or deleted'
                                                    : `${project.hasRecovery ? 'Unsaved autosave waiting · ' : ''}Opened ${timeAgo(project.lastOpened)}${project.path ? ` · ${shortFolder(project.path)}` : ''}`}
                                                primaryTypographyProps={{ variant: 'body2', fontWeight: 500, noWrap: true }}
                                                secondaryTypographyProps={{ variant: 'caption', noWrap: true, display: 'block' }}
                                            />
                                        </ListItemButton>
                                    </ListItem>
                                ))}
                            </List>
                        </>
                    )}
                </Paper>
            </Box>

            {/* Quick actions */}
            <Box sx={{ display: 'flex', gap: 1.5, justifyContent: 'center', mt: 4, flexWrap: 'wrap' }}>
                <Tooltip title="Open a saved .chem project (Ctrl+O)">
                    <Button startIcon={<FolderOpen />} variant="outlined" onClick={() => requestOpen(null)}>
                        Open Project
                    </Button>
                </Tooltip>
                <Button startIcon={<Add />} variant="outlined" onClick={() => setCurrentView('import')}>
                    Data Import
                </Button>
                <Button startIcon={<Layers />} variant="outlined" onClick={() => setCurrentView('import')}>
                    Drillhole Import
                </Button>
                <Button startIcon={<Edit />} variant="outlined" onClick={() => setCurrentView('diagram-editor')}>
                    Diagram Editor
                </Button>
            </Box>

            {/* Confirm before replacing data (wipes styling/classifications) */}
            <Dialog open={confirmAction !== null} onClose={() => setConfirmAction(null)}>
                <DialogTitle>Replace current data?</DialogTitle>
                <DialogContent>
                    <Alert severity="warning" sx={{ mb: 1 }}>
                        Loading new data will discard your current colour/shape/size
                        classifications and painted groups. Save the project first if you
                        want to keep them.
                    </Alert>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmAction(null)}>Cancel</Button>
                    <Button
                        variant="contained"
                        color="warning"
                        onClick={() => { const action = confirmAction; setConfirmAction(null); action?.(); }}
                    >
                        Replace Data
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default WelcomeView;
