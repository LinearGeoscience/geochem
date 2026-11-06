import React, { useState } from 'react';
import { CommandFinder } from '../features/commands/CommandFinder';
import { GisDialog } from '../features/data_features/GisDialog';
import { RulesClassifierDialog } from '../features/classification/RulesClassifierDialog';
import { CompareClassificationsDialog } from '../features/classification/CompareClassificationsDialog';
import { ManageSearch } from '@mui/icons-material';
import { Box, Drawer, List, ListItemButton, ListItemIcon, ListItemText, AppBar, Toolbar, Typography, IconButton, Divider, Button, Tooltip, Select, MenuItem, FormControl, Chip } from '@mui/material';
import { Home, CloudUpload, TableChart, ViewColumn, BarChart, Analytics, Settings, Menu as MenuIcon, ChevronLeft, Calculate, FilterList, Science, Biotech, Edit, Brightness4, Brightness7, Article } from '@mui/icons-material';
import Badge from '@mui/material/Badge';
import { useAppStore, COLUMN_FILTER_LABELS, ColumnFilterType } from '../store/appStore';
import { useUIStore } from '../store/uiStore';
import { useShallow } from 'zustand/react/shallow';
import { useCalculationStore } from '../store/calculationStore';
import { FileMenu } from './project/FileMenu';
import { UndoRedoButtons } from './project/UndoRedoButtons';
import { StatusBar } from './project/StatusBar';
import { useGlobalShortcuts } from '../hooks/useGlobalShortcuts';
import { APPBAR_HEIGHT } from '../theme';
import { DataDoctorDialog } from '../features/data_features/DataDoctorDialog';
import { AssayProtocolDialog } from '../features/data_features/AssayProtocolDialog';
import { CalculateColumnsDialog } from '../features/calculations/CalculateColumnsDialog';
import { UpdateNotice } from './UpdateNotice';

