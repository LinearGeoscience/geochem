/**
 * Distribution of a numeric field with the class breaks drawn on it; drag a
 * break to move it (the classes either side follow, one undo step per drag).
 * Canvas, no Plotly: it redraws instantly and holds no WebGL context.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, IconButton, Tooltip, Typography, useTheme } from '@mui/material';
import { AttributeConfig, AttributeType, formatBreak, useAttributeStore } from '../../store/attributeStore';
import type { ColumnData } from '../../types/columnarData';
import { isNumericColumn } from '../../types/columnarData';

const HEIGHT = 56;
const BINS = 60;
const GRAB_PX = 5;

interface Props {
    tab: AttributeType;
    config: AttributeConfig;
    column: ColumnData | undefined;
}

export const BreakHistogram: React.FC<Props> = ({ tab, config, column }) => {
    const theme = useTheme();
    const boxRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [width, setWidth] = useState(300);
    const [log, setLog] = useState(config.method === 'logEqual');
    const [drag, setDrag] = useState<{ k: number; value: number } | null>(null);

    useEffect(() => setLog(config.method === 'logEqual'), [config.method]);
    useEffect(() => {
        const el = boxRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => setWidth(Math.max(120, el.clientWidth)));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const ranges = useMemo(
        () => config.entries.filter(e => e.type === 'range' && !e.isDefault && e.min !== undefined && e.max !== undefined)
            .sort((a, b) => a.min! - b.min!),
        [config.entries],
    );

    // Value range and bins (log10 when asked and the data allow it)
    const hist = useMemo(() => {
        if (!column || !isNumericColumn(column)) return null;
        let lo = Infinity, hi = -Infinity, minPos = Infinity;
        for (let i = 0; i < column.length; i++) {
            const v = column[i];
            if (!Number.isFinite(v)) continue;
            if (v < lo) lo = v;
            if (v > hi) hi = v;
            if (v > 0 && v < minPos) minPos = v;
        }
        if (!Number.isFinite(lo)) return null;
        const useLog = log && Number.isFinite(minPos) && hi > minPos;
        const a = useLog ? Math.log10(minPos) : lo;
        const b = useLog ? Math.log10(hi) : hi;
        const span = b - a || 1;
        const counts = new Uint32Array(BINS);
        for (let i = 0; i < column.length; i++) {
            const v = column[i];
            if (!Number.isFinite(v)) continue;
            const x = useLog ? (v > 0 ? Math.log10(v) : a) : v;
            counts[Math.min(BINS - 1, Math.max(0, Math.floor(((x - a) / span) * BINS)))]++;
        }
        let max = 0;
        for (const c of counts) if (c > max) max = c;
        return { a, b, span, counts, max, useLog };
    }, [column, log]);

    const toX = (v: number) => {
        if (!hist) return 0;
        const x = hist.useLog ? (v > 0 ? Math.log10(v) : hist.a) : v;
        return ((x - hist.a) / hist.span) * width;
    };
    const fromX = (px: number) => {
        if (!hist) return 0;
        const x = hist.a + (Math.max(0, Math.min(width, px)) / width) * hist.span;
        return hist.useLog ? 10 ** x : x;
    };

    // interior breaks: between class k and k+1
    const breaks = ranges.slice(1).map((r, k) => (drag && drag.k === k ? drag.value : r.min!));

    useEffect(() => {
        const c = canvasRef.current;
        if (!c || !hist) return;
        const dpr = window.devicePixelRatio || 1;
        c.width = width * dpr;
        c.height = HEIGHT * dpr;
        const g = c.getContext('2d');
        if (!g) return;
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, width, HEIGHT);
        const barH = HEIGHT - 8;
        // class bands along the bottom, in each class's colour
        ranges.forEach((r, k) => {
            const x0 = toX(k === 0 ? r.min! : breaks[k - 1]);
            const x1 = toX(k === ranges.length - 1 ? r.max! : breaks[k]);
            g.fillStyle = tab === 'color' && r.color ? r.color : k % 2 ? theme.palette.action.disabled : theme.palette.action.selected;
            g.globalAlpha = r.visible ? 0.9 : 0.25;
            g.fillRect(x0, HEIGHT - 6, Math.max(1, x1 - x0), 6);
        });
        g.globalAlpha = 1;
        // bars (sqrt scale so the tail stays visible)
        const bw = width / BINS;
        g.fillStyle = theme.palette.text.secondary;
        for (let i = 0; i < BINS; i++) {
            const h = hist.max ? Math.sqrt(hist.counts[i] / hist.max) * (barH - 2) : 0;
            if (h > 0) g.fillRect(i * bw + 0.5, barH - h, Math.max(1, bw - 1), h);
        }
        // break lines
        g.strokeStyle = theme.palette.primary.main;
        g.lineWidth = 1.5;
        breaks.forEach((v, k) => {
            const x = Math.round(toX(v)) + 0.5;
            g.globalAlpha = drag && drag.k !== k ? 0.5 : 1;
            g.beginPath();
            g.moveTo(x, 0);
            g.lineTo(x, HEIGHT);
            g.stroke();
        });
        g.globalAlpha = 1;
    });

    if (!hist || ranges.length === 0) return null;

    const hit = (px: number) => {
        let best = -1, dist = GRAB_PX + 1;
        breaks.forEach((v, k) => {
            const d = Math.abs(toX(v) - px);
            if (d < dist) { dist = d; best = k; }
        });
        return best;
    };
    const localX = (e: React.PointerEvent) => e.clientX - (e.currentTarget as HTMLElement).getBoundingClientRect().left;

    return (
        <Box ref={boxRef} sx={{ position: 'relative', mt: 0.5 }}>
            <canvas
                ref={canvasRef}
                aria-label="Class breaks on the value distribution (drag a break to move it)"
                style={{ width: '100%', height: HEIGHT, display: 'block', touchAction: 'none' }}
                onPointerDown={(e) => {
                    const k = hit(localX(e));
                    if (k < 0) return;
                    (e.target as HTMLElement).setPointerCapture(e.pointerId);
                    setDrag({ k, value: breaks[k] });
                }}
                onPointerMove={(e) => {
                    const x = localX(e);
                    if (!drag) {
                        (e.target as HTMLElement).style.cursor = hit(x) >= 0 ? 'ew-resize' : 'default';
                        return;
                    }
                    // stay between the neighbouring breaks
                    const lo = drag.k === 0 ? ranges[0].min! : breaks[drag.k - 1];
                    const hi = drag.k === breaks.length - 1 ? ranges[ranges.length - 1].max! : breaks[drag.k + 1];
                    setDrag({ k: drag.k, value: Math.min(hi, Math.max(lo, fromX(x))) });
                }}
                onPointerUp={() => {
                    if (!drag) return;
                    const v = Number(drag.value.toPrecision(4));
                    setDrag(null);
                    useAttributeStore.getState().setBreak(tab, ranges[drag.k + 1].id, 'min', v);
                }}
                onPointerCancel={() => setDrag(null)}
            />
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 0.25 }}>
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                    {formatBreak(ranges[0].min!)}
                </Typography>
                {drag && (
                    <Typography variant="caption" color="primary" sx={{ fontSize: '0.68rem', fontWeight: 600 }}>
                        {formatBreak(drag.value)}
                    </Typography>
                )}
                <Tooltip title={hist.useLog ? 'Linear value axis' : 'Log value axis'}>
                    <IconButton size="small" onClick={() => setLog(!log)} sx={{ p: 0, fontSize: '0.62rem', borderRadius: 0.5, px: 0.5 }} color={hist.useLog ? 'primary' : 'default'}>
                        log
                    </IconButton>
                </Tooltip>
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                    {formatBreak(ranges[ranges.length - 1].max!)}
                </Typography>
            </Box>
        </Box>
    );
};
