import React, { useState } from 'react';
import { Box, Drawer, List, ListItem, ListItemIcon, ListItemText, AppBar, Toolbar, Typography, IconButton, Divider, Button, Tooltip } from '@mui/material';
import { CloudUpload, TableChart, ViewColumn, BarChart, Analytics, Settings, Menu as MenuIcon, ChevronLeft, Calculate } from '@mui/icons-material';
import { useAppStore } from '../store/appStore';
import { useCalculationStore } from '../store/calculationStore';
import { ProjectManager } from './ProjectManager';

const DRAWER_WIDTH = 200;

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { currentView, setCurrentView, columns } = useAppStore();
    const { openCalculationManager } = useCalculationStore();
    const [sidebarOpen, setSidebarOpen] = useState(true);

    const menuItems = [
        { id: 'import', label: 'Data Import', icon: <CloudUpload /> },
        { id: 'data', label: 'Data View', icon: <TableChart /> },
        { id: 'columns', label: 'Columns', icon: <ViewColumn /> },
        { id: 'plots', label: 'Plots', icon: <BarChart /> },
        { id: 'analysis', label: 'Analysis', icon: <Analytics /> },
        { id: 'settings', label: 'Settings', icon: <Settings /> },
    ];

    return (
        <Box sx={{ display: 'flex', height: '100vh' }}>
            <AppBar position="fixed" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}>
                <Toolbar>
                    <IconButton
                        color="inherit"
                        edge="start"
                        onClick={() => setSidebarOpen(!sidebarOpen)}
                        sx={{ mr: 2 }}
                    >
                        {sidebarOpen ? <ChevronLeft /> : <MenuIcon />}
                    </IconButton>
                    <Typography variant="h6" noWrap component="div" sx={{ mr: 3 }}>
                        GeoChem Pro
                    </Typography>
                    <Divider orientation="vertical" flexItem sx={{ mr: 2, borderColor: 'rgba(255,255,255,0.3)' }} />
                    <ProjectManager variant="toolbar" />
                    <Divider orientation="vertical" flexItem sx={{ mx: 2, borderColor: 'rgba(255,255,255,0.3)' }} />
                    <Tooltip title="Open Geochemical Calculations">
                        <span>
                            <Button
                                color="inherit"
                                startIcon={<Calculate />}
                                onClick={openCalculationManager}
                                disabled={columns.length === 0}
                                size="small"
                            >
                                Calculations
                            </Button>
                        </span>
                    </Tooltip>
                </Toolbar>
            </AppBar>

            <Drawer
                variant="persistent"
                open={sidebarOpen}
                sx={{
                    width: sidebarOpen ? DRAWER_WIDTH : 0,
                    flexShrink: 0,
                    '& .MuiDrawer-paper': {
                        width: DRAWER_WIDTH,
                        boxSizing: 'border-box',
                    },
                }}
            >
                <Toolbar />
                <Box sx={{ overflow: 'auto' }}>
                    <List>
                        {menuItems.map((item) => (
                            <ListItem
                                key={item.id}
                                onClick={() => setCurrentView(item.id as any)}
                                sx={{
                                    cursor: 'pointer',
                                    backgroundColor: currentView === item.id ? 'action.selected' : 'transparent',
                                    '&:hover': {
                                        backgroundColor: 'action.hover',
                                    },
                                }}
                            >
                                <ListItemIcon>{item.icon}</ListItemIcon>
                                <ListItemText primary={item.label} />
                            </ListItem>
                        ))}
                    </List>
                </Box>
            </Drawer>

            <Box
                component="main"
                sx={{
                    flexGrow: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    width: `calc(100% - ${sidebarOpen ? DRAWER_WIDTH : 0}px)`,
                    transition: 'width 0.3s',
                    ml: sidebarOpen ? 0 : `-${DRAWER_WIDTH}px`,
                    height: '100vh',
                }}
            >
                <Toolbar />
                <Box sx={{ flexGrow: 1, p: 3, overflow: 'auto' }}>
                    {children}
                </Box>
                {/* Status bar at bottom */}
                <ProjectManager variant="statusbar" />
            </Box>
        </Box>
    );
};
