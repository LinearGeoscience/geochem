export interface AttributeState {
    colorBy: string | null;
    shapeBy: string | null;
    sizeBy: string | null;

    // Advanced Attribute State
    colorMap: Record<string, string>;
    shapeMap: Record<string, string>;
    visibilityMap: Record<string, boolean>;

    // Numeric Color State
    colorPalette: string;
    colorRange: [number, number] | null; // [min, max]

    setColorBy: (column: string | null) => void;
    setShapeBy: (column: string | null) => void;
    setSizeBy: (column: string | null) => void;

    updateColorMap: (value: string, color: string) => void;
    updateShapeMap: (value: string, shape: string) => void;
    toggleVisibility: (value: string) => void;
    setAllVisibility: (visible: boolean) => void;

    setColorPalette: (palette: string) => void;
    setColorRange: (range: [number, number] | null) => void;
}

export const createAttributeSlice = (set: any, _get?: any, _api?: any) => ({
    colorBy: null,
    shapeBy: null,
    sizeBy: null,

    colorMap: {},
    shapeMap: {},
    visibilityMap: {},

    colorPalette: 'Viridis',
    colorRange: null,

    setColorBy: (column: string | null) => set({ colorBy: column }),
    setShapeBy: (column: string | null) => set({ shapeBy: column }),
    setSizeBy: (column: string | null) => set({ sizeBy: column }),

    updateColorMap: (value: string, color: string) => set((state: any) => ({
        colorMap: { ...state.colorMap, [value]: color }
    })),

    updateShapeMap: (value: string, shape: string) => set((state: any) => ({
        shapeMap: { ...state.shapeMap, [value]: shape }
    })),

    toggleVisibility: (value: string) => set((state: any) => ({
        visibilityMap: { ...state.visibilityMap, [value]: state.visibilityMap[value] === false ? true : false }
    })),

    setAllVisibility: (visible: boolean) => set((state: any) => {
        // This is tricky because we need the values. 
        // Ideally we reset the map or set a global flag. 
        // For now, let's just clear the map (all visible) if visible=true
        if (visible) return { visibilityMap: {} };
        return { visibilityMap: state.visibilityMap }; // TODO: Implement hide all
    }),

    setColorPalette: (palette: string) => set({ colorPalette: palette }),
    setColorRange: (range: [number, number] | null) => set({ colorRange: range }),
});
