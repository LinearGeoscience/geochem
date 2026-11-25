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
 *   with the project) drawn the same way. On the Modelling page the view is
 *   worked in from the tree and the properties; a plot only lists what of the
 *   model it shows (ShownObjectsPanel).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Badge, Box, Button, ButtonGroup, FormControlLabel, IconButton, ListItemIcon, Menu, MenuItem, Paper, Popover,
    Slider, Stack, SvgIcon, Switch, ToggleButton, ToggleButtonGroup, Tooltip, Typography, useTheme,
} from '@mui/material';
import {
    ThreeSixty, Gesture, CropFree, CenterFocusStrong, FilterCenterFocus, PhotoCamera, Clear, ArrowDropDown, ContentCut, ManageSearch, Layers, ViewInAr, Explore, Straighten, Timeline,
} from '@mui/icons-material';
import { useShallow } from 'zustand/react/shallow';
import { plotById, useAppStore } from '../../../store/appStore';
import { usePlotSetting } from '../../../hooks/usePlotSetting';
import { PlotControlBar, ControlSection, SettingChip } from '../../../components/plot_controls/PlotControlBar';
import { getColumnDisplayName } from '../../../utils/attributeUtils';
import { useViewerGeometry, useViewerStyles, useViewerFlags, useDrillholeSegments, useDrillholeIntervals, useDrillholeIndex, useViewHoleTraces } from './useViewerData';
import { holePath } from './holes';
import { HolePanel, HOLE_MARK_COLOR } from './HolePanel';
import { ThreeViewport, CameraState, ViewPreset, HoleMarker, MeshLayer, SliceFrame } from './ThreeViewport';
import { guessAxisColumn, guessFromColumn, guessToColumn, guessHoleColumn } from './coordinateColumns';
import { ClipState, isInsideClip, loosenClip, selectInPolygon, PointCloudGeometry, viewLine, viewLineText } from './geometry';
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
import { legendItemsOf } from '../../../utils/tooltipUtils';
import { loggingProblem, shellColumns } from '../../model/logging';
import { useModelViewHandle } from './useModelViewHandle';
import { isModelViewId, useModellingStore } from '../../../store/modellingStore';
import { nameUnderPointer, PICKABLE_LAYER, pickFromView, pickLogged, SOLID_LAYER } from '../../model/treePicks';
import { boundsOfKeys } from '../../model/sceneBounds';
import { sceneObjectKeys } from '../../model/viewVisibility';
import { keys as objectKeys } from '../../model/objectKeys';
import { plungeSamples } from '../../model/plungeClient';
import { loadSceneWireframes, useWireframeFiles } from '../../model/wireframeFiles';
import { ReadingEntry } from './ReadingEntry';
import { ShownObjectsPanel } from './ShownObjectsPanel';
import { useModelStore } from '../../../store/modelStore';
import { contactInputsFor, sceneTrendField, useModelCache } from '../../model/modelCache';
import { useGeoModelCache } from '../../model/geoModelCache';
import { addHandReading, groundFromCollars as groundFromCollarsIn, sameCoords, sceneInUse, startSurface, surfaceFromSelection as surfaceFromSelectionIn } from '../../model/sceneActions';
import { useModelBoxHandles } from './useModelBoxHandles';
import { useHandControls } from './useHandControls';
import { HandBar } from './HandBar';
import { useSurfaceEditing } from './useSurfaceEditing';
import { useStructureTool } from './useStructureTool';
import { unit } from '../../model/plane';
import { anglesText, handSetName } from '../../model/structureReadings';
import { formLines, trendAt, trendDip } from '../../model/trendField';
import { makePart } from './wireframeParsers';
import { simplifyLine } from '../../model/lines';
import { dataRay, pickMesh, rayPlane, type PickSlices, type Ray } from './picking';
import { xrayBand } from './pointShaders';
import { ViewLineChip } from './ViewLineChip';
import { PlungePanel } from './PlungePanel';
import { useSectionView } from './useSectionView';
import { ScaleBar, SectionBar, SectionPicker } from './SectionBar';
import { SectionsMenu } from './SectionsMenu';
import { UnitsMenu } from './UnitsMenu';
import { ViewsMenu } from './ViewsMenu';
import { cameraFromWorld, cameraToWorld, type SavedView } from '../../model/savedViews';
import { measure, measureText } from '../../model/ruler';
import { LoggingLegend } from './LoggingLegend';
import { SampleLegend } from './SampleLegend';
import { samplesReach, useViewSampleColours } from './useSampleColours';
import { useBelowSliceBar } from './useBelowSliceBar';
import { unitLegend } from './legendUnits';
import { UnitLegend } from './UnitLegend';
import { useLoggingLayers } from './useLoggingLayers';
import { useAttributeStore } from '../../../store/attributeStore';
import { useViewDisplay } from '../../../hooks/useViewDisplay';
import { useViewVisibility, ViewVisibilityContext } from '../../../hooks/useViewVisibility';
import { sceneLayers, wireframeLayers } from './sceneLayers';
import { t, termProps } from '../../model/terms';
// Drillhole planner (a plug-in module: planner/)
import { usePlanStore } from './planner/planStore';
import { usePlanner } from './planner/usePlans';
import { usePlannerLayer, usePointSetLayer } from './planner/plannerLayer';
import { PlannerPanel } from './planner/PlannerPanel';
import { PlannerSplit } from './planner/PlannerSplit';
import { PlannerSectionPane } from './planner/PlannerSectionPane';
import { usePlannerEditing } from './planner/usePlannerEditing';
import type { SliceLink } from './planner/planSlice';
import { sliceThrough } from '../../../utils/drillholePlanSlice';

/** A button that is an icon: as wide as the icon, not a text button's 64 px */
const ICON_BUTTON = { minWidth: 34, px: 0.75 } as const;

type Mode = 'orbit' | 'lasso' | 'box';
type Preset = ViewPreset;

type SavedCamera = CameraState;

/** Cylinder width slider: this many powers of ten either side of the starting width. */
const WIDTH_DECADES = 1.3;
const formatWidth = (w: number) => (w >= 10 ? String(Math.round(w)) : String(Number(w.toPrecision(2))));

/** How near its line on a slice a mesh drawn as that line is clicked (pixels) */
const LINE_REACH_PX = 6;

/** How long a hole stays lit along its length after it is found or zoomed to (ms). */
const HOLE_FLASH_MS = 2500;

/** Slice changes reach the saved plot settings this long after the last one (ms). */
const CLIP_SAVE_DELAY = 300;
/** How long the pointer rests on an object of the model before the view says what it is */
const REST_MS = 250;

/** No picks from the project tree (a plot of the Plots page) */
const NO_PICKS: string[] = [];

const CylinderIcon: React.FC = () => (
    <SvgIcon fontSize="small">
        <path d="M12 2C8.13 2 5 3.34 5 5v14c0 1.66 3.13 3 7 3s7-1.34 7-3V5c0-1.66-3.13-3-7-3zm0 2c3.2 0 4.8.78 5 1-.2.22-1.8 1-5 1s-4.8-.78-5-1c.2-.22 1.8-1 5-1zm5 15c-.2.22-1.8 1-5 1s-4.8-.78-5-1V7.2C8.3 7.7 10.05 8 12 8s3.7-.3 5-.8V19z" />
    </SvgIcon>
);


