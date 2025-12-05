// Color palette definitions for geochemical data visualization
// Inspired by ioGAS, matplotlib, and scientific visualization best practices

export interface ColorPalette {
    name: string;
    colors: string[];
    type: 'sequential' | 'diverging' | 'categorical';
    description?: string;
}

export const COLOR_PALETTES: ColorPalette[] = [
    // Sequential - Single Hue
    {
        name: 'Jet',
        type: 'sequential',
        description: 'Classic rainbow colormap',
        colors: ['#00007F', '#0000FF', '#0080FF', '#00FFFF', '#80FF80', '#FFFF00', '#FF8000', '#FF0000', '#7F0000']
    },
    {
        name: 'Viridis',
        type: 'sequential',
        description: 'Perceptually uniform, colorblind-friendly',
        colors: ['#440154', '#482878', '#3E4A89', '#31688E', '#26828E', '#1F9E89', '#35B779', '#6DCD59', '#B4DE2C', '#FDE724']
    },
    {
        name: 'Plasma',
        type: 'sequential',
        description: 'Perceptually uniform purple-yellow',
        colors: ['#0D0887', '#46039F', '#7201A8', '#9C179E', '#BD3786', '#D8576B', '#ED7953', '#FB9F3A', '#FDCA26', '#F0F921']
    },
    {
        name: 'Inferno',
        type: 'sequential',
        description: 'Perceptually uniform black-yellow',
        colors: ['#000004', '#1B0C41', '#4A0C6B', '#781C6D', '#A52C60', '#CF4446', '#ED6925', '#FB9A06', '#F7D03C', '#FCFFA4']
    },
    {
        name: 'Magma',
        type: 'sequential',
        description: 'Perceptually uniform black-white',
        colors: ['#000004', '#180F3D', '#451077', '#721F81', '#9F2F7F', '#CD4071', '#F1605D', '#FD9668', '#FEC287', '#FCFDBF']
    },
    {
        name: 'Hot',
        type: 'sequential',
        description: 'Black-red-yellow-white heat map',
        colors: ['#000000', '#8B0000', '#FF0000', '#FF8C00', '#FFD700', '#FFFF00', '#FFFFFF']
    },
    {
        name: 'Cool',
        type: 'sequential',
        description: 'Cyan-magenta',
        colors: ['#00FFFF', '#33CCFF', '#6699FF', '#9966FF', '#CC33FF', '#FF00FF']
    },
    {
        name: 'Rainbow',
        type: 'sequential',
        description: 'Full spectrum',
        colors: ['#9400D3', '#4B0082', '#0000FF', '#00FF00', '#FFFF00', '#FF7F00', '#FF0000']
    },
    {
        name: 'Turbo',
        type: 'sequential',
        description: 'Improved rainbow',
        colors: ['#30123B', '#4777EF', '#1AC7FF', '#28ED8C', '#A1FC3C', '#F3CA02', '#E85B00', '#A6003E']
    },

    // Earth Sciences Specific
    {
        name: 'Earth',
        type: 'sequential',
        description: 'Blue-green-brown for elevations',
        colors: ['#0000A0', '#0080FF', '#00E0E0', '#80FF80', '#FFE000', '#FFA000', '#804020', '#FFFFFF']
    },
    {
        name: 'Topo',
        type: 'sequential',
        description: 'Topographic',
        colors: ['#1A237E', '#0D47A1', '#01579B', '#006064', '#004D40', '#1B5E20', '#827717', '#F57F17', '#E65100']
    },
    {
        name: 'Ocean',
        type: 'sequential',
        description: 'Deep to shallow water',
        colors: ['#000033', '#000066', '#0033CC', '#0066FF', '#3399FF', '#66CCFF', '#99FFFF']
    },

    // Diverging
    {
        name: 'RdBu',
        type: 'diverging',
        description: 'Red-blue diverging',
        colors: ['#67001F', '#B2182B', '#D6604D', '#F4A582', '#FDDBC7', '#FFFFFF', '#D1E5F0', '#92C5DE', '#4393C3', '#2166AC', '#053061']
    },
    {
        name: 'RdYlGn',
        type: 'diverging',
        description: 'Red-yellow-green',
        colors: ['#A50026', '#D73027', '#F46D43', '#FDAE61', '#FEE08B', '#FFFFBF', '#D9EF8B', '#A6D96A', '#66BD63', '#1A9850', '#006837']
    },
    {
        name: 'BrBG',
        type: 'diverging',
        description: 'Brown-blue-green',
        colors: ['#543005', '#8C510A', '#BF812D', '#DFC27D', '#F6E8C3', '#F5F5F5', '#C7EAE5', '#80CDC1', '#35978F', '#01665E', '#003C30']
    },
    {
        name: 'PiYG',
        type: 'diverging',
        description: 'Pink-yellow-green',
        colors: ['#8E0152', '#C51B7D', '#DE77AE', '#F1B6DA', '#FDE0EF', '#F7F7F7', '#E6F5D0', '#B8E186', '#7FBC41', '#4D9221', '#276419']
    },

    // Categorical (for discrete data)
    {
        name: 'Category10',
        type: 'categorical',
        description: 'Distinct colors for categories',
        colors: ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf']
    },
    {
        name: 'Category20',
        type: 'categorical',
        description: '20 distinct colors',
        colors: [
            '#1f77b4', '#aec7e8', '#ff7f0e', '#ffbb78', '#2ca02c', '#98df8a',
            '#d62728', '#ff9896', '#9467bd', '#c5b0d5', '#8c564b', '#c49c94',
            '#e377c2', '#f7b6d2', '#7f7f7f', '#c7c7c7', '#bcbd22', '#dbdb8d',
            '#17becf', '#9edae5'
        ]
    },
    {
        name: 'Pastel',
        type: 'categorical',
        description: 'Soft pastel colors',
        colors: ['#FBB4AE', '#B3CDE3', '#CCEBC5', '#DECBE4', '#FED9A6', '#FFFFCC', '#E5D8BD', '#FDDAEC', '#F2F2F2']
    },
    {
        name: 'Set1',
        type: 'categorical',
        description: 'Bold distinct colors',
        colors: ['#E41A1C', '#377EB8', '#4DAF4A', '#984EA3', '#FF7F00', '#FFFF33', '#A65628', '#F781BF', '#999999']
    },

    // Grayscale
    {
        name: 'Grays',
        type: 'sequential',
        description: 'Black to white',
        colors: ['#000000', '#262626', '#4D4D4D', '#737373', '#999999', '#BFBFBF', '#E5E5E5', '#FFFFFF']
    },

    // Custom geological
    {
        name: 'Copper',
        type: 'sequential',
        description: 'For copper mineralization',
        colors: ['#000000', '#2D1B00', '#5C3A00', '#8B5A00', '#BA7A00', '#E89B00', '#FFBB00', '#FFD966']
    },
    {
        name: 'Gold',
        type: 'sequential',
        description: 'For gold mineralization',
        colors: ['#1A1A00', '#333300', '#666600', '#999900', '#CCCC00', '#FFFF00', '#FFFF66', '#FFFFCC']
    }
];

