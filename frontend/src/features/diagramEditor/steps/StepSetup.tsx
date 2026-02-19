/**
 * Step 0 — Setup: Diagram name, type, category, image upload, axis config with ranges, variables table
 */

import React, { useCallback, useRef, useMemo, useState } from 'react';
import {
    Box, TextField, Typography, Paper, ToggleButtonGroup, ToggleButton,
    Autocomplete, Alert, Checkbox, FormControlLabel, Divider,
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    IconButton, Button, InputAdornment,
} from '@mui/material';
import { ScatterPlot, ChangeHistory, CloudUpload, Calculate, Delete, Add } from '@mui/icons-material';
import { useDiagramEditorStore } from '../../../store/diagramEditorStore';
import { useClassificationStore } from '../../../store/classificationStore';
import { useAppStore } from '../../../store/appStore';
import { DiagramType } from '../../../types/classificationDiagram';
import { FormulaCalculatorDialog } from '../FormulaCalculatorDialog';
import { buildElementOptions, ElementOption } from '../diagramElementOptions';

const MAX_IMAGE_SIZE = 2000;

function resizeImage(dataUrl: string): Promise<{ dataUrl: string; width: number; height: number }> {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            let { width, height } = img;

            if (width > MAX_IMAGE_SIZE || height > MAX_IMAGE_SIZE) {
                const scale = MAX_IMAGE_SIZE / Math.max(width, height);
                width = Math.round(width * scale);
                height = Math.round(height * scale);
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d')!;
            ctx.drawImage(img, 0, 0, width, height);

            resolve({
                dataUrl: canvas.toDataURL('image/png'),
                width,
                height,
            });
        };
        img.src = dataUrl;
    });
}

