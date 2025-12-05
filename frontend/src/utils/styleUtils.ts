/**
 * Unified style utilities for consistent styling across all plots
 * Centralizes visibility filtering, color/shape/size application, and emphasis calculation
 *
 * NOTE: This file is deprecated. Use attributeUtils.ts instead.
 */

import { StyleRule, getStyleForValue, MARKER_SHAPES, EmphasisSettings } from '../store/styleStore';

export interface StyledDataPoint {
    originalIndex: number;
    data: any;
    color: string;
    shape: string;
    shapeSymbol: number;
    size: number;
    opacity: number;
    visible: boolean;
}

export interface StyleApplicationResult {
    visibleData: any[];
    visibleIndices: number[];
    colors: string[];
    shapes: string[];
    shapeSymbols: number[];
    sizes: number[];
    opacities: number[];
}

export interface PlotStyleOptions {
    data: any[];
    styleRules: StyleRule[];
    visibilityMap: Record<number, boolean>;
    globalOpacity: number;
    emphasis: EmphasisSettings;
    baseSize?: number;
    defaultColor?: string;
    defaultShape?: string;
}

/**
 * Check if a data point should be visible based on both visibilityMap and style rule visibility
 */
export function isPointVisible(
    dataPoint: any,
    index: number,
    visibilityMap: Record<number, boolean>,
    styleRules: StyleRule[]
): boolean {
    // Check visibilityMap first
    if (visibilityMap[index] === false) {
        return false;
    }

    // Check visibility for each active style rule
    // A point is hidden if ANY of its style values fall in a hidden range/category
    for (const rule of styleRules) {
        const value = dataPoint[rule.field];
        const styleValue = getStyleForValue(value, rule.field, rule.attribute, styleRules);

        // If getStyleForValue returns undefined, the range/category is hidden
        if (styleValue === undefined) {
            return false;
        }
    }

    return true;
}

/**
 * Filter data to only visible points and return their indices
 */
export function filterVisibleData(
    data: any[],
    visibilityMap: Record<number, boolean>,
    styleRules: StyleRule[]
): { visibleData: any[]; visibleIndices: number[] } {
    const visibleData: any[] = [];
    const visibleIndices: number[] = [];

    data.forEach((d, i) => {
        if (isPointVisible(d, i, visibilityMap, styleRules)) {
            visibleData.push(d);
            visibleIndices.push(i);
        }
    });

    return { visibleData, visibleIndices };
}

/**
 * Get color for a data point from style rules or return default
 */
export function getPointColor(
    dataPoint: any,
    styleRules: StyleRule[],
    defaultColor: string = '#1f77b4'
): string {
    const colorRule = styleRules.find(r => r.attribute === 'color');
    if (!colorRule) return defaultColor;

    const color = getStyleForValue(dataPoint[colorRule.field], colorRule.field, 'color', styleRules);
    return (color as string) || defaultColor;
}

/**
 * Get shape for a data point from style rules or return default
 */
export function getPointShape(
    dataPoint: any,
    styleRules: StyleRule[],
    defaultShape: string = 'circle'
): { shape: string; symbol: number } {
    const shapeRule = styleRules.find(r => r.attribute === 'shape');
    if (!shapeRule) {
        const defaultConfig = MARKER_SHAPES.find(s => s.value === defaultShape) || MARKER_SHAPES[0];
        return { shape: defaultShape, symbol: defaultConfig.symbol };
    }

    const shapeName = getStyleForValue(dataPoint[shapeRule.field], shapeRule.field, 'shape', styleRules);
    const shapeConfig = MARKER_SHAPES.find(s => s.value === shapeName);

    if (shapeConfig) {
        return { shape: shapeConfig.value, symbol: shapeConfig.symbol };
    }

    const defaultConfig = MARKER_SHAPES.find(s => s.value === defaultShape) || MARKER_SHAPES[0];
    return { shape: defaultShape, symbol: defaultConfig.symbol };
}

/**
 * Get size for a data point from style rules or return default
 */
