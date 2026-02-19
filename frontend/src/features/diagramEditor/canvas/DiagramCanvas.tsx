/**
 * React wrapper for the HTML5 Canvas used in the diagram editor.
 * Handles: image loading, resize observer, render loop, and interaction hookup.
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Box } from '@mui/material';
import { useDiagramEditorStore } from '../../../store/diagramEditorStore';
import { renderCanvas } from './canvasRenderer';
import { useCanvasInteraction } from './canvasInteraction';
import {
    imageToDataUnified,
    imageToTernary,
} from './coordinateTransform';
import { ImagePoint } from '../../../types/diagramEditor';

interface DiagramCanvasProps {
    onCanvasClick?: (imagePoint: ImagePoint, snapped: boolean) => void;
    onCanvasDoubleClick?: (imagePoint: ImagePoint) => void;
    height?: number | string;
}

export const DiagramCanvas: React.FC<DiagramCanvasProps> = ({
    onCanvasClick,
    onCanvasDoubleClick,
    height = 500,
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const imageRef = useRef<HTMLImageElement | null>(null);
    const animFrameRef = useRef<number>(0);

    const [cursorImagePos, setCursorImagePos] = useState<ImagePoint | null>(null);
    const [snapIndicator, setSnapIndicator] = useState<ImagePoint | null>(null);
    const [canvasSize, setCanvasSize] = useState({ width: 800, height: 500 });

    const {
        referenceImage,
        imageWidth,
        imageHeight,
        viewport,
        setViewport,
        drawingMode,
        diagramType,
        calibration,
        polygons,
        activePolygon,
        selectedPolygonId,
        labels,
        lines,
        snapEnabled,
    } = useDiagramEditorStore();

    // Load reference image
    useEffect(() => {
        if (!referenceImage) {
            imageRef.current = null;
            return;
        }
        const img = new Image();
        img.onload = () => {
            imageRef.current = img;
        };
        img.src = referenceImage;
    }, [referenceImage]);

    // Resize observer
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width } = entry.contentRect;
                const h = typeof height === 'number' ? height : entry.contentRect.height;
                setCanvasSize({ width: Math.floor(width), height: Math.floor(h as number) });
            }
        });
        observer.observe(container);
        return () => observer.disconnect();
    }, [height]);

    // Build coordinate label
    const buildCursorLabel = useCallback((imagePos: ImagePoint | null): string | null => {
        if (!imagePos) return null;
        if (!calibration.isCalibrated) {
            return `Image: (${imagePos.x.toFixed(0)}, ${imagePos.y.toFixed(0)})`;
        }

        if (diagramType === 'ternary') {
            const fracs = imageToTernary(imagePos, calibration.ternaryVertices);
            if (fracs) {
                return `A: ${fracs.a.toFixed(1)}%  B: ${fracs.b.toFixed(1)}%  C: ${fracs.c.toFixed(1)}%`;
            }
        } else {
            const data = imageToDataUnified(
                imagePos,
                'xy',
                calibration.affineTransform,
                calibration.ternaryVertices,
                calibration.logX,
                calibration.logY
            );
            if (data) {
                return `X: ${data.x.toFixed(4)}  Y: ${data.y.toFixed(4)}`;
            }
        }
        return null;
    }, [calibration, diagramType]);

    // Handle cursor movement
    const handleCursorMove = useCallback((imagePoint: ImagePoint | null, snapPoint: ImagePoint | null) => {
        setCursorImagePos(imagePoint);
        setSnapIndicator(snapPoint);
    }, []);

    // Handle canvas click
    const handleCanvasClick = useCallback((imagePoint: ImagePoint, snapped: boolean) => {
        onCanvasClick?.(imagePoint, snapped);
    }, [onCanvasClick]);

    // Handle double click
    const handleDoubleClick = useCallback((imagePoint: ImagePoint) => {
        onCanvasDoubleClick?.(imagePoint);
    }, [onCanvasDoubleClick]);

    // Interaction hook
    useCanvasInteraction(canvasRef, {
        viewport,
        setViewport,
        drawingMode,
        snapEnabled,
        polygons,
        activePolygonPoints: activePolygon?.points || [],
        onCanvasClick: handleCanvasClick,
        onCanvasDoubleClick: handleDoubleClick,
        onCursorMove: handleCursorMove,
    });

    // Render loop
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        canvas.width = canvasSize.width;
        canvas.height = canvasSize.height;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const render = () => {
            renderCanvas({
                canvas,
                ctx,
                viewport,
                image: imageRef.current,
                imageWidth,
                imageHeight,
                drawingMode,
                diagramType,
                calibrationPoints: calibration.points,
                ternaryVertices: calibration.ternaryVertices,
                isCalibrated: calibration.isCalibrated,
                referencePoints: calibration.referencePoints,
                polygons,
                activePolygon,
                selectedPolygonId,
                labels,
                lines,
                cursorImagePos,
                snapIndicator,
                cursorDataLabel: buildCursorLabel(cursorImagePos),
            });
            animFrameRef.current = requestAnimationFrame(render);
        };

        animFrameRef.current = requestAnimationFrame(render);
        return () => cancelAnimationFrame(animFrameRef.current);
    }, [
        canvasSize, viewport, imageWidth, imageHeight, drawingMode, diagramType,
        calibration, polygons, activePolygon, selectedPolygonId,
        labels, lines, cursorImagePos, snapIndicator, buildCursorLabel,
    ]);

    return (
        <Box
            ref={containerRef}
            sx={{
                width: '100%',
                height: typeof height === 'number' ? height : '100%',
                position: 'relative',
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                overflow: 'hidden',
                bgcolor: '#f5f5f5',
            }}
        >
            <canvas
                ref={canvasRef}
                style={{
                    width: '100%',
                    height: '100%',
                    display: 'block',
                    cursor: drawingMode === 'pan' ? 'grab'
                        : (drawingMode === 'polygon' || drawingMode === 'polyline' || drawingMode === 'calibrate')
                            ? 'crosshair'
                            : drawingMode === 'label' || drawingMode === 'line'
                                ? 'crosshair'
                                : 'default',
                }}
            />
        </Box>
    );
};
