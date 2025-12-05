import React, { useState, useRef, useCallback } from 'react';
import { Box, Paper, FormControl, InputLabel, Select, MenuItem, Grid, Typography, IconButton, Collapse } from '@mui/material';
import { ExpandMore, ExpandLess } from '@mui/icons-material';
import { MultiColumnSelector } from '../../components/MultiColumnSelector';
import { useAppStore } from '../../store/appStore';
import Plot from 'react-plotly.js';
import { ExpandablePlotWrapper } from '../../components/ExpandablePlotWrapper';
import { useAttributeStore } from '../../store/attributeStore';
import { getStyleArrays, shapeToPlotlySymbol, applyOpacityToColor, getSortedIndices, sortColumnsByPriority } from '../../utils/attributeUtils';
import { buildCustomData, buildMapHoverTemplate } from '../../utils/tooltipUtils';

interface AxisRangeCache {
    [key: string]: { xRange?: [number, number]; yRange?: [number, number] };
}

interface AttributeMapProps {
    plotId: string;
}

export const AttributeMap: React.FC<AttributeMapProps> = ({ plotId }) => {
    const { data, columns, lockAxes, getPlotSettings, updatePlotSettings, getFilteredColumns } = useAppStore();
    const filteredColumns = getFilteredColumns();
    useAttributeStore(); // Subscribe to changes

    // Get stored settings or defaults
    const storedSettings = getPlotSettings(plotId);

    const [xAxis, setXAxisLocal] = useState<string>(storedSettings.xAxis || '');
    const [yAxis, setYAxisLocal] = useState<string>(storedSettings.yAxis || '');
    const [attributes, setAttributesLocal] = useState<string[]>(storedSettings.attributes || []);
    const [controlsExpanded, setControlsExpandedLocal] = useState(storedSettings.controlsExpanded ?? true);

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

    const numericColumns = sortColumnsByPriority(
        filteredColumns.filter(c => c && c.name && (c.type === 'numeric' || c.type === 'float' || c.type === 'integer'))
    );

    const getPlotDataForAttribute = (_attributeName: string) => {
        if (!data.length || !xAxis || !yAxis) return [];

        // Get styles from attribute store (includes emphasis calculations)
        const styleArrays = getStyleArrays(data);

        // Get sorted indices for z-ordering (low-grade first, high-grade last/on top)
        const sortedIndices = getSortedIndices(styleArrays);

        // Build arrays in sorted order
        const sortedX: number[] = [];
        const sortedY: number[] = [];
        const sortedColors: string[] = [];
        const sortedShapes: string[] = [];
        const sortedSizes: number[] = [];

        for (const i of sortedIndices) {
            sortedX.push(data[i][xAxis]);
            sortedY.push(data[i][yAxis]);
            sortedColors.push(applyOpacityToColor(styleArrays.colors[i], styleArrays.opacity[i]));
            sortedShapes.push(styleArrays.shapes[i]);
            sortedSizes.push(styleArrays.sizes[i]);
        }

        // Build customdata for hover tooltips
        const customData = buildCustomData(data, sortedIndices);

        const trace: any = {
            type: 'scattergl',
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
        };

        return [trace];
    };

    return (
        <Box sx={{ p: 2 }}>
            <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant="h6">Attribute Map</Typography>
                <IconButton onClick={() => setControlsExpanded(!controlsExpanded)} size="small">{controlsExpanded ? <ExpandLess /> : <ExpandMore />}</IconButton>
            </Box>
            <Collapse in={controlsExpanded}>
                <Box sx={{ mb: 3, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                    <FormControl sx={{ minWidth: 150 }}><InputLabel>X-Axis</InputLabel><Select value={xAxis} onChange={(e) => setXAxis(e.target.value)} label="X-Axis" size="small">{numericColumns.map(col => (<MenuItem key={col.name} value={col.name}>{col.alias || col.name}</MenuItem>))}</Select></FormControl>
                    <FormControl sx={{ minWidth: 150 }}><InputLabel>Y-Axis</InputLabel><Select value={yAxis} onChange={(e) => setYAxis(e.target.value)} label="Y-Axis" size="small">{numericColumns.map(col => (<MenuItem key={col.name} value={col.name}>{col.alias || col.name}</MenuItem>))}</Select></FormControl>
                    <MultiColumnSelector columns={numericColumns} selectedColumns={attributes} onChange={setAttributes} label="Attributes to Map" />
                </Box>
            </Collapse>
            {!xAxis || !yAxis || attributes.length === 0 ? (<Typography color="text.secondary">Select X-axis, Y-axis, and attributes to display maps</Typography>) : (
                <Grid container spacing={2}>{attributes.map((attributeName) => (<Grid item xs={12} sm={6} lg={4} key={attributeName}><Paper sx={{ p: 1 }}><ExpandablePlotWrapper><Plot data={getPlotDataForAttribute(attributeName)} layout={{ title: { text: attributeName, font: { size: 14 } }, autosize: true, height: 350, hovermode: 'closest', xaxis: { title: { text: xAxis, font: { size: 11 } }, scaleanchor: 'y', scaleratio: 1, ...(lockAxes && axisRangesRef.current[attributeName]?.xRange ? { range: axisRangesRef.current[attributeName].xRange, autorange: false } : {}) }, yaxis: { title: { text: yAxis, font: { size: 11 } }, ...(lockAxes && axisRangesRef.current[attributeName]?.yRange ? { range: axisRangesRef.current[attributeName].yRange, autorange: false } : {}) }, margin: { l: 50, r: 40, t: 40, b: 50 }, uirevision: lockAxes ? 'locked' : Date.now() }} config={{ displayModeBar: true, displaylogo: false, responsive: true }} style={{ width: '100%' }} useResizeHandler={true} onRelayout={(e) => handleRelayout(attributeName, e)} /></ExpandablePlotWrapper></Paper></Grid>))}</Grid>)}
        </Box>
    );
};
