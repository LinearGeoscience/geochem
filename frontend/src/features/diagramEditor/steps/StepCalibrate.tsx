/**
 * Step 1 — Calibrate Axes
 * XY mode: 3-point reference calibration (origin, x-end, y-end).
 * Ternary mode: Click 3 triangle vertices.
 */

import React, { useCallback, useEffect, useMemo } from 'react';
import {
    Box, Typography, Paper,
    Alert, ToggleButtonGroup, ToggleButton, Chip, Tooltip,
} from '@mui/material';
import { Delete, CenterFocusStrong, PanTool } from '@mui/icons-material';
import { useDiagramEditorStore } from '../../../store/diagramEditorStore';
import { DiagramCanvas } from '../canvas/DiagramCanvas';
import type { ImagePoint } from '../../../types/diagramEditor';

export const StepCalibrate: React.FC = () => {
    const {
        diagramType,
        calibration,
        axes,
        drawingMode,
        setDrawingMode,
        setReferencePoint,
        clearReferencePoint,
        computeThreePointCalibration,
        computeCalibration,
        setTernaryVertex,
    } = useDiagramEditorStore();

    // Set drawing mode to calibrate on mount
    useEffect(() => {
        setDrawingMode('calibrate');
        return () => setDrawingMode('select');
    }, [setDrawingMode]);

    // Determine which reference point to place next
    const nextReferencePoint = useCallback((): 'origin' | 'xEnd' | 'yEnd' | null => {
        const { origin, xEnd, yEnd } = calibration.referencePoints;
        if (!origin) return 'origin';
        if (!xEnd) return 'xEnd';
        if (!yEnd) return 'yEnd';
        return null;
    }, [calibration.referencePoints]);

    // Auto-compute calibration when all 3 reference points are placed
    useEffect(() => {
        if (diagramType !== 'xy') return;
        const { origin, xEnd, yEnd } = calibration.referencePoints;
        if (origin && xEnd && yEnd) {
            computeThreePointCalibration();
        }
    }, [diagramType, calibration.referencePoints, calibration.logX, calibration.logY, computeThreePointCalibration]);

    // Track which ternary vertex to place next
    const nextTernaryVertex = useCallback((): 'a' | 'b' | 'c' | null => {
        const { a, b, c } = calibration.ternaryVertices;
        if (!a) return 'a';
        if (!b) return 'b';
        if (!c) return 'c';
        return null;
    }, [calibration.ternaryVertices]);

    const handleCanvasClick = useCallback((imagePoint: ImagePoint) => {
        if (drawingMode !== 'calibrate') return;

        if (diagramType === 'xy') {
            const nextRef = nextReferencePoint();
            if (nextRef) {
                setReferencePoint(nextRef, imagePoint);
            }
        } else {
            const vertex = nextTernaryVertex();
            if (vertex) {
                setTernaryVertex(vertex, imagePoint);
                computeCalibration();
            }
        }
    }, [drawingMode, diagramType, nextReferencePoint, setReferencePoint, setTernaryVertex, computeCalibration, nextTernaryVertex]);

    // Axis range info
    const xAxis = axes.x;
    const yAxis = axes.y;
    const hasRanges = xAxis?.min != null && xAxis?.max != null && yAxis?.min != null && yAxis?.max != null;

    // Reference point label for instructions
    const nextRefLabel = useMemo(() => {
        const next = nextReferencePoint();
        if (!next) return null;
        switch (next) {
            case 'origin': return `Origin (${xAxis?.min ?? '?'}, ${yAxis?.min ?? '?'})`;
            case 'xEnd': return `X-End (${xAxis?.max ?? '?'}, ${yAxis?.min ?? '?'})`;
            case 'yEnd': return `Y-End (${xAxis?.min ?? '?'}, ${yAxis?.max ?? '?'})`;
        }
    }, [nextReferencePoint, xAxis, yAxis]);

    return (
        <Paper sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                <Typography variant="h6">
                    {diagramType === 'xy' ? 'XY Axis Calibration' : 'Ternary Vertex Calibration'}
                </Typography>
                <Box sx={{ flexGrow: 1 }} />
                <ToggleButtonGroup
                    value={drawingMode}
                    exclusive
                    onChange={(_, val) => { if (val) setDrawingMode(val); }}
                    size="small"
                >
                    <ToggleButton value="calibrate">
                        <Tooltip title="Place calibration points">
                            <CenterFocusStrong />
                        </Tooltip>
                    </ToggleButton>
                    <ToggleButton value="pan">
                        <Tooltip title="Pan view">
                            <PanTool />
                        </Tooltip>
                    </ToggleButton>
                </ToggleButtonGroup>
            </Box>

            {diagramType === 'xy' && !hasRanges && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                    Axis ranges (Min/Max) are not set. Go back to Setup to define them before calibrating.
                </Alert>
            )}

            {diagramType === 'xy' && hasRanges && (
                <Alert severity="info" sx={{ mb: 2 }}>
                    Click on the image to place 3 reference points.
                    {nextRefLabel && <strong> Next: {nextRefLabel}</strong>}
                </Alert>
            )}

            {diagramType === 'ternary' && (
                <Alert severity="info" sx={{ mb: 2 }}>
                    Click on the image to place the 3 triangle vertices: A (top), B (bottom-left), C (bottom-right).
                    {nextTernaryVertex() && (
                        <strong> Next: Place vertex {nextTernaryVertex()!.toUpperCase()}</strong>
                    )}
                </Alert>
            )}

            <DiagramCanvas
                onCanvasClick={handleCanvasClick}
                height={450}
            />

            {/* XY reference point status */}
            {diagramType === 'xy' && (
                <Box sx={{ mt: 2 }}>
                    {/* Axis range summary */}
                    {hasRanges && (
                        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }}>
                            <Chip
                                label={`X: ${xAxis!.min} to ${xAxis!.max}${xAxis!.log ? ' (log)' : ''}`}
                                size="small"
                                variant="outlined"
                                color="info"
                            />
                            <Chip
                                label={`Y: ${yAxis!.min} to ${yAxis!.max}${yAxis!.log ? ' (log)' : ''}`}
                                size="small"
                                variant="outlined"
                                color="info"
                            />
                        </Box>
                    )}

                    {/* Reference point chips */}
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                        {([
                            { key: 'origin' as const, label: 'Origin', desc: `(${xAxis?.min ?? '?'}, ${yAxis?.min ?? '?'})` },
                            { key: 'xEnd' as const, label: 'X-End', desc: `(${xAxis?.max ?? '?'}, ${yAxis?.min ?? '?'})` },
                            { key: 'yEnd' as const, label: 'Y-End', desc: `(${xAxis?.min ?? '?'}, ${yAxis?.max ?? '?'})` },
                        ]).map(({ key, label, desc }) => {
                            const pt = calibration.referencePoints[key];
                            return (
                                <Chip
                                    key={key}
                                    label={`${label} ${desc}${pt ? ' \u2713' : ''}`}
                                    color={pt ? 'success' : 'default'}
                                    variant={pt ? 'filled' : 'outlined'}
                                    size="small"
                                    onDelete={pt ? () => clearReferencePoint(key) : undefined}
                                    deleteIcon={pt ? <Delete fontSize="small" /> : undefined}
                                />
                            );
                        })}

                        {calibration.isCalibrated && (
                            <Chip label="Calibrated" size="small" color="success" />
                        )}
                        {calibration.isCalibrated && calibration.residualError !== null && (
                            <Chip
                                label={`Residual: ${calibration.residualError.toFixed(4)}`}
                                size="small"
                                color={calibration.residualError < 0.5 ? 'success' : 'warning'}
                            />
                        )}
                    </Box>
                </Box>
            )}

            {/* Ternary vertex status */}
            {diagramType === 'ternary' && (
                <Box sx={{ mt: 2, display: 'flex', gap: 2 }}>
                    {(['a', 'b', 'c'] as const).map((v) => {
                        const vertex = calibration.ternaryVertices[v];
                        return (
                            <Chip
                                key={v}
                                label={`${v.toUpperCase()}: ${vertex ? `(${vertex.x.toFixed(0)}, ${vertex.y.toFixed(0)})` : 'Not set'}`}
                                color={vertex ? 'success' : 'default'}
                                variant={vertex ? 'filled' : 'outlined'}
                            />
                        );
                    })}
                </Box>
            )}
        </Paper>
    );
};
