/**
 * Web Worker for correlation matrix computation (Pearson/Spearman + p-values).
 * Imports the shared implementation — no maths is duplicated here.
 */
import { computeCorrelationMatrix } from '../utils/statistics/correlation';

self.onmessage = (e: MessageEvent) => {
    const { columnNames, columnData, method, id } = e.data;
    // columnData: Record<string, number[]> — pre-extracted numeric arrays (NaN = missing)
    try {
        const result = computeCorrelationMatrix(columnNames, columnData, method,
            (progress) => (self as unknown as Worker).postMessage({ id, progress }));
        (self as unknown as Worker).postMessage({ id, result });
    } catch (err) {
        (self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err) });
    }
};
