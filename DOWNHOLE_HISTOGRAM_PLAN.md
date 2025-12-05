# Downhole Plot Enhancement & Histogram Implementation Plan

## Overview

This plan covers two main areas:
1. **New Histogram Plot Type** - Add histogram capability to the application
2. **Enhanced Downhole Plot** - Major improvements to the downhole/strip log visualization

---

## Part 1: Histogram Plot

### 1.1 Feature Description
Add a new "HISTOGRAM" plot type that displays distribution of selected numeric columns.

### 1.2 Implementation

**File: `frontend/src/features/plots/HistogramPlot.tsx`** (NEW)

```typescript
interface HistogramPlotProps {}

Features:
- Multi-column selector for numeric attributes
- Configurable bin count (slider: 10-100)
- Overlay mode toggle (stack vs overlay histograms)
- Optional density curve overlay
- Color by attribute store categories
- Grid layout for multiple histograms
```

**UI Layout:**
```
┌─────────────────────────────────────────────────────────────┐
│ Select Columns: [Au_ppm ▼] [As_ppm ▼] [Cu_ppm ▼]           │
│ Bins: [====●====] 30    □ Overlay Mode   □ Show Density    │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Au_ppm     │  │   As_ppm     │  │   Cu_ppm     │      │
│  │  ▐▌▐▌▐▌▐▌   │  │ ▐▌▐▌▐▌▐▌▐▌  │  │  ▐▌▐▌▐▌▐▌   │      │
│  │ ▐▌▐▌▐▌▐▌▐▌▐▌│  │▐▌▐▌▐▌▐▌▐▌▐▌▐▌│  │ ▐▌▐▌▐▌▐▌▐▌▐▌│      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

### 1.3 Files to Modify

1. **`frontend/src/features/plots/HistogramPlot.tsx`** - NEW
2. **`frontend/src/features/plots/PlotManager.tsx`** - Add HISTOGRAM button
3. **`frontend/src/store/appStore.ts`** - Add 'histogram' to PlotType union
4. **`frontend/src/features/plots/PlotArea.tsx`** - Add HistogramPlot case

---

## Part 2: Enhanced Downhole Plot

### 2.1 Current State
- Single drillhole selection
- Numeric tracks only, each in separate column
- Wide layout (800px height)
- No lithology/category tracks
- No multi-line per track option

### 2.2 New Features Required

#### Feature A: Narrower Default Graph Width
- Reduce default track width from current wide layout
- Each track approximately 80-120px wide
- Better utilizes screen space for multiple tracks

#### Feature B: Multiple Drillhole Selection
- Change from single Select to MultiColumnSelector-style component
- Each drillhole rendered in its own row
- Vertical stacking of hole plots

#### Feature C: Multi-Line Per Track (Overlay Mode)
- Checkbox: "Overlay fields on same track"
- When enabled, selected numeric fields plot as separate colored lines on ONE graph per hole
- Clear legend showing field names and colors
- Each line has distinct color from a palette

#### Feature D: Field Scaling
- Per-field scaling options for numeric data
- Options: "Auto", "0 to Max", "Min to Max", "Log Scale", "Custom"
- Allows comparing fields with different ranges on same track

#### Feature E: Category/Lithology Track
- Detect non-numeric categorical columns
- Plot as colored vertical bar along the side (like screenshot)
- Each category value gets a distinct color
- Width approximately 20-30px
- Shows transitions down the hole

#### Feature F: Legend Display
- When overlay mode enabled, show legend
- Legend shows: Line color + Field name
- For lithology tracks: Color swatch + Category name

### 2.3 Visual Design

**New Layout - Multiple Holes, Overlay Mode:**
```
┌───────────────────────────────────────────────────────────────────────────┐
│ Drillholes: [XYZ1073 ✓] [XYZ1074 ✓] [ABC001 □]    Fields: [Au ✓] [As ✓]  │
│ Category Track: [Lithology ▼]   □ Overlay Fields   Scaling: [Auto ▼]     │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  XYZ1073                                           LEGEND                 │
│  ┌────┬────────────────────────────────────────┐  ┌─────────────────┐    │
│  │Lith│         Au_ppm / As_ppm                │  │ ── Au_ppm       │    │
│  │████│    ╱╲                                  │  │ ── As_ppm       │    │
│  │████│   ╱  ╲    ╱╲                           │  │                 │    │
│  │████│  ╱    ╲  ╱  ╲                          │  │ ■ Granite       │    │
│  │████│ ╱      ╲╱    ╲                         │  │ ■ Schist        │    │
│  │████│╱              ╲                        │  │ ■ Sandstone     │    │
│  │░░░░│                ╲  ╱╲                   │  └─────────────────┘    │
│  │░░░░│                 ╲╱  ╲                  │                          │
│  │░░░░│                      ╲                 │                          │
│  └────┴────────────────────────────────────────┘                          │
│   Depth                                                                   │
│                                                                           │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  XYZ1074                                                                  │
│  ┌────┬────────────────────────────────────────┐                          │
│  │Lith│         Au_ppm / As_ppm                │                          │
│  │████│      ╱╲                                │                          │
│  │████│     ╱  ╲                               │                          │
│  │░░░░│    ╱    ╲                              │                          │
│  │░░░░│   ╱      ╲                             │                          │
│  └────┴────────────────────────────────────────┘                          │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

