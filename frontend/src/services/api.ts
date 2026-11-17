import axios from 'axios';

const API_URL = '/api';

const api = axios.create({
    baseURL: API_URL,
    timeout: 60000,
    headers: {
        'Content-Type': 'application/json',
    },
});

// Separate instance for uploads with longer timeout (5 min for large files)
const uploadApi = axios.create({
    baseURL: API_URL,
    timeout: 300000, // 5 min for large file uploads
    headers: {
        'Content-Type': 'application/json',
    },
});

// Backend-restart transparency: the backend keeps the dataset in RAM only, so
// after a restart every data endpoint 400s with "No data loaded". When that
// happens, push the frontend's copy back via /data/sync and retry the request
// once. (Previously only computeSample did this, per-call.)
api.interceptors.response.use(undefined, async (error) => {
    const cfg = error?.config;
    if (
        error?.response?.status === 400 &&
        error?.response?.data?.detail === 'No data loaded' &&
        cfg && !cfg._noDataRetried &&
        !String(cfg.url).includes('/data/sync')
    ) {
        try {
            // Dynamic imports avoid a circular dependency (appStore imports this module)
            const { useAppStore } = await import('../store/appStore');
            const store = useAppStore.getState();
            if (store.columnarData.rowCount > 0) {
                console.log('[api] Backend has no data (restarted?) — re-syncing and retrying:', cfg.url);
                await store.syncBackendData(true);
                cfg._noDataRetried = true;
                return api.request(cfg);
            }
        } catch (syncErr) {
            console.warn('[api] Auto re-sync failed:', syncErr);
        }
    }
    return Promise.reject(error);
});

export const dataApi = {
    /** Tables -> .xlsx (one sheet each), written by the backend (openpyxl) */
    exportXlsx: async (sheets: Array<{ name: string; rows: Array<Array<string | number | boolean | null>> }>): Promise<Blob> => {
        const response = await api.post('/data/export/xlsx', { sheets }, { responseType: 'blob' });
        return response.data;
    },

    uploadFile: async (file: File, onProgress?: (progress: number) => void, sheet?: string) => {
        const formData = new FormData();
        formData.append('file', file);
        if (sheet) formData.append('sheet', sheet);
        const response = await uploadApi.post('/data/upload', formData, {
            headers: {
                'Content-Type': 'multipart/form-data',
            },
            onUploadProgress: (progressEvent) => {
                if (onProgress && progressEvent.total) {
                    const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                    onProgress(percentCompleted);
                }
            },
        });
        return response.data;
    },

    uploadDrillhole: async (collar: File, survey: File, assay: File, onProgress?: (progress: number) => void) => {
        const formData = new FormData();
        formData.append('collar', collar);
        formData.append('survey', survey);
        formData.append('assay', assay);
        const response = await uploadApi.post('/data/upload/drillhole', formData, {
            headers: {
                'Content-Type': 'multipart/form-data',
            },
            onUploadProgress: (progressEvent) => {
                if (onProgress && progressEvent.total) {
                    const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                    onProgress(percentCompleted);
                }
            },
        });
        return response.data;
    },

    /**
     * Stream dataset as NDJSON from the backend.
     * Builds data[] progressively, reporting progress via callback.
     */
    streamData: async (
        onProgress?: (loadedRows: number, totalRows: number) => void
    ): Promise<any[]> => {
        const response = await fetch(`${API_URL}/data/stream`);
        if (!response.ok) {
            throw new Error(`Stream failed: ${response.status} ${response.statusText}`);
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        const data: any[] = [];
        let totalRows = 0;
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            // Keep the last (possibly incomplete) line in the buffer
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (!line.trim()) continue;
                const obj = JSON.parse(line);
                if (obj.__meta__) {
                    totalRows = obj.totalRows;
                    continue;
                }
                data.push(obj);
            }

            if (onProgress && totalRows > 0) {
                onProgress(data.length, totalRows);
            }
        }

        // Process any remaining buffer
        if (buffer.trim()) {
            const obj = JSON.parse(buffer);
            if (!obj.__meta__) {
                data.push(obj);
            }
        }

        if (onProgress && totalRows > 0) {
            onProgress(data.length, totalRows);
        }

        return data;
    },

    getColumns: async () => {
        const response = await api.get('/data/columns');
        return response.data;
    },

    updateColumn: async (column: string, role?: string, alias?: string) => {
        const response = await api.post('/data/columns/update', { column, role, alias });
        return response.data;
    },

    getData: async (limit: number = 100000) => {
        const response = await api.get(`/data/data?limit=${limit}`);
        return response.data;
    },

    computeSample: async (params: {
        sample_size: number;
        method: 'random' | 'stratified' | 'drillhole';
        outlier_columns: string[];
        classification_column?: string | null;
        drillhole_column?: string | null;
        iqr_multiplier?: number;
        seed?: number | null;
    }) => {
        const response = await api.post('/data/sample', params);
        return response.data as {
            indices: number[];
            total_rows: number;
            sample_size: number;
            outlier_count: number;
            method: string;
        };
    },

    syncData: async (data: any[]) => {
        const response = await api.post('/data/sync', { data });
        return response.data;
    },

    /** Column-wise sync ({name: values[]}) — much cheaper than row objects. */
    syncColumns: async (columns: Record<string, (number | string | null)[]>) => {
        const response = await api.post('/data/sync', { columns });
        return response.data;
    },
};

export const qgisApi = {
    /**
     * Push current data to backend for QGIS sync.
     * Call this after loading data to make it available to the QGIS plugin.
     */
    syncData: async (data: any[] | undefined, columns: any[]) => {
        const response = await api.post('/qgis/sync-data', data ? { data, columns } : { columns });
        return response.data;
    },

    /**
     * Push attribute styling configuration to backend for QGIS sync.
     * Call this to sync web app styling to QGIS.
     */
    syncStyles: async (styles: {
        color?: any;
        shape?: any;
        size?: any;
        globalOpacity?: number;
        emphasis?: any;
    }) => {
        const response = await api.post('/qgis/sync-styles', styles);
        return response.data;
    },

    /**
     * Check QGIS connection health
     */
    health: async () => {
        const response = await api.get('/qgis/health');
        return response.data;
    },

    /**
     * Push pathfinder configuration to backend for QGIS sync.
     * Creates styled layers for each pathfinder element in QGIS.
     */
    syncPathfinders: async (config: {
        elements: string[];
        xField: string;
        yField: string;
        zField?: string;
        normalization: 'none' | 'sc' | 'k';
        scColumn?: string;
        kColumn?: string;
        elementColumnMapping: Record<string, string>;
    }) => {
        const response = await api.post('/qgis/sync-pathfinders', config);
        return response.data;
    }
};

export default api;
