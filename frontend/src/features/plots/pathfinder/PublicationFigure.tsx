/**
 * PublicationFigure Component
 *
 * Renders a complete publication-ready pathfinder figure with:
 * - Shared legend at top
 * - Grid of element maps with probability plots
 * - Consistent scale across all maps
 * - Shared scale bar and north arrow
 * - Optional basemap support
 * - Multi-page support for long figures
 */

import React, { useMemo, forwardRef } from 'react';
import { Box, Typography } from '@mui/material';
import { PublicationMapCell } from './PublicationMapCell';
import { MineralisationMapCell, MineralisationConfig } from './MineralisationMapCell';
import { MineralisationLegend } from './MineralisationLegend';
import { MapExtent, calculateScaleBar } from './ScaleBar';
import { NorthArrow } from './NorthArrow';
import {
    ANOMALY_COLORS,
    ANOMALY_LABELS,
    ANOMALY_CLASSES,
    type PathfinderElement
} from '../../../utils/calculations/pathfinderConstants';
import { MapViewStyle } from '../../../utils/basemapUtils';

export type { MineralisationConfig } from './MineralisationMapCell';

export interface BasemapConfig {
    enabled: boolean;
    style: MapViewStyle;
    opacity: number;
    transformedCoords: {
        lats: number[];
        lons: number[];
        center: { lat: number; lon: number };
        zoom: number;
    } | null;
}

export interface PublicationFigureConfig {
    elements: PathfinderElement[];
    columns: number;
    widthMm: number;
    showScaleBar: boolean;
    showNorthArrow: boolean;
    showCoordinateGrid: boolean;
    showProbabilityPlots: boolean;
    basemap: BasemapConfig;
    landscape?: boolean;
    maxRowsPerPage?: number; // For multi-page support
    mineralisation?: MineralisationConfig; // Optional mineralisation map as first cell
}

interface PublicationFigureProps {
    config: PublicationFigureConfig;
    data: any[];
    xAxis: string;
    yAxis: string;
    getElementColumn: (element: PathfinderElement) => string | null;
    dpi?: number;
}

// Convert mm to pixels at given DPI
function mmToPx(mm: number, dpi: number = 96): number {
    return Math.round((mm / 25.4) * dpi);
}

// Calculate unified extent from all data points
export function calculateUnifiedExtent(
    data: any[],
    xAxis: string,
    yAxis: string,
    padding: number = 0.08
): MapExtent {
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    for (const row of data) {
        const x = row[xAxis];
        const y = row[yAxis];
        if (x != null && !isNaN(x)) {
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
        }
        if (y != null && !isNaN(y)) {
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
        }
    }

    const width = maxX - minX;
    const height = maxY - minY;
    const padX = width * padding;
    const padY = height * padding;

    return {
        minX: minX - padX,
        maxX: maxX + padX,
        minY: minY - padY,
        maxY: maxY + padY,
        width: width + 2 * padX,
        height: height + 2 * padY
    };
}

// Calculate optimal column count
export function getOptimalColumns(elementCount: number): number {
    if (elementCount <= 2) return 2;
    if (elementCount <= 4) return 2;
    if (elementCount <= 9) return 3;
    return 3;
}

// Legend component with scaled fonts
const Legend: React.FC<{ width: number; scaleFactor?: number }> = ({ width, scaleFactor = 1 }) => {
    const fontSize = Math.round(9 * scaleFactor);
    const dotSize = Math.round(10 * scaleFactor);

    return (
        <Box
            sx={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                gap: 2 * scaleFactor,
                py: 1,
                borderBottom: '1px solid #ccc',
                mb: 1,
                width: width
            }}
        >
            {ANOMALY_CLASSES.map(cls => (
                <Box key={cls} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box
                        sx={{
                            width: dotSize,
                            height: dotSize,
                            borderRadius: '50%',
                            bgcolor: ANOMALY_COLORS[cls],
                            border: '0.5px solid rgba(0,0,0,0.2)'
                        }}
                    />
                    <Typography
                        variant="caption"
                        sx={{ fontSize: fontSize, fontFamily: 'Arial, sans-serif' }}
                    >
                        {ANOMALY_LABELS[cls]}
                    </Typography>
                </Box>
            ))}
        </Box>
    );
};

// Shared Scale Bar component (positioned outside maps)
const SharedScaleBar: React.FC<{ extent: MapExtent; mapWidthPx: number; scaleFactor?: number }> = ({ extent, mapWidthPx, scaleFactor = 1 }) => {
    const config = calculateScaleBar(extent, mapWidthPx);
    const fontSize = Math.round(10 * scaleFactor);
    const barHeight = Math.round(16 * scaleFactor);

    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <svg width={config.pixelLength * scaleFactor} height={barHeight} viewBox={`0 0 ${config.pixelLength} 16`}>
                {/* Main bar */}
                <rect x={0} y={4} width={config.pixelLength} height={4} fill="#333" />
                {/* Left tick */}
                <rect x={0} y={0} width={1.5} height={12} fill="#333" />
                {/* Right tick */}
                <rect x={config.pixelLength - 1.5} y={0} width={1.5} height={12} fill="#333" />
            </svg>
            <Typography sx={{ fontSize: fontSize, fontFamily: 'Arial, sans-serif', fontWeight: 500 }}>
                {config.label}
            </Typography>
        </Box>
    );
};