const DRAWER_WIDTH = 200;
const RAIL_WIDTH = 56;

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const {
        currentView,
        columns,
        columnFilter,
        availableFilters,
        geochemMappings,
        transformationGroups,
    } = useAppStore(useShallow(s => ({
        currentView: s.currentView,
        columns: s.columns,
        columnFilter: s.columnFilter,
        availableFilters: s.availableFilters,
        geochemMappings: s.geochemMappings,
        transformationGroups: s.transformationGroups,
    })));
    const setCurrentView = useAppStore(s => s.setCurrentView);
    const setColumnFilter = useAppStore(s => s.setColumnFilter);
    const setShowGeochemDialog = useAppStore(s => s.setShowGeochemDialog);
    const openCalculationManager = useCalculationStore(s => s.openCalculationManager);
    const themeMode = useUIStore(s => s.themeMode);
    const toggleThemeMode = useUIStore(s => s.toggleThemeMode);
    const [sidebarOpen, setSidebarOpen] = useState(true);
    useGlobalShortcuts();

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
        { id: 'welcome', label: 'Home', icon: <Home /> },
        { id: 'import', label: 'Data Import', icon: <CloudUpload /> },
        { id: 'data', label: 'Data View', icon: <TableChart /> },
        { id: 'columns', label: 'Columns', icon: <ViewColumn /> },
        { id: 'plots', label: 'Plots', icon: <BarChart /> },
        { id: 'analysis', label: 'Analysis', icon: <Analytics /> },
        { id: 'qaqc', label: 'QA/QC', icon: <Science /> },
        { id: 'report', label: 'Report', icon: <Article /> },
        { id: 'diagram-editor', label: 'Diagram Editor', icon: <Edit /> },
        { id: 'settings', label: 'Settings', icon: <Settings /> },
    ];

    const drawerWidth = sidebarOpen ? DRAWER_WIDTH : RAIL_WIDTH;

    return (
        <Box sx={{ display: 'flex', height: '100vh' }}>
            <AppBar position="fixed" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}>
                <Toolbar disableGutters variant="dense" sx={{ minHeight: APPBAR_HEIGHT, height: APPBAR_HEIGHT, pr: 2, pl: 1 }}>
                    <IconButton color="inherit" edge="start" onClick={() => setSidebarOpen(!sidebarOpen)} sx={{ mx: 0.5 }}>
                        {sidebarOpen ? <ChevronLeft /> : <MenuIcon />}
                    </IconButton>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mr: 2 }}>
                        <img
                            src="/logo-linear-geoscience.png"
                            alt="Linear Geoscience"
                            // The logo asset is pure white — invert it onto the light AppBar
                            style={{ height: 26, filter: themeMode === 'light' ? 'invert(0.8)' : 'none' }}
                        />
                        <Typography variant="subtitle1" sx={{ fontWeight: 600, letterSpacing: '-0.01em' }}>
                            GeoChem
                        </Typography>
                    </Box>

                    <FileMenu />
                    <UndoRedoButtons />

                    <Divider orientation="vertical" flexItem sx={{ mx: 2, my: 1.5 }} />

                    <Tooltip title="Find a command (Ctrl+K)">
                        <Button color="inherit" startIcon={<ManageSearch />} onClick={() => useUIStore.getState().setCommandFinderOpen(true)}>
                            Find
                        </Button>
                    </Tooltip>

                    <Tooltip title="Open Geochemical Calculations">
                        <span>
                            <Button
                                color="inherit"
                                startIcon={<Calculate />}
                                onClick={openCalculationManager}
                                disabled={columns.length === 0}
                            >
                                Calculations
                            </Button>
                        </span>
                    </Tooltip>

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
                                >
                                    Chemistry
                                </Button>
                            </Badge>
                        </span>
                    </Tooltip>

                    {/* Data Filter Dropdown - only show when transformed data exists */}
                    {hasTransformedData && (
                        <>
                            <Divider orientation="vertical" flexItem sx={{ mx: 2, my: 1.5 }} />
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <FilterList sx={{ color: 'text.secondary', fontSize: 20 }} />
                                <FormControl size="small" sx={{ minWidth: 140 }}>
                                    <Select
                                        value={effectiveFilter}
                                        onChange={(e) => setColumnFilter(e.target.value as ColumnFilterType)}
                                        sx={{ fontSize: '0.8125rem', height: 30 }}
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
                                        color="primary"
                                        variant="outlined"
                                        onDelete={() => setColumnFilter('all')}
                                        sx={{ height: 24 }}
                                    />
                                )}
                            </Box>
                        </>
                    )}

                    <Box sx={{ flexGrow: 1 }} />

                    <UpdateNotice />

                    <Tooltip title={themeMode === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}>
                        <IconButton color="inherit" onClick={toggleThemeMode}>
                            {themeMode === 'light' ? <Brightness4 /> : <Brightness7 />}
                        </IconButton>
                    </Tooltip>
                </Toolbar>
            </AppBar>

            <Drawer
                variant="permanent"
                sx={{
                    width: drawerWidth,
                    flexShrink: 0,
                    '& .MuiDrawer-paper': {
                        width: drawerWidth,
                        boxSizing: 'border-box',
                        transition: 'width 0.2s ease',
                        overflowX: 'hidden',
                    },
                }}
            >
                <Toolbar sx={{ minHeight: APPBAR_HEIGHT }} />
                <Box sx={{ overflowY: 'auto', overflowX: 'hidden', pt: 1 }}>
                    <List sx={{ px: 1 }}>
                        {menuItems.map((item) => (
                            <Tooltip key={item.id} title={sidebarOpen ? '' : item.label} placement="right">
                                <ListItemButton
                                    selected={currentView === item.id}
                                    onClick={() => setCurrentView(item.id as any)}
                                    sx={{ mb: 0.25, px: sidebarOpen ? 1.5 : 1.25, justifyContent: sidebarOpen ? 'initial' : 'center' }}
                                >
                                    <ListItemIcon sx={{ minWidth: sidebarOpen ? 36 : 0, justifyContent: 'center' }}>
                                        {item.icon}
                                    </ListItemIcon>
                                    {sidebarOpen && <ListItemText primary={item.label} primaryTypographyProps={{ variant: 'body2' }} />}
                                </ListItemButton>
                            </Tooltip>
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
                    width: `calc(100% - ${drawerWidth}px)`,
                    transition: 'width 0.2s ease',
                    height: '100vh',
                }}
            >
                <Toolbar sx={{ minHeight: APPBAR_HEIGHT }} />
                <Box sx={currentView === 'plots' && columns.length > 0
                    ? { flexGrow: 1, p: 0, overflow: 'hidden', minHeight: 0 }
                    : { flexGrow: 1, p: 3, overflow: 'auto' }}>
                    {children}
                </Box>
                <StatusBar />
            </Box>
            <DataDoctorDialog />
            <AssayProtocolDialog />
            <GisDialogMount />
            <ClassificationDialogsMount />
            <CommandFinder />
            <CalculateColumnsDialog />
        </Box>
    );
};

/** Classify by rules / Compare classifications (Attribute Manager ⋮, command finder) */
const ClassificationDialogsMount: React.FC = () => {
    const rules = useUIStore(st => st.rulesOpen);
    const compare = useUIStore(st => st.compareOpen);
    return (
        <>
            {rules && <RulesClassifierDialog open onClose={() => useUIStore.getState().setRulesOpen(false)} />}
            {compare && <CompareClassificationsDialog open onClose={() => useUIStore.getState().setCompareOpen(false)} />}
        </>
    );
};

/** GIS dialog, opened from the Data view or the command finder */
const GisDialogMount: React.FC = () => {
    const open = useUIStore(st => st.gisOpen);
    return <GisDialog open={open} onClose={() => useUIStore.getState().setGisOpen(false)} />;
};
