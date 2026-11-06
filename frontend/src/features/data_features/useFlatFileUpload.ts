/**
 * Flat-file upload logic (UI Refresh R3) — extracted from DataImport so the
 * Welcome view's drag-drop zone reuses the exact same pipeline: extension
 * validation, confirm-before-wipe, and the .gas / Vanta-PXRF / plain-file
 * branches. Behavior is identical to the pre-extraction DataImport.
 */
import { useCallback, useState } from 'react';
import Papa from 'papaparse';
import { useAppStore } from '../../store/appStore';
import { useAttributeStore } from '../../store/attributeStore';
import { useAuditStore } from '../../store/auditStore';
import { dataApi } from '../../services/api';
import { applyInteropAttributes, interopCheckpointState, type InteropCheckpoint } from '../../utils/interopAttributes';
import { parseInteropWorkspace, openWorkspacePlots } from '../../utils/interopWorkspace';
import { useCheckpointStore } from '../../store/checkpointStore';
import { epsgOption } from '../../utils/epsgCodes';
import { useVariableSelectionStore } from '../../store/variableSelectionStore';
import {
    isVantaPxrfFormat,
    transformVantaData,
    getVantaColumnInfo,
    formatTransformSummary,
    VantaTransformOptions,
    DEFAULT_TRANSFORM_OPTIONS,
} from '../../utils/vantaPxrfTransform';

export const VALID_FLAT_EXTENSIONS = ['.xlsx', '.xls', '.csv', '.gas'];

