import axios from 'axios';

const API_URL = '/api';

const api = axios.create({
    baseURL: API_URL,
    headers: {
        'Content-Type': 'application/json',
    },
});

export const dataApi = {
    uploadFile: async (file: File, onProgress?: (progress: number) => void) => {
        const formData = new FormData();
        formData.append('file', file);
        const response = await api.post('/data/upload', formData, {
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
        const response = await api.post('/data/upload/drillhole', formData, {
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
    }
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

export default api;
