import React, { useState } from 'react';
import { Box, Drawer, List, ListItem, ListItemIcon, ListItemText, AppBar, Toolbar, Typography, IconButton, Divider, Button, Tooltip, Select, MenuItem, FormControl, Chip } from '@mui/material';
import { CloudUpload, TableChart, ViewColumn, BarChart, Analytics, Settings, Menu as MenuIcon, ChevronLeft, Calculate, FilterList, Science, Functions } from '@mui/icons-material';
import { useAppStore, COLUMN_FILTER_LABELS, ColumnFilterType } from '../store/appStore';
import { useCalculationStore } from '../store/calculationStore';
import { ProjectManager } from './ProjectManager';

const DRAWER_WIDTH = 200;

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { currentView, setCurrentView, columns, columnFilter, setColumnFilter, availableFilters } = useAppStore();
    const { openCalculationManager } = useCalculationStore();
    const [sidebarOpen, setSidebarOpen] = useState(true);

    // Only show filter if we have transformed data
    const hasTransformedData = availableFilters.length > 2 || availableFilters.some(f => f !== 'all' && f !== 'raw');

    const menuItems = [
        { id: 'import', label: 'Data Import', icon: <CloudUpload /> },
        { id: 'data', label: 'Data View', icon: <TableChart /> },
        { id: 'columns', label: 'Columns', icon: <ViewColumn /> },
        { id: 'plots', label: 'Plots', icon: <BarChart /> },
        { id: 'analysis', label: 'Analysis', icon: <Analytics /> },
        { id: 'qaqc', label: 'QA/QC', icon: <Science /> },
        { id: 'statistics', label: 'Statistics', icon: <Functions /> },
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

                    {/* Data Filter Dropdown - only show when transformed data exists */}
                    {hasTransformedData && (
                        <>
                            <Divider orientation="vertical" flexItem sx={{ mx: 2, borderColor: 'rgba(255,255,255,0.3)' }} />
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <FilterList sx={{ color: 'rgba(255,255,255,0.7)', fontSize: 20 }} />
                                <FormControl size="small" sx={{ minWidth: 140 }}>
                                    <Select
                                        value={columnFilter}
                                        onChange={(e) => setColumnFilter(e.target.value as ColumnFilterType)}
                                        sx={{
                                            color: 'white',
                                            '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.3)' },
                                            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.5)' },
                                            '& .MuiSvgIcon-root': { color: 'white' },
                                            fontSize: '0.875rem',
                                            height: 32
                                        }}
                                    >
                                        {availableFilters.map((filter) => (
                                            <MenuItem key={filter} value={filter}>
                                                {COLUMN_FILTER_LABELS[filter]}
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>
                                {columnFilter !== 'all' && (
                                    <Chip
                                        label={columnFilter.toUpperCase()}
                                        size="small"
                                        color="secondary"
                                        onDelete={() => setColumnFilter('all')}
                                        sx={{ height: 24 }}
                                    />
                                )}
                            </Box>
                        </>
                    )}
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
