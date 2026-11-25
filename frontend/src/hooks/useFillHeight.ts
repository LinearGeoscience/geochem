/**
 * Height for a chart so it fills the rest of its dock pane below whatever
 * sits above it (control bar, chips). Outside a pane returns `fallback`.
 *
 *   const { ref, height } = useFillHeight<HTMLDivElement>(600);
 *   <Box ref={ref}><Plot layout={{ height }} /></Box>
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { isCompactPane, usePane } from '../features/workspace/PaneContext';

export function useFillHeight<T extends HTMLElement = HTMLDivElement>(fallback: number, min = 320, reserve = 16) {
    const pane = usePane();
    const ref = useRef<T>(null);
    const [height, setHeight] = useState<number | null>(null);
    const body = pane?.body ?? null;
    const paneW = pane?.width ?? 0;
    const paneH = pane?.height ?? 0;
    useLayoutEffect(() => {
        const el = ref.current;
        if (!body || !el || paneH <= 0) { setHeight(null); return; }
        const measure = () => {
            const top = el.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
            // Tiled (short) panes: let the chart shrink rather than scroll the pane
            const floor = isCompactPane(pane) ? Math.min(min, 140) : min;
            const h = Math.max(floor, Math.floor(paneH - top - reserve));
            setHeight(prev => (prev === h ? prev : h));
        };
        measure();
        // What sits above it can change height with the pane the same size (a bar that wraps to a second row): measured
        // again then, or the chart runs past the foot of the pane
        if (typeof ResizeObserver === 'undefined') return;
        const above = new ResizeObserver(measure);
        for (let p: Element | null = el; p && p !== body; p = p.parentElement) {
            for (let s = p.previousElementSibling; s; s = s.previousElementSibling) above.observe(s);
        }
        return () => above.disconnect();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- pane: its size is in paneW / paneH
    }, [body, paneW, paneH, min, reserve]);
    return { ref, height: pane && height !== null ? height : fallback };
}