export function useFlatFileUpload() {
    const uploadFile = useAppStore(s => s.uploadFile);

    const [isVantaPxrf, setIsVantaPxrf] = useState(false);
    const [pxrfOptions, setPxrfOptions] = useState<VantaTransformOptions>(DEFAULT_TRANSFORM_OPTIONS);
    const [pxrfTransformStats, setPxrfTransformStats] = useState<string | null>(null);
    const [interopImportStats, setInteropImportStats] = useState<string | null>(null);

    // Confirm-before-wipe: uploading new data resets all attribute styling and
    // classifications. When the user has existing work, ask first.
    const [confirmAction, setConfirmAction] = useState<(() => void) | null>(null);

    const wouldLoseWork = () => {
        const hasData = useAppStore.getState().columnarData.rowCount > 0;
        const attr = useAttributeStore.getState();
        const hasStyling = attr.customEntries.length > 0 ||
            !!attr.color.field || !!attr.shape.field || !!attr.size.field;
        return hasData && hasStyling;
    };

    const runOrConfirm = (action: () => void) => {
        if (wouldLoseWork()) {
            setConfirmAction(() => action);
        } else {
            action();
        }
    };

    // Handle Vanta PXRF CSV file processing
    const handleVantaPxrfUpload = useCallback(async (file: File) => {
        useAppStore.setState({ isLoading: true, uploadProgress: 10 });

        try {
            const text = await file.text();
            useAppStore.setState({ uploadProgress: 30 });

            const parseResult = Papa.parse(text, {
                header: true,
                skipEmptyLines: true,
                dynamicTyping: false, // Keep as strings for LOD handling
            });

            if (parseResult.errors.length > 0) {
                console.warn('CSV parse warnings:', parseResult.errors);
            }

            const headers = parseResult.meta.fields || [];
            const rawData = parseResult.data as Record<string, any>[];

            useAppStore.setState({ uploadProgress: 50 });

            if (!isVantaPxrfFormat(headers)) {
                useAppStore.setState({
                    error: 'File does not appear to be in Vanta PXRF format. Try unchecking the Vanta PXRF option.',
                    isLoading: false,
                    uploadProgress: 0
                });
                return;
            }

            const transformed = transformVantaData(headers, rawData, pxrfOptions);
            useAppStore.setState({ uploadProgress: 80 });

            const columnInfo = getVantaColumnInfo(
                transformed.headers,
                transformed.data,
                transformed.columnPriorities
            );

            const sortedColumnInfo = columnInfo.sort((a, b) => a.priority - b.priority);
            const filteredColumnInfo = useAppStore.getState().setDataset(
                transformed.data, sortedColumnInfo as any, { showGeochemDialog: true });
            useAppStore.setState({ isLoading: false, uploadProgress: 100, currentView: 'plots' });

            setPxrfTransformStats(formatTransformSummary(transformed.stats));


            useAuditStore.getState().recordAudit({
                category: 'import',
                operation: 'Vanta PXRF Import',
                description: `Imported Vanta PXRF file "${file.name}" with ${transformed.data.length.toLocaleString()} rows and ${filteredColumnInfo.length} columns. LOD handling: ${pxrfOptions.lodHandling}.`,
                parameters: { fileName: file.name, lodHandling: pxrfOptions.lodHandling, stats: transformed.stats },
                outputColumns: filteredColumnInfo.map((c: any) => c.name),
                rowsAffected: transformed.data.length,
            });

        } catch (err: any) {
            console.error('[Vanta PXRF] Processing error:', err);
            useAppStore.setState({
                error: `Failed to process Vanta PXRF file: ${err.message}`,
                isLoading: false,
                uploadProgress: 0
            });
        }
    }, [pxrfOptions]);

    // Handle .gas file upload
    const handleInteropUpload = useCallback(async (file: File) => {
        useAppStore.setState({ isLoading: true, uploadProgress: 10 });

        try {
            const formData = new FormData();
            formData.append('file', file);

            useAppStore.setState({ uploadProgress: 30 });

            const response = await fetch('/api/data/upload', {
                method: 'POST',
                body: formData
            });

            useAppStore.setState({ uploadProgress: 70 });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Failed to upload .gas file');
            }

            const result = await response.json();
            useAppStore.setState({ uploadProgress: 90 });

            if (!result.success) {
                throw new Error(result.error || 'Failed to parse .gas file');
            }

            // The upload response carries metadata only; rows are streamed separately.
            const rows = await dataApi.streamData((loaded, total) => {
                useAppStore.setState({ uploadProgress: 90 + Math.round((loaded / total) * 9) });
            });

            const interopMetadata = result.interop_metadata || {};
            const filteredInteropColumns = useAppStore.getState().setDataset(rows, result.column_info, {
                showGeochemDialog: true,
                datasetEpsg: epsgOption(interopMetadata.epsg)?.code ?? null,
            });
            useAppStore.setState({ isLoading: false, uploadProgress: 100, currentView: 'plots' });

            // The file's colour/shape/size/filter groups, as showed them
            const attributeTabs = applyInteropAttributes(interopMetadata.attributes, name => useAppStore.getState().getRawColumn(name));

            // variable selection history -> column picker History
            if (Array.isArray(interopMetadata.selection_history)) {
                useVariableSelectionStore.getState().seed(interopMetadata.selection_history);
            }

            // Checkpoints saved in the file (Home > Restore Checkpoint)
            const fileCheckpoints: InteropCheckpoint[] = Array.isArray(interopMetadata.checkpoints) ? interopMetadata.checkpoints : [];
            if (fileCheckpoints.length) {
                const base = useAttributeStore.getState().exportState();
                const created = new Date().toISOString();
                useCheckpointStore.getState().setCheckpoints(fileCheckpoints.map((cp, k) => ({
                    id: `cp-gas-${Date.now()}-${k}`, name: cp.name, created, state: interopCheckpointState(cp, base),
                })));
            }

            // The plots that were open when the file was saved
            let workspacePlots = 0;
            if (typeof interopMetadata.workspace_xml === 'string' && interopMetadata.workspace_xml) {
                try {
                    const { plots } = parseInteropWorkspace(interopMetadata.workspace_xml);
                    if (plots.length) workspacePlots = openWorkspacePlots(plots, { replace: true }).ids.length;
                } catch {
                    // An unreadable workspace leaves the default plots
                }
            }

            const specialCols = interopMetadata.special_columns || {};
            const statsLines = [
                `Rows: ${result.rows}`,
                `Columns: ${result.columns}`,
            ];

            if (specialCols.id) statsLines.push(`Sample ID: ${specialCols.id}`);
            if (specialCols.group) statsLines.push(`Group: ${specialCols.group}`);
            if (specialCols.easting && specialCols.northing) {
                statsLines.push(`Coordinates: ${specialCols.easting}, ${specialCols.northing}`);
            }
            if (interopMetadata.epsg) statsLines.push(`Projection: ${interopMetadata.projection || ''} (EPSG:${interopMetadata.epsg})`);
            for (const tab of attributeTabs) {
                const kind = tab === 'color' ? 'colour' : tab;
                const list = interopMetadata.attributes?.[kind];
                if (list) statsLines.push(`${kind[0].toUpperCase()}${kind.slice(1)} groups: ${list.entries.length - 1}${list.title ? ` (from ${list.title})` : ''}`);
                // can save the Default row unticked: ungrouped rows are then not drawn
                if (list?.entries[0]?.visible === false) {
                    statsLines.push(`Note: the file hides the Default ${kind} row, so rows outside the ${kind} groups are not drawn. Tick Default in the Attribute Manager to show them.`);
                }
            }
            if (workspacePlots) statsLines.push(`Plots reopened from the file: ${workspacePlots}`);
            if (fileCheckpoints.length) statsLines.push(`Checkpoints: ${fileCheckpoints.length} (Attribute Manager ⋮ > Restore)`);
            if (interopMetadata.drillhole_options?.fromField) {
                statsLines.push(`Drillhole From/To: ${interopMetadata.drillhole_options.fromField} / ${interopMetadata.drillhole_options.toField}`);
            }

            setInteropImportStats(statsLines.join('\n'));

            useAuditStore.getState().recordAudit({
                category: 'import',
                operation: '.gas import',
                description: `Imported .gas file "${file.name}" with ${result.rows} rows and ${result.columns} columns`,
                parameters: { fileName: file.name },
                outputColumns: filteredInteropColumns.map((c: any) => c.name),
                rowsAffected: result.rows,
            });

        } catch (err: any) {
            console.error('[.gas import] Processing error:', err);
            useAppStore.setState({
                error: `Failed to process .gas file: ${err.message}`,
                isLoading: false,
                uploadProgress: 0
            });
        }
    }, []);

    const doFlatUpload = useCallback(async (file: File, fileExt: string) => {
        // Clear any previous errors and reset attribute classifications for new data
        useAppStore.setState({ error: null });
        useAttributeStore.getState().removeGlobalEntries();
        // Checkpoints hold row numbers of the previous dataset
        useCheckpointStore.getState().setCheckpoints([]);
        setPxrfTransformStats(null);
        setInteropImportStats(null);

        if (fileExt === '.gas') {
            await handleInteropUpload(file);
        } else if (isVantaPxrf && fileExt === '.csv') {
            await handleVantaPxrfUpload(file);
        } else {
            await uploadFile(file);
        }
    }, [uploadFile, isVantaPxrf, handleInteropUpload, handleVantaPxrfUpload]);

    /**
     * Validate + (confirm if destructive) + upload. Returns false when the
     * file extension is invalid (an error is set in the store).
     */
    const submitFile = useCallback((file: File): boolean => {
        const fileExt = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
        if (!VALID_FLAT_EXTENSIONS.includes(fileExt)) {
            useAppStore.setState({ error: `Invalid file type. Please select an Excel (.xlsx, .xls), CSV, or .gas project file.` });
            return false;
        }
        runOrConfirm(() => { void doFlatUpload(file, fileExt); });
        return true;
         
    }, [doFlatUpload]);

    return {
        submitFile,
        runOrConfirm,
        confirmAction,
        setConfirmAction,
        isVantaPxrf,
        setIsVantaPxrf,
        pxrfOptions,
        setPxrfOptions,
        pxrfTransformStats,
        interopImportStats,
    };
}
