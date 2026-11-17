/**
 * Web Worker that parses wireframe files (Leapfrog .msh, DXF, OBJ, STL, GOCAD
 * .ts) off the main thread, so a large DXF does not freeze the UI. The parsing
 * lives in features/plots/viewer3d/wireframeParsers — nothing is duplicated.
 */
import { parseWireframe } from '../features/plots/viewer3d/wireframeParsers';

self.onmessage = (e: MessageEvent) => {
    const { id, name, buffer } = e.data as { id: number; name: string; buffer: ArrayBuffer };
    try {
        const result = parseWireframe(name, buffer);
        // Hand the typed arrays over without copying (a buffer may be shared by parts: list it once)
        const transfer = new Set(result.parts.flatMap(p => [p.vertices.buffer, p.triangles.buffer, p.lines.buffer]));
        (self as unknown as Worker).postMessage({ id, result }, [...transfer] as Transferable[]);
    } catch (error: unknown) {
        (self as unknown as Worker).postMessage({ id, error: error instanceof Error ? error.message : 'Could not read the wireframe' });
    }
};