export const StepSetup: React.FC = () => {
    const {
        diagramName, setDiagramName,
        diagramType, setDiagramType,
        category, setCategory,
        subCategory, setSubCategory,
        references, setReferences,
        comments, setComments,
        referenceImage, setReferenceImage,
        imageWidth, imageHeight,
        axes, setAxis, setLogScale,
        variables, addVariable, removeVariable, updateVariable,
    } = useDiagramEditorStore();

    const { categories } = useClassificationStore();
    const { geochemMappings } = useAppStore();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [formulaDialogAxis, setFormulaDialogAxis] = useState<'x' | 'y' | null>(null);

    const elementOptions = useMemo(() => buildElementOptions(geochemMappings), [geochemMappings]);

    const unitOptions = ['pct', 'ppm', 'ppb', 'wt%', 'mol/kg'];

    const handleImageFile = useCallback(async (file: File) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            const dataUrl = e.target?.result as string;
            const resized = await resizeImage(dataUrl);
            setReferenceImage(resized.dataUrl, resized.width, resized.height);
        };
        reader.readAsDataURL(file);
    }, [setReferenceImage]);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) {
            handleImageFile(file);
        }
    }, [handleImageFile]);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
    }, []);

    return (
        <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>Diagram Setup</Typography>

            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mb: 3 }}>
                <TextField
                    label="Diagram Name"
                    value={diagramName}
                    onChange={(e) => setDiagramName(e.target.value)}
                    required
                    fullWidth
                    error={diagramName.trim().length === 0}
                    helperText={diagramName.trim().length === 0 ? 'Required' : ''}
                />

                <Box>
                    <Typography variant="body2" color="text.secondary" gutterBottom>
                        Diagram Type
                    </Typography>
                    <ToggleButtonGroup
                        value={diagramType}
                        exclusive
                        onChange={(_, val: DiagramType | null) => { if (val) setDiagramType(val); }}
                        size="small"
                    >
                        <ToggleButton value="xy">
                            <ScatterPlot sx={{ mr: 0.5 }} /> XY Plot
                        </ToggleButton>
                        <ToggleButton value="ternary">
                            <ChangeHistory sx={{ mr: 0.5 }} /> Ternary
                        </ToggleButton>
                    </ToggleButtonGroup>
                </Box>

                <Autocomplete
                    freeSolo
                    options={[...categories, 'Custom Diagrams']}
                    value={category}
                    onInputChange={(_, val) => setCategory(val)}
                    renderInput={(params) => (
                        <TextField {...params} label="Category" fullWidth />
                    )}
                />

                <TextField
                    label="Sub-category"
                    value={subCategory}
                    onChange={(e) => setSubCategory(e.target.value)}
                    fullWidth
                />

                <TextField
                    label="References"
                    value={references}
                    onChange={(e) => setReferences(e.target.value)}
                    fullWidth
                    multiline
                    rows={2}
                    placeholder="e.g., Peccerillo & Taylor (1976)"
                />

                <TextField
                    label="Comments"
                    value={comments}
                    onChange={(e) => setComments(e.target.value)}
                    fullWidth
                    multiline
                    rows={2}
                />
            </Box>

            {/* Axis Configuration */}
            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle1" gutterBottom>Axis Configuration</Typography>

            {diagramType === 'xy' ? (
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mb: 3 }}>
                    {(['x', 'y'] as const).map((key) => {
                        const axisConfig = axes[key] || { name: '', formula: '', log: false };
                        return (
                            <Box key={key} sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                                <Typography variant="body2" fontWeight="bold" gutterBottom>
                                    {key.toUpperCase()} Axis
                                </Typography>
                                <TextField
                                    label="Name"
                                    value={axisConfig.name}
                                    onChange={(e) => setAxis(key, { ...axisConfig, name: e.target.value })}
                                    size="small"
                                    fullWidth
                                    sx={{ mb: 1 }}
                                />
                                <TextField
                                    label="Formula"
                                    value={axisConfig.formula}
                                    onChange={(e) => setAxis(key, { ...axisConfig, formula: e.target.value })}
                                    size="small"
                                    fullWidth
                                    placeholder="e.g., A / (A + B)"
                                    helperText="Use variable letters (A, B, ...) defined below"
                                    sx={{ mb: 1 }}
                                    InputProps={{
                                        sx: { fontFamily: 'monospace' },
                                        endAdornment: (
                                            <InputAdornment position="end">
                                                <IconButton
                                                    size="small"
                                                    onClick={() => setFormulaDialogAxis(key)}
                                                    title="Open formula calculator"
                                                >
                                                    <Calculate fontSize="small" />
                                                </IconButton>
                                            </InputAdornment>
                                        ),
                                    }}
                                />
                                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                                    <TextField
                                        label="Min"
                                        type="number"
                                        value={axisConfig.min ?? ''}
                                        onChange={(e) => {
                                            const val = e.target.value === '' ? undefined : parseFloat(e.target.value);
                                            setAxis(key, { ...axisConfig, min: val });
                                        }}
                                        size="small"
                                        sx={{ flex: 1 }}
                                        required
                                        error={axisConfig.min == null}
                                    />
                                    <TextField
                                        label="Max"
                                        type="number"
                                        value={axisConfig.max ?? ''}
                                        onChange={(e) => {
                                            const val = e.target.value === '' ? undefined : parseFloat(e.target.value);
                                            setAxis(key, { ...axisConfig, max: val });
                                        }}
                                        size="small"
                                        sx={{ flex: 1 }}
                                        required
                                        error={axisConfig.max == null}
                                    />
                                    <FormControlLabel
                                        control={
                                            <Checkbox
                                                checked={axisConfig.log}
                                                onChange={(e) => setLogScale(key, e.target.checked)}
                                                size="small"
                                            />
                                        }
                                        label="Log"
                                        sx={{ ml: 0 }}
                                    />
                                </Box>
                            </Box>
                        );
                    })}
                </Box>
            ) : (
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 2, mb: 3 }}>
                    {(['a', 'b', 'c'] as const).map((key) => {
                        const axisConfig = axes[key] || { name: '', formula: '', log: false };
                        const label = key === 'a' ? 'Top' : key === 'b' ? 'Bottom-Left' : 'Bottom-Right';
                        return (
                            <Box key={key} sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                                <Typography variant="body2" fontWeight="bold" gutterBottom>
                                    {key.toUpperCase()} ({label})
                                </Typography>
                                <TextField
                                    label="Name"
                                    value={axisConfig.name}
                                    onChange={(e) => setAxis(key, { ...axisConfig, name: e.target.value })}
                                    size="small"
                                    fullWidth
                                />
                            </Box>
                        );
                    })}
                </Box>
            )}

            {/* Variables Table */}
            <Divider sx={{ my: 2 }} />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <Typography variant="subtitle1">Variables</Typography>
                <Button
                    size="small"
                    startIcon={<Add />}
                    onClick={addVariable}
                >
                    Add Variable
                </Button>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                Define variable letters used in axis formulas
            </Typography>

            {variables.length > 0 && (
                <TableContainer sx={{ mb: 3 }}>
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell width={60}>Letter</TableCell>
                                <TableCell>Element/Oxide</TableCell>
                                <TableCell width={120}>Unit</TableCell>
                                <TableCell width={40} />
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {variables.map((v, i) => (
                                <TableRow key={i}>
                                    <TableCell>
                                        <Typography sx={{ fontFamily: 'monospace', fontWeight: 'bold' }}>
                                            {v.letter}
                                        </Typography>
                                    </TableCell>
                                    <TableCell>
                                        <Autocomplete<ElementOption, false, false, true>
                                            freeSolo
                                            options={elementOptions}
                                            getOptionLabel={(option) => typeof option === 'string' ? option : option.label}
                                            renderOption={(props, option) => (
                                                <li {...props} key={typeof option === 'string' ? option : option.label}>
                                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                                                        <span>{typeof option === 'string' ? option : option.label}</span>
                                                        {typeof option !== 'string' && (
                                                            <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                                                                {option.defaultUnit}
                                                            </Typography>
                                                        )}
                                                    </Box>
                                                </li>
                                            )}
                                            filterOptions={(options, state) => {
                                                const input = state.inputValue.toLowerCase();
                                                if (!input) return options;
                                                return options.filter(o =>
                                                    (typeof o === 'string' ? o : o.label).toLowerCase().includes(input)
                                                );
                                            }}
                                            value={v.element ? elementOptions.find(o => o.label === v.element) ?? v.element : ''}
                                            onChange={(_, val) => {
                                                if (val && typeof val !== 'string') {
                                                    updateVariable(i, { element: val.label, unit: val.defaultUnit });
                                                } else if (typeof val === 'string') {
                                                    updateVariable(i, { element: val });
                                                }
                                            }}
                                            onInputChange={(_, val, reason) => {
                                                if (reason === 'input') updateVariable(i, { element: val });
                                            }}
                                            size="small"
                                            renderInput={(params) => (
                                                <TextField
                                                    {...params}
                                                    variant="standard"
                                                    placeholder="SiO2"
                                                />
                                            )}
                                            sx={{ minWidth: 120 }}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <Autocomplete
                                            freeSolo
                                            options={unitOptions}
                                            value={v.unit}
                                            onInputChange={(_, val) => updateVariable(i, { unit: val })}
                                            size="small"
                                            renderInput={(params) => (
                                                <TextField
                                                    {...params}
                                                    variant="standard"
                                                    placeholder="pct"
                                                />
                                            )}
                                            sx={{ width: 100 }}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <IconButton size="small" onClick={() => removeVariable(i)}>
                                            <Delete fontSize="small" />
                                        </IconButton>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            )}

            {/* Image Upload */}
            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle1" gutterBottom>Reference Image</Typography>

            {!referenceImage ? (
                <Box
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onClick={() => fileInputRef.current?.click()}
                    sx={{
                        border: '2px dashed',
                        borderColor: 'divider',
                        borderRadius: 2,
                        p: 4,
                        textAlign: 'center',
                        cursor: 'pointer',
                        transition: 'border-color 0.2s',
                        '&:hover': { borderColor: 'primary.main' },
                    }}
                >
                    <CloudUpload sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
                    <Typography color="text.secondary">
                        Drop a reference image here, or click to browse
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                        PNG, JPG, or SVG. Max {MAX_IMAGE_SIZE}px (auto-resized).
                    </Typography>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        hidden
                        onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleImageFile(file);
                        }}
                    />
                </Box>
            ) : (
                <Box>
                    <Box sx={{ position: 'relative', mb: 1, maxHeight: 300, overflow: 'hidden', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
                        <img
                            src={referenceImage}
                            alt="Reference"
                            style={{ width: '100%', maxHeight: 300, objectFit: 'contain' }}
                        />
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Typography variant="caption" color="text.secondary">
                            {imageWidth} x {imageHeight} px
                        </Typography>
                        <Typography
                            variant="caption"
                            color="primary"
                            sx={{ cursor: 'pointer', textDecoration: 'underline' }}
                            onClick={() => fileInputRef.current?.click()}
                        >
                            Replace image
                        </Typography>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            hidden
                            onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleImageFile(file);
                            }}
                        />
                    </Box>
                </Box>
            )}

            {/* Validation summary */}
            {diagramType === 'xy' && (axes.x?.min == null || axes.x?.max == null || axes.y?.min == null || axes.y?.max == null) && (
                <Alert severity="info" sx={{ mt: 2 }}>
                    Enter axis ranges (Min/Max) for both X and Y axes to proceed.
                </Alert>
            )}
            {diagramName.trim().length === 0 && (
                <Alert severity="info" sx={{ mt: 2 }}>
                    Enter a diagram name and upload a reference image to proceed.
                </Alert>
            )}

            {/* Formula Calculator Dialog */}
            {formulaDialogAxis && (
                <FormulaCalculatorDialog
                    open={!!formulaDialogAxis}
                    onClose={() => setFormulaDialogAxis(null)}
                    axisKey={formulaDialogAxis}
                    initialFormula={axes[formulaDialogAxis]?.formula || ''}
                    onConfirm={(formula) => {
                        const axisConfig = axes[formulaDialogAxis] || { name: '', formula: '', log: false };
                        setAxis(formulaDialogAxis, { ...axisConfig, formula });
                    }}
                />
            )}
        </Paper>
    );
};
