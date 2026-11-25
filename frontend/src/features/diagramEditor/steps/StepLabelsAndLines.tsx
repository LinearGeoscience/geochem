/**
 * Step 3 — Labels & Lines
 * Optional step: place text labels and line features on the diagram.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
    Box, Typography, Paper, List, ListItem, ListItemText,
    IconButton, TextField, Slider, ToggleButtonGroup, ToggleButton,
    Tooltip, Divider, Popover, Button, Alert,
} from '@mui/material';
import {
    PanTool, Delete, NearMe, TextFields, Timeline, Add,
} from '@mui/icons-material';
import { useDiagramEditorStore } from '../../../store/diagramEditorStore';
import { DiagramCanvas } from '../canvas/DiagramCanvas';
import { ImagePoint, DrawingMode } from '../../../types/diagramEditor';
// colorGenerator import not needed here

export const StepLabelsAndLines: React.FC = () => {
    const {
        drawingMode, setDrawingMode,
        diagramType,
        labels, addLabel, updateLabel, removeLabel,
        lines, addLineFromParams, updateLine, removeLine,
    } = useDiagramEditorStore();

    const [labelPopover, setLabelPopover] = useState<{ anchorPos: { x: number; y: number }; imagePoint: ImagePoint } | null>(null);
    const [labelText, setLabelText] = useState('');
    const [lineStartPoint, setLineStartPoint] = useState<ImagePoint | null>(null);

    useEffect(() => {
        setDrawingMode('label');
        return () => setDrawingMode('select');
    }, [setDrawingMode]);

    const handleCanvasClick = useCallback((imagePoint: ImagePoint) => {
        if (drawingMode === 'label') {
            // Place label — show popover to enter text
            setLabelPopover({ anchorPos: { x: imagePoint.x, y: imagePoint.y }, imagePoint });
            setLabelText('');
        } else if (drawingMode === 'line') {
            if (!lineStartPoint) {
                setLineStartPoint(imagePoint);
            } else {
                // Complete line
                const store = useDiagramEditorStore.getState();
                store.addLine(lineStartPoint, imagePoint);
                setLineStartPoint(null);
            }
        }
    }, [drawingMode, lineStartPoint]);

    const handleConfirmLabel = useCallback(() => {
        if (labelPopover && labelText.trim()) {
            addLabel(labelPopover.imagePoint, labelText.trim());
        }
        setLabelPopover(null);
        setLabelText('');
    }, [labelPopover, labelText, addLabel]);

    return (
        <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>Labels & Line Features</Typography>
            <Alert severity="info" sx={{ mb: 2 }}>
                Optional step. Place text labels on the diagram and add line features (XY only).
                Click on the canvas to place items.
            </Alert>

            <Box sx={{ display: 'flex', gap: 2 }}>
                {/* Canvas area */}
                <Box sx={{ flex: 7, minWidth: 0 }}>
                    {/* Toolbar */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                        <ToggleButtonGroup
                            value={drawingMode}
                            exclusive
                            onChange={(_, val: DrawingMode | null) => {
                                if (val) setDrawingMode(val);
                            }}
                            size="small"
                        >
                            <ToggleButton value="select">
                                <Tooltip title="Select"><NearMe /></Tooltip>
                            </ToggleButton>
                            <ToggleButton value="pan">
                                <Tooltip title="Pan"><PanTool /></Tooltip>
                            </ToggleButton>
                            <ToggleButton value="label">
                                <Tooltip title="Place Label"><TextFields /></Tooltip>
                            </ToggleButton>
                            {diagramType === 'xy' && (
                                <ToggleButton value="line">
                                    <Tooltip title="Draw Line"><Timeline /></Tooltip>
                                </ToggleButton>
                            )}
                        </ToggleButtonGroup>

                        {lineStartPoint && (
                            <Typography variant="caption" color="primary">
                                Click second point to complete line...
                            </Typography>
                        )}
                    </Box>

                    <DiagramCanvas
                        onCanvasClick={handleCanvasClick}
                        height={500}
                    />
                </Box>

                {/* Labels & Lines panel */}
                <Box sx={{ flex: 3, minWidth: 200 }}>
                    {/* Labels section */}
                    <Typography variant="subtitle2" gutterBottom>
                        Labels ({labels.length})
                    </Typography>

                    {labels.length === 0 ? (
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                            No labels placed. Use the label tool to place text.
                        </Typography>
                    ) : (
                        <List dense sx={{ mb: 2 }}>
                            {labels.map((label) => (
                                <ListItem
                                    key={label.id}
                                    sx={{ borderRadius: 1, mb: 0.5 }}
                                    secondaryAction={
                                        <IconButton size="small" onClick={() => removeLabel(label.id)} color="error">
                                            <Delete fontSize="small" />
                                        </IconButton>
                                    }
                                >
                                    <ListItemText
                                        primary={
                                            <TextField
                                                value={label.name}
                                                onChange={(e) => updateLabel(label.id, { name: e.target.value })}
                                                size="small"
                                                variant="standard"
                                                sx={{ width: '100%' }}
                                            />
                                        }
                                        secondary={
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                                                <Typography variant="caption">Angle:</Typography>
                                                <Slider
                                                    value={label.angle}
                                                    onChange={(_, val) => updateLabel(label.id, { angle: val as number })}
                                                    min={-90}
                                                    max={90}
                                                    step={1}
                                                    size="small"
                                                    sx={{ width: 80 }}
                                                />
                                                <Typography variant="caption">{label.angle}°</Typography>
                                            </Box>
                                        }
                                    />
                                </ListItem>
                            ))}
                        </List>
                    )}

                    {/* Lines section (XY only) */}
                    {diagramType === 'xy' && (
                        <>
                            <Divider sx={{ my: 1 }} />
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                                <Typography variant="subtitle2">
                                    Lines ({lines.length})
                                </Typography>
                                <Box sx={{ flexGrow: 1 }} />
                                <Tooltip title="Add line from parameters">
                                    <IconButton size="small" onClick={() => addLineFromParams(1, 0)}>
                                        <Add fontSize="small" />
                                    </IconButton>
                                </Tooltip>
                            </Box>

                            {lines.length === 0 ? (
                                <Typography variant="body2" color="text.secondary">
                                    No lines added. Draw on canvas or add from parameters.
                                </Typography>
                            ) : (
                                <List dense>
                                    {lines.map((line) => (
                                        <ListItem
                                            key={line.id}
                                            sx={{ borderRadius: 1, mb: 0.5 }}
                                            secondaryAction={
                                                <IconButton size="small" onClick={() => removeLine(line.id)} color="error">
                                                    <Delete fontSize="small" />
                                                </IconButton>
                                            }
                                        >
                                            <ListItemText
                                                primary={
                                                    <TextField
                                                        value={line.name}
                                                        onChange={(e) => updateLine(line.id, { name: e.target.value })}
                                                        size="small"
                                                        variant="standard"
                                                        sx={{ width: '100%' }}
                                                    />
                                                }
                                                secondary={
                                                    <Box sx={{ display: 'flex', gap: 1, mt: 0.5 }}>
                                                        <TextField
                                                            label="Slope"
                                                            value={line.slope}
                                                            onChange={(e) => {
                                                                const val = parseFloat(e.target.value);
                                                                if (!isNaN(val)) updateLine(line.id, { slope: val });
                                                            }}
                                                            type="number"
                                                            size="small"
                                                            variant="standard"
                                                            sx={{ width: 70 }}
                                                        />
                                                        <TextField
                                                            label="Intercept"
                                                            value={line.intercept}
                                                            onChange={(e) => {
                                                                const val = parseFloat(e.target.value);
                                                                if (!isNaN(val)) updateLine(line.id, { intercept: val });
                                                            }}
                                                            type="number"
                                                            size="small"
                                                            variant="standard"
                                                            sx={{ width: 70 }}
                                                        />
                                                    </Box>
                                                }
                                            />
                                        </ListItem>
                                    ))}
                                </List>
                            )}
                        </>
                    )}
                </Box>
            </Box>

            {/* Label text popover */}
            {labelPopover && (
                <Popover
                    open={true}
                    anchorReference="anchorPosition"
                    anchorPosition={{ top: 300, left: 400 }}
                    onClose={() => setLabelPopover(null)}
                >
                    <Box sx={{ p: 2, display: 'flex', gap: 1, alignItems: 'flex-end' }}>
                        <TextField
                            label="Label text"
                            value={labelText}
                            onChange={(e) => setLabelText(e.target.value)}
                            size="small"
                            autoFocus
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleConfirmLabel();
                                if (e.key === 'Escape') setLabelPopover(null);
                            }}
                        />
                        <Button
                            variant="contained"
                            size="small"
                            onClick={handleConfirmLabel}
                            disabled={!labelText.trim()}
                        >
                            Add
                        </Button>
                    </Box>
                </Popover>
            )}
        </Paper>
    );
};
