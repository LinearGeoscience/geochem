import { useState, useCallback, useRef } from 'react';
import {
    Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography,
    Stepper, Step, StepLabel, Alert, CircularProgress, Slider, Radio,
    RadioGroup, FormControlLabel, FormControl, FormLabel, TextField, Paper
} from '@mui/material';
import { CloudUpload } from '@mui/icons-material';
import { useAppStore } from '../../store/appStore';
import { loggingApi } from '../../services/loggingApi';
import { LoggingColumnMapper } from '../../components/LoggingColumnMapper';
import { LoggingQAQCReport } from '../../components/LoggingQAQCReport';
import type {
    LoggingPreviewResponse,
    LoggingProcessResponse,
    LoggingMapping,
    OverlapStrategy,
} from '../../types/loggingInterval';

const STEPS = ['Upload File', 'Map Columns', 'Overlap Strategy', 'Processing', 'Results'];

export function LoggingIntervalMerge() {
    const { showLoggingMergeDialog, setShowLoggingMergeDialog } = useAppStore();
    const [activeStep, setActiveStep] = useState(0);
    const [file, setFile] = useState<File | null>(null);
    const [preview, setPreview] = useState<LoggingPreviewResponse | null>(null);
    const [mapping, setMapping] = useState<LoggingMapping | null>(null);
    const [strategy, setStrategy] = useState<OverlapStrategy>('max_overlap');
    const [minOverlapPct, setMinOverlapPct] = useState(0);
    const [columnPrefix, setColumnPrefix] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<LoggingProcessResponse | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleClose = () => {
        setShowLoggingMergeDialog(false);
        // Reset state
        setActiveStep(0);
        setFile(null);
        setPreview(null);
        setMapping(null);
        setStrategy('max_overlap');
        setMinOverlapPct(0);
        setColumnPrefix('');

        setError(null);
        setResult(null);
    };

    const handleFileSelect = async (selectedFile: File) => {
        setFile(selectedFile);
        setError(null);
        setPreviewLoading(true);
        try {
            const previewData = await loggingApi.previewLoggingFile(selectedFile);
            setPreview(previewData);
            setPreviewLoading(false);
            setActiveStep(1);
        } catch (err: any) {
            setError(err.response?.data?.detail || err.message || 'Failed to preview file');
            setPreviewLoading(false);
        }
    };

    const handleMappingChange = useCallback((m: LoggingMapping | null) => {
        setMapping(m);
    }, []);

    const handleProcess = async () => {
        if (!file || !mapping) return;
        setActiveStep(3);
        setError(null);
        try {
            const res = await loggingApi.processLoggingMerge(
                file, mapping, strategy, minOverlapPct, columnPrefix
            );
            setResult(res);
    
            setActiveStep(4);
        } catch (err: any) {
            setError(err.response?.data?.detail || err.message || 'Processing failed');
    
            setActiveStep(2); // Go back to strategy step
        }
    };

    const handleApply = () => {
        if (!result) return;
        // Update the store with new data + columns
        useAppStore.setState({
            data: result.data,
            columns: result.column_info,
        });
        handleClose();
    };

    const canProceedFromMapping = mapping !== null;
    const hasOverlaps = preview?.detected_overlaps?.has_overlaps ?? false;

    const handleNext = () => {
        if (activeStep === 1) {
            if (hasOverlaps) {
                setActiveStep(2);
            } else {
                // Skip overlap step, go straight to processing
                handleProcess();
            }
        } else if (activeStep === 2) {
            handleProcess();
        }
    };

    const renderStepContent = () => {
        switch (activeStep) {
            case 0:
                return (
                    <Box sx={{ textAlign: 'center', py: 4 }}>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".csv,.xlsx,.xls"
                            style={{ display: 'none' }}
                            onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) handleFileSelect(f);
                            }}
                        />
                        <CloudUpload sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
                        <Typography variant="h6" gutterBottom>
                            Upload Logging Interval File
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                            Select a CSV or Excel file containing logging intervals (lithology, alteration, structural, etc.)
                            with HoleID, From, To, and Category columns.
                        </Typography>
                        <Button
                            variant="contained"
                            startIcon={<CloudUpload />}
                            onClick={() => fileInputRef.current?.click()}
                            disabled={previewLoading}
                        >
                            {previewLoading ? 'Reading file...' : 'Select File'}
                        </Button>
                        {previewLoading && <CircularProgress size={24} sx={{ ml: 2 }} />}
                        {file && (
                            <Typography variant="body2" sx={{ mt: 1 }}>
                                {file.name} ({(file.size / 1024).toFixed(0)} KB)
                            </Typography>
                        )}
                    </Box>
                );

            case 1:
                return preview ? (
                    <Box>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                            {preview.total_rows.toLocaleString()} rows detected in file.
                        </Typography>
                        <LoggingColumnMapper
                            columns={preview.columns}
                            preview={preview.preview}
                            onMappingChange={handleMappingChange}
                        />
                        {hasOverlaps && (
                            <Alert severity="warning" sx={{ mt: 2 }}>
                                {preview.detected_overlaps.overlap_count} overlapping interval(s) detected across{' '}
                                {preview.detected_overlaps.holes_with_overlaps.length} hole(s).
                                You'll choose how to handle these in the next step.
                            </Alert>
                        )}
                    </Box>
                ) : null;

            case 2:
                return (
                    <Box>
                        <Alert severity="warning" sx={{ mb: 3 }}>
                            <strong>{preview?.detected_overlaps.overlap_count} overlapping intervals</strong> detected across{' '}
                            {preview?.detected_overlaps.holes_with_overlaps.length} hole(s).
                            {preview?.detected_overlaps.sample_overlaps.slice(0, 2).map((ex, i) => (
                                <Typography key={i} variant="body2" sx={{ mt: 0.5 }}>
                                    e.g., {ex.hole_id} @ {ex.log_froms[0]}-{ex.log_tos[0]}m ({ex.log_values[0]}) overlaps {ex.log_froms[1]}-{ex.log_tos[1]}m ({ex.log_values[1]})
                                </Typography>
                            ))}
                        </Alert>

                        <FormControl component="fieldset" sx={{ mb: 3 }}>
                            <FormLabel component="legend">How should overlapping intervals be handled?</FormLabel>
                            <RadioGroup value={strategy} onChange={(e) => setStrategy(e.target.value as OverlapStrategy)}>
                                <Paper variant="outlined" sx={{ p: 2, mb: 1, cursor: 'pointer', border: strategy === 'split_columns' ? 2 : 1, borderColor: strategy === 'split_columns' ? 'primary.main' : 'divider' }}>
                                    <FormControlLabel
                                        value="split_columns"
                                        control={<Radio />}
                                        label={
                                            <Box>
                                                <Typography fontWeight="bold">Separate columns per value</Typography>
                                                <Typography variant="body2" color="text.secondary">
                                                    Creates individual Yes/No columns for each category value.
                                                    Best for overlapping data where you need each category independently.
                                                </Typography>
                                            </Box>
                                        }
                                    />
                                </Paper>
                                <Paper variant="outlined" sx={{ p: 2, mb: 1, cursor: 'pointer', border: strategy === 'combine_codes' ? 2 : 1, borderColor: strategy === 'combine_codes' ? 'primary.main' : 'divider' }}>
                                    <FormControlLabel
                                        value="combine_codes"
                                        control={<Radio />}
                                        label={
                                            <Box>
                                                <Typography fontWeight="bold">Combine codes</Typography>
                                                <Typography variant="body2" color="text.secondary">
                                                    Single column with pipe-delimited values where intervals overlap
                                                    (e.g., "Fault Zone | Shear Zone").
                                                </Typography>
                                            </Box>
                                        }
                                    />
                                </Paper>
                                <Paper variant="outlined" sx={{ p: 2, mb: 1, cursor: 'pointer', border: strategy === 'max_overlap' ? 2 : 1, borderColor: strategy === 'max_overlap' ? 'primary.main' : 'divider' }}>
                                    <FormControlLabel
                                        value="max_overlap"
                                        control={<Radio />}
                                        label={
                                            <Box>
                                                <Typography fontWeight="bold">Use dominant interval</Typography>
                                                <Typography variant="body2" color="text.secondary">
                                                    Single column, picks the interval with the most overlap.
                                                    Simplest option, but loses information where intervals overlap.
                                                </Typography>
                                            </Box>
                                        }
                                    />
                                </Paper>
                            </RadioGroup>
                        </FormControl>

                        <Box sx={{ mb: 2 }}>
                            <Typography variant="subtitle2" gutterBottom>
                                Minimum overlap threshold: {minOverlapPct}%
                            </Typography>
                            <Slider
                                value={minOverlapPct}
                                onChange={(_, val) => setMinOverlapPct(val as number)}
                                min={0}
                                max={100}
                                step={5}
                                valueLabelDisplay="auto"
                                sx={{ maxWidth: 400 }}
                            />
                            <Typography variant="caption" color="text.secondary">
                                Only assign categories where the logging interval covers at least this percentage of the assay interval.
                            </Typography>
                        </Box>

                        {strategy === 'split_columns' && (
                            <TextField
                                label="Column name prefix"
                                value={columnPrefix}
                                onChange={(e) => setColumnPrefix(e.target.value)}
                                size="small"
                                placeholder={mapping?.category || 'Category'}
                                helperText={`Columns will be named: ${columnPrefix || mapping?.category || 'Category'}_Value1, ${columnPrefix || mapping?.category || 'Category'}_Value2, etc.`}
                                sx={{ maxWidth: 300 }}
                            />
                        )}
                        {(strategy === 'max_overlap' || strategy === 'combine_codes') && (
                            <TextField
                                label="Output column name"
                                value={columnPrefix}
                                onChange={(e) => setColumnPrefix(e.target.value)}
                                size="small"
                                placeholder={mapping?.category || 'Category'}
                                helperText="Name for the new column in your data"
                                sx={{ maxWidth: 300 }}
                            />
                        )}
                    </Box>
                );

            case 3:
                return (
                    <Box sx={{ textAlign: 'center', py: 6 }}>
                        <CircularProgress size={48} sx={{ mb: 2 }} />
                        <Typography variant="h6">Processing...</Typography>
                        <Typography variant="body2" color="text.secondary">
                            Matching logging intervals to assay data
                        </Typography>
                    </Box>
                );

            case 4:
                return result ? (
                    <LoggingQAQCReport
                        report={result.qaqc}
                        columnsAdded={result.columns_added}
                    />
                ) : null;

            default:
                return null;
        }
    };

    return (
        <Dialog
            open={showLoggingMergeDialog}
            onClose={handleClose}
            maxWidth="md"
            fullWidth
            PaperProps={{ sx: { minHeight: 500 } }}
        >
            <DialogTitle>Merge Logging Intervals</DialogTitle>
            <DialogContent>
                <Stepper activeStep={activeStep} sx={{ mb: 3, pt: 1 }}>
                    {STEPS.map((label, index) => (
                        <Step key={label} completed={activeStep > index}>
                            <StepLabel>{label}</StepLabel>
                        </Step>
                    ))}
                </Stepper>

                {error && (
                    <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
                        {error}
                    </Alert>
                )}

                {renderStepContent()}
            </DialogContent>
            <DialogActions>
                {activeStep === 4 ? (
                    <>
                        <Button onClick={handleClose}>Cancel</Button>
                        <Button variant="contained" onClick={handleApply}>
                            Apply & Close
                        </Button>
                    </>
                ) : activeStep === 3 ? null : (
                    <>
                        <Button onClick={handleClose}>Cancel</Button>
                        {activeStep > 0 && activeStep < 3 && (
                            <Button onClick={() => setActiveStep(prev => prev - 1)}>
                                Back
                            </Button>
                        )}
                        {(activeStep === 1 || activeStep === 2) && (
                            <Button
                                variant="contained"
                                onClick={handleNext}
                                disabled={activeStep === 1 && !canProceedFromMapping}
                            >
                                {activeStep === 2 || !hasOverlaps ? 'Process' : 'Next'}
                            </Button>
                        )}
                    </>
                )}
            </DialogActions>
        </Dialog>
    );
}
