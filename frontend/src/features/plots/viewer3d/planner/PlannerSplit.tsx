/**
 * The 3D view and, in split view, the planner section beside it with a
 * divider to drag (50/50 to start). The 3D view keeps its place in the tree
 * whether the split is on or off, so it is never rebuilt by toggling.
 */
import React, { useRef } from 'react';
import { Box } from '@mui/material';
import { usePlanStore } from './planStore';

export const PlannerSplit: React.FC<{ children: React.ReactNode; right: React.ReactNode | null }> = ({ children, right }) => {
    const split = usePlanStore(s => s.view2d);
    const setSplit = usePlanStore(s => s.setView2d);
    const box = useRef<HTMLDivElement>(null);
    const on = split.on && right !== null;
    const ratio = Math.min(0.85, Math.max(0.15, split.ratio));

    const onDividerDown = (e: React.PointerEvent) => {
        const el = box.current;
        if (!el) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        e.preventDefault();
    };
    const onDividerMove = (e: React.PointerEvent) => {
        const el = box.current;
        if (!el || !(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return;
        const r = el.getBoundingClientRect();
        if (r.width > 0) setSplit({ ratio: (e.clientX - r.left) / r.width });
    };

    return (
        <Box ref={box} sx={{ flex: 1, minWidth: 0, display: 'flex' }}>
            <Box sx={{ flex: on ? `0 0 calc(${ratio * 100}% - 4px)` : '1 1 auto', minWidth: 0, display: 'flex' }}>
                {children}
            </Box>
            {on && (
                <Box
                    role="separator" aria-orientation="vertical" aria-label="Drag to resize the planner section"
                    onPointerDown={onDividerDown} onPointerMove={onDividerMove}
                    onDoubleClick={() => setSplit({ ratio: 0.5 })}
                    sx={{ flex: '0 0 8px', cursor: 'col-resize', display: 'flex', justifyContent: 'center', touchAction: 'none', '&:hover > div': { bgcolor: 'primary.main' } }}
                >
                    <Box sx={{ width: 2, bgcolor: 'divider', borderRadius: 1 }} />
                </Box>
            )}
            {on && <Box sx={{ flex: 1, minWidth: 0 }}>{right}</Box>}
        </Box>
    );
};
