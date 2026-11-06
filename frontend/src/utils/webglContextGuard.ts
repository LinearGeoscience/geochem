/**
 * Release WebGL contexts that their owner has thrown away.
 *
 * Plotly's WebGL traces (scattergl, splom, ...) never lose their contexts:
 * every redraw that replaces the gl canvases, and every purged graph, leaves a
 * live context behind until garbage collection. Browsers allow about 16, then
 * kill the OLDEST one - usually the 3D viewer or a map, which goes blank or
 * black. The guard tracks WebGL canvases and loses the context of discarded
 * ones (removed from their parent, or inside a purged Plotly graph) once they
 * have stayed discarded for a moment. Canvases of hidden dock tabs are only
 * detached with their whole pane, so they are kept.
 */
type GL = WebGLRenderingContext | WebGL2RenderingContext;
type GraphDiv = HTMLElement & { _fullLayout?: unknown };

const GRACE_MS = 1000;
/** With this many live contexts, discarded ones are released at once (no grace) */
const NEAR_LIMIT = 12;
const live = new Map<HTMLCanvasElement, { gl: GL; discardedAt: number | null }>();

/** Has the canvas's owner discarded it? */
export function isDiscarded(canvas: HTMLCanvasElement): boolean {
    if (canvas.isConnected) return false;
    if (!canvas.parentNode) return true;
    const gd = canvas.closest('.js-plotly-plot') as GraphDiv | null;
    return !!gd && !gd._fullLayout;
}

/**
 * Lose the contexts of canvases discarded for at least GRACE_MS (at once when
 * near the browser's limit). Returns how many were released.
 */
export function releaseDiscardedContexts(now = performance.now()): number {
    let released = 0;
    const urgent = live.size >= NEAR_LIMIT;
    for (const [canvas, entry] of live) {
        if (entry.gl.isContextLost()) { live.delete(canvas); continue; }
        if (!isDiscarded(canvas)) { entry.discardedAt = null; continue; }
        entry.discardedAt ??= now;
        if (!urgent && now - entry.discardedAt < GRACE_MS) continue;
        entry.gl.getExtension('WEBGL_lose_context')?.loseContext();
        live.delete(canvas);
        released++;
    }
    return released;
}

let installed = false;

/** Wrap canvas.getContext once, at app start. */
export function installWebglContextGuard(): void {
    if (installed || typeof HTMLCanvasElement === 'undefined') return;
    installed = true;
    const getContext = HTMLCanvasElement.prototype.getContext as (this: HTMLCanvasElement, type: string, ...rest: unknown[]) => RenderingContext | null;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        const isWebgl = /webgl/i.test(type);
        // Make room before a new context is created, not after the browser drops one
        if (isWebgl && !live.has(this)) releaseDiscardedContexts();
        const ctx = getContext.call(this, type, ...rest);
        if (isWebgl && ctx && !live.has(this)) live.set(this, { gl: ctx as GL, discardedAt: null });
        return ctx;
    } as typeof HTMLCanvasElement.prototype.getContext;
    window.setInterval(() => releaseDiscardedContexts(), 2000);
}
