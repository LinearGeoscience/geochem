import React, { useState, useCallback, useEffect } from 'react';
import { Layout } from './components/Layout';
import { DataImport } from './features/data_features/DataImport';
import { AttributeManager } from './components/AttributeManager';
import { PlotManager } from './features/plots/PlotManager';
import { ScatterPlot } from './features/plots/ScatterPlot';
import { TernaryPlot } from './features/plots/TernaryPlot';
import { SpiderPlot } from './features/plots/SpiderPlot';
import { AttributeMap } from './features/plots/AttributeMap';
import { AttributeMap3D } from './features/plots/AttributeMap3D';
import { DownholePlot } from './features/plots/DownholePlot';
import { HistogramPlot } from './features/plots/HistogramPlot';
import { CLRPlot } from './features/plots/CLRPlot';
import { DataView } from './features/data_features/DataView';
import { ColumnManager } from './features/data_features/ColumnManager';
import { SelectionManager } from './features/data_features/SelectionManager';
import { SummaryStats } from './features/analysis/SummaryStats';
import { CorrelationMatrix } from './features/analysis/CorrelationMatrix';
import { ProbabilityPlot } from './features/analysis/ProbabilityPlot';
import { BoxPlot } from './features/analysis/BoxPlot';
import { TransformationManager } from './features/analysis/TransformationManager';
import { VectoringManager } from './features/vectoring/VectoringManager';
import { CalculationManager } from './features/calculations/CalculationManager';
import { Box, Typography, Paper, Tabs, Tab, IconButton } from '@mui/material';
import { ChevronRight, ChevronLeft } from '@mui/icons-material';
import { useAppStore } from './store/appStore';
import { ErrorBoundary } from './components/ErrorBoundary';

// Sidebar width constraints
const MIN_SIDEBAR_WIDTH = 280;
const MAX_SIDEBAR_WIDTH = 600;
const DEFAULT_SIDEBAR_WIDTH = 360;

