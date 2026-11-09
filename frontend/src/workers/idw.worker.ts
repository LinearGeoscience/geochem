/**
 * Web Worker for IDW interpolation (grid computation + smoothing + masking
 * off the main thread). Imports the shared implementation from
 * utils/idwInterpolation — no maths is duplicated here.
 */
import { computeIDWGrid } from '../utils/idwInterpolation';

self.onmessage = (e: MessageEvent) => {
    const { id, points, options } = e.data;
    try {
        const result = computeIDWGrid(points, options);
        (self as unknown as Worker).postMessage({ id, result });
    } catch (error: unknown) {
        (self as unknown as Worker).postMessage({ id, error: error instanceof Error ? error.message : 'IDW computation failed' });
    }
};