// Single page component
interface PageProps {
    elements: PathfinderElement[];
    config: PublicationFigureConfig;
    data: any[];
    xAxis: string;
    yAxis: string;
    extent: MapExtent;
    cellWidth: number;
    cellGap: number;
    widthPx: number;
    getElementColumn: (element: PathfinderElement) => string | null;
    pageNumber: number;
    totalPages: number;
    showLegend: boolean;
    showFooter: boolean;
    scaleFactor: number;
    showMineralisation: boolean; // Whether to show mineralisation as first cell on this page
}

const PublicationPage: React.FC<PageProps> = ({
    elements,
    config,
    data,
    xAxis,
    yAxis,
    extent,
    cellWidth,
    cellGap,
    widthPx,
    getElementColumn,
    pageNumber,
    totalPages,
    showLegend,
    showFooter,
    scaleFactor,
    showMineralisation
}) => {
    // Build items to render: mineralisation (if enabled) + pathfinder elements
    type CellItem = { type: 'mineralisation' } | { type: 'pathfinder'; element: PathfinderElement };
    const cellItems: CellItem[] = [];

    if (showMineralisation && config.mineralisation?.enabled) {
        cellItems.push({ type: 'mineralisation' });
    }
    for (const element of elements) {
        cellItems.push({ type: 'pathfinder', element });
    }

    // Organize items into rows
    const rows: CellItem[][] = [];
    for (let i = 0; i < cellItems.length; i += config.columns) {
        rows.push(cellItems.slice(i, i + config.columns));
    }

    return (
        <Box
            data-publication-page={pageNumber}
            sx={{
                width: widthPx,
                backgroundColor: 'white',
                p: 1,
                fontFamily: 'Arial, sans-serif',
                mb: 2,
                pageBreakAfter: pageNumber < totalPages ? 'always' : 'auto'
            }}
        >
            {/* Mineralisation Legend (if enabled and showing on this page) */}
            {showLegend && showMineralisation && config.mineralisation?.enabled && (
                <MineralisationLegend
                    config={config.mineralisation}
                    width={widthPx - 16}
                    scaleFactor={scaleFactor}
                />
            )}

            {/* Pathfinder Legend */}
            {showLegend && <Legend width={widthPx - 16} scaleFactor={scaleFactor} />}

            {/* Page indicator if multiple pages */}
            {totalPages > 1 && (
                <Typography
                    variant="caption"
                    sx={{
                        display: 'block',
                        textAlign: 'right',
                        color: 'text.secondary',
                        fontSize: 8,
                        mb: 0.5
                    }}
                >
                    Page {pageNumber} of {totalPages}
                </Typography>
            )}

            {/* Grid of maps */}
            {rows.map((row, rowIndex) => (
                <Box
                    key={rowIndex}
                    sx={{
                        display: 'flex',
                        gap: `${cellGap}px`,
                        mb: rowIndex < rows.length - 1 ? `${cellGap}px` : 0
                    }}
                >
                    {row.map((item, colIndex) => {
                        if (item.type === 'mineralisation' && config.mineralisation) {
                            return (
                                <MineralisationMapCell
                                    key="mineralisation"
                                    config={config.mineralisation}
                                    data={data}
                                    xAxis={xAxis}
                                    yAxis={yAxis}
                                    extent={extent}
                                    width={cellWidth}
                                    showCoordinateGrid={config.showCoordinateGrid}
                                    isFirstInRow={colIndex === 0}
                                    isLastRow={rowIndex === rows.length - 1}
                                    basemap={config.basemap}
                                />
                            );
                        } else if (item.type === 'pathfinder') {
                            const elementColumn = getElementColumn(item.element);
                            if (!elementColumn) return null;

                            return (
                                <PublicationMapCell
                                    key={item.element}
                                    element={item.element}
                                    elementColumn={elementColumn}
                                    data={data}
                                    xAxis={xAxis}
                                    yAxis={yAxis}
                                    extent={extent}
                                    width={cellWidth}
                                    showScaleBar={false}
                                    showNorthArrow={false}
                                    showCoordinateGrid={config.showCoordinateGrid}
                                    showProbabilityPlot={config.showProbabilityPlots}
                                    isFirstInRow={colIndex === 0}
                                    isLastRow={rowIndex === rows.length - 1}
                                    basemap={config.basemap}
                                />
                            );
                        }
                        return null;
                    })}
                </Box>
            ))}

            {/* Shared Scale Bar and North Arrow (only on last page or footer enabled) */}
            {showFooter && (config.showScaleBar || config.showNorthArrow) && (
                <Box
                    sx={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        mt: 1.5,
                        pt: 1,
                        borderTop: '1px solid #ddd',
                        px: 1
                    }}
                >
                    {/* Scale Bar */}
                    {config.showScaleBar ? (
                        <SharedScaleBar extent={extent} mapWidthPx={cellWidth} scaleFactor={scaleFactor} />
                    ) : (
                        <Box />
                    )}

                    {/* North Arrow */}
                    {config.showNorthArrow && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <NorthArrow size={Math.round(20 * scaleFactor)} />
                        </Box>
                    )}
                </Box>
            )}
        </Box>
    );
};

