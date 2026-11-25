/**
 * Pure trace builders for the pathfinder map: anomaly-classified point
 * traces per element and the matching probability plot. Kept free of React
 * so PathfinderMap can memoise them per element.
 */
import type { EmphasisConfig } from '../../../store/attributeStore';
import { applyOpacityToColor } from '../../../utils/emphasisUtils';
import {
    ANOMALY_COLORS, ANOMALY_LABELS, ANOMALY_THRESHOLDS, SC_NORMALIZABLE_ELEMENTS, K_NORMALIZABLE_ELEMENTS,
    type PathfinderElement, type AnomalyClass,
} from '../../../utils/calculations/pathfinderConstants';
import { getPathfinderClass, getPathfinderClassNormalized } from '../../../utils/calculations/pathfinderClassification';
import { generateAnomalyThresholds } from '../../../utils/calculations/elementBackgroundConstants';
import { getElementAnomalyClass } from '../../../utils/calculations/elementAnomalyClassification';
import type { MapMode, NormalizationType, AxisRanges3D, TransformedCoords } from './types';

// Anomaly class ranking for emphasis (0 = lowest, 1 = highest)
const ANOMALY_RANK: Record<AnomalyClass, number> = {
    nodata: 0,
    background: 0,
    '2x': 0.25,
    '3x': 0.5,
    '5x': 0.75,
    '10x': 1.0,
};

/** Emphasis styling for a pathfinder anomaly class */
export function getPathfinderEmphasis(
    anomalyClass: AnomalyClass,
    emphasisConfig: EmphasisConfig
): { opacity: number; sizeMultiplier: number } {
    if (!emphasisConfig.enabled) return { opacity: 1, sizeMultiplier: 1 };
    const rank = ANOMALY_RANK[anomalyClass];
    const thresholdNorm = emphasisConfig.threshold / 100;
    const opacity = rank >= thresholdNorm
        ? 1
        : emphasisConfig.minOpacity + (1 - emphasisConfig.minOpacity) * (rank / thresholdNorm);
    const sizeMultiplier = emphasisConfig.boostSize && rank >= thresholdNorm ? emphasisConfig.sizeBoostFactor : 1;
    return { opacity, sizeMultiplier };
}

export interface ElementMapData {
    traces: any[];
    validCount: number;
    totalCount: number;
}

export interface ElementMapContext {
    element: string;
    elementColumn: string | null;
    rows: any[];
    /** Original row index of each display row (null = identity) */
    displayIndices: number[] | null;
    xAxis: string;
    yAxis: string;
    zAxis: string;
    is3D: boolean;
    axisRanges3D: AxisRanges3D | null;
    mapMode: MapMode;
    normalization: NormalizationType;
    scColumn: string;
    kColumn: string;
    visibleClasses: AnomalyClass[];
    /** Extended mode background (null when unavailable) */
    extendedBackground: number | null;
    /** Factor converting the element column to ppm */
    toPpm: number;
    emphasis: EmphasisConfig;
    basePointSize: number;
    selectedSet: Set<number>;
    /** Coordinates for a mapbox basemap, or null for a plain x/y plot */
    mapboxCoords: TransformedCoords | null;
    scatterType: 'scatter' | 'scattergl';
    /** Attribute Manager visibility per row of `rows` (hidden rows are skipped) */
    rowVisible?: boolean[];
}

const CLASS_ORDER = ['background', '2x', '3x', '5x', '10x'] as const;

