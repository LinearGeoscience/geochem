export interface ClassificationPolygon {
    name: string;
    x: number[];
    y: number[];
    color?: string;
}

export interface ClassificationDiagram {
    id: string;
    name: string;
    type: 'scatter' | 'ternary';
    xLabel?: string; // For scatter
    yLabel?: string; // For scatter
    polygons: ClassificationPolygon[];
}

export const TAS_DIAGRAM: ClassificationDiagram = {
    id: 'tas',
    name: 'Total Alkali Silica (TAS)',
    type: 'scatter',
    xLabel: 'SiO2',
    yLabel: 'Na2O + K2O',
    polygons: [
        {
            name: 'Foidite',
            x: [41, 41, 45, 49.4, 52.5, 45, 41],
            y: [7, 14, 14, 9.4, 5, 3, 7],
            color: '#A9A9A9'
        },
        {
            name: 'Basalt',
            x: [45, 52, 52, 45, 45],
            y: [0, 0, 5, 5, 0],
            color: '#BEBEBE'
        },
        // Simplified TAS polygons for demonstration
        {
            name: 'Andesite',
            x: [52, 57, 63, 52],
            y: [0, 0, 7, 5],
            color: '#D3D3D3'
        },
        {
            name: 'Rhyolite',
            x: [69, 77, 77, 69],
            y: [8, 8, 13, 8],
            color: '#E0E0E0'
        }
    ]
};

export const AFM_DIAGRAM: ClassificationDiagram = {
    id: 'afm',
    name: 'AFM (Irvine & Baragar 1971)',
    type: 'ternary',
    polygons: [
        {
            name: 'Tholeiitic',
            x: [0, 0.5, 1, 0], // Ternary coordinates need conversion usually, but Plotly handles a/b/c
            y: [0, 0.5, 0, 0],
            color: 'rgba(0,0,0,0)' // Just lines usually
        }
    ]
};

// Helper to get lines for Plotly
export const getDiagramShapes = (diagram: ClassificationDiagram) => {
    return diagram.polygons.map(poly => ({
        type: 'path',
        path: `M ${poly.x.map((x, i) => `${x},${poly.y[i]}`).join(' L ')} Z`,
        line: {
            color: 'black',
            width: 2
        },
        fillcolor: poly.color || 'rgba(0,0,0,0)',
        opacity: 0.5
    }));
};
