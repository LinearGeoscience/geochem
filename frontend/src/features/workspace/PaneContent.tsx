/**
 * Scrolling pane body. Keeps Plotly charts sized to the pane (react-plotly's
 * useResizeHandler only hears window resizes, not splitter drags) and
 * publishes the pane size through PaneContext for useFillHeight.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box } from '@mui/material';
import Plotly from 'plotly.js';
import { PaneContext, PaneControls, PaneInfo } from './PaneContext';

/**
 * react-plotly (useResizeHandler) resizes on mount without handling the
 * promise; a pane still being attached by the dock rejects it. Harmless:
 * the ResizeObserver below resizes once the pane is displayed.
 */
const HIDDEN_RESIZE = 'Resize must be passed a displayed plot div element.';
function swallowHiddenResize(e: PromiseRejectionEvent) {
    if (e.reason instanceof Error && e.reason.message === HIDDEN_RESIZE) e.preventDefault();
}

export const PaneContent: React.FC<{ controls: PaneControls; children: React.ReactNode }> = ({ controls, children }) => {
    const ref = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState({ width: 0, height: 0 });
    useEffect(() => {
        const el = ref.current;
        if (!el || typeof ResizeObserver === 'undefined') return;
        let frame = 0;
        const ro = new ResizeObserver(() => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                if (el.clientWidth > 0 && el.clientHeight > 0) {
                    setSize(s => (s.width === el.clientWidth && s.height === el.clientHeight ? s : { width: el.clientWidth, height: el.clientHeight }));
                }
                el.querySelectorAll<HTMLElement>('.js-plotly-plot').forEach(gd => {
                    // Skip plots that are not laid out (hidden tab, zero size)
                    if (gd.offsetParent !== null && gd.clientWidth > 0) {
                        // Rejects (async) if the plot was hidden or torn down meanwhile
                        try { Promise.resolve((Plotly as any).Plots.resize(gd)).catch(() => {}); } catch { /* torn down */ }
                    }
                });
            });
        });
        ro.observe(el);
        window.addEventListener('unhandledrejection', swallowHiddenResize);
        return () => { cancelAnimationFrame(frame); ro.disconnect(); window.removeEventListener('unhandledrejection', swallowHiddenResize); };
    }, []);
    const info = useMemo<PaneInfo>(
        () => ({ ...controls, body: ref.current, width: size.width, height: size.height }),
        [controls, size],
    );
    return (
        <PaneContext.Provider value={info}>
            <Box ref={ref} sx={{ height: '100%', overflow: 'auto', bgcolor: 'background.default' }}>
                {children}
            </Box>
        </PaneContext.Provider>
    );
};
