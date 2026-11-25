/**
 * The single window keydown listener for app shortcuts (mounted once in
 * Layout). Workspace actions act on the plot store directly; save/open and
 * rename are delegated to handlers registered by their components.
 */
import { useEffect } from 'react';
import { useAppStore } from '../store/appStore';
import { useHistoryStore } from '../store/historyStore';
import { useUIStore, DragMode } from '../store/uiStore';
import { isTextInput, resolveShortcut, runRegisteredShortcut, ShortcutAction } from '../utils/shortcuts';

const TOOL: Partial<Record<ShortcutAction, DragMode>> = { toolLasso: 'lasso', toolBox: 'select', toolZoom: 'zoom', toolPan: 'pan' };

/** Is a modal (dialog, menu, popover) open? Plain keys then belong to it. */
const modalOpen = () => !!document.querySelector('.MuiModal-root:not(.MuiModal-hidden)');

export function runShortcut(action: ShortcutAction): boolean {
    const app = useAppStore.getState();
    const { plots, activePlotId } = app;
    const k = plots.findIndex(p => p.id === activePlotId);
    const hasData = app.columns.length > 0;
    const inPlots = app.currentView === 'plots';

    switch (action) {
        case 'undo': useHistoryStore.getState().undo(); return true;
        case 'redo': useHistoryStore.getState().redo(); return true;
        case 'newPlot':
            if (!hasData) return false;
            if (!inPlots) app.setCurrentView('plots');
            useUIStore.getState().setNewPlotDialogOpen(true);
            return true;
        case 'closePlot':
            if (!inPlots || !activePlotId) return false;
            app.removePlot(activePlotId); return true;
        case 'duplicatePlot':
            if (!inPlots || !activePlotId) return false;
            app.duplicatePlot(activePlotId); return true;
        case 'nextPlot': case 'prevPlot': {
            if (!inPlots || plots.length < 2) return false;
            const step = action === 'nextPlot' ? 1 : -1;
            app.setActivePlotId(plots[(Math.max(k, 0) + step + plots.length) % plots.length].id);
            return true;
        }
        case 'clearSelection':
            if (!app.selectedIndices.length) return false;
            app.setSelection([]); return true;
        default: {
            const n = /^activatePlot(\d)$/.exec(action);
            if (n) {
                const p = plots[Number(n[1]) - 1];
                if (!inPlots || !p) return false;
                app.setActivePlotId(p.id); return true;
            }
            const tool = TOOL[action];
            if (tool) {
                if (!inPlots) return false;
                useUIStore.getState().setDragMode(tool); return true;
            }
            // save / saveAs / open / renamePlot / toggleGrid / toggleAttributes
            return runRegisteredShortcut(action);
        }
    }
}

export function useGlobalShortcuts(): void {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.repeat && !e.ctrlKey && !e.metaKey) return;
            const action = resolveShortcut(e, isTextInput(e.target));
            if (!action) return;
            // Plain keys (tools, F2, Esc) and workspace keys yield to open dialogs/menus
            const global = action === 'save' || action === 'saveAs' || action === 'open' || action === 'undo' || action === 'redo';
            if (!global && modalOpen()) return;
            if (runShortcut(action)) e.preventDefault();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);
}