/** How long after the camera last moved it is kept in the view's settings (ms) */
const CAMERA_KEEP_MS = 400;

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
    // The camera as saved: read when the view is set up, not followed, so that a move of the camera renders nothing
    // again (Phase 301: a wheel step re-rendered the view, its bar, the tree and the Scene list)
    const savedCameraNow = useCallback(
        () => (plotById(useAppStore.getState(), plotId)?.settings?.camera3d as SavedCamera | null | undefined) ?? null,
        [plotId],
    );
    const setSavedCamera = useCallback((camera: SavedCamera) => useAppStore.getState().updatePlotSettings(plotId, { camera3d: camera }), [plotId]);
    const [mode, setMode] = useState<Mode>('orbit');
    /** A slice waiting for its line to be drawn or its hole to be clicked */
    const [placing, setPlacing] = useState<{ kind: 'line' | 'hole'; index: number } | null>(null);
    const [picked, setPicked] = useState<{ index: number; x: number; y: number } | null>(null);

    // --- data -------------------------------------------------------------
    const geometry = useViewerGeometry(xAxis, yAxis, zAxis);
    // (A view of the model may colour its samples by a column of its own, not the Attributes pane's colours)
    const samplesColoured = useViewSampleColours(plotId, useViewerStyles(rowCount), isModelViewId(plotId));
    const styles = samplesColoured.styles;
    const { flags, hasSelection } = useViewerFlags(styles.visible);
    const segments = useDrillholeSegments(geometry);

    // --- samples as cylinders (From-To intervals) ----------------------------
    // The holes' own paths, where the project has them and they are in this view's coordinates
    const holePaths = useViewHoleTraces(xAxis, yAxis, zAxis);
    const intervals = useDrillholeIntervals(geometry, holePaths);
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
    // What this view shows of the model (its own list; the panels inside it show and hide in it)
    const visibility = useViewVisibility(plotId);
    const hidden = visibility.hidden;
    // ... and what it draws its own way (solid, edges, an outline; whole on a slice)
    const display = useViewDisplay(plotId).display;
    // The samples can be hidden in the view like any object of the model (the traces through them are their own)
    const samplesShown = !hidden.has(objectKeys.dataset);
    // The logging tables the view is told to draw, down the holes
    const logging = useLoggingLayers(plotId, geometry, hidden, xAxis, yAxis, zAxis, intervals ? defaultCylinderWidth : null);
    const wireFiles = useWireframeFiles(s => s.byFile);
    // The wireframes' files are read from the project folder the first time a 3D view shows them
    useEffect(() => { loadSceneWireframes(); }, [scene.wireframes]);
    const wireframes = useMemo(() => wireframeLayers(scene.wireframes, wireFiles, hidden), [scene.wireframes, wireFiles, hidden]);
    const surfaceFits = useModelCache(s => s.byId);
    const suggestion = useModelStore(s => s.suggestion);
    const openSurfaceId = useModelStore(s => s.editingId);
    const [surfacesOpen, setSurfacesOpen] = usePlotSetting(plotId, 'surfacePanel3d', false);
    // A view of the Modelling page draws the model's sets and directions as its own list says, panel or no panel
    const modelView = isModelViewId(plotId);
    const modelling = surfacesOpen || modelView;
    // ... and draws lit what is picked in the project tree
    const treePicks = useModellingStore(s => (modelView ? s.selected : NO_PICKS));
    const pickedKeys = useMemo(() => new Set(treePicks), [treePicks]);
    // ... and marks the logging interval clicked in one of them
    const loggedPick = useModellingStore(s => (modelView ? s.loggedPick : null));
    // A section view of the model stays on a section (its set picked in the view)
    const [viewKind] = usePlotSetting<string>(plotId, 'viewKind', '3d');
    const sectionKind = modelView && viewKind === 'section';
    const [lastSectionSet, setLastSectionSet] = usePlotSetting<string | null>(plotId, 'sectionLast', null);
    const [plungeOpen, setPlungeOpen] = usePlotSetting(plotId, 'plungePanel3d', false);
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
    // (switched in the Modelling page's Structure properties)
    const [trendOnSlice] = usePlotSetting(plotId, 'trendLines3d', true);
    const sceneStructure = scene.structure;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the field is kept for the structure as it is now
    const trendField = useMemo(() => sceneTrendField(), [sceneStructure]);
    const trendLayers = useMemo((): MeshLayer[] => {
        const slice = savedSettings.slicing ? savedSettings.slices[savedSettings.active] : undefined;
        if (!trendField || !trendOnSlice || !modelling || !sceneHere || !geometry || !slice || !slice.on) return [];
        const { bounds: b, origin: o } = geometry;
        const lines = formLines(trendField, { normal: slice.normal, point: slice.center }, { min: [b.min[0] + o[0], b.min[1] + o[1], b.min[2] + o[2]], max: [b.max[0] + o[0], b.max[1] + o[1], b.max[2] + o[2]] });
        const layer = (id: string, ends: Float64Array, color: string): MeshLayer[] => (ends.length === 0 ? [] : [{
            id, part: makePart('The direction on the slice', ends, new Uint32Array(0), Uint32Array.from({ length: ends.length / 3 }, (_, i) => i)), color, opacity: 0, visible: true, showEdges: false,
        }]);
        return [...layer('trend:readings', lines.fromReadings, '#1a237e'), ...layer('trend:overall', lines.fromOverall, '#9fa8da')];
    }, [trendField, trendOnSlice, modelling, sceneHere, geometry, savedSettings]);

    const builtModels = useGeoModelCache(s => s.byId);
    const meshLayers = useMemo(() => sceneLayers({
        scene, wireframes, fits: surfaceFits, geometry: geometry ?? null, here: sceneHere, panelOpen: modelling,
        editingId: openSurfaceId, suggestion, trend: trendLayers, hidden, picked: pickedKeys, contactsOf: contactInputsFor, models: builtModels, display,
    }), [scene, wireframes, surfaceFits, geometry, sceneHere, modelling, openSurfaceId, suggestion, trendLayers, hidden, pickedKeys, builtModels, display]);

    /** The lithologies of the models drawn here, for the legend */
    const legendModels = useMemo(() => unitLegend(scene, meshLayers), [scene, meshLayers]);

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
            if (!samplesShown || !geometry || !geometry.valid[i] || !styles.visible[i]) return false;
            if (isolate && hasSelection && !selectedSet.has(i)) return false;
            const p = geometry.positions;
            return isInsideClip(p[i * 3], p[i * 3 + 1], p[i * 3 + 2], clip);
        };
    }, [samplesShown, geometry, styles.visible, isolate, hasSelection, selectedSet, currentClip]);

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
    /** Where the other views' sections are (see useSectionView) */
    const otherSections = useRef<SliceFrame[]>([]);
    // Clip box and slices: straight from the live value, on every change
    useEffect(() => {
        if (!viewportReady || !geometry) return;
        const push = () => {
            const vp = viewportRef.current;
            if (!vp) return;
            const now = liveClip.get();
            vp.setClip(clipStateOf(now, geometry.origin));
            vp.setSliceFrames([...sliceFramesOf(now, geometry.bounds, geometry.origin), ...otherSections.current]);
        };
        push();
        return liveClip.subscribe(push);
    }, [viewportReady, geometry, liveClip]);
    useEffect(() => {
        if (viewportReady) viewportRef.current!.setTraces(segments && showTraces ? segments : null, styles);
    }, [viewportReady, segments, showTraces, styles, geometry]);
    // After setGeometry (which drops the cylinders of the previous rows)
    useEffect(() => { if (viewportReady) viewportRef.current!.setIntervals(cylinders); }, [viewportReady, cylinders, geometry]);
    useEffect(() => { if (viewportReady) viewportRef.current!.setSamplesShown(samplesShown); }, [viewportReady, samplesShown]);
    useEffect(() => {
        if (!viewportReady) return;
        // A table beside the holes is clear of the samples' cylinders (of points: beside the line of them)
        const reach = cylinders && samplesShown ? samplesReach(styles, cylinderWidth, cylinderBySize) : 1e-6;
        viewportRef.current!.setLogging(logging.layers.map(l => ({ id: l.id, start: l.pieces.start, end: l.pieces.end, mid: l.pieces.mid, rgba: l.rgba, width: l.width, side: l.beside ? reach : 0 })));
    }, [viewportReady, logging, cylinders, samplesShown, cylinderWidth, cylinderBySize, styles]);
    // The logging interval clicked in a view of the model, marked in every view that draws its table
    useEffect(() => {
        if (!viewportReady) return;
        const layer = loggedPick ? logging.layers.find(l => l.id === loggedPick.table) : undefined;
        const pieces: number[] = [];
        if (layer && loggedPick) layer.pieces.row.forEach((r, k) => { if (r === loggedPick.row) pieces.push(k); });
        viewportRef.current!.markLogging(layer && pieces.length ? { id: layer.id, pieces } : null);
    }, [viewportReady, logging, loggedPick]);
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
    // High-grade emphasis: the highest value along each line of sight is drawn in front
    const xray = useAttributeStore(s => s.emphasis.enabled && s.emphasis.xray !== false);
    useEffect(() => { if (viewportReady) viewportRef.current!.setXray(xray); }, [viewportReady, xray]);
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

    /** The data and the objects of the model this view shows (local coordinates; null: none of them has a place yet) */
    const modelBounds = (g: PointCloudGeometry): { min: number[]; max: number[] } | null => {
        const meshes = new Set(scene.wireframes.map(w => objectKeys.wireframe(w.id)));
        // Surfaces and sets are drawn only in views of the scene's columns; meshes in every view
        const shown = sceneObjectKeys(scene).filter(k => !hidden.has(k) && (sceneHere || meshes.has(k)));
        const b = boundsOfKeys(shown);
        if (!b) return null;
        const o = g.origin;
        return {
            min: [0, 1, 2].map(k => Math.min(g.bounds.min[k], b.min[k] - o[k])),
            max: [0, 1, 2].map(k => Math.max(g.bounds.max[k], b.max[k] - o[k])),
        };
    };
    // Restore the saved camera (or fit) once per geometry. A view of the model opening frames the model: the data and every object it shows
    const restoredFor = useRef<PointCloudGeometry | null>(null);
    useEffect(() => {
        const vp = viewportRef.current;
        if (!viewportReady || !vp || !geometry || restoredFor.current === geometry) return;
        restoredFor.current = geometry;
        const savedCamera = savedCameraNow();
        if (savedCamera) { vp.setCameraState(savedCamera); return; }
        const model = modelView ? modelBounds(geometry) : null;
        if (model) vp.fitView('iso', model);
        else vp.fitView('iso');
        // eslint-disable-next-line react-hooks/exhaustive-deps -- once per geometry, with what the view shows then
    }, [viewportReady, geometry]);

    // Keep the camera once the user stops moving it: the wheel ends a move at every step, so it is kept a moment
    // after the last one (and at once when the view goes)
    useEffect(() => {
        const vp = viewportRef.current;
        if (!viewportReady || !vp) return;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const keep = () => { timer = null; setSavedCamera(vp.getCameraState()); };
        vp.onCameraChangeEnd = () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(keep, CAMERA_KEEP_MS);
        };
        return () => {
            vp.onCameraChangeEnd = null;
            if (timer) { clearTimeout(timer); keep(); }
        };
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
        // (Looking the way the view already looks: only where it looks, and how closely, change)
        viewportRef.current?.zoomTo({ min: b.min.map((v, k) => v - o[k]), max: b.max.map((v, k) => v - o[k]) });
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
            : sceneInUse(scene) && !sceneHere ? 'This view shows other coordinate columns than the ones the measurements are placed in.'
                : null;
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
        // (The surface shows in the Modelling page's properties)
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
    const surfaceFromSelection = () => {
        // Samples in one hole lie on a line: the surface then runs along the view direction
        const f = viewportRef.current?.viewDirection();
        return surfaceFromSelectionIn(viewCoords(), f ? unit([f[0], f[1], f[2] / vex]) : null);
    };
    const groundFromCollars = () => groundFromCollarsIn(viewCoords());
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

    // --- the line the view looks along, kept as a reading -----------------------------------
    const keepViewLine = (plunge: number, trend: number): string => {
        const vp = viewportRef.current;
        if (!vp || !geometry) return 'There is nothing in the view.';
        const f = vp.viewFocus(), o = geometry.origin;
        const id = addHandReading(viewCoords(), 'line', {
            p: [f[0] + o[0], f[1] + o[1], f[2] + o[2]],
            dip: Number(plunge.toFixed(1)), direction: Number(trend.toFixed(1)),
        });
        return id
            ? `Kept in "${handSetName('line')}", at the middle of the view: plunging ${Math.round(plunge)}° towards ${String(Math.round(trend) % 360).padStart(3, '0')}°.`
            : 'Not kept: the model is built on other coordinate columns, or has no room for another measurement.';
    };

    // --- the plunge finder ------------------------------------------------------------------
    const plungeColumn = useAttributeStore(s => s.emphasis.column ?? s.color.field);
    const plungeColumns = useMemo(() => (columns.length ? shellColumns({ x: xAxis, y: yAxis, z: zAxis, hole: holeColumn, from: null, to: null }) : []), [xAxis, yAxis, zAxis, holeColumn, columns]);
    const plungeBlocked = !zAxis ? 'It needs a Z (elevation) column in the view.' : !holeColumn ? 'It needs a hole ID column, to tell the holes apart.' : null;
    const gatherPlunge = (column: string, onlySelected: boolean) =>
        plungeSamples({ x: xAxis, y: yAxis, z: zAxis, hole: holeColumn, from: guessFromColumn(columns) }, column, onlySelected ? selectedIndices : null);

    // --- click to pick (orbit mode) ----------------------------------------------
    /** How the slices that are on bear on a click at a place on the canvas (see pickMesh) */
    const pickSlices = (vp: ThreeViewport, px: number, py: number, ray: Ray, clip: ClipState, o: ArrayLike<number>): PickSlices => {
        const planes = clip.slabs.map(s => ({ normal: s.normal, point: [s.center[0] + o[0], s.center[1] + o[1], s.center[2] + o[2]] }));
        const beside = dataRay(vp.screenRay(px + LINE_REACH_PX, py), vex, o);
        const boxOnly: ClipState = { ...clip, slabs: [] };
        const without: ClipState[] = clip.slabs.map((_, i) => ({ ...clip, slabs: clip.slabs.filter((__, j) => j !== i) }));
        return {
            planes,
            near: planes.map(plane => {
                const a = rayPlane(ray, plane), b = rayPlane(beside, plane);
                return a && b ? Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) : 0;
            }),
            shownBut: (p, but) => isInsideClip(p[0] - o[0], p[1] - o[1], p[2] - o[2], without[but] ?? boxOnly),
        };
    };
    /** The object of the model nearest the eye under a place on the canvas (its key), of those drawn and not cut away by the slices */
    const objectUnder = (px: number, py: number, behind: number = -1): string | null => {
        const vp = viewportRef.current;
        if (!vp || !geometry) return null;
        const o = geometry.origin;
        const clip = loosenClip(currentClip(), 0.05);
        const ray = dataRay(vp.screenRay(px, py), vex, o);
        const hit = pickMesh(
            ray,
            meshLayers.filter(l => PICKABLE_LAYER.test(l.id)),
            p => isInsideClip(p[0] - o[0], p[1] - o[1], p[2] - o[2], clip),
            SOLID_LAYER,
            pickSlices(vp, px, py, ray, clip, o),
        );
        if (!hit || behind < 0) return hit?.id ?? null;
        // Asked of a sample: the object only when it is drawn solid and the sample lies behind it (the sample is not seen)
        if (!((meshLayers.find(l => l.id === hit.id)?.opacity ?? 0) >= 0.99)) return null;
        const p = geometry.positions, d = ray.dir;
        const along = (q: ArrayLike<number>) => (q[0] - ray.origin[0]) * d[0] + (q[1] - ray.origin[1]) * d[1] + (q[2] - ray.origin[2]) * d[2];
        return along([p[behind * 3] + o[0], p[behind * 3 + 1] + o[1], p[behind * 3 + 2] + o[2]]) > along(hit.point) ? hit.id : null;
    };
    /** The logging interval under a place on the canvas, of those in view (null: none) */
    const loggedUnder = (px: number, py: number): { table: string; row: number } | null => {
        if (logging.layers.length === 0) return null;
        const clip = currentClip();
        const hit = viewportRef.current?.pickLogging(px, py, (id, k) => {
            const mid = logging.layers.find(l => l.id === id)?.pieces.mid;
            return !!mid && isInsideClip(mid[k * 3], mid[k * 3 + 1], mid[k * 3 + 2], clip);
        });
        const layer = hit ? logging.layers.find(l => l.id === hit.id) : undefined;
        return hit && layer ? { table: layer.id, row: layer.pieces.row[hit.piece] } : null;
    };
    /** The sample under a place on the canvas (-1: none): a cylinder first (anywhere along it); else the nearest point within reach */
    const sampleUnder = (px: number, py: number, screen: ArrayLike<number>): number => {
        if (!geometry) return -1;
        const isEligible = eligibility();
        let best = viewportRef.current?.pickCylinder(px, py, isEligible) ?? -1;
        // Highs in front: the click takes the highest of the points within reach, as drawn
        const ranks = viewportRef.current?.xrayRanks() ?? null;
        const reach = 10 * 10, pickPoint = best < 0;
        let bestD = reach, bestBand = -1;
        for (let i = 0; pickPoint && i < geometry.valid.length; i++) {
            if (cylinders?.has[i]) continue; // drawn as a cylinder, not a point
            const dx = screen[i * 2] - px, dy = screen[i * 2 + 1] - py;
            const d = dx * dx + dy * dy;
            if (!(d < reach)) continue;
            const band = ranks ? xrayBand(ranks[i * 2]) : 0;
            if (band < bestBand || (band === bestBand && d >= bestD)) continue;
            if (isEligible(i)) { bestD = d; bestBand = band; best = i; }
        }
        return best;
    };

    // --- the ruler: two clicks on anything drawn, and the line between them is measured ---
    const [rulerOn, setRulerOn] = useState(false);
    /** Its line: both ends, or the first with the second still to come (world) */
    const [ruler, setRuler] = useState<{ a: Vec3; b: Vec3 | null } | null>(null);
    /** Where the second end would go if the pointer were clicked now */
    const [rulerTo, setRulerTo] = useState<Vec3 | null>(null);
    const [rulerMissed, setRulerMissed] = useState(false);
    const rulerFrame = useRef<number | null>(null);
    useEffect(() => () => { if (rulerFrame.current !== null) cancelAnimationFrame(rulerFrame.current); }, []);
    /** The place nearest the eye under a place on the canvas: on a sample, a surface, a mesh or a solid in view (world; null: nothing there) */
    const placeUnder = (px: number, py: number): Vec3 | null => {
        const vp = viewportRef.current, screen = screenPositions();
        if (!vp || !geometry) return null;
        const o = geometry.origin;
        const clip = loosenClip(currentClip(), 0.05);
        const ray = dataRay(vp.screenRay(px, py), vex, o);
        const d = ray.dir;
        const along = (q: ArrayLike<number>) => (q[0] - ray.origin[0]) * d[0] + (q[1] - ray.origin[1]) * d[1] + (q[2] - ray.origin[2]) * d[2];
        const hit = pickMesh(ray, meshLayers, p => isInsideClip(p[0] - o[0], p[1] - o[1], p[2] - o[2], clip), SOLID_LAYER, pickSlices(vp, px, py, ray, clip, o));
        const sample = screen ? sampleUnder(px, py, screen) : -1;
        const p = geometry.positions;
        const at: Vec3 | null = sample >= 0 ? [p[sample * 3] + o[0], p[sample * 3 + 1] + o[1], p[sample * 3 + 2] + o[2]] : null;
        if (hit && at) return along(at) <= along(hit.point) ? at : [hit.point[0], hit.point[1], hit.point[2]];
        return at ?? (hit ? [hit.point[0], hit.point[1], hit.point[2]] : null);
    };
    const endRuler = () => {
        setRulerOn(false);
        setRulerTo(null);
        setRulerMissed(false);
        // (A line with one end is no line)
        setRuler(r => (r && !r.b ? null : r));
    };
    const clearRuler = () => { setRuler(null); setRulerTo(null); setRulerMissed(false); };
    useEffect(() => {
        const vp = viewportRef.current;
        if (!viewportReady || !vp) return;
        const o = geometry?.origin, end = ruler?.b ?? rulerTo;
        const local = (q: Vec3) => [q[0] - o![0], q[1] - o![1], q[2] - o![2]];
        vp.setRuler(ruler && o ? [...local(ruler.a), ...(end ? local(end) : [])] : null);
    }, [viewportReady, geometry, ruler, rulerTo]);

    // --- what is under the pointer, said when it rests (a view of the model, while it is only looked at) ---
    const [under, setUnder] = useState<{ text: string; x: number; y: number } | null>(null);
    const restTimer = useRef<number | null>(null);
    const forgetUnder = () => {
        if (restTimer.current !== null) { window.clearTimeout(restTimer.current); restTimer.current = null; }
        setUnder(u => (u ? null : u));
    };
    useEffect(() => () => { if (restTimer.current !== null) window.clearTimeout(restTimer.current); }, []);
    const onCanvasMove = (e: React.PointerEvent) => {
        forgetUnder();
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const px = e.clientX - rect.left, py = e.clientY - rect.top;
        if (rulerOn && !editing.picking && !structuring && !placing) {
            // The line follows the pointer to what is under it, once a frame, until its second end is clicked
            if (!ruler || ruler.b || e.buttons !== 0) return;
            if (rulerFrame.current !== null) cancelAnimationFrame(rulerFrame.current);
            rulerFrame.current = requestAnimationFrame(() => { rulerFrame.current = null; setRulerTo(placeUnder(px, py)); });
            return;
        }
        if (!modelView || e.buttons !== 0 || editing.picking || structuring || placing) return;
        restTimer.current = window.setTimeout(() => {
            restTimer.current = null;
            const screen = screenPositions();
            // (A click there would take the logging or the sample: those say what they are when clicked)
            if (!screen || loggedUnder(px, py)) return;
            const sample = sampleUnder(px, py, screen);
            const key = sample >= 0 ? objectUnder(px, py, sample) : objectUnder(px, py);
            const text = key ? nameUnderPointer(key) : null;
            if (text) setUnder({ text, x: px, y: py });
        }, REST_MS);
    };

    const clickStart = useRef<{ x: number; y: number } | null>(null);
    const onCanvasDown = (e: React.PointerEvent) => { forgetUnder(); clickStart.current = { x: e.clientX, y: e.clientY }; };
    const onCanvasUp = (e: React.PointerEvent) => {
        const s = clickStart.current;
        clickStart.current = null;
        // Placing a surface's points, or the model's readings: the click belongs to that (useSurfaceEditing, useStructureTool)
        if (editing.picking || structuring) return;
        if (!s || Math.hypot(e.clientX - s.x, e.clientY - s.y) > 4 || !geometry) return;
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const px = e.clientX - rect.left, py = e.clientY - rect.top;
        if (rulerOn && !placing) {
            // The ruler takes the click: its first end, its second, or the first of a new line
            if (rulerFrame.current !== null) { cancelAnimationFrame(rulerFrame.current); rulerFrame.current = null; }
            const at = placeUnder(px, py);
            setRulerMissed(!at);
            if (!at) return;
            setRulerTo(null);
            setRuler(r => (!r || r.b ? { a: at, b: null } : { a: r.a, b: at }));
            return;
        }
        const screen = screenPositions();
        if (!screen) return;
        // In a view of the model, a logging interval under the cursor is picked: its table in the tree, the
        // interval in the properties (Shift and Ctrl still take samples)
        if (modelView && !placing && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
            const logged = loggedUnder(px, py);
            if (logged) {
                setPicked(null);
                pickLogged(logged.table, logged.row);
                return;
            }
            if (useModellingStore.getState().loggedPick) useModellingStore.getState().setLoggedPick(null);
        }
        let best = sampleUnder(px, py, screen);
        // In a view of the model, a sample out of sight behind a solid of the model is not what was clicked: the solid is
        if (best >= 0 && modelView && !placing && objectUnder(px, py, best)) best = -1;
        if (placing?.kind === 'hole') {
            // A miss keeps waiting for a hole
            if (best >= 0) { setPlacing(null); sliceThroughHole(placing.index, best); }
            return;
        }
        if (best < 0) {
            setPicked(null);
            // No sample there: in a view of the model, the object clicked is picked in the project tree (Ctrl: added to the picks)
            const key = modelView ? objectUnder(px, py) : null;
            if (key) pickFromView(key, e.ctrlKey || e.metaKey);
            return;
        }
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
                if (!hole) return null;
                const trace = holePaths.get(hole.id);
                const path = holePath(hole, geometry.positions, intervals, trace ? { trace, origin: geometry.origin } : null);
                return { path, label: hole.id, color: HOLE_MARK_COLOR };
            };
            const tagged = marker(foundHole);
            if (tagged) markers.push({ ...tagged, line: flashHole?.id === foundHole || previewHole === foundHole, onDismiss: () => untagHole.current() });
            const pointed = previewHole !== foundHole ? marker(previewHole) : null;
            if (pointed) markers.push({ ...pointed, line: true, faint: true });
        }
        vp.setHoleMarkers(markers);
    }, [viewportReady, geometry, intervals, holePaths, holeById, foundHole, previewHole, flashHole, holesOpen]);

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
    // The legends start under the slice bar while there is one
    const legendTop = useBelowSliceBar(containerRef, !!(slicing && geometry));
    // --- section view: square-on to one plane of a section set, stepping through the set ---
    const section = useSectionView({
        plotId, viewport: viewportReady && geometry ? viewportRef.current : null, geometry: geometry ?? null, liveClip, updateClip,
        lookAtSlice: i => lookAtSlice(i), containerRef, gridColor: theme.palette.text.secondary,
    });
    // --- named views: this way of looking, kept with the scene and gone back to from any 3D view ---
    const lookNow = (): Omit<SavedView, 'id' | 'name'> | null => {
        const vp = viewportRef.current;
        if (!vp || !geometry) return null;
        flushClip();
        return { camera: cameraToWorld(vp.getCameraState(), geometry.origin, vex, vp.screenMatrix().height), vex, clip: { ...liveClip.get() } };
    };
    const keepView = (name: string) => {
        const look = lookNow(), vp = viewportRef.current;
        if (!look || !vp) return;
        const line = viewLine(vp.viewDirection(), vex);
        useModelStore.getState().addView({ ...look, name: name.trim() || (line ? viewLineText(line) : 'View') });
    };
    const replaceView = (id: string) => {
        const look = lookNow();
        if (look) useModelStore.getState().updateView(id, look);
    };
    const goingTo = useRef<SavedView | null>(null);
    const [goTick, setGoTick] = useState(0);
    const goToView = (id: string) => {
        const view = useModelStore.getState().scene.views?.find(v => v.id === id);
        if (!view || !geometry) return;
        if (section.view) section.exit();
        setVex(view.vex);
        setOrtho(view.camera.ortho);
        updateClip(() => readClipSettings(view.clip ?? null, geometry.origin));
        flushClip();
        goingTo.current = view;
        setGoTick(n => n + 1);
    };
    // (Once the exaggeration and the projection asked for have reached the viewport: their effects are above this one)
    useEffect(() => {
        const view = goingTo.current, vp = viewportRef.current;
        if (!view || !vp || !geometry) return;
        goingTo.current = null;
        vp.setCameraState(cameraFromWorld(view.camera, geometry.origin, vex, vp.screenMatrix().height));
        setSavedCamera(vp.getCameraState());
        // eslint-disable-next-line react-hooks/exhaustive-deps -- when a view is gone to, with the viewport as it is then
    }, [goTick]);

    // A section view of the model: on opening it looks along its set (the one it was last on, else the first),
    // unless it comes back on its plane as it was left; it keeps the set it is on for next time
    const sectionSetId = section.view?.set.id ?? null;
    useEffect(() => { if (sectionKind && sectionSetId && sectionSetId !== lastSectionSet) setLastSectionSet(sectionSetId); }, [sectionKind, sectionSetId, lastSectionSet, setLastSectionSet]);
    const sectionOpened = useRef(false);
    const enterSection = section.enter;
    useEffect(() => {
        if (!sectionKind || sectionOpened.current || !viewportReady || !geometry) return;
        sectionOpened.current = true;
        if (sectionSetId) return;
        const sets = useModelStore.getState().scene.sectionSets ?? [];
        const set = sets.find(s => s.id === lastSectionSet) ?? sets[0];
        if (set) enterSection(set.id);
    }, [sectionKind, viewportReady, geometry, sectionSetId, lastSectionSet, enterSection]);
    useEffect(() => {
        otherSections.current = section.otherFrames;
        const vp = viewportRef.current;
        if (viewportReady && vp && geometry) vp.setSliceFrames([...sliceFramesOf(liveClip.get(), geometry.bounds, geometry.origin), ...section.otherFrames]);
    }, [section.otherFrames, viewportReady, geometry, liveClip]);
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
            if (e.key === 'Escape') { setPlacing(null); setOutlineFor(null); setRulerOn(false); setRulerTo(null); setRulerMissed(false); setRuler(r => (r && !r.b ? null : r)); return; }
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
        containerRef, viewportRef, ready: viewportReady, geometry, intervals, vex, eligibility, hidden,
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
    const editing = useSurfaceEditing({ ...placement, liveClip, active: sceneHere && mode === 'orbit' && !placing });
    // --- a geological model picked: its box changed by the handles on its faces ---
    useModelBoxHandles({ containerRef, viewportRef, ready: viewportReady, geometry, vex, active: sceneHere && mode === 'orbit' && !placing });
    // --- the places and links put on a surface by hand: drawn, pointed at and picked ---
    useHandControls({ ...placement, liveClip, active: sceneHere && mode === 'orbit' && !placing });
    // --- setting the model's structure by hand: readings placed by clicking, strokes drawn on the slice ---
    const structuring = useStructureTool({
        ...placement, active: !!zAxis && (sceneHere || !sceneInUse(scene)) && mode === 'orbit' && !placing,
        coords: () => ({ x: xAxis, y: yAxis, z: zAxis, hole: holeColumn, from: guessFromColumn(columns), to: guessToColumn(columns) }),
    });
    const structureTool = useModelStore(s => s.structureTool);
    // Placing points is done with the camera tool: it takes over from the lasso, a waiting slice and the sample tooltip
    const wantsPicking = useModelStore(s => s.picking || s.structureTool !== null);
    // What clicks do while places are marked for a surface made from logging, and not points placed (null: points)
    const marking = useModelStore(s => s.marking);
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
    // On a model view the selection's three buttons are one, with a menu (Phase 300: the bar in two rows)
    const [selectionMenu, setSelectionMenu] = useState<HTMLElement | null>(null);
    const box = clipOutline; // the clip box: `boxEnabled`, `box` (world coordinates)

    // --- drillhole planner (planner/): holes planned on the active slice; its panel, the slice in 2D, its layer and drags in 3D ---
    const [plannerOpen, setPlannerOpen] = usePlotSetting(plotId, 'plannerPanel3d', false);
    const plannedCount = usePlanStore(s => s.holes.length);
    const planner = usePlanner(viewCoords(), worldBounds, plannerOpen || plannedCount > 0);
    const planner2d = usePlanStore(s => s.view2d.on) && plannerOpen;
    const sliceLink = useMemo((): SliceLink => ({
        clip: liveClip,
        // The active slice moves along its normal through a point (a typed target, Slice through target)
        moveThrough: p => updateClip(prev => {
            const s = prev.slicing ? prev.slices[prev.active] : undefined;
            if (!s) return prev;
            const center = sliceThrough({ normal: s.normal, point: s.center }, p);
            return { ...prev, slices: prev.slices.map((x, i) => (i === prev.active ? { ...x, on: true, center } : x)) };
        }),
        turnOn: () => {
            if (!liveClip.get().slicing) sliceActions.current.toggleSlicing();
            else updateClip(prev => ({ ...prev, slices: prev.slices.map((x, i) => (i === prev.active ? { ...x, on: true } : x)) }));
        },
        // The selected hole's upright plane (collar to target), through its target
        alignTo: (p, azimuth) => updateClip(prev => {
            const cur = prev.slices[prev.active];
            const a = azimuth === null ? 0 : (azimuth * Math.PI) / 180;
            const normal = (azimuth === null ? cur?.normal : canonicalNormal([Math.cos(a), -Math.sin(a), 0])) ?? [0, 1, 0];
            const b = geometry?.bounds;
            const width = cur?.width ?? (b ? defaultSliceWidth(Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2])) : 50);
            const slice: Slice = { on: true, normal, center: [p[0], p[1], p[2]], width, step: cur?.step ?? null };
            return prev.slices.length === 0
                ? { ...prev, slicing: true, active: 0, slices: [slice] }
                : { ...prev, slicing: true, slices: prev.slices.map((x, i) => (i === prev.active ? slice : x)) };
        }),
    }), [liveClip, updateClip, geometry]);
    usePlannerLayer(viewportRef, viewportReady, geometry?.origin ?? null, planner, sliceLink);
    usePointSetLayer(viewportRef, viewportReady, geometry?.origin ?? null);
    usePlannerEditing({
        containerRef, viewportRef, ready: viewportReady, origin: geometry?.origin ?? null, vex, link: sliceLink, planner,
        // Only while no other tool has the mouse
        active: plannerOpen && mode === 'orbit' && !placing && !drawingLine && !outlineFor && !editing.picking && !structuring,
    });
    /** How the ground lies at the sample pointed out, by the model's direction from place to place */
    const pickedTrend = picked !== null && trendField && sceneHere && geometry && zAxis ? (() => {
        const o = geometry.origin, k = picked.index * 3;
        const local = trendAt(trendField, [geometry.positions[k] + o[0], geometry.positions[k + 1] + o[1], geometry.positions[k + 2] + o[2]]);
        const lie = trendDip(local);
        return lie ? `${anglesText('plane', lie)}${local.fromReadings >= 0.5 ? ' (from measurements)' : trendField.planes > 0 ? ' (mostly the model\'s one direction)' : ''}` : null;
    })() : null;
    const pickedId = picked !== null ? (() => {
        const idCol = columns.find(col => col.role === 'ID')?.name ?? columns.find(col => col.role === 'HoleID')?.name;
        const col = idCol ? useAppStore.getState().getRawColumn(idCol) : undefined;
        return col ? String(col[picked.index] ?? '') : `Row ${picked.index + 1}`;
    })() : '';

    // The legend items (Attribute Manager classes) the clicked sample is in
    const pickedLegend = picked !== null ? legendItemsOf(picked.index) : [];

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

    // This view in the view registry: the Modelling page's tree and properties place, draw and frame things in it
    useModelViewHandle({
        plotId, ready: viewportReady && !!geometry, viewingSet: section.view?.set.id ?? null,
        here: sceneHere, blocked: surfaceBlocked, contactBlocked: loggingProblem(viewCoords()), canSlice: slicing,
        outlining: outlineFor !== null, vex, selectedCount: selectedIndices.length,
        sceneColumns: scene.coords ? [scene.coords.x, scene.coords.y, scene.coords.z].map(d).join(', ') : null,
        canCylinder: !!intervals, cylinderAuto: defaultCylinderWidth, hasTraces: !!segments,
    }, {
        viewport: () => (viewportReady ? viewportRef.current : null),
        coords: viewCoords, newSurface, drawOnSlice, startOutline, useSceneColumns, surfaceFromSelection, groundFromCollars, zoomToWorld,
        dataBounds: () => worldBounds,
        lookAlong: id => section.enter(id),
        newSectionSet: from => section.create(from),
        focus: () => containerRef.current?.focus({ preventScroll: true }),
    });

    const rulerEnd = ruler?.b ?? rulerTo;
    const rulerMeasure = ruler && rulerEnd ? measure(ruler.a, rulerEnd) : null;
    const rulerText = rulerMeasure ? `${measureText(rulerMeasure)}${ruler?.b ? '' : ' · click to place the other end'}`
        : rulerMissed ? 'Nothing there to measure to: click on a drillhole, a surface, a mesh or a solid.'
            : ruler ? 'Now the other end: click a second place.'
                : 'Ruler: click two places on drillholes, surfaces or solids.';

    const axisSelect = (label: string, value: string, set: (v: string) => void, allowNone = false) => (
        <ColumnPicker label={label} value={value} onChange={set} allowNone={allowNone} noneLabel="None (flat)" minWidth={140} />
    );

    const axisSelects = <>
        {axisSelect('X (East)', xAxis, setXAxis)}
        {axisSelect('Y (North)', yAxis, setYAxis)}
        {axisSelect('Z (Elevation)', zAxis, setZAxis, true)}
    </>;
    const axesAway = modelView && !!xAxis && !!yAxis;

    return (
        <ViewVisibilityContext.Provider value={visibility}>
        <Box sx={{ p: 1 }}>
            <PlotControlBar
                dense={modelView}
                primary={<>
                    {/* (A model view is placed by the project's coordinates: once they are set, the choosers are in its settings, out of the bar) */}
                    {!axesAway && axisSelects}
                    <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_, v) => { if (v) { setMode(v); setPlacing(null); setOutlineFor(null); if (v !== 'orbit') useModelStore.getState().setPicking(false); } }}>
                        <ToggleButton value="orbit" aria-label="Rotate, pan and zoom"><Tooltip title="Rotate / pan / zoom (click a point to inspect; Shift-click adds, Ctrl-click removes)"><ThreeSixty fontSize="small" /></Tooltip></ToggleButton>
                        <ToggleButton value="lasso" aria-label="Lasso select"><Tooltip title="Lasso select (Shift adds, Ctrl removes)"><Gesture fontSize="small" /></Tooltip></ToggleButton>
                        <ToggleButton value="box" aria-label="Box select"><Tooltip title="Box select (Shift adds, Ctrl removes)"><CropFree fontSize="small" /></Tooltip></ToggleButton>
                    </ToggleButtonGroup>
                    {intervals && (
                        <ToggleButtonGroup size="small">
                            <ToggleButton value="cylinders" selected={cylindersOn} onChange={() => setCylindersOn(!cylindersOn)} sx={{ textTransform: 'none', gap: 0.5 }} {...(modelView ? { 'aria-label': 'Cylinders' } : {})}>
                                {/* (On a model view the bar has two rows: the icon alone, its name kept) */}
                                <Tooltip title="Draw samples as cylinders (From–To)"><Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}><CylinderIcon />{!modelView && 'Cylinders'}</Box></Tooltip>
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
                    <ViewLineChip viewport={viewportReady && geometry ? viewportRef.current : null} vex={vex} ortho={ortho} onOrtho={setOrtho} onKeep={keepViewLine} short={modelView} />
                    {/* (A section view looks along its set: it has no way of looking of its own to keep) */}
                    {!sectionKind && <ViewsMenu disabled={!geometry} onSave={keepView} onGo={goToView} onReplace={replaceView} />}
                    <ToggleButton size="small" value="plunge" selected={plungeOpen} disabled={!geometry} onChange={() => setPlungeOpen(!plungeOpen)} sx={{ textTransform: 'none', gap: 0.5 }}>
                        <Tooltip title="Plunge finder: the direction the highs line up along, on a stereonet"><Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}><Explore fontSize="small" />Plunge</Box></Tooltip>
                    </ToggleButton>
                    <ToggleButton size="small" value="slice" selected={slicing} disabled={!geometry} onChange={toggleSlicing} sx={{ textTransform: 'none', gap: 0.5 }}>
                        <Tooltip title="Slice the data: sections, level plans, or two crossing slices"><Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}><ContentCut fontSize="small" />Slice</Box></Tooltip>
                    </ToggleButton>
                    <SectionsMenu
                        disabled={!geometry} viewing={section.view?.set.id ?? null} canFromSlice={slicing}
                        onView={id => section.enter(id)} onCreate={from => section.create(from)}
                    />
                    <UnitsMenu disabled={!geometry} coords={viewCoords()} selected={selectedIndices} />
                    <ToggleButton
                        size="small" value="ruler" data-action="ruler" selected={rulerOn} disabled={!geometry || editing.picking || !!structuring}
                        onChange={() => { if (rulerOn) endRuler(); else { setMode('orbit'); setPlacing(null); setOutlineFor(null); setPicked(null); setRulerOn(true); } }}
                        sx={{ textTransform: 'none', gap: 0.5 }}
                    >
                        <Tooltip title="Ruler: click two places on drillholes, surfaces or solids to measure between them ( Esc ends it )">
                            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}><Straighten fontSize="small" />Ruler</Box>
                        </Tooltip>
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
                    {/* The Modelling page's views show the model by its tree */}
                    {!modelView && (
                        <ToggleButton size="small" value="surfaces" selected={surfacesOpen} disabled={!geometry} onChange={() => setSurfacesOpen(!surfacesOpen)} sx={{ textTransform: 'none', gap: 0.5 }}>
                            <Tooltip title="The surfaces, points, lines, measurements and meshes shown in this view (they are made on the Modelling page)">
                                <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}><Layers fontSize="small" />Model{scene.surfaces.length > 0 ? ` (${scene.surfaces.length})` : ''}</Box>
                            </Tooltip>
                        </ToggleButton>
                    )}
                    <ToggleButton size="small" value="planner" selected={plannerOpen} disabled={!geometry} onChange={() => setPlannerOpen(!plannerOpen)} sx={{ textTransform: 'none', gap: 0.5 }}>
                        <Tooltip title="Drillhole planner: plan holes on the 3D slice (by collar, target to surface, or collar to target)">
                            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}><Timeline fontSize="small" />Drillhole planner{plannedCount > 0 ? ` (${plannedCount})` : ''}</Box>
                        </Tooltip>
                    </ToggleButton>
                    {modelView ? (
                        <Tooltip title="The selection: zoom to it, show only it, clear it">
                            <span>
                                <Button
                                    size="small" aria-label="Selection" aria-haspopup="menu" data-action="selection-menu" disabled={!hasSelection && !isolate}
                                    variant={isolate ? 'contained' : 'text'} onClick={e => setSelectionMenu(e.currentTarget)} sx={ICON_BUTTON}
                                >
                                    <CenterFocusStrong fontSize="small" />
                                </Button>
                            </span>
                        </Tooltip>
                    ) : (
                        <>
                            <Tooltip title="Zoom to selection"><span><Button size="small" aria-label="Zoom to selection" disabled={!hasSelection} onClick={zoomToSelection} sx={ICON_BUTTON}><CenterFocusStrong fontSize="small" /></Button></span></Tooltip>
                            <Tooltip title="Show only the selection"><span><Button size="small" aria-label="Show only the selection" aria-pressed={isolate} variant={isolate ? 'contained' : 'text'} disabled={!hasSelection} onClick={() => setIsolate(!isolate)} sx={ICON_BUTTON}><FilterCenterFocus fontSize="small" /></Button></span></Tooltip>
                            <Tooltip title="Clear selection"><span><Button size="small" aria-label="Clear selection" disabled={!hasSelection} onClick={() => setSelection([])} sx={ICON_BUTTON}><Clear fontSize="small" /></Button></span></Tooltip>
                        </>
                    )}
                    <Tooltip title="Save PNG"><Button size="small" aria-label="Save PNG" onClick={screenshot} sx={ICON_BUTTON}><PhotoCamera fontSize="small" /></Button></Tooltip>
                    {!modelView && (
                        <Tooltip title={`${t('meshesPanel')} (Leapfrog .msh, DXF, OBJ, STL, GOCAD .ts)`}>
                            <span>
                                <Button size="small" disabled={!geometry} {...termProps('meshesPanel')} onClick={showWireframes} sx={ICON_BUTTON}>
                                    <Badge badgeContent={scene.wireframes.length} color="primary" max={99} invisible={scene.wireframes.length === 0}>
                                        <ViewInAr fontSize="small" />
                                    </Badge>
                                </Button>
                            </span>
                        </Tooltip>
                    )}
                </>}
                settingsActive={box.boxEnabled || vex !== 1 || ortho || satellite}
                summary={<>
                    {satellite && <SettingChip label="Satellite" onDelete={() => setSatellite(false)} />}
                    {box.boxEnabled && <SettingChip label="Clip box" onDelete={() => updateClip({ boxEnabled: false })} />}
                    {vex !== 1 && <SettingChip label={`VE ×${vex}`} onDelete={() => setVex(1)} />}
                    {isolate && hasSelection && <SettingChip label="Selection only" onDelete={() => setIsolate(false)} />}
                </>}
                settings={<>
                    {axesAway && <ControlSection label="Coordinates"><Box data-testid="view-axes" sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>{axisSelects}</Box></ControlSection>}
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

            <Menu open={!!selectionMenu} anchorEl={selectionMenu} onClose={() => setSelectionMenu(null)}>
                <MenuItem disabled={!hasSelection} onClick={() => { setSelectionMenu(null); zoomToSelection(); }}>
                    <ListItemIcon><CenterFocusStrong fontSize="small" /></ListItemIcon>Zoom to selection
                </MenuItem>
                <MenuItem disabled={!hasSelection && !isolate} selected={isolate} aria-checked={isolate} role="menuitemcheckbox" onClick={() => { setSelectionMenu(null); setIsolate(!isolate); }}>
                    <ListItemIcon><FilterCenterFocus fontSize="small" /></ListItemIcon>Show only the selection
                </MenuItem>
                <MenuItem disabled={!hasSelection} onClick={() => { setSelectionMenu(null); setSelection([]); }}>
                    <ListItemIcon><Clear fontSize="small" /></ListItemIcon>Clear selection
                </MenuItem>
            </Menu>
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
                <Typography color="text.secondary" data-testid="view-empty">
                    {columns.length === 0
                        ? 'Nothing has been imported yet. Import the drillholes (Data Import) and they are drawn here.'
                        : 'Select numeric X and Y columns (and optionally Z) to view in 3D. Loaded meshes are drawn with the data.'}
                </Typography>
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
                <PlannerSplit right={planner2d ? <PlannerSectionPane planner={planner} height={fillHeight} link={sliceLink} /> : null}>
                <Paper ref={containerRef} tabIndex={0} sx={{ position: 'relative', flex: 1, minWidth: 0, height: fillHeight, overflow: 'hidden', outline: 'none' }}>
                    <Box ref={viewportEl} sx={{ position: 'absolute', inset: 0, cursor: placing?.kind === 'hole' ? 'crosshair' : undefined }} onPointerDown={onCanvasDown} onPointerUp={onCanvasUp} onPointerMove={onCanvasMove} onPointerLeave={forgetUnder} />
                    {editing.picking && <ReadingEntry />}
                    {(rulerOn || ruler) && (
                        <Paper elevation={3} data-testid="ruler-said" sx={{ position: 'absolute', left: 8, top: 8, zIndex: 4, pl: 1, pr: 0.5, py: 0.25, display: 'flex', alignItems: 'center', gap: 0.75, maxWidth: 'calc(100% - 16px)' }}>
                            <Straighten fontSize="small" color="action" />
                            <Typography variant="body2">{rulerText}</Typography>
                            {ruler && (
                                <Tooltip title="Clear the ruler's line">
                                    <IconButton size="small" data-action="ruler-clear" aria-label="Clear the ruler's line" onClick={clearRuler}><Clear fontSize="small" /></IconButton>
                                </Tooltip>
                            )}
                        </Paper>
                    )}
                    {under && (
                        <Paper elevation={3} data-testid="under-pointer" sx={{ position: 'absolute', left: under.x + 14, top: under.y + 18, zIndex: 5, pointerEvents: 'none', px: 0.75, py: 0.25, maxWidth: 340 }}>
                            <Typography variant="caption" noWrap sx={{ display: 'block' }}>{under.text}</Typography>
                        </Paper>
                    )}

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

                    {section.view && (
                        <SectionBar
                            view={section.view} onStep={section.step}
                            // A section view of the model stays on sections: it changes set in place of going back to 3D
                            onExit={sectionKind ? undefined : section.exit}
                            onSet={sectionKind ? id => section.enter(id) : undefined}
                        />
                    )}
                    {sectionKind && !section.view && viewportReady && (
                        <SectionPicker onLook={id => section.enter(id)} onNew={from => section.create(from)} canSlice={slicing} />
                    )}
                    {section.view && <ScaleBar viewport={viewportReady ? viewportRef.current : null} vex={vex} />}
                    <Box sx={{ position: 'absolute', top: legendTop, right: 8, zIndex: 4, maxHeight: `calc(100% - ${legendTop + 40}px)`, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.75, pointerEvents: 'none', '& > *': { pointerEvents: 'auto' } }}>
                        {samplesColoured.legend && samplesShown && <SampleLegend legend={samplesColoured.legend} />}
                        <LoggingLegend layers={logging.layers} problem={logging.problem} />
                        {modelView && <UnitLegend models={legendModels} onShow={(key, shown) => visibility.setShown([key], shown)} />}
                    </Box>

                    {sceneHere && <HandBar />}
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
                                : marking === 'take' ? ' · Click a stretch of its units down a hole to give it to this vein (Esc when done)'
                                    : marking === 'link' ? ` · Click ${intervals ? 'a drillhole' : 'a sample'}${slicing ? ' or the slice' : ''} where a link starts, then where it ends (Esc when done)`
                                    : marking === 'hole' ? ' · Click a drillhole the surface is to keep clear of, Shift+click for its other side (Esc when done)'
                                    : marking === 'contact' ? ' · Drag a contact along its hole; Delete leaves the one pointed at out (Esc when done)'
                                    : marking ? ` · Click ${intervals ? 'a drillhole' : 'a sample'}${slicing ? ' or the slice' : ''} to mark a place on that side of the surface (Esc when done)`
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
                                {pickedLegend.map(it => <React.Fragment key={it.label}><b>{it.label}:</b> {it.name}<br /></React.Fragment>)}
                                {d(xAxis)}: {(geometry.positions[picked.index * 3] + geometry.origin[0]).toFixed(1)}<br />
                                {d(yAxis)}: {(geometry.positions[picked.index * 3 + 1] + geometry.origin[1]).toFixed(1)}
                                {zAxis && <><br />{d(zAxis)}: {(geometry.positions[picked.index * 3 + 2] + geometry.origin[2]).toFixed(1)}</>}
                                {pickedTrend && <><br />The ground here: {pickedTrend}</>}
                            </Typography>
                        </Paper>
                    )}
                </Paper>
                </PlannerSplit>
                {surfacesOpen && !modelView && (
                    <ShownObjectsPanel
                        height={fillHeight} visibility={visibility} here={sceneHere}
                        sceneColumns={scene.coords ? [scene.coords.x, scene.coords.y, scene.coords.z].map(d).join(', ') : null} onUseSceneColumns={useSceneColumns}
                        onClose={() => { setSurfacesOpen(false); containerRef.current?.focus({ preventScroll: true }); }}
                    >
                        <WireframeSection dataBounds={worldBounds} onZoomTo={zoomToWorld} />
                    </ShownObjectsPanel>
                )}
                {plungeOpen && (
                    <PlungePanel
                        height={fillHeight} viewport={viewportReady ? viewportRef.current : null} vex={vex}
                        columns={plungeColumns} initialColumn={plungeColumn} selectedCount={selectedIndices.length}
                        blocked={plungeBlocked} gather={gatherPlunge} onKeep={keepViewLine}
                        onClose={() => { setPlungeOpen(false); containerRef.current?.focus({ preventScroll: true }); }}
                    />
                )}
                {plannerOpen && (
                    <PlannerPanel
                        planner={planner} height={fillHeight} link={sliceLink}
                        onClose={() => { setPlannerOpen(false); containerRef.current?.focus({ preventScroll: true }); }}
                    />
                )}
                </Box>
            )}
        </Box>
        </ViewVisibilityContext.Provider>
    );
};

export default Viewer3D;
