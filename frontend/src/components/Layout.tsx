import React, { useState } from 'react';
import { Box, Drawer, List, ListItem, ListItemIcon, ListItemText, AppBar, Toolbar, Typography, IconButton, Divider, Button, Tooltip, Select, MenuItem, FormControl, Chip } from '@mui/material';
import { CloudUpload, TableChart, ViewColumn, BarChart, Analytics, Settings, Menu as MenuIcon, ChevronLeft, Calculate, FilterList, Science, Biotech, Edit } from '@mui/icons-material';
import Badge from '@mui/material/Badge';
import { useAppStore, COLUMN_FILTER_LABELS, ColumnFilterType } from '../store/appStore';
import { useShallow } from 'zustand/react/shallow';
import { useCalculationStore } from '../store/calculationStore';
import { ProjectManager } from './ProjectManager';

const DRAWER_WIDTH = 200;

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { currentView, columns, columnFilter, availableFilters, geochemMappings, transformationGroups } = useAppStore(useShallow(s => ({ currentView: s.currentView, columns: s.columns, columnFilter: s.columnFilter, availableFilters: s.availableFilters, geochemMappings: s.geochemMappings, transformationGroups: s.transformationGroups })));
    const setCurrentView = useAppStore(s => s.setCurrentView);
    const setColumnFilter = useAppStore(s => s.setColumnFilter);
    const setShowGeochemDialog = useAppStore(s => s.setShowGeochemDialog);
    const { openCalculationManager } = useCalculationStore();
    const [sidebarOpen, setSidebarOpen] = useState(true);

    // Count unconfirmed issues for badge
    const geochemIssueCount = geochemMappings.filter(
        m => !m.isConfirmed && !m.isExcluded && (m.confidence === 'low' || m.confidence === 'unknown')
    ).length;

    // Guard: ensure the Select always receives a value that matches a MenuItem
    const effectiveFilter = availableFilters.includes(columnFilter) ? columnFilter : 'all';

    // Reset store if the persisted filter is no longer valid
    React.useEffect(() => {
        if (columnFilter !== 'all' && !availableFilters.includes(columnFilter)) {
            setColumnFilter('all');
        }
    }, [columnFilter, availableFilters, setColumnFilter]);

    // Show filter when we have geochem mappings (raw-elements) or transformed data
    const hasTransformedData = geochemMappings.length > 0 || availableFilters.length > 2 || availableFilters.some(f => f !== 'all' && f !== 'raw');

    const menuItems = [
        { id: 'import', label: 'Data Import', icon: <CloudUpload /> },
        { id: 'data', label: 'Data View', icon: <TableChart /> },
        { id: 'columns', label: 'Columns', icon: <ViewColumn /> },
        { id: 'plots', label: 'Plots', icon: <BarChart /> },
        { id: 'analysis', label: 'Analysis', icon: <Analytics /> },
        { id: 'qaqc', label: 'QA/QC', icon: <Science /> },
        { id: 'diagram-editor', label: 'Diagram Editor', icon: <Edit /> },
        { id: 'settings', label: 'Settings', icon: <Settings /> },
    ];

    return (
        <Box sx={{ display: 'flex', height: '100vh' }}>
            <AppBar position="fixed" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1, backgroundColor: '#1E1E1E' }}>
                <Toolbar disableGutters sx={{ minHeight: 80, pr: 2 }}>
                    <Box sx={{ width: DRAWER_WIDTH, display: 'flex', alignItems: 'center', flexShrink: 0, pl: 1, boxSizing: 'border-box' }}>
                        <IconButton
                            color="inherit"
                            edge="start"
                            onClick={() => setSidebarOpen(!sidebarOpen)}
                            sx={{ mr: 1 }}
                        >
                            {sidebarOpen ? <ChevronLeft /> : <MenuIcon />}
                        </IconButton>
                        <Typography variant="h6" noWrap component="div" sx={{ fontSize: '1.6rem' }}>
                            GeoChem
                        </Typography>
                    </Box>
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

                    <Divider orientation="vertical" flexItem sx={{ mx: 2, borderColor: 'rgba(255,255,255,0.3)' }} />

                    <Tooltip title="Column Chemistry - Configure element/oxide/unit mappings">
                        <span>
                            <Badge
                                badgeContent={geochemIssueCount}
                                color="warning"
                                invisible={geochemIssueCount === 0}
                                max={99}
                            >
                                <Button
                                    color="inherit"
                                    startIcon={<Biotech />}
                                    onClick={() => setShowGeochemDialog(true)}
                                    disabled={columns.length === 0}
                                    size="small"
                                >
                                    Chemistry
                                </Button>
                            </Badge>
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
                                        value={effectiveFilter}
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
                                        {availableFilters.filter(f => !f.startsWith('group:')).map((filter) => (
                                            <MenuItem key={filter} value={filter}>
                                                {COLUMN_FILTER_LABELS[filter] || filter}
                                            </MenuItem>
                                        ))}
                                        {transformationGroups.length > 0 && <Divider component="li" />}
                                        {availableFilters.filter(f => f.startsWith('group:')).map((filter) => {
                                            const groupId = filter.slice(6);
                                            const group = transformationGroups.find(g => g.id === groupId);
                                            return (
                                                <MenuItem key={filter} value={filter}>
                                                    {group?.name || filter}
                                                </MenuItem>
                                            );
                                        })}
                                    </Select>
                                </FormControl>
                                {columnFilter !== 'all' && (
                                    <Chip
                                        label={
                                            columnFilter.startsWith('group:')
                                                ? transformationGroups.find(g => g.id === columnFilter.slice(6))?.name || columnFilter
                                                : COLUMN_FILTER_LABELS[columnFilter] || columnFilter.toUpperCase()
                                        }
                                        size="small"
                                        color="secondary"
                                        onDelete={() => setColumnFilter('all')}
                                        sx={{ height: 24 }}
                                    />
                                )}
                            </Box>
                        </>
                    )}
                    <Box sx={{ flexGrow: 1 }} />
                    <img
                        src="/logo-linear-geoscience.png"
                        alt="Linear Geoscience"
                        style={{ height: 48, opacity: 0.85 }}
                    />
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
                <Toolbar sx={{ minHeight: 80 }} />
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
                <Toolbar sx={{ minHeight: 80 }} />
                <Box sx={{ flexGrow: 1, p: 3, overflow: 'auto' }}>
                    {children}
                </Box>
                {/* Status bar at bottom */}
                <ProjectManager variant="statusbar" />
            </Box>
        </Box>
    );
};
