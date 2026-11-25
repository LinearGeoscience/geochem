/**
 * Pure canvas drawing functions for the diagram editor.
 * Draw order: image → grid → calibration → ternary triangle → polygons → active polygon → labels → lines → snap → cursor
 */

import {
    ImagePoint,
    Viewport,
    CalibrationPoint,
    TernaryVertices,
    EditorPolygon,
    ActivePolygon,
    EditorLabel,
    EditorLine,
    DrawingMode,
    CalibrationState,
} from '../../../types/diagramEditor';
import { imageToCanvas } from './coordinateTransform';
import { rgbToCss } from '../utils/colorGenerator';

interface RenderState {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    viewport: Viewport;
    image: HTMLImageElement | null;
    imageWidth: number;
    imageHeight: number;
    drawingMode: DrawingMode;
    diagramType: 'xy' | 'ternary';

    // Calibration
    calibrationPoints: CalibrationPoint[];
    ternaryVertices: TernaryVertices;
    isCalibrated: boolean;

    // Polygons
    polygons: EditorPolygon[];
    activePolygon: ActivePolygon | null;
    selectedPolygonId: string | null;

    // Labels & Lines
    labels: EditorLabel[];
    lines: EditorLine[];

    // Reference points for 3-point XY calibration
    referencePoints: CalibrationState['referencePoints'];

    // Cursor & snap
    cursorImagePos: ImagePoint | null;
    snapIndicator: ImagePoint | null;
    cursorDataLabel: string | null;
}

export function renderCanvas(state: RenderState): void {
    const { ctx, canvas, viewport } = state;
    const w = canvas.width;
    const h = canvas.height;

    // 1. Clear
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(0, 0, w, h);

    // 2. Reference image
    if (state.image) {
        const imgX = viewport.offsetX;
        const imgY = viewport.offsetY;
        const imgW = state.imageWidth * viewport.scale;
        const imgH = state.imageHeight * viewport.scale;
        ctx.drawImage(state.image, imgX, imgY, imgW, imgH);
    }

    // 3. Grid overlay (in calibrate mode)
    // Skipped for now — focus on core functionality

    // 4. Calibration points
    if (state.drawingMode === 'calibrate') {
        drawCalibrationPoints(ctx, state.calibrationPoints, viewport);
    }

    // 5a. Reference points for XY 3-point calibration
    if (state.drawingMode === 'calibrate' && state.diagramType === 'xy') {
        drawReferencePoints(ctx, state.referencePoints, viewport, state.isCalibrated);
    }

    // 5. Ternary triangle overlay
    if (state.diagramType === 'ternary' && state.drawingMode === 'calibrate') {
        drawTernaryOverlay(ctx, state.ternaryVertices, viewport);
    }

    // 6. Completed polygons
    for (const poly of state.polygons) {
        if (!poly.visible) continue;
        const isSelected = poly.id === state.selectedPolygonId;
        drawPolygon(ctx, poly, viewport, isSelected);
    }

    // 7. Active/in-progress polygon
    if (state.activePolygon && state.activePolygon.points.length > 0) {
        drawActivePolygon(ctx, state.activePolygon, viewport, state.cursorImagePos);
    }

    // 8. Labels
    for (const label of state.labels) {
        drawLabel(ctx, label, viewport);
    }

    // 9. Lines
    for (const line of state.lines) {
        drawEditorLine(ctx, line, viewport);
    }

    // 10. Snap indicator
    if (state.snapIndicator) {
        drawSnapIndicator(ctx, state.snapIndicator, viewport);
    }

    // 11. Cursor crosshair + coordinate readout
    if (state.cursorImagePos && (state.drawingMode === 'polygon' || state.drawingMode === 'polyline' || state.drawingMode === 'calibrate' || state.drawingMode === 'label' || state.drawingMode === 'line')) {
        drawCrosshair(ctx, state.cursorImagePos, viewport, w, h);
    }

    // Coordinate readout bar at bottom
    if (state.cursorDataLabel) {
        drawCoordinateBar(ctx, state.cursorDataLabel, w, h);
    }
}

