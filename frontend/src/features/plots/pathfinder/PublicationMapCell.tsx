/**
 * PublicationMapCell Component
 *
 * Renders a single pathfinder element cell for publication figures.
 * Includes: map (with optional basemap), coordinate ticks, probability plot, info text.
 */

import React, { useMemo } from 'react';
import Plot from 'react-plotly.js';
import { Box, Typography } from '@mui/material';
import { NorthArrow } from './NorthArrow';
import { ScaleBar, MapExtent } from './ScaleBar';
import { BasemapConfig } from './PublicationFigure';
import {
    ANOMALY_COLORS,
    ANOMALY_THRESHOLDS,
    type PathfinderElement,
    type AnomalyClass
} from '../../../utils/calculations/pathfinderConstants';
import { getPathfinderClass } from '../../../utils/calculations/pathfinderClassification';

interface PublicationMapCellProps {
    element: PathfinderElement;
    elementColumn: string;
    data: any[];
    xAxis: string;
    yAxis: string;
    extent: MapExtent;
    width: number;           // Cell width in pixels
    showScaleBar?: boolean;
    showNorthArrow?: boolean;
    showCoordinateGrid?: boolean;
    showProbabilityPlot?: boolean;
    isFirstInRow?: boolean;  // Show Y-axis labels only for first in row
    isLastRow?: boolean;     // Show X-axis labels only for last row
    basemap?: BasemapConfig;
}

// Get plot data for element with fixed extent
function getStaticPlotData(
    element: PathfinderElement,
    elementColumn: string,
    data: any[],
    xAxis: string,
    yAxis: string,
    basemap?: BasemapConfig
) {
    const pointsByClass: Record<AnomalyClass, { x: number[]; y: number[]; indices: number[] }> = {
        nodata: { x: [], y: [], indices: [] },
        background: { x: [], y: [], indices: [] },
        '2x': { x: [], y: [], indices: [] },
        '3x': { x: [], y: [], indices: [] },
        '5x': { x: [], y: [], indices: [] },
        '10x': { x: [], y: [], indices: [] }
    };

    let validCount = 0;

    for (let i = 0; i < data.length; i++) {
        const row = data[i];
        const x = row[xAxis];
        const y = row[yAxis];
        if (x == null || y == null || isNaN(x) || isNaN(y)) continue;

        const elementValue = row[elementColumn];
        const anomalyClass = getPathfinderClass(element, elementValue);

        if (anomalyClass === 'nodata') continue;

        pointsByClass[anomalyClass].x.push(x);
        pointsByClass[anomalyClass].y.push(y);
        pointsByClass[anomalyClass].indices.push(i);
        validCount++;
    }

    const traces: any[] = [];
    const classOrder: AnomalyClass[] = ['background', '2x', '3x', '5x', '10x'];

    const useMapbox = basemap?.enabled && basemap.transformedCoords;

    for (const cls of classOrder) {
        const points = pointsByClass[cls];
        if (points.x.length === 0) continue;

        if (useMapbox && basemap?.transformedCoords) {
            // Use scattermapbox for basemap mode
            const lats = points.indices.map(i => basemap.transformedCoords!.lats[i]);
            const lons = points.indices.map(i => basemap.transformedCoords!.lons[i]);

            traces.push({
                type: 'scattermapbox' as const,
                mode: 'markers' as const,
                lat: lats,
                lon: lons,
                marker: {
                    size: 8,
                    color: ANOMALY_COLORS[cls],
                    opacity: 0.9
                },
                showlegend: false,
                hoverinfo: 'skip' as const
            });
        } else {
            // Use regular scatter
            traces.push({
                type: 'scatter' as const,
                mode: 'markers' as const,
                x: points.x,
                y: points.y,
                marker: {
                    size: 6,
                    color: ANOMALY_COLORS[cls],
                    line: { width: 0.5, color: 'white' }
                },
                showlegend: false,
                hoverinfo: 'skip' as const
            });
        }
    }

    return { traces, validCount, totalCount: data.length };
}

