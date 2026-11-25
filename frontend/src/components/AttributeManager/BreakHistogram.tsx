/**
 * Distribution of a numeric field with the class breaks drawn on it; drag a
 * break to move it (the classes either side follow, one undo step per drag).
 * The value axis is linear or log: log opens by default for assay-like data
 * (positive, two decades or more), where a linear axis piles every break
 * against the left edge; the choice is remembered per field.
 * Canvas, no Plotly: it redraws instantly and holds no WebGL context.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, ToggleButton, ToggleButtonGroup, Tooltip, Typography, useTheme } from '@mui/material';
import { AttributeConfig, AttributeType, formatBreak, useAttributeStore } from '../../store/attributeStore';
import { useUIStore } from '../../store/uiStore';
import type { ColumnData } from '../../types/columnarData';
import { AxisScale, axisFraction, axisTicks, axisValue, buildBreakAxis } from '../../utils/breakAxis';

const PLOT_H = 64;
const AXIS_H = 14;
const HEIGHT = PLOT_H + AXIS_H;
const BINS = 60;
const GRAB_PX = 6;
const TICK_PX = 46;

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
    const [drag, setDrag] = useState<{ k: number; value: number } | null>(null);
    const [hover, setHover] = useState(-1);
    const chosen = useUIStore(s => (config.field ? s.breakScale[config.field] : undefined));
    // No choice yet: log-spaced classes show on a log axis, otherwise the data decide
    const scale: AxisScale | null = chosen ?? (config.method === 'logEqual' ? 'log' : null);

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

    const axis = useMemo(() => buildBreakAxis(column, scale, BINS), [column, scale]);

    const toX = (v: number) => (axis ? axisFraction(axis, v) * width : 0);
    const fromX = (px: number) => (axis ? axisValue(axis, px / width) : 0);

    // interior breaks: between class k and k+1
    const breaks = ranges.slice(1).map((r, k) => (drag && drag.k === k ? drag.value : r.min!));

    useEffect(() => {
        const c = canvasRef.current;
        if (!c || !axis) return;
        const dpr = window.devicePixelRatio || 1;
        c.width = width * dpr;
        c.height = HEIGHT * dpr;
        const g = c.getContext('2d');
        if (!g) return;
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, width, HEIGHT);
        const barH = PLOT_H - 8;
        // value ticks: faint grid lines with labels underneath
        g.font = `10px ${theme.typography.fontFamily}`;
        g.textBaseline = 'alphabetic';
        g.textAlign = 'center';
        for (const t of axisTicks(axis, width / TICK_PX)) {
            const x = Math.round(toX(t)) + 0.5;
            g.strokeStyle = theme.palette.divider;
            g.lineWidth = 1;
            g.beginPath();
            g.moveTo(x, 0);
            g.lineTo(x, PLOT_H + 3);
            g.stroke();
            const label = formatBreak(t);
            const half = g.measureText(label).width / 2;
            g.fillStyle = theme.palette.text.secondary;
            g.fillText(label, Math.min(width - half, Math.max(half, x)), HEIGHT - 2);
        }
        // class bands along the bottom, in each class's colour
        ranges.forEach((r, k) => {
            const x0 = toX(k === 0 ? r.min! : breaks[k - 1]);
            const x1 = toX(k === ranges.length - 1 ? r.max! : breaks[k]);
            g.fillStyle = tab === 'color' && r.color ? r.color : k % 2 ? theme.palette.action.disabled : theme.palette.action.selected;
            g.globalAlpha = r.visible ? 0.9 : 0.25;
            g.fillRect(x0, PLOT_H - 6, Math.max(1, x1 - x0), 6);
        });
        g.globalAlpha = 1;
        // bars (sqrt scale so the tail stays visible)
        const bw = width / BINS;
        g.fillStyle = theme.palette.text.secondary;
        for (let i = 0; i < BINS; i++) {
            const h = axis.max ? Math.sqrt(axis.counts[i] / axis.max) * (barH - 2) : 0;
            if (h > 0) g.fillRect(i * bw + 0.5, barH - h, Math.max(1, bw - 1), h);
        }
        // break lines, each with a grip at the top
        g.strokeStyle = theme.palette.primary.main;
        g.fillStyle = theme.palette.primary.main;
        breaks.forEach((v, k) => {
            const x = Math.round(toX(v)) + 0.5;
            const active = drag ? drag.k === k : hover === k;
            g.globalAlpha = drag && drag.k !== k ? 0.5 : 1;
            g.lineWidth = active ? 2.5 : 1.5;
            g.beginPath();
            g.moveTo(x, 0);
            g.lineTo(x, PLOT_H);
            g.stroke();
            g.fillRect(x - 3, 0, 6, active ? 9 : 6);
        });
        g.globalAlpha = 1;
    });

    if (!axis || ranges.length === 0) return null;

    const hit = (px: number) => {
        let best = -1, dist = GRAB_PX + 1;
        breaks.forEach((v, k) => {
            const d = Math.abs(toX(v) - px);
            if (d < dist) { dist = d; best = k; }
        });
        return best;
    };
    const localX = (e: React.PointerEvent) => e.clientX - (e.currentTarget as HTMLElement).getBoundingClientRect().left;

    const shown = drag ? drag.value : hover >= 0 && hover < breaks.length ? breaks[hover] : null;
    const offAxis = axis.useLog && axis.nonPositive > 0
        ? ` · ${axis.nonPositive} at or below 0 sit at the left edge`
        : '';

    return (
        <Box ref={boxRef} sx={{ position: 'relative', mt: 0.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.25, minHeight: 20 }}>
                <Typography
                    variant="caption" noWrap
                    color={shown !== null ? 'primary' : 'text.secondary'}
                    sx={{ flex: 1, minWidth: 0, fontSize: '0.68rem', fontWeight: shown !== null ? 600 : 400 }}
                    title={shown === null ? `Drag a break line to move it${offAxis}` : undefined}
                >
                    {shown !== null
                        ? `Break at ${formatBreak(shown)}`
                        : `${formatBreak(ranges[0].min!)} – ${formatBreak(ranges[ranges.length - 1].max!)} · drag a break to move it${offAxis}`}
                </Typography>
                <Tooltip
                    enterDelay={400}
                    title={axis.canLog
                        ? 'Value axis. Log spreads out the low values, so breaks that sit together on a linear axis can be dragged apart'
                        : 'Value axis (no positive range to put on a log axis)'}
                >
                    <ToggleButtonGroup
                        exclusive size="small"
                        value={axis.useLog ? 'log' : 'linear'}
                        onChange={(_, v: AxisScale | null) => { if (v && config.field) useUIStore.getState().setBreakScale(config.field, v); }}
                        aria-label="Value axis"
                        sx={{ '& .MuiToggleButton-root': { py: 0, px: 0.75, height: 20, fontSize: '0.65rem', textTransform: 'none' } }}
                    >
                        <ToggleButton value="linear">Linear</ToggleButton>
                        <ToggleButton value="log" disabled={!axis.canLog}>Log</ToggleButton>
                    </ToggleButtonGroup>
                </Tooltip>
            </Box>
            <canvas
                ref={canvasRef}
                aria-label={`Class breaks on the value distribution, ${axis.useLog ? 'log' : 'linear'} axis (drag a break to move it)`}
                style={{ width: '100%', height: HEIGHT, display: 'block', touchAction: 'none' }}
                onPointerDown={(e) => {
                    const k = hit(localX(e));
                    if (k < 0) return;
                    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                    setDrag({ k, value: breaks[k] });
                }}
                onPointerMove={(e) => {
                    const x = localX(e);
                    if (!drag) {
                        const k = hit(x);
                        (e.target as HTMLElement).style.cursor = k >= 0 ? 'ew-resize' : 'default';
                        if (k !== hover) setHover(k);
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
                onPointerLeave={() => { if (!drag && hover !== -1) setHover(-1); }}
            />
        </Box>
    );
};
