/**
 * Native WebGL 3D viewer (Phase 18) — replaces the Plotly scatter3d map.
 *
 * - Draws every row as one THREE.Points draw call (millions of points),
 *   styled by the Attribute Manager (colour, shape, size, visibility).
 * - Coordinates re-origined to the data centre (float32-safe at UTM scale).
 * - Clip box and section slab (any azimuth/dip, step with [ / ]) applied on
 *   the GPU; "isolate selection", zoom/fit to selection, box-from-selection
 *   for looking at small parts of the dataset.
 * - Lasso / box selection in screen space and click-to-pick, writing the
 *   global selection, so it is linked with every other plot.
 * - Drillhole traces when HoleID + From roles exist; vertical exaggeration;
 *   perspective/orthographic; preset views; camera saved with the plot.
 * - Wireframes (Leapfrog .msh, DXF, OBJ, STL, GOCAD .ts) drawn in the same
 *   coordinates, clipped and exaggerated with the points (WireframePanel).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Box, Button, ButtonGroup, FormControlLabel, Paper,
    Slider, Stack, Switch, ToggleButton, ToggleButtonGroup, Tooltip, Typography, useTheme,
} from '@mui/material';
import {
    ThreeSixty, Gesture, CropFree, CenterFocusStrong, FilterCenterFocus, PhotoCamera, Clear,
} from '@mui/icons-material';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../../store/appStore';
import { usePlotSetting } from '../../../hooks/usePlotSetting';
import { PlotControlBar, ControlSection, SettingChip } from '../../../components/plot_controls/PlotControlBar';
import { getColumnDisplayName } from '../../../utils/attributeUtils';
import { useViewerGeometry, useViewerStyles, useViewerFlags, useDrillholeSegments } from './useViewerData';
import { ThreeViewport, CameraState, ViewPreset } from './ThreeViewport';
import { guessAxisColumn } from './coordinateColumns';
import { ClipState, isInsideClip, selectInPolygon, sectionNormal, PointCloudGeometry } from './geometry';
import { ColumnPicker } from '../../../components/ColumnPicker';
import { useFillHeight } from '../../../hooks/useFillHeight';
import { registerFigureCapture } from '../../../utils/reportCapture';
import { useWireframeStore, NO_WIREFRAMES } from './wireframeStore';
import { WireframeButton } from './WireframePanel';

type Mode = 'orbit' | 'lasso' | 'box';
type Preset = ViewPreset;

type SavedCamera = CameraState;

interface ClipSettings {
    boxEnabled: boolean;
    box: { x: [number, number]; y: [number, number]; z: [number, number] } | null; // world coords
    slabEnabled: boolean;
    azimuth: number;
    dip: number;
    offset: number;      // signed distance of the plane from the data centre (m)
    thickness: number;   // full slab width (m)
}

const DEFAULT_CLIP: ClipSettings = {
    boxEnabled: false, box: null, slabEnabled: false, azimuth: 0, dip: 90, offset: 0, thickness: 50,
};


export const Viewer3D: React.FC<{ plotId: string }> = ({ plotId }) => {
    // Fill the dock pane below the controls; the canvas follows (ThreeViewport observes its size)
    const { ref: fillRef, height: fillHeight } = useFillHeight<HTMLDivElement>(640, 320, 16);
    const theme = useTheme();
    const { columns, setSelection, selectedIndices, rowCount } = useAppStore(useShallow(s => ({
        columns: s.columns, setSelection: s.setSelection, selectedIndices: s.selectedIndices,
        rowCount: s.columnarData.rowCount,
    })));

    const d = (name: string) => getColumnDisplayName(columns, name);
    const [xAxis, setXAxis] = usePlotSetting(plotId, 'xAxis', guessAxisColumn(columns, 'x'));
    const [yAxis, setYAxis] = usePlotSetting(plotId, 'yAxis', guessAxisColumn(columns, 'y'));
    const [zAxis, setZAxis] = usePlotSetting(plotId, 'zAxis', guessAxisColumn(columns, 'z'));
    // The previous (Plotly) 3D map saved axis ranges/slices; start the clip box from them
    const [legacyRanges] = usePlotSetting<{ x: [number, number]; y: [number, number]; z: [number, number] } | null>(plotId, 'axisRanges', null);
    const [pointScale, setPointScale] = usePlotSetting(plotId, 'pointScale', 1);
    const [vex, setVex] = usePlotSetting(plotId, 'verticalExaggeration', 1);
    const [ortho, setOrtho] = usePlotSetting(plotId, 'orthographic', false);
    const [showTraces, setShowTraces] = usePlotSetting(plotId, 'showTraces', true);
    const [isolate, setIsolate] = usePlotSetting(plotId, 'isolateSelection', false);
    const [clipSettings, setClipSettings] = usePlotSetting<ClipSettings>(
        plotId, 'clip3d', legacyRanges ? { ...DEFAULT_CLIP, boxEnabled: true, box: legacyRanges } : DEFAULT_CLIP,
    );
    const [savedCamera, setSavedCamera] = usePlotSetting<SavedCamera | null>(plotId, 'camera3d', null);
    const [mode, setMode] = useState<Mode>('orbit');
    const [picked, setPicked] = useState<{ index: number; x: number; y: number } | null>(null);

    // --- data -------------------------------------------------------------
    const geometry = useViewerGeometry(xAxis, yAxis, zAxis);
    const styles = useViewerStyles(rowCount);
    const { flags, hasSelection } = useViewerFlags(styles.visible);
    const segments = useDrillholeSegments(geometry);
    const wireframes = useWireframeStore(s => s.byPlot[plotId] ?? NO_WIREFRAMES);

    // --- clip state in local coordinates ------------------------------------
    const clip: ClipState = useMemo(() => {
        const o = geometry?.origin ?? [0, 0, 0];
        const c = { ...DEFAULT_CLIP, ...clipSettings };
        const box = c.box;
        const normal = sectionNormal(c.azimuth, c.dip);
        const center: [number, number, number] = geometry
            ? [
                (geometry.bounds.min[0] + geometry.bounds.max[0]) / 2 + normal[0] * c.offset,
                (geometry.bounds.min[1] + geometry.bounds.max[1]) / 2 + normal[1] * c.offset,
                (geometry.bounds.min[2] + geometry.bounds.max[2]) / 2 + normal[2] * c.offset,
            ]
            : [0, 0, 0];
        return {
            boxEnabled: c.boxEnabled && !!box,
            boxMin: box ? [box.x[0] - o[0], box.y[0] - o[1], box.z[0] - o[2]] : [0, 0, 0],
            boxMax: box ? [box.x[1] - o[0], box.y[1] - o[1], box.z[1] - o[2]] : [0, 0, 0],
            slabEnabled: c.slabEnabled,
            slabNormal: normal,
            slabCenter: center,
            slabHalfWidth: Math.max(c.thickness, 0.001) / 2,
        };
    }, [clipSettings, geometry]);

    const updateClip = useCallback((patch: Partial<ClipSettings>) => {
        setClipSettings(prev => ({ ...DEFAULT_CLIP, ...prev, ...patch }));
    }, [setClipSettings]);

    // --- three.js viewport (imperative; see ThreeViewport) -------------------
    const viewportEl = useRef<HTMLDivElement>(null);
    const viewportRef = useRef<ThreeViewport | null>(null);
    const [viewportReady, setViewportReady] = useState(false);
    // The browser can take the WebGL context away (too many open); Reload builds a new viewport
    const [contextLost, setContextLost] = useState(false);
    const [viewportKey, setViewportKey] = useState(0);
    const hasGeometry = !!geometry;
    useEffect(() => {
        if (!hasGeometry || !viewportEl.current) return;
        const vp = new ThreeViewport(viewportEl.current);
        vp.onContextChange = setContextLost;
        viewportRef.current = vp;
        setContextLost(false);
        setViewportReady(true);
        return () => {
            vp.dispose();
            viewportRef.current = null;
            restoredFor.current = null;
            setViewportReady(false);
        };
    }, [hasGeometry, viewportKey]);

    // Context not given back: build a new viewport (a few times a minute at most; then the Reload button)
    const autoReloads = useRef<number[]>([]);
    useEffect(() => {
        if (!contextLost) return;
        const t = window.setTimeout(() => {
            const now = Date.now();
            autoReloads.current = autoReloads.current.filter(at => now - at < 60_000);
            if (autoReloads.current.length >= 3) return;
            autoReloads.current.push(now);
            setViewportKey(k => k + 1);
        }, 1000);
        return () => window.clearTimeout(t);
    }, [contextLost]);

    const selectedSet = useMemo(() => new Set(selectedIndices), [selectedIndices]);

    /** Points the user can currently see (valid, filter-visible, inside clips, isolation). */
    const isEligible = useCallback((i: number) => {
        if (!geometry || !geometry.valid[i] || !styles.visible[i]) return false;
        if (isolate && hasSelection && !selectedSet.has(i)) return false;
        const p = geometry.positions;
        return isInsideClip(p[i * 3], p[i * 3 + 1], p[i * 3 + 2], clip);
    }, [geometry, styles.visible, isolate, hasSelection, selectedSet, clip]);

    const screenPositions = useCallback(
        (): Float32Array | null => viewportRef.current?.screenPositions() ?? null,
        [],
    );

    const fitView = useCallback((preset: Preset, bounds?: { min: number[]; max: number[] }) => {
        viewportRef.current?.fitView(preset, bounds);
    }, []);

    // Push data and settings into the viewport (order matters: geometry first)
    useEffect(() => { if (viewportReady && geometry) viewportRef.current!.setGeometry(geometry); }, [viewportReady, geometry]);
    useEffect(() => { if (viewportReady) viewportRef.current!.setStyles(styles); }, [viewportReady, styles, geometry]);
    useEffect(() => { if (viewportReady) viewportRef.current!.setFlags(flags, hasSelection); }, [viewportReady, flags, hasSelection, geometry]);
    useEffect(() => {
        if (!viewportReady) return;
        viewportRef.current!.setDisplay({ sizeScale: pointScale, vex, isolate, selectionColor: theme.palette.secondary.main });
    }, [viewportReady, pointScale, vex, isolate, theme.palette.secondary.main]);
    useEffect(() => { if (viewportReady) viewportRef.current!.setClip(clip); }, [viewportReady, clip]);
    useEffect(() => {
        if (viewportReady) viewportRef.current!.setTraces(segments && showTraces ? segments : null, styles);
    }, [viewportReady, segments, showTraces, styles, geometry]);
    useEffect(() => {
        if (!viewportReady) return;
        viewportRef.current!.setAxes([d(xAxis), d(yAxis), zAxis ? d(zAxis) : ''], theme.palette.text.secondary);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- d() is a pure lookup on columns
    }, [viewportReady, geometry, vex, xAxis, yAxis, zAxis, columns, theme.palette.text.secondary]);
    useEffect(() => { if (viewportReady) viewportRef.current!.setBackground(theme.palette.background.paper); }, [viewportReady, theme.palette.background.paper]);
    useEffect(() => { if (viewportReady) viewportRef.current!.setInteractive(mode === 'orbit'); }, [viewportReady, mode]);
    useEffect(() => { if (viewportReady) viewportRef.current!.setOrthographic(ortho); }, [viewportReady, ortho]);
    useEffect(() => {
        if (viewportReady && geometry) viewportRef.current!.setWireframes(wireframes, geometry.origin);
    }, [viewportReady, geometry, wireframes]);
    // Frame everything when the first wireframe arrives (later loads keep the user's view)
    const wireCount = useRef(wireframes.length);
    useEffect(() => {
        const first = wireCount.current === 0 && wireframes.length > 0;
        wireCount.current = wireframes.length;
        if (first && viewportReady) viewportRef.current?.fitView('iso');
    }, [wireframes.length, viewportReady]);

    // Restore the saved camera (or fit) once per geometry
    const restoredFor = useRef<PointCloudGeometry | null>(null);
    useEffect(() => {
        const vp = viewportRef.current;
        if (!viewportReady || !vp || !geometry || restoredFor.current === geometry) return;
        restoredFor.current = geometry;
        if (savedCamera) vp.setCameraState(savedCamera);
        else vp.fitView('iso');
    }, [viewportReady, geometry, savedCamera]);

    // Persist the camera when the user finishes moving it
    useEffect(() => {
        const vp = viewportRef.current;
        if (!viewportReady || !vp) return;
        vp.onCameraChangeEnd = () => setSavedCamera(vp.getCameraState());
        return () => { vp.onCameraChangeEnd = null; };
    }, [viewportReady, setSavedCamera]);

    // --- selection helpers ------------------------------------------------------
    const selectionBounds = useCallback(() => {
        if (!geometry || selectedIndices.length === 0) return null;
        const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        for (const i of selectedIndices) {
            if (!geometry.valid[i]) continue;
            for (let k = 0; k < 3; k++) {
                const v = geometry.positions[i * 3 + k];
                if (v < min[k]) min[k] = v;
                if (v > max[k]) max[k] = v;
            }
        }
        return Number.isFinite(min[0]) ? { min, max } : null;
    }, [geometry, selectedIndices]);

    const zoomToSelection = () => {
        const b = selectionBounds();
        if (b) fitView('iso', b);
    };

    /** Frame world-coordinate bounds (e.g. one wireframe). */
    const zoomToWorld = (b: { min: number[]; max: number[] }) => {
        if (!geometry) return;
        const o = geometry.origin;
        fitView('iso', { min: b.min.map((v, k) => v - o[k]), max: b.max.map((v, k) => v - o[k]) });
    };

    const boxFromSelection = () => {
        const b = selectionBounds();
        if (!b || !geometry) return;
        const o = geometry.origin;
        const pad = 0.02 * Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], 1);
        updateClip({
            boxEnabled: true,
            box: {
                x: [b.min[0] + o[0] - pad, b.max[0] + o[0] + pad],
                y: [b.min[1] + o[1] - pad, b.max[1] + o[1] + pad],
                z: [b.min[2] + o[2] - pad, b.max[2] + o[2] + pad],
            },
        });
    };

    // --- lasso / box overlay -------------------------------------------------------
    const [drawPts, setDrawPts] = useState<number[]>([]);
    const dragStart = useRef<{ x: number; y: number; shift: boolean; ctrl: boolean } | null>(null);

    const applySelection = (indices: number[], shift: boolean, ctrl: boolean) => {
        let next: number[];
        if (shift) next = Array.from(new Set([...selectedIndices, ...indices]));
        else if (ctrl) {
            const remove = new Set(indices);
            next = selectedIndices.filter(i => !remove.has(i));
        } else next = indices;
        next.sort((a, b) => a - b);
        setSelection(next);
    };

    const onOverlayDown = (e: React.PointerEvent) => {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const x = e.clientX - rect.left, y = e.clientY - rect.top;
        dragStart.current = { x, y, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey };
        setDrawPts([x, y]);
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    };
    const onOverlayMove = (e: React.PointerEvent) => {
        if (!dragStart.current) return;
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const x = e.clientX - rect.left, y = e.clientY - rect.top;
        if (mode === 'box') {
            const s = dragStart.current;
            setDrawPts([s.x, s.y, x, s.y, x, y, s.x, y]);
        } else {
            setDrawPts(prev => [...prev, x, y]);
        }
    };
    const onOverlayUp = () => {
        const start = dragStart.current;
        dragStart.current = null;
        const poly = drawPts;
        setDrawPts([]);
        if (!start || poly.length < 6) return;
        const screen = screenPositions();
        if (!screen) return;
        applySelection(selectInPolygon(screen, poly, isEligible), start.shift, start.ctrl);
    };

    // --- click to pick (orbit mode) ----------------------------------------------
    const clickStart = useRef<{ x: number; y: number } | null>(null);
    const onCanvasDown = (e: React.PointerEvent) => { clickStart.current = { x: e.clientX, y: e.clientY }; };
    const onCanvasUp = (e: React.PointerEvent) => {
        const s = clickStart.current;
        clickStart.current = null;
        if (!s || Math.hypot(e.clientX - s.x, e.clientY - s.y) > 4 || !geometry) return;
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const px = e.clientX - rect.left, py = e.clientY - rect.top;
        const screen = screenPositions();
        if (!screen) return;
        let best = -1, bestD = 10 * 10;
        for (let i = 0; i < geometry.valid.length; i++) {
            const dx = screen[i * 2] - px, dy = screen[i * 2 + 1] - py;
            const d = dx * dx + dy * dy;
            if (d < bestD && isEligible(i)) { bestD = d; best = i; }
        }
        if (best < 0) { setPicked(null); return; }
        setPicked({ index: best, x: px, y: py });
        if (e.shiftKey) applySelection([best], true, false);
        else if (e.ctrlKey || e.metaKey) applySelection([best], false, true);
    };

    // --- keyboard: step the section with [ and ] ---------------------------------------
    const containerRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const onKey = (e: KeyboardEvent) => {
            if (!clipSettings?.slabEnabled) return;
            if (e.key === '[' || e.key === ']') {
                const step = (clipSettings.thickness ?? DEFAULT_CLIP.thickness) * (e.key === ']' ? 1 : -1);
                updateClip({ offset: (clipSettings.offset ?? 0) + step });
                e.preventDefault();
            }
        };
        el.addEventListener('keydown', onKey);
        return () => el.removeEventListener('keydown', onKey);
    }, [clipSettings, updateClip]);

    // Report figures (Add to report) come from the WebGL canvas
    useEffect(() => registerFigureCapture(plotId, () => viewportRef.current?.screenshot() ?? null), [plotId]);

    // --- screenshot ------------------------------------------------------------------
    const screenshot = () => {
        const vp = viewportRef.current;
        if (!vp) return;
        const a = document.createElement('a');
        a.href = vp.screenshot();
        a.download = '3d_view.png';
        a.click();
    };

    // --- UI ----------------------------------------------------------------------------
    const worldBounds = geometry ? {
        min: geometry.bounds.min.map((v, k) => v + geometry.origin[k]),
        max: geometry.bounds.max.map((v, k) => v + geometry.origin[k]),
    } : null;
    const c = { ...DEFAULT_CLIP, ...clipSettings };
    const radius = geometry
        ? 0.5 * Math.hypot(...geometry.bounds.max.map((v, k) => v - geometry.bounds.min[k]))
        : 100;
    const pickedId = picked !== null ? (() => {
        const idCol = columns.find(col => col.role === 'ID')?.name ?? columns.find(col => col.role === 'HoleID')?.name;
        const col = idCol ? useAppStore.getState().getRawColumn(idCol) : undefined;
        return col ? String(col[picked.index] ?? '') : `Row ${picked.index + 1}`;
    })() : '';

    const axisSelect = (label: string, value: string, set: (v: string) => void, allowNone = false) => (
        <ColumnPicker label={label} value={value} onChange={set} allowNone={allowNone} noneLabel="None (flat)" minWidth={140} />
    );

    return (
        <Box sx={{ p: 1 }}>
            <PlotControlBar
                primary={<>
                    {axisSelect('X (East)', xAxis, setXAxis)}
                    {axisSelect('Y (North)', yAxis, setYAxis)}
                    {axisSelect('Z (Elevation)', zAxis, setZAxis, true)}
                    <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_, v) => v && setMode(v)}>
                        <ToggleButton value="orbit"><Tooltip title="Rotate / pan / zoom (click a point to inspect; Shift-click adds, Ctrl-click removes)"><ThreeSixty fontSize="small" /></Tooltip></ToggleButton>
                        <ToggleButton value="lasso"><Tooltip title="Lasso select (Shift adds, Ctrl removes)"><Gesture fontSize="small" /></Tooltip></ToggleButton>
                        <ToggleButton value="box"><Tooltip title="Box select (Shift adds, Ctrl removes)"><CropFree fontSize="small" /></Tooltip></ToggleButton>
                    </ToggleButtonGroup>
                    <ButtonGroup size="small" variant="outlined">
                        {/* menu names: X-Y plan, Y-Z section looking east (S-N), X-Z section looking north (W-E) */}
                        {([['plan', 'X-Y', 'Plan view (X-Y)'], ['east', 'Y-Z', 'S-N section (Y-Z)'], ['north', 'X-Z', 'W-E section (X-Z)'], ['iso', '3D', 'Oblique view']] as [Preset, string, string][]).map(([p, label, tip]) => (
                            <Tooltip key={p} title={tip}><Button onClick={() => fitView(p)}>{label}</Button></Tooltip>
                        ))}
                    </ButtonGroup>
                    <Tooltip title="Zoom to selection"><span><Button size="small" disabled={!hasSelection} onClick={zoomToSelection}><CenterFocusStrong fontSize="small" /></Button></span></Tooltip>
                    <Tooltip title="Show only the selection"><span><Button size="small" variant={isolate ? 'contained' : 'text'} disabled={!hasSelection} onClick={() => setIsolate(!isolate)}><FilterCenterFocus fontSize="small" /></Button></span></Tooltip>
                    <Tooltip title="Clear selection"><span><Button size="small" disabled={!hasSelection} onClick={() => setSelection([])}><Clear fontSize="small" /></Button></span></Tooltip>
                    <Tooltip title="Save PNG"><Button size="small" onClick={screenshot}><PhotoCamera fontSize="small" /></Button></Tooltip>
                    <WireframeButton plotId={plotId} dataBounds={worldBounds} onZoomTo={zoomToWorld} />
                </>}
                settingsActive={c.boxEnabled || c.slabEnabled || vex !== 1 || ortho}
                summary={<>
                    {c.slabEnabled && <SettingChip label={`Section ${c.azimuth}°/${c.dip}° ±${c.thickness / 2} m`} onDelete={() => updateClip({ slabEnabled: false })} />}
                    {c.boxEnabled && <SettingChip label="Clip box" onDelete={() => updateClip({ boxEnabled: false })} />}
                    {vex !== 1 && <SettingChip label={`VE ×${vex}`} onDelete={() => setVex(1)} />}
                    {isolate && hasSelection && <SettingChip label="Selection only" onDelete={() => setIsolate(false)} />}
                </>}
                settings={<>
                    <ControlSection label="Display">
                        <Typography variant="caption">Point size</Typography>
                        <Slider size="small" min={0.25} max={4} step={0.25} value={pointScale} onChange={(_, v) => setPointScale(v as number)} valueLabelDisplay="auto" />
                        <Typography variant="caption">Vertical exaggeration</Typography>
                        <Slider size="small" min={1} max={10} step={0.5} value={vex} onChange={(_, v) => setVex(v as number)} valueLabelDisplay="auto" />
                        <FormControlLabel control={<Switch size="small" checked={ortho} onChange={e => setOrtho(e.target.checked)} />} label="Orthographic camera" />
                        {segments && <FormControlLabel control={<Switch size="small" checked={showTraces} onChange={e => setShowTraces(e.target.checked)} />} label="Drillhole traces" />}
                    </ControlSection>
                    <ControlSection label="Section slab">
                        <FormControlLabel control={<Switch size="small" checked={c.slabEnabled} onChange={e => updateClip({ slabEnabled: e.target.checked })} />} label="Show a slab only ( [ / ] to step )" />
                        <Typography variant="caption">Strike (azimuth) {c.azimuth}°</Typography>
                        <Slider size="small" min={0} max={180} step={1} value={c.azimuth} onChange={(_, v) => updateClip({ azimuth: v as number })} disabled={!c.slabEnabled} />
                        <Typography variant="caption">Dip {c.dip}° (90 = vertical section, 0 = level plan)</Typography>
                        <Slider size="small" min={0} max={90} step={1} value={c.dip} onChange={(_, v) => updateClip({ dip: v as number })} disabled={!c.slabEnabled} />
                        <Typography variant="caption">Position {Math.round(c.offset)} m</Typography>
                        <Slider size="small" min={-radius} max={radius} step={Math.max(radius / 200, 0.1)} value={c.offset} onChange={(_, v) => updateClip({ offset: v as number })} disabled={!c.slabEnabled} />
                        <Typography variant="caption">Thickness {Math.round(c.thickness)} m</Typography>
                        <Slider size="small" min={1} max={Math.max(radius, 10)} step={1} value={c.thickness} onChange={(_, v) => updateClip({ thickness: v as number })} disabled={!c.slabEnabled} />
                        <Button size="small" disabled={!c.slabEnabled} onClick={() => { setOrtho(true); requestAnimationFrame(() => fitView('section')); }}>Look along section</Button>
                    </ControlSection>
                    <ControlSection label="Clip box">
                        <FormControlLabel control={<Switch size="small" checked={c.boxEnabled && !!c.box} onChange={e => updateClip({ boxEnabled: e.target.checked, box: c.box ?? (worldBounds ? { x: [worldBounds.min[0], worldBounds.max[0]], y: [worldBounds.min[1], worldBounds.max[1]], z: [worldBounds.min[2], worldBounds.max[2]] } : null) })} />} label="Clip to box" />
                        {worldBounds && c.box && (['x', 'y', 'z'] as const).map((axis, k) => (
                            <Box key={axis}>
                                <Typography variant="caption">{axis.toUpperCase()} {Math.round(c.box![axis][0])} – {Math.round(c.box![axis][1])}</Typography>
                                <Slider size="small" min={worldBounds.min[k]} max={worldBounds.max[k]} step={Math.max((worldBounds.max[k] - worldBounds.min[k]) / 500, 0.01)}
                                    value={c.box![axis]} disabled={!c.boxEnabled}
                                    onChange={(_, v) => updateClip({ box: { ...c.box!, [axis]: v as [number, number] } })} />
                            </Box>
                        ))}
                        <Button size="small" disabled={!hasSelection} onClick={boxFromSelection}>Box around selection</Button>
                    </ControlSection>
                </>}
            />

            {!geometry ? (
                <Typography color="text.secondary">Select numeric X and Y columns (and optionally Z) to view in 3D. Loaded wireframes are drawn with the data.</Typography>
            ) : (
                <Box ref={fillRef}>
                <Paper ref={containerRef} tabIndex={0} sx={{ position: 'relative', height: fillHeight, overflow: 'hidden', outline: 'none' }}>
                    <Box ref={viewportEl} sx={{ position: 'absolute', inset: 0 }} onPointerDown={onCanvasDown} onPointerUp={onCanvasUp} />

                    {mode !== 'orbit' && (
                        <Box
                            sx={{ position: 'absolute', inset: 0, cursor: 'crosshair', touchAction: 'none' }}
                            onPointerDown={onOverlayDown} onPointerMove={onOverlayMove} onPointerUp={onOverlayUp}
                        >
                            <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                                {drawPts.length >= 4 && (
                                    <polygon
                                        points={drawPts.reduce<string[]>((acc, v, i) => (i % 2 ? (acc[acc.length - 1] += `,${v}`, acc) : [...acc, String(v)]), []).join(' ')}
                                        fill={theme.palette.primary.main} fillOpacity={0.12} stroke={theme.palette.primary.main} strokeWidth={1.5} strokeDasharray="4 3"
                                    />
                                )}
                            </svg>
                        </Box>
                    )}

                    <Stack direction="row" spacing={2} sx={{ position: 'absolute', left: 12, bottom: 8, pointerEvents: 'none' }}>
                        <Typography variant="caption" color="text.secondary">
                            {geometry.validCount.toLocaleString()} points{hasSelection ? ` · ${selectedIndices.length.toLocaleString()} selected` : ''}
                            {zAxis ? '' : ' · flat (no Z)'}
                        </Typography>
                    </Stack>

                    {contextLost && (
                        <Stack spacing={1} alignItems="center" justifyContent="center" sx={{ position: 'absolute', inset: 0, bgcolor: 'background.paper' }}>
                            <Typography variant="body2" color="text.secondary">The browser paused the 3D view (too many WebGL plots open).</Typography>
                            <Button size="small" variant="contained" onClick={() => setViewportKey(k => k + 1)}>Reload 3D view</Button>
                        </Stack>
                    )}

                    {picked && (
                        <Paper elevation={3} sx={{ position: 'absolute', left: Math.min(picked.x + 12, 9999), top: picked.y + 12, p: 1, pointerEvents: 'none', maxWidth: 260 }}>
                            <Typography variant="caption" sx={{ fontWeight: 600, display: 'block' }}>{pickedId}</Typography>
                            <Typography variant="caption" sx={{ display: 'block' }}>
                                {d(xAxis)}: {(geometry.positions[picked.index * 3] + geometry.origin[0]).toFixed(1)}<br />
                                {d(yAxis)}: {(geometry.positions[picked.index * 3 + 1] + geometry.origin[1]).toFixed(1)}
                                {zAxis && <><br />{d(zAxis)}: {(geometry.positions[picked.index * 3 + 2] + geometry.origin[2]).toFixed(1)}</>}
                            </Typography>
                        </Paper>
                    )}
                </Paper>
                </Box>
            )}
        </Box>
    );
};

export default Viewer3D;