export const PublicationFigure = forwardRef<HTMLDivElement, PublicationFigureProps>(({
    config,
    data,
    xAxis,
    yAxis,
    getElementColumn,
    dpi = 96
}, ref) => {
    // Calculate dimensions
    const widthPx = mmToPx(config.widthMm, dpi);

    // Calculate unified extent
    const extent = useMemo(
        () => calculateUnifiedExtent(data, xAxis, yAxis),
        [data, xAxis, yAxis]
    );

    // Calculate cell width - account for Y-axis label space on first column
    const cellGap = mmToPx(4, dpi);
    const totalGaps = (config.columns - 1) * cellGap;

    // Estimate scale factor first (will be refined after cellWidth is known)
    const estimatedCellWidth = Math.floor((widthPx - totalGaps) / config.columns);
    const estimatedScaleFactor = Math.max(0.7, Math.min(1.5, estimatedCellWidth / 300));

    // Y-axis label width (only when coordinate grid is shown)
    // This space is needed for first column cells
    const yAxisLabelWidth = config.showCoordinateGrid ? Math.round(35 * estimatedScaleFactor) : 0;

    // Available width for maps = total - yAxisLabelSpace - gaps
    const availableForMaps = widthPx - yAxisLabelWidth - totalGaps;
    const cellWidth = Math.floor(availableForMaps / config.columns);

    // Final scale factor based on actual cell width
    const scaleFactor = Math.max(0.7, Math.min(1.5, cellWidth / 300));

    // Calculate rows per page for multi-page support
    // Default: 2 rows for Word/portrait, 1 row for PowerPoint/landscape
    const maxRowsPerPage = config.maxRowsPerPage ||
        (config.landscape ? 1 : 2);

    // Split elements into pages, accounting for mineralisation taking one cell on page 1
    const cellsPerPage = maxRowsPerPage * config.columns;
    const hasMineralisation = config.mineralisation?.enabled ?? false;

    // Page 1 has one less pathfinder element slot if mineralisation is enabled
    const firstPageElements = hasMineralisation ? cellsPerPage - 1 : cellsPerPage;

    const pages: PathfinderElement[][] = [];
    if (config.elements.length <= firstPageElements) {
        // All elements fit on first page
        pages.push(config.elements);
    } else {
        // First page
        pages.push(config.elements.slice(0, firstPageElements));
        // Subsequent pages
        for (let i = firstPageElements; i < config.elements.length; i += cellsPerPage) {
            pages.push(config.elements.slice(i, i + cellsPerPage));
        }
    }

    // Single page case
    if (pages.length === 1) {
        return (
            <Box ref={ref}>
                <PublicationPage
                    elements={pages[0]}
                    config={config}
                    data={data}
                    xAxis={xAxis}
                    yAxis={yAxis}
                    extent={extent}
                    cellWidth={cellWidth}
                    cellGap={cellGap}
                    widthPx={widthPx}
                    getElementColumn={getElementColumn}
                    pageNumber={1}
                    totalPages={1}
                    showLegend={true}
                    showFooter={true}
                    scaleFactor={scaleFactor}
                    showMineralisation={hasMineralisation}
                />
            </Box>
        );
    }

    // Multi-page case
    return (
        <Box ref={ref}>
            {pages.map((pageElements, pageIndex) => (
                <PublicationPage
                    key={pageIndex}
                    elements={pageElements}
                    config={config}
                    data={data}
                    xAxis={xAxis}
                    yAxis={yAxis}
                    extent={extent}
                    cellWidth={cellWidth}
                    cellGap={cellGap}
                    widthPx={widthPx}
                    getElementColumn={getElementColumn}
                    pageNumber={pageIndex + 1}
                    totalPages={pages.length}
                    showLegend={true} // Show legend on all pages
                    showFooter={pageIndex === pages.length - 1} // Footer only on last page
                    scaleFactor={scaleFactor}
                    showMineralisation={pageIndex === 0 && hasMineralisation} // Only on first page
                />
            ))}
        </Box>
    );
});

PublicationFigure.displayName = 'PublicationFigure';

export default PublicationFigure;