// Get probability plot data
function getProbabilityPlotData(
    element: PathfinderElement,
    elementColumn: string,
    data: any[]
) {
    const values: number[] = [];
    for (const row of data) {
        const val = row[elementColumn];
        if (val != null && !isNaN(val) && val > 0) {
            values.push(val);
        }
    }

    if (values.length === 0) return null;

    values.sort((a, b) => a - b);

    const n = values.length;
    const probabilities = values.map((_, i) => ((i + 0.5) / n) * 100);

    const colors = values.map(val => {
        const cls = getPathfinderClass(element, val);
        return ANOMALY_COLORS[cls];
    });

    const trace = {
        type: 'scatter' as const,
        mode: 'markers' as const,
        x: values,
        y: probabilities,
        marker: {
            size: 3,
            color: colors,
            line: { width: 0 }
        },
        showlegend: false,
        hoverinfo: 'skip' as const
    };

    const thresholds = ANOMALY_THRESHOLDS[element];
    const thresholdLines = [
        { value: thresholds.background, color: ANOMALY_COLORS['2x'], label: '2x' },
        { value: thresholds.x2, color: ANOMALY_COLORS['3x'], label: '3x' },
        { value: thresholds.x3, color: ANOMALY_COLORS['5x'], label: '5x' },
        { value: thresholds.x5, color: ANOMALY_COLORS['10x'], label: '10x' }
    ];

    return { trace, thresholdLines, minVal: values[0], maxVal: values[values.length - 1] };
}

// Format coordinate tick labels
function formatCoordinate(value: number): string {
    if (Math.abs(value) >= 1000000) {
        return (value / 1000000).toFixed(1) + 'M';
    } else if (Math.abs(value) >= 1000) {
        return (value / 1000).toFixed(0) + 'k';
    }
    return value.toFixed(0);
}

// Calculate nice tick interval
function niceTickInterval(range: number, count: number): number {
    const rough = range / count;
    const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
    const residual = rough / magnitude;
    if (residual >= 5) return 5 * magnitude;
    if (residual >= 2) return 2 * magnitude;
    return magnitude;
}

// Coordinate Ticks Overlay Component
interface CoordinateTicksOverlayProps {
    extent: MapExtent;
    width: number;
    height: number;
    xTickVals: number[];
    yTickVals: number[];
    showLabels: boolean;
    isFirstInRow: boolean;
    isLastRow: boolean;
}

const CoordinateTicksOverlay: React.FC<CoordinateTicksOverlayProps> = ({
    extent,
    width,
    height,
    xTickVals,
    yTickVals,
    showLabels,
    isFirstInRow,
    isLastRow
}) => {
    const tickLength = 6;
    const tickColor = '#444444';
    const labelOffset = 10;

    // Convert data coordinates to pixel positions
    const xToPixel = (x: number) => ((x - extent.minX) / extent.width) * width;
    const yToPixel = (y: number) => height - ((y - extent.minY) / extent.height) * height;

    return (
        <svg
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: width,
                height: height,
                pointerEvents: 'none'
            }}
        >
            {/* X-axis ticks (bottom) */}
            {xTickVals.map((x, i) => {
                const px = xToPixel(x);
                return (
                    <g key={`x-${i}`}>
                        <line
                            x1={px}
                            y1={height - tickLength}
                            x2={px}
                            y2={height}
                            stroke={tickColor}
                            strokeWidth={1.5}
                        />
                        <line
                            x1={px}
                            y1={0}
                            x2={px}
                            y2={tickLength}
                            stroke={tickColor}
                            strokeWidth={1.5}
                        />
                        {showLabels && isLastRow && (
                            <text
                                x={px}
                                y={height + labelOffset + 8}
                                textAnchor="middle"
                                fontSize={8}
                                fontFamily="Arial, sans-serif"
                                fill={tickColor}
                            >
                                {formatCoordinate(x)}
                            </text>
                        )}
                    </g>
                );
            })}

            {/* Y-axis ticks (left) */}
            {yTickVals.map((y, i) => {
                const py = yToPixel(y);
                return (
                    <g key={`y-${i}`}>
                        <line
                            x1={0}
                            y1={py}
                            x2={tickLength}
                            y2={py}
                            stroke={tickColor}
                            strokeWidth={1.5}
                        />
                        <line
                            x1={width - tickLength}
                            y1={py}
                            x2={width}
                            y2={py}
                            stroke={tickColor}
                            strokeWidth={1.5}
                        />
                        {showLabels && isFirstInRow && (
                            <text
                                x={-labelOffset}
                                y={py + 3}
                                textAnchor="end"
                                fontSize={8}
                                fontFamily="Arial, sans-serif"
                                fill={tickColor}
                            >
                                {formatCoordinate(y)}
                            </text>
                        )}
                    </g>
                );
            })}

            {/* Border */}
            <rect
                x={0}
                y={0}
                width={width}
                height={height}
                fill="none"
                stroke={tickColor}
                strokeWidth={1}
            />
        </svg>
    );
};