export function buildElementMapData(ctx: ElementMapContext): ElementMapData {
    const { element, elementColumn, rows, displayIndices, xAxis, yAxis, zAxis, is3D, axisRanges3D } = ctx;
    if (!elementColumn || !rows.length || !xAxis || !yAxis) {
        return { traces: [], validCount: 0, totalCount: rows.length };
    }
    const visible = new Set(ctx.visibleClasses);
    const pointsByClass: Record<AnomalyClass, { x: number[]; y: number[]; z: number[]; indices: number[] }> = {
        nodata: { x: [], y: [], z: [], indices: [] },
        background: { x: [], y: [], z: [], indices: [] },
        '2x': { x: [], y: [], z: [], indices: [] },
        '3x': { x: [], y: [], z: [], indices: [] },
        '5x': { x: [], y: [], z: [], indices: [] },
        '10x': { x: [], y: [], z: [], indices: [] },
    };

    const scNorm = ctx.normalization === 'sc' && SC_NORMALIZABLE_ELEMENTS.includes(element as PathfinderElement) && !!ctx.scColumn;
    const kNorm = ctx.normalization === 'k' && K_NORMALIZABLE_ELEMENTS.includes(element as PathfinderElement) && !!ctx.kColumn;

    let validCount = 0;
    for (let i = 0; i < rows.length; i++) {
        if (ctx.rowVisible && !ctx.rowVisible[i]) continue;
        const row = rows[i];
        const x = row[xAxis];
        const y = row[yAxis];
        const z = is3D && zAxis ? row[zAxis] : 0;

        if (x == null || y == null || isNaN(x) || isNaN(y)) continue;
        if (is3D && zAxis && (z == null || isNaN(z))) continue;

        // Filter by 3D axis ranges
        if (is3D && axisRanges3D) {
            if (x < axisRanges3D.x[0] || x > axisRanges3D.x[1]) continue;
            if (y < axisRanges3D.y[0] || y > axisRanges3D.y[1]) continue;
            if (z < axisRanges3D.z[0] || z > axisRanges3D.z[1]) continue;
        }

        const rawValue = row[elementColumn];
        const elementValue = rawValue == null ? rawValue : rawValue * ctx.toPpm;

        let anomalyClass: AnomalyClass;
        if (ctx.mapMode === 'extended') {
            anomalyClass = ctx.extendedBackground !== null ? getElementAnomalyClass(elementValue, ctx.extendedBackground) : 'nodata';
        } else if (scNorm) {
            anomalyClass = getPathfinderClassNormalized(element as PathfinderElement, elementValue, row[ctx.scColumn]);
        } else if (kNorm) {
            anomalyClass = getPathfinderClassNormalized(element as PathfinderElement, elementValue, row[ctx.kColumn]);
        } else {
            anomalyClass = getPathfinderClass(element as PathfinderElement, elementValue);
        }

        if (anomalyClass === 'nodata' || !visible.has(anomalyClass)) continue;

        const bucket = pointsByClass[anomalyClass];
        bucket.x.push(x);
        bucket.y.push(y);
        bucket.z.push(z);
        bucket.indices.push(i);
        validCount++;
    }

    const traces: any[] = [];
    const mapbox = ctx.mapboxCoords;
    const traceType = is3D ? 'scatter3d' : (mapbox ? 'scattermap' : ctx.scatterType);
    const originalIndex = (i: number) => (displayIndices ? displayIndices[i] : i);

    for (const cls of CLASS_ORDER) {
        const points = pointsByClass[cls];
        if (points.x.length === 0) continue;

        // Mapbox uses lat/lon for the ORIGINAL data indices
        let traceCoords: any;
        if (mapbox) {
            traceCoords = {
                lat: points.indices.map(i => mapbox.lats[originalIndex(i)]),
                lon: points.indices.map(i => mapbox.lons[originalIndex(i)]),
            };
        } else if (is3D) {
            traceCoords = { x: points.x, y: points.y, z: points.z };
        } else {
            traceCoords = { x: points.x, y: points.y };
        }

        const { opacity, sizeMultiplier } = getPathfinderEmphasis(cls, ctx.emphasis);
        const effectiveBaseSize = is3D ? Math.max(2, ctx.basePointSize - 2) : ctx.basePointSize;
        let lineStyle: any = { width: 0 };
        if (!is3D && ctx.selectedSet.size > 0) {
            const origIndices = points.indices.map(originalIndex);
            lineStyle = {
                width: origIndices.map(idx => (ctx.selectedSet.has(idx) ? 2 : 0)),
                color: origIndices.map(idx => (ctx.selectedSet.has(idx) ? '#ffffff' : 'rgba(0,0,0,0)')),
            };
        }

        traces.push({
            type: traceType,
            mode: 'markers',
            name: ANOMALY_LABELS[cls],
            ...traceCoords,
            hovertemplate: is3D
                ? `${element}: %{customdata.value}<br>X: %{x}<br>Y: %{y}<br>Z: %{z}<extra>${ANOMALY_LABELS[cls]}</extra>`
                : mapbox
                    ? `${element}: %{customdata.value}<br>Lat: %{lat:.6f}<br>Lon: %{lon:.6f}<extra>${ANOMALY_LABELS[cls]}</extra>`
                    : `${element}: %{customdata.value}<br>X: %{x}<br>Y: %{y}<extra>${ANOMALY_LABELS[cls]}</extra>`,
            customdata: points.indices.map(i => {
                const val = rows[i][elementColumn];
                return { index: originalIndex(i), value: (typeof val === 'number' && !isNaN(val)) ? val.toFixed(3) : 'N/A' };
            }),
            marker: {
                size: effectiveBaseSize * sizeMultiplier,
                color: applyOpacityToColor(ANOMALY_COLORS[cls], opacity),
                line: lineStyle,
            },
            showlegend: false,
        });
    }

    return { traces, validCount, totalCount: rows.length };
}

