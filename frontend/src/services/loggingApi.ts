import api from './api';
import type {
    LoggingPreviewResponse,
    LoggingProcessResponse,
    LoggingMapping,
    OverlapStrategy,
} from '../types/loggingInterval';

export const loggingApi = {
    /**
     * The file of the last preview as a table of its own, row for row as it
     * was logged (the dataset is not touched). `to` left out: a table of
     * depth points. Read it with `readHoleTable` (features/model/drillholes).
     */
    table: async (previewToken: string, mapping: { hole_id: string; from: string; to?: string }): Promise<any> => {
        const formData = new FormData();
        formData.append('preview_token', previewToken);
        formData.append('mapping', JSON.stringify(mapping));
        const response = await api.post('/logging/table', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 300000,
        });
        return response.data;
    },

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
        previewToken?: string,
    ): Promise<LoggingProcessResponse> => {
        const formData = new FormData();
        if (previewToken) {
            // Preview already uploaded and parsed the file server-side
            formData.append('preview_token', previewToken);
        } else {
            formData.append('file', file);
        }
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
