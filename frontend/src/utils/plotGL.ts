/**
 * Switch large marker traces to WebGL.
 *
 * SVG 'scatter' traces get slow beyond a few thousand points; 'scattergl'
 * renders them on the GPU. Line/shape traces (reference lines, envelopes) stay
 * SVG — they are tiny and render crisper. Mixing both types in one plot is
 * supported by Plotly.
 */
export const WEBGL_POINT_THRESHOLD = 2000;

const isMarkerTrace = (t: any) =>
    (t?.type === undefined || t.type === 'scatter') &&
    typeof t?.mode === 'string' && t.mode.includes('markers');

const pointCount = (t: any) => (Array.isArray(t?.x) ? t.x.length : 0);

/** Returns `traces` with marker traces as 'scattergl' when their total points exceed the threshold. */
export function webglIfLarge<T>(traces: T[], threshold = WEBGL_POINT_THRESHOLD): T[] {
    const total = traces.reduce((n, t) => n + (isMarkerTrace(t) ? pointCount(t) : 0), 0);
    if (total <= threshold) return traces;
    return traces.map(t => (isMarkerTrace(t) ? { ...t, type: 'scattergl' } : t));
}
