/**
 * Step 2 — Draw Boundaries
 * Canvas (~70% width) + polygon list panel (~30% width).
 * Drawing tools: Select, Pan, Draw Polygon, Draw Polyline, Snap toggle, Undo/Redo
 */

import React, { useCallback, useEffect } from 'react';
import {
    Box, Typography, Paper, List, ListItem, ListItemText, ListItemIcon,
    IconButton, TextField, ToggleButtonGroup, ToggleButton, Chip,
    Tooltip, Divider,
} from '@mui/material';
import {
    PanTool, Delete, Undo, Redo, NearMe, Polyline, Pentagon,
    Visibility, VisibilityOff, ArrowUpward, ArrowDownward,
    AutoFixHigh,
} from '@mui/icons-material';
import { useDiagramEditorStore } from '../../../store/diagramEditorStore';
import { DiagramCanvas } from '../canvas/DiagramCanvas';
import { ImagePoint, DrawingMode } from '../../../types/diagramEditor';
import { generateDistinctColors, rgbToCss } from '../utils/colorGenerator';

export const StepDrawBoundaries: React.FC = () => {
    const {
        drawingMode, setDrawingMode,
        polygons, activePolygon,
        selectedPolygonId, setSelectedPolygonId,
        startPolygon, addVertexToActive, closeActivePolygon, cancelActivePolygon,
        removePolygon, updatePolygon, reorderPolygon,
        snapEnabled, setSnapEnabled,
        undo, redo,
        undoStack, redoStack,
    } = useDiagramEditorStore();

    // Set drawing mode on mount
    useEffect(() => {
        setDrawingMode('polygon');
        return () => setDrawingMode('select');
    }, [setDrawingMode]);

    const handleCanvasClick = useCallback((imagePoint: ImagePoint, snapped: boolean) => {
        if (drawingMode === 'polygon' || drawingMode === 'polyline') {
            if (!activePolygon) {
                startPolygon(imagePoint);
            } else {
                // Check if snapping to first vertex (close polygon)
                if (snapped && activePolygon.points.length >= 3 && drawingMode === 'polygon') {
                    const first = activePolygon.points[0];
                    const dist = Math.hypot(imagePoint.x - first.x, imagePoint.y - first.y);
                    if (dist < 1) {
                        closeActivePolygon();
                        return;
                    }
                }
                addVertexToActive(imagePoint);
            }
        } else if (drawingMode === 'select') {
            // Try to select a polygon by clicking near its edge or inside
            // Simple: select the first polygon whose centroid is close enough
            let found = false;
            for (const poly of polygons) {
                if (poly.imagePoints.length === 0) continue;
                // Check if click is inside polygon bounding box + some margin
                const xs = poly.imagePoints.map(p => p.x);
                const ys = poly.imagePoints.map(p => p.y);
                const margin = 20;
                if (imagePoint.x >= Math.min(...xs) - margin && imagePoint.x <= Math.max(...xs) + margin &&
                    imagePoint.y >= Math.min(...ys) - margin && imagePoint.y <= Math.max(...ys) + margin) {
                    setSelectedPolygonId(poly.id);
                    found = true;
                    break;
                }
            }
            if (!found) {
                setSelectedPolygonId(null);
            }
        }
    }, [drawingMode, activePolygon, startPolygon, addVertexToActive, closeActivePolygon, polygons, setSelectedPolygonId]);

    const handleDoubleClick = useCallback((_imagePoint: ImagePoint) => {
        if ((drawingMode === 'polygon' || drawingMode === 'polyline') && activePolygon) {
            closeActivePolygon();
        }
    }, [drawingMode, activePolygon, closeActivePolygon]);

    // Keyboard handlers for Enter (close polygon) and Delete
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Enter' && activePolygon && activePolygon.points.length >= 2) {
                closeActivePolygon();
            } else if (e.key === 'Delete' && selectedPolygonId) {
                removePolygon(selectedPolygonId);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [activePolygon, closeActivePolygon, selectedPolygonId, removePolygon]);

    const handleAutoColor = useCallback(() => {
        const colors = generateDistinctColors(polygons.length);
        polygons.forEach((poly, i) => {
            updatePolygon(poly.id, { color: colors[i] });
        });
    }, [polygons, updatePolygon]);

    return (
        <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>Draw Classification Boundaries</Typography>

            <Box sx={{ display: 'flex', gap: 2 }}>
                {/* Canvas area (~70%) */}
                <Box sx={{ flex: 7, minWidth: 0 }}>
                    {/* Toolbar */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
                        <ToggleButtonGroup
                            value={drawingMode}
                            exclusive
                            onChange={(_, val: DrawingMode | null) => {
                                if (val) {
                                    if (activePolygon) cancelActivePolygon();
                                    setDrawingMode(val);
                                }
                            }}
                            size="small"
                        >
                            <ToggleButton value="select">
                                <Tooltip title="Select"><NearMe /></Tooltip>
                            </ToggleButton>
                            <ToggleButton value="pan">
                                <Tooltip title="Pan"><PanTool /></Tooltip>
                            </ToggleButton>
                            <ToggleButton value="polygon">
                                <Tooltip title="Draw Polygon"><Pentagon /></Tooltip>
                            </ToggleButton>
                            <ToggleButton value="polyline">
                                <Tooltip title="Draw Polyline (open boundary)"><Polyline /></Tooltip>
                            </ToggleButton>
                        </ToggleButtonGroup>

                        <Divider orientation="vertical" flexItem />

                        <Tooltip title="Snap to vertices">
                            <ToggleButton
                                value="snap"
                                selected={snapEnabled}
                                onChange={() => setSnapEnabled(!snapEnabled)}
                                size="small"
                            >
                                <AutoFixHigh />
                            </ToggleButton>
                        </Tooltip>

                        <Divider orientation="vertical" flexItem />

                        <Tooltip title="Undo (Ctrl+Z)">
                            <span>
                                <IconButton size="small" onClick={undo} disabled={undoStack.length === 0}>
                                    <Undo />
                                </IconButton>
                            </span>
                        </Tooltip>
                        <Tooltip title="Redo (Ctrl+Shift+Z)">
                            <span>
                                <IconButton size="small" onClick={redo} disabled={redoStack.length === 0}>
                                    <Redo />
                                </IconButton>
                            </span>
                        </Tooltip>

                        {activePolygon && (
                            <>
                                <Divider orientation="vertical" flexItem />
                                <Chip
                                    label={`Drawing: ${activePolygon.points.length} vertices`}
                                    size="small"
                                    color="primary"
                                    onDelete={cancelActivePolygon}
                                />
                            </>
                        )}
                    </Box>

                    <DiagramCanvas
                        onCanvasClick={handleCanvasClick}
                        onCanvasDoubleClick={handleDoubleClick}
                        height={500}
                    />
                </Box>

                {/* Polygon list panel (~30%) */}
                <Box sx={{ flex: 3, minWidth: 200 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 1, gap: 1 }}>
                        <Typography variant="subtitle2">
                            Polygons ({polygons.length})
                        </Typography>
                        <Box sx={{ flexGrow: 1 }} />
                        <Tooltip title="Auto-generate distinct colors">
                            <span>
                                <IconButton size="small" onClick={handleAutoColor} disabled={polygons.length === 0}>
                                    <AutoFixHigh fontSize="small" />
                                </IconButton>
                            </span>
                        </Tooltip>
                    </Box>

                    {polygons.length === 0 ? (
                        <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
                            No polygons drawn yet. Use the polygon tool to start drawing.
                        </Typography>
                    ) : (
                        <List dense sx={{ maxHeight: 460, overflow: 'auto' }}>
                            {polygons.map((poly, idx) => (
                                <ListItem
                                    key={poly.id}
                                    sx={{
                                        bgcolor: selectedPolygonId === poly.id ? 'action.selected' : 'transparent',
                                        borderRadius: 1,
                                        mb: 0.5,
                                        cursor: 'pointer',
                                    }}
                                    onClick={() => setSelectedPolygonId(poly.id)}
                                    secondaryAction={
                                        <Box sx={{ display: 'flex', gap: 0.5 }}>
                                            <IconButton size="small" onClick={(e) => { e.stopPropagation(); updatePolygon(poly.id, { visible: !poly.visible }); }}>
                                                {poly.visible ? <Visibility fontSize="small" /> : <VisibilityOff fontSize="small" />}
                                            </IconButton>
                                            <IconButton size="small" onClick={(e) => { e.stopPropagation(); reorderPolygon(poly.id, 'up'); }} disabled={idx === 0}>
                                                <ArrowUpward fontSize="small" />
                                            </IconButton>
                                            <IconButton size="small" onClick={(e) => { e.stopPropagation(); reorderPolygon(poly.id, 'down'); }} disabled={idx === polygons.length - 1}>
                                                <ArrowDownward fontSize="small" />
                                            </IconButton>
                                            <IconButton size="small" onClick={(e) => { e.stopPropagation(); removePolygon(poly.id); }} color="error">
                                                <Delete fontSize="small" />
                                            </IconButton>
                                        </Box>
                                    }
                                >
                                    <ListItemIcon sx={{ minWidth: 32 }}>
                                        <Box
                                            sx={{
                                                width: 20,
                                                height: 20,
                                                borderRadius: '4px',
                                                bgcolor: rgbToCss(poly.color),
                                                border: '1px solid rgba(0,0,0,0.2)',
                                            }}
                                        />
                                    </ListItemIcon>
                                    <ListItemText
                                        primary={
                                            <TextField
                                                value={poly.name}
                                                onChange={(e) => updatePolygon(poly.id, { name: e.target.value })}
                                                size="small"
                                                variant="standard"
                                                sx={{ width: '100%' }}
                                                onClick={(e) => e.stopPropagation()}
                                            />
                                        }
                                        secondary={
                                            <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5 }}>
                                                <Chip
                                                    label={poly.closed ? 'Closed' : 'Open'}
                                                    size="small"
                                                    variant="outlined"
                                                    sx={{ height: 18, fontSize: '0.65rem' }}
                                                />
                                                <Chip
                                                    label={`${poly.imagePoints.length || poly.dataPoints.length} pts`}
                                                    size="small"
                                                    variant="outlined"
                                                    sx={{ height: 18, fontSize: '0.65rem' }}
                                                />
                                                <Chip
                                                    label={poly.smooth ? 'Smooth' : 'Linear'}
                                                    size="small"
                                                    variant={poly.smooth ? 'filled' : 'outlined'}
                                                    color={poly.smooth ? 'primary' : 'default'}
                                                    sx={{ height: 18, fontSize: '0.65rem', cursor: 'pointer' }}
                                                    onClick={(e) => { e.stopPropagation(); updatePolygon(poly.id, { smooth: !poly.smooth }); }}
                                                />
                                            </Box>
                                        }
                                    />
                                </ListItem>
                            ))}
                        </List>
                    )}
                </Box>
            </Box>
        </Paper>
    );
};
