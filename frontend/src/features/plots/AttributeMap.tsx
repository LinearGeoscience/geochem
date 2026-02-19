import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Box, Paper, FormControl, InputLabel, Select, MenuItem, Grid, Typography, IconButton, Collapse, Alert, CircularProgress, TextField, Autocomplete, Slider } from '@mui/material';
import { ExpandMore, ExpandLess } from '@mui/icons-material';
import { MultiColumnSelector } from '../../components/MultiColumnSelector';
import { useAppStore } from '../../store/appStore';
import Plot from 'react-plotly.js';
import { ExpandablePlotWrapper } from '../../components/ExpandablePlotWrapper';
import { useAttributeStore } from '../../store/attributeStore';
import { getStyleArrays, shapeToPlotlySymbol, applyOpacityToColor, getSortedIndices, sortColumnsByPriority, getColumnDisplayName } from '../../utils/attributeUtils';
import { buildCustomData, buildMapHoverTemplate } from '../../utils/tooltipUtils';
import { getPlotConfig } from '../../utils/plotConfig';
import { transformArrayToWGS84, ensureProjectionRegistered, calculateMapBounds } from '../../utils/coordinateUtils';

type MapViewStyle = 'normal' | 'osm' | 'satellite' | 'hybrid';

// Max WebGL contexts before falling back to CPU-rendered scatter (browsers limit to ~8-16)
const MAX_WEBGL_CONTEXTS = 16;

// Generate all UTM zones programmatically
const generateUtmZones = (): { code: string; label: string; numericCode: number }[] => {
    const zones: { code: string; label: string; numericCode: number }[] = [];

    // UTM Northern Hemisphere: EPSG:32601-32660
    for (let zone = 1; zone <= 60; zone++) {
        const code = 32600 + zone;
        zones.push({
            code: `EPSG:${code}`,
            label: `${code} - WGS 84 / UTM zone ${zone}N`,
            numericCode: code
        });
    }

    // UTM Southern Hemisphere: EPSG:32701-32760
    for (let zone = 1; zone <= 60; zone++) {
        const code = 32700 + zone;
        zones.push({
            code: `EPSG:${code}`,
            label: `${code} - WGS 84 / UTM zone ${zone}S`,
            numericCode: code
        });
    }

    return zones;
};

