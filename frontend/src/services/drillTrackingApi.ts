/** Drill tracking's backend calls (the shared axios client, so they carry the session header). */
import api from './api';
import type { AcquirePullRecord } from '../utils/acquireFilters';

export interface PulledTable {
    columns: string[];
    rows: string[][];
}

/** POST /api/drilltracking/acquire: collars and surveys of the holes matching the filters */
export interface AcquireLivePull {
    profile: string;
    collar: PulledTable;
    survey: PulledTable;
    /** The profile's own columns for the roles it maps */
    columns: {
        collar: { hole_id: string; easting: string; northing: string; rl: string };
        survey: { hole_id: string; depth: string; dip: string; azimuth: string };
    };
    mapped_filters: Record<string, boolean>;
    pull_record: AcquirePullRecord & { purpose?: string };
}

export const drillTrackingApi = {
    acquire: async (body: Record<string, unknown>): Promise<AcquireLivePull> =>
        (await api.post('/drilltracking/acquire', body, { timeout: 300000 })).data,
};