export function getPointSize(
    dataPoint: any,
    styleRules: StyleRule[],
    defaultSize: number = 8
): number {
    const sizeRule = styleRules.find(r => r.attribute === 'size');
    if (!sizeRule) return defaultSize;

    const size = getStyleForValue(dataPoint[sizeRule.field], sizeRule.field, 'size', styleRules);
    return (size as number) || defaultSize;
}

/**
 * Apply all styling (color, shape, size, emphasis) to visible data
 * Returns arrays ready for Plotly traces
 *
 * @deprecated Use attributeUtils.ts getStyleArrays instead
 */
export function applyStylesToData(options: PlotStyleOptions): StyleApplicationResult {
    const {
        data,
        styleRules,
        visibilityMap,
        globalOpacity,
        emphasis: _emphasis,
        baseSize = 8,
        defaultColor = '#1f77b4',
        defaultShape = 'circle'
    } = options;

    // Filter to visible data
    const { visibleData, visibleIndices } = filterVisibleData(data, visibilityMap, styleRules);

    // Get style rules
    const colorRule = styleRules.find(r => r.attribute === 'color');
    const shapeRule = styleRules.find(r => r.attribute === 'shape');
    const sizeRule = styleRules.find(r => r.attribute === 'size');

    // Build style arrays
    const colors: string[] = [];
    const shapes: string[] = [];
    const shapeSymbols: number[] = [];
    const sizes: number[] = [];
    const opacities: number[] = [];

    visibleData.forEach((d) => {
        // Color
        if (colorRule) {
            const color = getStyleForValue(d[colorRule.field], colorRule.field, 'color', styleRules);
            colors.push((color as string) || defaultColor);
        } else {
            colors.push(defaultColor);
        }

        // Shape
        if (shapeRule) {
            const shapeName = getStyleForValue(d[shapeRule.field], shapeRule.field, 'shape', styleRules);
            const shapeConfig = MARKER_SHAPES.find(s => s.value === shapeName);
            shapes.push(shapeConfig?.value || defaultShape);
            shapeSymbols.push(shapeConfig?.symbol || 0);
        } else {
            shapes.push(defaultShape);
            shapeSymbols.push(0);
        }

        // Size
        let size = baseSize;
        if (sizeRule) {
            const styleSize = getStyleForValue(d[sizeRule.field], sizeRule.field, 'size', styleRules);
            size = (styleSize as number) || baseSize;
        }
        sizes.push(size);

        // Default opacity
        opacities.push(globalOpacity);
    });

    return {
        visibleData,
        visibleIndices,
        colors,
        shapes,
        shapeSymbols,
        sizes,
        opacities
    };
}

/**
 * Get the active color rule field name if any
 */
export function getActiveColorField(styleRules: StyleRule[]): string | null {
    const rule = styleRules.find(r => r.attribute === 'color');
    return rule?.field || null;
}

/**
 * Get the active shape rule field name if any
 */
export function getActiveShapeField(styleRules: StyleRule[]): string | null {
    const rule = styleRules.find(r => r.attribute === 'shape');
    return rule?.field || null;
}

/**
 * Get the active size rule field name if any
 */
export function getActiveSizeField(styleRules: StyleRule[]): string | null {
    const rule = styleRules.find(r => r.attribute === 'size');
    return rule?.field || null;
}

/**
 * Check if any style rules are active
 */
export function hasActiveStyles(styleRules: StyleRule[]): boolean {
    return styleRules.length > 0;
}

/**
 * Create marker configuration for Plotly from style result
 */
export function createPlotlyMarker(
    styleResult: StyleApplicationResult,
    options?: {
        showOutline?: boolean;
        outlineColor?: string;
        outlineWidth?: number;
        sizeMode?: 'diameter' | 'area';
        sizeRef?: number;
    }
): any {
    const {
        showOutline = true,
        outlineColor = 'rgba(0,0,0,0.3)',
        outlineWidth = 0.5,
    } = options || {};

    const marker: any = {
        color: styleResult.colors,
        symbol: styleResult.shapeSymbols,
        size: styleResult.sizes,
        opacity: styleResult.opacities,
    };

    if (showOutline) {
        marker.line = {
            width: outlineWidth,
            color: outlineColor
        };
    }

    return marker;
}
