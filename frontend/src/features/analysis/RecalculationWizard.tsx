/**
 * Barnes (2023) Geochemical Recalculation Wizard
 *
 * 6-step MUI Stepper workflow implementing whole-rock recalculation:
 * 0. Column Assignment — map data columns to geochemical roles
 * 1. Rock Suite & Fe Splitting — select rock type and FeO/Fe2O3 ramp
 * 2. Volatile Correction — configure LOI/volatile handling
 * 3. Sulfide Correction — configure sulfide correction parameters
 * 4. Execute & Review — run recalculation and preview results
 * 5. Output & Data Views — add columns to dataset
 */

import React, { useEffect, useMemo, useCallback } from 'react';
import {
    Box,
    Paper,
    Typography,
    Button,
    Stepper,
    Step,
    StepLabel,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    TextField,
    Slider,
    Alert,
    CircularProgress,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Switch,
    FormControlLabel,
    RadioGroup,
    Radio,
    Checkbox,
    Chip,
    Tooltip,
    Divider,
} from '@mui/material';
import Plot from 'react-plotly.js';
import { useAppStore } from '../../store/appStore';
import { useRecalculationStore } from '../../store/recalculationStore';
import {
    RockSuiteType,
    RECALC_MAJOR_OXIDES,
} from '../../types/recalculation';
import { ELEMENT_OXIDE_CONVERSIONS, UNIT_CONVERSIONS } from '../../utils/calculations/constants';
import { OXIDE_MAPPINGS } from '../../utils/calculations/elementNameNormalizer';
import { computeFeRamp } from '../../utils/calculations/barnesRecalculation';
import { clrTransform } from '../../utils/logratioTransforms';

const STEPS = [
    'Column Assignment',
    'Rock Suite & Fe Splitting',
    'Volatile Correction',
    'Sulfide Correction',
    'Execute & Review',
    'Output & Data Views',
];

// ============================================================================
// STEP 0: Column Assignment
// ============================================================================

