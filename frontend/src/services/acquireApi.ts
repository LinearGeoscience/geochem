import api from './api';
import type { AcquireCombo, AcquirePreviewRequest, AcquirePullRecord } from '../utils/acquireFilters';
import type { AcquireProfile, FieldMap, TestResult } from '../utils/acquireProfiles';

export interface ProfileSummary {
    name: string;
    server: string;
    database: string;
    complete: boolean;
    error?: string;
}

/** GET /api/acquire/profiles: the saved profiles (laptop) or the admin profile (server mode). */
export interface ProfilesIndex {
    server_mode: boolean;
    editable: boolean;
    profiles: ProfileSummary[];
    admin: ProfileSummary | null;
    admin_error: string | null;
    template: AcquireProfile | null;
}

export interface AcquireOptions {
    profile: string;
    combos: AcquireCombo[];
    mapped: Record<string, boolean>;
    drilled: { min: string | null; max: string | null };
    modified: { min: string | null; max: string | null };
}

export interface CatalogObject {
    schema: string;
    name: string;
    type: string;
    columns: string[];
}

export interface SampleRows {
    columns: string[];
    rows: Record<string, unknown>[];
}

/** POST /api/acquire/detect: a suggested field map with confidences. */
export interface DetectResult {
    field_map: FieldMap;
    confidence: Record<string, number>;
    candidates: Record<string, { schema: string; name: string; score: number }[]>;
    alternatives: Record<string, string[]>;
    hints: string[];
    samples: Record<string, SampleRows>;
    objects: CatalogObject[];
    incomplete: string[];
}

interface TablePreview {
    columns: { name: string }[];
    preview: Record<string, unknown>[];
    required_fields: string[];
    total_rows: number;
}

/** POST /api/acquire/preview: the /api/drillhole/preview response plus the Acquire extras. */
export interface AcquirePreview {
    preview_token: string;
    collar: TablePreview;
    survey: TablePreview;
    assay: TablePreview;
    field_map: { collar: Record<string, string>; survey: Record<string, string>; assay: Record<string, string> };
    negate_dip: boolean;
    holes: number;
    pull_record: AcquirePullRecord;
}

const enc = encodeURIComponent;

// Through the shared axios client, so every call carries this tab's session header
export const acquireApi = {
    profiles: async (): Promise<ProfilesIndex> => (await api.get('/acquire/profiles', { timeout: 30000 })).data,
    profile: async (name: string): Promise<AcquireProfile> => (await api.get(`/acquire/profiles/${enc(name)}`)).data,
    saveProfile: async (name: string, profile: AcquireProfile, opts: { create?: boolean; renameFrom?: string } = {}): Promise<AcquireProfile> =>
        (await api.put(`/acquire/profiles/${enc(name)}`, { profile, create: !!opts.create, rename_from: opts.renameFrom ?? null })).data,
    deleteProfile: async (name: string): Promise<void> => { await api.delete(`/acquire/profiles/${enc(name)}`); },
    /** Laptop: test the profile as typed. Server mode: the admin profile (the body is ignored). */
    test: async (profile?: AcquireProfile): Promise<TestResult> =>
        (await api.post('/acquire/test', profile ? { profile } : {}, { timeout: 60000 })).data,
    detect: async (profile: AcquireProfile): Promise<DetectResult> =>
        (await api.post('/acquire/detect', { profile }, { timeout: 180000 })).data,
    objects: async (profile: AcquireProfile): Promise<CatalogObject[]> =>
        (await api.post('/acquire/objects', { profile }, { timeout: 120000 })).data.objects,
    sample: async (profile: AcquireProfile, schema: string, object: string): Promise<SampleRows> =>
        (await api.post('/acquire/sample', { profile, schema, object }, { timeout: 60000 })).data,
    options: async (profile?: string): Promise<AcquireOptions> =>
        (await api.get('/acquire/options', { params: profile ? { profile } : {}, timeout: 120000 })).data,
    preview: async (req: AcquirePreviewRequest): Promise<AcquirePreview> =>
        (await api.post('/acquire/preview', req, { timeout: 300000 })).data,
};