// Get palette by name
export function getPalette(name: string): ColorPalette | undefined {
    return COLOR_PALETTES.find(p => p.name === name);
}

// Generate colors from palette for N classes
export function generateColorsFromPalette(paletteName: string, numColors: number): string[] {
    const palette = getPalette(paletteName);
    if (!palette) return [];

    const colors = palette.colors;
    if (numColors <= colors.length) {
        // Subsample evenly
        const indices = Array.from({ length: numColors }, (_, i) =>
            Math.floor(i * (colors.length / numColors))
        );
        return indices.map(i => colors[i]);
    } else {
        // Interpolate if we need more colors
        return interpolateColors(colors, numColors);
    }
}

// Simple color interpolation
function interpolateColors(colors: string[], numColors: number): string[] {
    const result: string[] = [];
    const step = (colors.length - 1) / (numColors - 1);

    for (let i = 0; i < numColors; i++) {
        const index = i * step;
        const lower = Math.floor(index);
        const upper = Math.ceil(index);
        const t = index - lower;

        if (t === 0) {
            result.push(colors[lower]);
        } else {
            result.push(interpolateColor(colors[lower], colors[upper], t));
        }
    }

    return result;
}

function interpolateColor(color1: string, color2: string, t: number): string {
    const r1 = parseInt(color1.slice(1, 3), 16);
    const g1 = parseInt(color1.slice(3, 5), 16);
    const b1 = parseInt(color1.slice(5, 7), 16);

    const r2 = parseInt(color2.slice(1, 3), 16);
    const g2 = parseInt(color2.slice(3, 5), 16);
    const b2 = parseInt(color2.slice(5, 7), 16);

    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);

    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// Plotly colorscale format
export function getPaletteForPlotly(paletteName: string): string | any[] {
    const palette = getPalette(paletteName);
    if (!palette) return 'Viridis';

    const colors = palette.colors;
    return colors.map((color, i) => [i / (colors.length - 1), color]);
}
