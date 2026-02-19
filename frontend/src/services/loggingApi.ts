import api from './api';
import type {
    LoggingPreviewResponse,
    LoggingProcessResponse,
    LoggingMapping,
    OverlapStrategy,
} from '../types/loggingInterval';

export const loggingApi = {
    previewLoggingFile: async (file: File): Promise<LoggingPreviewResponse> => {
        const formData = new FormData();
        formData.append('file', file);
        const response = await api.post('/logging/preview', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 120000,
        });
        return response.data;
    },

    processLoggingMerge: async (
        file: File,
        mapping: LoggingMapping,
        strategy: OverlapStrategy,
        minOverlapPct: number = 0,
        columnPrefix: string = '',
    ): Promise<LoggingProcessResponse> => {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('mapping', JSON.stringify(mapping));
        formData.append('strategy', strategy);
        formData.append('min_overlap_pct', String(minOverlapPct));
        formData.append('column_prefix', columnPrefix);
        const response = await api.post('/logging/process', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 300000,
        });
        return response.data;
    },
};
