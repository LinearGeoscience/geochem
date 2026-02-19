/**
 * Canvas interaction hook — handles mouse events for pan, zoom, click, and drawing.
 */

import { useCallback, useRef, useEffect } from 'react';
import {
    ImagePoint,
    Viewport,
    DrawingMode,
    EditorPolygon,
} from '../../../types/diagramEditor';
import { canvasToImage, findSnapTarget } from './coordinateTransform';

interface InteractionConfig {
    viewport: Viewport;
    setViewport: (vp: Viewport) => void;
    drawingMode: DrawingMode;
    snapEnabled: boolean;
    polygons: EditorPolygon[];
    activePolygonPoints: ImagePoint[];

    onCanvasClick: (imagePoint: ImagePoint, snapped: boolean) => void;
    onCanvasDoubleClick: (imagePoint: ImagePoint) => void;
    onCursorMove: (imagePoint: ImagePoint | null, snapPoint: ImagePoint | null) => void;
}

export function useCanvasInteraction(
    canvasRef: React.RefObject<HTMLCanvasElement | null>,
    config: InteractionConfig
) {
    const isPanning = useRef(false);
    const panStart = useRef({ x: 0, y: 0 });
    const panViewportStart = useRef({ offsetX: 0, offsetY: 0 });

    const getImagePoint = useCallback((e: MouseEvent | React.MouseEvent): ImagePoint => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };
        const rect = canvas.getBoundingClientRect();
        const canvasX = (e.clientX - rect.left) * (canvas.width / rect.width);
        const canvasY = (e.clientY - rect.top) * (canvas.height / rect.height);
        return canvasToImage(canvasX, canvasY, config.viewport);
    }, [canvasRef, config.viewport]);

    const handleMouseDown = useCallback((e: MouseEvent) => {
        if (e.button === 1 || (e.button === 0 && config.drawingMode === 'pan')) {
            // Middle click or pan mode: start panning
            isPanning.current = true;
            panStart.current = { x: e.clientX, y: e.clientY };
            panViewportStart.current = { offsetX: config.viewport.offsetX, offsetY: config.viewport.offsetY };
            e.preventDefault();
        }
    }, [config.drawingMode, config.viewport]);

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (isPanning.current) {
            const canvas = canvasRef.current;
            if (!canvas) return;
            const rect = canvas.getBoundingClientRect();
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;
            const dx = (e.clientX - panStart.current.x) * scaleX;
            const dy = (e.clientY - panStart.current.y) * scaleY;
            config.setViewport({
                ...config.viewport,
                offsetX: panViewportStart.current.offsetX + dx,
                offsetY: panViewportStart.current.offsetY + dy,
            });
            return;
        }

        const imagePoint = getImagePoint(e);

        // Check snap
        let snapPoint: ImagePoint | null = null;
        if (config.snapEnabled && (config.drawingMode === 'polygon' || config.drawingMode === 'polyline')) {
            const snapResult = findSnapTarget(
                imagePoint,
                config.polygons,
                config.activePolygonPoints,
                config.viewport
            );
            if (snapResult.snapped) {
                snapPoint = snapResult.point;
            }
        }

        config.onCursorMove(imagePoint, snapPoint);
    }, [canvasRef, config, getImagePoint]);

    const handleMouseUp = useCallback(() => {
        isPanning.current = false;
    }, []);

    const handleClick = useCallback((e: MouseEvent) => {
        if (config.drawingMode === 'pan' || config.drawingMode === 'select') return;

        const imagePoint = getImagePoint(e);

        // Check snap
        let finalPoint = imagePoint;
        let snapped = false;
        if (config.snapEnabled && (config.drawingMode === 'polygon' || config.drawingMode === 'polyline')) {
            const snapResult = findSnapTarget(
                imagePoint,
                config.polygons,
                config.activePolygonPoints,
                config.viewport
            );
            if (snapResult.snapped) {
                finalPoint = snapResult.point;
                snapped = true;
            }
        }

        config.onCanvasClick(finalPoint, snapped);
    }, [config, getImagePoint]);

    const handleDoubleClick = useCallback((e: MouseEvent) => {
        const imagePoint = getImagePoint(e);
        config.onCanvasDoubleClick(imagePoint);
    }, [config, getImagePoint]);

    const handleWheel = useCallback((e: WheelEvent) => {
        e.preventDefault();
        const canvas = canvasRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const mouseCanvasX = (e.clientX - rect.left) * (canvas.width / rect.width);
        const mouseCanvasY = (e.clientY - rect.top) * (canvas.height / rect.height);

        const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
        const newScale = Math.min(20, Math.max(0.1, config.viewport.scale * zoomFactor));

        // Zoom toward cursor
        const newOffsetX = mouseCanvasX - (mouseCanvasX - config.viewport.offsetX) * (newScale / config.viewport.scale);
        const newOffsetY = mouseCanvasY - (mouseCanvasY - config.viewport.offsetY) * (newScale / config.viewport.scale);

        config.setViewport({
            scale: newScale,
            offsetX: newOffsetX,
            offsetY: newOffsetY,
        });
    }, [canvasRef, config]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        canvas.addEventListener('mousedown', handleMouseDown);
        canvas.addEventListener('mousemove', handleMouseMove);
        canvas.addEventListener('mouseup', handleMouseUp);
        canvas.addEventListener('click', handleClick);
        canvas.addEventListener('dblclick', handleDoubleClick);
        canvas.addEventListener('wheel', handleWheel, { passive: false });
        canvas.addEventListener('mouseleave', () => config.onCursorMove(null, null));

        return () => {
            canvas.removeEventListener('mousedown', handleMouseDown);
            canvas.removeEventListener('mousemove', handleMouseMove);
            canvas.removeEventListener('mouseup', handleMouseUp);
            canvas.removeEventListener('click', handleClick);
            canvas.removeEventListener('dblclick', handleDoubleClick);
            canvas.removeEventListener('wheel', handleWheel);
        };
    }, [canvasRef, handleMouseDown, handleMouseMove, handleMouseUp, handleClick, handleDoubleClick, handleWheel, config]);
}
