import React, { useState, useMemo, useCallback, useEffect } from 'react';
import Plot from 'react-plotly.js';
import {
    Box, Paper, Typography, FormControl, InputLabel, Select, MenuItem,
    TextField, Switch, FormControlLabel, Divider, Slider, Checkbox,
    ToggleButtonGroup, ToggleButton, Dialog, DialogTitle, DialogContent,
    List, ListItemButton, ListItemText, ListItemIcon, Grid, Chip, IconButton,
    InputAdornment, Button, Tooltip
} from '@mui/material';
import {
    Palette, TextFields, GridOn, Search, Close, Category,
    ScatterPlot as ScatterIcon, ChangeHistory, FolderOpen,
    CheckCircle, Warning, AutoAwesome, Edit as EditIcon
} from '@mui/icons-material';
import { useAppStore } from '../../store/appStore';
import { useClassificationStore, TOTAL_DIAGRAMS } from '../../store/classificationStore';
import { resolveDiagram, computeAxisValues, DiagramResolution } from '../../utils/classificationAxisResolver';
import { getPlotConfig, EXPORT_FONT_SIZES } from '../../utils/plotConfig';
import { ExpandablePlotWrapper } from '../../components/ExpandablePlotWrapper';
import {
    xmlCartesianToTernary,
    calculatePolygonCentroid,
    calculatePolygonArea,
    shouldUseExternalLabel
} from '../../types/classificationDiagram';
import { useAttributeStore } from '../../store/attributeStore';
import { getStyleArrays, shapeToPlotlySymbol, applyOpacityToColor, getSortedIndices, sortColumnsByPriority, getColumnDisplayName } from '../../utils/attributeUtils';
import { buildCustomData, buildTernaryHoverTemplate, buildScatterHoverTemplate } from '../../utils/tooltipUtils';
import { computePointDensities, computeTernaryDensities, DENSITY_JET_POINT_COLORSCALE } from '../../utils/densityGrid';

interface ClassificationPlotProps {
    plotId: string;
}

// Helper to format multi-line labels
function formatLabelMultiline(name: string, area: number): string {
    let maxWidth = 12;
    if (area < 30) maxWidth = 8;
    else if (area < 50) maxWidth = 10;
    else if (area < 80) maxWidth = 12;
    else maxWidth = 16;

    if (name.length <= maxWidth && !name.includes('/')) return name;

    // Handle slashes
    if (name.includes('/')) {
        const parts = name.split('/');
        if (parts.every(p => p.trim().length <= maxWidth)) {
            return parts.map(p => p.trim()).join('<br>');
        }
    }

    if (!name.includes(' ')) return name;

    // Wrap on spaces
    const words = name.split(' ');
    const lines: string[] = [];
    let currentLine: string[] = [];
    let currentLen = 0;

    for (const word of words) {
        if (currentLen + word.length + (currentLine.length ? 1 : 0) > maxWidth) {
            if (currentLine.length) {
                lines.push(currentLine.join(' '));
                currentLine = [word];
                currentLen = word.length;
            } else {
                lines.push(word);
                currentLen = 0;
            }
        } else {
            currentLine.push(word);
            currentLen += word.length + (currentLine.length > 1 ? 1 : 0);
        }
    }
    if (currentLine.length) lines.push(currentLine.join(' '));

    return lines.join('<br>');
}

// Get font size based on area and name length
function getFontSize(name: string, area: number, baseSize: number = 7): number {
    let size = baseSize;
    if (name.length > 18) size -= 1.5;
    else if (name.length > 14) size -= 1;
    else if (name.length > 10) size -= 0.5;

    if (area < 20) size -= 1.5;
    else if (area < 40) size -= 1;
    else if (area < 70) size -= 0.5;

    return Math.max(size, 4.5);
}

/** Computed axis sentinel value */
const COMPUTED_AXIS = '__computed__';

