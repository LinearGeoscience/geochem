/**
 * The lines the project's surfaces and wireframes make on a plane, for a
 * plot that draws a cross-section or a level plan. Kept up to date as the
 * surfaces are refitted.
 */
import { useEffect, useMemo } from 'react';
import { useModelStore } from '../../store/modelStore';
import { syncSurfaceFits, useModelCache } from './modelCache';
import { sceneTraces, type SceneTrace } from './section';
import type { Plane } from './types';
import { loadSceneWireframes, useWireframeFiles } from './wireframeFiles';

export interface SceneTraces {
    traces: SceneTrace[];
    /** Visible surfaces and wireframes this plot could draw (whether or not the plane meets them) */
    objects: number;
}

const NONE: SceneTrace[] = [];

/**
 * `plane`: null draws nothing (but `objects` is still counted). `x`, `y`,
 * `z`: the plot's coordinate columns; surfaces are drawn only in the columns
 * they were built in (`z` null: any elevation column, for a plan).
 */
export function useSceneTraces(plane: Plane | null, x: string, y: string, z: string | null): SceneTraces {
    const scene = useModelStore(s => s.scene);
    const fits = useModelCache(s => s.byId);
    const files = useWireframeFiles(s => s.byFile);
    // A plot may be the first thing to show the scene: its surfaces are fitted and its wireframe files read for it
    useEffect(() => { syncSurfaceFits(); }, []);
    useEffect(() => { loadSceneWireframes(); }, [scene.wireframes]);

    const here = !!scene.coords && scene.coords.x === x && scene.coords.y === y && (z === null || scene.coords.z === z);
    const surfaces = here ? scene.surfaces : null;
    const objects = (surfaces?.filter(s => s.visible && !!fits[s.id]?.part).length ?? 0)
        + scene.wireframes.filter(w => w.visible && !!files[w.file]?.parts[w.part]).length;
    const key = plane ? `${plane.normal.join(',')}|${plane.point.join(',')}` : null;
    const traces = useMemo(
        () => (plane && objects > 0 ? sceneTraces(plane, surfaces, fits, scene.wireframes, files) : NONE),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the plane is compared by its numbers
        [key, objects, surfaces, fits, scene.wireframes, files],
    );
    return { traces, objects };
}