// Common/Regional coordinate systems
const REGIONAL_EPSG_CODES: { code: string; label: string; numericCode: number }[] = [
    // Global
    { code: 'EPSG:3857', label: '3857 - WGS 84 / Pseudo-Mercator (Web Mercator)', numericCode: 3857 },
    { code: 'EPSG:4326', label: '4326 - WGS 84 (Geographic)', numericCode: 4326 },

    // Australia - GDA94 MGA
    { code: 'EPSG:28349', label: '28349 - GDA94 / MGA zone 49', numericCode: 28349 },
    { code: 'EPSG:28350', label: '28350 - GDA94 / MGA zone 50', numericCode: 28350 },
    { code: 'EPSG:28351', label: '28351 - GDA94 / MGA zone 51', numericCode: 28351 },
    { code: 'EPSG:28352', label: '28352 - GDA94 / MGA zone 52', numericCode: 28352 },
    { code: 'EPSG:28353', label: '28353 - GDA94 / MGA zone 53', numericCode: 28353 },
    { code: 'EPSG:28354', label: '28354 - GDA94 / MGA zone 54', numericCode: 28354 },
    { code: 'EPSG:28355', label: '28355 - GDA94 / MGA zone 55', numericCode: 28355 },
    { code: 'EPSG:28356', label: '28356 - GDA94 / MGA zone 56', numericCode: 28356 },

    // Australia - GDA2020 MGA
    { code: 'EPSG:7849', label: '7849 - GDA2020 / MGA zone 49', numericCode: 7849 },
    { code: 'EPSG:7850', label: '7850 - GDA2020 / MGA zone 50', numericCode: 7850 },
    { code: 'EPSG:7851', label: '7851 - GDA2020 / MGA zone 51', numericCode: 7851 },
    { code: 'EPSG:7852', label: '7852 - GDA2020 / MGA zone 52', numericCode: 7852 },
    { code: 'EPSG:7853', label: '7853 - GDA2020 / MGA zone 53', numericCode: 7853 },
    { code: 'EPSG:7854', label: '7854 - GDA2020 / MGA zone 54', numericCode: 7854 },
    { code: 'EPSG:7855', label: '7855 - GDA2020 / MGA zone 55', numericCode: 7855 },
    { code: 'EPSG:7856', label: '7856 - GDA2020 / MGA zone 56', numericCode: 7856 },

    // USA/Canada - NAD83 UTM
    { code: 'EPSG:26907', label: '26907 - NAD83 / UTM zone 7N', numericCode: 26907 },
    { code: 'EPSG:26908', label: '26908 - NAD83 / UTM zone 8N', numericCode: 26908 },
    { code: 'EPSG:26909', label: '26909 - NAD83 / UTM zone 9N', numericCode: 26909 },
    { code: 'EPSG:26910', label: '26910 - NAD83 / UTM zone 10N', numericCode: 26910 },
    { code: 'EPSG:26911', label: '26911 - NAD83 / UTM zone 11N', numericCode: 26911 },
    { code: 'EPSG:26912', label: '26912 - NAD83 / UTM zone 12N', numericCode: 26912 },
    { code: 'EPSG:26913', label: '26913 - NAD83 / UTM zone 13N', numericCode: 26913 },
    { code: 'EPSG:26914', label: '26914 - NAD83 / UTM zone 14N', numericCode: 26914 },
    { code: 'EPSG:26915', label: '26915 - NAD83 / UTM zone 15N', numericCode: 26915 },
    { code: 'EPSG:26916', label: '26916 - NAD83 / UTM zone 16N', numericCode: 26916 },
    { code: 'EPSG:26917', label: '26917 - NAD83 / UTM zone 17N', numericCode: 26917 },
    { code: 'EPSG:26918', label: '26918 - NAD83 / UTM zone 18N', numericCode: 26918 },
    { code: 'EPSG:26919', label: '26919 - NAD83 / UTM zone 19N', numericCode: 26919 },
    { code: 'EPSG:26920', label: '26920 - NAD83 / UTM zone 20N', numericCode: 26920 },
    { code: 'EPSG:26921', label: '26921 - NAD83 / UTM zone 21N', numericCode: 26921 },
    { code: 'EPSG:26922', label: '26922 - NAD83 / UTM zone 22N', numericCode: 26922 },

    // USA - NAD83(NSRS2007) UTM zones
    { code: 'EPSG:3707', label: '3707 - NAD83(NSRS2007) / UTM zone 3N', numericCode: 3707 },
    { code: 'EPSG:3708', label: '3708 - NAD83(NSRS2007) / UTM zone 4N', numericCode: 3708 },
    { code: 'EPSG:3709', label: '3709 - NAD83(NSRS2007) / UTM zone 5N', numericCode: 3709 },
    { code: 'EPSG:3710', label: '3710 - NAD83(NSRS2007) / UTM zone 6N', numericCode: 3710 },
    { code: 'EPSG:3711', label: '3711 - NAD83(NSRS2007) / UTM zone 7N', numericCode: 3711 },
    { code: 'EPSG:3712', label: '3712 - NAD83(NSRS2007) / UTM zone 8N', numericCode: 3712 },
    { code: 'EPSG:3713', label: '3713 - NAD83(NSRS2007) / UTM zone 9N', numericCode: 3713 },
    { code: 'EPSG:3714', label: '3714 - NAD83(NSRS2007) / UTM zone 10N', numericCode: 3714 },
    { code: 'EPSG:3715', label: '3715 - NAD83(NSRS2007) / UTM zone 11N', numericCode: 3715 },
    { code: 'EPSG:3716', label: '3716 - NAD83(NSRS2007) / UTM zone 12N', numericCode: 3716 },
    { code: 'EPSG:3717', label: '3717 - NAD83(NSRS2007) / UTM zone 13N', numericCode: 3717 },
    { code: 'EPSG:3718', label: '3718 - NAD83(NSRS2007) / UTM zone 14N', numericCode: 3718 },
    { code: 'EPSG:3719', label: '3719 - NAD83(NSRS2007) / UTM zone 15N', numericCode: 3719 },
    { code: 'EPSG:3720', label: '3720 - NAD83(NSRS2007) / UTM zone 16N', numericCode: 3720 },
    { code: 'EPSG:3721', label: '3721 - NAD83(NSRS2007) / UTM zone 17N', numericCode: 3721 },
    { code: 'EPSG:3722', label: '3722 - NAD83(NSRS2007) / UTM zone 18N', numericCode: 3722 },
    { code: 'EPSG:3723', label: '3723 - NAD83(NSRS2007) / UTM zone 19N', numericCode: 3723 },

    // USA - NAD83(2011) UTM zones
    { code: 'EPSG:6329', label: '6329 - NAD83(2011) / UTM zone 1N', numericCode: 6329 },
    { code: 'EPSG:6330', label: '6330 - NAD83(2011) / UTM zone 2N', numericCode: 6330 },
    { code: 'EPSG:6331', label: '6331 - NAD83(2011) / UTM zone 3N', numericCode: 6331 },
    { code: 'EPSG:6332', label: '6332 - NAD83(2011) / UTM zone 4N', numericCode: 6332 },
    { code: 'EPSG:6333', label: '6333 - NAD83(2011) / UTM zone 5N', numericCode: 6333 },
    { code: 'EPSG:6334', label: '6334 - NAD83(2011) / UTM zone 6N', numericCode: 6334 },
    { code: 'EPSG:6335', label: '6335 - NAD83(2011) / UTM zone 7N', numericCode: 6335 },
    { code: 'EPSG:6336', label: '6336 - NAD83(2011) / UTM zone 8N', numericCode: 6336 },
    { code: 'EPSG:6337', label: '6337 - NAD83(2011) / UTM zone 9N', numericCode: 6337 },
    { code: 'EPSG:6338', label: '6338 - NAD83(2011) / UTM zone 10N', numericCode: 6338 },
    { code: 'EPSG:6339', label: '6339 - NAD83(2011) / UTM zone 11N', numericCode: 6339 },
    { code: 'EPSG:6340', label: '6340 - NAD83(2011) / UTM zone 12N', numericCode: 6340 },
    { code: 'EPSG:6341', label: '6341 - NAD83(2011) / UTM zone 13N', numericCode: 6341 },
    { code: 'EPSG:6342', label: '6342 - NAD83(2011) / UTM zone 14N', numericCode: 6342 },
    { code: 'EPSG:6343', label: '6343 - NAD83(2011) / UTM zone 15N', numericCode: 6343 },
    { code: 'EPSG:6344', label: '6344 - NAD83(2011) / UTM zone 16N', numericCode: 6344 },
    { code: 'EPSG:6345', label: '6345 - NAD83(2011) / UTM zone 17N', numericCode: 6345 },
    { code: 'EPSG:6346', label: '6346 - NAD83(2011) / UTM zone 18N', numericCode: 6346 },
    { code: 'EPSG:6347', label: '6347 - NAD83(2011) / UTM zone 19N', numericCode: 6347 },

    // UK
    { code: 'EPSG:27700', label: '27700 - OSGB 1936 / British National Grid', numericCode: 27700 },

    // South Africa
    { code: 'EPSG:2046', label: '2046 - Hartebeesthoek94 / Lo15', numericCode: 2046 },
    { code: 'EPSG:2047', label: '2047 - Hartebeesthoek94 / Lo17', numericCode: 2047 },
    { code: 'EPSG:2048', label: '2048 - Hartebeesthoek94 / Lo19', numericCode: 2048 },
    { code: 'EPSG:2049', label: '2049 - Hartebeesthoek94 / Lo21', numericCode: 2049 },
    { code: 'EPSG:2050', label: '2050 - Hartebeesthoek94 / Lo23', numericCode: 2050 },
    { code: 'EPSG:2051', label: '2051 - Hartebeesthoek94 / Lo25', numericCode: 2051 },
    { code: 'EPSG:2052', label: '2052 - Hartebeesthoek94 / Lo27', numericCode: 2052 },
    { code: 'EPSG:2053', label: '2053 - Hartebeesthoek94 / Lo29', numericCode: 2053 },
    { code: 'EPSG:2054', label: '2054 - Hartebeesthoek94 / Lo31', numericCode: 2054 },
    { code: 'EPSG:2055', label: '2055 - Hartebeesthoek94 / Lo33', numericCode: 2055 },

    // Chile
    { code: 'EPSG:32718', label: '32718 - WGS 84 / UTM zone 18S', numericCode: 32718 },
    { code: 'EPSG:32719', label: '32719 - WGS 84 / UTM zone 19S', numericCode: 32719 },

    // Peru
    { code: 'EPSG:32717', label: '32717 - WGS 84 / UTM zone 17S', numericCode: 32717 },

    // Brazil - SIRGAS 2000
    { code: 'EPSG:31982', label: '31982 - SIRGAS 2000 / UTM zone 22S', numericCode: 31982 },
    { code: 'EPSG:31983', label: '31983 - SIRGAS 2000 / UTM zone 23S', numericCode: 31983 },
    { code: 'EPSG:31984', label: '31984 - SIRGAS 2000 / UTM zone 24S', numericCode: 31984 },
    { code: 'EPSG:31985', label: '31985 - SIRGAS 2000 / UTM zone 25S', numericCode: 31985 },

    // New Zealand
    { code: 'EPSG:2193', label: '2193 - NZGD2000 / New Zealand Transverse Mercator', numericCode: 2193 },

    // Indonesia
    { code: 'EPSG:23830', label: '23830 - DGN95 / Indonesia TM-3 zone 46.2', numericCode: 23830 },
    { code: 'EPSG:23831', label: '23831 - DGN95 / Indonesia TM-3 zone 47.1', numericCode: 23831 },
    { code: 'EPSG:23832', label: '23832 - DGN95 / Indonesia TM-3 zone 47.2', numericCode: 23832 },
    { code: 'EPSG:23833', label: '23833 - DGN95 / Indonesia TM-3 zone 48.1', numericCode: 23833 },
    { code: 'EPSG:23834', label: '23834 - DGN95 / Indonesia TM-3 zone 48.2', numericCode: 23834 },
    { code: 'EPSG:23835', label: '23835 - DGN95 / Indonesia TM-3 zone 49.1', numericCode: 23835 },
    { code: 'EPSG:23836', label: '23836 - DGN95 / Indonesia TM-3 zone 49.2', numericCode: 23836 },
    { code: 'EPSG:23837', label: '23837 - DGN95 / Indonesia TM-3 zone 50.1', numericCode: 23837 },
    { code: 'EPSG:23838', label: '23838 - DGN95 / Indonesia TM-3 zone 50.2', numericCode: 23838 },
    { code: 'EPSG:23839', label: '23839 - DGN95 / Indonesia TM-3 zone 51.1', numericCode: 23839 },
    { code: 'EPSG:23840', label: '23840 - DGN95 / Indonesia TM-3 zone 51.2', numericCode: 23840 },
    { code: 'EPSG:23841', label: '23841 - DGN95 / Indonesia TM-3 zone 52.1', numericCode: 23841 },
    { code: 'EPSG:23842', label: '23842 - DGN95 / Indonesia TM-3 zone 52.2', numericCode: 23842 },
    { code: 'EPSG:23843', label: '23843 - DGN95 / Indonesia TM-3 zone 53.1', numericCode: 23843 },
    { code: 'EPSG:23844', label: '23844 - DGN95 / Indonesia TM-3 zone 53.2', numericCode: 23844 },
    { code: 'EPSG:23845', label: '23845 - DGN95 / Indonesia TM-3 zone 54.1', numericCode: 23845 },

    // Philippines
    { code: 'EPSG:3121', label: '3121 - PRS92 / Philippines zone 1', numericCode: 3121 },
    { code: 'EPSG:3122', label: '3122 - PRS92 / Philippines zone 2', numericCode: 3122 },
    { code: 'EPSG:3123', label: '3123 - PRS92 / Philippines zone 3', numericCode: 3123 },
    { code: 'EPSG:3124', label: '3124 - PRS92 / Philippines zone 4', numericCode: 3124 },
    { code: 'EPSG:3125', label: '3125 - PRS92 / Philippines zone 5', numericCode: 3125 },
];

