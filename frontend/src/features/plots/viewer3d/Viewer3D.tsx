/**
 * Native WebGL 3D viewer (Phase 18) — replaces the Plotly scatter3d map.
 *
 * - Draws every row as one THREE.Points draw call (millions of points),
 *   styled by the Attribute Manager (colour, shape, size, visibility).
 * - Coordinates re-origined to the data centre (float32-safe at UTM scale).
 * - Clip box and up to two crossing slices (SliceBar: presets, a drawn line,
 *   the section through a hole, or square to the view; stepped with the keys
 *   or Ctrl + wheel) applied on the GPU; "isolate selection", zoom/fit to
 *   selection, box-from-selection for looking at small parts of the dataset.
 * - Lasso / box selection in screen space and click-to-pick, writing the
 *   global selection, so it is linked with every other plot.
 * - Drillhole traces when HoleID + From roles exist; vertical exaggeration;
 *   perspective/orthographic; preset views; camera saved with the plot.
 * - Wireframes (Leapfrog .msh, DXF, OBJ, STL, GOCAD .ts) drawn in the same
 *   coordinates, clipped and exaggerated with the points (WireframePanel).
 * - The project's surfaces (store/modelStore: built through samples, saved
 *   with the project) drawn the same way, with their list beside the view
 *   (SurfacePanel).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Badge, Box, Button, ButtonGroup, FormControlLabel, Paper, Popover,
    Slider, Stack, SvgIcon, Switch, ToggleButton, ToggleButtonGroup, Tooltip, Typography, useTheme,
} from '@mui/material';
import {
    ThreeSixty, Gesture, CropFree, CenterFocusStrong, FilterCenterFocus, PhotoCamera, Clear, ArrowDropDown, ContentCut, ManageSearch, Layers, ViewInAr,
} from '@mui/icons-material';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../../store/appStore';
import { usePlotSetting } from '../../../hooks/usePlotSetting';
import { PlotControlBar, ControlSection, SettingChip } from '../../../components/plot_controls/PlotControlBar';
import { getColumnDisplayName } from '../../../utils/attributeUtils';
import { useViewerGeometry, useViewerStyles, useViewerFlags, useDrillholeSegments, useDrillholeIntervals, useDrillholeIndex } from './useViewerData';
import { holePath } from './holes';
import { HolePanel, HOLE_MARK_COLOR } from './HolePanel';
import { ThreeViewport, CameraState, ViewPreset, HoleMarker, MeshLayer } from './ThreeViewport';
import { guessAxisColumn, guessFromColumn, guessToColumn, guessHoleColumn } from './coordinateColumns';
import { ClipState, isInsideClip, loosenClip, selectInPolygon, PointCloudGeometry } from './geometry';
import {
    ClipSettings, DEFAULT_CLIP, Slice, Vec3, SLICE_COLORS, PRESET_NORMALS, readClipSettings, presetSlice, defaultSliceWidth, sliceKind,
    stepSlice, moveSlice, planeFromScreenLine, normalFromView, planeThroughHole, planeBoxPolygon, clipStateOf, sliceFramesOf,
    PresetKind, canonicalNormal, withNormal, sliceFront, sideFacingView, dragDistance, dragWidth,
} from './slices';
import { LiveClip, useClipOutline } from './liveClip';
import { LiveSliceBar, InsideCount, SlicePlacement } from './SliceBar';
import { ColumnPicker } from '../../../components/ColumnPicker';
import { useFillHeight } from '../../../hooks/useFillHeight';
import { registerFigureCapture } from '../../../utils/reportCapture';
import { ProjectionPicker } from '../../../components/ProjectionPicker';
import { ensureProjectionRegistered, lonLatConverter } from '../../../utils/coordinateUtils';
import { GroundTile, planGroundTiles, SATELLITE_ATTRIBUTION } from './satelliteTiles';
import { WireframeSection } from './WireframePanel';
import { ContactDialog } from './ContactDialog';
import { ShellDialog } from './ShellDialog';
import { loggingProblem } from '../../model/logging';
import { loadSceneWireframes, useWireframeFiles } from '../../model/wireframeFiles';
import { SurfacePanel } from './SurfacePanel';
import { useModelStore } from '../../../store/modelStore';
import { sceneTrendField, useModelCache } from '../../model/modelCache';
import { groundSurface, MAX_SURFACE_POINTS, sameCoords, sceneInUse, startSurface, surfaceFromRows } from '../../model/sceneActions';
import { useSurfaceEditing } from './useSurfaceEditing';
import { useStructureTool } from './useStructureTool';
import { unit } from '../../model/plane';
import { structureMark } from '../../model/structure';
import { anglesText, setMark } from '../../model/structureReadings';
import { formLines, trendAt, trendDip } from '../../model/trendField';
import { StructureColumnsDialog } from './StructureColumnsDialog';
import { makePart, type WireframePart } from './wireframeParsers';
import { simplifyLine } from '../../model/lines';
import { dataRay, rayPlane } from './picking';

type Mode = 'orbit' | 'lasso' | 'box';
type Preset = ViewPreset;

type SavedCamera = CameraState;

/** Cylinder width slider: this many powers of ten either side of the starting width. */
const WIDTH_DECADES = 1.3;
const formatWidth = (w: number) => (w >= 10 ? String(Math.round(w)) : String(Number(w.toPrecision(2))));

/** How long a hole stays lit along its length after it is found or zoomed to (ms). */
const HOLE_FLASH_MS = 2500;
/** The mark of the model's structure is this share of the data's extent across */
const STRUCTURE_MARK = 0.18;
/** ... and the mark of one reading this share */
const READING_MARK = 0.03;
/** The marks of a set of readings as drawn, kept while its readings and their size stay the same */
const readingParts = new WeakMap<object, { size: number; part: WireframePart }>();

/** Slice changes reach the saved plot settings this long after the last one (ms). */
const CLIP_SAVE_DELAY = 300;

