import React, { useCallback, useState } from 'react';
import { Box, Button, Typography, Paper, Alert, Tabs, Tab, LinearProgress, Dialog, DialogContent } from '@mui/material';
import { CloudUpload, Layers, Settings } from '@mui/icons-material';
import { useAppStore } from '../../store/appStore';
import { DrillholeColumnMapper } from '../../components/DrillholeColumnMapper';

interface ColumnMapping {
    [key: string]: string;
}

export const DataImportWithMapping: React.FC = () => {
    const { uploadFile, isLoading, uploadProgress, error, columns } = useAppStore();
    const [tab, setTab] = useState(0);

    // Drillhole state
    const [collarFile, setCollarFile] = useState<File | null>(null);
    const [surveyFile, setSurveyFile] = useState<File | null>(null);
    const [assayFile, setAssayFile] = useState<File | null>(null);

    // Column mapping state
    const [showMapper, setShowMapper] = useState(false);
    const [useAutoMapping, setUseAutoMapping] = useState(true);

    const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            // Validate file type
            const validExtensions = ['.xlsx', '.xls', '.csv'];
            const fileExt = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
            if (!validExtensions.includes(fileExt)) {
                useAppStore.setState({ error: `Invalid file type. Please select an Excel (.xlsx, .xls) or CSV file.` });
                return;
            }

            // Clear any previous errors
            useAppStore.setState({ error: null });
            await uploadFile(file);
        }
        // Reset input so the same file can be selected again if needed
        event.target.value = '';
    }, [uploadFile]);

    const handleDrillholeUpload = async () => {
        if (collarFile && surveyFile && assayFile) {
            if (useAutoMapping) {
                // Direct upload with auto-detection
                await uploadDrillholeWithAutoMapping();
            } else {
                // Show column mapper
                setShowMapper(true);
            }
        }
    };

    const uploadDrillholeWithAutoMapping = async () => {
        useAppStore.setState({ error: null, isLoading: true, uploadProgress: 0 });

        try {
            const formData = new FormData();
            formData.append('collar', collarFile!);
            formData.append('survey', surveyFile!);
            formData.append('assay', assayFile!);

            const response = await fetch('/api/data/upload/drillhole', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Upload failed');
            }

            const result = await response.json();
            console.log('[DEBUG] Auto-upload result:', { rows: result.rows, dataLength: result.data?.length, previewLength: result.preview?.length });

            // Use full data from response (result.data), not just preview
            // Fall back to preview for backwards compatibility
            const fullData = result.data || result.preview || [];
            console.log(`[DEBUG] Using ${fullData.length} rows of data`);

            // Use column_info if available, otherwise create basic column objects from data keys
            const columnInfo = result.column_info || Object.keys(fullData[0] || {}).map(name => ({
                name,
                type: typeof fullData[0]?.[name] === 'number' ? 'numeric' : 'string',
                role: null,
                alias: null
            }));

            useAppStore.setState({
                data: fullData,  // Use full data, not preview!
                columns: columnInfo,
                isLoading: false,
                uploadProgress: 100,
                currentView: 'plots'
            });
            console.log(`[DEBUG] Store updated with ${fullData.length} rows`);

        } catch (error) {
            useAppStore.setState({
                error: error instanceof Error ? error.message : 'Upload failed',
                isLoading: false,
                uploadProgress: 0
            });
        }
    };

    const handleMappingComplete = async (mappings: {
        collar: ColumnMapping;
        survey: ColumnMapping;
        assay: ColumnMapping;
    }) => {
        setShowMapper(false);
        useAppStore.setState({ error: null, isLoading: true, uploadProgress: 0 });

        try {
            const formData = new FormData();
            formData.append('collar', collarFile!);
            formData.append('survey', surveyFile!);
            formData.append('assay', assayFile!);
            formData.append('collar_mapping', JSON.stringify(mappings.collar));
            formData.append('survey_mapping', JSON.stringify(mappings.survey));
            formData.append('assay_mapping', JSON.stringify(mappings.assay));

            const response = await fetch('/api/drillhole/process', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Processing failed');
            }

            const result = await response.json();
            console.log('[DEBUG] Process result:', { rows: result.rows, columns: result.columns, success: result.success });

            // The process endpoint already returns column_info, so we can use that directly
            // But we also fetch the full data from the data manager
            console.log('[DEBUG] Fetching full data from /api/data...');

            try {
                const [columnsResponse, dataResponse] = await Promise.all([
                    fetch('/api/data/columns'),
                    fetch('/api/data/data?limit=100000')
                ]);

                console.log('[DEBUG] Fetch responses:', {
                    columnsOk: columnsResponse.ok,
                    dataOk: dataResponse.ok
                });

                if (!columnsResponse.ok || !dataResponse.ok) {
                    console.error('[DEBUG] Fetch failed:', {
                        columnsStatus: columnsResponse.status,
                        dataStatus: dataResponse.status
                    });
                    // Fall back to using the result from process endpoint
                    throw new Error('Fetch failed, using process result');
                }

                const columns = await columnsResponse.json();
                const data = await dataResponse.json();
                console.log('[DEBUG] Fetched columns:', columns?.length, 'data rows:', data?.length);

                if (columns && columns.length > 0 && data && data.length > 0) {
                    console.log('[DEBUG] First column:', columns[0]);
                    console.log('[DEBUG] First data row keys:', Object.keys(data[0] || {}));

                    // Update store with full data
                    useAppStore.setState({
                        data: data,
                        columns: columns,
                        isLoading: false,
                        uploadProgress: 100,
                        currentView: 'plots'
                    });
                    console.log('[DEBUG] Store updated with fetched data');
                } else {
                    throw new Error('Empty response from data endpoints');
                }
            } catch (fetchError) {
                console.warn('[DEBUG] Using process result data instead:', fetchError);
                // Fall back to using data from process result
                // Use result.data (full data) first, then result.preview as fallback
                const fallbackData = result.data || result.preview;
                if (result.column_info && fallbackData) {
                    useAppStore.setState({
                        data: fallbackData,  // Use full data if available
                        columns: result.column_info,
                        isLoading: false,
                        uploadProgress: 100,
                        currentView: 'plots'
                    });
                    console.log(`[DEBUG] Store updated with process result data: ${fallbackData.length} rows`);
                } else {
                    throw new Error('No data available');
                }
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
                    <Box sx={{ my: 3, textAlign: 'center' }}>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                            Upload a single flat file containing your data (Excel or CSV format).
                        </Typography>
                        <input
                            accept=".xlsx,.xls,.csv"
                            style={{ display: 'none' }}
                            id="raised-button-file"
                            type="file"
                            onChange={handleFileUpload}
                        />
                        <label htmlFor="raised-button-file">
                            <Button
                                variant="contained"
                                component="span"
                                startIcon={<CloudUpload />}
                                disabled={isLoading}
                                size="large"
                            >
                                {isLoading ? 'Uploading...' : 'Select File'}
                            </Button>
                        </label>
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

                        <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
                            <Button
                                variant="contained"
                                startIcon={<Settings />}
                                onClick={() => {
                                    // Always use manual column mapping
                                    setUseAutoMapping(false);
                                    handleDrillholeUpload();
                                }}
                                disabled={!collarFile || !surveyFile || !assayFile || isLoading}
                            >
                                {isLoading ? 'Processing...' : 'Import Drillhole Data'}
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
                maxWidth="lg"
                fullWidth
            >
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