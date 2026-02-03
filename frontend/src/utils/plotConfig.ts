// Shared Plotly configuration for all plots
// Includes SVG export capability

import type { Config } from 'plotly.js';
import Plotly from 'plotly.js';

/**
 * Standard export font sizes for plots
 * Good for full-size exports viewed at 100%
 */
export const EXPORT_FONT_SIZES = {
    title: 20,
    axisTitle: 16,
    tickLabels: 14,
    legend: 14,
    markerSize: 10,
};

/**
 * PRESENTATION MODE font sizes - much larger for small graphs in PowerPoint
 * Use when placing multiple plots on a single slide
 * These are 2-3x larger than standard export sizes
 */
export const PRESENTATION_FONT_SIZES = {
    title: 36,
    axisTitle: 28,
    tickLabels: 24,
    legend: 22,
    markerSize: 16,
    lineWidth: 3,
};

/**
 * On-screen font sizes (smaller for compact display)
 */
export const SCREEN_FONT_SIZES = {
    title: 14,
    axisTitle: 11,
    tickLabels: 10,
    legend: 10,
    markerSize: 8,
};

/**
 * Standard Plotly config with SVG and PNG export buttons
 */
export const getPlotConfig = (options?: {
    filename?: string;
    responsive?: boolean;
    displayModeBar?: boolean;
}): Partial<Config> => {
    const { filename = 'plot', responsive = true, displayModeBar = true } = options || {};

    return {
        displayModeBar,
        displaylogo: false,
        responsive,
        toImageButtonOptions: {
            format: 'png',
            filename,
            height: 1000,
            width: 1400,
            scale: 2, // Higher resolution for crisp exports
        },
        modeBarButtonsToAdd: [
            {
                name: 'Download as SVG',
                title: 'Download as SVG',
                icon: {
                    width: 1000,
                    height: 1000,
                    path: 'M500 0C223.9 0 0 223.9 0 500s223.9 500 500 500 500-223.9 500-500S776.1 0 500 0zm-83.3 750H250V416.7h166.7V750zm333.3 0H583.3V250H750v500z',
                    transform: 'matrix(1 0 0 -1 0 1000)'
                },
                click: function(gd: any) {
                    // Use imported Plotly instance for downloadImage
                    Plotly.downloadImage(gd, {
                        format: 'svg',
                        filename: filename + '_svg',
                        height: 1000,
                        width: 1400,
                    });
                }
            }
        ],
        modeBarButtonsToRemove: ['lasso2d', 'select2d'] as any,
    };
};

/**
 * Get presentation-friendly layout settings for exports
 * Use these font sizes for better readability in PowerPoint/documents
 */
export const getExportLayoutSettings = () => ({
    font: {
        size: EXPORT_FONT_SIZES.tickLabels,
    },
    title: {
        font: { size: EXPORT_FONT_SIZES.title },
    },
    xaxis: {
        title: { font: { size: EXPORT_FONT_SIZES.axisTitle } },
        tickfont: { size: EXPORT_FONT_SIZES.tickLabels },
    },
    yaxis: {
        title: { font: { size: EXPORT_FONT_SIZES.axisTitle } },
        tickfont: { size: EXPORT_FONT_SIZES.tickLabels },
    },
    legend: {
        font: { size: EXPORT_FONT_SIZES.legend },
    },
    margin: { l: 70, r: 40, t: 60, b: 70 },
});

/**
 * Minimal config for plots that don't need the mode bar
 */
export const getMinimalPlotConfig = (responsive: boolean = false): Partial<Config> => ({
    displayModeBar: false,
    displaylogo: false,
    responsive,
});

/**
 * Config specifically for downhole plots (vertical, special handling)
 */
export const getDownholePlotConfig = (filename: string = 'downhole_plot'): Partial<Config> => ({
    displayModeBar: true,
    displaylogo: false,
    responsive: false,
    toImageButtonOptions: {
        format: 'png',
        filename,
        height: 1200,
        width: 800,
        scale: 2,
    },
    modeBarButtonsToAdd: [
        {
            name: 'Download as SVG',
            title: 'Download as SVG',
            icon: {
                width: 1000,
                height: 1000,
                path: 'M500 0C223.9 0 0 223.9 0 500s223.9 500 500 500 500-223.9 500-500S776.1 0 500 0zm-83.3 750H250V416.7h166.7V750zm333.3 0H583.3V250H750v500z',
                transform: 'matrix(1 0 0 -1 0 1000)'
            },
            click: function(gd: any) {
                // Use imported Plotly instance for downloadImage
                Plotly.downloadImage(gd, {
                    format: 'svg',
                    filename: filename + '_svg',
                    height: 1200,
                    width: 800,
                });
            }
        }
    ],
    modeBarButtonsToRemove: ['lasso2d', 'select2d'] as any,
});
