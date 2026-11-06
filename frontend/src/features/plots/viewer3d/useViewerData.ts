/**
 * Builds the GPU buffers for the 3D viewer from the analytical columnar store
 * and the attribute styling. Geometry is rebuilt only when the axis columns
 * change; colour/size/shape/visibility only when styling changes; the
 * selection flag only when the selection changes.
 *
 * The viewer draws ALL rows (no representative sampling) — WebGL handles
 * millions of points and selection indices map 1:1 to dataset rows.
 */
import { useMemo } from 'react';
import { useAppStore, useAnalyticalStore } from '../../../store/appStore';
import { getStyleArraysColumnar } from '../../../utils/attributeUtils';
import { isNumericColumn } from '../../../types/columnarData';
import { buildPointCloud, parseCssColor, PointCloudGeometry } from './geometry';
import { SHAPE_INDEX } from './pointShaders';
import { guessHoleColumn, guessDepthColumn } from './coordinateColumns';
import { useStyleInputs } from '../../../hooks/useStyleInputs';

export interface ViewerStyleBuffers {
    color: Float32Array;   // rgba per point
    size: Float32Array;    // px
    shape: Float32Array;   // shape index
    visible: Uint8Array;   // attribute filter visibility
}

export interface DrillholeSegments {
    /** Pairs of point indices to join (consecutive samples down each hole) */
    pairs: Uint32Array;
}

export function useViewerGeometry(xAxis: string, yAxis: string, zAxis: string): PointCloudGeometry | null {
    const store = useAnalyticalStore();
    return useMemo(() => {
        const x = store.columns.get(xAxis);
        const y = store.columns.get(yAxis);
        const z = zAxis ? store.columns.get(zAxis) : null;
        if (!x || !y || !isNumericColumn(x) || !isNumericColumn(y)) return null;
        if (z && !isNumericColumn(z)) return null;
        return buildPointCloud(x, y, z as Float64Array | null);
    }, [store, xAxis, yAxis, zAxis]);
}

export function useViewerStyles(rowCount: number): ViewerStyleBuffers {
    const store = useAnalyticalStore();
    // Re-run when any styling input changes
    const styling = useStyleInputs();
    return useMemo(() => {
        const n = rowCount;
        const styles = getStyleArraysColumnar(n, (name) => store.columns.get(name));
        const color = new Float32Array(n * 4);
        const size = new Float32Array(n);
        const shape = new Float32Array(n);
        const visible = new Uint8Array(n);
        const colorCache = new Map<string, [number, number, number, number]>();
        for (let i = 0; i < n; i++) {
            const css = styles.colors[i];
            let rgba = colorCache.get(css);
            if (!rgba) { rgba = parseCssColor(css); colorCache.set(css, rgba); }
            color[i * 4] = rgba[0];
            color[i * 4 + 1] = rgba[1];
            color[i * 4 + 2] = rgba[2];
            color[i * 4 + 3] = rgba[3] * (styles.opacity[i] ?? 1);
            size[i] = styles.sizes[i];
            shape[i] = SHAPE_INDEX[styles.shapes[i]] ?? 0;
            visible[i] = styles.visible[i] ? 1 : 0;
        }
        return { color, size, shape, visible };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- styling is read inside getStyleArraysColumnar
    }, [store, rowCount, styling]);
}

/** Flag buffer: bit 0 = visible, bit 1 = selected. */
export function useViewerFlags(visible: Uint8Array): { flags: Float32Array; hasSelection: boolean } {
    const selectedIndices = useAppStore(s => s.selectedIndices);
    return useMemo(() => {
        const flags = new Float32Array(visible.length);
        for (let i = 0; i < visible.length; i++) flags[i] = visible[i];
        for (const i of selectedIndices) {
            if (i >= 0 && i < flags.length) flags[i] += 2;
        }
        return { flags, hasSelection: selectedIndices.length > 0 };
    }, [visible, selectedIndices]);
}

/**
 * Drillhole traces: consecutive samples (ordered by From, else Depth) within
 * each hole, for datasets with HoleID + From roles.
 */
export function useDrillholeSegments(geometry: PointCloudGeometry | null): DrillholeSegments | null {
    const store = useAnalyticalStore();
    const columns = useAppStore(s => s.columns);
    return useMemo(() => {
        if (!geometry) return null;
        const holeCol = guessHoleColumn(columns);
        const depthCol = guessDepthColumn(columns);
        if (!holeCol || !depthCol) return null;
        const holes = store.columns.get(holeCol);
        const depth = store.columns.get(depthCol);
        if (!holes || !depth || !isNumericColumn(depth)) return null;
        const byHole = new Map<string, number[]>();
        for (let i = 0; i < holes.length; i++) {
            if (!geometry.valid[i]) continue;
            const h = String(holes[i]);
            if (!h) continue;
            let list = byHole.get(h);
            if (!list) { list = []; byHole.set(h, list); }
            list.push(i);
        }
        const pairs: number[] = [];
        for (const list of byHole.values()) {
            list.sort((a, b) => depth[a] - depth[b]);
            for (let k = 1; k < list.length; k++) pairs.push(list[k - 1], list[k]);
        }
        return pairs.length ? { pairs: Uint32Array.from(pairs) } : null;
    }, [geometry, store, columns]);
}
