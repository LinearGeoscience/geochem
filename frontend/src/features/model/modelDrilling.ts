/**
 * The drilling a geological model reads, as the stores have it: the logged
 * rows of its lithologies, where they are, the box they are in, and how far
 * apart its holes are (modelGround.ts has the pure parts). Remembered for
 * the dataset, the coordinate columns and the lithologies as they are.
 */
import { useAppStore } from '../../store/appStore';
import { useDrillholeStore } from '../../store/drillholeStore';
import { useModelStore } from '../../store/modelStore';
import type { HoleLog } from './contacts';
import { holeLog, unitLog } from './logging';
import { sceneDataBox } from './modelCache';
import { drilledPlaces, drillingReach, type NearGround } from './modelGround';
import type { Box3, GeoModel, SceneCoords, UnitMap, Vec3 } from './types';

/** Places are kept this far apart down a hole, m, for the limit by distance (its error is then a metre or two at the outside) */
const PLACES_APART = 5;

export interface ModelDrilling {
    /** Places down the logged holes, xyz triples, and the hole each is in */
    places: Float64Array;
    group: Int32Array;
    /** The box of the logged rows (as the box of the data is found: the rows' own places); null: none are placed */
    box: Box3 | null;
    /** How far from its drilling a model is carried when no reach is set (null: one hole or none says nothing) */
    reach: number | null;
    holes: number;
}

/** The drilling a log is of: the rows with something logged in them (null: none is placed) */
export function logDrilling(log: HoleLog | null): ModelDrilling | null {
    if (!log) return null;
    const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < log.code.length; i++) {
        if (!log.code[i] || !log.hole[i]) continue;
        const p = [log.x[i], log.y[i], log.z[i]];
        if (!Number.isFinite(p[0]) || !Number.isFinite(p[1]) || !Number.isFinite(p[2])) continue;
        for (let k = 0; k < 3; k++) { if (p[k] < min[k]) min[k] = p[k]; if (p[k] > max[k]) max[k] = p[k]; }
    }
    const { places, group } = drilledPlaces(log, PLACES_APART);
    if (places.length === 0) return null;
    return { places, group, box: Number.isFinite(min[0]) ? { min, max } : null, reach: drillingReach(places, group), holes: new Set(group).size };
}

let kept: { data: unknown; db: unknown; coords: SceneCoords | null; map: UnitMap; drilling: ModelDrilling | null } | null = null;

/** The drilling that lithologies are logged in (null: the logging cannot be read, or nothing is logged) */
export function mapDrilling(coords: SceneCoords | null, map: UnitMap): ModelDrilling | null {
    const data = useAppStore.getState().columnarData, db = useDrillholeStore.getState().db;
    if (kept && kept.data === data && kept.db === db && kept.coords === coords && kept.map === map) return kept.drilling;
    const drilling = logDrilling(unitLog(coords, map, true));
    kept = { data, db, coords, map, drilling };
    return drilling;
}

/** The drilling a logging column is filled in in (a model about to be made from it) */
export function columnDrilling(coords: SceneCoords | null, column: string, table: string | null = null): ModelDrilling | null {
    return logDrilling(holeLog(coords, column, table));
}

/** The drilling a model reads: that of its lithologies (null: it reads none, or nothing of them is logged) */
export function modelDrilling(model: Pick<GeoModel, 'unitMap'>): ModelDrilling | null {
    const scene = useModelStore.getState().scene;
    const map = scene.unitMaps?.find(m => m.id === model.unitMap);
    return map ? mapDrilling(scene.coords, map) : null;
}

/**
 * The box of the data a model is in, when it has no box of its own: of the
 * rows its lithologies are logged in. Holes that were never logged (assay
 * holes, drilling far off) are not ground the model knows anything of. A
 * model that reads no lithologies: the box of all the data, as before.
 */
export function modelDataBox(model: Pick<GeoModel, 'unitMap'>): Box3 | null {
    return modelDrilling(model)?.box ?? sceneDataBox();
}

/** The limit by distance from its drilling that a model's boundary asks for (null: none, or it has no drilling to be near) */
export function modelNear(model: Pick<GeoModel, 'unitMap' | 'boundary'>): NearGround | null {
    const near = model.boundary.near;
    if (!near) return null;
    const drilling = modelDrilling(model);
    const reach = near.reach ?? drilling?.reach ?? null;
    return drilling && reach !== null && reach > 0 ? { places: drilling.places, reach } : null;
}
