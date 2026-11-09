import { WEBGL_CHART_BUDGET } from '../../utils/webglContextGuard';
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Box, Paper, FormControl, InputLabel, Select, MenuItem, Grid, Typography, Alert, CircularProgress, TextField, Autocomplete, Slider, Chip, FormControlLabel, Checkbox } from '@mui/material';
import { MultiColumnSelector } from '../../components/MultiColumnSelector';
import { PlotControlBar, ControlSection, SettingChip } from '../../components/plot_controls/PlotControlBar';
import { useAppStore, useDatasetRows, useDisplayRows } from '../../store/appStore';
import { usePlotSetting } from '../../hooks/usePlotSetting';
import { useShallow } from 'zustand/react/shallow';
import Plot from '../../components/ThemedPlot';
import { STABLE_MAP_AXIS } from '../../utils/plotDensity';
import { ExpandablePlotWrapper } from '../../components/ExpandablePlotWrapper';
import { getStyleArraysColumnar, shapeToPlotlySymbol, applyOpacityToColor, getSortedIndices, sortColumnsByPriority, getColumnDisplayName } from '../../utils/attributeUtils';
import { buildCustomDataColumnar, buildMapHoverTemplate } from '../../utils/tooltipUtils';
import { getPlotConfig } from '../../utils/plotConfig';
import { transformArrayToWGS84, ensureProjectionRegistered, calculateMapBounds, robustExtent } from '../../utils/coordinateUtils';
import { useDragMode } from '../../hooks/useDragMode';
import { useSelectionHandler } from '../../hooks/useSelectionHandler';
import { useHoveredClassRows, HOVER_RING_COLOR } from '../../hooks/useHoveredClassRows';
import { ColumnPicker } from '../../components/ColumnPicker';
import { ALL_EPSG_CODES } from '../../utils/epsgCodes';
import { useFillHeight } from '../../hooks/useFillHeight';
import { useStyleInputs } from '../../hooks/useStyleInputs';

type MapViewStyle = 'normal' | 'osm' | 'satellite' | 'hybrid';

// One map per attribute; each WebGL map costs 2 contexts (browser keeps ~16)
const MAX_WEBGL_CONTEXTS = WEBGL_CHART_BUDGET;

/**
 * Ring (plain map) or halo (basemap) over the points of `trace` whose row is in
 * `rows`. Rows come from the trace's customdata (a row index, or {idx}).
 */
function ringTrace(trace: any, rows: Set<number> | null | undefined, color: string, width: number): any | null {
    const cd = trace?.customdata;
    if (!rows || !rows.size || !cd) return null;
    const geo = trace.type === 'scattermap';
    const a: unknown[] = [], b: unknown[] = [], sizes: number[] = [], symbols: unknown[] = [];
    const ms = trace.marker?.size, sym = trace.marker?.symbol;
    for (let k = 0; k < cd.length; k++) {
        const c = cd[k];
        const r = typeof c === 'number' ? c : c?.idx;
        if (!rows.has(r)) continue;
        if (geo) { a.push(trace.lon[k]); b.push(trace.lat[k]); } else { a.push(trace.x[k]); b.push(trace.y[k]); }
        sizes.push(Array.isArray(ms) ? ms[k] : (ms ?? 6));
        if (Array.isArray(sym)) symbols.push(sym[k]);
    }
    if (!a.length) return null;
    const common = { mode: 'markers', hoverinfo: 'skip', showlegend: false };
    // Map markers have no outline: a larger dot drawn underneath reads as a halo
    if (geo) return { ...common, type: 'scattermap', lon: a, lat: b, marker: { size: sizes.map(s => s + 2 * width + 2), color } };
    return {
        ...common, type: trace.type, x: a, y: b,
        marker: { color: 'rgba(0,0,0,0)', size: sizes, ...(symbols.length ? { symbol: symbols } : {}), line: { width, color } },
    };
}


