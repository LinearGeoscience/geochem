import { create } from 'zustand';
import {
    DiagramEditorState,
    DrawingMode,
    EditorPolygon,
    EditorLabel,
    EditorLine,
    EditorAction,
    EditorAxisConfig,
    EditorVariable,
    ImagePoint,
    Viewport,
} from '../types/diagramEditor';
import { DiagramType, ClassificationDiagram } from '../types/classificationDiagram';
import {
    computeAffineTransform,
    imageToDataUnified,
    imageToData,
    imageToTernary,
    subdivideAndConvert,
} from '../features/diagramEditor/canvas/coordinateTransform';
import { generateNextColor } from '../features/diagramEditor/utils/colorGenerator';

function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const initialCalibration = (): DiagramEditorState['calibration'] => ({
    points: [],
    affineTransform: null,
    ternaryVertices: { a: null, b: null, c: null },
    isCalibrated: false,
    logX: false,
    logY: false,
    residualError: null,
    referencePoints: { origin: null, xEnd: null, yEnd: null },
});

interface DiagramEditorActions {
    // Navigation
    setActiveStep: (step: number) => void;

    // Metadata
    setDiagramName: (name: string) => void;
    setDiagramType: (type: DiagramType) => void;
    setCategory: (category: string) => void;
    setSubCategory: (sub: string) => void;
    setReferences: (refs: string) => void;
    setComments: (comments: string) => void;

    // Image
    setReferenceImage: (dataUrl: string | null, width: number, height: number) => void;

    // Viewport
    setViewport: (viewport: Viewport) => void;
    resetViewport: () => void;

    // Drawing mode
    setDrawingMode: (mode: DrawingMode) => void;

    // Calibration
    addCalibrationPoint: (imagePos: ImagePoint, dataX: number, dataY: number) => void;
    updateCalibrationPoint: (id: string, dataX: number, dataY: number) => void;
    removeCalibrationPoint: (id: string) => void;
    computeCalibration: () => void;
    setLogScale: (axis: 'x' | 'y', enabled: boolean) => void;
    setTernaryVertex: (vertex: 'a' | 'b' | 'c', pos: ImagePoint) => void;
    clearTernaryVertex: (vertex: 'a' | 'b' | 'c') => void;
    setReferencePoint: (which: 'origin' | 'xEnd' | 'yEnd', pos: ImagePoint) => void;
    clearReferencePoint: (which: 'origin' | 'xEnd' | 'yEnd') => void;
    computeThreePointCalibration: () => void;

    // Polygon drawing
    startPolygon: (firstPoint: ImagePoint) => void;
    addVertexToActive: (point: ImagePoint) => void;
    closeActivePolygon: (name?: string) => void;
    cancelActivePolygon: () => void;

    // Polygon management
    addPolygon: (polygon: EditorPolygon) => void;
    removePolygon: (id: string) => void;
    updatePolygon: (id: string, updates: Partial<EditorPolygon>) => void;
    setSelectedPolygonId: (id: string | null) => void;
    reorderPolygon: (id: string, direction: 'up' | 'down') => void;

    // Labels
    addLabel: (imagePos: ImagePoint, name: string) => void;
    updateLabel: (id: string, updates: Partial<EditorLabel>) => void;
    removeLabel: (id: string) => void;

    // Lines
    addLine: (imageStart: ImagePoint, imageEnd: ImagePoint, name?: string) => void;
    addLineFromParams: (slope: number, intercept: number, name?: string) => void;
    updateLine: (id: string, updates: Partial<EditorLine>) => void;
    removeLine: (id: string) => void;

    // Axes & Variables
    setAxis: (key: 'a' | 'b' | 'c' | 'x' | 'y', config: EditorAxisConfig) => void;
    setVariables: (vars: EditorVariable[]) => void;
    addVariable: () => void;
    removeVariable: (index: number) => void;
    updateVariable: (index: number, updates: Partial<EditorVariable>) => void;

    // Snap
    setSnapEnabled: (enabled: boolean) => void;