function App() {
    const { columns, data, currentView } = useAppStore();
    const [analysisTab, setAnalysisTab] = React.useState(0);
    const [rightSidebarOpen, setRightSidebarOpen] = useState(true);
    const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
    const [isResizing, setIsResizing] = useState(false);

    // Handle sidebar resize
    const startResizing = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        setIsResizing(true);
    }, []);

    const stopResizing = useCallback(() => {
        setIsResizing(false);
    }, []);

    const resize = useCallback((e: MouseEvent) => {
        if (isResizing) {
            // Calculate new width from right edge of window
            const newWidth = window.innerWidth - e.clientX - 16; // 16px for padding
            setSidebarWidth(Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, newWidth)));
        }
    }, [isResizing]);

    useEffect(() => {
        if (isResizing) {
            window.addEventListener('mousemove', resize);
            window.addEventListener('mouseup', stopResizing);
        }
        return () => {
            window.removeEventListener('mousemove', resize);
            window.removeEventListener('mouseup', stopResizing);
        };
    }, [isResizing, resize, stopResizing]);


    const renderContent = () => {
        if (currentView === 'import') {
            return <DataImport />;
        }

        if (columns.length === 0) {
            return <DataImport />;
        }

        switch (currentView) {
            case 'plots':
                return (
                    <Box sx={{ display: 'flex', gap: 2 }}>
                        {/* Main content area */}
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                <Box>
                                    <Typography variant="h4">Dashboard</Typography>
                                    <Typography>
                                        Data loaded: <strong>{data.length.toLocaleString()}</strong> rows | <strong>{columns.length}</strong> columns
                                    </Typography>
                                </Box>
                                {useAppStore.getState().plots.length === 0 ? (
                                    <Paper sx={{ p: 4, textAlign: 'center' }}>
                                        <Typography variant="h6" color="text.secondary">
                                            No plots open. Add a plot from the Plot Manager.
                                        </Typography>
                                    </Paper>
                                ) : (
                                    <>
                                        {(() => {
                                            const activePlot = useAppStore.getState().plots.find(p => p.id === useAppStore.getState().activePlotId);
                                            const plotId = activePlot?.id || '';
                                            switch (activePlot?.type) {
                                                case 'scatter': return <ScatterPlot key={plotId} plotId={plotId} />;
                                                case 'ternary': return <TernaryPlot key={plotId} plotId={plotId} />;
                                                case 'spider': return <SpiderPlot key={plotId} plotId={plotId} />;
                                                case 'map': return <AttributeMap key={plotId} plotId={plotId} />;
                                                case 'map3d': return <AttributeMap3D key={plotId} plotId={plotId} />;
                                                case 'downhole': return <DownholePlot key={plotId} plotId={plotId} />;
                                                case 'histogram': return <HistogramPlot key={plotId} plotId={plotId} />;
                                                case 'clr': return <CLRPlot key={plotId} plotId={plotId} />;
                                                default: return null;
                                            }
                                        })()}
                                    </>
                                )}
                            </Box>
                        </Box>
                        {/* Right sidebar */}
                        <Box sx={{ position: 'relative', width: rightSidebarOpen ? sidebarWidth : 40, flexShrink: 0, display: 'flex' }}>
                            {/* Resize handle */}
                            {rightSidebarOpen && (
                                <Box
                                    onMouseDown={startResizing}
                                    sx={{
                                        width: 6,
                                        cursor: 'col-resize',
                                        backgroundColor: isResizing ? 'primary.main' : 'transparent',
                                        '&:hover': {
                                            backgroundColor: 'primary.light',
                                        },
                                        transition: 'background-color 0.15s',
                                        flexShrink: 0,
                                    }}
                                />
                            )}
                            <Box sx={{ flex: 1, position: 'relative' }}>
                                <IconButton
                                    onClick={() => setRightSidebarOpen(!rightSidebarOpen)}
                                    sx={{
                                        position: 'absolute',
                                        left: -20,
                                        top: 0,
                                        zIndex: 1,
                                        backgroundColor: 'background.paper',
                                        boxShadow: 1,
                                        '&:hover': { backgroundColor: 'action.hover' }
                                    }}
                                    size="small"
                                >
                                    {rightSidebarOpen ? <ChevronRight /> : <ChevronLeft />}
                                </IconButton>
                                {rightSidebarOpen && (
                                    <Box
                                        sx={{
                                            position: 'sticky',
                                            top: 80,
                                            maxHeight: 'calc(100vh - 100px)',
                                            overflowY: 'auto',
                                            overflowX: 'hidden',
                                            width: '100%',
                                            '&::-webkit-scrollbar': {
                                                width: '8px',
                                            },
                                            '&::-webkit-scrollbar-thumb': {
                                                backgroundColor: 'rgba(0,0,0,0.2)',
                                                borderRadius: '4px',
                                            }
                                        }}
                                    >
                                        <AttributeManager />
                                        <PlotManager />
                                    </Box>
                                )}
                            </Box>
                        </Box>
                    </Box>
                );
            case 'data':
                return <DataView />;
            case 'columns':
                return <ColumnManager />;
            case 'analysis':
                return (
                    <Box sx={{ display: 'flex', gap: 2 }}>
                        {/* Main content area */}
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Tabs value={analysisTab} onChange={(_, newValue) => setAnalysisTab(newValue)} sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }} variant="scrollable" scrollButtons="auto">
                                <Tab label="Summary Statistics" />
                                <Tab label="Box Plots" />
                                <Tab label="Correlation Matrix" />
                                <Tab label="Probability Plot" />
                                <Tab label="Transformations" />
                                <Tab label="Deposit Vectoring" />
                            </Tabs>
                            {analysisTab === 0 && <SummaryStats />}
                            {analysisTab === 1 && <BoxPlot />}
                            {analysisTab === 2 && <CorrelationMatrix />}
                            {analysisTab === 3 && <ProbabilityPlot />}
                            {analysisTab === 4 && <TransformationManager />}
                            {analysisTab === 5 && <VectoringManager />}
                        </Box>
                        {/* Right sidebar */}
                        <Box sx={{ position: 'relative', width: rightSidebarOpen ? sidebarWidth : 40, flexShrink: 0, display: 'flex' }}>
                            {/* Resize handle */}
                            {rightSidebarOpen && (
                                <Box
                                    onMouseDown={startResizing}
                                    sx={{
                                        width: 6,
                                        cursor: 'col-resize',
                                        backgroundColor: isResizing ? 'primary.main' : 'transparent',
                                        '&:hover': {
                                            backgroundColor: 'primary.light',
                                        },
                                        transition: 'background-color 0.15s',
                                        flexShrink: 0,
                                    }}
                                />
                            )}
                            <Box sx={{ flex: 1, position: 'relative' }}>
                                <IconButton
                                    onClick={() => setRightSidebarOpen(!rightSidebarOpen)}
                                    sx={{
                                        position: 'absolute',
                                        left: -20,
                                        top: 0,
                                        zIndex: 1,
                                        backgroundColor: 'background.paper',
                                        boxShadow: 1,
                                        '&:hover': { backgroundColor: 'action.hover' }
                                    }}
                                    size="small"
                                >
                                    {rightSidebarOpen ? <ChevronRight /> : <ChevronLeft />}
                                </IconButton>
                                {rightSidebarOpen && (
                                    <Box
                                        sx={{
                                            position: 'sticky',
                                            top: 80,
                                            maxHeight: 'calc(100vh - 100px)',
                                            overflowY: 'auto',
                                            overflowX: 'hidden',
                                            width: '100%',
                                            '&::-webkit-scrollbar': {
                                                width: '8px',
                                            },
                                            '&::-webkit-scrollbar-thumb': {
                                                backgroundColor: 'rgba(0,0,0,0.2)',
                                                borderRadius: '4px',
                                            }
                                        }}
                                    >
                                        <AttributeManager />
                                    </Box>
                                )}
                            </Box>
                        </Box>
                    </Box>
                );
            case 'settings':
                return <Typography variant="h5">Settings (Coming Soon)</Typography>;
            default:
                return <DataImport />;
        }
    };

    return (
        <ErrorBoundary>
            <Layout>
                {renderContent()}
                <SelectionManager />
                <CalculationManager />
            </Layout>
        </ErrorBoundary>
    );
}

export default App;