interface AxisRangeCache {
    [key: string]: { xRange?: [number, number]; yRange?: [number, number] };
}

interface AttributeMapProps {
    plotId: string;
}

export const AttributeMap: React.FC<AttributeMapProps> = ({ plotId }) => {
    const { columns, lockAxes, lockFullExtent } = useAppStore(useShallow(s => ({ columns: s.columns, lockAxes: s.lockAxes, lockFullExtent: s.lockFullExtent })));
    const data = useDatasetRows();
    const getDisplayColumn = useAppStore(s => s.getDisplayColumn);
    const tooltipMode = useAppStore(s => s.tooltipMode); // Also a dep of the plot-data memo (hover customdata)
    const filteredColumns = useAppStore(useShallow(s => s.getFilteredColumns()));
    const d = useCallback((name: string) => getColumnDisplayName(columns, name), [columns]);
    // useShallow returns a new object only when a styling field actually changes,
    // so this doubles as a stable dep for the plot-data memo below.
    const attrStyleState = useStyleInputs();

    const displayData = useDisplayRows();
    const displayIndices = useAppStore(s => s._sampleIndicesArray);

    // Selection handler
    const { handleSelected, handleDeselect, selectedIndices } = useSelectionHandler();
    const hoveredRows = useHoveredClassRows();

    const [xAxis, setXAxis] = usePlotSetting<string>(plotId, 'xAxis', '');
    const [yAxis, setYAxis] = usePlotSetting<string>(plotId, 'yAxis', '');
    const [attributes, setAttributes] = usePlotSetting<string[]>(plotId, 'attributes', []);
    // The workspace toolbar's tool (Lasso / Box / Zoom / Pan), as in every other plot
    const dragMode = useDragMode();
    // Initial view frames the main body of points; far-off strays are shown on request
    const [showFarPoints, setShowFarPoints] = useState(false);
    // Reverse Ordering: draw the attribute rows in the opposite order (low values on top)
    const [reverseOrder, setReverseOrder] = usePlotSetting<boolean>(plotId, 'reverseOrder', false);

    // Map view settings - combines basemap toggle and style into one.
    // Older projects stored basemapEnabled/basemapStyle instead of mapViewStyle.
    const [storedMapView, setStoredMapView] = usePlotSetting<MapViewStyle | null>(plotId, 'mapViewStyle', null);
    const [legacyBasemapEnabled] = usePlotSetting<boolean>(plotId, 'basemapEnabled', false);
    const [legacyBasemapStyle] = usePlotSetting<MapViewStyle>(plotId, 'basemapStyle', 'osm');
    const mapViewStyle: MapViewStyle = storedMapView ?? (legacyBasemapEnabled ? (legacyBasemapStyle || 'osm') : 'normal');
    const [plotEpsgCode, setStoredEpsgCode] = usePlotSetting<string>(plotId, 'epsgCode', '');
    // A plot's own choice wins; otherwise the dataset projection (.gas, Columns view)
    const datasetEpsg = useAppStore(s => s.datasetEpsg);
    // Latitude/longitude axes need no projection choice: WGS84
    const geographicAxes = /lat/i.test(yAxis) && /lon/i.test(xAxis);
    const epsgCode = plotEpsgCode || datasetEpsg || (geographicAxes ? 'EPSG:4326' : '');
    // One map coloured by the Attribute Manager (Attribute Map); each picked
    // variable adds its own panel coloured by that variable (Variable Map)
    const panels = attributes.length ? attributes : [''];
    const { ref: fillRef, height: fillHeight } = useFillHeight<HTMLDivElement>(560, 320, 24);
    const [basemapOpacity, setBasemapOpacity] = usePlotSetting<number>(plotId, 'basemapOpacity', 0.7);
    const [projectionError, setProjectionError] = useState<string | null>(null);
    const [isTransforming, setIsTransforming] = useState(false);

    // Transformed coordinates as state (not ref) to trigger re-renders
    const [transformedCoords, setTransformedCoords] = useState<{ lats: number[]; lons: number[] } | null>(null);

    // Derived state
    const basemapEnabled = mapViewStyle !== 'normal';

    const setMapViewStyle = (style: MapViewStyle) => {
        setStoredMapView(style);
        if (style === 'normal') {
            setTransformedCoords(null);
        }
    };
    const setEpsgCode = (code: string) => {
        setStoredEpsgCode(code);
        setProjectionError(null);
        setTransformedCoords(null);
    };

    // Full data ranges for lockFullExtent mode
    const fullMapRanges = useMemo(() => {
        if (!lockFullExtent || !xAxis || !yAxis) return null;
        let xMin = Infinity, xMax = -Infinity;
        let yMin = Infinity, yMax = -Infinity;
        for (const row of data) {
            const x = row[xAxis], y = row[yAxis];
            if (x != null && !isNaN(x)) { if (x < xMin) xMin = x; if (x > xMax) xMax = x; }
            if (y != null && !isNaN(y)) { if (y < yMin) yMin = y; if (y > yMax) yMax = y; }
        }
        return xMin < xMax && yMin < yMax
            ? { x: [xMin, xMax] as [number, number], y: [yMin, yMax] as [number, number] }
            : null;
    }, [lockFullExtent, data, xAxis, yAxis]);

    // Cache axis ranges when locked
    const axisRangesRef = useRef<AxisRangeCache>({});
    // Basemap view the user panned/zoomed to, per panel. Plotly's uirevision doesn't
    // hold a map's centre through redraws, so it is fed back in; a new key (other
    // columns or projection) starts again from the data.
    const mapViewKey = `${xAxis}|${yAxis}|${epsgCode}`;
    const mapViewKeyRef = useRef(mapViewKey);
    mapViewKeyRef.current = mapViewKey;
    const userMapViews = useRef<Record<string, { key: string; center?: { lat: number; lon: number }; zoom?: number }>>({});

    const handleRelayout = useCallback((attrName: string, event: any) => {
        if (event['map.center'] || event['map.zoom'] != null) {
            const prev = userMapViews.current[attrName];
            const kept = prev?.key === mapViewKeyRef.current ? prev : { key: mapViewKeyRef.current };
            userMapViews.current[attrName] = {
                ...kept,
                ...(event['map.center'] ? { center: event['map.center'] } : {}),
                ...(event['map.zoom'] != null ? { zoom: event['map.zoom'] } : {}),
            };
        }
        // A relayout can carry only one axis (scaleanchor fills in the other);
        // keep the stored range for any axis the event leaves out
        const rangeOf = (ax: 'xaxis' | 'yaxis'): [number, number] | undefined => {
            const r = event[`${ax}.range`] ?? [event[`${ax}.range[0]`], event[`${ax}.range[1]`]];
            return Number.isFinite(r?.[0]) && Number.isFinite(r?.[1]) ? [r[0], r[1]] : undefined;
        };
        const xRange = rangeOf('xaxis');
        const yRange = rangeOf('yaxis');
        if (xRange || yRange) {
            const prev = axisRangesRef.current[attrName];
            axisRangesRef.current[attrName] = { xRange: xRange ?? prev?.xRange, yRange: yRange ?? prev?.yRange };
        }
        if (event['xaxis.autorange'] || event['yaxis.autorange']) {
            delete axisRangesRef.current[attrName];
        }
    }, []);

    React.useEffect(() => {
        if (columns.length > 0 && !xAxis && !yAxis) {
            const exactX = columns.find(c => c.name === 'X');
            const exactY = columns.find(c => c.name === 'Y');
            const east = exactX || columns.find(c => c.role === 'East');
            const north = exactY || columns.find(c => c.role === 'North');
            if (east) setXAxis(east.name);
            if (north) setYAxis(north.name);
        }
    }, [columns, xAxis, yAxis, setXAxis, setYAxis]);

    // Transform coordinates when basemap is enabled
    useEffect(() => {
        if (!basemapEnabled || !epsgCode || !displayData.length || !xAxis || !yAxis) {
            setTransformedCoords(null);
            return;
        }

        const transform = async () => {
            setIsTransforming(true);
            setProjectionError(null);

            try {
                // Ensure projection is registered (fetches from epsg.io if needed)
                await ensureProjectionRegistered(epsgCode);

                // Extract coordinates from display data
                const xCoords = displayData.map(row => row[xAxis]);
                const yCoords = displayData.map(row => row[yAxis]);

                // Transform to WGS84
                const result = transformArrayToWGS84(xCoords, yCoords, epsgCode);
                setTransformedCoords(result);

                console.log(`[AttributeMap] Transformed ${result.lats.length} coordinates using ${epsgCode}`);
            } catch (err: any) {
                console.error('[AttributeMap] Coordinate transformation failed:', err);
                setProjectionError(err.message || 'Failed to transform coordinates');
                setTransformedCoords(null);
            } finally {
                setIsTransforming(false);
            }
        };

        transform();
    }, [basemapEnabled, epsgCode, displayData, xAxis, yAxis]);

    const numericColumns = sortColumnsByPriority(
        filteredColumns.filter(c => c && c.name && (c.type === 'numeric' || c.type === 'float' || c.type === 'integer'))
    );

    const allNumericColumns = useMemo(() => sortColumnsByPriority(
        columns.filter(c => c && c.name && (c.type === 'numeric' || c.type === 'float' || c.type === 'integer'))
    ), [columns]);

    // The traces are identical for every attribute subplot (only the layout/legend
    // differs), so build them ONCE per style/data change instead of per attribute
    // per render.
    const attributePlotData = useMemo(() => {
        void attrStyleState; void tooltipMode; // read from the stores by the style/hover builders
        if (!displayData.length || !xAxis || !yAxis) return [];

        // Get styles from attribute store (includes emphasis calculations) — columnar fast path
        const styleArrays = getStyleArraysColumnar(displayData.length, (name) => getDisplayColumn(name), displayIndices ?? undefined);

        // Get sorted indices for z-ordering (low-grade first, high-grade last/on top)
        const sortedIndices = getSortedIndices(styleArrays);
        if (reverseOrder) sortedIndices.reverse();

        // Build marker properties
        const sortedColors = sortedIndices.map(i =>
            applyOpacityToColor(styleArrays.colors[i], styleArrays.opacity[i])
        );
        const sortedSizes = sortedIndices.map(i => styleArrays.sizes[i]);
        const sortedShapes = sortedIndices.map(i => styleArrays.shapes[i]);
        const customData = buildCustomDataColumnar((name) => getDisplayColumn(name), sortedIndices, displayIndices ?? undefined);

        // Use mapbox mode when basemap is enabled and coordinates are transformed
        if (basemapEnabled && transformedCoords && !projectionError && !isTransforming) {
            const { lats, lons } = transformedCoords;
            const sortedLats = sortedIndices.map(i => lats[i]);
            const sortedLons = sortedIndices.map(i => lons[i]);

            return [{
                type: 'scattermap',
                mode: 'markers',
                lat: sortedLats,
                lon: sortedLons,
                customdata: customData,
                hovertemplate: buildMapHoverTemplate(d(xAxis), d(yAxis)),
                marker: {
                    size: sortedSizes,
                    color: sortedColors,
                    // Note: scattermap has limited symbol support, using circles
                }
            }] as any;
        }

        // Original scatter mode (fall back to CPU scatter when too many subplots)
        const useWebGL = attributes.length <= MAX_WEBGL_CONTEXTS;
        const sortedX = sortedIndices.map(i => displayData[i][xAxis]);
        const sortedY = sortedIndices.map(i => displayData[i][yAxis]);

        return [{
            type: useWebGL ? 'scattergl' : 'scatter',
            mode: 'markers',
            x: sortedX,
            y: sortedY,
            customdata: customData,
            hovertemplate: buildMapHoverTemplate(xAxis, yAxis),
            marker: {
                size: sortedSizes,
                color: sortedColors,
                symbol: sortedShapes.map(s => shapeToPlotlySymbol(s)),
                line: { width: 0 }
            }
        }];
    }, [displayData, displayIndices, xAxis, yAxis, attrStyleState,
        basemapEnabled, transformedCoords, projectionError, isTransforming,
        attributes.length, tooltipMode, d, getDisplayColumn, reverseOrder]);

    // Variable Map panels: each coloured by its own variable, ranked (percentile)
    // on the rainbow, highest values drawn last; text columns keep the
    // Attribute Manager colours
    const variablePlotData = useMemo(() => {
        const out: Record<string, any[]> = {};
        if (!displayData.length || !xAxis || !yAxis) return out;
        const geo = basemapEnabled && transformedCoords && !projectionError && !isTransforming ? transformedCoords : null;
        // Rows hidden in the Attribute Manager are hidden here too
        void attrStyleState;
        const { visible } = getStyleArraysColumnar(displayData.length, (name) => getDisplayColumn(name), displayIndices ?? undefined);
        for (const col of attributes) {
            const idx: number[] = [], vals: number[] = [];
            displayData.forEach((r, i) => {
                if (!visible[i]) return;
                const raw = r[col];
                const v = typeof raw === 'number' ? raw : Number(raw);
                if (raw != null && raw !== '' && Number.isFinite(v)) { idx.push(i); vals.push(v); }
            });
            if (!idx.length) { out[col] = attributePlotData; continue; }
            const order = idx.map((_, k) => k).sort((a, b) => vals[a] - vals[b]);
            const n = order.length;
            const rows = order.map(k => idx[k]);
            const pct = order.map((_, k) => (n > 1 ? (100 * k) / (n - 1) : 50));
            const marker = {
                size: 6, color: pct, colorscale: 'Jet', cmin: 0, cmax: 100,
                colorbar: { title: { text: 'Percentile', side: 'right' as const }, thickness: 10, len: 0.8, tickfont: { size: 10 } },
            };
            const text = order.map(k => String(+vals[k].toPrecision(4)));
            // Original row numbers: lasso / box selection reads them back
            const customdata = rows.map(i => (displayIndices ? displayIndices[i] : i));
            out[col] = [geo
                ? { type: 'scattermap', mode: 'markers', lat: rows.map(i => geo.lats[i]), lon: rows.map(i => geo.lons[i]), text, customdata, hovertemplate: `${d(col)} %{text}<extra></extra>`, marker }
                : { type: attributes.length <= MAX_WEBGL_CONTEXTS ? 'scattergl' : 'scatter', mode: 'markers', x: rows.map(i => displayData[i][xAxis]), y: rows.map(i => displayData[i][yAxis]), text, customdata, hovertemplate: `${d(col)} %{text}<extra></extra>`, marker }];
        }
        return out;
    }, [attributes, displayData, displayIndices, getDisplayColumn, attrStyleState, xAxis, yAxis, basemapEnabled, transformedCoords, projectionError, isTransforming, attributePlotData, d]);

    // Starting view over the main body of points (basemap: centre + zoom; plain map: axis ranges)
    const mapView = useMemo(
        () => (transformedCoords ? calculateMapBounds(transformedCoords.lats, transformedCoords.lons) : null),
        [transformedCoords]);
    const xyExtent = useMemo(() => {
        if (!xAxis || !yAxis) return null;
        const xc = getDisplayColumn(xAxis), yc = getDisplayColumn(yAxis);
        return xc && yc ? robustExtent(xc as ArrayLike<unknown>, yc as ArrayLike<unknown>) : null;
    }, [xAxis, yAxis, getDisplayColumn]);
    const farPoints = xyExtent?.outside ?? 0;
    const trimXY = !basemapEnabled && farPoints > 0 && !showFarPoints && !lockAxes && !lockFullExtent && !!xyExtent;
    const pad = (r: [number, number]): [number, number] => {
        const p = (r[1] - r[0]) * 0.04 || Math.abs(r[0]) * 0.01 || 1;
        return [r[0] - p, r[1] + p];
    };

    // Selected rows and the Attribute Manager class under the pointer, ringed in every panel
    const selectedSet = useMemo(() => (selectedIndices.length ? new Set(selectedIndices) : null), [selectedIndices]);
    const panelData = (attributeName: string) => {
        const traces: any[] = attributeName ? (variablePlotData[attributeName] ?? attributePlotData) : attributePlotData;
        const main = traces[0];
        const geo = main?.type === 'scattermap';
        const sel = ringTrace(main, selectedSet, geo ? (mapViewStyle === 'osm' ? '#212121' : '#ffffff') : '#ffffff', 2);
        const hov = ringTrace(main, hoveredRows, HOVER_RING_COLOR, 2.5);
        const extra = [sel, hov].filter(Boolean);
        // Halos go under the map points; rings over the plain-map points
        return geo ? [...extra, ...traces] : [...traces, ...extra];
    };

    const getMapboxStyle = (): string => {
        switch (mapViewStyle) {
            case 'satellite':
            case 'hybrid':
                return 'white-bg'; // We'll add custom tile layers
            case 'osm':
            default:
                return 'open-street-map';
        }
    };

    const getLayoutForAttribute = (attributeName: string) => {
        const baseLayout = {
            title: { text: attributeName ? d(attributeName) : '', font: { size: 13 }, x: 0, xanchor: 'left' as const },
            autosize: true,
            height: panels.length > 1 ? 340 : fillHeight,
            hovermode: 'closest' as const,
            // One data trace per panel; the selection/hover rings must not add a legend
            showlegend: false,
            margin: { l: 56, r: 16, t: attributeName ? 32 : 12, b: 44 },
        };

        // Mapbox layout when basemap is enabled
        if (basemapEnabled && transformedCoords && mapView && !projectionError && !isTransforming) {
            const saved = userMapViews.current[attributeName];
            const userView = saved?.key === mapViewKey ? saved : null;
            const mapboxLayout: any = {
                ...baseLayout,
                dragmode: dragMode as any,
                map: {
                    style: getMapboxStyle(),
                    center: userView?.center ?? mapView.center,
                    zoom: userView?.zoom ?? mapView.zoom
                },
                // Keep the user's pan/zoom through redraws (selection, hover, styles);
                // recentre only for new coordinates or a new projection
                uirevision: `map|${xAxis}|${yAxis}|${epsgCode}|${attributeName}`
            };

            // Add satellite tile layers for satellite/hybrid modes
            if (mapViewStyle === 'satellite' || mapViewStyle === 'hybrid') {
                mapboxLayout.map.layers = [{
                    sourcetype: 'raster',
                    source: [
                        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
                    ],
                    below: 'traces',
                    opacity: basemapOpacity
                }];

                // Add labels overlay for hybrid mode (slightly more visible)
                if (mapViewStyle === 'hybrid') {
                    mapboxLayout.map.layers.push({
                        sourcetype: 'raster',
                        source: [
                            'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'
                        ],
                        opacity: Math.min(1.0, basemapOpacity + 0.2)
                    });
                }
            }

            return mapboxLayout;
        }

        // Original XY layout
        return {
            ...baseLayout,
            dragmode: dragMode as any,
            // Fixed margins + plain tick numbers: with automargin, northing labels
            // change width as you pan/zoom, the plot area resizes, and the 1:1
            // aspect lock rewrites the x range - the map jumps. 'domain' keeps the
            // aspect by shrinking the drawing area instead of changing ranges.
            margin: { ...baseLayout.margin, l: 104, b: 52 },
            xaxis: {
                title: { text: d(xAxis), font: { size: 11 } },
                scaleanchor: 'y',
                scaleratio: 1,
                ...STABLE_MAP_AXIS,
                ...(lockFullExtent && fullMapRanges
                    ? { range: fullMapRanges.x, autorange: false }
                    : lockAxes && axisRangesRef.current[attributeName]?.xRange
                        ? { range: axisRangesRef.current[attributeName].xRange, autorange: false }
                        : trimXY ? { range: pad(xyExtent!.x), autorange: false } : {})
            },
            yaxis: {
                title: { text: d(yAxis), font: { size: 11 }, standoff: 6 },
                ...STABLE_MAP_AXIS,
                ...(lockFullExtent && fullMapRanges
                    ? { range: fullMapRanges.y, autorange: false }
                    : lockAxes && axisRangesRef.current[attributeName]?.yRange
                        ? { range: axisRangesRef.current[attributeName].yRange, autorange: false }
                        : trimXY ? { range: pad(xyExtent!.y), autorange: false } : {})
            },
            // Stable token: preserve pan/zoom across re-renders; reset only on axis change
            uirevision: (lockAxes || lockFullExtent) ? 'locked' : `${xAxis}|${yAxis}|${attributeName}|${trimXY}`
        };
    };

    return (
        <Box sx={{ p: 1 }}>
            <PlotControlBar
                primary={<>
                    <ColumnPicker label="X-Axis" value={xAxis} onChange={setXAxis} minWidth={150} />
                    <ColumnPicker label="Y-Axis" value={yAxis} onChange={setYAxis} minWidth={150} />
                    <MultiColumnSelector columns={numericColumns} selectedColumns={attributes} onChange={setAttributes} label="Variable maps (optional)" allColumns={allNumericColumns} />
                </>}
                settingsActive={mapViewStyle !== 'normal' || basemapOpacity !== 0.7}
                summary={<>
                    {mapViewStyle !== 'normal' && (
                        <SettingChip
                            label={mapViewStyle === 'osm' ? 'OpenStreetMap' : mapViewStyle === 'satellite' ? 'Satellite' : 'Hybrid'}
                            onDelete={() => setMapViewStyle('normal')}
                        />
                    )}
                    {!basemapEnabled && farPoints > 0 && !lockAxes && !lockFullExtent && (
                        <Chip
                            size="small"
                            variant="outlined"
                            label={showFarPoints ? 'Zoom to main group' : `${farPoints.toLocaleString()} far-off points not in view · Show all`}
                            title="Points far from the rest (e.g. coordinates in a different system, or 0/0 placeholders). The view starts on the main group of points."
                            onClick={() => setShowFarPoints(v => !v)}
                        />
                    )}
                    {selectedIndices.length > 0 && (
                        <Chip
                            label={`${selectedIndices.length} selected`}
                            size="small"
                            onDelete={handleDeselect}
                        />
                    )}
                </>}
                settings={<>
                    <ControlSection label="Map View">
                        <FormControl sx={{ minWidth: 150 }} size="small">
                            <InputLabel>Map View</InputLabel>
                            <Select
                                value={mapViewStyle}
                                onChange={(e) => setMapViewStyle(e.target.value as MapViewStyle)}
                                label="Map View"
                            >
                                <MenuItem value="normal">Normal (X/Y)</MenuItem>
                                <MenuItem value="osm">OpenStreetMap</MenuItem>
                                <MenuItem value="satellite">Satellite</MenuItem>
                                <MenuItem value="hybrid">Hybrid</MenuItem>
                            </Select>
                        </FormControl>
                        {basemapEnabled && (
                            <Box sx={{ ml: 3.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
                                <Autocomplete
                                    freeSolo
                                    options={ALL_EPSG_CODES.filter(e => e.code !== '')}
                                    getOptionLabel={(option) => typeof option === 'string' ? option : option.label}
                                    value={ALL_EPSG_CODES.find(e => e.code === epsgCode) || (epsgCode ? { code: epsgCode, label: epsgCode, numericCode: 0 } : null)}
                                    onChange={(_event, newValue) => {
                                        if (typeof newValue === 'string') {
                                            const normalized = newValue.toUpperCase().startsWith('EPSG:') ? newValue.toUpperCase() : `EPSG:${newValue}`;
                                            setEpsgCode(normalized);
                                        } else if (newValue) {
                                            setEpsgCode(newValue.code);
                                        } else {
                                            setEpsgCode('');
                                        }
                                    }}
                                    onBlur={(event) => {
                                        const inputValue = (event.target as HTMLInputElement).value;
                                        if (inputValue && !ALL_EPSG_CODES.some(e => e.label === inputValue || e.code === inputValue)) {
                                            const normalized = inputValue.toUpperCase().startsWith('EPSG:') ? inputValue.toUpperCase() : `EPSG:${inputValue}`;
                                            setEpsgCode(normalized);
                                        }
                                    }}
                                    renderInput={(params) => (
                                        <TextField
                                            {...params}
                                            label="EPSG Code"
                                            size="small"
                                            error={!!projectionError}
                                            placeholder="Search or enter code..."
                                            fullWidth
                                        />
                                    )}
                                    ListboxProps={{ style: { maxHeight: 400 } }}
                                    isOptionEqualToValue={(option, value) => option.code === value.code}
                                />
                                {isTransforming && <CircularProgress size={20} />}
                                {(mapViewStyle === 'satellite' || mapViewStyle === 'hybrid') && (
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 160 }}>
                                        <Typography variant="caption" sx={{ whiteSpace: 'nowrap' }}>Opacity</Typography>
                                        <Slider
                                            value={basemapOpacity}
                                            onChange={(_, v) => setBasemapOpacity(v as number)}
                                            min={0.1}
                                            max={1}
                                            step={0.1}
                                            size="small"
                                            valueLabelDisplay="auto"
                                            valueLabelFormat={(v) => `${Math.round(v * 100)}%`}
                                            sx={{ width: 100 }}
                                        />
                                    </Box>
                                )}
                            </Box>
                        )}
                    </ControlSection>
                    <ControlSection label="Draw order">
                        <FormControlLabel
                            control={<Checkbox size="small" checked={reverseOrder} onChange={(e) => setReverseOrder(e.target.checked)} />}
                            label={<Typography variant="body2">Reverse ordering (low values on top)</Typography>}
                        />
                    </ControlSection>
                </>}
            />
            {basemapEnabled && projectionError && (
                <Alert severity="error" sx={{ mb: 2 }}>{projectionError}</Alert>
            )}
            {basemapEnabled && !epsgCode && !projectionError && (
                <Alert severity="info" sx={{ mb: 2 }}>
                    Search for an EPSG code or type any code (e.g., 3719 or EPSG:3719)
                </Alert>
            )}
            {!xAxis || !yAxis ? (<Typography color="text.secondary">Select the X (East) and Y (North) columns to display the map</Typography>) : (
                <Grid container spacing={1.5} ref={fillRef}>
                    {panels.map((attributeName) => (
                        <Grid item xs={12} sm={panels.length > 1 ? 6 : 12} lg={panels.length > 2 ? 4 : panels.length > 1 ? 6 : 12} key={attributeName || 'map'}>
                            <Paper sx={{ p: 0.5 }}>
                                <ExpandablePlotWrapper>
                                    <Plot
                                        data={panelData(attributeName)}
                                        layout={getLayoutForAttribute(attributeName)}
                                        config={getPlotConfig({ filename: `map_${attributeName || 'attributes'}` })}
                                        style={{ width: '100%' }}
                                        useResizeHandler={true}
                                        onRelayout={(e) => handleRelayout(attributeName, e)}
                                        onSelected={handleSelected}
                                        onDeselect={handleDeselect}
                                    />
                                </ExpandablePlotWrapper>
                            </Paper>
                        </Grid>
                    ))}
                </Grid>
            )}
        </Box>
    );
};