**Non-Overlay Mode (Original Style but Narrower):**
```
┌───────────────────────────────────────────────────────────────────────────┐
│  XYZ1073                                                                  │
│  ┌────┬─────────┬─────────┬─────────┬─────────┐                          │
│  │Lith│ Au_ppm  │ As_ppm  │ Sb_ppm  │ Cu_ppm  │                          │
│  │████│  ╱╲     │    ╱╲   │   ╱╲    │  ╱╲     │                          │
│  │████│ ╱  ╲    │   ╱  ╲  │  ╱  ╲   │ ╱  ╲    │                          │
│  │████│╱    ╲   │  ╱    ╲ │ ╱    ╲  │╱    ╲   │                          │
│  │░░░░│      ╲  │ ╱      ╲│╱      ╲ │      ╲  │                          │
│  │░░░░│       ╲ │╱        │        ╲│       ╲ │                          │
│  └────┴─────────┴─────────┴─────────┴─────────┘                          │
└───────────────────────────────────────────────────────────────────────────┘
```

### 2.4 State Management

```typescript
interface DownholePlotState {
    // Selections
    selectedHoles: string[];              // Multiple holes
    selectedNumericFields: string[];      // Numeric columns to plot
    selectedCategoryField: string | null; // Lithology/category column

    // Display Options
    overlayMode: boolean;                 // True = multi-line on one track
    showLegend: boolean;                  // Show/hide legend

    // Scaling
    scalingMode: 'auto' | 'zeroMax' | 'minMax' | 'log' | 'custom';
    customScaleMin?: number;
    customScaleMax?: number;

    // Layout
    trackWidth: number;                   // Default 100px
    plotHeight: number;                   // Per-hole height, default 400px
}
```

### 2.5 Component Structure

```
DownholePlot/
├── DownholePlot.tsx          (Main container)
├── DownholeControls.tsx      (Selection controls)
├── DownholeHoleView.tsx      (Single hole plot component)
├── DownholeLithologyTrack.tsx (Category bar component)
├── DownholeLegend.tsx        (Legend component)
└── downholeUtils.ts          (Scaling, color utilities)
```

### 2.6 Detailed Implementation Steps

#### Step 1: Update State & Controls
- Add new state variables for multi-selection
- Replace single Select with checkbox list for holes
- Add overlay mode checkbox
- Add category field selector
- Add scaling mode dropdown

#### Step 2: Lithology/Category Track Component
```typescript
interface LithologyTrackProps {
    data: { depth: number; category: string }[];
    categories: string[];
    colorMap: Record<string, string>;
    height: number;
}
```
- Renders as SVG or Canvas
- Each category gets a color from palette
- Transitions rendered as rectangles at depth intervals

#### Step 3: Multi-Hole Layout
- Map over `selectedHoles`
- Each hole gets its own Paper/container
- Stacked vertically with spacing
- Shared legend if overlayMode enabled

#### Step 4: Overlay Mode Implementation
```typescript
// When overlayMode = true
const overlayTraces = selectedNumericFields.map((field, i) => ({
    x: holeData.map(d => d[field]),
    y: holeData.map(d => d[depthCol]),
    type: 'scatter',
    mode: 'lines+markers',
    name: field,
    line: { color: PALETTE[i % PALETTE.length], width: 2 },
    marker: { size: 4, color: PALETTE[i % PALETTE.length] }
}));
```