// Combine and sort all EPSG codes numerically
const ALL_EPSG_CODES = [
    { code: '', label: 'Select EPSG Code...', numericCode: 0 },
    ...generateUtmZones(),
    ...REGIONAL_EPSG_CODES
].sort((a, b) => a.numericCode - b.numericCode);

interface AxisRangeCache {
    [key: string]: { xRange?: [number, number]; yRange?: [number, number] };
}

interface AttributeMapProps {
    plotId: string;
}

export const AttributeMap: React.FC<AttributeMapProps> = ({ plotId }) => {
    const { data, columns, lockAxes, getPlotSettings, updatePlotSettings, getFilteredColumns, getDisplayData, getDisplayIndices, sampleIndices } = useAppStore();
    const filteredColumns = getFilteredColumns();
    const d = (name: string) => getColumnDisplayName(columns, name);
    useAttributeStore(); // Subscribe to changes

    const displayData = useMemo(() => getDisplayData(), [data, sampleIndices]);
    const displayIndices = useMemo(() => getDisplayIndices(), [data, sampleIndices]);

    // Get stored settings or defaults
    const storedSettings = getPlotSettings(plotId);

    const [xAxis, setXAxisLocal] = useState<string>(storedSettings.xAxis || '');
    const [yAxis, setYAxisLocal] = useState<string>(storedSettings.yAxis || '');
    const [attributes, setAttributesLocal] = useState<string[]>(storedSettings.attributes || []);
    const [controlsExpanded, setControlsExpandedLocal] = useState(storedSettings.controlsExpanded ?? true);

    // Map view settings - combines basemap toggle and style into one
    // Migrate from old settings format
    const getInitialMapView = (): MapViewStyle => {
        if (storedSettings.mapViewStyle) return storedSettings.mapViewStyle;
        // Migrate from old basemapEnabled/basemapStyle format
        if (storedSettings.basemapEnabled) return storedSettings.basemapStyle || 'osm';
        return 'normal';
    };
    const [mapViewStyle, setMapViewStyleLocal] = useState<MapViewStyle>(getInitialMapView());
    const [epsgCode, setEpsgCodeLocal] = useState<string>(storedSettings.epsgCode ?? '');
    const [basemapOpacity, setBasemapOpacityLocal] = useState<number>(storedSettings.basemapOpacity ?? 0.7);
    const [projectionError, setProjectionError] = useState<string | null>(null);
    const [isTransforming, setIsTransforming] = useState(false);

    // Transformed coordinates as state (not ref) to trigger re-renders
    const [transformedCoords, setTransformedCoords] = useState<{ lats: number[]; lons: number[] } | null>(null);

    // Derived state
    const basemapEnabled = mapViewStyle !== 'normal';

    // Wrapper functions to persist settings
    const setXAxis = (axis: string) => {
        setXAxisLocal(axis);
        updatePlotSettings(plotId, { xAxis: axis });
    };
    const setYAxis = (axis: string) => {
        setYAxisLocal(axis);
        updatePlotSettings(plotId, { yAxis: axis });
    };
    const setAttributes = (attrs: string[]) => {
        setAttributesLocal(attrs);
        updatePlotSettings(plotId, { attributes: attrs });
    };
    const setControlsExpanded = (expanded: boolean) => {
        setControlsExpandedLocal(expanded);
        updatePlotSettings(plotId, { controlsExpanded: expanded });
    };

    // Map view setting wrapper
    const setMapViewStyle = (style: MapViewStyle) => {
        setMapViewStyleLocal(style);
        updatePlotSettings(plotId, { mapViewStyle: style });
        if (style === 'normal') {
            setTransformedCoords(null);
        }
    };
    const setEpsgCode = (code: string) => {
        setEpsgCodeLocal(code);
        updatePlotSettings(plotId, { epsgCode: code });
        setProjectionError(null);
        setTransformedCoords(null);
    };
    const setBasemapOpacity = (opacity: number) => {
        setBasemapOpacityLocal(opacity);
        updatePlotSettings(plotId, { basemapOpacity: opacity });
    };

    // Cache axis ranges when locked
    const axisRangesRef = useRef<AxisRangeCache>({});

    const handleRelayout = useCallback((attrName: string, event: any) => {
        if (event['xaxis.range[0]'] !== undefined || event['xaxis.range'] !== undefined) {
            const xRange = event['xaxis.range'] || [event['xaxis.range[0]'], event['xaxis.range[1]']];
            const yRange = event['yaxis.range'] || [event['yaxis.range[0]'], event['yaxis.range[1]']];
            axisRangesRef.current[attrName] = {
                xRange: xRange as [number, number],
                yRange: yRange as [number, number]
            };
        }
        if (event['xaxis.autorange'] || event['yaxis.autorange']) {
            delete axisRangesRef.current[attrName];
        }
    }, []);

    React.useEffect(() => {
        if (columns.length > 0 && !xAxis && !yAxis && !storedSettings.xAxis && !storedSettings.yAxis) {
            const exactX = columns.find(c => c.name === 'X');
            const exactY = columns.find(c => c.name === 'Y');
            const east = exactX || columns.find(c => c.role === 'East');
            const north = exactY || columns.find(c => c.role === 'North');
            if (east) setXAxis(east.name);
            if (north) setYAxis(north.name);
        }
    }, [columns, storedSettings]);

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

    const getPlotDataForAttribute = (_attributeName: string) => {
        if (!displayData.length || !xAxis || !yAxis) return [];

        // Get styles from attribute store (includes emphasis calculations)
        const styleArrays = getStyleArrays(displayData, displayIndices ?? undefined);

        // Get sorted indices for z-ordering (low-grade first, high-grade last/on top)
        const sortedIndices = getSortedIndices(styleArrays);

        // Build marker properties
        const sortedColors = sortedIndices.map(i =>
            applyOpacityToColor(styleArrays.colors[i], styleArrays.opacity[i])
        );
        const sortedSizes = sortedIndices.map(i => styleArrays.sizes[i]);
        const sortedShapes = sortedIndices.map(i => styleArrays.shapes[i]);
        const customData = buildCustomData(displayData, sortedIndices, displayIndices ?? undefined);

        // Use mapbox mode when basemap is enabled and coordinates are transformed
        if (basemapEnabled && transformedCoords && !projectionError && !isTransforming) {
            const { lats, lons } = transformedCoords;
            const sortedLats = sortedIndices.map(i => lats[i]);
            const sortedLons = sortedIndices.map(i => lons[i]);

            return [{
                type: 'scattermapbox',
                mode: 'markers',
                lat: sortedLats,
                lon: sortedLons,
                customdata: customData,
                hovertemplate: buildMapHoverTemplate(d(xAxis), d(yAxis)),
                marker: {
                    size: sortedSizes,
                    color: sortedColors,
                    // Note: scattermapbox has limited symbol support, using circles
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
            title: { text: attributeName, font: { size: 14 }, x: 0, xanchor: 'left' as const },
            autosize: true,
            height: 350,
            hovermode: 'closest' as const,
            margin: { l: 50, r: 40, t: 40, b: 50 },
        };

        // Mapbox layout when basemap is enabled
        if (basemapEnabled && transformedCoords && !projectionError && !isTransforming) {
            const { lats, lons } = transformedCoords;
            const { center, zoom } = calculateMapBounds(lats, lons);

            const mapboxLayout: any = {
                ...baseLayout,
                mapbox: {
                    style: getMapboxStyle(),
                    center: center,
                    zoom: zoom
                }
            };

            // Add satellite tile layers for satellite/hybrid modes
            if (mapViewStyle === 'satellite' || mapViewStyle === 'hybrid') {
                mapboxLayout.mapbox.layers = [{
                    sourcetype: 'raster',
                    source: [
                        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
                    ],
                    below: 'traces',
                    opacity: basemapOpacity
                }];

                // Add labels overlay for hybrid mode (slightly more visible)
                if (mapViewStyle === 'hybrid') {
                    mapboxLayout.mapbox.layers.push({
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
            xaxis: {
                title: { text: d(xAxis), font: { size: 11 } },
                scaleanchor: 'y',
                scaleratio: 1,
                ...(lockAxes && axisRangesRef.current[attributeName]?.xRange
                    ? { range: axisRangesRef.current[attributeName].xRange, autorange: false }
                    : {})
            },
            yaxis: {
                title: { text: d(yAxis), font: { size: 11 } },
                ...(lockAxes && axisRangesRef.current[attributeName]?.yRange
                    ? { range: axisRangesRef.current[attributeName].yRange, autorange: false }
                    : {})
            },
            uirevision: lockAxes ? 'locked' : Date.now()
        };
    };

    return (
        <Box sx={{ p: 2 }}>
            <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant="h6">Attribute Map</Typography>
                <IconButton onClick={() => setControlsExpanded(!controlsExpanded)} size="small">{controlsExpanded ? <ExpandLess /> : <ExpandMore />}</IconButton>
            </Box>
            <Collapse in={controlsExpanded}>
                <Box sx={{ mb: 2, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                    <FormControl sx={{ minWidth: 150 }}><InputLabel>X-Axis</InputLabel><Select value={xAxis} onChange={(e) => setXAxis(e.target.value)} label="X-Axis" size="small">{numericColumns.map(col => (<MenuItem key={col.name} value={col.name}>{col.alias || col.name}</MenuItem>))}</Select></FormControl>
                    <FormControl sx={{ minWidth: 150 }}><InputLabel>Y-Axis</InputLabel><Select value={yAxis} onChange={(e) => setYAxis(e.target.value)} label="Y-Axis" size="small">{numericColumns.map(col => (<MenuItem key={col.name} value={col.name}>{col.alias || col.name}</MenuItem>))}</Select></FormControl>
                    <MultiColumnSelector columns={numericColumns} selectedColumns={attributes} onChange={setAttributes} label="Attributes to Map" />
                </Box>
                {/* Map View Controls */}
                <Box sx={{ mb: 2, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
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
                        <>
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
                                        sx={{ width: 350 }}
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
                        </>
                    )}
                </Box>
                {basemapEnabled && projectionError && (
                    <Alert severity="error" sx={{ mb: 2 }}>{projectionError}</Alert>
                )}
                {basemapEnabled && !epsgCode && !projectionError && (
                    <Alert severity="info" sx={{ mb: 2 }}>
                        Search for an EPSG code or type any code (e.g., 3719 or EPSG:3719)
                    </Alert>
                )}
            </Collapse>
            {!xAxis || !yAxis || attributes.length === 0 ? (<Typography color="text.secondary">Select X-axis, Y-axis, and attributes to display maps</Typography>) : (
                <Grid container spacing={2}>{attributes.map((attributeName) => (<Grid item xs={12} sm={6} lg={4} key={attributeName}><Paper sx={{ p: 1 }}><ExpandablePlotWrapper><Plot data={getPlotDataForAttribute(attributeName)} layout={getLayoutForAttribute(attributeName)} config={getPlotConfig({ filename: `map_${attributeName}` })} style={{ width: '100%' }} useResizeHandler={true} onRelayout={(e) => handleRelayout(attributeName, e)} /></ExpandablePlotWrapper></Paper></Grid>))}</Grid>)}
        </Box>
    );
};
