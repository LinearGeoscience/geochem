import React, { useMemo } from 'react';
import {
    Box,
    Switch,
    FormControlLabel,
    Select,
    MenuItem,
    Typography,
    Chip,
    IconButton,
    Tooltip,
    FormControl,
    InputLabel,
    CircularProgress,
} from '@mui/material';
import { Refresh } from '@mui/icons-material';
import { useAppStore } from '../store/appStore';

export const SamplingControls: React.FC = () => {
    const {
        data,
        columns,
        samplingConfig,
        samplingResult,
        sampleIndices,
        isSampling,
        setSamplingEnabled,
        updateSamplingConfig,
        computeSample,
    } = useAppStore();

    const categoricalColumns = useMemo(
        () => columns.filter(c => c.type === 'categorical' || c.type === 'text'),
        [columns]
    );

    const hasHoleIdColumn = useMemo(
        () => columns.some(c =>
            c.role === 'HoleID' ||
            c.name.toLowerCase().includes('holeid') ||
            c.name.toLowerCase().includes('hole_id') ||
            c.name.toLowerCase().includes('bhid')
        ),
        [columns]
    );

    const drillholeColumn = useMemo(() => {
        const col = columns.find(c =>
            c.role === 'HoleID' ||
            c.name.toLowerCase().includes('holeid') ||
            c.name.toLowerCase().includes('hole_id') ||
            c.name.toLowerCase().includes('bhid')
        );
        return col?.name || null;
    }, [columns]);

    if (data.length === 0) return null;

    const handleResample = () => {
        // Clear seed to get a new random sample
        updateSamplingConfig({ seed: null });
        computeSample();
    };

    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <FormControlLabel
                control={
                    <Switch
                        size="small"
                        checked={samplingConfig.enabled}
                        onChange={(e) => setSamplingEnabled(e.target.checked)}
                    />
                }
                label={
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        Representative Sample
                    </Typography>
                }
                sx={{ mr: 0 }}
            />

            {isSampling && <CircularProgress size={16} />}

            {samplingConfig.enabled && samplingResult && sampleIndices && (
                <>
                    <Chip
                        size="small"
                        label={`${samplingResult.sampleSize.toLocaleString()} of ${samplingResult.totalRows.toLocaleString()} rows${samplingResult.outlierCount > 0 ? ` (${samplingResult.outlierCount} outliers preserved)` : ''}`}
                        color="info"
                        variant="outlined"
                    />

                    <FormControl size="small" sx={{ minWidth: 100 }}>
                        <InputLabel>Size</InputLabel>
                        <Select
                            value={samplingConfig.sampleSize}
                            label="Size"
                            onChange={(e) => updateSamplingConfig({ sampleSize: Number(e.target.value) })}
                        >
                            <MenuItem value={5000}>5,000</MenuItem>
                            <MenuItem value={10000}>10,000</MenuItem>
                            <MenuItem value={20000}>20,000</MenuItem>
                            <MenuItem value={50000}>50,000</MenuItem>
                        </Select>
                    </FormControl>

                    <FormControl size="small" sx={{ minWidth: 120 }}>
                        <InputLabel>Method</InputLabel>
                        <Select
                            value={samplingConfig.method}
                            label="Method"
                            onChange={(e) => {
                                const method = e.target.value as 'random' | 'stratified' | 'drillhole';
                                const updates: any = { method };
                                if (method === 'drillhole' && drillholeColumn) {
                                    updates.drillholeColumn = drillholeColumn;
                                }
                                updateSamplingConfig(updates);
                            }}
                        >
                            <MenuItem value="random">Random</MenuItem>
                            <MenuItem value="stratified">Stratified</MenuItem>
                            {hasHoleIdColumn && <MenuItem value="drillhole">Whole Drillholes</MenuItem>}
                        </Select>
                    </FormControl>

                    {samplingConfig.method === 'stratified' && (
                        <FormControl size="small" sx={{ minWidth: 140 }}>
                            <InputLabel>Stratify By</InputLabel>
                            <Select
                                value={samplingConfig.classificationColumn || ''}
                                label="Stratify By"
                                onChange={(e) => updateSamplingConfig({ classificationColumn: e.target.value || null })}
                            >
                                {categoricalColumns.map(col => (
                                    <MenuItem key={col.name} value={col.name}>
                                        {col.alias || col.name}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    )}

                    <Tooltip title="Draw new random sample">
                        <IconButton size="small" onClick={handleResample} disabled={isSampling}>
                            <Refresh fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </>
            )}
        </Box>
    );
};