#### Step 5: Field Scaling
```typescript
function scaleValues(values: number[], mode: ScalingMode): { scaled: number[], domain: [number, number] } {
    switch (mode) {
        case 'auto':
            return { scaled: values, domain: [Math.min(...values), Math.max(...values)] };
        case 'zeroMax':
            return { scaled: values, domain: [0, Math.max(...values)] };
        case 'log':
            return { scaled: values.map(v => Math.log10(Math.max(v, 0.001))), domain: [...] };
        case 'custom':
            return { scaled: values, domain: [customMin, customMax] };
    }
}
```

#### Step 6: Legend Component
```typescript
interface LegendProps {
    numericFields: { name: string; color: string }[];
    categories?: { name: string; color: string }[];
}
```
- Positioned to right of plot
- Line samples for numeric fields
- Color swatches for categories

### 2.7 Color Palette for Multi-Line

```typescript
const DOWNHOLE_PALETTE = [
    '#1f77b4', // Blue
    '#ff7f0e', // Orange
    '#2ca02c', // Green
    '#d62728', // Red
    '#9467bd', // Purple
    '#8c564b', // Brown
    '#e377c2', // Pink
    '#7f7f7f', // Gray
    '#bcbd22', // Yellow-green
    '#17becf', // Cyan
];

const LITHOLOGY_PALETTE = [
    '#4CAF50', // Green
    '#FF9800', // Orange
    '#F44336', // Red
    '#2196F3', // Blue
    '#9C27B0', // Purple
    '#795548', // Brown
    '#607D8B', // Gray-blue
    '#FFEB3B', // Yellow
];
```

---

## Part 3: Implementation Order

### Phase 1: Histogram Plot (Simpler, Self-Contained)
1. Create HistogramPlot.tsx
2. Add to PlotManager
3. Add to PlotArea switch
4. Test with sample data

### Phase 2: Downhole Basic Improvements
1. Reduce default track width
2. Implement multi-hole selection
3. Add stacked layout for multiple holes

### Phase 3: Overlay Mode
1. Add overlay checkbox
2. Implement multi-line traces
3. Add legend component
4. Test with 2-4 fields

### Phase 4: Lithology Track
1. Detect categorical columns
2. Create LithologyTrack component
3. Integrate into plot layout
4. Add to legend

### Phase 5: Scaling Options
1. Add scaling mode selector
2. Implement scaling functions
3. Apply to overlay traces
4. Test log scale with geochemistry data

---

## Part 4: File Changes Summary

### New Files
- `frontend/src/features/plots/HistogramPlot.tsx`
- `frontend/src/features/plots/downhole/DownholeControls.tsx`
- `frontend/src/features/plots/downhole/DownholeHoleView.tsx`
- `frontend/src/features/plots/downhole/LithologyTrack.tsx`
- `frontend/src/features/plots/downhole/DownholeLegend.tsx`
- `frontend/src/features/plots/downhole/downholeUtils.ts`

### Modified Files
- `frontend/src/features/plots/DownholePlot.tsx` - Major refactor
- `frontend/src/features/plots/PlotManager.tsx` - Add histogram button
- `frontend/src/store/appStore.ts` - Add 'histogram' type
- `frontend/src/features/plots/PlotArea.tsx` - Add histogram case

---

## Part 5: Testing Checklist

### Histogram
- [ ] Single column histogram displays correctly
- [ ] Multiple columns in grid layout
- [ ] Bin count slider works
- [ ] Overlay mode stacks histograms
- [ ] Colors respect attribute store

### Downhole
- [ ] Multiple holes can be selected
- [ ] Each hole renders in separate row
- [ ] Overlay mode shows multi-line on same track
- [ ] Legend displays correctly
- [ ] Lithology track shows category colors
- [ ] Scaling options work (auto, log, etc.)
- [ ] Track width is appropriately narrow
- [ ] Performance acceptable with 3+ holes

---

## Appendix: Screenshot Analysis

From the provided screenshot, the lithology track shows:
- Green bars (top/shallow): Possibly oxidized/weathered zone
- Orange bars (middle): Transition zone
- Red bars (deeper): Fresh/unweathered rock

This color coding appears based on a categorical column (likely Lithology or Alteration) with distinct colors per category value. The implementation should:
1. Automatically assign colors to unique category values
2. Render continuous blocks where category doesn't change
3. Show color legend for category meanings