const CylinderIcon: React.FC = () => (
    <SvgIcon fontSize="small">
        <path d="M12 2C8.13 2 5 3.34 5 5v14c0 1.66 3.13 3 7 3s7-1.34 7-3V5c0-1.66-3.13-3-7-3zm0 2c3.2 0 4.8.78 5 1-.2.22-1.8 1-5 1s-4.8-.78-5-1c.2-.22 1.8-1 5-1zm5 15c-.2.22-1.8 1-5 1s-4.8-.78-5-1V7.2C8.3 7.7 10.05 8 12 8s3.7-.3 5-.8V19z" />
    </SvgIcon>
);


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
    const clipDefault = useMemo(
        () => (legacyRanges ? { ...DEFAULT_CLIP, boxEnabled: true, box: legacyRanges } : DEFAULT_CLIP),
        [legacyRanges],
    );
    const [savedClip, setSavedClip] = usePlotSetting<unknown>(plotId, 'clip3d', clipDefault);
    const [savedCamera, setSavedCamera] = usePlotSetting<SavedCamera | null>(plotId, 'camera3d', null);
    const [mode, setMode] = useState<Mode>('orbit');
    /** A slice waiting for its line to be drawn or its hole to be clicked */
    const [placing, setPlacing] = useState<{ kind: 'line' | 'hole'; index: number } | null>(null);
    const [picked, setPicked] = useState<{ index: number; x: number; y: number } | null>(null);

    // --- data -------------------------------------------------------------
    const geometry = useViewerGeometry(xAxis, yAxis, zAxis);
    const styles = useViewerStyles(rowCount);
    const { flags, hasSelection } = useViewerFlags(styles.visible);
    const segments = useDrillholeSegments(geometry);

    // --- samples as cylinders (From-To intervals) ----------------------------
    const intervals = useDrillholeIntervals(geometry);
    const [cylindersOn, setCylindersOn] = usePlotSetting(plotId, 'cylinders3d', false);
    const [cylinderWidthSaved, setCylinderWidth] = usePlotSetting<number | null>(plotId, 'cylinderWidth', null);
    const [cylinderBySize, setCylinderBySize] = usePlotSetting(plotId, 'cylinderSizeByAttribute', true);
    const cylinders = cylindersOn && intervals ? intervals : null;
    // Starting width: wide enough to see with all the holes in view, never under half an interval
    const defaultCylinderWidth = useMemo(() => {
        if (!geometry || !intervals) return 1;
        const sceneRadius = 0.5 * Math.hypot(...geometry.bounds.max.map((v, k) => v - geometry.bounds.min[k]));
        return Number(Math.max(intervals.medianLength / 2, sceneRadius / 150, 0.01).toPrecision(2));
    }, [geometry, intervals]);
    const cylinderWidth = cylinderWidthSaved ?? defaultCylinderWidth;

    // --- the project's surfaces and wireframes ---------------------------------
    const scene = useModelStore(s => s.scene);
    const wireFiles = useWireframeFiles(s => s.byFile);
    // The wireframes' files are read from the project folder the first time a 3D view shows them
    useEffect(() => { loadSceneWireframes(); }, [scene.wireframes]);
    const wireframes = useMemo((): readonly MeshLayer[] => scene.wireframes.flatMap(w => {
        const part = wireFiles[w.file]?.parts[w.part];
        return part ? [{ id: `wireframe:${w.id}`, part, color: w.color, opacity: w.opacity, visible: w.visible, showEdges: w.showEdges }] : [];
    }), [scene.wireframes, wireFiles]);
    const surfaceFits = useModelCache(s => s.byId);
    const suggestion = useModelStore(s => s.suggestion);
    const [surfacesOpen, setSurfacesOpen] = usePlotSetting(plotId, 'surfacePanel3d', false);
    // Surfaces are in world coordinates: they belong in views of the columns they were built in
    const sceneHere = sameCoords(scene.coords, xAxis, yAxis, zAxis);
    // The data centre (world): the viewer's local origin
    const dataCentre = geometry?.origin;
    /** The clip box and slices as last saved (they settle a moment after a slice stops moving) */
    const savedSettings = useMemo(
        () => readClipSettings(savedClip, dataCentre ?? [0, 0, 0]),
        [savedClip, dataCentre],
    );
    // --- the direction of the ground from place to place, drawn as short lines on the slice -----
    const [trendOnSlice, setTrendOnSlice] = usePlotSetting(plotId, 'trendLines3d', true);
    const sceneStructure = scene.structure;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the field is kept for the structure as it is now
    const trendField = useMemo(() => sceneTrendField(), [sceneStructure]);
    const trendLayers = useMemo((): MeshLayer[] => {
        const slice = savedSettings.slicing ? savedSettings.slices[savedSettings.active] : undefined;
        if (!trendField || !trendOnSlice || !surfacesOpen || !sceneHere || !geometry || !slice || !slice.on) return [];
        const { bounds: b, origin: o } = geometry;
        const lines = formLines(trendField, { normal: slice.normal, point: slice.center }, { min: [b.min[0] + o[0], b.min[1] + o[1], b.min[2] + o[2]], max: [b.max[0] + o[0], b.max[1] + o[1], b.max[2] + o[2]] });
        const layer = (id: string, ends: Float64Array, color: string): MeshLayer[] => (ends.length === 0 ? [] : [{
            id, part: makePart('The direction on the slice', ends, new Uint32Array(0), Uint32Array.from({ length: ends.length / 3 }, (_, i) => i)), color, opacity: 0, visible: true, showEdges: false,
        }]);
        return [...layer('trend:readings', lines.fromReadings, '#1a237e'), ...layer('trend:overall', lines.fromOverall, '#9fa8da')];
    }, [trendField, trendOnSlice, surfacesOpen, sceneHere, geometry, savedSettings]);

    const meshLayers = useMemo((): readonly MeshLayer[] => {
        // Before the first surface the scene has no columns of its own yet: this view's will be its
        if (!sceneHere && scene.coords) return wireframes;
        const built: MeshLayer[] = [...trendLayers];
        for (const s of sceneHere ? scene.surfaces : []) {
            const part = surfaceFits[s.id]?.part;
            if (part && part.triangles.length > 0) built.push({ id: `surface:${s.id}`, part, color: s.color, opacity: s.opacity, visible: s.visible, showEdges: s.showEdges });
        }
        // What was measured of the lie of the ground, place by place
        if (sceneHere && geometry) {
            const { bounds: b } = geometry;
            const size = READING_MARK * Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2], 1);
            for (const set of scene.structure?.sets ?? []) {
                if (!set.visible) continue;
                let kept = readingParts.get(set.readings);
                if (!kept || kept.size !== size) {
                    const mark = setMark(set, size);
                    kept = { size, part: makePart(set.name, mark.vertices, mark.triangles, mark.lines) };
                    readingParts.set(set.readings, kept);
                }
                built.push({ id: `readings:${set.id}`, part: kept.part, color: set.color, opacity: 0.5, visible: true, showEdges: false });
            }
        }
        // Readings on offer, as ghosts: grey until they are kept
        if (sceneHere && geometry && suggestion) {
            const { bounds: b } = geometry;
            const size = READING_MARK * Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2], 1);
            suggestion.sets.forEach((set, i) => {
                let kept = readingParts.get(set.readings);
                if (!kept || kept.size !== size) {
                    const mark = setMark(set, size);
                    kept = { size, part: makePart(set.name, mark.vertices, mark.triangles, mark.lines) };
                    readingParts.set(set.readings, kept);
                }
                built.push({ id: `suggested:${i}`, part: kept.part, color: '#616161', opacity: 0.25, visible: true, showEdges: true });
            });
        }
        // The structure the surfaces follow, drawn in the middle of the data while the surface panel is up
        const overall = scene.structure?.overall ?? null;
        if (overall && surfacesOpen && geometry) {
            const { bounds: b, origin: o } = geometry;
            const centre: [number, number, number] = [(b.min[0] + b.max[0]) / 2 + o[0], (b.min[1] + b.max[1]) / 2 + o[1], (b.min[2] + b.max[2]) / 2 + o[2]];
            const mark = structureMark(overall, centre, STRUCTURE_MARK * Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2], 1));
            built.push({ id: 'structure', part: makePart('Structure', mark.vertices, mark.triangles, mark.lines), color: '#37474f', opacity: 0.35, visible: true, showEdges: true });
        }
        return built.length > 0 ? [...wireframes, ...built] : wireframes;
    }, [wireframes, sceneHere, scene.coords, scene.surfaces, scene.structure, surfaceFits, surfacesOpen, geometry, trendLayers, suggestion]);

    // --- satellite image under the data -------------------------------------
    const [satellite, setSatellite] = usePlotSetting(plotId, 'satellite3d', false);
    const [satelliteOpacity, setSatelliteOpacity] = usePlotSetting(plotId, 'satelliteOpacity', 1);
    const [satelliteAtTop, setSatelliteAtTop] = usePlotSetting(plotId, 'satelliteAtTop', false);
    const datasetEpsg = useAppStore(s => s.datasetEpsg);
    // Latitude/longitude axes need no projection choice: WGS84
    const epsgCode = datasetEpsg || (/lat/i.test(yAxis) && /lon/i.test(xAxis) ? 'EPSG:4326' : '');
    const [ground, setGround] = useState<{ tiles: GroundTile[] | null; error: string | null }>({ tiles: null, error: null });
    useEffect(() => {
        if (!satellite || !epsgCode || !geometry || geometry.validCount === 0) {
            setGround({ tiles: null, error: null });
            return;
        }
        let cancelled = false;
        ensureProjectionRegistered(epsgCode)
            .then(() => {
                if (cancelled) return;
                const { toLonLat, fromLonLat } = lonLatConverter(epsgCode);
                const { bounds: b, origin: o } = geometry;
                const tiles = planGroundTiles(
                    { minX: b.min[0] + o[0], maxX: b.max[0] + o[0], minY: b.min[1] + o[1], maxY: b.max[1] + o[1] },
                    [o[0], o[1]], toLonLat, fromLonLat,
                );
                setGround(tiles.length
                    ? { tiles, error: null }
                    : { tiles: null, error: `The coordinates do not fall on the map in ${epsgCode}. Check the projection.` });
            })
            .catch((err: unknown) => {
                if (!cancelled) setGround({ tiles: null, error: err instanceof Error ? err.message : String(err) });
            });
        return () => { cancelled = true; };
    }, [satellite, epsgCode, geometry]);

    // --- clip box and slices ---------------------------------------------------
    // Dragging or stepping a slice changes it on every frame: the live value sits
    // outside React state (see LiveClip), goes straight to the viewport and the
    // slice bar, and is saved with the plot once it rests.
    const [liveClip] = useState(() => new LiveClip(savedSettings));
    const clipOutline = useClipOutline(liveClip);
    const clipSave = useRef<{ timer: number; value: ClipSettings } | null>(null);
    const lastSavedClip = useRef<unknown>(null);
    const flushClip = useCallback(() => {
        const pending = clipSave.current;
        if (!pending) return;
        window.clearTimeout(pending.timer);
        clipSave.current = null;
        lastSavedClip.current = pending.value;
        setSavedClip(pending.value);
    }, [setSavedClip]);
    const updateClip = useCallback((change: Partial<ClipSettings> | ((prev: ClipSettings) => ClipSettings)) => {
        const prev = liveClip.get();
        const next = typeof change === 'function' ? change(prev) : { ...prev, ...change };
        if (next === prev) return;
        liveClip.set(next);
        if (clipSave.current) window.clearTimeout(clipSave.current.timer);
        clipSave.current = { value: next, timer: window.setTimeout(flushClip, CLIP_SAVE_DELAY) };
    }, [liveClip, flushClip]);
    // Saved settings changed from outside (undo, a project or template loaded): they win
    useEffect(() => {
        if (savedClip === lastSavedClip.current || JSON.stringify(savedClip) === JSON.stringify(lastSavedClip.current)) return;
        if (clipSave.current) { window.clearTimeout(clipSave.current.timer); clipSave.current = null; }
        liveClip.set(savedSettings);
    }, [liveClip, savedClip, savedSettings]);
    useEffect(() => flushClip, [flushClip]); // closing the plot: save what is pending

    const slicing = clipOutline.slicing;
    /** The clip tests as they are right now (local coordinates). */
    const currentClip = useCallback(
        (): ClipState => clipStateOf(liveClip.get(), dataCentre ?? [0, 0, 0]),
        [liveClip, dataCentre],
    );

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
    const eligibility = useCallback(() => {
        const clip = currentClip();
        return (i: number) => {
            if (!geometry || !geometry.valid[i] || !styles.visible[i]) return false;
            if (isolate && hasSelection && !selectedSet.has(i)) return false;
            const p = geometry.positions;
            return isInsideClip(p[i * 3], p[i * 3 + 1], p[i * 3 + 2], clip);
        };
    }, [geometry, styles.visible, isolate, hasSelection, selectedSet, currentClip]);

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
    // Clip box and slices: straight from the live value, on every change
    useEffect(() => {
        if (!viewportReady || !geometry) return;
        const push = () => {
            const vp = viewportRef.current;
            if (!vp) return;
            const now = liveClip.get();
            vp.setClip(clipStateOf(now, geometry.origin));
            vp.setSliceFrames(sliceFramesOf(now, geometry.bounds, geometry.origin));
        };
        push();
        return liveClip.subscribe(push);
    }, [viewportReady, geometry, liveClip]);
    useEffect(() => {
        if (viewportReady) viewportRef.current!.setTraces(segments && showTraces ? segments : null, styles);
    }, [viewportReady, segments, showTraces, styles, geometry]);
    // After setGeometry (which drops the cylinders of the previous rows)
    useEffect(() => { if (viewportReady) viewportRef.current!.setIntervals(cylinders); }, [viewportReady, cylinders, geometry]);
    useEffect(() => {
        if (viewportReady) viewportRef.current!.setCylinderStyle({ width: cylinderWidth, sizeByAttribute: cylinderBySize });
    }, [viewportReady, cylinderWidth, cylinderBySize]);
    useEffect(() => {
        if (!viewportReady) return;
        viewportRef.current!.setAxes([d(xAxis), d(yAxis), zAxis ? d(zAxis) : ''], theme.palette.text.secondary);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- d() is a pure lookup on columns
    }, [viewportReady, geometry, vex, xAxis, yAxis, zAxis, columns, theme.palette.text.secondary]);
    useEffect(() => { if (viewportReady) viewportRef.current!.setGround(ground.tiles); }, [viewportReady, ground.tiles]);
    useEffect(() => {
        if (!viewportReady || !geometry) return;
        viewportRef.current!.setGroundStyle(satelliteAtTop ? geometry.bounds.max[2] : geometry.bounds.min[2], satelliteOpacity);
    }, [viewportReady, geometry, satelliteAtTop, satelliteOpacity]);
    useEffect(() => { if (viewportReady) viewportRef.current!.setBackground(theme.palette.background.paper); }, [viewportReady, theme.palette.background.paper]);
    // Drawing a slice line takes the drag away from the camera, like the lasso
    const drawingLine = placing?.kind === 'line';
    // So does drawing the outline a surface is kept inside
    const [outlineFor, setOutlineFor] = useState<string | null>(null);
    const editingId = useModelStore(s => s.editingId);
    useEffect(() => { setOutlineFor(prev => (prev !== null && prev !== editingId ? null : prev)); }, [editingId]);
    useEffect(() => { if (viewportReady) viewportRef.current!.setInteractive(mode === 'orbit' && !drawingLine && !outlineFor); }, [viewportReady, mode, drawingLine, outlineFor]);
    useEffect(() => { if (viewportReady) viewportRef.current!.setOrthographic(ortho); }, [viewportReady, ortho]);
    useEffect(() => {
        if (viewportReady && geometry) viewportRef.current!.setWireframes(meshLayers, geometry.origin);
    }, [viewportReady, geometry, meshLayers]);
    // Frame everything when the first wireframe is loaded (later loads, and the ones that come with a project, keep the view)
    const wireLoads = useWireframeFiles(s => s.loads);
    const wireSeen = useRef({ loads: wireLoads, count: wireframes.length, frame: false });
    useEffect(() => {
        const seen = wireSeen.current;
        if (wireLoads !== seen.loads) {
            seen.loads = wireLoads;
            if (seen.count === 0) seen.frame = true;
        }
        seen.count = wireframes.length;
        if (seen.frame && wireframes.length > 0 && viewportReady) {
            seen.frame = false;
            viewportRef.current?.fitView('iso');
        }
    }, [wireLoads, wireframes.length, viewportReady]);

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

    // --- slices -----------------------------------------------------------------------
    const holeColumn = useMemo(() => guessHoleColumn(columns), [columns]);

    // --- surfaces -----------------------------------------------------------------------
    const surfaceBlocked = !zAxis ? 'Surfaces need an elevation column (Z).'
        : scene.surfaces.length > 0 && !sceneHere ? 'This view shows other coordinate columns than the ones the surfaces were built in.'
            : sceneInUse(scene) && !sceneHere ? 'This view shows other coordinate columns than the ones the readings are placed in.'
                : null;
    /** The dialog that takes orientation readings for the whole model from columns */
    const [readingsOpen, setReadingsOpen] = useState(false);
    /** The dialog for a surface between logged units: 'new', or the id of the surface whose units are being changed */
    const [contactFor, setContactFor] = useState<string | null>(null);
    /** The shell whose column and cut-off are being chosen: 'new', or a surface's id */
    const [shellFor, setShellFor] = useState<string | null>(null);
    /** The wireframes are listed under the surfaces, in the same panel */
    const showWireframes = () => {
        setSurfacesOpen(true);
        setTimeout(() => containerRef.current?.parentElement?.querySelector('[data-testid="wireframe-section"]')?.scrollIntoView({ block: 'nearest' }), 80);
    };
    /** This view's columns, as the coordinates of the scene */
    const viewCoords = () => ({ x: xAxis, y: yAxis, z: zAxis, hole: holeColumn, from: guessFromColumn(columns), to: guessToColumn(columns) });
    /** An empty surface, built by the next clicks in the view */
    const newSurface = () => {
        if (surfaceBlocked) return;
        setSurfacesOpen(true);
        startSurface(viewCoords());
        containerRef.current?.focus({ preventScroll: true });
    };
    /** The next drag in the view draws the outline the open surface is kept inside (again: never mind) */
    const startOutline = () => {
        const id = useModelStore.getState().editingId;
        if (!id || !sceneHere) return;
        useModelStore.getState().setPicking(false);
        setMode('orbit');
        setPlacing(null);
        setOutlineFor(prev => (prev ? null : id));
    };
    /** A loop drawn on screen as an outline: its corners on a plane square to the view, through the middle of the surface's points */
    const outlineFromScreen = (id: string, loop: number[]) => {
        const vp = viewportRef.current;
        const s = useModelStore.getState().scene.surfaces.find(x => x.id === id);
        if (!vp || !geometry || !s) return;
        const f = vp.viewDirection();
        const normal = unit([f[0], f[1], f[2] / vex]);
        if (!normal) return;
        const o = geometry.origin;
        const through = [...s.points.map(p => p.p), ...s.polylines.flatMap(l => l.points)];
        const anchor: Vec3 = through.length > 0
            ? [0, 1, 2].map(k => through.reduce((sum, p) => sum + p[k], 0) / through.length - o[k]) as Vec3
            : vp.viewFocus();
        const corners: Vec3[] = [];
        for (let i = 0; i + 1 < loop.length; i += 2) {
            const hit = rayPlane(dataRay(vp.screenRay(loop[i], loop[i + 1]), vex), { normal, point: anchor });
            if (hit) corners.push([hit[0] + o[0], hit[1] + o[1], hit[2] + o[2]]);
        }
        const points = simplifyLine(corners, 1.5 / Math.max(vp.pixelsPerMetre(anchor), 1e-9), 60);
        if (points.length < 3) return;
        useModelStore.getState().updateSurface(id, { params: { extent: 'outline', outline: { normal, points } } });
    };
    /** Lines for the open surface are drawn on a slice: bring one up, square-on, if there is none */
    const drawOnSlice = () => {
        const wasSlicing = liveClip.get().slicing;
        if (!wasSlicing) toggleSlicing();
        useModelStore.getState().setDrawing(true);
        if (!wasSlicing) lookAtSlice(liveClip.get().active);
        containerRef.current?.focus({ preventScroll: true });
    };
    const surfaceFromSelection = (): { severity: 'info' | 'warning'; text: string } | null => {
        // Samples in one hole lie on a line: the surface then runs along the view direction
        const f = viewportRef.current?.viewDirection();
        const out = surfaceFromRows(selectedIndices, viewCoords(), { along: f ? unit([f[0], f[1], f[2] / vex]) : null });
        if (!out.ok) {
            return {
                severity: 'warning',
                text: out.reason === 'too-few' ? 'A surface needs samples at two places or more.'
                    : out.reason === 'no-coordinates' ? 'The X, Y and Z columns must be numbers.'
                        : 'The surfaces of this project were built in other coordinate columns.',
            };
        }
        useModelStore.getState().setEditing(out.id);
        return out.points < out.samples
            ? { severity: 'info', text: `${out.samples.toLocaleString()} samples were grouped into ${out.points} points (a surface is fitted through ${MAX_SURFACE_POINTS} at most).` }
            : null;
    };
    const groundFromCollars = (): { severity: 'info' | 'warning'; text: string } | null => {
        const out = groundSurface(viewCoords());
        if (!out.ok) {
            return {
                severity: 'warning',
                text: out.reason === 'too-few' ? 'The ground needs two holes or more.'
                    : out.reason === 'no-holes' ? 'This needs the hole ID, From and coordinate columns.'
                        : 'The surfaces of this project were built in other coordinate columns.',
            };
        }
        useModelStore.getState().setEditing(out.id);
        const notes = [
            out.points < out.holes ? `${out.holes.toLocaleString()} collars were grouped into ${out.points} points (a surface is fitted through ${MAX_SURFACE_POINTS} at most).` : '',
            // A hole whose top was not sampled: its collar is where its line would reach depth 0
            out.left.length > 0 ? `${out.left.length === 1 ? 'One hole starts' : `${out.left.length} holes start`} well below the holes round ${out.left.length === 1 ? 'it' : 'them'} (drilled from underground?) and ${out.left.length === 1 ? 'was' : 'were'} left out: ${out.left.slice(0, 5).join(', ')}${out.left.length > 5 ? ', …' : ''}. Add a point by hand if one of them is on the ground.` : '',
            out.carried > 20 ? `Some holes have no sample near their top: their collars were carried up the hole by as much as ${Math.round(out.carried)} m, and are less sure.` : '',
        ].filter(Boolean);
        return notes.length > 0 ? { severity: 'info', text: notes.join(' ') } : null;
    };
    const useSceneColumns = () => {
        const c = scene.coords;
        if (!c) return;
        setXAxis(c.x);
        setYAxis(c.y);
        setZAxis(c.z);
    };

    const setSlice = useCallback((index: number, slice: Slice) => {
        updateClip(prev => ({ ...prev, active: index, slices: prev.slices.map((s, i) => (i === index ? slice : s)) }));
    }, [updateClip]);

    /**
     * Point slice `index` along `normal`, through a point given in local
     * coordinates. `front`: the side that faces the viewer, when the slice is
     * taken from the view.
     */
    const orientSlice = useCallback((index: number, normal: Vec3, localPoint: ArrayLike<number>, front?: 1 | -1) => {
        if (!dataCentre) return;
        const center: Vec3 = [localPoint[0] + dataCentre[0], localPoint[1] + dataCentre[1], localPoint[2] + dataCentre[2]];
        updateClip(prev => ({
            ...prev, active: index,
            slices: prev.slices.map((s, i) => (i === index ? { ...withNormal(s, normal), center, ...(front ? { front } : {}) } : s)),
        }));
    }, [dataCentre, updateClip]);

    const toggleSlicing = () => {
        if (!geometry) return;
        setPlacing(null);
        // The first slice: a W-E section on the middle sample's northing
        const startNorth = medianAlong(PRESET_NORMALS.we, false);
        updateClip(prev => {
            if (prev.slicing && prev.slices.length > 0) return { ...prev, slicing: false };
            if (prev.slices.length > 0) {
                // Back on: with every slice hidden there would be nothing to see change
                const slices = prev.slices.some(s => s.on) ? prev.slices : prev.slices.map(s => ({ ...s, on: true }));
                return { ...prev, slicing: true, slices };
            }
            const { min, max } = geometry.bounds;
            const width = defaultSliceWidth(Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]));
            const o = geometry.origin;
            return { ...prev, slicing: true, active: 0, slices: [presetSlice('we', [o[0], o[1] + startNorth, o[2]], width)] };
        });
    };

    const addSlice = () => {
        const now = liveClip.get();
        const first = now.slices[0];
        if (!geometry || now.slices.length !== 1 || !first) return;
        // Crossing the first: a S-N section, or W-E when the first is already S-N,
        // through the middle sample of what the first slice shows
        const kind = sliceKind(first.normal) === 'sn' ? 'we' : 'sn';
        const normal = PRESET_NORMALS[kind];
        const o = geometry.origin;
        const local = [first.center[0] - o[0], first.center[1] - o[1], first.center[2] - o[2]];
        const shift = medianAlong(normal, true) - (local[0] * normal[0] + local[1] * normal[1] + local[2] * normal[2]);
        const center: Vec3 = [first.center[0] + normal[0] * shift, first.center[1] + normal[1] * shift, first.center[2] + normal[2] * shift];
        updateClip(prev => (prev.slices.length === 1 ? { ...prev, active: 1, slices: [prev.slices[0], presetSlice(kind, center, first.width)] } : prev));
    };

    const removeSlice = (index: number) => {
        setPlacing(null);
        updateClip(prev => {
            const slices = prev.slices.filter((_, i) => i !== index);
            return { ...prev, slices, active: 0, slicing: slices.length > 0 };
        });
    };

    const placeSlice = (index: number, how: SlicePlacement) => {
        const vp = viewportRef.current;
        if (!vp) return;
        if (how === 'view') {
            setPlacing(null);
            const forward = vp.viewDirection();
            const normal = normalFromView(forward, vex);
            if (normal) orientSlice(index, normal, vp.viewFocus(), sideFacingView(normal, forward, vex));
            return;
        }
        // Draw / Hole wait for the next drag / click in the view; pressing again cancels
        useModelStore.getState().setPicking(false);
        updateClip({ active: index });
        setMode('orbit');
        setPlacing(p => (p?.kind === how && p.index === index ? null : { kind: how, index }));
    };

    /** Slice `index` becomes the plane seen edge-on along a line dragged on screen. */
    const sliceAlongLine = (index: number, x0: number, y0: number, x1: number, y1: number) => {
        const vp = viewportRef.current;
        if (!vp || Math.hypot(x1 - x0, y1 - y0) < 8) return;
        const plane = planeFromScreenLine(vp.screenRay(x0, y0), vp.screenRay(x1, y1), vp.viewDirection(), vp.viewFocus(), vex);
        if (plane) orientSlice(index, plane.normal, plane.point);
    };

    /** Slice `index` becomes the vertical section through the hole that sample `row` belongs to. */
    const sliceThroughHole = (index: number, row: number) => {
        const ids = holeColumn ? useAppStore.getState().getRawColumn(holeColumn) : undefined;
        if (!ids || !geometry) return;
        const id = ids[row];
        if (id === null || id === undefined || id === '') return;
        const rows: number[] = [];
        for (let i = 0; i < geometry.valid.length; i++) if (geometry.valid[i] && ids[i] === id) rows.push(i);
        const plane = planeThroughHole(geometry.positions, rows, liveClip.get().slices[index]?.normal ?? [0, 1, 0]);
        if (plane) orientSlice(index, plane.normal, plane.point);
    };

    /** Turn the view square-on to a slice's front (`back`: to its other side). */
    const lookAtSlice = useCallback((index: number, back = false) => {
        const slice = liveClip.get().slices[index];
        if (!slice || !geometry) return;
        const side = sliceFront(slice) * (back ? -1 : 1);
        const toViewer: Vec3 = [slice.normal[0] * side, slice.normal[1] * side, slice.normal[2] * side];
        const o = geometry.origin;
        const point: Vec3 = [slice.center[0] - o[0], slice.center[1] - o[1], slice.center[2] - o[2]];
        // Frame the part of the slice that is inside the data (all the data when the slice is outside it)
        let outline = planeBoxPolygon(slice.normal, point, geometry.bounds);
        if (outline.length === 0) outline = [...geometry.bounds.min, ...geometry.bounds.max];
        // A section is read square-on without perspective; the camera switch lands on the next frame
        setOrtho(true);
        requestAnimationFrame(() => viewportRef.current?.lookAlong(toViewer, outline));
    }, [geometry, liveClip, setOrtho]);

    /** Slice the East, North or elevation axis with the active slice (slicing comes on if it was off). */
    const presetActive = (kind: PresetKind) => {
        if (!liveClip.get().slicing) toggleSlicing();
        setPlacing(null);
        updateClip(prev => ({
            ...prev, slices: prev.slices.map((s, i) => (i === prev.active ? withNormal(s, [...PRESET_NORMALS[kind]]) : s)),
        }));
    };

    /** The active slice square to the view (slicing comes on if it was off). */
    const viewActive = () => {
        if (!liveClip.get().slicing) toggleSlicing();
        const now = liveClip.get();
        if (now.slices[now.active]) placeSlice(now.active, 'view');
    };

    /** Move a slice, as it lies, onto the middle of the data. */
    const centreSlice = (index: number) => {
        const slice = liveClip.get().slices[index];
        if (!slice || !geometry) return;
        const o = geometry.origin, n = slice.normal;
        const here = (slice.center[0] - o[0]) * n[0] + (slice.center[1] - o[1]) * n[1] + (slice.center[2] - o[2]) * n[2];
        setSlice(index, moveSlice(slice, medianAlong(n, false) - here));
    };

    /**
     * Where the middle sample sits along `normal` (local metres from the data
     * centre): a new slice starts there, on the data, not in a gap between
     * drill lines. `shownOnly` keeps to the samples inside the current slices.
     */
    const medianAlong = (normal: Vec3, shownOnly: boolean): number => {
        if (!geometry) return 0;
        const p = geometry.positions, n = geometry.valid.length;
        const clip = currentClip();
        const collect = (inClip: boolean) => {
            const stride = Math.max(1, Math.floor(n / 50_000));
            const d: number[] = [];
            for (let i = 0; i < n; i += stride) {
                if (!geometry.valid[i] || (inClip && !isInsideClip(p[i * 3], p[i * 3 + 1], p[i * 3 + 2], clip))) continue;
                d.push(p[i * 3] * normal[0] + p[i * 3 + 1] * normal[1] + p[i * 3 + 2] * normal[2]);
            }
            return d.sort((a, b) => a - b);
        };
        let d = collect(shownOnly);
        if (d.length === 0 && shownOnly) d = collect(false);
        return d.length ? d[d.length >> 1] : 0;
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
        if (drawingLine) {
            setDrawPts([dragStart.current.x, dragStart.current.y, x, y]);
        } else if (mode === 'box' && !outlineFor) {
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
        if (placing?.kind === 'line') {
            setPlacing(null);
            if (start && poly.length === 4) sliceAlongLine(placing.index, poly[0], poly[1], poly[2], poly[3]);
            return;
        }
        if (outlineFor) {
            setOutlineFor(null);
            if (start && poly.length >= 6) outlineFromScreen(outlineFor, poly);
            return;
        }
        if (!start || poly.length < 6) return;
        const screen = screenPositions();
        if (!screen) return;
        applySelection(selectInPolygon(screen, poly, eligibility()), start.shift, start.ctrl);
    };

    // --- click to pick (orbit mode) ----------------------------------------------
    const clickStart = useRef<{ x: number; y: number } | null>(null);
    const onCanvasDown = (e: React.PointerEvent) => { clickStart.current = { x: e.clientX, y: e.clientY }; };
    const onCanvasUp = (e: React.PointerEvent) => {
        const s = clickStart.current;
        clickStart.current = null;
        // Placing a surface's points, or the model's readings: the click belongs to that (useSurfaceEditing, useStructureTool)
        if (editing.picking || structuring) return;
        if (!s || Math.hypot(e.clientX - s.x, e.clientY - s.y) > 4 || !geometry) return;
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const px = e.clientX - rect.left, py = e.clientY - rect.top;
        const screen = screenPositions();
        if (!screen) return;
        const isEligible = eligibility();
        // A cylinder under the cursor first (anywhere along it); else the nearest point
        let best = viewportRef.current?.pickCylinder(px, py, isEligible) ?? -1;
        let bestD = 10 * 10;
        for (let i = 0; best < 0 && i < geometry.valid.length; i++) {
            if (cylinders?.has[i]) continue; // drawn as a cylinder, not a point
            const dx = screen[i * 2] - px, dy = screen[i * 2 + 1] - py;
            const d = dx * dx + dy * dy;
            if (d < bestD && isEligible(i)) { bestD = d; best = i; }
        }
        if (placing?.kind === 'hole') {
            // A miss keeps waiting for a hole
            if (best >= 0) { setPlacing(null); sliceThroughHole(placing.index, best); }
            return;
        }
        if (best < 0) { setPicked(null); return; }
        setPicked({ index: best, x: px, y: py });
        if (e.shiftKey) applySelection([best], true, false);
        else if (e.ctrlKey || e.metaKey) applySelection([best], false, true);
    };

    // --- hole finder ------------------------------------------------------------------------
    const [holesOpen, setHolesOpen] = usePlotSetting(plotId, 'holePanel3d', false);
    /** The hole with a name tag on its collar while the list is open */
    const [foundHole, setFoundHole] = usePlotSetting<string | null>(plotId, 'foundHole3d', null);
    /** The hole under the pointer (or the arrow keys) in the list */
    const [previewHole, setPreviewHole] = useState<string | null>(null);
    /** The hole just found or zoomed to: lit along its length for a moment (`at` restarts it) */
    const [flashHole, setFlashHole] = useState<{ id: string; at: number } | null>(null);
    const [holeFocus, setHoleFocus] = useState(0);
    const holeIndex = useDrillholeIndex(geometry, holesOpen);
    const holeById = useMemo(() => new Map((holeIndex?.holes ?? []).map(h => [h.id, h])), [holeIndex]);

    // The line along a found hole covers its samples: it goes after a moment, the tag stays
    useEffect(() => {
        if (!flashHole) return;
        const t = window.setTimeout(() => setFlashHole(null), HOLE_FLASH_MS);
        return () => window.clearTimeout(t);
    }, [flashHole]);

    // Tag the found hole; light up the hole just found and the one pointed at in the list
    const untagHole = useRef(() => {});
    untagHole.current = () => { setFoundHole(null); setFlashHole(null); };
    useEffect(() => {
        const vp = viewportRef.current;
        if (!viewportReady || !vp) return;
        const markers: HoleMarker[] = [];
        if (geometry && holesOpen) {
            const marker = (id: string | null): HoleMarker | null => {
                const hole = id === null ? undefined : holeById.get(id);
                return hole ? { path: holePath(hole, geometry.positions, intervals), label: hole.id, color: HOLE_MARK_COLOR } : null;
            };
            const tagged = marker(foundHole);
            if (tagged) markers.push({ ...tagged, line: flashHole?.id === foundHole || previewHole === foundHole, onDismiss: () => untagHole.current() });
            const pointed = previewHole !== foundHole ? marker(previewHole) : null;
            if (pointed) markers.push({ ...pointed, line: true, faint: true });
        }
        vp.setHoleMarkers(markers);
    }, [viewportReady, geometry, intervals, holeById, foundHole, previewHole, flashHole, holesOpen]);

    const openHoles = () => {
        if (!holeColumn) return false;
        setHolesOpen(true);
        setHoleFocus(n => n + 1);
        return true;
    };
    /** Closing the list takes the tag off the hole too. */
    const closeHoles = () => {
        setHolesOpen(false);
        setPreviewHole(null);
        setFlashHole(null);
        setFoundHole(null);
    };
    const zoomToHole = (id: string) => {
        const hole = holeById.get(id);
        if (!hole) return;
        viewportRef.current?.zoomTo(hole);
        setFlashHole({ id, at: Date.now() });
    };
    const findHole = (id: string) => {
        setFoundHole(id);
        zoomToHole(id);
    };
    const selectHole = (id: string, add: boolean) => {
        const hole = holeById.get(id);
        if (hole) applySelection(Array.from(hole.rows), add, false);
    };
    const isolateHole = (id: string) => {
        selectHole(id, false);
        setIsolate(true);
    };
    /** The active slice becomes the vertical section through a hole (slicing comes on if it was off). */
    const sectionHole = (id: string) => {
        const hole = holeById.get(id);
        if (!hole || hole.rows.length === 0) return;
        if (!liveClip.get().slicing) toggleSlicing();
        const now = liveClip.get();
        if (now.slices[now.active]) sliceThroughHole(now.active, hole.rows[0]);
    };
    // The hole of the sample last clicked in the view: the list scrolls to it
    const pickedHole = picked !== null && holeIndex ? holeIndex.holes[holeIndex.holeOfRow[picked.index]]?.id ?? null : null;

    // --- a slice locked to the camera stays where it is on screen ---------------------------
    useEffect(() => {
        const vp = viewportRef.current;
        if (!viewportReady || !vp || !geometry) return;
        const o = geometry.origin;
        // The locked slice as the camera sees it: its front direction and a point on it
        let held: { index: number; front: Vec3; point: Vec3 } | null = null;
        let following = false;
        const measure = () => {
            if (following) return;
            const now = liveClip.get();
            const index = now.slicing ? now.slices.findIndex(s => s.locked && s.on) : -1;
            if (index < 0) { held = null; return; }
            const s = now.slices[index], side = sliceFront(s);
            // Drawing space: z times the exaggeration; a plane's normal has z divided by it
            held = {
                index,
                front: vp.toCameraSpace([s.normal[0] * side, s.normal[1] * side, (s.normal[2] * side) / vex], true),
                point: vp.toCameraSpace([s.center[0] - o[0], s.center[1] - o[1], (s.center[2] - o[2]) * vex], false),
            };
        };
        const follow = () => {
            if (!held) return;
            const { index } = held;
            const f = vp.fromCameraSpace(held.front, true), p = vp.fromCameraSpace(held.point, false);
            const facing: Vec3 = [f[0], f[1], f[2] * vex];
            const normal = canonicalNormal(facing);
            if (!normal) return;
            const front = normal[0] * facing[0] + normal[1] * facing[1] + normal[2] * facing[2] > 0 ? 1 : -1;
            const center: Vec3 = [p[0] + o[0], p[1] + o[1], p[2] / vex + o[2]];
            following = true;
            updateClip(prev => ({ ...prev, slices: prev.slices.map((s, i) => (i === index ? { ...s, normal, center, front } : s)) }));
            following = false;
        };
        measure();
        const off = liveClip.subscribe(measure);
        vp.onCameraChange = follow;
        return () => { off(); vp.onCameraChange = null; };
    }, [viewportReady, geometry, liveClip, updateClip, vex]);

    // --- keys, Ctrl + wheel and Ctrl + drag: work the active slice --------------------------
    const containerRef = useRef<HTMLDivElement>(null);
    // The handlers below outlive a render: they reach today's actions through this
    const sliceActions = useRef({ toggleSlicing, presetActive, viewActive, centreSlice, openHoles });
    sliceActions.current = { toggleSlicing, presetActive, viewActive, centreSlice, openHoles };
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const activeSlice = () => {
            const now = liveClip.get();
            return now.slicing ? now.slices[now.active] : undefined;
        };
        const changeActive = (change: (s: Slice) => Slice) =>
            updateClip(prev => ({ ...prev, slices: prev.slices.map((s, i) => (i === prev.active ? change(s) : s)) }));
        /** Move the active slice `n` steps; false when slicing is off. */
        const step = (n: number) => {
            if (!activeSlice()) return false;
            changeActive(s => stepSlice(s, n));
            return true;
        };
        // The slicer keys of Leapfrog, plus [ ] to step and 1 / 2 to choose the slice
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { setPlacing(null); setOutlineFor(null); return; }
            // Typing in the slice bar's number boxes
            if ((e.target as HTMLElement).closest?.('input, textarea') || e.altKey) return;
            const key = e.key.toLowerCase();
            const ctrl = e.ctrlKey || e.metaKey;
            const act = sliceActions.current;
            const slice = activeSlice();
            let used = true;
            if (ctrl && e.shiftKey) used = false;
            else if (ctrl) {
                // These work with slicing off too: they bring the slicer in
                if (key === '/') act.toggleSlicing();
                else if (key === 'v') act.viewActive();
                else if (key === 'e') act.presetActive('sn');     // slice the East axis: a S-N section
                else if (key === 'n') act.presetActive('we');     // slice the North axis: a W-E section
                else if (key === 'd') act.presetActive('level');  // slice the elevation axis: a level
                else if (key === 'l' && slice) changeActive(s => ({ ...s, on: true, locked: !s.locked }));
                else if (key === 'f') used = act.openHoles();     // find a hole
                else used = false;
            } else if (e.shiftKey && (key === 'e' || key === 'n' || key === 'd')) {
                // The same three for a browser tab, where Ctrl+N belongs to the browser
                act.presetActive(key === 'e' ? 'sn' : key === 'n' ? 'we' : 'level');
            } else if (!slice) used = false;
            else if (key === ']' || key === '.') step(1);
            else if (key === '[' || key === ',') step(-1);
            else if (key === 'l') lookAtSlice(liveClip.get().active, e.shiftKey);
            else if (key === 't') changeActive(s => ({ ...s, on: true, mode: 'thick' }));
            else if (key === 'f') changeActive(s => ({ ...s, on: true, mode: s.mode === 'front' ? 'thick' : 'front' }));
            else if (key === 'k') changeActive(s => ({ ...s, on: true, mode: s.mode === 'back' ? 'thick' : 'back' }));
            else if (key === 'c') act.centreSlice(liveClip.get().active);
            else if ((key === '1' || key === '2') && liveClip.get().slices[Number(key) - 1]) updateClip({ active: Number(key) - 1 });
            else used = false;
            // Ours: not also an app-wide shortcut (L is the lasso tool elsewhere)
            if (used) { e.preventDefault(); e.stopPropagation(); }
        };

        // Ctrl + right drag moves the active slice; Ctrl + middle drag (or both buttons) sets its width
        let drag: { id: number; x: number; y: number; widening: boolean; start: Slice; perMetre: [number, number]; scale: number; away: number } | null = null;
        const beginDrag = (e: PointerEvent, widening: boolean, start: Slice) => {
            const vp = viewportRef.current;
            if (!vp || !dataCentre) return null;
            const n = start.normal;
            const local = [start.center[0] - dataCentre[0], start.center[1] - dataCentre[1], start.center[2] - dataCentre[2]];
            const scale = vp.pixelsPerMetre(local);
            // How the slice's centre moves on screen for a metre along its normal (measured over ~50 px)
            const span = 50 / scale;
            const a = vp.projectPoint(local), b = vp.projectPoint([local[0] + n[0] * span, local[1] + n[1] * span, local[2] + n[2] * span]);
            const perMetre: [number, number] = [(b[0] - a[0]) / span, (b[1] - a[1]) / span];
            const away = -sideFacingView(n, vp.viewDirection(), vex);
            return { id: e.pointerId, x: e.clientX, y: e.clientY, widening, start, perMetre: perMetre.every(Number.isFinite) ? perMetre : [0, 0] as [number, number], scale, away };
        };
        const onPointerDown = (e: PointerEvent) => {
            const slice = activeSlice();
            if (!e.ctrlKey || (e.button !== 1 && e.button !== 2) || !slice) return;
            if ((e.target as HTMLElement).closest?.('[data-testid="slice-bar"]')) return;
            drag = beginDrag(e, e.button === 1, slice);
            if (!drag) return;
            // Ours: the camera does not pan or zoom, and no autoscroll or selection starts
            e.preventDefault();
            e.stopPropagation();
            el.setPointerCapture(e.pointerId);
            el.focus({ preventScroll: true });
        };
        const onPointerMove = (e: PointerEvent) => {
            if (!drag || e.pointerId !== drag.id) return;
            e.stopPropagation();
            const widening = (e.buttons & 4) !== 0 || (e.buttons & 3) === 3;
            if (widening !== drag.widening) {
                // Another button went down or came up: carry on from here
                const slice = activeSlice();
                const next = slice ? beginDrag(e, widening, slice) : null;
                if (!next) return;
                drag = next;
            }
            const { start, perMetre, scale, away } = drag;
            const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
            if (drag.widening) {
                if ((start.mode ?? 'thick') === 'thick') changeActive(s => ({ ...s, width: dragWidth(start.width, dx, dy) }));
            } else {
                const moved = moveSlice(start, dragDistance(dx, dy, perMetre, scale, away));
                changeActive(s => ({ ...s, center: moved.center }));
            }
        };
        const onPointerUp = (e: PointerEvent) => {
            if (!drag || e.pointerId !== drag.id) return;
            e.stopPropagation();
            if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
            drag = null;
        };
        // Middle button: no autoscroll. Right button: no menu after the drag.
        const onMouseDown = (e: MouseEvent) => { if (e.ctrlKey && e.button === 1 && activeSlice()) e.preventDefault(); };
        const onContextMenu = (e: MouseEvent) => { if (e.ctrlKey && activeSlice()) e.preventDefault(); };
        // One step per wheel notch; a touchpad's small deltas add up to a step
        let wheel = 0;
        const onWheel = (e: WheelEvent) => {
            if (!e.ctrlKey || !liveClip.get().slicing) return;
            // Ours: neither the page (browser zoom) nor the camera zoom gets it
            e.preventDefault();
            e.stopPropagation();
            wheel += e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
            const steps = Math.trunc(wheel / 100);
            if (steps === 0) return;
            wheel -= steps * 100;
            step(-steps); // wheel away from you = forward
        };
        el.addEventListener('keydown', onKey);
        el.addEventListener('wheel', onWheel, { capture: true, passive: false });
        el.addEventListener('pointerdown', onPointerDown, { capture: true });
        el.addEventListener('pointermove', onPointerMove, { capture: true });
        el.addEventListener('pointerup', onPointerUp, { capture: true });
        el.addEventListener('pointercancel', onPointerUp, { capture: true });
        el.addEventListener('mousedown', onMouseDown, { capture: true });
        el.addEventListener('contextmenu', onContextMenu, { capture: true });
        return () => {
            el.removeEventListener('keydown', onKey);
            el.removeEventListener('wheel', onWheel, { capture: true });
            el.removeEventListener('pointerdown', onPointerDown, { capture: true });
            el.removeEventListener('pointermove', onPointerMove, { capture: true });
            el.removeEventListener('pointerup', onPointerUp, { capture: true });
            el.removeEventListener('pointercancel', onPointerUp, { capture: true });
            el.removeEventListener('mousedown', onMouseDown, { capture: true });
            el.removeEventListener('contextmenu', onContextMenu, { capture: true });
        };
        // Depends on having data: the container only exists then
    }, [hasGeometry, liveClip, updateClip, lookAtSlice, dataCentre, vex]);

    // --- placing and moving a surface's points in the view -----------------------------------
    const placement = {
        containerRef, viewportRef, ready: viewportReady, geometry, intervals, vex, eligibility,
        // A point or a node of the surface is where it is in space: outside the slices it is not shown, nor picked up
        visibleAt: () => {
            const clip = loosenClip(currentClip(), 0.05);
            return (x: number, y: number, z: number) => isInsideClip(x, y, z, clip);
        },
        slicePlane: (): { normal: [number, number, number]; point: [number, number, number] } | null => {
            const now = liveClip.get();
            const slice = now.slicing ? now.slices[now.active] : undefined;
            const o = geometry?.origin;
            if (!slice || !slice.on || !o) return null;
            return { normal: slice.normal, point: [slice.center[0] - o[0], slice.center[1] - o[1], slice.center[2] - o[2]] };
        },
        columns: {
            hole: holeColumn, from: guessFromColumn(columns), to: guessToColumn(columns),
            id: columns.find(col => col.role === 'ID')?.name ?? null,
        },
    };
    const editing = useSurfaceEditing({ ...placement, active: sceneHere && mode === 'orbit' && !placing });
    // --- setting the model's structure by hand: readings placed by clicking, strokes drawn on the slice ---
    const structuring = useStructureTool({
        ...placement, active: !!zAxis && (sceneHere || !sceneInUse(scene)) && mode === 'orbit' && !placing,
        coords: () => ({ x: xAxis, y: yAxis, z: zAxis, hole: holeColumn, from: guessFromColumn(columns), to: guessToColumn(columns) }),
    });
    const structureTool = useModelStore(s => s.structureTool);
    // Placing points is done with the camera tool: it takes over from the lasso, a waiting slice and the sample tooltip
    const wantsPicking = useModelStore(s => s.picking || s.structureTool !== null);
    useEffect(() => {
        if (!wantsPicking) return;
        setMode('orbit');
        setPlacing(null);
        setPicked(null);
        setOutlineFor(null);
    }, [wantsPicking]);

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
    const [cylinderMenu, setCylinderMenu] = useState<HTMLElement | null>(null);
    const box = clipOutline; // the clip box: `boxEnabled`, `box` (world coordinates)
    /** How the ground lies at the sample pointed out, by the model's direction from place to place */
    const pickedTrend = picked !== null && trendField && sceneHere && geometry && zAxis ? (() => {
        const o = geometry.origin, k = picked.index * 3;
        const local = trendAt(trendField, [geometry.positions[k] + o[0], geometry.positions[k + 1] + o[1], geometry.positions[k + 2] + o[2]]);
        const lie = trendDip(local);
        return lie ? `${anglesText('plane', lie)}${local.fromReadings >= 0.5 ? ' (from readings)' : trendField.planes > 0 ? ' (mostly the model\'s one direction)' : ''}` : null;
    })() : null;
    const pickedId = picked !== null ? (() => {
        const idCol = columns.find(col => col.role === 'ID')?.name ?? columns.find(col => col.role === 'HoleID')?.name;
        const col = idCol ? useAppStore.getState().getRawColumn(idCol) : undefined;
        return col ? String(col[picked.index] ?? '') : `Row ${picked.index + 1}`;
    })() : '';

    const pickedHoleName = picked !== null && holeColumn
        ? String(useAppStore.getState().getRawColumn(holeColumn)?.[picked.index] ?? '').trim()
        : '';

    // From–To of the clicked sample, when it is drawn as a cylinder
    const pickedInterval = picked !== null && cylinders?.has[picked.index] ? (() => {
        const s = useAppStore.getState();
        const value = (name: string | null) => {
            const v = name ? s.getRawColumn(name)?.[picked.index] : null;
            return v === null || v === undefined || v === '' ? null : String(v);
        };
        const from = value(guessFromColumn(columns)), to = value(guessToColumn(columns));
        return from === null ? '' : to === null ? `From ${from} m` : `${from} – ${to} m`;
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
                    <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_, v) => { if (v) { setMode(v); setPlacing(null); setOutlineFor(null); if (v !== 'orbit') useModelStore.getState().setPicking(false); } }}>
                        <ToggleButton value="orbit"><Tooltip title="Rotate / pan / zoom (click a point to inspect; Shift-click adds, Ctrl-click removes)"><ThreeSixty fontSize="small" /></Tooltip></ToggleButton>
                        <ToggleButton value="lasso"><Tooltip title="Lasso select (Shift adds, Ctrl removes)"><Gesture fontSize="small" /></Tooltip></ToggleButton>
                        <ToggleButton value="box"><Tooltip title="Box select (Shift adds, Ctrl removes)"><CropFree fontSize="small" /></Tooltip></ToggleButton>
                    </ToggleButtonGroup>
                    {intervals && (
                        <ToggleButtonGroup size="small">
                            <ToggleButton value="cylinders" selected={cylindersOn} onChange={() => setCylindersOn(!cylindersOn)} sx={{ textTransform: 'none', gap: 0.5 }}>
                                <Tooltip title="Draw samples as cylinders (From–To)"><Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}><CylinderIcon />Cylinders</Box></Tooltip>
                            </ToggleButton>
                            <ToggleButton value="cylinder-options" selected={!!cylinderMenu} onChange={e => setCylinderMenu(e.currentTarget as HTMLElement)} sx={{ px: 0 }} aria-label="Cylinder width">
                                <Tooltip title="Cylinder width"><ArrowDropDown fontSize="small" /></Tooltip>
                            </ToggleButton>
                        </ToggleButtonGroup>
                    )}
                    <ButtonGroup size="small" variant="outlined">
                        {/* menu names: X-Y plan, Y-Z section looking east (S-N), X-Z section looking north (W-E) */}
                        {([['plan', 'X-Y', 'Plan view (X-Y)'], ['east', 'Y-Z', 'S-N section (Y-Z)'], ['north', 'X-Z', 'W-E section (X-Z)'], ['iso', '3D', 'Oblique view']] as [Preset, string, string][]).map(([p, label, tip]) => (
                            <Tooltip key={p} title={tip}><Button onClick={() => fitView(p)}>{label}</Button></Tooltip>
                        ))}
                    </ButtonGroup>
                    <ToggleButton size="small" value="slice" selected={slicing} disabled={!geometry} onChange={toggleSlicing} sx={{ textTransform: 'none', gap: 0.5 }}>
                        <Tooltip title="Slice the data: sections, level plans, or two crossing slices"><Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}><ContentCut fontSize="small" />Slice</Box></Tooltip>
                    </ToggleButton>
                    <ToggleButton
                        size="small" value="holes" selected={holesOpen && !!holeColumn} disabled={!geometry || !holeColumn}
                        onChange={() => { if (holesOpen) closeHoles(); else openHoles(); }}
                        sx={{ textTransform: 'none', gap: 0.5, '&.Mui-disabled': { pointerEvents: 'auto' } }}
                    >
                        <Tooltip title={holeColumn ? 'List the holes: search for one, zoom to it, mark it ( Ctrl+F in the view )' : 'Needs a hole ID column'}>
                            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}><ManageSearch fontSize="small" />Holes</Box>
                        </Tooltip>
                    </ToggleButton>
                    <ToggleButton size="small" value="surfaces" selected={surfacesOpen} disabled={!geometry} onChange={() => setSurfacesOpen(!surfacesOpen)} sx={{ textTransform: 'none', gap: 0.5 }}>
                        <Tooltip title="Surfaces: fit a fault, contact or other boundary through samples; tag samples by side and distance">
                            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}><Layers fontSize="small" />Surfaces{scene.surfaces.length > 0 ? ` (${scene.surfaces.length})` : ''}</Box>
                        </Tooltip>
                    </ToggleButton>
                    <Tooltip title="Zoom to selection"><span><Button size="small" disabled={!hasSelection} onClick={zoomToSelection}><CenterFocusStrong fontSize="small" /></Button></span></Tooltip>
                    <Tooltip title="Show only the selection"><span><Button size="small" variant={isolate ? 'contained' : 'text'} disabled={!hasSelection} onClick={() => setIsolate(!isolate)}><FilterCenterFocus fontSize="small" /></Button></span></Tooltip>
                    <Tooltip title="Clear selection"><span><Button size="small" disabled={!hasSelection} onClick={() => setSelection([])}><Clear fontSize="small" /></Button></span></Tooltip>
                    <Tooltip title="Save PNG"><Button size="small" onClick={screenshot}><PhotoCamera fontSize="small" /></Button></Tooltip>
                    <Tooltip title="Wireframes (Leapfrog .msh, DXF, OBJ, STL, GOCAD .ts)">
                        <span>
                            <Button size="small" disabled={!geometry} aria-label="Wireframes" onClick={showWireframes}>
                                <Badge badgeContent={scene.wireframes.length} color="primary" max={99} invisible={scene.wireframes.length === 0}>
                                    <ViewInAr fontSize="small" />
                                </Badge>
                            </Button>
                        </span>
                    </Tooltip>
                </>}
                settingsActive={box.boxEnabled || vex !== 1 || ortho || satellite}
                summary={<>
                    {satellite && <SettingChip label="Satellite" onDelete={() => setSatellite(false)} />}
                    {box.boxEnabled && <SettingChip label="Clip box" onDelete={() => updateClip({ boxEnabled: false })} />}
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
                    <ControlSection label="Satellite image">
                        <FormControlLabel control={<Switch size="small" checked={satellite} onChange={e => setSatellite(e.target.checked)} />} label="Show a satellite image under the data" />
                        {satellite && <>
                            <ProjectionPicker minWidth={240} />
                            {!epsgCode && <Typography variant="caption" color="text.secondary">Choose the projection of the East/North columns to place the image.</Typography>}
                            {ground.error && <Typography variant="caption" color="error">{ground.error}</Typography>}
                            <Typography variant="caption">Opacity {Math.round(satelliteOpacity * 100)}%</Typography>
                            <Slider size="small" min={0.1} max={1} step={0.1} value={satelliteOpacity} onChange={(_, v) => setSatelliteOpacity(v as number)} />
                            <FormControlLabel control={<Switch size="small" checked={satelliteAtTop} onChange={e => setSatelliteAtTop(e.target.checked)} />} label="At the top of the data (surface) instead of the bottom" />
                        </>}
                    </ControlSection>
                    <ControlSection label="Clip box">
                        <FormControlLabel control={<Switch size="small" checked={box.boxEnabled && !!box.box} onChange={e => updateClip({ boxEnabled: e.target.checked, box: box.box ?? (worldBounds ? { x: [worldBounds.min[0], worldBounds.max[0]], y: [worldBounds.min[1], worldBounds.max[1]], z: [worldBounds.min[2], worldBounds.max[2]] } : null) })} />} label="Clip to box" />
                        {worldBounds && box.box && (['x', 'y', 'z'] as const).map((axis, k) => (
                            <Box key={axis}>
                                <Typography variant="caption">{axis.toUpperCase()} {Math.round(box.box![axis][0])} – {Math.round(box.box![axis][1])}</Typography>
                                <Slider size="small" min={worldBounds.min[k]} max={worldBounds.max[k]} step={Math.max((worldBounds.max[k] - worldBounds.min[k]) / 500, 0.01)}
                                    value={box.box![axis]} disabled={!box.boxEnabled}
                                    onChange={(_, v) => updateClip({ box: { ...box.box!, [axis]: v as [number, number] } })} />
                            </Box>
                        ))}
                        <Button size="small" disabled={!hasSelection} onClick={boxFromSelection}>Box around selection</Button>
                    </ControlSection>
                </>}
            />

            {intervals && (
                <Popover
                    open={!!cylinderMenu} anchorEl={cylinderMenu} onClose={() => setCylinderMenu(null)}
                    anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                >
                    <Box sx={{ width: 280, p: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <FormControlLabel control={<Switch size="small" checked={cylindersOn} onChange={e => setCylindersOn(e.target.checked)} />} label="Draw samples as cylinders (From–To)" />
                        <Typography variant="caption">Width {formatWidth(cylinderWidth)} m</Typography>
                        {/* Logarithmic: a twentieth to twenty times the starting width */}
                        <Slider
                            size="small" min={-WIDTH_DECADES} max={WIDTH_DECADES} step={0.02} disabled={!cylindersOn}
                            value={Math.min(WIDTH_DECADES, Math.max(-WIDTH_DECADES, Math.log10(cylinderWidth / defaultCylinderWidth)))}
                            onChange={(_, v) => setCylinderWidth(Number((defaultCylinderWidth * 10 ** (v as number)).toPrecision(2)))}
                        />
                        <FormControlLabel control={<Switch size="small" checked={cylinderBySize} disabled={!cylindersOn} onChange={e => setCylinderBySize(e.target.checked)} />} label="Width follows the Size attribute" />
                        {geometry && intervals.count < geometry.validCount && (
                            <Typography variant="caption" color="text.secondary">
                                {(geometry.validCount - intervals.count).toLocaleString()} samples have no From–To interval and stay as points.
                            </Typography>
                        )}
                    </Box>
                </Popover>
            )}

            {!geometry ? (
                <Typography color="text.secondary">Select numeric X and Y columns (and optionally Z) to view in 3D. Loaded wireframes are drawn with the data.</Typography>
            ) : (
                <Box ref={fillRef} sx={{ display: 'flex', gap: 1 }}>
                {holesOpen && holeIndex && (
                    <HolePanel
                        holes={holeIndex.holes} height={fillHeight}
                        found={foundHole} pointedAt={pickedHole} focusSignal={holeFocus} canSection
                        onPreview={setPreviewHole} onFind={findHole} onClearFound={() => untagHole.current()}
                        onZoom={zoomToHole} onSelect={selectHole} onIsolate={isolateHole} onSection={sectionHole}
                        onClose={() => { closeHoles(); containerRef.current?.focus({ preventScroll: true }); }}
                    />
                )}
                <Paper ref={containerRef} tabIndex={0} sx={{ position: 'relative', flex: 1, minWidth: 0, height: fillHeight, overflow: 'hidden', outline: 'none' }}>
                    <Box ref={viewportEl} sx={{ position: 'absolute', inset: 0, cursor: placing?.kind === 'hole' ? 'crosshair' : undefined }} onPointerDown={onCanvasDown} onPointerUp={onCanvasUp} />

                    {(mode !== 'orbit' || drawingLine || outlineFor) && (
                        <Box
                            sx={{ position: 'absolute', inset: 0, cursor: 'crosshair', touchAction: 'none' }}
                            onPointerDown={onOverlayDown} onPointerMove={onOverlayMove} onPointerUp={onOverlayUp}
                        >
                            <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                                {drawingLine && drawPts.length === 4 && (
                                    <line
                                        x1={drawPts[0]} y1={drawPts[1]} x2={drawPts[2]} y2={drawPts[3]}
                                        stroke={SLICE_COLORS[placing.index] ?? SLICE_COLORS[0]} strokeWidth={2}
                                    />
                                )}
                                {!drawingLine && drawPts.length >= 4 && (
                                    <polygon
                                        points={drawPts.reduce<string[]>((acc, v, i) => (i % 2 ? (acc[acc.length - 1] += `,${v}`, acc) : [...acc, String(v)]), []).join(' ')}
                                        fill={theme.palette.primary.main} fillOpacity={0.12} stroke={theme.palette.primary.main} strokeWidth={1.5} strokeDasharray="4 3"
                                    />
                                )}
                            </svg>
                        </Box>
                    )}

                    {slicing && worldBounds && (
                        <LiveSliceBar
                            clip={liveClip}
                            axisNames={[d(xAxis), d(yAxis), zAxis ? d(zAxis) : '']}
                            dataCentre={geometry.origin} bounds={worldBounds}
                            placing={placing} canPickHole={!!holeColumn}
                            onActive={i => updateClip({ active: i })}
                            onChange={setSlice} onRemove={removeSlice} onAdd={addSlice}
                            onPlace={placeSlice} onLookAt={lookAtSlice} onCentre={centreSlice}
                        />
                    )}

                    <Stack direction="row" spacing={2} sx={{ position: 'absolute', left: 12, bottom: 8, pointerEvents: 'none' }}>
                        <Typography variant="caption" color="text.secondary">
                            {geometry.validCount.toLocaleString()} points
                            <InsideCount clip={liveClip} geometry={geometry} />
                            {hasSelection ? ` · ${selectedIndices.length.toLocaleString()} selected` : ''}
                            {zAxis ? '' : ' · flat (no Z)'}
                            {placing ? (placing.kind === 'line' ? ' · Drag a line across the view for the slice (Esc cancels)' : ' · Click a hole for the slice (Esc cancels)') : ''}
                            {outlineFor ? ' · Drag around the part of the surface to keep (Esc cancels)' : ''}
                            {editing.picking ? (editing.drawing && slicing
                                ? ' · Click on the slice to draw a line node by node, or drag to draw it freehand (Esc when done)'
                                : ` · Click ${intervals ? 'a drillhole' : 'a sample'}${slicing ? ' or the slice' : ''} to place a point (Esc when done)`) : ''}
                            {structuring && structureTool ? (structureTool.mode === 'place'
                                ? ` · Click ${intervals ? 'a drillhole' : 'a sample'}${slicing ? ' or the slice' : ''} to put a ${structureTool.kind} there (Esc when done)`
                                : slicing ? ` · Drag along the ${structureTool.target === 'line' ? 'line' : 'structure'} on the slice (Esc when done)` : ' · Turn on a slice to draw on (Esc cancels)') : ''}
                        </Typography>
                    </Stack>

                    {ground.tiles && (
                        <Typography variant="caption" color="text.secondary" sx={{ position: 'absolute', right: 12, bottom: 8, pointerEvents: 'none' }}>
                            {SATELLITE_ATTRIBUTION}
                        </Typography>
                    )}

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
                                {pickedHoleName && pickedHoleName !== pickedId && <>Hole {pickedHoleName}<br /></>}
                                {pickedInterval && <>{pickedInterval}<br /></>}
                                {d(xAxis)}: {(geometry.positions[picked.index * 3] + geometry.origin[0]).toFixed(1)}<br />
                                {d(yAxis)}: {(geometry.positions[picked.index * 3 + 1] + geometry.origin[1]).toFixed(1)}
                                {zAxis && <><br />{d(zAxis)}: {(geometry.positions[picked.index * 3 + 2] + geometry.origin[2]).toFixed(1)}</>}
                                {pickedTrend && <><br />The ground here: {pickedTrend}</>}
                            </Typography>
                        </Paper>
                    )}
                </Paper>
                {surfacesOpen && (
                    <SurfacePanel
                        height={fillHeight} here={sceneHere} blocked={surfaceBlocked} selectedCount={selectedIndices.length}
                        sceneColumns={scene.coords ? [scene.coords.x, scene.coords.y, scene.coords.z].map(d).join(', ') : null}
                        onNew={newSurface} onDraw={drawOnSlice} outlining={outlineFor !== null} onOutline={startOutline} onFromSelection={surfaceFromSelection} onUseSceneColumns={useSceneColumns} onZoomTo={zoomToWorld}
                        canSlice={slicing}
                        onClose={() => { setSurfacesOpen(false); containerRef.current?.focus({ preventScroll: true }); }}
                        contactBlocked={loggingProblem(viewCoords())} onContact={id => setContactFor(id ?? 'new')} onBody={() => setContactFor('new-body')} onShell={id => setShellFor(id ?? 'new')} onGround={groundFromCollars}
                        onReadings={() => setReadingsOpen(true)} trendOnSlice={trendOnSlice} onTrendOnSlice={setTrendOnSlice}
                    >
                        <WireframeSection dataBounds={worldBounds} onZoomTo={zoomToWorld} />
                    </SurfacePanel>
                )}
                <ContactDialog
                    open={contactFor !== null} coords={viewCoords()} surfaceId={contactFor === 'new' || contactFor === 'new-body' ? null : contactFor}
                    kind={contactFor === 'new-body' ? 'body' : 'contact'}
                    onClose={() => setContactFor(null)}
                />
                <StructureColumnsDialog open={readingsOpen} coords={viewCoords()} onClose={() => setReadingsOpen(false)} />
                <ShellDialog open={shellFor !== null} coords={viewCoords()} surfaceId={shellFor === 'new' ? null : shellFor} onClose={() => setShellFor(null)} />
                </Box>
            )}
        </Box>
    );
};

export default Viewer3D;
