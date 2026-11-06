import type { PathfinderElement } from '../../../utils/calculations/pathfinderConstants';

export type NormalizationType = 'none' | 'sc' | 'k';
export type MapMode = 'pathfinder' | 'extended';
export type DragMode = 'zoom' | 'pan' | 'lasso' | 'select';

/** Pathfinder element -> column name (user overrides) */
export type ElementColumnMapping = Partial<Record<PathfinderElement, string>>;
/** Any element symbol -> column name (extended mode overrides) */
export type ExtendedElementColumnMapping = Record<string, string>;

export type AxisRanges3D = { x: [number, number]; y: [number, number]; z: [number, number] };

export interface TransformedCoords {
    lats: number[];
    lons: number[];
    center: { lat: number; lon: number };
    zoom: number;
}
