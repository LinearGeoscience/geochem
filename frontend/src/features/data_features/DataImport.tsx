import React, { useCallback, useState } from 'react';
import {
    Box, Button, Typography, Paper, Alert, Tabs, Tab, LinearProgress,
    Dialog, DialogContent, DialogTitle, DialogActions, IconButton, FormControlLabel,
    Checkbox, FormControl, InputLabel, Select, MenuItem, Collapse, Chip
} from '@mui/material';
import { CloudUpload, Layers, Settings, Close, Science, ExpandMore, ExpandLess, FolderOpen } from '@mui/icons-material';
import { useAppStore } from '../../store/appStore';
import { useShallow } from 'zustand/react/shallow';
import { useAttributeStore } from '../../store/attributeStore';
import { DrillholeColumnMapper } from '../../components/DrillholeColumnMapper';
import { dataApi } from '../../services/api';
import { notify } from '../../store/notificationStore';
import { friendlyError } from '../../utils/friendlyError';
import { LODHandling } from '../../utils/vantaPxrfTransform';
import { useFlatFileUpload } from './useFlatFileUpload';

interface ColumnMapping {
    [key: string]: string;
}

export const DataImport: React.FC = () => {
    const { isLoading, uploadProgress, streamingStatus, error, columns } = useAppStore(useShallow(s => ({ isLoading: s.isLoading, uploadProgress: s.uploadProgress, streamingStatus: s.streamingStatus, error: s.error, columns: s.columns })));
    const uploadDrillhole = useAppStore(s => s.uploadDrillhole);
    const [tab, setTab] = useState(0);

    // Drillhole state
    const [collarFile, setCollarFile] = useState<File | null>(null);
    const [surveyFile, setSurveyFile] = useState<File | null>(null);
    const [assayFile, setAssayFile] = useState<File | null>(null);

    // Column mapping state
    const [showMapper, setShowMapper] = useState(false);

    // Vanta PXRF options panel visibility (UI-only)
    const [showPxrfOptions, setShowPxrfOptions] = useState(false);

    // Shared flat-file upload pipeline (also used by the Welcome view)
    const {
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
    } = useFlatFileUpload();
    const lastWorkbook = useAppStore(s => s.lastWorkbook);
    const uploadFile = useAppStore(s => s.uploadFile);

    const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            submitFile(file);
        }
        // Reset input so the same file can be selected again if needed
        event.target.value = '';
    }, [submitFile]);

    const handleDrillholeUploadAuto = () => {
        if (collarFile && surveyFile && assayFile) {
            runOrConfirm(() => {
                // Clear any previous errors and reset attribute classifications for new data
                useAppStore.setState({ error: null });
                useAttributeStore.getState().removeGlobalEntries();
                void uploadDrillhole(collarFile, surveyFile, assayFile);
            });
        }
    };

    const handleDrillholeUploadManual = () => {
        if (collarFile && surveyFile && assayFile) {
            // Confirm up front (mapping ends in the same destructive replace)
            runOrConfirm(() => setShowMapper(true));
        }
    };

    const handleMappingComplete = async (mappings: {
        collar: ColumnMapping;
        survey: ColumnMapping;
        assay: ColumnMapping;
        negateDip: boolean;
        previewToken?: string;
    }) => {
        setShowMapper(false);
        // Reset attribute classifications for new data
        useAttributeStore.getState().removeGlobalEntries();
        useAppStore.setState({ error: null, isLoading: true, uploadProgress: 0 });

        try {
            const formData = new FormData();
            if (mappings.previewToken) {
                // Preview already uploaded and parsed the files server-side —
                // no need to re-upload them
                formData.append('preview_token', mappings.previewToken);
            } else {
                formData.append('collar', collarFile!);
                formData.append('survey', surveyFile!);
                formData.append('assay', assayFile!);
            }
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
            if (!result.column_info?.length) {
                throw new Error('No column info returned from processing');
            }
            useAppStore.setState({ uploadProgress: 50 });

            // Stream the full dataset progressively (matches the auto-upload flow)
            const data = await dataApi.streamData((loaded, total) => {
                useAppStore.setState({ uploadProgress: 50 + Math.round((loaded / Math.max(total, 1)) * 50) });
            });

            const filteredCols = useAppStore.getState().setDataset(data, result.column_info as any[], { showGeochemDialog: true });
            useAppStore.setState({
                isLoading: false,
                uploadProgress: 0,
                currentView: 'plots'
            });
            console.log(`[DrillholeMapping] Streamed ${data.length} rows, ${filteredCols.length} columns`);

        } catch (error) {
            const message = friendlyError(error, 'Drillhole processing failed');
            notify(message, 'error');
            useAppStore.setState({
                error: message,
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
                                            <MenuItem value="censored">
                                                <Box>
                                                    <Typography variant="body2">Store as below detection (Recommended)</Typography>
                                                    <Typography variant="caption" color="text.secondary">
                                                        Keeps the LOD (as −LOD); substituted per Settings
                                                    </Typography>
                                                </Box>
                                            </MenuItem>
                                            <MenuItem value="sqrt2">
                                                <Box>
                                                    <Typography variant="body2">LOD / √2</Typography>
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

                        {/* Workbook with several sheets: reload from another one */}
                        {lastWorkbook && (
                            <Alert severity="info" sx={{ mt: 2, alignItems: 'center' }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                                    <Typography variant="body2">
                                        {lastWorkbook.file.name} has {lastWorkbook.sheets.length} sheets.
                                    </Typography>
                                    <FormControl size="small" sx={{ minWidth: 200 }}>
                                        <InputLabel>Sheet</InputLabel>
                                        <Select
                                            label="Sheet"
                                            value={lastWorkbook.sheet}
                                            onChange={(e) => {
                                                const sheet = e.target.value as string;
                                                runOrConfirm(() => {
                                                    useAttributeStore.getState().removeGlobalEntries();
                                                    void uploadFile(lastWorkbook.file, sheet);
                                                });
                                            }}
                                        >
                                            {lastWorkbook.sheets.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                                        </Select>
                                    </FormControl>
                                </Box>
                            </Alert>
                        )}

                        {/* .gas import Stats */}
                        {interopImportStats && (
                            <Alert severity="success" sx={{ mt: 2 }} icon={<FolderOpen />}>
                                <Typography variant="subtitle2">Project File Imported Successfully</Typography>
                                <Typography variant="caption" component="pre" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                                    {interopImportStats}
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
                            {streamingStatus
                                ? streamingStatus
                                : uploadProgress < 50
                                    ? 'Uploading file...'
                                    : uploadProgress < 100
                                        ? 'Processing data...'
                                        : tab === 1
                                            ? 'Processing drillhole data (desurveying)...'
                                            : 'Preparing display...'}
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

            {/* Confirm before replacing data (wipes styling/classifications) */}
            <Dialog open={confirmAction !== null} onClose={() => setConfirmAction(null)}>
                <DialogTitle>Replace current data?</DialogTitle>
                <DialogContent>
                    <Alert severity="warning" sx={{ mb: 1 }}>
                        Loading new data will discard your current colour/shape/size
                        classifications and painted groups. Save the project first if you
                        want to keep them.
                    </Alert>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmAction(null)}>Cancel</Button>
                    <Button
                        variant="contained"
                        color="warning"
                        onClick={() => { const action = confirmAction; setConfirmAction(null); action?.(); }}
                    >
                        Replace Data
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
};
