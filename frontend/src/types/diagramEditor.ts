/**
 * Types for the Classification Diagram Editor
 */

import { DiagramType } from './classificationDiagram';

// Coordinate spaces
export interface ImagePoint {
    x: number; // Image pixel X
    y: number; // Image pixel Y
}

export interface DataPoint {
    x: number; // Data coordinate X (or ternary cartesian X)
    y: number; // Data coordinate Y (or ternary cartesian Y)
}

export interface TernaryFractions {
    a: number; // Top vertex fraction (0-100)
    b: number; // Bottom-left fraction (0-100)
    c: number; // Bottom-right fraction (0-100)
}

// Viewport for canvas pan/zoom
export interface Viewport {
    offsetX: number;
    offsetY: number;
    scale: number;
}

// Calibration
export interface CalibrationPoint {
    id: string;
    imagePos: ImagePoint;    // Where user clicked on image
    dataX: number;           // Real data X coordinate
    dataY: number;           // Real data Y coordinate
}

export interface AffineTransform {
    // dataX = a * pixelX + b * pixelY + c
    // dataY = d * pixelX + e * pixelY + f
    a: number;
    b: number;
    c: number;
    d: number;
    e: number;
    f: number;
}

export interface TernaryVertices {
    a: ImagePoint | null;  // Top vertex
    b: ImagePoint | null;  // Bottom-left vertex
    c: ImagePoint | null;  // Bottom-right vertex
}

export interface CalibrationState {
    points: CalibrationPoint[];
    affineTransform: AffineTransform | null;
    ternaryVertices: TernaryVertices;
    isCalibrated: boolean;
    logX: boolean;
    logY: boolean;
    residualError: number | null;
    // 3-point reference calibration for XY
    referencePoints: {
        origin: ImagePoint | null;   // Image position of (xMin, yMin)
        xEnd: ImagePoint | null;     // Image position of (xMax, yMin)
        yEnd: ImagePoint | null;     // Image position of (xMin, yMax)
    };
}

// Drawing modes
export type DrawingMode = 'select' | 'pan' | 'calibrate' | 'polygon' | 'polyline' | 'label' | 'line';

// Editor polygon (dual coords)
export interface EditorPolygon {
    id: string;
    name: string;
    color: { r: number; g: number; b: number };
    imagePoints: ImagePoint[];    // Points in image space
    dataPoints: DataPoint[];      // Points in data coordinate space
    closed: boolean;
    visible: boolean;
    smooth?: boolean;
}

// Active (in-progress) polygon
export interface ActivePolygon {
    points: ImagePoint[];
    dataPoints: DataPoint[];
    isClosed: boolean;
}

// Editor label
export interface EditorLabel {
    id: string;
    name: string;
    imagePos: ImagePoint;
    dataPos: DataPoint;
    angle: number;
    color: { r: number; g: number; b: number };
}

// Editor line
export interface EditorLine {
    id: string;
    name: string;
    slope: number;
    intercept: number;
    color: { r: number; g: number; b: number };
    // Image space endpoints for rendering on canvas
    imageStart: ImagePoint;
    imageEnd: ImagePoint;
}

// Axis metadata for editor
export interface EditorAxisConfig {
    name: string;
    formula: string;
    log: boolean;
    min?: number;  // Data-space minimum for calibration
    max?: number;  // Data-space maximum for calibration
}

// Variable mapping
export interface EditorVariable {
    letter: string;
    element: string;
    unit: string;
}

// Undo/redo action types
export type EditorAction =
    | { type: 'addPolygon'; polygon: EditorPolygon }
    | { type: 'removePolygon'; polygon: EditorPolygon; index: number }
    | { type: 'updatePolygon'; id: string; before: EditorPolygon; after: EditorPolygon }
    | { type: 'addLabel'; label: EditorLabel }
    | { type: 'removeLabel'; label: EditorLabel; index: number }
    | { type: 'addLine'; line: EditorLine }
    | { type: 'removeLine'; line: EditorLine; index: number };

// Snap result
export interface SnapResult {
    snapped: boolean;
    point: ImagePoint;
    sourcePolygonId?: string;
    sourceVertexIndex?: number;
}

// Editor store state shape
export interface DiagramEditorState {
    // Wizard step
    activeStep: number;

    // Metadata
    diagramName: string;
    diagramType: DiagramType;
    category: string;
    subCategory: string;
    references: string;
    comments: string;

    // Reference image
    referenceImage: string | null;  // data URL
    imageWidth: number;
    imageHeight: number;

    // Viewport
    viewport: Viewport;

    // Drawing
    drawingMode: DrawingMode;

    // Calibration
    calibration: CalibrationState;

    // Polygons
    polygons: EditorPolygon[];
    activePolygon: ActivePolygon | null;
    selectedPolygonId: string | null;

    // Labels & Lines
    labels: EditorLabel[];
    lines: EditorLine[];

    // Axes & Variables
    axes: {
        a?: EditorAxisConfig;
        b?: EditorAxisConfig;
        c?: EditorAxisConfig;
        x?: EditorAxisConfig;
        y?: EditorAxisConfig;
    };
    variables: EditorVariable[];

    // Undo/Redo
    undoStack: EditorAction[];
    redoStack: EditorAction[];

    // Snap
    snapEnabled: boolean;
}
