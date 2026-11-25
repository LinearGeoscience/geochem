import api from './api';

export type ModelKind = 'logistic' | 'random_forest' | 'xgboost';

export interface ModelSpecIn {
    kind: ModelKind;
    name?: string;
    features?: string[] | null;
    monotone?: Record<string, number> | null;
    depth?: number;
    n_trees?: number;
    learning_rate?: number;
}

export interface CvIn {
    kind: 'block' | 'hole';
    block_length?: number;
    buffer?: number;
    repeats?: number;
}

export interface ModelOut {
    name: string;
    kind: ModelKind;
    features: string[];
    cv_auc: number;
    train_auc: number;
    /** Out-of-fold score per row sent (null = row left out) */
    oof: Array<number | null>;
    importance: Array<{ feature: string; value: number }>;
}

export interface ModelsResponse {
    n: number;
    n_target: number;
    models: ModelOut[];
}

export const analysisApi = {
    available: async (): Promise<Record<ModelKind, boolean>> => (await api.get('/analysis/models/available')).data,
    models: async (body: {
        features: Record<string, Array<number | null>>;
        target: Array<number | null>;
        threshold: number;
        models: ModelSpecIn[];
        cv: CvIn;
        groups?: Array<string | null> | null;
        seed?: number;
    }): Promise<ModelsResponse> => (await api.post('/analysis/models', body, { timeout: 600000 })).data,
};
