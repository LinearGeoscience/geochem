/**
 * Where the view's legends start from the top: under the slice bar while it
 * is there (it runs the width of the view, and its step arrows and slider
 * were under the legends), else at the top.
 */
import { useLayoutEffect, useState, type RefObject } from 'react';

const GAP = 8;

export function useBelowSliceBar(container: RefObject<HTMLElement>, slicing: boolean): number {
    const [top, setTop] = useState(GAP);
    useLayoutEffect(() => {
        const bar = slicing ? container.current?.querySelector<HTMLElement>('[data-testid="slice-bar"]') : null;
        if (!bar) { setTop(GAP); return; }
        const place = () => setTop(Math.round(bar.offsetTop + bar.getBoundingClientRect().height) + GAP);
        place();
        if (typeof ResizeObserver === 'undefined') return;
        const seen = new ResizeObserver(place);
        seen.observe(bar);
        return () => seen.disconnect();
    }, [container, slicing]);
    return top;
}