export interface ThresholdLine {
    value: number;
    color: string;
    label: string;
}

export interface ProbabilityPlotData {
    trace: any;
    thresholdLines: ThresholdLine[];
}

export function buildProbabilityData(args: {
    element: string;
    elementColumn: string | null;
    rows: any[];
    toPpm: number;
    mapMode: MapMode;
    extendedBackground: number | null;
}): ProbabilityPlotData | null {
    const { element, elementColumn, rows, toPpm, mapMode, extendedBackground } = args;
    if (!elementColumn || !rows.length) return null;

    // Valid values (in ppm), sorted
    const values: number[] = [];
    for (const row of rows) {
        const val = row[elementColumn];
        if (val != null && !isNaN(val) && val > 0) values.push(val * toPpm);
    }
    if (values.length === 0) return null;
    values.sort((a, b) => a - b);

    // Plotting positions (Hazen formula)
    const n = values.length;
    const probabilities = values.map((_, i) => ((i + 0.5) / n) * 100);

    const colors = values.map(val => {
        if (mapMode === 'extended') {
            const cls = extendedBackground !== null ? getElementAnomalyClass(val, extendedBackground) : 'nodata';
            return ANOMALY_COLORS[cls];
        }
        return ANOMALY_COLORS[getPathfinderClass(element as PathfinderElement, val)];
    });

    // Regular scatter (not scattergl) to avoid WebGL context limits
    const trace = {
        type: 'scatter',
        mode: 'markers',
        x: values,
        y: probabilities,
        marker: { size: 3, color: colors, line: { width: 0 } },
        hovertemplate: `${element}: %{x:.3f}<br>Percentile: %{y:.1f}%<extra></extra>`,
        showlegend: false,
    };

    let thresholdLines: ThresholdLine[] = [];
    if (mapMode === 'extended') {
        if (extendedBackground !== null) {
            const t = generateAnomalyThresholds(extendedBackground);
            thresholdLines = [
                { value: t.background, color: ANOMALY_COLORS['2x'], label: '2x' },
                { value: t.x2, color: ANOMALY_COLORS['3x'], label: '3x' },
                { value: t.x3, color: ANOMALY_COLORS['5x'], label: '5x' },
                { value: t.x5, color: ANOMALY_COLORS['10x'], label: '10x' },
            ];
        }
    } else {
        const t = ANOMALY_THRESHOLDS[element as PathfinderElement];
        thresholdLines = [
            { value: t.background, color: ANOMALY_COLORS['2x'], label: '2x' },
            { value: t.x2, color: ANOMALY_COLORS['3x'], label: '3x' },
            { value: t.x3, color: ANOMALY_COLORS['5x'], label: '5x' },
            { value: t.x5, color: ANOMALY_COLORS['10x'], label: '10x' },
        ];
    }

    return { trace, thresholdLines };
}
