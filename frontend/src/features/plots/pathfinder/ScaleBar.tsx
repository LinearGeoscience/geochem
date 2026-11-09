/**
 * ScaleBar Component
 *
 * Dynamic scale bar for publication-quality map figures.
 * Automatically calculates appropriate length based on map extent.
 */

import React from 'react';

interface MapExtent {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    width: number;
    height: number;
}

interface ScaleBarProps {
    extent: MapExtent;
    mapWidthPx: number;
    position?: 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';
    color?: string;
    backgroundColor?: string;
    style?: React.CSSProperties;
}

interface ScaleBarConfig {
    length: number;      // Length in map units (meters)
    label: string;       // Display label
    pixelLength: number; // Length in pixels
}

/**
 * Calculate optimal scale bar configuration
 */
function calculateScaleBar(extent: MapExtent, mapWidthPx: number): ScaleBarConfig {
    const unitsPerPixel = extent.width / mapWidthPx;

    // Target ~20% of map width for scale bar
    const targetPixels = mapWidthPx * 0.2;
    const targetUnits = targetPixels * unitsPerPixel;

    // Nice round values for scale bars (in meters)
    const niceValues = [
        10, 20, 25, 50, 100, 200, 250, 500,
        1000, 2000, 2500, 5000,
        10000, 20000, 25000, 50000,
        100000, 200000, 500000
    ];

    // Find the best nice value
    let scaleLength = niceValues[0];
    for (const val of niceValues) {
        if (val <= targetUnits * 1.5 && val >= targetUnits * 0.3) {
            scaleLength = val;
        }
        if (val > targetUnits * 1.5) break;
    }

    const pixelLength = scaleLength / unitsPerPixel;

    // Format label
    let label: string;
    if (scaleLength >= 1000) {
        const km = scaleLength / 1000;
        label = Number.isInteger(km) ? `${km} km` : `${km.toFixed(1)} km`;
    } else {
        label = `${scaleLength} m`;
    }

    return { length: scaleLength, label, pixelLength };
}

export const ScaleBar: React.FC<ScaleBarProps> = ({
    extent,
    mapWidthPx,
    position = 'bottom-left',
    color = '#333333',
    backgroundColor = 'rgba(255, 255, 255, 0.85)',
    style
}) => {
    const config = calculateScaleBar(extent, mapWidthPx);

    const barHeight = 4;
    const tickHeight = 8;
    const padding = 4;
    const fontSize = 10;

    const totalHeight = tickHeight + fontSize + padding * 2;

    // Position styles
    const positionStyles: React.CSSProperties = {
        position: 'absolute',
        ...(position.includes('bottom') ? { bottom: 8 } : { top: 8 }),
        ...(position.includes('left') ? { left: 8 } : { right: 8 }),
    };

    return (
        <div
            style={{
                ...positionStyles,
                backgroundColor,
                borderRadius: 2,
                padding: padding,
                ...style
            }}
        >
            <svg
                width={config.pixelLength}
                height={totalHeight - padding * 2}
                viewBox={`0 0 ${config.pixelLength} ${tickHeight + fontSize}`}
            >
                {/* Main bar */}
                <rect
                    x={0}
                    y={0}
                    width={config.pixelLength}
                    height={barHeight}
                    fill={color}
                />

                {/* Left tick */}
                <rect
                    x={0}
                    y={0}
                    width={1}
                    height={tickHeight}
                    fill={color}
                />

                {/* Right tick */}
                <rect
                    x={config.pixelLength - 1}
                    y={0}
                    width={1}
                    height={tickHeight}
                    fill={color}
                />

                {/* Label */}
                <text
                    x={config.pixelLength / 2}
                    y={tickHeight + fontSize}
                    textAnchor="middle"
                    fontSize={fontSize}
                    fontFamily="Arial, sans-serif"
                    fill={color}
                >
                    {config.label}
                </text>
            </svg>
        </div>
    );
};

// Export utility function for external use
export { calculateScaleBar };
export type { MapExtent, ScaleBarConfig };

export default ScaleBar;
