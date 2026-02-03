/**
 * MineralisationMapCell Component
 *
 * Renders a mineralisation element map for publication figures.
 * Uses the Attribute Manager styling (from attributeStore).
 */

import React, { useMemo } from 'react';
import Plot from 'react-plotly.js';
import { Box, Typography } from '@mui/material';
import { MapExtent } from './ScaleBar';
import { BasemapConfig } from './PublicationFigure';
import { getStyleArrays } from '../../../utils/attributeUtils';

export interface MineralisationConfig {
    enabled: boolean;
    column: string;            // Data column name (e.g., "Au_ppm") - for display only
    displayName: string;       // Display label (e.g., "Au")
    unit: string;              // Unit (e.g., "ppm", "ppb", "%")
}

interface MineralisationMapCellProps {
    config: MineralisationConfig;
    data: any[];
    xAxis: string;
    yAxis: string;
    extent: MapExtent;
    width: number;
    showCoordinateGrid?: boolean;
    isFirstInRow?: boolean;
    isLastRow?: boolean;
    basemap?: BasemapConfig;
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
}

const CoordinateTicksOverlay: React.FC<CoordinateTicksOverlayProps> = ({
    extent,
    width,
    height,
    xTickVals,
    yTickVals
}) => {
    const tickLength = 6;
    const tickColor = '#444444';

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
            {/* X-axis ticks */}
            {xTickVals.map((x, i) => {
                const px = xToPixel(x);
                return (
                    <g key={`x-${i}`}>
                        <line x1={px} y1={height - tickLength} x2={px} y2={height} stroke={tickColor} strokeWidth={1.5} />
                        <line x1={px} y1={0} x2={px} y2={tickLength} stroke={tickColor} strokeWidth={1.5} />
                    </g>
                );
            })}

            {/* Y-axis ticks */}
            {yTickVals.map((y, i) => {
                const py = yToPixel(y);
                return (
                    <g key={`y-${i}`}>
                        <line x1={0} y1={py} x2={tickLength} y2={py} stroke={tickColor} strokeWidth={1.5} />
                        <line x1={width - tickLength} y1={py} x2={width} y2={py} stroke={tickColor} strokeWidth={1.5} />
                    </g>
                );
            })}

            {/* Border */}
            <rect x={0} y={0} width={width} height={height} fill="none" stroke={tickColor} strokeWidth={1} />
        </svg>
    );
};

export const MineralisationMapCell: React.FC<MineralisationMapCellProps> = ({
    config,
    data,
    xAxis,
    yAxis,
    extent,
    width,
    showCoordinateGrid = true,
    isFirstInRow = true,
    isLastRow = true,
    basemap
}) => {
    const useMapbox = basemap?.enabled && basemap.transformedCoords;

    // Scale factor based on cell width
    const scaleFactor = Math.max(0.7, Math.min(1.5, width / 300));
    const labelFontSize = Math.round(11 * scaleFactor);
    const tickFontSize = Math.round(8 * scaleFactor);

    // Map dimensions
    const mapWidth = width;
    const mapHeight = useMemo(() => {
        const aspectRatio = extent.width / extent.height;
        return Math.round(mapWidth / aspectRatio);
    }, [extent, mapWidth]);

    // External label dimensions
    const externalLabelWidth = showCoordinateGrid ? Math.round(35 * scaleFactor) : 0;
    const externalLabelHeight = showCoordinateGrid ? Math.round(20 * scaleFactor) : 0;

    // Get styling from attribute store
    const { traces, validCount, totalCount } = useMemo(() => {
        // Get styles from attribute store
        const styleArrays = getStyleArrays(data);

        // Build plot data
        const x: number[] = [];
        const y: number[] = [];
        const colors: string[] = [];
        const sizes: number[] = [];
        const indices: number[] = [];
        let valid = 0;

        for (let i = 0; i < data.length; i++) {
            const row = data[i];
            const xVal = row[xAxis];
            const yVal = row[yAxis];
            if (xVal == null || yVal == null || isNaN(xVal) || isNaN(yVal)) continue;

            // Skip invisible points
            if (!styleArrays.visible[i]) continue;

            x.push(xVal);
            y.push(yVal);
            colors.push(styleArrays.colors[i]);
            sizes.push(Math.max(4, styleArrays.sizes[i] * 0.6)); // Scale down slightly for publication
            indices.push(i);
            valid++;
        }

        // Create trace
        let plotTraces: any[];
        if (useMapbox && basemap?.transformedCoords) {
            const lats = indices.map(i => basemap.transformedCoords!.lats[i]);
            const lons = indices.map(i => basemap.transformedCoords!.lons[i]);

            plotTraces = [{
                type: 'scattermapbox' as const,
                mode: 'markers' as const,
                lat: lats,
                lon: lons,
                marker: {
                    size: sizes,
                    color: colors,
                    opacity: 0.9
                },
                showlegend: false,
                hoverinfo: 'skip' as const
            }];
        } else {
            plotTraces = [{
                type: 'scatter' as const,
                mode: 'markers' as const,
                x: x,
                y: y,
                marker: {
                    size: sizes,
                    color: colors,
                    line: { width: 0.5, color: 'white' }
                },
                showlegend: false,
                hoverinfo: 'skip' as const
            }];
        }

        return {
            traces: plotTraces,
            validCount: valid,
            totalCount: data.length
        };
    }, [data, xAxis, yAxis, useMapbox, basemap]);

    // Calculate tick values
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

    // Calculate lat/lon bounds for mapbox
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
        const latPadding = (maxLat - minLat) * 0.08;
        const lonPadding = (maxLon - minLon) * 0.08;

        return {
            west: minLon - lonPadding,
            east: maxLon + lonPadding,
            south: minLat - latPadding,
            north: maxLat + latPadding
        };
    }, [basemap?.transformedCoords]);

    // Build layout
    const buildMapLayout = (): any => {
        if (useMapbox && basemap?.transformedCoords && mapboxBounds) {
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

    // Pixel conversion for labels
    const xToPixel = (x: number) => ((x - extent.minX) / extent.width) * mapWidth;
    const yToPixel = (y: number) => mapHeight - ((y - extent.minY) / extent.height) * mapHeight;

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
                {config.displayName} ({config.unit})
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

                {/* Map container */}
                <Box sx={{
                    position: 'relative',
                    width: mapWidth,
                    height: mapHeight,
                    flexShrink: 0
                }}>
                    <Plot
                        data={traces}
                        layout={buildMapLayout()}
                        config={{ staticPlot: true, displayModeBar: false }}
                        style={{ width: mapWidth, height: mapHeight }}
                    />

                    {showCoordinateGrid && (
                        <CoordinateTicksOverlay
                            extent={extent}
                            width={mapWidth}
                            height={mapHeight}
                            xTickVals={xTickVals}
                            yTickVals={yTickVals}
                        />
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
                n = {validCount}/{totalCount}
            </Typography>
        </Box>
    );
};

export default MineralisationMapCell;