export const PublicationMapCell: React.FC<PublicationMapCellProps> = ({
    element,
    elementColumn,
    data,
    xAxis,
    yAxis,
    extent,
    width,
    showScaleBar = false,
    showNorthArrow = false,
    showCoordinateGrid = true,
    showProbabilityPlot = true,
    isFirstInRow = true,
    isLastRow = true,
    basemap
}) => {
    const useMapbox = basemap?.enabled && basemap.transformedCoords;

    // Scale factor based on cell width (reference: 300px = 1.0)
    const scaleFactor = Math.max(0.7, Math.min(1.5, width / 300));

    // Scaled font sizes
    const labelFontSize = Math.round(11 * scaleFactor);
    const tickFontSize = Math.round(8 * scaleFactor);

    // FIXED: All maps have identical dimensions regardless of position
    // Labels are rendered OUTSIDE the map container via absolute positioning
    const mapWidth = width;
    const mapHeight = useMemo(() => {
        const aspectRatio = extent.width / extent.height;
        return Math.round(mapWidth / aspectRatio);
    }, [extent, mapWidth]);

    // External label dimensions (outside the map, not affecting map size)
    const externalLabelWidth = showCoordinateGrid ? Math.round(35 * scaleFactor) : 0;
    const externalLabelHeight = showCoordinateGrid ? Math.round(20 * scaleFactor) : 0;

    // Get plot data
    const { traces, validCount, totalCount } = useMemo(
        () => getStaticPlotData(element, elementColumn, data, xAxis, yAxis, basemap),
        [element, elementColumn, data, xAxis, yAxis, basemap]
    );

    // Get probability plot data
    const probData = useMemo(
        () => showProbabilityPlot ? getProbabilityPlotData(element, elementColumn, data) : null,
        [element, elementColumn, data, showProbabilityPlot]
    );

    const thresholds = ANOMALY_THRESHOLDS[element];
    const probPlotHeight = showProbabilityPlot ? 100 : 0;

    // Calculate tick values for coordinate grid
    const xTickCount = 3;
    const yTickCount = 3;

    const xInterval = niceTickInterval(extent.width, xTickCount);
    const yInterval = niceTickInterval(extent.height, yTickCount);

    const xTickVals: number[] = [];
    const xStart = Math.ceil(extent.minX / xInterval) * xInterval;
    for (let x = xStart; x <= extent.maxX; x += xInterval) {
        xTickVals.push(x);
    }

    const yTickVals: number[] = [];
    const yStart = Math.ceil(extent.minY / yInterval) * yInterval;
    for (let y = yStart; y <= extent.maxY; y += yInterval) {
        yTickVals.push(y);
    }

    // Calculate lat/lon bounds from transformed coordinates for mapbox
    const mapboxBounds = useMemo(() => {
        if (!basemap?.transformedCoords) return null;

        const { lats, lons } = basemap.transformedCoords;
        const validLats = lats.filter(l => !isNaN(l) && isFinite(l));
        const validLons = lons.filter(l => !isNaN(l) && isFinite(l));

        if (validLats.length === 0 || validLons.length === 0) return null;

        const minLat = Math.min(...validLats);
        const maxLat = Math.max(...validLats);
        const minLon = Math.min(...validLons);
        const maxLon = Math.max(...validLons);

        // Add padding (8% like the extent calculation)
        const latPadding = (maxLat - minLat) * 0.08;
        const lonPadding = (maxLon - minLon) * 0.08;

        return {
            west: minLon - lonPadding,
            east: maxLon + lonPadding,
            south: minLat - latPadding,
            north: maxLat + latPadding
        };
    }, [basemap?.transformedCoords]);

    // Build layout - ALL maps use IDENTICAL dimensions and zero margins
    const buildMapLayout = (): any => {
        if (useMapbox && basemap?.transformedCoords && mapboxBounds) {
            // Mapbox layout - use explicit bounds instead of center+zoom
            // This ensures the same geographic extent regardless of container size
            const mapboxStyle = basemap.style === 'satellite' || basemap.style === 'hybrid'
                ? 'white-bg' : 'open-street-map';

            const layers = basemap.style === 'satellite' || basemap.style === 'hybrid'
                ? [{
                    sourcetype: 'raster',
                    source: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
                    below: 'traces',
                    opacity: basemap.opacity
                }]
                : undefined;

            return {
                width: mapWidth,
                height: mapHeight,
                margin: { l: 0, r: 0, t: 0, b: 0 },
                mapbox: {
                    style: mapboxStyle,
                    bounds: mapboxBounds,
                    ...(layers && { layers })
                },
                showlegend: false,
                hovermode: false,
                paper_bgcolor: 'transparent'
            };
        } else {
            // Standard scatter layout - zero margins, full plot area
            // All maps are identical size with explicitly set ranges
            // IMPORTANT: Do NOT use scaleanchor/scaleratio - they override range settings
            return {
                width: mapWidth,
                height: mapHeight,
                margin: { l: 0, r: 0, t: 0, b: 0 },
                xaxis: {
                    range: [extent.minX, extent.maxX],
                    autorange: false,
                    fixedrange: true,
                    showgrid: false,
                    zeroline: false,
                    showticklabels: false,
                    showline: false
                },
                yaxis: {
                    range: [extent.minY, extent.maxY],
                    autorange: false,
                    fixedrange: true,
                    showgrid: false,
                    zeroline: false,
                    showticklabels: false,
                    showline: false
                },
                showlegend: false,
                hovermode: false,
                paper_bgcolor: 'white',
                plot_bgcolor: '#f5f5f5'
            };
        }
    };

    // Convert data coordinates to pixel positions for external labels
    const xToPixel = (x: number) => ((x - extent.minX) / extent.width) * mapWidth;
    const yToPixel = (y: number) => mapHeight - ((y - extent.minY) / extent.height) * mapHeight;

    // Total cell width: map width + label width for first column
    const totalCellWidth = width + (isFirstInRow && showCoordinateGrid ? externalLabelWidth : 0);

    return (
        <Box sx={{
            width: totalCellWidth,
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0
        }}>
            {/* Element label */}
            <Typography
                variant="subtitle2"
                sx={{
                    fontWeight: 'bold',
                    fontSize: labelFontSize,
                    mb: 0.5,
                    fontFamily: 'Arial, sans-serif',
                    ml: isFirstInRow && showCoordinateGrid ? `${externalLabelWidth}px` : 0
                }}
            >
                {element}
            </Typography>

            {/* Map row with external Y-axis labels */}
            <Box sx={{ display: 'flex', flexDirection: 'row' }}>
                {/* External Y-axis labels (only for first column) */}
                {isFirstInRow && showCoordinateGrid && (
                    <Box sx={{
                        width: externalLabelWidth,
                        height: mapHeight,
                        position: 'relative',
                        flexShrink: 0
                    }}>
                        {/* Y-axis title */}
                        <Typography
                            sx={{
                                position: 'absolute',
                                left: 0,
                                top: '50%',
                                transform: 'rotate(-90deg) translateX(-50%)',
                                transformOrigin: '0 0',
                                fontSize: tickFontSize,
                                fontFamily: 'Arial, sans-serif',
                                color: '#444',
                                whiteSpace: 'nowrap'
                            }}
                        >
                            Northing (m)
                        </Typography>
                        {/* Y-axis tick labels */}
                        {yTickVals.map((y, i) => (
                            <Typography
                                key={i}
                                sx={{
                                    position: 'absolute',
                                    right: 4,
                                    top: yToPixel(y),
                                    transform: 'translateY(-50%)',
                                    fontSize: Math.round(7 * scaleFactor),
                                    fontFamily: 'Arial, sans-serif',
                                    color: '#444'
                                }}
                            >
                                {formatCoordinate(y)}
                            </Typography>
                        ))}
                    </Box>
                )}

                {/* Map container - IDENTICAL size for all cells */}
                <Box
                    sx={{
                        position: 'relative',
                        width: mapWidth,
                        height: mapHeight,
                        flexShrink: 0
                    }}
                >
                    <Plot
                        data={traces}
                        layout={buildMapLayout()}
                        config={{
                            staticPlot: true,
                            displayModeBar: false
                        }}
                        style={{ width: mapWidth, height: mapHeight }}
                    />

                    {/* Coordinate ticks overlay (ticks only, no labels) */}
                    {showCoordinateGrid && (
                        <CoordinateTicksOverlay
                            extent={extent}
                            width={mapWidth}
                            height={mapHeight}
                            xTickVals={xTickVals}
                            yTickVals={yTickVals}
                            showLabels={false}
                            isFirstInRow={false}
                            isLastRow={false}
                        />
                    )}

                    {/* Scale bar overlay (if enabled per-cell) */}
                    {showScaleBar && (
                        <ScaleBar
                            extent={extent}
                            mapWidthPx={mapWidth}
                            position="bottom-left"
                            style={{
                                left: 10,
                                bottom: 10
                            }}
                        />
                    )}

                    {/* North arrow overlay (if enabled per-cell) */}
                    {showNorthArrow && (
                        <Box
                            sx={{
                                position: 'absolute',
                                top: 8,
                                right: 8,
                                backgroundColor: 'rgba(255,255,255,0.85)',
                                borderRadius: 0.5,
                                p: 0.25
                            }}
                        >
                            <NorthArrow size={16} />
                        </Box>
                    )}
                </Box>
            </Box>

            {/* External X-axis labels (only for last row) */}
            {isLastRow && showCoordinateGrid && (
                <Box sx={{
                    ml: isFirstInRow ? `${externalLabelWidth}px` : 0,
                    width: mapWidth,
                    height: externalLabelHeight,
                    position: 'relative'
                }}>
                    {/* X-axis tick labels */}
                    {xTickVals.map((x, i) => (
                        <Typography
                            key={i}
                            sx={{
                                position: 'absolute',
                                left: xToPixel(x),
                                top: 2,
                                transform: 'translateX(-50%)',
                                fontSize: Math.round(7 * scaleFactor),
                                fontFamily: 'Arial, sans-serif',
                                color: '#444'
                            }}
                        >
                            {formatCoordinate(x)}
                        </Typography>
                    ))}
                    {/* X-axis title */}
                    <Typography
                        sx={{
                            position: 'absolute',
                            left: '50%',
                            bottom: 0,
                            transform: 'translateX(-50%)',
                            fontSize: tickFontSize,
                            fontFamily: 'Arial, sans-serif',
                            color: '#444'
                        }}
                    >
                        Easting (m)
                    </Typography>
                </Box>
            )}

            {/* Probability Plot */}
            {showProbabilityPlot && probData && (
                <Box sx={{
                    mt: 0.5,
                    borderTop: '1px solid #ddd',
                    pt: 0.5,
                    ml: isFirstInRow && showCoordinateGrid ? `${externalLabelWidth}px` : 0
                }}>
                    <Plot
                        data={[probData.trace]}
                        layout={{
                            width: mapWidth,
                            height: Math.round(probPlotHeight * scaleFactor),
                            margin: {
                                l: isFirstInRow ? Math.round(35 * scaleFactor) : Math.round(25 * scaleFactor),
                                r: Math.round(10 * scaleFactor),
                                t: Math.round(5 * scaleFactor),
                                b: Math.round(25 * scaleFactor)
                            },
                            xaxis: {
                                type: 'log',
                                title: { text: `${element} (ppm)`, font: { size: tickFontSize, family: 'Arial' } },
                                tickfont: { size: Math.round(7 * scaleFactor), family: 'Arial' },
                                showgrid: true,
                                gridcolor: '#eee'
                            },
                            yaxis: {
                                title: isFirstInRow ? { text: 'Percentile', font: { size: tickFontSize, family: 'Arial' } } : undefined,
                                tickfont: { size: Math.round(7 * scaleFactor), family: 'Arial' },
                                range: [0, 100],
                                showgrid: true,
                                gridcolor: '#eee',
                                showticklabels: isFirstInRow
                            },
                            showlegend: false,
                            hovermode: false,
                            paper_bgcolor: 'white',
                            plot_bgcolor: 'white',
                            shapes: probData.thresholdLines.map(line => ({
                                type: 'line' as const,
                                x0: line.value,
                                x1: line.value,
                                y0: 0,
                                y1: 100,
                                line: { color: line.color, width: 1, dash: 'dash' as const }
                            })),
                            annotations: probData.thresholdLines.map(line => ({
                                x: Math.log10(line.value),
                                y: 92,
                                xref: 'x' as const,
                                yref: 'y' as const,
                                text: line.label,
                                showarrow: false,
                                font: { size: Math.round(7 * scaleFactor), color: line.color, family: 'Arial' }
                            }))
                        }}
                        config={{
                            staticPlot: true,
                            displayModeBar: false
                        }}
                        style={{ width: mapWidth }}
                    />
                </Box>
            )}

            {/* Info text */}
            <Typography
                variant="caption"
                sx={{
                    textAlign: 'center',
                    fontSize: tickFontSize,
                    color: 'text.secondary',
                    mt: 0.25,
                    fontFamily: 'Arial, sans-serif',
                    ml: isFirstInRow && showCoordinateGrid ? `${externalLabelWidth}px` : 0,
                    width: mapWidth
                }}
            >
                n = {validCount}/{totalCount} | Background: ≤{thresholds.background} ppm | 10x: &gt;{thresholds.x5} ppm
            </Typography>
        </Box>
    );
};

export default PublicationMapCell;
