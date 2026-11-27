import { useAppStore } from '../../store/appStore';
import { loadImportedDrillholes } from '../../store/drillholeStore';
import api, { dataApi } from '../../services/api';
import { notify } from '../../store/notificationStore';
import { friendlyError } from '../../utils/friendlyError';

type ColumnMapping = Record<string, string>;

export interface DrillholeProcessRequest {
    collar: ColumnMapping;
    survey: ColumnMapping;
    assay: ColumnMapping;
    negateDip: boolean;
    /** From a /preview (file upload or Acquire): the server already holds the tables */
    previewToken?: string;
    /** Only without a previewToken */
    files?: { collar: File; survey: File; assay: File };
}

export interface DrillholeProcessResult {
    rows: number;
    columns: number;
    warnings: string[];
}

/**
 * /api/drillhole/process with the column mappings, then stream the dataset and
 * load it exactly as the Drillhole tab always has: setDataset (with the
 * geochem dialog), loadImportedDrillholes, switch to Plots, warnings via
 * notify. Used by the Drillhole tab's column mapper and the Acquire tab.
 * Returns null after a failure (already shown to the user).
 */
export async function processDrillholeImport(req: DrillholeProcessRequest, logTag = 'DrillholeMapping'): Promise<DrillholeProcessResult | null> {
    useAppStore.setState({ error: null, isLoading: true, uploadProgress: 0 });

    try {
        const formData = new FormData();
        if (req.previewToken) {
            // Preview already uploaded and parsed the files server-side —
            // no need to re-upload them
            formData.append('preview_token', req.previewToken);
        } else if (req.files) {
            formData.append('collar', req.files.collar);
            formData.append('survey', req.files.survey);
            formData.append('assay', req.files.assay);
        }
        formData.append('collar_mapping', JSON.stringify(req.collar));
        formData.append('survey_mapping', JSON.stringify(req.survey));
        formData.append('assay_mapping', JSON.stringify(req.assay));
        formData.append('negate_dip', req.negateDip ? 'true' : 'false');

        // The shared client (no time limit: a large import can take a while)
        const result = (await api.post('/drillhole/process', formData, {
            timeout: 0,
            headers: { 'Content-Type': 'multipart/form-data' },
        })).data;
        if (!result.column_info?.length) {
            throw new Error('No column info returned from processing');
        }
        useAppStore.setState({ uploadProgress: 50 });

        // Stream the full dataset progressively (matches the auto-upload flow)
        const data = await dataApi.streamData((loaded, total) => {
            useAppStore.setState({ uploadProgress: 50 + Math.round((loaded / Math.max(total, 1)) * 50) });
        });

        const filteredCols = useAppStore.getState().setDataset(data, result.column_info as any[], { showGeochemDialog: true });
        await loadImportedDrillholes();
        useAppStore.setState({
            isLoading: false,
            uploadProgress: 0,
            currentView: 'plots'
        });
        console.log(`[${logTag}] Streamed ${data.length} rows, ${filteredCols.length} columns`);
        const warnings = (result.warnings ?? []) as string[];
        for (const w of warnings) notify(w, 'warning');
        return { rows: data.length, columns: filteredCols.length, warnings };

    } catch (error) {
        const message = friendlyError(error, 'Drillhole processing failed');
        notify(message, 'error');
        useAppStore.setState({
            error: message,
            isLoading: false,
            uploadProgress: 0
        });
        return null;
    }
}