    // Undo/Redo
    undo: () => void;
    redo: () => void;
    pushAction: (action: EditorAction) => void;

    // Build final diagram
    buildDiagram: () => ClassificationDiagram;

    // Load existing diagram for editing
    loadDiagramForEditing: (diagram: ClassificationDiagram) => void;

    // Reset
    reset: () => void;

    // Validation helpers
    canProceedFromStep: (step: number) => boolean;
}

type DiagramEditorStore = DiagramEditorState & DiagramEditorActions;

const initialState: DiagramEditorState = {
    activeStep: 0,
    diagramName: '',
    diagramType: 'xy',
    category: '',
    subCategory: '',
    references: '',
    comments: '',
    referenceImage: null,
    imageWidth: 0,
    imageHeight: 0,
    viewport: { offsetX: 0, offsetY: 0, scale: 1 },
    drawingMode: 'select',
    calibration: initialCalibration(),
    polygons: [],
    activePolygon: null,
    selectedPolygonId: null,
    labels: [],
    lines: [],
    axes: {},
    variables: [],
    undoStack: [],
    redoStack: [],
    snapEnabled: true,
};

export const useDiagramEditorStore = create<DiagramEditorStore>((set, get) => ({
    ...initialState,

    // ─── Navigation ──────────────────────────────────────────────
    setActiveStep: (step) => set({ activeStep: step }),

    // ─── Metadata ────────────────────────────────────────────────
    setDiagramName: (name) => set({ diagramName: name }),
    setDiagramType: (type) => set({
        diagramType: type,
        calibration: initialCalibration(),
        axes: type === 'ternary'
            ? { a: { name: '', formula: '', log: false }, b: { name: '', formula: '', log: false }, c: { name: '', formula: '', log: false } }
            : { x: { name: '', formula: '', log: false, min: undefined, max: undefined }, y: { name: '', formula: '', log: false, min: undefined, max: undefined } },
    }),
    setCategory: (category) => set({ category }),
    setSubCategory: (sub) => set({ subCategory: sub }),
    setReferences: (refs) => set({ references: refs }),
    setComments: (comments) => set({ comments }),

    // ─── Image ───────────────────────────────────────────────────
    setReferenceImage: (dataUrl, width, height) => set({
        referenceImage: dataUrl,
        imageWidth: width,
        imageHeight: height,
        viewport: { offsetX: 0, offsetY: 0, scale: 1 },
    }),

    // ─── Viewport ────────────────────────────────────────────────
    setViewport: (viewport) => set({ viewport }),
    resetViewport: () => set({ viewport: { offsetX: 0, offsetY: 0, scale: 1 } }),

    // ─── Drawing Mode ────────────────────────────────────────────
    setDrawingMode: (mode) => set({ drawingMode: mode }),

    // ─── Calibration ─────────────────────────────────────────────
    addCalibrationPoint: (imagePos, dataX, dataY) => set(state => ({
        calibration: {
            ...state.calibration,
            points: [...state.calibration.points, {
                id: generateId(),
                imagePos,
                dataX,
                dataY,
            }],
        },
    })),

    updateCalibrationPoint: (id, dataX, dataY) => set(state => ({
        calibration: {
            ...state.calibration,
            points: state.calibration.points.map(p =>
                p.id === id ? { ...p, dataX, dataY } : p
            ),
        },
    })),

    removeCalibrationPoint: (id) => set(state => ({
        calibration: {
            ...state.calibration,
            points: state.calibration.points.filter(p => p.id !== id),
            isCalibrated: false,
            affineTransform: null,
            residualError: null,
        },
    })),

    computeCalibration: () => {
        const state = get();
        if (state.diagramType === 'xy') {
            // If 3-point reference calibration is available, use it
            const { origin, xEnd, yEnd } = state.calibration.referencePoints;
            if (origin && xEnd && yEnd) {
                get().computeThreePointCalibration();
                return;
            }
            // Fallback to legacy point-based calibration
            const result = computeAffineTransform(
                state.calibration.points,
                state.calibration.logX,
                state.calibration.logY
            );
            if (result) {
                set({
                    calibration: {
                        ...state.calibration,
                        affineTransform: result.transform,
                        isCalibrated: true,
                        residualError: result.residual,
                    },
                });
            }
        } else {
            // Ternary: calibrated when all 3 vertices are set
            const { a, b, c } = state.calibration.ternaryVertices;
            set({
                calibration: {
                    ...state.calibration,
                    isCalibrated: !!(a && b && c),
                },
            });
        }
    },

    setLogScale: (axis, enabled) => set(state => {
        const axisKey = axis as 'x' | 'y';
        const existingAxis = state.axes[axisKey];
        return {
            calibration: {
                ...state.calibration,
                [axis === 'x' ? 'logX' : 'logY']: enabled,
                isCalibrated: false,
                affineTransform: null,
                residualError: null,
            },
            axes: {
                ...state.axes,
                [axisKey]: { ...(existingAxis || { name: '', formula: '' }), log: enabled },
            },
        };
    }),

    setTernaryVertex: (vertex, pos) => set(state => {
        const newVertices = { ...state.calibration.ternaryVertices, [vertex]: pos };
        const isCalibrated = !!(newVertices.a && newVertices.b && newVertices.c);
        return {
            calibration: {
                ...state.calibration,
                ternaryVertices: newVertices,
                isCalibrated,
            },
        };
    }),

    clearTernaryVertex: (vertex) => set(state => ({
        calibration: {
            ...state.calibration,
            ternaryVertices: { ...state.calibration.ternaryVertices, [vertex]: null },
            isCalibrated: false,
        },
    })),

    setReferencePoint: (which, pos) => set(state => ({
        calibration: {
            ...state.calibration,
            referencePoints: { ...state.calibration.referencePoints, [which]: pos },
        },
    })),

    clearReferencePoint: (which) => set(state => ({
        calibration: {
            ...state.calibration,
            referencePoints: { ...state.calibration.referencePoints, [which]: null },
            isCalibrated: false,
            affineTransform: null,
            points: [],
            residualError: null,
        },
    })),

    computeThreePointCalibration: () => {
        const state = get();
        const { origin, xEnd, yEnd } = state.calibration.referencePoints;
        if (!origin || !xEnd || !yEnd) return;

        const xAxis = state.axes.x;
        const yAxis = state.axes.y;
        if (xAxis?.min == null || xAxis?.max == null || yAxis?.min == null || yAxis?.max == null) return;

        const xMin = xAxis.min;
        const xMax = xAxis.max;
        const yMin = yAxis.min;
        const yMax = yAxis.max;

        // Synthesize 3 CalibrationPoints from the reference points
        const syntheticPoints = [
            { id: 'ref-origin', imagePos: origin, dataX: xMin, dataY: yMin },
            { id: 'ref-xEnd', imagePos: xEnd, dataX: xMax, dataY: yMin },
            { id: 'ref-yEnd', imagePos: yEnd, dataX: xMin, dataY: yMax },
        ];

        const result = computeAffineTransform(
            syntheticPoints,
            state.calibration.logX,
            state.calibration.logY
        );

        if (result) {
            set({
                calibration: {
                    ...state.calibration,
                    points: syntheticPoints,
                    affineTransform: result.transform,
                    isCalibrated: true,
                    residualError: result.residual,
                },
            });
        }
    },

    // ─── Polygon Drawing ─────────────────────────────────────────
    startPolygon: (firstPoint) => {
        const state = get();
        const dataPoint = imageToDataUnified(
            firstPoint,
            state.diagramType,
            state.calibration.affineTransform,
            state.calibration.ternaryVertices,
            state.calibration.logX,
            state.calibration.logY
        );
        set({
            activePolygon: {
                points: [firstPoint],
                dataPoints: dataPoint ? [dataPoint] : [{ x: 0, y: 0 }],
                isClosed: false,
            },
        });
    },

    addVertexToActive: (point) => {
        const state = get();
        if (!state.activePolygon) return;
        const dataPoint = imageToDataUnified(
            point,
            state.diagramType,
            state.calibration.affineTransform,
            state.calibration.ternaryVertices,
            state.calibration.logX,
            state.calibration.logY
        );
        set({
            activePolygon: {
                ...state.activePolygon,
                points: [...state.activePolygon.points, point],
                dataPoints: [...state.activePolygon.dataPoints, dataPoint || { x: 0, y: 0 }],
            },
        });
    },

    closeActivePolygon: (name) => {
        const state = get();
        if (!state.activePolygon || state.activePolygon.points.length < 2) return;

        const isPolyline = state.drawingMode === 'polyline';
        const color = generateNextColor(state.polygons.length);
        const polygon: EditorPolygon = {
            id: generateId(),
            name: name || `Field ${state.polygons.length + 1}`,
            color,
            imagePoints: [...state.activePolygon.points],
            dataPoints: [...state.activePolygon.dataPoints],
            closed: !isPolyline,
            visible: true,
        };

        const action: EditorAction = { type: 'addPolygon', polygon };
        set(s => ({
            polygons: [...s.polygons, polygon],
            activePolygon: null,
            undoStack: [...s.undoStack, action],
            redoStack: [],
        }));
    },

    cancelActivePolygon: () => set({ activePolygon: null }),

    // ─── Polygon Management ──────────────────────────────────────
    addPolygon: (polygon) => {
        const action: EditorAction = { type: 'addPolygon', polygon };
        set(s => ({
            polygons: [...s.polygons, polygon],
            undoStack: [...s.undoStack, action],
            redoStack: [],
        }));
    },

    removePolygon: (id) => set(state => {
        const idx = state.polygons.findIndex(p => p.id === id);
        if (idx === -1) return {};
        const polygon = state.polygons[idx];
        const action: EditorAction = { type: 'removePolygon', polygon, index: idx };
        return {
            polygons: state.polygons.filter(p => p.id !== id),
            selectedPolygonId: state.selectedPolygonId === id ? null : state.selectedPolygonId,
            undoStack: [...state.undoStack, action],
            redoStack: [],
        };
    }),

    updatePolygon: (id, updates) => set(state => ({
        polygons: state.polygons.map(p =>
            p.id === id ? { ...p, ...updates } : p
        ),
    })),

    setSelectedPolygonId: (id) => set({ selectedPolygonId: id }),

    reorderPolygon: (id, direction) => set(state => {
        const idx = state.polygons.findIndex(p => p.id === id);
        if (idx === -1) return {};
        const newIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (newIdx < 0 || newIdx >= state.polygons.length) return {};
        const newPolygons = [...state.polygons];
        [newPolygons[idx], newPolygons[newIdx]] = [newPolygons[newIdx], newPolygons[idx]];
        return { polygons: newPolygons };
    }),

    // ─── Labels ──────────────────────────────────────────────────
    addLabel: (imagePos, name) => {
        const state = get();
        const dataPos = imageToDataUnified(
            imagePos,
            state.diagramType,
            state.calibration.affineTransform,
            state.calibration.ternaryVertices,
            state.calibration.logX,
            state.calibration.logY
        ) || { x: 0, y: 0 };

        const label: EditorLabel = {
            id: generateId(),
            name,
            imagePos,
            dataPos,
            angle: 0,
            color: { r: 0, g: 0, b: 0 },
        };
        const action: EditorAction = { type: 'addLabel', label };
        set(s => ({
            labels: [...s.labels, label],
            undoStack: [...s.undoStack, action],
            redoStack: [],
        }));
    },

    updateLabel: (id, updates) => set(state => ({
        labels: state.labels.map(l => l.id === id ? { ...l, ...updates } : l),
    })),

    removeLabel: (id) => set(state => {
        const idx = state.labels.findIndex(l => l.id === id);
        if (idx === -1) return {};
        const label = state.labels[idx];
        const action: EditorAction = { type: 'removeLabel', label, index: idx };
        return {
            labels: state.labels.filter(l => l.id !== id),
            undoStack: [...state.undoStack, action],
            redoStack: [],
        };
    }),

    // ─── Lines ───────────────────────────────────────────────────
    addLine: (imageStart, imageEnd, name) => {
        const state = get();
        const start = imageToDataUnified(
            imageStart, state.diagramType, state.calibration.affineTransform,
            state.calibration.ternaryVertices, state.calibration.logX, state.calibration.logY
        );
        const end = imageToDataUnified(
            imageEnd, state.diagramType, state.calibration.affineTransform,
            state.calibration.ternaryVertices, state.calibration.logX, state.calibration.logY
        );

        if (!start || !end) return;

        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const slope = Math.abs(dx) > 1e-10 ? dy / dx : Infinity;
        const intercept = isFinite(slope) ? start.y - slope * start.x : start.x;

        const line: EditorLine = {
            id: generateId(),
            name: name || `Line ${state.lines.length + 1}`,
            slope,
            intercept,
            color: { r: 0, g: 0, b: 0 },
            imageStart,
            imageEnd,
        };
        const action: EditorAction = { type: 'addLine', line };
        set(s => ({
            lines: [...s.lines, line],
            undoStack: [...s.undoStack, action],
            redoStack: [],
        }));
    },

    addLineFromParams: (slope, intercept, name) => {
        const state = get();
        const line: EditorLine = {
            id: generateId(),
            name: name || `Line ${state.lines.length + 1}`,
            slope,
            intercept,
            color: { r: 0, g: 0, b: 0 },
            imageStart: { x: 0, y: 0 },
            imageEnd: { x: 0, y: 0 },
        };
        const action: EditorAction = { type: 'addLine', line };
        set(s => ({
            lines: [...s.lines, line],
            undoStack: [...s.undoStack, action],
            redoStack: [],
        }));
    },

    updateLine: (id, updates) => set(state => ({
        lines: state.lines.map(l => l.id === id ? { ...l, ...updates } : l),
    })),

    removeLine: (id) => set(state => {
        const idx = state.lines.findIndex(l => l.id === id);
        if (idx === -1) return {};
        const line = state.lines[idx];
        const action: EditorAction = { type: 'removeLine', line, index: idx };
        return {
            lines: state.lines.filter(l => l.id !== id),
            undoStack: [...state.undoStack, action],
            redoStack: [],
        };
    }),

    // ─── Axes & Variables ────────────────────────────────────────
    setAxis: (key, config) => set(state => {
        const prev = state.axes[key];
        const prevLog = prev?.log ?? false;
        const newLog = config.log ?? false;
        const logChanged = prevLog !== newLog && (key === 'x' || key === 'y');
        const rangeChanged = (key === 'x' || key === 'y') &&
            (prev?.min !== config.min || prev?.max !== config.max);
        const shouldInvalidate = logChanged || rangeChanged;
        return {
            axes: { ...state.axes, [key]: config },
            ...(shouldInvalidate ? {
                calibration: {
                    ...state.calibration,
                    ...(logChanged ? { [key === 'x' ? 'logX' : 'logY']: newLog } : {}),
                    isCalibrated: false,
                    affineTransform: null,
                    residualError: null,
                },
            } : {}),
        };
    }),

    setVariables: (vars) => set({ variables: vars }),

    addVariable: () => set(state => {
        const usedLetters = new Set(state.variables.map(v => v.letter.toUpperCase()));
        let nextLetter = '';
        for (let i = 0; i < 26; i++) {
            const letter = String.fromCharCode(65 + i); // A-Z
            if (!usedLetters.has(letter)) {
                nextLetter = letter;
                break;
            }
        }
        return {
            variables: [...state.variables, { letter: nextLetter, element: '', unit: 'pct' }],
        };
    }),

    removeVariable: (index) => set(state => ({
        variables: state.variables.filter((_, i) => i !== index),
    })),

    updateVariable: (index, updates) => set(state => ({
        variables: state.variables.map((v, i) => i === index ? { ...v, ...updates } : v),
    })),

    // ─── Snap ────────────────────────────────────────────────────
    setSnapEnabled: (enabled) => set({ snapEnabled: enabled }),

    // ─── Undo/Redo ───────────────────────────────────────────────
    undo: () => set(state => {
        if (state.undoStack.length === 0) return {};
        const action = state.undoStack[state.undoStack.length - 1];
        const newUndo = state.undoStack.slice(0, -1);

        switch (action.type) {
            case 'addPolygon':
                return {
                    polygons: state.polygons.filter(p => p.id !== action.polygon.id),
                    undoStack: newUndo,
                    redoStack: [...state.redoStack, action],
                };
            case 'removePolygon':
                const restored = [...state.polygons];
                restored.splice(action.index, 0, action.polygon);
                return {
                    polygons: restored,
                    undoStack: newUndo,
                    redoStack: [...state.redoStack, action],
                };
            case 'addLabel':
                return {
                    labels: state.labels.filter(l => l.id !== action.label.id),
                    undoStack: newUndo,
                    redoStack: [...state.redoStack, action],
                };
            case 'removeLabel': {
                const restoredLabels = [...state.labels];
                restoredLabels.splice(action.index, 0, action.label);
                return {
                    labels: restoredLabels,
                    undoStack: newUndo,
                    redoStack: [...state.redoStack, action],
                };
            }
            case 'addLine':
                return {
                    lines: state.lines.filter(l => l.id !== action.line.id),
                    undoStack: newUndo,
                    redoStack: [...state.redoStack, action],
                };
            case 'removeLine': {
                const restoredLines = [...state.lines];
                restoredLines.splice(action.index, 0, action.line);
                return {
                    lines: restoredLines,
                    undoStack: newUndo,
                    redoStack: [...state.redoStack, action],
                };
            }
            default:
                return {};
        }
    }),

    redo: () => set(state => {
        if (state.redoStack.length === 0) return {};
        const action = state.redoStack[state.redoStack.length - 1];
        const newRedo = state.redoStack.slice(0, -1);

        switch (action.type) {
            case 'addPolygon':
                return {
                    polygons: [...state.polygons, action.polygon],
                    undoStack: [...state.undoStack, action],
                    redoStack: newRedo,
                };
            case 'removePolygon':
                return {
                    polygons: state.polygons.filter(p => p.id !== action.polygon.id),
                    undoStack: [...state.undoStack, action],
                    redoStack: newRedo,
                };
            case 'addLabel':
                return {
                    labels: [...state.labels, action.label],
                    undoStack: [...state.undoStack, action],
                    redoStack: newRedo,
                };
            case 'removeLabel':
                return {
                    labels: state.labels.filter(l => l.id !== action.label.id),
                    undoStack: [...state.undoStack, action],
                    redoStack: newRedo,
                };
            case 'addLine':
                return {
                    lines: [...state.lines, action.line],
                    undoStack: [...state.undoStack, action],
                    redoStack: newRedo,
                };
            case 'removeLine':
                return {
                    lines: state.lines.filter(l => l.id !== action.line.id),
                    undoStack: [...state.undoStack, action],
                    redoStack: newRedo,
                };
            default:
                return {};
        }
    }),

    pushAction: (action) => set(state => ({
        undoStack: [...state.undoStack, action],
        redoStack: [],
    })),

    // ─── Build Final Diagram ─────────────────────────────────────
    buildDiagram: () => {
        const state = get();
        const id = `custom-${generateId()}`;

        // Build polygons — recompute data points from image points using current calibration
        const hasTransform = state.calibration.affineTransform != null;
        const logX = state.calibration.logX;
        const logY = state.calibration.logY;

        const polygons = state.polygons.map(p => {
            let points: { x: number; y: number }[];

            if (p.imagePoints.length > 0 && hasTransform) {
                // Recompute from image points using CURRENT calibration
                // + subdivide for accurate log-axis rendering
                points = subdivideAndConvert(
                    p.imagePoints,
                    state.calibration.affineTransform!,
                    logX, logY,
                );
            } else {
                // Fallback for loaded diagrams with no image points
                points = p.dataPoints;
            }

            return {
                name: p.name,
                color: p.color,
                points: points.map(dp => ({ x: dp.x, y: dp.y })),
                visible: p.visible,
                ...(p.closed === false ? { closed: false } : {}),
                ...(p.smooth ? { smooth: true } : {}),
            };
        });

        // Build labels
        const labels = state.labels.map(l => {
            if (state.diagramType === 'ternary') {
                const fracs = imageToTernary(
                    l.imagePos,
                    state.calibration.ternaryVertices
                );
                return {
                    name: l.name,
                    a: fracs?.a ?? 33.3,
                    b: fracs?.b ?? 33.3,
                    angle: l.angle,
                    color: l.color,
                };
            }
            const pos = (l.imagePos.x !== 0 || l.imagePos.y !== 0) && hasTransform
                ? imageToData(l.imagePos, state.calibration.affineTransform!, logX, logY)
                : l.dataPos;
            return {
                name: l.name,
                x: pos.x,
                y: pos.y,
                angle: l.angle,
                color: l.color,
            };
        });

        // Build lines
        const lines = state.lines.map(l => ({
            name: l.name,
            slope: l.slope,
            intercept: l.intercept,
            color: l.color,
        }));

        // Compute bounds — prefer axis settings over data extent
        let bounds = undefined;
        if (state.diagramType === 'xy') {
            const xAxis = state.axes.x;
            const yAxis = state.axes.y;
            if (xAxis?.min != null && xAxis?.max != null && yAxis?.min != null && yAxis?.max != null) {
                // Use axis settings — these define the intended plot range
                bounds = { x: xAxis.min, y: yAxis.min, w: xAxis.max - xAxis.min, h: yAxis.max - yAxis.min };
            } else if (polygons.length > 0) {
                // Fallback to data extent
                const allX = polygons.flatMap(p => p.points.map(pt => pt.x));
                const allY = polygons.flatMap(p => p.points.map(pt => pt.y));
                bounds = { x: Math.min(...allX), y: Math.min(...allY),
                           w: Math.max(...allX) - Math.min(...allX),
                           h: Math.max(...allY) - Math.min(...allY) };
            }
        }

        const diagram: ClassificationDiagram = {
            id,
            name: state.diagramName,
            type: state.diagramType,
            category: state.category || 'Custom Diagrams',
            subCategory: state.subCategory || undefined,
            axes: {
                ...(state.axes.a ? { a: { name: state.axes.a.name, formula: state.axes.a.formula || undefined, log: state.axes.a.log || undefined } } : {}),
                ...(state.axes.b ? { b: { name: state.axes.b.name, formula: state.axes.b.formula || undefined, log: state.axes.b.log || undefined } } : {}),
                ...(state.axes.c ? { c: { name: state.axes.c.name, formula: state.axes.c.formula || undefined, log: state.axes.c.log || undefined } } : {}),
                ...(state.axes.x ? { x: { name: state.axes.x.name, formula: state.axes.x.formula || undefined, log: state.axes.x.log || undefined } } : {}),
                ...(state.axes.y ? { y: { name: state.axes.y.name, formula: state.axes.y.formula || undefined, log: state.axes.y.log || undefined } } : {}),
            },
            variables: state.variables.length > 0 ? state.variables.map(v => ({
                letter: v.letter,
                element: v.element,
                unit: v.unit,
            })) : undefined,
            polygons,
            lines: lines.length > 0 ? lines : undefined,
            labels: labels.length > 0 ? labels : undefined,
            bounds,
            comments: state.comments ? [state.comments] : undefined,
            references: state.references ? [state.references] : undefined,
        };

        return diagram;
    },

    // ─── Load Existing Diagram ───────────────────────────────────
    loadDiagramForEditing: (diagram) => {
        const axes: DiagramEditorState['axes'] = {};
        if (diagram.axes.a) axes.a = { name: diagram.axes.a.name, formula: diagram.axes.a.formula || '', log: diagram.axes.a.log || false };
        if (diagram.axes.b) axes.b = { name: diagram.axes.b.name, formula: diagram.axes.b.formula || '', log: diagram.axes.b.log || false };
        if (diagram.axes.c) axes.c = { name: diagram.axes.c.name, formula: diagram.axes.c.formula || '', log: diagram.axes.c.log || false };
        if (diagram.axes.x) axes.x = {
            name: diagram.axes.x.name, formula: diagram.axes.x.formula || '', log: diagram.axes.x.log || false,
            min: diagram.bounds ? diagram.bounds.x : undefined,
            max: diagram.bounds ? diagram.bounds.x + diagram.bounds.w : undefined,
        };
        if (diagram.axes.y) axes.y = {
            name: diagram.axes.y.name, formula: diagram.axes.y.formula || '', log: diagram.axes.y.log || false,
            min: diagram.bounds ? diagram.bounds.y : undefined,
            max: diagram.bounds ? diagram.bounds.y + diagram.bounds.h : undefined,
        };

        const polygons: EditorPolygon[] = diagram.polygons.map((p) => ({
            id: generateId(),
            name: p.name,
            color: p.color,
            imagePoints: [], // No image points available from existing diagrams
            dataPoints: p.points.map(pt => ({ x: pt.x, y: pt.y })),
            closed: p.closed !== false,
            visible: p.visible !== false,
            smooth: p.smooth || false,
        }));

        const labels: EditorLabel[] = (diagram.labels || []).map(l => ({
            id: generateId(),
            name: l.name,
            imagePos: { x: 0, y: 0 },
            dataPos: { x: l.x ?? 0, y: l.y ?? 0 },
            angle: l.angle,
            color: l.color,
        }));

        const lines: EditorLine[] = (diagram.lines || []).map(l => ({
            id: generateId(),
            name: l.name,
            slope: l.slope,
            intercept: l.intercept,
            color: l.color,
            imageStart: { x: 0, y: 0 },
            imageEnd: { x: 0, y: 0 },
        }));

        set({
            ...initialState,
            diagramName: diagram.name,
            diagramType: diagram.type,
            category: diagram.category,
            subCategory: diagram.subCategory || '',
            references: diagram.references?.join('\n') || '',
            comments: diagram.comments?.join('\n') || '',
            calibration: {
                ...initialCalibration(),
                logX: diagram.axes.x?.log || false,
                logY: diagram.axes.y?.log || false,
            },
            polygons,
            labels,
            lines,
            axes,
            variables: (diagram.variables || []).map(v => ({
                letter: v.letter,
                element: v.element,
                unit: v.unit,
            })),
            activeStep: 4, // Go to review step
        });
    },

    // ─── Reset ───────────────────────────────────────────────────
    reset: () => set(initialState),

    // ─── Validation ──────────────────────────────────────────────
    canProceedFromStep: (step) => {
        const state = get();
        switch (step) {
            case 0: { // Setup
                const hasName = state.diagramName.trim().length > 0;
                const hasImage = state.referenceImage !== null;
                if (state.diagramType === 'xy') {
                    const xAxis = state.axes.x;
                    const yAxis = state.axes.y;
                    const hasRanges = xAxis?.min != null && xAxis?.max != null
                                   && yAxis?.min != null && yAxis?.max != null;
                    return hasName && hasImage && hasRanges;
                }
                return hasName && hasImage;
            }
            case 1: // Calibrate
                return state.calibration.isCalibrated;
            case 2: // Draw Boundaries
                return state.polygons.length >= 1;
            case 3: // Labels & Lines (optional)
                return true;
            case 4: // Review
                return true;
            default:
                return false;
        }
    },
}));
