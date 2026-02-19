import React, { useCallback, useState } from 'react';
import {
    Box, Button, Typography, Paper, Alert, Tabs, Tab, LinearProgress,
    Dialog, DialogContent, DialogTitle, IconButton, FormControlLabel,
    Checkbox, FormControl, InputLabel, Select, MenuItem, Collapse, Chip
} from '@mui/material';
import { CloudUpload, Layers, Settings, Close, Science, ExpandMore, ExpandLess, FolderOpen } from '@mui/icons-material';
import { useAppStore } from '../../store/appStore';
import { useAttributeStore } from '../../store/attributeStore';
import { DrillholeColumnMapper } from '../../components/DrillholeColumnMapper';
import { createGeochemMappings } from '../../utils/calculations/elementNameNormalizer';
import Papa from 'papaparse';
import {
    isVantaPxrfFormat,
    transformVantaData,
    getVantaColumnInfo,
    formatTransformSummary,
    LODHandling,
    VantaTransformOptions,
    DEFAULT_TRANSFORM_OPTIONS,
} from '../../utils/vantaPxrfTransform';

interface ColumnMapping {
    [key: string]: string;
}

export const DataImport: React.FC = () => {
    const { uploadFile, uploadDrillhole, isLoading, uploadProgress, error, columns } = useAppStore();
    const [tab, setTab] = useState(0);

    // Drillhole state
    const [collarFile, setCollarFile] = useState<File | null>(null);
    const [surveyFile, setSurveyFile] = useState<File | null>(null);
    const [assayFile, setAssayFile] = useState<File | null>(null);

    // Column mapping state
    const [showMapper, setShowMapper] = useState(false);

    // Vanta PXRF state
    const [isVantaPxrf, setIsVantaPxrf] = useState(false);
    const [showPxrfOptions, setShowPxrfOptions] = useState(false);
    const [pxrfOptions, setPxrfOptions] = useState<VantaTransformOptions>(DEFAULT_TRANSFORM_OPTIONS);
    const [pxrfTransformStats, setPxrfTransformStats] = useState<string | null>(null);

    // ioGAS import state
    const [iogasImportStats, setIogasImportStats] = useState<string | null>(null);

    const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            // Validate file type
            const validExtensions = ['.xlsx', '.xls', '.csv', '.gas'];
            const fileExt = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
            if (!validExtensions.includes(fileExt)) {
                useAppStore.setState({ error: `Invalid file type. Please select an Excel (.xlsx, .xls), CSV, or .gas project file.` });
                return;
            }

            // Clear any previous errors and reset attribute classifications for new data
            useAppStore.setState({ error: null });
            useAttributeStore.getState().removeGlobalEntries();
            setPxrfTransformStats(null);
            setIogasImportStats(null);

            // Handle ioGAS .gas files
            if (fileExt === '.gas') {
                await handleIoGasUpload(file);
            }
            // Handle Vanta PXRF format specially
            else if (isVantaPxrf && fileExt === '.csv') {
                await handleVantaPxrfUpload(file);
            } else {
                await uploadFile(file);
            }
        }
        // Reset input so the same file can be selected again if needed
        event.target.value = '';
    }, [uploadFile, isVantaPxrf, pxrfOptions]);

    // Handle Vanta PXRF CSV file processing
    const handleVantaPxrfUpload = useCallback(async (file: File) => {
        useAppStore.setState({ isLoading: true, uploadProgress: 10 });

        try {
            // Parse CSV file
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

            // Check if it's actually Vanta PXRF format
            if (!isVantaPxrfFormat(headers)) {
                useAppStore.setState({
                    error: 'File does not appear to be in Vanta PXRF format. Try unchecking the Vanta PXRF option.',
                    isLoading: false,
                    uploadProgress: 0
                });
                return;
            }

            // Transform the data
            const transformed = transformVantaData(headers, rawData, pxrfOptions);
            useAppStore.setState({ uploadProgress: 80 });

            // Get column info with priorities
            const columnInfo = getVantaColumnInfo(
                transformed.headers,
                transformed.data,
                transformed.columnPriorities
            );

            // Sort columns by priority for the store
            const sortedColumnInfo = columnInfo.sort((a, b) => a.priority - b.priority);

            // Update the store with transformed data
            useAppStore.setState({
                data: transformed.data,
                columns: sortedColumnInfo,
                isLoading: false,
                uploadProgress: 100,
                currentView: 'plots'
            });

            // Generate geochem mappings
            const columnNames = sortedColumnInfo.map(c => c.name);
            const mappings = createGeochemMappings(columnNames, sortedColumnInfo);
            useAppStore.setState({ geochemMappings: mappings, showGeochemDialog: true });

            // Show transformation summary
            setPxrfTransformStats(formatTransformSummary(transformed.stats));

            console.log('[Vanta PXRF] Transformation complete:', transformed.stats);

        } catch (err: any) {
            console.error('[Vanta PXRF] Processing error:', err);
            useAppStore.setState({
                error: `Failed to process Vanta PXRF file: ${err.message}`,
                isLoading: false,
                uploadProgress: 0
            });
        }
    }, [pxrfOptions]);

    // Handle ioGAS .gas file upload
    const handleIoGasUpload = useCallback(async (file: File) => {
        useAppStore.setState({ isLoading: true, uploadProgress: 10 });

        try {
            // Create FormData and upload to backend
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

            // Update the store with parsed data
            useAppStore.setState({
                data: result.data,
                columns: result.column_info,
                isLoading: false,
                uploadProgress: 100,
                currentView: 'plots'
            });

            // Generate geochem mappings
            const iogasColumnNames = result.column_info.map((c: any) => c.name);
            const iogasMappings = createGeochemMappings(iogasColumnNames, result.column_info);
            useAppStore.setState({ geochemMappings: iogasMappings, showGeochemDialog: true });

            // Format import stats
            const iogasMetadata = result.iogas_metadata || {};
            const specialCols = iogasMetadata.special_columns || {};
            const statsLines = [
                `Rows: ${result.rows}`,
                `Columns: ${result.columns}`,
            ];

            if (specialCols.id) statsLines.push(`Sample ID: ${specialCols.id}`);
            if (specialCols.group) statsLines.push(`Group: ${specialCols.group}`);
            if (specialCols.easting && specialCols.northing) {
                statsLines.push(`Coordinates: ${specialCols.easting}, ${specialCols.northing}`);
            }
            if (iogasMetadata.drillhole_options?.fromField) {
                statsLines.push(`Drillhole From/To: ${iogasMetadata.drillhole_options.fromField} / ${iogasMetadata.drillhole_options.toField}`);
            }

            setIogasImportStats(statsLines.join('\n'));
            console.log('[ioGAS] Import complete:', result);

        } catch (err: any) {
            console.error('[ioGAS] Processing error:', err);
            useAppStore.setState({
                error: `Failed to process .gas file: ${err.message}`,
                isLoading: false,
                uploadProgress: 0
            });
        }
    }, []);

    const handleDrillholeUploadAuto = async () => {
        if (collarFile && surveyFile && assayFile) {
            // Clear any previous errors and reset attribute classifications for new data
            useAppStore.setState({ error: null });
            useAttributeStore.getState().removeGlobalEntries();
            await uploadDrillhole(collarFile, surveyFile, assayFile);
        }
    };

    const handleDrillholeUploadManual = () => {
        if (collarFile && surveyFile && assayFile) {
            // Show column mapper
            setShowMapper(true);
        }
    };

    const handleMappingComplete = async (mappings: {
        collar: ColumnMapping;
        survey: ColumnMapping;
        assay: ColumnMapping;
        negateDip: boolean;
    }) => {
        setShowMapper(false);
        // Reset attribute classifications for new data
        useAttributeStore.getState().removeGlobalEntries();
        useAppStore.setState({ error: null, isLoading: true, uploadProgress: 0 });

        try {
            const formData = new FormData();
            formData.append('collar', collarFile!);
            formData.append('survey', surveyFile!);
            formData.append('assay', assayFile!);
            formData.append('collar_mapping', JSON.stringify(mappings.collar));
            formData.append('survey_mapping', JSON.stringify(mappings.survey));
            formData.append('assay_mapping', JSON.stringify(mappings.assay));
            formData.append('negate_dip', mappings.negateDip ? 'true' : 'false');

            const response = await fetch('/api/drillhole/process', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Processing failed');
            }

            const result = await response.json();
            console.log('[DEBUG] Process result:', {
                rows: result.rows,
                columns: result.columns,
                columnInfoCount: result.column_info?.length,
                dataLength: result.data?.length,
                previewLength: result.preview?.length
            });

            // Try to fetch full data from the data manager
            console.log('[DEBUG] Fetching full data from /api/data endpoints...');
            try {
                const [columnsResponse, dataResponse] = await Promise.all([
                    fetch('/api/data/columns'),
                    fetch('/api/data/data?limit=500000')
                ]);

                if (columnsResponse.ok && dataResponse.ok) {
                    const columns = await columnsResponse.json();
                    const data = await dataResponse.json();
                    console.log('[DEBUG] Full data fetched:', columns?.length, 'columns,', data?.length, 'rows');

                    // Only use fetched data if it's not empty
                    if (columns?.length > 0 && data?.length > 0) {
                        useAppStore.setState({
                            data: data,
                            columns: columns,
                            isLoading: false,
                            uploadProgress: 100,
                            currentView: 'plots'
                        });
                        // Generate geochem mappings
                        const manualColNames = columns.map((c: any) => c.name);
                        const manualMappings = createGeochemMappings(manualColNames, columns);
                        useAppStore.setState({ geochemMappings: manualMappings, showGeochemDialog: true });
                        console.log('[DEBUG] Store updated with full data');
                        return;
                    }
                }
            } catch (fetchError) {
                console.warn('[DEBUG] Failed to fetch full data:', fetchError);
            }

            // Fall back to using data from process result (use full data if available, then preview)
            const fallbackData = result.data || result.preview || [];
            console.log(`[DEBUG] Using fallback data from process result: ${fallbackData.length} rows`);
            if (result.column_info?.length > 0) {
                useAppStore.setState({
                    data: fallbackData,  // Use full data if available
                    columns: result.column_info,
                    isLoading: false,
                    uploadProgress: 100,
                    currentView: 'plots'
                });
                // Generate geochem mappings
                const fbColNames = result.column_info.map((c: any) => c.name);
                const fbMappings = createGeochemMappings(fbColNames, result.column_info);
                useAppStore.setState({ geochemMappings: fbMappings, showGeochemDialog: true });
                console.log('[DEBUG] Store updated with fallback data:', result.column_info?.length, 'columns,', fallbackData.length, 'rows');
            } else {
                throw new Error('No column info returned from processing');
            }

        } catch (error) {
            useAppStore.setState({
                error: error instanceof Error ? error.message : 'Processing failed',
                isLoading: false,
                uploadProgress: 0
            });
        }
    };

    return (
        <>
            <Paper sx={{ p: 3, maxWidth: 800, mx: 'auto', mt: 4 }}>
                <Typography variant="h5" gutterBottom>
                    Import Data
                </Typography>

                <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3 }}>
                    <Tab label="Flat File (Excel/CSV)" />
                    <Tab label="Drillhole (Collar/Survey/Assay)" />
                </Tabs>

                {tab === 0 ? (
                    <Box sx={{ my: 3 }}>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2, textAlign: 'center' }}>
                            Upload a single flat file containing your data (Excel, CSV, or .gas project format).
                        </Typography>

                        {/* Vanta PXRF Options */}
                        <Paper variant="outlined" sx={{ p: 2, mb: 3, bgcolor: isVantaPxrf ? 'action.selected' : 'transparent' }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <FormControlLabel
                                    control={
                                        <Checkbox
                                            checked={isVantaPxrf}
                                            onChange={(e) => setIsVantaPxrf(e.target.checked)}
                                            color="primary"
                                        />
                                    }
                                    label={
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <Science fontSize="small" color={isVantaPxrf ? 'primary' : 'action'} />
                                            <Typography variant="body1">Vanta PXRF Format</Typography>
                                            <Chip label="CSV" size="small" variant="outlined" />
                                        </Box>
                                    }
                                />
                                {isVantaPxrf && (
                                    <IconButton size="small" onClick={() => setShowPxrfOptions(!showPxrfOptions)}>
                                        {showPxrfOptions ? <ExpandLess /> : <ExpandMore />}
                                    </IconButton>
                                )}
                            </Box>

                            {isVantaPxrf && (
                                <Typography variant="caption" color="text.secondary" sx={{ ml: 4, display: 'block' }}>
                                    Transforms Vanta handheld XRF exports: renames concentration columns, handles &lt;LOD values, prioritizes key elements
                                </Typography>
                            )}

                            <Collapse in={isVantaPxrf && showPxrfOptions}>
                                <Box sx={{ mt: 2, pl: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                                    <FormControl size="small" sx={{ maxWidth: 250 }}>
                                        <InputLabel>Below LOD Handling</InputLabel>
                                        <Select
                                            value={pxrfOptions.lodHandling}
                                            onChange={(e) => setPxrfOptions(prev => ({
                                                ...prev,
                                                lodHandling: e.target.value as LODHandling
                                            }))}
                                            label="Below LOD Handling"
                                        >
                                            <MenuItem value="sqrt2">
                                                <Box>
                                                    <Typography variant="body2">LOD / √2 (Recommended)</Typography>
                                                    <Typography variant="caption" color="text.secondary">
                                                        Scientifically preferred method
                                                    </Typography>
                                                </Box>
                                            </MenuItem>
                                            <MenuItem value="half">
                                                <Box>
                                                    <Typography variant="body2">LOD / 2</Typography>
                                                    <Typography variant="caption" color="text.secondary">
                                                        Half detection limit
                                                    </Typography>
                                                </Box>
                                            </MenuItem>
                                            <MenuItem value="zero">
                                                <Box>
                                                    <Typography variant="body2">Zero</Typography>
                                                    <Typography variant="caption" color="text.secondary">
                                                        Replace with 0
                                                    </Typography>
                                                </Box>
                                            </MenuItem>
                                            <MenuItem value="keep">
                                                <Box>
                                                    <Typography variant="body2">Keep as Null</Typography>
                                                    <Typography variant="caption" color="text.secondary">
                                                        Leave as missing values
                                                    </Typography>
                                                </Box>
                                            </MenuItem>
                                        </Select>
                                    </FormControl>

                                    <FormControlLabel
                                        control={
                                            <Checkbox
                                                checked={pxrfOptions.includeErrors}
                                                onChange={(e) => setPxrfOptions(prev => ({
                                                    ...prev,
                                                    includeErrors: e.target.checked
                                                }))}
                                                size="small"
                                            />
                                        }
                                        label={
                                            <Typography variant="body2">Include error columns (1σ uncertainty)</Typography>
                                        }
                                    />
                                </Box>
                            </Collapse>
                        </Paper>

                        {/* Upload Button */}
                        <Box sx={{ textAlign: 'center' }}>
                            <input
                                accept={isVantaPxrf ? ".csv" : ".xlsx,.xls,.csv,.gas"}
                                style={{ display: 'none' }}
                                id="raised-button-file"
                                type="file"
                                onChange={handleFileUpload}
                            />
                            <label htmlFor="raised-button-file">
                                <Button
                                    variant="contained"
                                    component="span"
                                    startIcon={isVantaPxrf ? <Science /> : <CloudUpload />}
                                    disabled={isLoading}
                                    size="large"
                                >
                                    {isLoading ? 'Processing...' : isVantaPxrf ? 'Select PXRF CSV' : 'Select File'}
                                </Button>
                            </label>
                            <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 1 }}>
                                Supports: Excel (.xlsx, .xls), CSV, .gas project files
                            </Typography>
                        </Box>

                        {/* PXRF Transform Stats */}
                        {pxrfTransformStats && (
                            <Alert severity="info" sx={{ mt: 2 }}>
                                <Typography variant="subtitle2">Vanta PXRF Transformation Complete</Typography>
                                <Typography variant="caption" component="pre" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                                    {pxrfTransformStats}
                                </Typography>
                            </Alert>
                        )}

                        {/* ioGAS Import Stats */}
                        {iogasImportStats && (
                            <Alert severity="success" sx={{ mt: 2 }} icon={<FolderOpen />}>
                                <Typography variant="subtitle2">Project File Imported Successfully</Typography>
                                <Typography variant="caption" component="pre" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                                    {iogasImportStats}
                                </Typography>
                            </Alert>
                        )}
                    </Box>
                ) : (
                    <Box sx={{ my: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <Typography variant="body2" color="text.secondary">
                            Upload separate files for Collar, Survey, and Assay data. They will be merged and desurveyed automatically.
                        </Typography>

                        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                            <Button variant="outlined" component="label" startIcon={<Layers />} sx={{ width: 200 }}>
                                Collar File
                                <input type="file" hidden accept=".csv,.xlsx,.xls" onChange={(e) => setCollarFile(e.target.files?.[0] || null)} />
                            </Button>
                            <Typography variant="body2">{collarFile?.name || "No file selected"}</Typography>
                        </Box>

                        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                            <Button variant="outlined" component="label" startIcon={<Layers />} sx={{ width: 200 }}>
                                Survey File
                                <input type="file" hidden accept=".csv,.xlsx,.xls" onChange={(e) => setSurveyFile(e.target.files?.[0] || null)} />
                            </Button>
                            <Typography variant="body2">{surveyFile?.name || "No file selected"}</Typography>
                        </Box>

                        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                            <Button variant="outlined" component="label" startIcon={<Layers />} sx={{ width: 200 }}>
                                Assay File
                                <input type="file" hidden accept=".csv,.xlsx,.xls" onChange={(e) => setAssayFile(e.target.files?.[0] || null)} />
                            </Button>
                            <Typography variant="body2">{assayFile?.name || "No file selected"}</Typography>
                        </Box>

                        <Alert severity="info" sx={{ mt: 1 }}>
                            <Typography variant="body2">
                                <strong>Choose import method:</strong><br />
                                • Auto-detect: System guesses column names automatically (recommended for standard formats)<br />
                                • Manual: Select each column yourself (use if auto-detect fails or non-standard names)
                            </Typography>
                        </Alert>

                        <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
                            <Button
                                variant="contained"
                                onClick={handleDrillholeUploadAuto}
                                disabled={!collarFile || !surveyFile || !assayFile || isLoading}
                                fullWidth
                            >
                                {isLoading ? 'Processing...' : 'Import with Auto-Detect'}
                            </Button>
                            <Button
                                variant="outlined"
                                startIcon={<Settings />}
                                onClick={handleDrillholeUploadManual}
                                disabled={!collarFile || !surveyFile || !assayFile || isLoading}
                                fullWidth
                            >
                                Select Columns Manually
                            </Button>
                        </Box>
                    </Box>
                )}

                {isLoading && (
                    <Box sx={{ mt: 2 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                            <Box sx={{ width: '100%', mr: 1 }}>
                                {uploadProgress < 100 ? (
                                    <LinearProgress variant="determinate" value={uploadProgress} />
                                ) : (
                                    <LinearProgress />
                                )}
                            </Box>
                            <Box sx={{ minWidth: 35 }}>
                                <Typography variant="body2" color="text.secondary">
                                    {uploadProgress < 100 ? `${uploadProgress}%` : ''}
                                </Typography>
                            </Box>
                        </Box>
                        <Typography variant="body2" color="text.secondary" align="center">
                            {uploadProgress < 100
                                ? 'Uploading files...'
                                : tab === 1
                                    ? 'Processing drillhole data (desurveying)...'
                                    : 'Processing data...'}
                        </Typography>
                    </Box>
                )}

                {error && (
                    <Alert severity="error" sx={{ mt: 2 }}>
                        {error}
                    </Alert>
                )}

                {columns.length > 0 && !isLoading && !error && (
                    <Alert severity="success" sx={{ mt: 2 }}>
                        Successfully loaded {columns.length} columns!
                    </Alert>
                )}
            </Paper>

            {/* Column Mapper Dialog */}
            <Dialog
                open={showMapper}
                onClose={() => setShowMapper(false)}
                maxWidth="xl"
                fullWidth
                PaperProps={{
                    sx: { height: '90vh' }
                }}
            >
                <DialogTitle>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="h6">Column Mapping</Typography>
                        <IconButton onClick={() => setShowMapper(false)}>
                            <Close />
                        </IconButton>
                    </Box>
                </DialogTitle>
                <DialogContent>
                    {collarFile && surveyFile && assayFile && (
                        <DrillholeColumnMapper
                            files={{
                                collar: collarFile,
                                survey: surveyFile,
                                assay: assayFile
                            }}
                            onMappingComplete={handleMappingComplete}
                            onCancel={() => setShowMapper(false)}
                        />
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
};