const StepColumnAssignment: React.FC = () => {
    const { columns, geochemMappings } = useAppStore();
    const { config, updateColumnAssignments, autoDetectColumns } = useRecalculationStore();
    const { columnAssignments } = config;

    const numericColumns = useMemo(
        () => columns.filter(c => c.type === 'numeric' || c.type === 'float' || c.type === 'integer'),
        [columns]
    );

    useEffect(() => {
        // Auto-detect on first render if no assignments yet
        if (Object.keys(columnAssignments.majorOxides).length === 0 && geochemMappings.length > 0) {
            autoDetectColumns(geochemMappings);
        }
    }, [geochemMappings, columnAssignments.majorOxides, autoDetectColumns]);

    const handleOxideChange = useCallback((oxide: string, colName: string) => {
        const updatedOxides = { ...columnAssignments.majorOxides };
        const updatedConversions = { ...columnAssignments.oxideConversions };

        if (colName === '') {
            delete updatedOxides[oxide];
            delete updatedConversions[oxide];
        } else {
            updatedOxides[oxide] = colName;
            // Clear any existing conversion for this oxide
            delete updatedConversions[oxide];

            // Check if the selected column is an element (not oxide) via geochemMappings
            const mapping = geochemMappings.find(m => m.originalName === colName);
            if (mapping) {
                const element = mapping.userOverride ?? mapping.detectedElement;
                const unit = mapping.userUnit ?? mapping.detectedUnit;
                const expectedElement = OXIDE_MAPPINGS[oxide];
                // If the column is an element match (not already an oxide column)
                if (element && element === expectedElement && unit !== 'pct') {
                    const convFactor = ELEMENT_OXIDE_CONVERSIONS.find(
                        c => c.element === element && c.oxide === oxide
                    );
                    if (convFactor) {
                        const unitFactor = unit === 'ppm'
                            ? UNIT_CONVERSIONS.ppm_to_wt_percent
                            : unit === 'ppb'
                                ? UNIT_CONVERSIONS.ppb_to_wt_percent
                                : 1.0;
                        updatedConversions[oxide] = {
                            element,
                            sourceUnit: unit || 'ppm',
                            targetOxide: oxide,
                            elementToOxideFactor: convFactor.elementToOxide,
                            unitConversionFactor: unitFactor,
                        };
                    }
                }
            }
        }
        updateColumnAssignments({ majorOxides: updatedOxides, oxideConversions: updatedConversions });
    }, [columnAssignments.majorOxides, columnAssignments.oxideConversions, geochemMappings, updateColumnAssignments]);

    const requiredMet = !!(
        columnAssignments.majorOxides['SiO2'] &&
        columnAssignments.majorOxides['MgO'] &&
        (columnAssignments.feColumn || (columnAssignments.feoColumn && columnAssignments.fe2o3Column)) &&
        (columnAssignments.loiColumn || columnAssignments.h2oColumn)
    );

    return (
        <Box>
            <Typography variant="h6" gutterBottom>Map Data Columns to Geochemical Roles</Typography>
            <Alert severity="info" sx={{ mb: 2 }}>
                Columns have been auto-detected from your geochemical mappings. Verify and correct any assignments below.
                Required: SiO2, MgO, Fe (any form), and LOI or H2O.
            </Alert>

            {!requiredMet && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                    Missing required columns. At minimum assign SiO2, MgO, an Fe column, and LOI/H2O.
                </Alert>
            )}

            <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>Major Oxides</Typography>
            <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell>Oxide</TableCell>
                            <TableCell>Column</TableCell>
                            <TableCell>Status</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {RECALC_MAJOR_OXIDES.map(oxide => (
                            <TableRow key={oxide}>
                                <TableCell sx={{ fontWeight: 'bold' }}>{oxide}</TableCell>
                                <TableCell>
                                    <FormControl size="small" fullWidth>
                                        <Select
                                            value={columnAssignments.majorOxides[oxide] || ''}
                                            onChange={(e) => handleOxideChange(oxide, e.target.value as string)}
                                            displayEmpty
                                        >
                                            <MenuItem value=""><em>Not assigned</em></MenuItem>
                                            {numericColumns.map(c => (
                                                <MenuItem key={c.name} value={c.name}>{c.alias || c.name}</MenuItem>
                                            ))}
                                        </Select>
                                    </FormControl>
                                </TableCell>
                                <TableCell>
                                    {columnAssignments.majorOxides[oxide]
                                        ? (<Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
                                            <Chip size="small" label="Assigned" color="success" />
                                            {columnAssignments.oxideConversions[oxide] && (
                                                <Tooltip title={`Converting ${columnAssignments.oxideConversions[oxide].element} (${columnAssignments.oxideConversions[oxide].sourceUnit}) to ${oxide} using factor ${columnAssignments.oxideConversions[oxide].elementToOxideFactor.toFixed(4)}`}>
                                                    <Chip
                                                        size="small"
                                                        label={`${columnAssignments.oxideConversions[oxide].element} (${columnAssignments.oxideConversions[oxide].sourceUnit}) \u2192 ${oxide}`}
                                                        color="warning"
                                                        variant="outlined"
                                                    />
                                                </Tooltip>
                                            )}
                                        </Box>)
                                        : (oxide === 'SiO2' || oxide === 'MgO')
                                            ? <Chip size="small" label="Required" color="error" />
                                            : <Chip size="small" label="Optional" color="default" />
                                    }
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>

            <Typography variant="subtitle2" sx={{ mb: 1 }}>Iron Columns</Typography>
            <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
                <FormControl size="small" sx={{ minWidth: 200 }}>
                    <InputLabel>Total Fe Column</InputLabel>
                    <Select
                        value={columnAssignments.feColumn || ''}
                        onChange={(e) => updateColumnAssignments({ feColumn: e.target.value as string || null })}
                        label="Total Fe Column"
                    >
                        <MenuItem value=""><em>None</em></MenuItem>
                        {numericColumns.map(c => (
                            <MenuItem key={c.name} value={c.name}>{c.alias || c.name}</MenuItem>
                        ))}
                    </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 140 }}>
                    <InputLabel>Reported As</InputLabel>
                    <Select
                        value={columnAssignments.feColumnForm}
                        onChange={(e) => updateColumnAssignments({ feColumnForm: e.target.value as any })}
                        label="Reported As"
                    >
                        <MenuItem value="FeOT">FeOT</MenuItem>
                        <MenuItem value="Fe2O3T">Fe2O3T</MenuItem>
                        <MenuItem value="Fe2O3">Fe2O3</MenuItem>
                        <MenuItem value="FeO">FeO</MenuItem>
                    </Select>
                </FormControl>
            </Box>
            <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
                <FormControl size="small" sx={{ minWidth: 200 }}>
                    <InputLabel>Separate FeO</InputLabel>
                    <Select
                        value={columnAssignments.feoColumn || ''}
                        onChange={(e) => updateColumnAssignments({ feoColumn: e.target.value as string || null })}
                        label="Separate FeO"
                    >
                        <MenuItem value=""><em>None</em></MenuItem>
                        {numericColumns.map(c => (
                            <MenuItem key={c.name} value={c.name}>{c.alias || c.name}</MenuItem>
                        ))}
                    </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 200 }}>
                    <InputLabel>Separate Fe2O3</InputLabel>
                    <Select
                        value={columnAssignments.fe2o3Column || ''}
                        onChange={(e) => updateColumnAssignments({ fe2o3Column: e.target.value as string || null })}
                        label="Separate Fe2O3"
                    >
                        <MenuItem value=""><em>None</em></MenuItem>
                        {numericColumns.map(c => (
                            <MenuItem key={c.name} value={c.name}>{c.alias || c.name}</MenuItem>
                        ))}
                    </Select>
                </FormControl>
            </Box>

            <Typography variant="subtitle2" sx={{ mb: 1 }}>Sulfide Elements</Typography>
            <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
                {[
                    { label: 'Sulfur (S)', key: 'sColumn' as const },
                    { label: 'Copper (Cu)', key: 'cuColumn' as const },
                    { label: 'Nickel (Ni)', key: 'niColumn' as const },
                ].map(({ label, key }) => (
                    <FormControl key={key} size="small" sx={{ minWidth: 200 }}>
                        <InputLabel>{label}</InputLabel>
                        <Select
                            value={columnAssignments[key] || ''}
                            onChange={(e) => updateColumnAssignments({ [key]: e.target.value as string || null })}
                            label={label}
                        >
                            <MenuItem value=""><em>None</em></MenuItem>
                            {numericColumns.map(c => (
                                <MenuItem key={c.name} value={c.name}>{c.alias || c.name}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                ))}
            </Box>

            <Typography variant="subtitle2" sx={{ mb: 1 }}>Volatile Columns</Typography>
            <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
                {[
                    { label: 'LOI', key: 'loiColumn' as const },
                    { label: 'H2O', key: 'h2oColumn' as const },
                    { label: 'CO2', key: 'co2Column' as const },
                ].map(({ label, key }) => (
                    <FormControl key={key} size="small" sx={{ minWidth: 200 }}>
                        <InputLabel>{label}</InputLabel>
                        <Select
                            value={columnAssignments[key] || ''}
                            onChange={(e) => updateColumnAssignments({ [key]: e.target.value as string || null })}
                            label={label}
                        >
                            <MenuItem value=""><em>None</em></MenuItem>
                            {numericColumns.map(c => (
                                <MenuItem key={c.name} value={c.name}>{c.alias || c.name}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                ))}
            </Box>
        </Box>
    );
};

// ============================================================================
// STEP 1: Rock Suite & Fe Splitting
// ============================================================================

const StepFeRamp: React.FC = () => {
    const { config, updateFeRampConfig } = useRecalculationStore();
    const { feRampConfig } = config;

    // Generate ramp curve data for visualization
    const rampData = useMemo(() => {
        const mgoValues: number[] = [];
        const ratioValues: number[] = [];
        for (let mgo = 0; mgo <= 55; mgo += 0.5) {
            mgoValues.push(mgo);
            ratioValues.push(computeFeRamp(mgo, feRampConfig));
        }
        return { mgoValues, ratioValues };
    }, [feRampConfig]);

    return (
        <Box>
            <Typography variant="h6" gutterBottom>Rock Suite & Fe2O3/FeO Splitting</Typography>
            <Alert severity="info" sx={{ mb: 2 }}>
                Select the rock suite type to set the MgO-dependent Fe2O3/FeO ramp function.
                This determines how total iron is split into ferrous (FeO) and ferric (Fe2O3) components
                based on the sample&apos;s MgO content — more magnesian (cumulate) samples have proportionally
                less Fe2O3.
            </Alert>

            <Typography variant="subtitle2" sx={{ mb: 1 }}>Rock Suite Type</Typography>
            <RadioGroup
                value={feRampConfig.suiteType}
                onChange={(e) => updateFeRampConfig({ suiteType: e.target.value as RockSuiteType })}
                sx={{ mb: 2 }}
            >
                <FormControlLabel value="komatiite" control={<Radio />} label="Komatiite (MgO 25–50%)" />
                <FormControlLabel value="komatiitic-basalt" control={<Radio />} label="Komatiitic Basalt (MgO 16–48%)" />
                <FormControlLabel value="mafic-cumulate" control={<Radio />} label="Mafic Cumulate (MgO 10–40%)" />
                <FormControlLabel value="custom" control={<Radio />} label="Custom Range" />
            </RadioGroup>

            {feRampConfig.suiteType === 'custom' && (
                <Box sx={{ display: 'flex', gap: 3, mb: 2, flexWrap: 'wrap' }}>
                    <TextField
                        label="MgO Low (liquid end)"
                        type="number"
                        size="small"
                        value={feRampConfig.mgoLow}
                        onChange={(e) => updateFeRampConfig({ mgoLow: parseFloat(e.target.value) || 0 })}
                        sx={{ width: 160 }}
                    />
                    <TextField
                        label="MgO High (cumulate end)"
                        type="number"
                        size="small"
                        value={feRampConfig.mgoHigh}
                        onChange={(e) => updateFeRampConfig({ mgoHigh: parseFloat(e.target.value) || 0 })}
                        sx={{ width: 180 }}
                    />
                    <TextField
                        label="Liquid Ratio"
                        type="number"
                        size="small"
                        value={feRampConfig.liquidRatio}
                        onChange={(e) => updateFeRampConfig({ liquidRatio: parseFloat(e.target.value) || 0.1 })}
                        inputProps={{ step: 0.01, min: 0, max: 0.5 }}
                        sx={{ width: 140 }}
                    />
                </Box>
            )}

            <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
                Current Parameters: MgO {feRampConfig.mgoLow}–{feRampConfig.mgoHigh}%, Liquid ratio = {feRampConfig.liquidRatio}
            </Typography>

            <Paper variant="outlined" sx={{ p: 1, mb: 2 }}>
                <Plot
                    data={[
                        {
                            x: rampData.mgoValues,
                            y: rampData.ratioValues,
                            type: 'scatter',
                            mode: 'lines',
                            line: { color: '#1976d2', width: 2 },
                            name: 'Fe2O3/[FeO+Fe2O3]',
                        },
                    ]}
                    layout={{
                        title: { text: 'Fe2O3/FeO Ramp Function' } as any,
                        xaxis: { title: { text: 'MgO (wt%, anhydrous)' } as any, range: [0, 55] },
                        yaxis: { title: { text: 'Fe2O3/[FeO+Fe2O3] molar ratio' } as any, range: [0, 0.15] },
                        height: 300,
                        margin: { t: 40, b: 50, l: 60, r: 20 },
                        showlegend: false,
                    }}
                    config={{ displayModeBar: false }}
                    style={{ width: '100%' }}
                />
            </Paper>
        </Box>
    );
};

// ============================================================================
// STEP 2: Volatile Correction
// ============================================================================

const StepVolatile: React.FC = () => {
    const { data } = useAppStore();
    const { config, updateVolatileConfig } = useRecalculationStore();
    const { volatileConfig } = config;

    // LOI distribution for histogram
    const loiValues = useMemo(() => {
        const col = volatileConfig.useLoiAsVolatile
            ? volatileConfig.loiColumn
            : volatileConfig.h2oColumn;
        if (!col) return [];
        return data
            .map(row => {
                const v = row[col];
                return typeof v === 'number' ? v : parseFloat(v);
            })
            .filter(v => !isNaN(v));
    }, [data, volatileConfig]);

    return (
        <Box>
            <Typography variant="h6" gutterBottom>Volatile Correction</Typography>
            <Alert severity="info" sx={{ mb: 2 }}>
                Choose how to handle volatile components. LOI (Loss on Ignition) is the most common
                measure. Alternatively, use measured H2O + CO2 if available.
            </Alert>

            <FormControlLabel
                control={
                    <Switch
                        checked={volatileConfig.useLoiAsVolatile}
                        onChange={(e) => updateVolatileConfig({ useLoiAsVolatile: e.target.checked })}
                    />
                }
                label={volatileConfig.useLoiAsVolatile ? 'Using LOI as volatile' : 'Using H2O + CO2 as volatile'}
                sx={{ mb: 2 }}
            />

            {volatileConfig.useLoiAsVolatile ? (
                <Box sx={{ mb: 2 }}>
                    <Typography variant="body2" color="text.secondary">
                        LOI Column: <strong>{volatileConfig.loiColumn || 'Not assigned'}</strong>
                    </Typography>
                </Box>
            ) : (
                <Box sx={{ mb: 2 }}>
                    <Typography variant="body2" color="text.secondary">
                        H2O Column: <strong>{volatileConfig.h2oColumn || 'Not assigned'}</strong>
                        {' | '}
                        CO2 Column: <strong>{volatileConfig.co2Column || 'Not assigned'}</strong>
                    </Typography>
                </Box>
            )}

            <Box sx={{ mb: 3 }}>
                <Typography variant="subtitle2" gutterBottom>
                    Max LOI Filter (optional) — exclude samples above this value
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <FormControlLabel
                        control={
                            <Switch
                                checked={volatileConfig.maxLoiFilter !== null}
                                onChange={(e) => updateVolatileConfig({
                                    maxLoiFilter: e.target.checked ? 10 : null
                                })}
                            />
                        }
                        label="Enable"
                    />
                    {volatileConfig.maxLoiFilter !== null && (
                        <Slider
                            value={volatileConfig.maxLoiFilter}
                            onChange={(_, v) => updateVolatileConfig({ maxLoiFilter: v as number })}
                            min={0}
                            max={30}
                            step={0.5}
                            valueLabelDisplay="on"
                            sx={{ width: 300 }}
                        />
                    )}
                </Box>
            </Box>

            {loiValues.length > 0 && (
                <Paper variant="outlined" sx={{ p: 1 }}>
                    <Plot
                        data={[
                            {
                                x: loiValues,
                                type: 'histogram',
                                nbinsx: 40,
                                marker: { color: '#2196f3' },
                                name: volatileConfig.useLoiAsVolatile ? 'LOI' : 'H2O',
                            } as any,
                        ]}
                        layout={{
                            title: { text: `${volatileConfig.useLoiAsVolatile ? 'LOI' : 'H2O'} Distribution (n=${loiValues.length})` } as any,
                            xaxis: { title: { text: 'wt%' } as any },
                            yaxis: { title: { text: 'Count' } as any },
                            height: 250,
                            margin: { t: 40, b: 50, l: 50, r: 20 },
                            showlegend: false,
                            shapes: volatileConfig.maxLoiFilter !== null ? [{
                                type: 'line',
                                x0: volatileConfig.maxLoiFilter,
                                x1: volatileConfig.maxLoiFilter,
                                y0: 0,
                                y1: 1,
                                yref: 'paper',
                                line: { color: 'red', width: 2, dash: 'dash' },
                            }] : [],
                        }}
                        config={{ displayModeBar: false }}
                        style={{ width: '100%' }}
                    />
                </Paper>
            )}
        </Box>
    );
};

// ============================================================================
// STEP 3: Sulfide Correction
// ============================================================================

const StepSulfide: React.FC = () => {
    const { data } = useAppStore();
    const { config, updateSulfideConfig } = useRecalculationStore();
    const { sulfideConfig, columnAssignments } = config;

    const canDoSulfide = !!columnAssignments.sColumn;

    // S distribution
    const sValues = useMemo(() => {
        if (!columnAssignments.sColumn) return [];
        return data
            .map(row => {
                const v = row[columnAssignments.sColumn!];
                return typeof v === 'number' ? v : parseFloat(v);
            })
            .filter(v => !isNaN(v));
    }, [data, columnAssignments.sColumn]);

    if (!canDoSulfide) {
        return (
            <Box>
                <Typography variant="h6" gutterBottom>Sulfide Correction</Typography>
                <Alert severity="warning">
                    No sulfur column assigned. Sulfide correction will be skipped.
                    The recalculation will still perform anhydrous normalization and Fe splitting.
                </Alert>
            </Box>
        );
    }

    return (
        <Box>
            <Typography variant="h6" gutterBottom>Sulfide Correction</Typography>
            <Alert severity="info" sx={{ mb: 2 }}>
                <strong>Method 1</strong> (high S): Estimates silicate Ni from MgO, then calculates sulfide Fe by stoichiometry.
                Best for massive/semi-massive sulfide samples.
                <br />
                <strong>Method 2</strong> (low S): Assumes a Fe/Ni molar ratio in sulfide to partition metals.
                Best for disseminated sulfide samples.
                <br />
                <strong>Auto</strong>: Uses Method 1 when S &gt; threshold, Method 2 when S &lt; threshold.
            </Alert>

            <Box sx={{ display: 'flex', gap: 3, mb: 3, flexWrap: 'wrap' }}>
                <FormControl size="small" sx={{ minWidth: 180 }}>
                    <InputLabel>Method Selection</InputLabel>
                    <Select
                        value={sulfideConfig.method}
                        onChange={(e) => updateSulfideConfig({ method: e.target.value as any })}
                        label="Method Selection"
                    >
                        <MenuItem value="auto">Auto (recommended)</MenuItem>
                        <MenuItem value="method1">Method 1 only</MenuItem>
                        <MenuItem value="method2">Method 2 only</MenuItem>
                    </Select>
                </FormControl>

                {sulfideConfig.method === 'auto' && (
                    <TextField
                        label="S Threshold (wt%)"
                        type="number"
                        size="small"
                        value={sulfideConfig.sThreshold}
                        onChange={(e) => updateSulfideConfig({ sThreshold: parseFloat(e.target.value) || 2.0 })}
                        inputProps={{ step: 0.1, min: 0 }}
                        sx={{ width: 160 }}
                        helperText="Method 1 if S > this"
                    />
                )}
            </Box>

            <Typography variant="subtitle2" sx={{ mb: 1 }}>Stoichiometric Parameters</Typography>
            <Box sx={{ display: 'flex', gap: 3, mb: 3, flexWrap: 'wrap' }}>
                <Tooltip title="S/(Fe+Ni) molar ratio in sulfide. 1.0 for stoichiometric pentlandite-pyrrhotite.">
                    <TextField
                        label="SM (S/metal ratio)"
                        type="number"
                        size="small"
                        value={sulfideConfig.sm}
                        onChange={(e) => updateSulfideConfig({ sm: parseFloat(e.target.value) || 1.0 })}
                        inputProps={{ step: 0.1, min: 0.1 }}
                        sx={{ width: 160 }}
                    />
                </Tooltip>
                <Tooltip title="Fe/Ni molar ratio in sulfide for Method 2. Typical range 1–10.">
                    <TextField
                        label="FN (Fe/Ni ratio)"
                        type="number"
                        size="small"
                        value={sulfideConfig.fn}
                        onChange={(e) => updateSulfideConfig({ fn: parseFloat(e.target.value) || 3.0 })}
                        inputProps={{ step: 0.5, min: 0.1 }}
                        sx={{ width: 160 }}
                    />
                </Tooltip>
                <Tooltip title="Override auto-calculated silicate Ni (ppm). Leave blank for automatic.">
                    <TextField
                        label="Silicate Ni Override (ppm)"
                        type="number"
                        size="small"
                        value={sulfideConfig.silicateNiOverride ?? ''}
                        onChange={(e) => updateSulfideConfig({
                            silicateNiOverride: e.target.value ? parseFloat(e.target.value) : null
                        })}
                        inputProps={{ min: 0 }}
                        sx={{ width: 200 }}
                    />
                </Tooltip>
            </Box>

            {sValues.length > 0 && (
                <Paper variant="outlined" sx={{ p: 1 }}>
                    <Plot
                        data={[
                            {
                                x: sValues,
                                type: 'histogram',
                                nbinsx: 50,
                                marker: { color: '#ff9800' },
                                name: 'Sulfur',
                            } as any,
                        ]}
                        layout={{
                            title: { text: `Sulfur Distribution (n=${sValues.length})` } as any,
                            xaxis: { title: { text: 'S (wt%)' } as any },
                            yaxis: { title: { text: 'Count' } as any },
                            height: 250,
                            margin: { t: 40, b: 50, l: 50, r: 20 },
                            showlegend: false,
                            shapes: sulfideConfig.method === 'auto' ? [{
                                type: 'line',
                                x0: sulfideConfig.sThreshold,
                                x1: sulfideConfig.sThreshold,
                                y0: 0,
                                y1: 1,
                                yref: 'paper',
                                line: { color: 'red', width: 2, dash: 'dash' },
                            }] : [],
                        }}
                        config={{ displayModeBar: false }}
                        style={{ width: '100%' }}
                    />
                </Paper>
            )}
        </Box>
    );
};

// ============================================================================
// STEP 4: Execute & Review
// ============================================================================

const StepExecute: React.FC = () => {
    const { data, geochemMappings } = useAppStore();
    const { results, isProcessing, error, hasExecuted, executeRecalculation } = useRecalculationStore();

    const handleExecute = useCallback(() => {
        executeRecalculation(data, geochemMappings);
    }, [data, geochemMappings, executeRecalculation]);

    // Summary stats
    const summary = useMemo(() => {
        if (!results) return null;
        const nRows = data.length;
        const nWarnings = results.warnings.length;

        // Count method usage
        const method1Count = results.diagnosticColumns['Sulfide_Method']?.filter(v => v === 1).length || 0;
        const method2Count = results.diagnosticColumns['Sulfide_Method']?.filter(v => v === 2).length || 0;

        // Mean sulfide mode
        const sulfideModes = results.diagnosticColumns['Sulfide_Mode_wt%']?.filter(v => v !== null) as number[];
        const meanSulfideMode = sulfideModes.length > 0
            ? sulfideModes.reduce((a, b) => a + b, 0) / sulfideModes.length
            : 0;

        // Mean Ni tenor
        const tenors = results.diagnosticColumns['Ni_Tenor']?.filter(v => v !== null) as number[];
        const meanTenor = tenors.length > 0
            ? tenors.reduce((a, b) => a + b, 0) / tenors.length
            : null;

        return { nRows, nWarnings, method1Count, method2Count, meanSulfideMode, meanTenor };
    }, [results, data.length]);

    // Preview table (first 15 rows)
    const previewRows = useMemo(() => {
        if (!results) return [];
        const n = Math.min(15, data.length);
        const rows: Record<string, any>[] = [];
        for (let i = 0; i < n; i++) {
            const row: Record<string, any> = { index: i + 1 };
            // Key recalculated columns
            for (const key of ['SiO2_recalc', 'MgO_recalc', 'FeO_recalc', 'Fe2O3_recalc']) {
                row[key] = results.recalculatedColumns[key]?.[i]?.toFixed(2) ?? '-';
            }
            row['Sulfide_Mode'] = results.diagnosticColumns['Sulfide_Mode_wt%']?.[i]?.toFixed(2) ?? '-';
            row['Ni_Tenor'] = results.diagnosticColumns['Ni_Tenor']?.[i]?.toFixed(2) ?? '-';
            rows.push(row);
        }
        return rows;
    }, [results, data.length]);

    return (
        <Box>
            <Typography variant="h6" gutterBottom>Execute Recalculation</Typography>

            <Box sx={{ mb: 3 }}>
                <Button
                    variant="contained"
                    onClick={handleExecute}
                    disabled={isProcessing}
                    size="large"
                    sx={{ mr: 2 }}
                >
                    {isProcessing ? <CircularProgress size={20} sx={{ mr: 1 }} /> : null}
                    {hasExecuted ? 'Re-run Recalculation' : 'Execute Recalculation'}
                </Button>
                <Typography variant="body2" color="text.secondary" component="span">
                    {data.length.toLocaleString()} samples will be processed
                </Typography>
            </Box>

            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

            {results && (
                <>
                    {results.warnings.map((w, i) => (
                        <Alert key={i} severity="warning" sx={{ mb: 1 }}>{w}</Alert>
                    ))}

                    {summary && (
                        <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
                            <Typography variant="subtitle2" gutterBottom>Summary</Typography>
                            <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                                <Chip label={`${summary.nRows} samples`} />
                                <Chip label={`Method 1: ${summary.method1Count}`} color="primary" variant="outlined" />
                                <Chip label={`Method 2: ${summary.method2Count}`} color="secondary" variant="outlined" />
                                <Chip label={`Mean sulfide mode: ${summary.meanSulfideMode.toFixed(2)}%`} />
                                {summary.meanTenor !== null && (
                                    <Chip label={`Mean Ni tenor: ${summary.meanTenor.toFixed(2)}%`} />
                                )}
                            </Box>
                        </Paper>
                    )}

                    <Typography variant="subtitle2" gutterBottom>Preview (first 15 rows)</Typography>
                    <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 400 }}>
                        <Table size="small" stickyHeader>
                            <TableHead>
                                <TableRow>
                                    <TableCell>#</TableCell>
                                    <TableCell>SiO2</TableCell>
                                    <TableCell>MgO</TableCell>
                                    <TableCell>FeO</TableCell>
                                    <TableCell>Fe2O3</TableCell>
                                    <TableCell>Sulfide Mode</TableCell>
                                    <TableCell>Ni Tenor</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {previewRows.map((row, i) => (
                                    <TableRow key={i}>
                                        <TableCell>{row.index}</TableCell>
                                        <TableCell>{row.SiO2_recalc}</TableCell>
                                        <TableCell>{row.MgO_recalc}</TableCell>
                                        <TableCell>{row.FeO_recalc}</TableCell>
                                        <TableCell>{row.Fe2O3_recalc}</TableCell>
                                        <TableCell>{row.Sulfide_Mode}</TableCell>
                                        <TableCell>{row.Ni_Tenor}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </>
            )}
        </Box>
    );
};

// ============================================================================
// STEP 5: Output & Data Views
// ============================================================================

const StepOutput: React.FC = () => {
    const { data, addColumn } = useAppStore();
    const { config, results } = useRecalculationStore();
    const [addAnhydrous, setAddAnhydrous] = React.useState(true);
    const [addRecalculated, setAddRecalculated] = React.useState(true);
    const [addDiagnostics, setAddDiagnostics] = React.useState(true);
    const [addCLR, setAddCLR] = React.useState(config.generateCLR);
    const [isAdding, setIsAdding] = React.useState(false);
    const [isAdded, setIsAdded] = React.useState(false);

    if (!results) {
        return (
            <Box>
                <Typography variant="h6" gutterBottom>Output & Data Views</Typography>
                <Alert severity="warning">Run the recalculation first (Step 5) before adding columns.</Alert>
            </Box>
        );
    }

    const handleAddToDataset = () => {
        setIsAdding(true);

        try {
            // Add anhydrous columns
            if (addAnhydrous) {
                for (const [colName, values] of Object.entries(results.anhydrousColumns)) {
                    addColumn(colName, values, 'numeric', 'Anhydrous', 'anhydrous');
                }
            }

            // Add recalculated columns
            if (addRecalculated) {
                for (const [colName, values] of Object.entries(results.recalculatedColumns)) {
                    addColumn(colName, values, 'numeric', 'Recalculated', 'recalculated');
                }
            }

            // Add diagnostic columns
            if (addDiagnostics) {
                for (const [colName, values] of Object.entries(results.diagnosticColumns)) {
                    addColumn(colName, values, 'numeric', 'Recalculated', 'recalculated');
                }
            }

            // Add CLR columns on recalculated data
            if (addCLR) {
                const recalcColNames = Object.keys(results.recalculatedColumns);
                // Build row-based data for CLR transform, tracking which rows have valid data
                const recalcData: Record<string, any>[] = [];
                const nRows = data.length;
                const validRows: boolean[] = [];
                for (let i = 0; i < nRows; i++) {
                    const row: Record<string, any> = {};
                    let hasNonZero = false;
                    for (const col of recalcColNames) {
                        const val = results.recalculatedColumns[col][i];
                        row[col] = val;
                        if (val !== 0) hasNonZero = true;
                    }
                    recalcData.push(row);
                    validRows.push(hasNonZero);
                }

                const clrResult = clrTransform(recalcData, recalcColNames);
                for (let j = 0; j < recalcColNames.length; j++) {
                    const clrValues = clrResult.values.map((row, i) =>
                        validRows[i] ? row[j] : null
                    );
                    addColumn(`${recalcColNames[j]}_CLR`, clrValues, 'numeric', 'CLR', 'clr');
                }
            }

            setIsAdded(true);
        } finally {
            setIsAdding(false);
        }
    };

    const anhydrousCols = Object.keys(results.anhydrousColumns);
    const recalcCols = Object.keys(results.recalculatedColumns);
    const diagCols = Object.keys(results.diagnosticColumns);

    return (
        <Box>
            <Typography variant="h6" gutterBottom>Output & Data Views</Typography>
            <Alert severity="info" sx={{ mb: 2 }}>
                Select which column groups to add to your dataset. Each group will be accessible
                via the column filter dropdown in the toolbar.
            </Alert>

            <Box sx={{ mb: 3 }}>
                <FormControlLabel
                    control={<Checkbox checked={addAnhydrous} onChange={(e) => setAddAnhydrous(e.target.checked)} />}
                    label={`Anhydrous columns (${anhydrousCols.length} columns)`}
                />
                <Box sx={{ ml: 4, mb: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                        {anhydrousCols.join(', ')}
                    </Typography>
                </Box>

                <FormControlLabel
                    control={<Checkbox checked={addRecalculated} onChange={(e) => setAddRecalculated(e.target.checked)} />}
                    label={`Recalculated columns (${recalcCols.length} columns)`}
                />
                <Box sx={{ ml: 4, mb: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                        {recalcCols.join(', ')}
                    </Typography>
                </Box>

                <FormControlLabel
                    control={<Checkbox checked={addDiagnostics} onChange={(e) => setAddDiagnostics(e.target.checked)} />}
                    label={`Diagnostic columns (${diagCols.length} columns)`}
                />
                <Box sx={{ ml: 4, mb: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                        {diagCols.join(', ')}
                    </Typography>
                </Box>

                <FormControlLabel
                    control={<Checkbox checked={addCLR} onChange={(e) => setAddCLR(e.target.checked)} />}
                    label={`CLR transform of recalculated oxides (${recalcCols.length} columns)`}
                />
            </Box>

            <Button
                variant="contained"
                color="success"
                onClick={handleAddToDataset}
                disabled={isAdding || isAdded || (!addAnhydrous && !addRecalculated && !addDiagnostics && !addCLR)}
                size="large"
            >
                {isAdding ? <CircularProgress size={20} sx={{ mr: 1 }} /> : null}
                {isAdded ? 'Added to Dataset' : 'Add to Dataset'}
            </Button>

            {isAdded && (
                <Alert severity="success" sx={{ mt: 2 }}>
                    Columns added successfully. Use the column filter dropdown in the toolbar to view
                    Anhydrous and Recalculated data views.
                </Alert>
            )}
        </Box>
    );
};

// ============================================================================
// MAIN WIZARD COMPONENT
// ============================================================================

export const RecalculationWizard: React.FC = () => {
    const { activeStep, setActiveStep, config, hasExecuted, reset } = useRecalculationStore();

    const handleNext = () => setActiveStep(activeStep + 1);
    const handleBack = () => setActiveStep(activeStep - 1);

    // Validation for Next button
    const canProceed = useMemo(() => {
        switch (activeStep) {
            case 0: {
                const a = config.columnAssignments;
                return !!(
                    a.majorOxides['SiO2'] &&
                    a.majorOxides['MgO'] &&
                    (a.feColumn || (a.feoColumn && a.fe2o3Column)) &&
                    (a.loiColumn || a.h2oColumn)
                );
            }
            case 1: return true; // Fe ramp always valid
            case 2: return true; // Volatile config always valid
            case 3: return true; // Sulfide config always valid
            case 4: return hasExecuted; // Must execute before proceeding
            case 5: return true;
            default: return true;
        }
    }, [activeStep, config, hasExecuted]);

    const renderStep = () => {
        switch (activeStep) {
            case 0: return <StepColumnAssignment />;
            case 1: return <StepFeRamp />;
            case 2: return <StepVolatile />;
            case 3: return <StepSulfide />;
            case 4: return <StepExecute />;
            case 5: return <StepOutput />;
            default: return null;
        }
    };

    return (
        <Paper sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
                <Typography variant="h5">Barnes Recalculation Wizard</Typography>
                <Button size="small" color="inherit" onClick={reset}>Reset</Button>
            </Box>

            <Stepper activeStep={activeStep} sx={{ mb: 4 }}>
                {STEPS.map((label, index) => (
                    <Step key={label} completed={index < activeStep}>
                        <StepLabel
                            onClick={() => index < activeStep && setActiveStep(index)}
                            sx={{ cursor: index < activeStep ? 'pointer' : 'default' }}
                        >
                            {label}
                        </StepLabel>
                    </Step>
                ))}
            </Stepper>

            <Divider sx={{ mb: 3 }} />

            <Box sx={{ minHeight: 300 }}>
                {renderStep()}
            </Box>

            <Divider sx={{ mt: 3, mb: 2 }} />

            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Button
                    onClick={handleBack}
                    disabled={activeStep === 0}
                >
                    Back
                </Button>
                {activeStep < STEPS.length - 1 && (
                    <Button
                        variant="contained"
                        onClick={handleNext}
                        disabled={!canProceed}
                    >
                        Next
                    </Button>
                )}
            </Box>
        </Paper>
    );
};
