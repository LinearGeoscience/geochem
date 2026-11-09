import React, { useState, useCallback, useEffect, Suspense } from 'react';
import { Layout } from './components/Layout';
import { DataImport } from './features/data_features/DataImport';
import { DataView } from './features/data_features/DataView';
import { ColumnManager } from './features/data_features/ColumnManager';
import { CalculationManager } from './features/calculations/CalculationManager';
import { Box, CircularProgress, ThemeProvider, CssBaseline } from '@mui/material';
import { useAppStore } from './store/appStore';
import { useUIStore } from './store/uiStore';
import { buildTheme } from './theme';
import { GlobalSnackbar } from './components/GlobalSnackbar';
import { useShallow } from 'zustand/react/shallow';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ColumnGeochemDialog } from './components/ColumnGeochemDialog';
import { LoggingIntervalMerge } from './features/data_features/LoggingIntervalMerge';
import SettingsView from './views/SettingsView';

// Heavy views load on demand (Phase 11b): the Plotly-laden chunks only
// download when a chart view opens, so the app shell + import screen are
// instant. Named-export modules are wrapped to satisfy React.lazy.
const PlotsView = React.lazy(() => import('./views/PlotsView'));
const AnalysisView = React.lazy(() => import('./views/AnalysisView'));
const QAQCView = React.lazy(() => import('./views/QAQCView'));
const DiagramEditor = React.lazy(() =>
    import('./features/diagramEditor/DiagramEditor').then(m => ({ default: m.DiagramEditor })));
const WelcomeView = React.lazy(() => import('./features/welcome/WelcomeView'));
const ReportView = React.lazy(() => import('./features/report/ReportView'));

// Sidebar width constraints
const MIN_SIDEBAR_WIDTH = 280;
const MAX_SIDEBAR_WIDTH = 600;
const DEFAULT_SIDEBAR_WIDTH = 420;

const ViewFallback = (
    <Box sx={{ display: 'flex', justifyContent: 'center', p: 8 }}>
        <CircularProgress />
    </Box>
);

function App() {
    const { columns, currentView, showGeochemDialog } = useAppStore(useShallow(s => ({
        columns: s.columns, currentView: s.currentView, showGeochemDialog: s.showGeochemDialog,
    })));
    const setShowGeochemDialog = useAppStore(s => s.setShowGeochemDialog);
    const themeMode = useUIStore(s => s.themeMode);
    const theme = React.useMemo(() => buildTheme(themeMode), [themeMode]);
    const analysisTab = useUIStore(s => s.analysisTab);
    const setAnalysisTab = useUIStore(s => s.setAnalysisTab);
    const [qaqcTab, setQaqcTab] = React.useState(0);
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

    // Shared right-sidebar wiring for the lazy views
    const sidebar = {
        open: rightSidebarOpen,
        width: sidebarWidth,
        isResizing,
        onToggle: () => setRightSidebarOpen(!rightSidebarOpen),
        onStartResize: startResizing,
    };

    const renderContent = () => {
        if (currentView === 'welcome') {
            return <WelcomeView />;
        }

        if (currentView === 'import') {
            return <DataImport />;
        }

        // Diagram editor doesn't require data to be loaded
        if (currentView === 'diagram-editor') {
            return <DiagramEditor />;
        }

        if (columns.length === 0) {
            return <WelcomeView />;
        }

        switch (currentView) {
            case 'plots':
                return <PlotsView />;
            case 'data':
                return <DataView />;
            case 'columns':
                return <ColumnManager />;
            case 'analysis':
                return <AnalysisView tab={analysisTab} onTabChange={setAnalysisTab} sidebar={sidebar} />;
            case 'qaqc':
                return <QAQCView tab={qaqcTab} onTabChange={setQaqcTab} sidebar={sidebar} />;
            case 'report':
                return <ReportView />;
            case 'settings':
                return <SettingsView />;
            default:
                return <DataImport />;
        }
    };

    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <ErrorBoundary>
                <Layout>
                    <Suspense fallback={ViewFallback}>
                        {renderContent()}
                    </Suspense>
                    <CalculationManager />
                    <ColumnGeochemDialog
                        open={showGeochemDialog}
                        onClose={() => setShowGeochemDialog(false)}
                    />
                    <LoggingIntervalMerge />
                </Layout>
                <GlobalSnackbar />
            </ErrorBoundary>
        </ThemeProvider>
    );
}

export default App;
