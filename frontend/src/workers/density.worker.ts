/**
 * Web Worker for density computation (kernel density estimation off the main
 * thread). Imports the shared implementation from utils/densityGrid — Vite
 * bundles it into the worker chunk, so no maths is duplicated here.
 */
import { computePointDensities, computeTernaryDensities } from '../utils/densityGrid';

self.onmessage = (e: MessageEvent) => {
    const { type, xValues, yValues, aValues, bValues, cValues, options, id } = e.data;
    try {
        let result = null;
        if (type === 'pointDensities') {
            result = computePointDensities(xValues, yValues, options);
        } else if (type === 'ternaryDensities') {
            result = aValues ? computeTernaryDensities(aValues, bValues, cValues, options) : null;
        }
        (self as unknown as Worker).postMessage({ id, result });
    } catch (err) {
        (self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err) });
    }
};
