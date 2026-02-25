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

export const dataApi = {
    uploadFile: async (file: File, onProgress?: (progress: number) => void) => {
        const formData = new FormData();
        formData.append('file', file);
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
};

export const analysisApi = {
    getSummaryStats: async (columns?: string[]) => {
        const params = columns ? `?${columns.map(c => `columns=${encodeURIComponent(c)}`).join('&')}` : '';
        const response = await api.get(`/analysis/stats/summary${params}`);
        return response.data;
    },

    getCorrelationMatrix: async (columns: string[], method: 'pearson' | 'spearman' = 'pearson') => {
        const response = await api.post('/analysis/stats/correlation', { columns, method });
        return response.data;
    }
};

export const qgisApi = {
    /**
     * Push current data to backend for QGIS sync.
     * Call this after loading data to make it available to the QGIS plugin.
     */
    syncData: async (data: any[], columns: any[]) => {
        const response = await api.post('/qgis/sync-data', { data, columns });
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