function drawCalibrationPoints(
    ctx: CanvasRenderingContext2D,
    points: CalibrationPoint[],
    viewport: Viewport
): void {
    for (let i = 0; i < points.length; i++) {
        const pt = points[i];
        const canvasPos = imageToCanvas(pt.imagePos.x, pt.imagePos.y, viewport);
        const r = 8;

        // Crosshair
        ctx.strokeStyle = '#e53935';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(canvasPos.x - r * 2, canvasPos.y);
        ctx.lineTo(canvasPos.x + r * 2, canvasPos.y);
        ctx.moveTo(canvasPos.x, canvasPos.y - r * 2);
        ctx.lineTo(canvasPos.x, canvasPos.y + r * 2);
        ctx.stroke();

        // Circle
        ctx.beginPath();
        ctx.arc(canvasPos.x, canvasPos.y, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(229, 57, 53, 0.3)';
        ctx.fill();
        ctx.stroke();

        // Number label
        ctx.fillStyle = '#e53935';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(`${i + 1}`, canvasPos.x + r + 2, canvasPos.y - 2);

        // Data value label
        ctx.font = '10px sans-serif';
        ctx.fillStyle = '#333';
        ctx.fillText(`(${pt.dataX.toFixed(2)}, ${pt.dataY.toFixed(2)})`, canvasPos.x + r + 2, canvasPos.y + 12);
    }
}

function drawReferencePoints(
    ctx: CanvasRenderingContext2D,
    referencePoints: CalibrationState['referencePoints'],
    viewport: Viewport,
    isCalibrated: boolean
): void {
    const configs: { key: 'origin' | 'xEnd' | 'yEnd'; color: string; label: string }[] = [
        { key: 'origin', color: '#2e7d32', label: 'Origin' },
        { key: 'xEnd', color: '#1565c0', label: 'X-End' },
        { key: 'yEnd', color: '#e65100', label: 'Y-End' },
    ];

    const canvasPositions: { key: string; cx: number; cy: number }[] = [];

    for (const { key, color, label } of configs) {
        const pt = referencePoints[key];
        if (!pt) continue;

        const cp = imageToCanvas(pt.x, pt.y, viewport);
        canvasPositions.push({ key, cx: cp.x, cy: cp.y });
        const r = 10;

        // Crosshair
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cp.x - r * 2, cp.y);
        ctx.lineTo(cp.x + r * 2, cp.y);
        ctx.moveTo(cp.x, cp.y - r * 2);
        ctx.lineTo(cp.x, cp.y + r * 2);
        ctx.stroke();

        // Diamond marker
        ctx.beginPath();
        ctx.moveTo(cp.x, cp.y - r);
        ctx.lineTo(cp.x + r, cp.y);
        ctx.lineTo(cp.x, cp.y + r);
        ctx.lineTo(cp.x - r, cp.y);
        ctx.closePath();
        ctx.fillStyle = color + '40'; // 25% alpha
        ctx.fill();
        ctx.stroke();

        // Label
        ctx.fillStyle = color;
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(label, cp.x + r + 4, cp.y - 4);
    }

    // L-shape connecting lines when all 3 are placed
    if (canvasPositions.length === 3) {
        const originPos = canvasPositions.find(p => p.key === 'origin')!;
        const xEndPos = canvasPositions.find(p => p.key === 'xEnd')!;
        const yEndPos = canvasPositions.find(p => p.key === 'yEnd')!;

        const lineColor = isCalibrated ? '#2e7d32' : '#9e9e9e';
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 4]);

        // Origin → X-End
        ctx.beginPath();
        ctx.moveTo(originPos.cx, originPos.cy);
        ctx.lineTo(xEndPos.cx, xEndPos.cy);
        ctx.stroke();

        // Origin → Y-End
        ctx.beginPath();
        ctx.moveTo(originPos.cx, originPos.cy);
        ctx.lineTo(yEndPos.cx, yEndPos.cy);
        ctx.stroke();

        ctx.setLineDash([]);
    }
}

