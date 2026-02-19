/**
 * Step 4 — Review & Export
 * Two-column: read-only axis/variable summary (left) + live preview (right).
 * Actions: Save to Library, Export JSON, Import JSON.
 */

import React, { useMemo, useRef, useCallback, useState } from 'react';
import {
    Box, Typography, Paper, Button,
    Divider, Chip, ToggleButtonGroup, ToggleButton,
    Snackbar,
} from '@mui/material';
import {
    Save, FileDownload, FileUpload,
} from '@mui/icons-material';
import Plot from 'react-plotly.js';
import { useDiagramEditorStore } from '../../../store/diagramEditorStore';
import { useCustomDiagramStore } from '../../../store/customDiagramStore';
import { useClassificationStore } from '../../../store/classificationStore';
import { rgbToCss } from '../utils/colorGenerator';
import { exportDiagramJson, importDiagramJson } from '../utils/diagramSerializer';

export const StepReviewExport: React.FC = () => {
    const {
        diagramName, diagramType,
        axes,
        variables,
        polygons, labels, lines,
        buildDiagram,
    } = useDiagramEditorStore();

    const { addDiagram: addCustomDiagram } = useCustomDiagramStore();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [snackbar, setSnackbar] = useState<string | null>(null);
    const [previewStyle, setPreviewStyle] = useState<'color' | 'bw'>('color');

    // Build diagram for preview
    const diagram = useMemo(() => {
        try {
            return buildDiagram();
        } catch {
            return null;
        }
    }, [buildDiagram, diagramName, diagramType, axes, variables, polygons, labels, lines]);

    // Build Plotly traces for preview
    const plotData = useMemo(() => {
        if (!diagram) return [];
        const traces: any[] = [];

        if (diagram.type === 'xy') {
            // XY polygon traces
            for (const poly of diagram.polygons) {
                const lineShape = poly.smooth ? 'spline' : 'linear';
                if (poly.closed === false && poly.points.length >= 2) {
                    // Open polyline
                    traces.push({
                        type: 'scatter',
                        x: poly.points.map(p => p.x),
                        y: poly.points.map(p => p.y),
                        mode: 'lines',
                        line: {
                            color: previewStyle === 'color'
                                ? rgbToCss(poly.color)
                                : 'rgba(0,0,0,0.6)',
                            width: 1.5,
                            shape: lineShape,
                        },
                        name: poly.name,
                        showlegend: false,
                        hoverinfo: 'name',
                    });
                } else if (poly.points.length >= 3) {
                    const pts = [...poly.points, poly.points[0]];
                    traces.push({
                        type: 'scatter',
                        x: pts.map(p => p.x),
                        y: pts.map(p => p.y),
                        mode: 'lines',
                        fill: 'toself',
                        fillcolor: previewStyle === 'color'
                            ? rgbToCss(poly.color, 0.25)
                            : 'rgba(200,200,200,0.15)',
                        line: {
                            color: previewStyle === 'color'
                                ? rgbToCss(poly.color)
                                : 'rgba(0,0,0,0.6)',
                            width: 1.5,
                            shape: lineShape,
                        },
                        name: poly.name,
                        showlegend: false,
                        hoverinfo: 'name',
                    });
                }
            }

            // Lines
            if (diagram.lines) {
                for (const line of diagram.lines) {
                    if (diagram.bounds) {
                        const xMin = diagram.bounds.x;
                        const xMax = diagram.bounds.x + diagram.bounds.w;
                        const y1 = line.slope * xMin + line.intercept;
                        const y2 = line.slope * xMax + line.intercept;
                        traces.push({
                            type: 'scatter',
                            x: [xMin, xMax],
                            y: [y1, y2],
                            mode: 'lines',
                            line: { color: 'rgba(0,0,0,0.4)', width: 1, dash: 'dash' },
                            showlegend: false,
                            hoverinfo: 'name',
                            name: line.name,
                        });
                    }
                }
            }

            // Labels as annotations
            if (diagram.labels) {
                for (const label of diagram.labels) {
                    traces.push({
                        type: 'scatter',
                        x: [label.x],
                        y: [label.y],
                        mode: 'text',
                        text: [label.name],
                        textfont: { size: 10, color: rgbToCss(label.color) },
                        showlegend: false,
                        hoverinfo: 'none',
                    });
                }
            }
        } else {
            // Ternary polygon traces
            for (const poly of diagram.polygons) {
                const { xmlCartesianToTernary } = require('../../../types/classificationDiagram');
                const ternaryPoints = poly.points.map((p: { x: number; y: number }) => xmlCartesianToTernary(p.x, p.y));
                const lineShape = poly.smooth ? 'spline' : 'linear';

                if (poly.closed !== false && ternaryPoints.length >= 3) {
                    const pts = [...ternaryPoints, ternaryPoints[0]];
                    traces.push({
                        type: 'scatterternary',
                        a: pts.map((p: any) => p.a),
                        b: pts.map((p: any) => p.b),
                        c: pts.map((p: any) => p.c),
                        mode: 'lines',
                        fill: 'toself',
                        fillcolor: previewStyle === 'color'
                            ? rgbToCss(poly.color, 0.25)
                            : 'rgba(200,200,200,0.15)',
                        line: {
                            color: previewStyle === 'color'
                                ? rgbToCss(poly.color)
                                : 'rgba(0,0,0,0.6)',
                            width: 1.5,
                            shape: lineShape,
                        },
                        name: poly.name,
                        showlegend: false,
                        hoverinfo: 'name',
                    });
                }
            }
        }

        return traces;
    }, [diagram, previewStyle]);

    // Build layout for preview
    const plotLayout = useMemo((): any => {
        if (!diagram) return {};

        if (diagram.type === 'xy') {
            const layout: any = {
                width: 500,
                height: 450,
                margin: { l: 60, r: 20, t: 40, b: 50 },
                title: { text: diagram.name, font: { size: 14 } },
                xaxis: {
                    title: diagram.axes.x?.name || 'X',
                    type: diagram.axes.x?.log ? 'log' : 'linear',
                },
                yaxis: {
                    title: diagram.axes.y?.name || 'Y',
                    type: diagram.axes.y?.log ? 'log' : 'linear',
                },
                showlegend: false,
            };

            if (diagram.bounds) {
                const bMinX = diagram.bounds.x;
                const bMaxX = diagram.bounds.x + diagram.bounds.w;
                const bMinY = diagram.bounds.y;
                const bMaxY = diagram.bounds.y + diagram.bounds.h;
                layout.xaxis.range = diagram.axes.x?.log
                    ? [Math.log10(Math.max(bMinX, 0.001)), Math.log10(Math.max(bMaxX, 0.01))]
                    : [bMinX - (bMaxX - bMinX) * 0.02, bMaxX + (bMaxX - bMinX) * 0.02];
                layout.yaxis.range = diagram.axes.y?.log
                    ? [Math.log10(Math.max(bMinY, 0.001)), Math.log10(Math.max(bMaxY, 0.01))]
                    : [bMinY - (bMaxY - bMinY) * 0.02, bMaxY + (bMaxY - bMinY) * 0.02];
            }

            return layout;
        } else {
            return {
                width: 500,
                height: 500,
                margin: { l: 40, r: 40, t: 60, b: 40 },
                title: { text: diagram.name, font: { size: 14 } },
                ternary: {
                    aaxis: { title: diagram.axes.a?.name || 'A', min: 0, },
                    baxis: { title: diagram.axes.b?.name || 'B', min: 0, },
                    caxis: { title: diagram.axes.c?.name || 'C', min: 0, },
                    sum: 100,
                },
                showlegend: false,
            };
        }
    }, [diagram]);

    const handleSaveToLibrary = useCallback(() => {
        if (!diagram) return;
        addCustomDiagram(diagram);

        // Also add to classification store runtime diagrams
        const store = useClassificationStore.getState();
        const allDiagrams = [...store.diagrams, diagram];
        const categories = [...new Set(allDiagrams.map(d => d.category))].sort();
        useClassificationStore.setState({ diagrams: allDiagrams, categories });

        setSnackbar('Diagram saved to library!');
    }, [diagram, addCustomDiagram]);

    const handleExportJson = useCallback(() => {
        if (!diagram) return;
        exportDiagramJson(diagram);
        setSnackbar('Diagram exported as JSON');
    }, [diagram]);

    const handleImportJson = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const json = ev.target?.result as string;
            const imported = importDiagramJson(json);
            if (imported) {
                useDiagramEditorStore.getState().loadDiagramForEditing(imported);
                setSnackbar('Diagram imported for editing');
            } else {
                setSnackbar('Failed to import diagram');
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    }, []);

    const axisKeys = diagramType === 'ternary' ? ['a', 'b', 'c'] as const : ['x', 'y'] as const;

    return (
        <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>Review & Export</Typography>

            <Box sx={{ display: 'flex', gap: 3 }}>
                {/* Left: Read-only summary */}
                <Box sx={{ flex: 1 }}>
                    <Typography variant="subtitle2" gutterBottom>Axis Configuration</Typography>

                    {axisKeys.map((key) => {
                        const axisConfig = axes[key] || { name: '', formula: '', log: false };
                        return (
                            <Box key={key} sx={{ mb: 1.5 }}>
                                <Typography variant="body2" fontWeight="bold" gutterBottom>
                                    {diagramType === 'ternary'
                                        ? `${key.toUpperCase()} Axis (${key === 'a' ? 'Top' : key === 'b' ? 'Bottom-Left' : 'Bottom-Right'})`
                                        : `${key.toUpperCase()} Axis`}
                                </Typography>
                                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                                    {axisConfig.name && (
                                        <Chip label={axisConfig.name} size="small" variant="outlined" />
                                    )}
                                    {axisConfig.formula && (
                                        <Chip
                                            label={axisConfig.formula}
                                            size="small"
                                            variant="outlined"
                                            sx={{ fontFamily: 'monospace' }}
                                        />
                                    )}
                                    {axisConfig.log && (
                                        <Chip label="Log" size="small" color="info" />
                                    )}
                                    {diagramType === 'xy' && axisConfig.min != null && axisConfig.max != null && (
                                        <Chip
                                            label={`${axisConfig.min} \u2013 ${axisConfig.max}`}
                                            size="small"
                                            variant="outlined"
                                            color="default"
                                        />
                                    )}
                                </Box>
                            </Box>
                        );
                    })}

                    <Divider sx={{ my: 2 }} />

                    {/* Variables - read-only chips */}
                    <Typography variant="subtitle2" gutterBottom>Variables</Typography>
                    {variables.length > 0 ? (
                        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 2 }}>
                            {variables.map((v) => (
                                <Chip
                                    key={v.letter}
                                    label={`${v.letter} = ${v.element || '?'}${v.unit ? ` (${v.unit})` : ''}`}
                                    size="small"
                                    variant="outlined"
                                    sx={{ fontFamily: 'monospace' }}
                                />
                            ))}
                        </Box>
                    ) : (
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                            No variables defined
                        </Typography>
                    )}

                    <Divider sx={{ my: 2 }} />

                    {/* Summary */}
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
                        <Chip label={`${polygons.length} polygons`} size="small" />
                        <Chip label={`${labels.length} labels`} size="small" />
                        {diagramType === 'xy' && <Chip label={`${lines.length} lines`} size="small" />}
                        <Chip label={diagramType.toUpperCase()} size="small" variant="outlined" />
                    </Box>

                    {/* Action buttons */}
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                        <Button
                            variant="contained"
                            startIcon={<Save />}
                            onClick={handleSaveToLibrary}
                            disabled={!diagram || polygons.length === 0}
                        >
                            Save to Library
                        </Button>
                        <Button
                            variant="outlined"
                            startIcon={<FileDownload />}
                            onClick={handleExportJson}
                            disabled={!diagram}
                        >
                            Export JSON
                        </Button>
                        <Button
                            variant="outlined"
                            startIcon={<FileUpload />}
                            onClick={() => fileInputRef.current?.click()}
                        >
                            Import JSON
                        </Button>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".json"
                            hidden
                            onChange={handleImportJson}
                        />
                    </Box>
                </Box>

                {/* Right: Live preview */}
                <Box sx={{ flex: 1, minWidth: 400 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                        <Typography variant="subtitle2">Preview</Typography>
                        <ToggleButtonGroup
                            value={previewStyle}
                            exclusive
                            onChange={(_, val) => { if (val) setPreviewStyle(val); }}
                            size="small"
                        >
                            <ToggleButton value="color">Color</ToggleButton>
                            <ToggleButton value="bw">B/W</ToggleButton>
                        </ToggleButtonGroup>
                    </Box>

                    {diagram && plotData.length > 0 ? (
                        <Plot
                            data={plotData}
                            layout={plotLayout}
                            config={{ displayModeBar: false, staticPlot: true }}
                            style={{ width: '100%' }}
                        />
                    ) : (
                        <Box sx={{ p: 4, textAlign: 'center', border: '1px dashed', borderColor: 'divider', borderRadius: 1 }}>
                            <Typography color="text.secondary">
                                {polygons.length === 0 ? 'No polygons to preview' : 'Preview will appear here'}
                            </Typography>
                        </Box>
                    )}
                </Box>
            </Box>

            <Snackbar
                open={!!snackbar}
                autoHideDuration={3000}
                onClose={() => setSnackbar(null)}
                message={snackbar}
            />
        </Paper>
    );
};