export const ClassificationPlot: React.FC<ClassificationPlotProps> = ({ plotId }) => {
    const { data, columns, setSelection, getPlotSettings, updatePlotSettings, getFilteredColumns, getDisplayData, getDisplayIndices, sampleIndices, geochemMappings } = useAppStore();
    const filteredColumns = getFilteredColumns();
    // Subscribe to all attribute state that affects styling to trigger re-renders
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { color: _color, shape: _shape, size: _size, filter: _filter, customEntries: _customEntries, emphasis: _emphasis, globalOpacity: _globalOpacity } = useAttributeStore();
    const d = (name: string) => getColumnDisplayName(columns, name);
    const displayData = useMemo(() => getDisplayData(), [data, sampleIndices]);
    const displayIndices = useMemo(() => getDisplayIndices(), [data, sampleIndices]);
    const {
        diagrams, renderOptions, categories,
        setSelectedDiagram, setRenderOptions, getSelectedDiagram
    } = useClassificationStore();

    // Get stored settings
    const storedSettings = getPlotSettings(plotId);

    // Local state for axis mappings
    const [axisA, setAxisA] = useState<string>(storedSettings.axisA || '');
    const [axisB, setAxisB] = useState<string>(storedSettings.axisB || '');
    const [axisC, setAxisC] = useState<string>(storedSettings.axisC || '');
    const [axisX, setAxisX] = useState<string>(storedSettings.axisX || '');
    const [axisY, setAxisY] = useState<string>(storedSettings.axisY || '');

    // Density state
    const [showDensity, setShowDensityLocal] = useState<boolean>(storedSettings.showDensity || false);
    const [densitySmoothing, setDensitySmoothingLocal] = useState<number>(storedSettings.densitySmoothing ?? 2.0);
    const [densityOpacity, setDensityOpacityLocal] = useState<number>(storedSettings.densityOpacity ?? 0.7);

    const setShowDensity = (show: boolean) => {
        setShowDensityLocal(show);
        updatePlotSettings(plotId, { showDensity: show });
    };
    const setDensitySmoothing = (smoothing: number) => {
        setDensitySmoothingLocal(smoothing);
        updatePlotSettings(plotId, { densitySmoothing: smoothing });
    };
    const setDensityOpacity = (opacity: number) => {
        setDensityOpacityLocal(opacity);
        updatePlotSettings(plotId, { densityOpacity: opacity });
    };

    // Dialog state
    const [selectorOpen, setSelectorOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

    const selectedDiagram = getSelectedDiagram();

    // Filter diagrams based on search and category
    const filteredDiagrams = useMemo(() => {
        let filtered = diagrams;

        if (selectedCategory) {
            filtered = filtered.filter(d => d.category === selectedCategory);
        }

        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            filtered = filtered.filter(d =>
                d.name.toLowerCase().includes(query) ||
                d.category.toLowerCase().includes(query) ||
                (d.subCategory && d.subCategory.toLowerCase().includes(query))
            );
        }

        return filtered;
    }, [diagrams, selectedCategory, searchQuery]);

    // Group diagrams by category for display
    const diagramsByCategory = useMemo(() => {
        const grouped: Record<string, typeof diagrams> = {};
        for (const diagram of filteredDiagrams) {
            if (!grouped[diagram.category]) {
                grouped[diagram.category] = [];
            }
            grouped[diagram.category].push(diagram);
        }
        return grouped;
    }, [filteredDiagrams]);

    // Category counts
    const categoryCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        for (const diagram of diagrams) {
            counts[diagram.category] = (counts[diagram.category] || 0) + 1;
        }
        return counts;
    }, [diagrams]);

    const handleSelectDiagram = (diagramId: string) => {
        setSelectedDiagram(diagramId);
        setSelectorOpen(false);
    };

    const numericColumns = useMemo(() =>
        sortColumnsByPriority(
            filteredColumns.filter(c => c && c.name && (c.type === 'numeric' || c.type === 'float' || c.type === 'integer'))
        ),
        [filteredColumns]
    );

    // Numeric column names for resolution
    const numericColumnNames = useMemo(() => numericColumns.map(c => c.name), [numericColumns]);

    // Resolve diagram variables to data columns
    const diagramResolution = useMemo<DiagramResolution | null>(() => {
        if (!selectedDiagram || geochemMappings.length === 0) return null;
        return resolveDiagram(selectedDiagram, geochemMappings, numericColumnNames);
    }, [selectedDiagram, geochemMappings, numericColumnNames]);

    // Compute values for compound formula axes
    const computedValues = useMemo<Record<string, (number | null)[]>>(() => {
        if (!diagramResolution || !displayData.length) return {};
        const result: Record<string, (number | null)[]> = {};
        for (const [key, axis] of Object.entries(diagramResolution.axes)) {
            if (axis.isComputed && axis.isFullyResolved) {
                result[key] = computeAxisValues(axis, displayData);
            }
        }
        return result;
    }, [diagramResolution, displayData]);

    // Auto-populate axis selectors when diagram changes
    useEffect(() => {
        if (!selectedDiagram || !diagramResolution) return;

        const setters: Record<string, (v: string) => void> = {
            a: setAxisA, b: setAxisB, c: setAxisC,
            x: setAxisX, y: setAxisY,
        };
        const storeKeys: Record<string, string> = {
            a: 'axisA', b: 'axisB', c: 'axisC',
            x: 'axisX', y: 'axisY',
        };

        const updates: Record<string, string> = {};

        for (const [key, axis] of Object.entries(diagramResolution.axes)) {
            const setter = setters[key];
            if (!setter) continue;

            if (axis.singleColumn) {
                // Single variable axis: auto-set to resolved column
                setter(axis.singleColumn);
                updates[storeKeys[key]] = axis.singleColumn;
            } else if (axis.isComputed && axis.isFullyResolved) {
                // Compound formula axis: set to computed sentinel
                setter(COMPUTED_AXIS);
                updates[storeKeys[key]] = COMPUTED_AXIS;
            }
        }

        if (Object.keys(updates).length > 0) {
            updatePlotSettings(plotId, updates);
        }
    }, [selectedDiagram?.id, diagramResolution]); // eslint-disable-line react-hooks/exhaustive-deps

    // Persist axis selections
    const handleAxisChange = useCallback((axis: string, value: string) => {
        switch (axis) {
            case 'a': setAxisA(value); updatePlotSettings(plotId, { axisA: value }); break;
            case 'b': setAxisB(value); updatePlotSettings(plotId, { axisB: value }); break;
            case 'c': setAxisC(value); updatePlotSettings(plotId, { axisC: value }); break;
            case 'x': setAxisX(value); updatePlotSettings(plotId, { axisX: value }); break;
            case 'y': setAxisY(value); updatePlotSettings(plotId, { axisY: value }); break;
        }
    }, [plotId, updatePlotSettings]);

    // Lasso selection handlers
    const handleSelected = useCallback((event: any) => {
        if (event && event.points && event.points.length > 0) {
            const indices = event.points.map((pt: any) => pt.customdata?.idx ?? pt.customdata);
            setSelection(indices);
        }
    }, [setSelection]);

    const handleDeselect = useCallback(() => {
        setSelection([]);
    }, [setSelection]);

    // Build ternary classification plot
    const buildTernaryPlot = useCallback(() => {
        if (!selectedDiagram || selectedDiagram.type !== 'ternary') return null;
        // Allow computed axes (COMPUTED_AXIS sentinel) or regular columns
        if (!axisA || !axisB || !axisC) return null;

        const traces: any[] = [];
        const { style, showLabels, fillOpacity } = renderOptions;
        const isBW = style === 'bw';

        // Process polygons
        for (const poly of selectedDiagram.polygons) {
            if (!poly.points.length) continue;

            const isOpen = poly.closed === false;

            // Convert points to ternary
            const ternaryPoints = poly.points.map(p => xmlCartesianToTernary(p.x, p.y));

            // Close polygon only if it's a closed shape
            const pts = [...ternaryPoints];
            if (!isOpen && (pts[0].a !== pts[pts.length - 1].a ||
                pts[0].b !== pts[pts.length - 1].b)) {
                pts.push(pts[0]);
            }

            const fillColor = (isBW || isOpen)
                ? 'rgba(0,0,0,0)'
                : `rgba(${poly.color.r}, ${poly.color.g}, ${poly.color.b}, ${fillOpacity})`;
            const lineColor = isBW
                ? 'black'
                : `rgb(${Math.floor(poly.color.r * 0.6)}, ${Math.floor(poly.color.g * 0.6)}, ${Math.floor(poly.color.b * 0.6)})`;

            // Add polygon trace
            traces.push({
                type: 'scatterternary',
                mode: 'lines',
                a: pts.map(p => p.a),
                b: pts.map(p => p.b),
                c: pts.map(p => p.c),
                fill: (isBW || isOpen) ? 'none' : 'toself',
                fillcolor: fillColor,
                line: { color: lineColor, width: isBW ? 1 : 1.2, ...(poly.smooth ? { shape: 'spline' } : {}) },
                name: poly.name,
                showlegend: false,
                hoverinfo: 'name'
            });

            // Add label
            if (showLabels) {
                const centroid = calculatePolygonCentroid(ternaryPoints);
                const area = calculatePolygonArea(ternaryPoints);
                const useExternal = shouldUseExternalLabel(centroid, area, poly.name.length);

                let labelPos = centroid;
                if (useExternal) {
                    // Move label outside
                    const { a, b, c } = centroid;
                    if (b > c && b > 50) {
                        labelPos = { a: Math.max(a - 3, 0), b: Math.min(b + 8, 100), c: 100 - Math.max(a - 3, 0) - Math.min(b + 8, 100) };
                    } else if (c > b && c > 50) {
                        labelPos = { a: Math.max(a - 3, 0), b: 100 - Math.max(a - 3, 0) - Math.min(c + 8, 100), c: Math.min(c + 8, 100) };
                    } else {
                        labelPos = { a: Math.max(a - 8, -5), b, c };
                    }

                    // Add leader line
                    traces.push({
                        type: 'scatterternary',
                        mode: 'lines',
                        a: [labelPos.a, centroid.a],
                        b: [labelPos.b, centroid.b],
                        c: [labelPos.c, centroid.c],
                        line: { color: 'black', width: 0.8 },
                        showlegend: false,
                        hoverinfo: 'skip'
                    });
                }

                const fontSize = getFontSize(poly.name, area);
                const displayName = formatLabelMultiline(poly.name, useExternal ? area * 2 : area);

                traces.push({
                    type: 'scatterternary',
                    mode: 'text',
                    a: [labelPos.a],
                    b: [labelPos.b],
                    c: [labelPos.c],
                    text: [displayName],
                    textfont: { size: fontSize, color: 'black', family: 'Arial' },
                    showlegend: false,
                    hoverinfo: 'skip',
                    cliponaxis: false
                });
            }
        }

        // Render ternary point features (TPointFeature)
        if (selectedDiagram.pointFeatures) {
            for (const pf of selectedDiagram.pointFeatures) {
                if (pf.a == null || pf.b == null) continue;
                const c = Math.max(0, 1 - pf.a - pf.b);
                traces.push({
                    type: 'scatterternary',
                    mode: pf.name ? 'markers+text' : 'markers',
                    a: [pf.a * 100],
                    b: [pf.b * 100],
                    c: [c * 100],
                    text: pf.name ? [pf.name] : undefined,
                    textposition: 'top center',
                    textfont: { size: 7, color: 'black', family: 'Arial' },
                    marker: { size: Math.max(pf.pixelRadius, 4), color: 'black', symbol: 'circle' },
                    showlegend: false,
                    hoverinfo: pf.name ? 'name' : 'skip',
                    name: pf.name
                });
            }
        }

        // Render ternary labels (TLabel)
        if (showLabels && selectedDiagram.labels) {
            for (const lbl of selectedDiagram.labels) {
                if (lbl.a == null || lbl.b == null) continue;
                const c = Math.max(0, 1 - lbl.a - lbl.b);
                traces.push({
                    type: 'scatterternary',
                    mode: 'text',
                    a: [lbl.a * 100],
                    b: [lbl.b * 100],
                    c: [c * 100],
                    text: [lbl.name],
                    textfont: { size: 8, color: 'black', family: 'Arial' },
                    showlegend: false,
                    hoverinfo: 'skip',
                    cliponaxis: false
                });
            }
        }

        // Add user data points
        if (renderOptions.showData && displayData.length > 0) {
            const styleArrays = getStyleArrays(displayData, displayIndices ?? undefined);
            const sortedIndices = getSortedIndices(styleArrays);

            const normalizedData: { a: number; b: number; c: number; idx: number }[] = [];

            for (const i of sortedIndices) {
                const d = displayData[i];
                const aVal = axisA === COMPUTED_AXIS && computedValues.a ? computedValues.a[i] : parseFloat(d[axisA]);
                const bVal = axisB === COMPUTED_AXIS && computedValues.b ? computedValues.b[i] : parseFloat(d[axisB]);
                const cVal = axisC === COMPUTED_AXIS && computedValues.c ? computedValues.c[i] : parseFloat(d[axisC]);
                if (aVal == null || bVal == null || cVal == null || isNaN(aVal) || isNaN(bVal) || isNaN(cVal)) continue;
                const a = aVal;
                const b = bVal;
                const c = cVal;
                const sum = a + b + c;

                if (sum > 0) {
                    normalizedData.push({
                        a: (a / sum) * 100,
                        b: (b / sum) * 100,
                        c: (c / sum) * 100,
                        idx: i
                    });
                }
            }

            if (normalizedData.length > 0) {
                const dataIndices = normalizedData.map(d => d.idx);
                const customData = buildCustomData(displayData, dataIndices, displayIndices ?? undefined);

                // Compute density for ternary points if enabled
                const ternDensity = showDensity ? computeTernaryDensities(
                    normalizedData.map(d => d.a),
                    normalizedData.map(d => d.b),
                    normalizedData.map(d => d.c),
                    { smoothingSigma: densitySmoothing }
                ) : null;

                traces.push({
                    type: 'scatterternary',
                    mode: 'markers',
                    a: normalizedData.map(d => d.a),
                    b: normalizedData.map(d => d.b),
                    c: normalizedData.map(d => d.c),
                    customdata: customData,
                    hovertemplate: buildTernaryHoverTemplate(selectedDiagram.axes.a?.name || d(axisA), selectedDiagram.axes.b?.name || d(axisB), selectedDiagram.axes.c?.name || d(axisC)),
                    marker: ternDensity ? {
                        size: normalizedData.map(d => styleArrays.sizes[d.idx]),
                        color: ternDensity.densities,
                        colorscale: DENSITY_JET_POINT_COLORSCALE,
                        showscale: false,
                        opacity: densityOpacity,
                        symbol: normalizedData.map(d => shapeToPlotlySymbol(styleArrays.shapes[d.idx])),
                        line: { width: 0.5, color: 'white' }
                    } : {
                        size: normalizedData.map(d => styleArrays.sizes[d.idx]),
                        color: normalizedData.map(d => applyOpacityToColor(styleArrays.colors[d.idx], styleArrays.opacity[d.idx])),
                        symbol: normalizedData.map(d => shapeToPlotlySymbol(styleArrays.shapes[d.idx])),
                        line: { width: 0.5, color: 'white' }
                    },
                    name: 'Data',
                    showlegend: true
                });
            }

            // Add boundary overlay on top of data so lines remain visible
            for (const poly of selectedDiagram.polygons) {
                if (!poly.points.length) continue;
                const isOpen = poly.closed === false;
                const ternaryPoints = poly.points.map(p => xmlCartesianToTernary(p.x, p.y));
                const pts = [...ternaryPoints];
                if (!isOpen && (pts[0].a !== pts[pts.length - 1].a || pts[0].b !== pts[pts.length - 1].b)) {
                    pts.push(pts[0]);
                }
                const lineColor = isBW
                    ? 'black'
                    : `rgb(${Math.floor(poly.color.r * 0.6)}, ${Math.floor(poly.color.g * 0.6)}, ${Math.floor(poly.color.b * 0.6)})`;
                traces.push({
                    type: 'scatterternary',
                    mode: 'lines',
                    a: pts.map(p => p.a),
                    b: pts.map(p => p.b),
                    c: pts.map(p => p.c),
                    fill: 'none',
                    line: { color: lineColor, width: isBW ? 1 : 1.2, ...(poly.smooth ? { shape: 'spline' } : {}) },
                    showlegend: false,
                    hoverinfo: 'skip'
                });
            }
        }

        const layout: any = {
            title: { text: `<b>${selectedDiagram.name}</b>`, x: 0.5, font: { size: EXPORT_FONT_SIZES.title } },
            autosize: true,
            height: 650,
            font: { size: EXPORT_FONT_SIZES.tickLabels },
            ternary: {
                sum: 100,
                aaxis: {
                    title: { text: `<b>${selectedDiagram.axes.a?.name || d(axisA)}</b>`, font: { size: EXPORT_FONT_SIZES.axisTitle } },
                    tickfont: { size: EXPORT_FONT_SIZES.tickLabels },
                    min: 0,
                    linewidth: 2.5,
                    linecolor: 'black',
                    showgrid: renderOptions.showGrid,
                    gridcolor: 'rgba(0,0,0,0.15)'
                },
                baxis: {
                    title: { text: `<b>${selectedDiagram.axes.b?.name || d(axisB)}</b>`, font: { size: EXPORT_FONT_SIZES.axisTitle } },
                    tickfont: { size: EXPORT_FONT_SIZES.tickLabels },
                    min: 0,
                    linewidth: 2.5,
                    linecolor: 'black',
                    showgrid: renderOptions.showGrid,
                    gridcolor: 'rgba(0,0,0,0.15)'
                },
                caxis: {
                    title: { text: `<b>${selectedDiagram.axes.c?.name || d(axisC)}</b>`, font: { size: EXPORT_FONT_SIZES.axisTitle } },
                    tickfont: { size: EXPORT_FONT_SIZES.tickLabels },
                    min: 0,
                    linewidth: 2.5,
                    linecolor: 'black',
                    showgrid: renderOptions.showGrid,
                    gridcolor: 'rgba(0,0,0,0.15)'
                },
                bgcolor: 'white'
            },
            showlegend: renderOptions.showData && displayData.length > 0,
            dragmode: 'lasso',
            selectdirection: 'any',
            paper_bgcolor: 'white',
            margin: { l: 70, r: 70, t: 80, b: 70 }
        };

        return { traces, layout };
    }, [selectedDiagram, axisA, axisB, axisC, displayData, displayIndices, renderOptions, computedValues, showDensity, densitySmoothing, densityOpacity]);

    // Build XY classification plot
    const buildXYPlot = useCallback(() => {
        if (!selectedDiagram || selectedDiagram.type !== 'xy') return null;
        if (!axisX || !axisY) return null;

        const traces: any[] = [];
        const { style, showLabels, fillOpacity } = renderOptions;
        const isBW = style === 'bw';

        // Find bounds from explicit bounds or polygon extents
        let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
        if (selectedDiagram.bounds) {
            const b = selectedDiagram.bounds;
            xMin = b.x;
            yMin = b.y;
            xMax = b.x + b.w;
            yMax = b.y + b.h;
        } else {
            for (const poly of selectedDiagram.polygons) {
                for (const p of poly.points) {
                    xMin = Math.min(xMin, p.x);
                    xMax = Math.max(xMax, p.x);
                    yMin = Math.min(yMin, p.y);
                    yMax = Math.max(yMax, p.y);
                }
            }
        }

        const xIsLog = selectedDiagram.axes.x?.log === true;
        const yIsLog = selectedDiagram.axes.y?.log === true;

        // Process polygons
        for (const poly of selectedDiagram.polygons) {
            if (!poly.points.length) continue;

            const isOpen = poly.closed === false;
            const pts = [...poly.points];
            if (!isOpen && (pts[0].x !== pts[pts.length - 1].x || pts[0].y !== pts[pts.length - 1].y)) {
                pts.push(pts[0]);
            }

            const fillColor = (isBW || isOpen)
                ? 'rgba(0,0,0,0)'
                : `rgba(${poly.color.r}, ${poly.color.g}, ${poly.color.b}, ${fillOpacity})`;
            const lineColor = isBW
                ? 'black'
                : `rgb(${Math.floor(poly.color.r * 0.6)}, ${Math.floor(poly.color.g * 0.6)}, ${Math.floor(poly.color.b * 0.6)})`;

            traces.push({
                type: 'scatter',
                mode: 'lines',
                x: pts.map(p => p.x),
                y: pts.map(p => p.y),
                fill: (isBW || isOpen) ? 'none' : 'toself',
                fillcolor: fillColor,
                line: { color: lineColor, width: isBW ? 1 : 1.2, ...(poly.smooth ? { shape: 'spline' } : {}) },
                name: poly.name,
                showlegend: false,
                hoverinfo: 'name'
            });

            // Add label at labelPos if available
            if (showLabels && poly.labelPos && 'x' in poly.labelPos) {
                traces.push({
                    type: 'scatter',
                    mode: 'text',
                    x: [poly.labelPos.x],
                    y: [poly.labelPos.y],
                    text: [poly.name],
                    textfont: { size: 8, color: 'black', family: 'Arial' },
                    showlegend: false,
                    hoverinfo: 'skip'
                });
            }
        }

        // Render <Line> elements (y = mx + c)
        if (selectedDiagram.lines) {
            for (const line of selectedDiagram.lines) {
                // Generate line across the plot bounds
                const lineXs = [xMin, xMax];
                const lineYs = lineXs.map(x => line.slope * x + line.intercept);
                const lineColor = isBW
                    ? 'black'
                    : `rgb(${line.color.r}, ${line.color.g}, ${line.color.b})`;
                traces.push({
                    type: 'scatter',
                    mode: 'lines',
                    x: lineXs,
                    y: lineYs,
                    line: { color: lineColor, width: 1.5, dash: 'dash' },
                    name: line.name,
                    showlegend: false,
                    hoverinfo: line.name ? 'name' : 'skip'
                });
                // Add line label
                if (showLabels && line.name) {
                    const midX = (xMin + xMax) / 2;
                    const midY = line.slope * midX + line.intercept;
                    traces.push({
                        type: 'scatter',
                        mode: 'text',
                        x: [midX],
                        y: [midY],
                        text: [line.name],
                        textposition: 'top center',
                        textfont: { size: 7, color: lineColor, family: 'Arial' },
                        showlegend: false,
                        hoverinfo: 'skip'
                    });
                }
            }
        }

        // Render XY point features
        if (selectedDiagram.pointFeatures) {
            for (const pf of selectedDiagram.pointFeatures) {
                if (pf.x == null || pf.y == null) continue;
                traces.push({
                    type: 'scatter',
                    mode: pf.name ? 'markers+text' : 'markers',
                    x: [pf.x],
                    y: [pf.y],
                    text: pf.name ? [pf.name] : undefined,
                    textposition: 'top center',
                    textfont: { size: 7, color: 'black', family: 'Arial' },
                    marker: { size: Math.max(pf.pixelRadius, 4), color: 'black', symbol: 'circle' },
                    showlegend: false,
                    hoverinfo: pf.name ? 'name' : 'skip',
                    name: pf.name
                });
            }
        }

        // Render XY labels
        if (showLabels && selectedDiagram.labels) {
            for (const lbl of selectedDiagram.labels) {
                if (lbl.x == null || lbl.y == null) continue;
                traces.push({
                    type: 'scatter',
                    mode: 'text',
                    x: [lbl.x],
                    y: [lbl.y],
                    text: [lbl.name],
                    textfont: { size: 8, color: 'black', family: 'Arial' },
                    showlegend: false,
                    hoverinfo: 'skip'
                });
            }
        }

        // Add user data points
        if (renderOptions.showData && displayData.length > 0) {
            const styleArrays = getStyleArrays(displayData, displayIndices ?? undefined);
            const sortedIndices = getSortedIndices(styleArrays);

            const validData: { x: number; y: number; idx: number }[] = [];

            for (const i of sortedIndices) {
                const d = displayData[i];
                const x = axisX === COMPUTED_AXIS && computedValues.x ? (computedValues.x[i] ?? NaN) : Number(d[axisX]);
                const y = axisY === COMPUTED_AXIS && computedValues.y ? (computedValues.y[i] ?? NaN) : Number(d[axisY]);

                if (!isNaN(x) && !isNaN(y)) {
                    validData.push({ x, y, idx: i });
                }
            }

            if (validData.length > 0) {
                const dataIndices = validData.map(d => d.idx);
                const customData = buildCustomData(displayData, dataIndices, displayIndices ?? undefined);

                // Compute per-point density if enabled
                let xyDensity: number[] | null = null;
                if (showDensity && validData.length >= 10) {
                    const densityPoints = validData.filter(dd =>
                        (!xIsLog || dd.x > 0) && (!yIsLog || dd.y > 0)
                    );
                    if (densityPoints.length >= 10) {
                        const densityX = densityPoints.map(dd => xIsLog ? Math.log10(dd.x) : dd.x);
                        const densityY = densityPoints.map(dd => yIsLog ? Math.log10(dd.y) : dd.y);
                        const result = computePointDensities(densityX, densityY, { smoothingSigma: densitySmoothing });
                        if (result) {
                            // Map back to full validData array
                            xyDensity = new Array(validData.length).fill(0);
                            const densitySet = new Set(densityPoints.map(dd => dd.idx));
                            let di = 0;
                            for (let vi = 0; vi < validData.length; vi++) {
                                if (densitySet.has(validData[vi].idx)) {
                                    xyDensity[vi] = result.densities[di++];
                                }
                            }
                        }
                    }
                }

                traces.push({
                    type: 'scatter',
                    mode: 'markers',
                    x: validData.map(d => d.x),
                    y: validData.map(d => d.y),
                    customdata: customData,
                    hovertemplate: buildScatterHoverTemplate(selectedDiagram.axes.x?.name || d(axisX), selectedDiagram.axes.y?.name || d(axisY)),
                    marker: xyDensity ? {
                        size: validData.map(d => styleArrays.sizes[d.idx]),
                        color: xyDensity,
                        colorscale: DENSITY_JET_POINT_COLORSCALE,
                        showscale: false,
                        opacity: densityOpacity,
                        symbol: validData.map(d => shapeToPlotlySymbol(styleArrays.shapes[d.idx])),
                        line: { width: 0.5, color: 'white' }
                    } : {
                        size: validData.map(d => styleArrays.sizes[d.idx]),
                        color: validData.map(d => applyOpacityToColor(styleArrays.colors[d.idx], styleArrays.opacity[d.idx])),
                        symbol: validData.map(d => shapeToPlotlySymbol(styleArrays.shapes[d.idx])),
                        line: { width: 0.5, color: 'white' }
                    },
                    name: 'Data',
                    showlegend: true
                });
            }

            // Add boundary overlay on top of data so lines remain visible
            for (const poly of selectedDiagram.polygons) {
                if (!poly.points.length) continue;
                const isOpen = poly.closed === false;
                const pts = [...poly.points];
                if (!isOpen && (pts[0].x !== pts[pts.length - 1].x || pts[0].y !== pts[pts.length - 1].y)) {
                    pts.push(pts[0]);
                }
                const lineColor = isBW
                    ? 'black'
                    : `rgb(${Math.floor(poly.color.r * 0.6)}, ${Math.floor(poly.color.g * 0.6)}, ${Math.floor(poly.color.b * 0.6)})`;
                traces.push({
                    type: 'scatter',
                    mode: 'lines',
                    x: pts.map(p => p.x),
                    y: pts.map(p => p.y),
                    fill: 'none',
                    line: { color: lineColor, width: isBW ? 1 : 1.2, ...(poly.smooth ? { shape: 'spline' } : {}) },
                    showlegend: false,
                    hoverinfo: 'skip'
                });
            }
        }

        const layout: any = {
            title: { text: `<b>${selectedDiagram.name}</b>`, x: 0.5, font: { size: EXPORT_FONT_SIZES.title } },
            autosize: true,
            height: 550,
            font: { size: EXPORT_FONT_SIZES.tickLabels },
            xaxis: {
                title: { text: `<b>${selectedDiagram.axes.x?.name || d(axisX)}</b>`, font: { size: EXPORT_FONT_SIZES.axisTitle } },
                tickfont: { size: EXPORT_FONT_SIZES.tickLabels },
                ...(xIsLog
                    ? { type: 'log' as const, range: [Math.log10(Math.max(xMin, 0.001)), Math.log10(Math.max(xMax, 0.01))] }
                    : { range: [xMin - (xMax - xMin) * 0.02, xMax + (xMax - xMin) * 0.02] }),
                showgrid: renderOptions.showGrid,
                gridcolor: 'rgba(0,0,0,0.12)',
                linewidth: 2,
                linecolor: 'black',
                showline: true,
                mirror: true
            },
            yaxis: {
                title: { text: `<b>${selectedDiagram.axes.y?.name || d(axisY)}</b>`, font: { size: EXPORT_FONT_SIZES.axisTitle } },
                tickfont: { size: EXPORT_FONT_SIZES.tickLabels },
                ...(yIsLog
                    ? { type: 'log' as const, range: [Math.log10(Math.max(yMin, 0.001)), Math.log10(Math.max(yMax, 0.01))] }
                    : { range: [yMin - (yMax - yMin) * 0.02, yMax + (yMax - yMin) * 0.02] }),
                showgrid: renderOptions.showGrid,
                gridcolor: 'rgba(0,0,0,0.12)',
                linewidth: 2,
                linecolor: 'black',
                showline: true,
                mirror: true
            },
            showlegend: renderOptions.showData && displayData.length > 0,
            dragmode: 'lasso',
            selectdirection: 'any',
            paper_bgcolor: 'white',
            plot_bgcolor: 'white',
            margin: { l: 70, r: 40, t: 60, b: 70 }
        };

        return { traces, layout };
    }, [selectedDiagram, axisX, axisY, displayData, displayIndices, renderOptions, computedValues, showDensity, densitySmoothing, densityOpacity]);

    // Build the appropriate plot
    const plotData = selectedDiagram?.type === 'ternary' ? buildTernaryPlot() : buildXYPlot();

    // Helper to build resolution status tooltip
    const getResolutionTooltip = (axisKey: string): string => {
        const axis = diagramResolution?.axes[axisKey];
        if (!axis || axis.variables.length === 0) return '';
        const lines: string[] = [];
        if (axis.formula) lines.push(`Formula: ${axis.formula}`);
        for (const v of axis.variables) {
            const col = v.resolvedColumn ?? '(missing)';
            const status = v.status === 'matched' ? 'direct' : v.status === 'converted' ? v.conversionDescription || 'converted' : 'not found';
            lines.push(`${v.element}: ${col} [${status}]`);
        }
        return lines.join('\n');
    };

    // Render axis selector with resolution indicator
    const renderAxisSelector = (axisKey: string, label: string, value: string) => {
        const axis = diagramResolution?.axes[axisKey];
        const hasComputed = axis?.isComputed && axis?.isFullyResolved;

        return (
            <Box sx={{ minWidth: 180 }}>
                {axis && axis.variables.length > 0 && (
                    <Tooltip title={getResolutionTooltip(axisKey)} placement="top" arrow>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                            {value === COMPUTED_AXIS ? (
                                <>
                                    <AutoAwesome sx={{ fontSize: 14, color: 'success.main' }} />
                                    <Typography variant="caption" color="success.main">
                                        Computed: {axis.formula}
                                    </Typography>
                                </>
                            ) : axis.singleColumn ? (
                                <>
                                    <CheckCircle sx={{ fontSize: 14, color: 'success.main' }} />
                                    <Typography variant="caption" color="success.main">
                                        Auto-matched
                                    </Typography>
                                </>
                            ) : axis.variables.some(v => v.status === 'missing') ? (
                                <>
                                    <Warning sx={{ fontSize: 14, color: 'warning.main' }} />
                                    <Typography variant="caption" color="warning.main">
                                        {axis.variables.filter(v => v.status === 'missing').length} variable{axis.variables.filter(v => v.status === 'missing').length > 1 ? 's' : ''} missing
                                    </Typography>
                                </>
                            ) : null}
                            {axis.variables.some(v => v.status === 'converted') && (
                                <Chip
                                    size="small"
                                    label="converted"
                                    sx={{ height: 16, fontSize: '0.6rem', ml: 0.5, bgcolor: 'warning.light', color: 'warning.contrastText' }}
                                />
                            )}
                        </Box>
                    </Tooltip>
                )}
                <FormControl size="small" fullWidth>
                    <InputLabel>{label}</InputLabel>
                    <Select
                        value={value}
                        label={label}
                        onChange={(e) => handleAxisChange(axisKey, e.target.value)}
                    >
                        <MenuItem value="">None</MenuItem>
                        {hasComputed && (
                            <MenuItem value={COMPUTED_AXIS}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    <AutoAwesome sx={{ fontSize: 16, color: 'primary.main' }} />
                                    <Typography variant="body2">Computed: {axis?.formula}</Typography>
                                </Box>
                            </MenuItem>
                        )}
                        {numericColumns.map(c => (
                            <MenuItem key={c.name} value={c.name}>{c.alias || c.name}</MenuItem>
                        ))}
                    </Select>
                </FormControl>
            </Box>
        );
    };

    return (
        <Box sx={{ p: 2 }}>
            {/* Diagram Selector */}
            <Paper sx={{ p: 2, mb: 2 }}>
                <Typography variant="subtitle1" gutterBottom fontWeight="bold">
                    Classification Diagram ({TOTAL_DIAGRAMS} available)
                </Typography>

                {/* Selected diagram display / selector button */}
                <Button
                    variant="outlined"
                    onClick={() => setSelectorOpen(true)}
                    fullWidth
                    sx={{
                        justifyContent: 'flex-start',
                        textTransform: 'none',
                        py: 1.5,
                        mb: 2,
                        borderColor: selectedDiagram ? 'primary.main' : 'grey.400'
                    }}
                    startIcon={selectedDiagram?.type === 'ternary' ? <ChangeHistory /> : <ScatterIcon />}
                >
                    {selectedDiagram ? (
                        <Box sx={{ textAlign: 'left' }}>
                            <Typography variant="body1" fontWeight="medium">
                                {selectedDiagram.name}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                                {selectedDiagram.category} • {selectedDiagram.type === 'ternary' ? 'Ternary' : 'XY'} diagram
                            </Typography>
                        </Box>
                    ) : (
                        <Typography color="text.secondary">
                            Click to select a classification diagram...
                        </Typography>
                    )}
                </Button>

                {/* Diagram Selector Dialog */}
                <Dialog
                    open={selectorOpen}
                    onClose={() => setSelectorOpen(false)}
                    maxWidth="md"
                    fullWidth
                    PaperProps={{ sx: { height: '70vh' } }}
                >
                    <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Category />
                            <Typography variant="h6">Select Classification Diagram</Typography>
                        </Box>
                        <IconButton onClick={() => setSelectorOpen(false)} size="small">
                            <Close />
                        </IconButton>
                    </DialogTitle>
                    <DialogContent dividers sx={{ p: 0 }}>
                        <Grid container sx={{ height: '100%' }}>
                            {/* Left panel - Categories */}
                            <Grid item xs={3} sx={{ borderRight: 1, borderColor: 'divider', height: '100%', overflow: 'auto' }}>
                                <Box sx={{ p: 1 }}>
                                    <TextField
                                        size="small"
                                        fullWidth
                                        placeholder="Search diagrams..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        InputProps={{
                                            startAdornment: (
                                                <InputAdornment position="start">
                                                    <Search fontSize="small" />
                                                </InputAdornment>
                                            ),
                                        }}
                                    />
                                </Box>
                                <Divider />
                                <List dense>
                                    <ListItemButton
                                        selected={selectedCategory === null}
                                        onClick={() => setSelectedCategory(null)}
                                    >
                                        <ListItemIcon sx={{ minWidth: 32 }}>
                                            <FolderOpen fontSize="small" />
                                        </ListItemIcon>
                                        <ListItemText primary="All Diagrams" />
                                        <Chip label={diagrams.length} size="small" />
                                    </ListItemButton>
                                    {categories.map(cat => (
                                        <ListItemButton
                                            key={cat}
                                            selected={selectedCategory === cat}
                                            onClick={() => setSelectedCategory(cat)}
                                        >
                                            <ListItemIcon sx={{ minWidth: 32 }}>
                                                <Category fontSize="small" />
                                            </ListItemIcon>
                                            <ListItemText
                                                primary={cat}
                                                primaryTypographyProps={{ variant: 'body2', noWrap: true }}
                                            />
                                            <Chip label={categoryCounts[cat] || 0} size="small" />
                                        </ListItemButton>
                                    ))}
                                </List>
                            </Grid>

                            {/* Right panel - Diagram list */}
                            <Grid item xs={9} sx={{ height: '100%', overflow: 'auto' }}>
                                <Box sx={{ p: 1 }}>
                                    <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                                        {filteredDiagrams.length} diagram{filteredDiagrams.length !== 1 ? 's' : ''} found
                                    </Typography>

                                    {selectedCategory === null && !searchQuery ? (
                                        // Show grouped by category
                                        Object.entries(diagramsByCategory).map(([category, categoryDiagrams]) => (
                                            <Box key={category} sx={{ mb: 2 }}>
                                                <Typography
                                                    variant="subtitle2"
                                                    sx={{
                                                        px: 1,
                                                        py: 0.5,
                                                        bgcolor: 'grey.100',
                                                        borderRadius: 1,
                                                        fontWeight: 'bold',
                                                        mb: 0.5
                                                    }}
                                                >
                                                    {category} ({categoryDiagrams.length})
                                                </Typography>
                                                <List dense disablePadding>
                                                    {categoryDiagrams.map(diagram => (
                                                        <ListItemButton
                                                            key={diagram.id}
                                                            onClick={() => handleSelectDiagram(diagram.id)}
                                                            selected={selectedDiagram?.id === diagram.id}
                                                            sx={{ pl: 2 }}
                                                        >
                                                            <ListItemIcon sx={{ minWidth: 28 }}>
                                                                {diagram.type === 'ternary' ? (
                                                                    <ChangeHistory fontSize="small" color="primary" />
                                                                ) : (
                                                                    <ScatterIcon fontSize="small" color="secondary" />
                                                                )}
                                                            </ListItemIcon>
                                                            <ListItemText
                                                                primary={diagram.name}
                                                                secondary={diagram.subCategory}
                                                                primaryTypographyProps={{ variant: 'body2' }}
                                                                secondaryTypographyProps={{ variant: 'caption' }}
                                                            />
                                                            <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                                                                {diagram.id.startsWith('custom-') && (
                                                                    <Chip label="Custom" size="small" color="info" sx={{ fontSize: '0.6rem', height: 18 }} />
                                                                )}
                                                                <Chip
                                                                    label={diagram.type}
                                                                    size="small"
                                                                    variant="outlined"
                                                                    color={diagram.type === 'ternary' ? 'primary' : 'secondary'}
                                                                    sx={{ fontSize: '0.65rem', height: 20 }}
                                                                />
                                                                {diagram.id.startsWith('custom-') && (
                                                                    <Tooltip title="Edit in Diagram Editor">
                                                                        <IconButton
                                                                            size="small"
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                const { useDiagramEditorStore } = require('../../store/diagramEditorStore');
                                                                                useDiagramEditorStore.getState().loadDiagramForEditing(diagram);
                                                                                useAppStore.getState().setCurrentView('diagram-editor' as any);
                                                                                setSelectorOpen(false);
                                                                            }}
                                                                        >
                                                                            <EditIcon fontSize="small" />
                                                                        </IconButton>
                                                                    </Tooltip>
                                                                )}
                                                            </Box>
                                                        </ListItemButton>
                                                    ))}
                                                </List>
                                            </Box>
                                        ))
                                    ) : (
                                        // Show flat list when filtering
                                        <List dense>
                                            {filteredDiagrams.map(diagram => (
                                                <ListItemButton
                                                    key={diagram.id}
                                                    onClick={() => handleSelectDiagram(diagram.id)}
                                                    selected={selectedDiagram?.id === diagram.id}
                                                >
                                                    <ListItemIcon sx={{ minWidth: 28 }}>
                                                        {diagram.type === 'ternary' ? (
                                                            <ChangeHistory fontSize="small" color="primary" />
                                                        ) : (
                                                            <ScatterIcon fontSize="small" color="secondary" />
                                                        )}
                                                    </ListItemIcon>
                                                    <ListItemText
                                                        primary={diagram.name}
                                                        secondary={`${diagram.category}${diagram.subCategory ? ' • ' + diagram.subCategory : ''}`}
                                                        primaryTypographyProps={{ variant: 'body2' }}
                                                        secondaryTypographyProps={{ variant: 'caption' }}
                                                    />
                                                    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                                                        {diagram.id.startsWith('custom-') && (
                                                            <Chip label="Custom" size="small" color="info" sx={{ fontSize: '0.6rem', height: 18 }} />
                                                        )}
                                                        <Chip
                                                            label={diagram.type}
                                                            size="small"
                                                            variant="outlined"
                                                            color={diagram.type === 'ternary' ? 'primary' : 'secondary'}
                                                            sx={{ fontSize: '0.65rem', height: 20 }}
                                                        />
                                                        {diagram.id.startsWith('custom-') && (
                                                            <Tooltip title="Edit in Diagram Editor">
                                                                <IconButton
                                                                    size="small"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        const { useDiagramEditorStore } = require('../../store/diagramEditorStore');
                                                                        useDiagramEditorStore.getState().loadDiagramForEditing(diagram);
                                                                        useAppStore.getState().setCurrentView('diagram-editor' as any);
                                                                        setSelectorOpen(false);
                                                                    }}
                                                                >
                                                                    <EditIcon fontSize="small" />
                                                                </IconButton>
                                                            </Tooltip>
                                                        )}
                                                    </Box>
                                                </ListItemButton>
                                            ))}
                                        </List>
                                    )}
                                </Box>
                            </Grid>
                        </Grid>
                    </DialogContent>
                </Dialog>

                {selectedDiagram && (
                    <>
                        <Divider sx={{ my: 2 }} />

                        {/* Axis Mapping */}
                        <Typography variant="subtitle2" gutterBottom>
                            Map Data Columns to Diagram Axes
                            {diagramResolution && diagramResolution.totalVariables > 0 && (
                                <Chip
                                    size="small"
                                    label={`${diagramResolution.matchedCount}/${diagramResolution.totalVariables} matched`}
                                    color={diagramResolution.matchedCount === diagramResolution.totalVariables ? 'success' : 'warning'}
                                    sx={{ ml: 1, height: 20, fontSize: '0.7rem' }}
                                />
                            )}
                        </Typography>

                        {selectedDiagram.type === 'ternary' ? (
                            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                                {renderAxisSelector('a', selectedDiagram.axes.a?.name || 'A (Top)', axisA)}
                                {renderAxisSelector('b', selectedDiagram.axes.b?.name || 'B (Left)', axisB)}
                                {renderAxisSelector('c', selectedDiagram.axes.c?.name || 'C (Right)', axisC)}
                            </Box>
                        ) : (
                            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                                {renderAxisSelector('x', selectedDiagram.axes.x?.name || 'X Axis', axisX)}
                                {renderAxisSelector('y', selectedDiagram.axes.y?.name || 'Y Axis', axisY)}
                            </Box>
                        )}

                        <Divider sx={{ my: 2 }} />

                        {/* Render Options */}
                        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                            <ToggleButtonGroup
                                value={renderOptions.style}
                                exclusive
                                onChange={(_, v) => v && setRenderOptions({ style: v })}
                                size="small"
                            >
                                <ToggleButton value="color"><Palette fontSize="small" sx={{ mr: 0.5 }} />Color</ToggleButton>
                                <ToggleButton value="bw">B&W</ToggleButton>
                            </ToggleButtonGroup>

                            <FormControlLabel
                                control={
                                    <Switch
                                        checked={renderOptions.showLabels}
                                        onChange={(e) => setRenderOptions({ showLabels: e.target.checked })}
                                        size="small"
                                    />
                                }
                                label={<Typography variant="body2"><TextFields fontSize="small" sx={{ verticalAlign: 'middle', mr: 0.5 }} />Labels</Typography>}
                            />

                            <FormControlLabel
                                control={
                                    <Switch
                                        checked={renderOptions.showGrid}
                                        onChange={(e) => setRenderOptions({ showGrid: e.target.checked })}
                                        size="small"
                                    />
                                }
                                label={<Typography variant="body2"><GridOn fontSize="small" sx={{ verticalAlign: 'middle', mr: 0.5 }} />Grid</Typography>}
                            />

                            <FormControlLabel
                                control={
                                    <Switch
                                        checked={renderOptions.showData}
                                        onChange={(e) => setRenderOptions({ showData: e.target.checked })}
                                        size="small"
                                    />
                                }
                                label={<Typography variant="body2">Show Data</Typography>}
                            />

                            <FormControlLabel
                                control={
                                    <Checkbox
                                        checked={showDensity}
                                        onChange={(e) => setShowDensity(e.target.checked)}
                                        size="small"
                                    />
                                }
                                label={<Typography variant="body2">Density</Typography>}
                            />

                            {showDensity && (
                                <>
                                    <Box sx={{ minWidth: 110, px: 1 }}>
                                        <Typography variant="caption">Smoothing: {densitySmoothing.toFixed(1)}</Typography>
                                        <Slider
                                            value={densitySmoothing}
                                            onChange={(_, v) => setDensitySmoothing(v as number)}
                                            min={0.5} max={8} step={0.5}
                                            size="small"
                                        />
                                    </Box>
                                    <Box sx={{ minWidth: 110, px: 1 }}>
                                        <Typography variant="caption">Opacity: {Math.round(densityOpacity * 100)}%</Typography>
                                        <Slider
                                            value={densityOpacity}
                                            onChange={(_, v) => setDensityOpacity(v as number)}
                                            min={0.1} max={1} step={0.05}
                                            size="small"
                                        />
                                    </Box>
                                </>
                            )}
                        </Box>
                    </>
                )}
            </Paper>

            {/* Plot */}
            {plotData ? (
                <Paper sx={{ p: 1 }}>
                    <ExpandablePlotWrapper>
                        <Plot
                            data={plotData.traces}
                            layout={plotData.layout}
                            config={getPlotConfig({ filename: `classification_${selectedDiagram?.name?.replace(/\s+/g, '_') || 'diagram'}` })}
                            style={{ width: '100%' }}
                            onSelected={handleSelected}
                            onDeselect={handleDeselect}
                        />
                    </ExpandablePlotWrapper>
                </Paper>
            ) : (
                <Paper sx={{ p: 4, textAlign: 'center' }}>
                    <Typography color="text.secondary">
                        {!selectedDiagram
                            ? 'Select a classification diagram to display'
                            : selectedDiagram.type === 'ternary'
                                ? 'Select columns for A, B, and C axes'
                                : 'Select columns for X and Y axes'}
                    </Typography>
                </Paper>
            )}
        </Box>
    );
};