function drawTernaryOverlay(
    ctx: CanvasRenderingContext2D,
    vertices: TernaryVertices,
    viewport: Viewport
): void {
    const pts: { x: number; y: number }[] = [];
    const labels = ['A', 'B', 'C'];
    const verts = [vertices.a, vertices.b, vertices.c];

    for (let i = 0; i < 3; i++) {
        const v = verts[i];
        if (v) {
            const cp = imageToCanvas(v.x, v.y, viewport);
            pts.push(cp);

            // Vertex marker
            ctx.beginPath();
            ctx.arc(cp.x, cp.y, 8, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(33, 150, 243, 0.3)';
            ctx.fill();
            ctx.strokeStyle = '#1976d2';
            ctx.lineWidth = 2;
            ctx.stroke();

            // Label
            ctx.fillStyle = '#1976d2';
            ctx.font = 'bold 14px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(labels[i], cp.x, cp.y - 12);
        }
    }

    // Draw triangle if all 3 vertices are set
    if (pts.length === 3) {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        ctx.lineTo(pts[1].x, pts[1].y);
        ctx.lineTo(pts[2].x, pts[2].y);
        ctx.closePath();
        ctx.strokeStyle = '#1976d2';
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Fill with light blue
        ctx.fillStyle = 'rgba(33, 150, 243, 0.08)';
        ctx.fill();
    }
}

function drawPolygon(
    ctx: CanvasRenderingContext2D,
    polygon: EditorPolygon,
    viewport: Viewport,
    isSelected: boolean
): void {
    if (polygon.imagePoints.length < 2) return;

    const canvasPoints = polygon.imagePoints.map(p => imageToCanvas(p.x, p.y, viewport));
    const colorStr = rgbToCss(polygon.color);
    const fillStr = rgbToCss(polygon.color, 0.2);

    ctx.beginPath();
    ctx.moveTo(canvasPoints[0].x, canvasPoints[0].y);
    for (let i = 1; i < canvasPoints.length; i++) {
        ctx.lineTo(canvasPoints[i].x, canvasPoints[i].y);
    }
    if (polygon.closed) {
        ctx.closePath();
        ctx.fillStyle = fillStr;
        ctx.fill();
    }

    ctx.strokeStyle = colorStr;
    ctx.lineWidth = isSelected ? 3 : 2;
    ctx.stroke();

    // Vertex dots
    for (const cp of canvasPoints) {
        ctx.beginPath();
        ctx.arc(cp.x, cp.y, isSelected ? 5 : 3, 0, Math.PI * 2);
        ctx.fillStyle = isSelected ? colorStr : 'white';
        ctx.fill();
        ctx.strokeStyle = colorStr;
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }

    // Polygon name label
    if (polygon.closed && canvasPoints.length >= 3) {
        const cx = canvasPoints.reduce((s, p) => s + p.x, 0) / canvasPoints.length;
        const cy = canvasPoints.reduce((s, p) => s + p.y, 0) / canvasPoints.length;
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(polygon.name, cx, cy);
    }
}

function drawActivePolygon(
    ctx: CanvasRenderingContext2D,
    activePolygon: ActivePolygon,
    viewport: Viewport,
    cursorPos: ImagePoint | null
): void {
    const canvasPoints = activePolygon.points.map(p => imageToCanvas(p.x, p.y, viewport));

    if (canvasPoints.length === 0) return;

    // Draw completed segments
    ctx.beginPath();
    ctx.moveTo(canvasPoints[0].x, canvasPoints[0].y);
    for (let i = 1; i < canvasPoints.length; i++) {
        ctx.lineTo(canvasPoints[i].x, canvasPoints[i].y);
    }
    ctx.strokeStyle = '#1976d2';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Dashed preview line to cursor
    if (cursorPos) {
        const lastPt = canvasPoints[canvasPoints.length - 1];
        const cursorCanvas = imageToCanvas(cursorPos.x, cursorPos.y, viewport);
        ctx.beginPath();
        ctx.moveTo(lastPt.x, lastPt.y);
        ctx.lineTo(cursorCanvas.x, cursorCanvas.y);
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = '#1976d2';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // Vertex dots
    for (let i = 0; i < canvasPoints.length; i++) {
        const cp = canvasPoints[i];
        ctx.beginPath();
        ctx.arc(cp.x, cp.y, i === 0 ? 6 : 4, 0, Math.PI * 2);
        ctx.fillStyle = i === 0 ? 'rgba(25, 118, 210, 0.3)' : 'white';
        ctx.fill();
        ctx.strokeStyle = '#1976d2';
        ctx.lineWidth = 2;
        ctx.stroke();
    }
}

function drawLabel(
    ctx: CanvasRenderingContext2D,
    label: EditorLabel,
    viewport: Viewport
): void {
    const cp = imageToCanvas(label.imagePos.x, label.imagePos.y, viewport);

    ctx.save();
    ctx.translate(cp.x, cp.y);
    ctx.rotate((label.angle * Math.PI) / 180);

    ctx.fillStyle = rgbToCss(label.color);
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label.name, 0, 0);

    ctx.restore();

    // Small dot at placement point
    ctx.beginPath();
    ctx.arc(cp.x, cp.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = rgbToCss(label.color, 0.5);
    ctx.fill();
}

function drawEditorLine(
    ctx: CanvasRenderingContext2D,
    line: EditorLine,
    viewport: Viewport
): void {
    if (line.imageStart.x === 0 && line.imageStart.y === 0 &&
        line.imageEnd.x === 0 && line.imageEnd.y === 0) return;

    const start = imageToCanvas(line.imageStart.x, line.imageStart.y, viewport);
    const end = imageToCanvas(line.imageEnd.x, line.imageEnd.y, viewport);

    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.setLineDash([8, 4]);
    ctx.strokeStyle = rgbToCss(line.color);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
}

function drawSnapIndicator(
    ctx: CanvasRenderingContext2D,
    point: ImagePoint,
    viewport: Viewport
): void {
    const cp = imageToCanvas(point.x, point.y, viewport);
    ctx.beginPath();
    ctx.arc(cp.x, cp.y, 10, 0, Math.PI * 2);
    ctx.strokeStyle = '#ff9800';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
}

function drawCrosshair(
    ctx: CanvasRenderingContext2D,
    imagePos: ImagePoint,
    viewport: Viewport,
    canvasWidth: number,
    canvasHeight: number
): void {
    const cp = imageToCanvas(imagePos.x, imagePos.y, viewport);

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);

    // Horizontal
    ctx.beginPath();
    ctx.moveTo(0, cp.y);
    ctx.lineTo(canvasWidth, cp.y);
    ctx.stroke();

    // Vertical
    ctx.beginPath();
    ctx.moveTo(cp.x, 0);
    ctx.lineTo(cp.x, canvasHeight);
    ctx.stroke();

    ctx.setLineDash([]);
}

function drawCoordinateBar(
    ctx: CanvasRenderingContext2D,
    label: string,
    canvasWidth: number,
    canvasHeight: number
): void {
    const barHeight = 24;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, canvasHeight - barHeight, canvasWidth, barHeight);

    ctx.fillStyle = '#fff';
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 8, canvasHeight - barHeight / 2);
}
