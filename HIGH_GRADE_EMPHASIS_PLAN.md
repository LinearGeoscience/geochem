# High Grade Emphasis Feature Plan

## Overview
A toggle feature that emphasizes high-grade values in plots by:
1. Making lower values more transparent (fade out)
2. Rendering higher values on top of lower values (z-ordering)
3. Optionally increasing size of high-grade points

This integrates with the Attribute Manager and works across all plot types.

## User Interface Design

### Location: Attribute Manager Toolbar
Add a new "Emphasis" section/button in the AttributeToolbar component:

```
┌─────────────────────────────────────────────┐
│ Attribute Manager                           │
├─────────────────────────────────────────────┤
│ [Color] [Shape] [Size] [Filter]             │
├─────────────────────────────────────────────┤
│ ... existing grid ...                       │
├─────────────────────────────────────────────┤
│ [+] [-]           [ALL] [GLOBAL]            │
├─────────────────────────────────────────────┤
│ ⚡ HIGH GRADE EMPHASIS  [Toggle Switch]     │  <-- NEW
│   Column: [Dropdown - numeric columns]      │
│   Mode: [Linear ▼] [Percentile ▼]          │
│   Threshold: [═══════●═══] 75%              │
│   Min Opacity: [═══●═════] 0.2              │
│   Boost Size: [checkbox] +50%               │
├─────────────────────────────────────────────┤
│ Field: [au_ppm_plot ▼]                      │
│ ...                                         │
└─────────────────────────────────────────────┘
```

### Controls

1. **Toggle Switch**: Enable/disable high grade emphasis
2. **Column Selector**: Which numeric column to use for emphasis (defaults to color field if numeric)
3. **Mode**:
   - Linear: Values scaled linearly between min/max
   - Percentile: Based on percentile ranking
4. **Threshold**: Values above this become fully emphasized (0-100%)
5. **Min Opacity**: How transparent the lowest values become (0.1-0.5 range)
6. **Boost Size**: Optionally increase size of high-grade points

## Technical Implementation

### 1. Store Changes (attributeStore.ts)

Add new state to the attribute store:

```typescript
interface EmphasisConfig {
    enabled: boolean;
    column: string | null;        // Column to use for emphasis
    mode: 'linear' | 'percentile';
    threshold: number;            // 0-100, values above this are fully emphasized
    minOpacity: number;           // 0.1-0.5, opacity for lowest values
    boostSize: boolean;           // Whether to increase high-grade point sizes
    sizeBoostFactor: number;      // 1.5 = 50% bigger
}

// Add to AttributeState:
emphasis: EmphasisConfig;

// Add actions:
setEmphasisEnabled: (enabled: boolean) => void;
setEmphasisColumn: (column: string | null) => void;
setEmphasisMode: (mode: 'linear' | 'percentile') => void;
setEmphasisThreshold: (threshold: number) => void;
setEmphasisMinOpacity: (opacity: number) => void;
setEmphasisBoostSize: (boost: boolean) => void;
```

### 2. New Utility Functions (emphasisUtils.ts)

```typescript
interface EmphasisResult {
    opacity: number;      // 0.1 to 1.0
    sizeMultiplier: number; // 1.0 to 1.5
    zIndex: number;       // For sorting - higher values = render last (on top)
}

/**
 * Calculate emphasis values for each data point
 */
export function calculateEmphasis(
    data: Record<string, any>[],
    config: EmphasisConfig
): EmphasisResult[] {
    if (!config.enabled || !config.column) {
        return data.map(() => ({ opacity: 1, sizeMultiplier: 1, zIndex: 0 }));
    }

    // Extract numeric values
    const values = data.map(d => {
        const v = d[config.column!];
        return v != null && !isNaN(Number(v)) ? Number(v) : null;
    });

    // Calculate percentile rankings or linear scaling
    const rankings = config.mode === 'percentile'
        ? calculatePercentileRanks(values)
        : calculateLinearRanks(values);

    // Apply threshold and calculate final emphasis
    return rankings.map((rank, i) => {
        if (rank === null) {
            return { opacity: config.minOpacity, sizeMultiplier: 1, zIndex: 0 };
        }

        // Convert rank (0-100) to emphasis (0-1)
        const thresholdNorm = config.threshold / 100;
        let emphasis: number;

        if (rank >= thresholdNorm) {
            emphasis = 1; // Full emphasis above threshold
        } else {
            // Scale from minOpacity to 1 based on rank vs threshold
            emphasis = config.minOpacity + (1 - config.minOpacity) * (rank / thresholdNorm);
        }

        return {
            opacity: emphasis,
            sizeMultiplier: config.boostSize && rank >= thresholdNorm
                ? config.sizeBoostFactor
                : 1,
            zIndex: rank * 1000 // Higher values = render on top
        };
    });
}

function calculatePercentileRanks(values: (number | null)[]): (number | null)[] {
    const validValues = values.filter(v => v !== null) as number[];
    const sorted = [...validValues].sort((a, b) => a - b);

    return values.map(v => {
        if (v === null) return null;
        const idx = sorted.findIndex(sv => sv >= v);
        return idx / sorted.length;
    });
}

function calculateLinearRanks(values: (number | null)[]): (number | null)[] {
    const validValues = values.filter(v => v !== null) as number[];
    const min = Math.min(...validValues);
    const max = Math.max(...validValues);
    const range = max - min;

    return values.map(v => {
        if (v === null || range === 0) return null;
        return (v - min) / range;
    });
}
```

### 3. Update getStyleArrays (attributeUtils.ts)

Modify the existing `getStyleArrays` function to incorporate emphasis:

```typescript
export function getStyleArrays(data: Record<string, any>[]) {
    const attributeStore = useAttributeStore.getState();

    // ... existing color, shape, size, visibility logic ...

    // Apply emphasis if enabled
    const emphasisResults = calculateEmphasis(data, attributeStore.emphasis);

    // Modify opacity based on emphasis
    const finalOpacity = emphasisResults.map((e, i) =>
        baseOpacity[i] * e.opacity
    );

    // Modify sizes based on emphasis
    const finalSizes = emphasisResults.map((e, i) =>
        baseSizes[i] * e.sizeMultiplier
    );

    return {
        colors,
        shapes,
        sizes: finalSizes,
        opacity: finalOpacity,  // NEW - per-point opacity
        visible,
        zIndices: emphasisResults.map(e => e.zIndex) // NEW - for sorting
    };
}
```

### 4. Update Plot Components

Each plot component needs to:

#### A. Apply per-point opacity
```typescript
// In ScatterPlot, TernaryPlot, etc.
const styleArrays = getStyleArrays(data);

// Sort data by zIndex (low to high) so high grades render on top
const sortedIndices = [...Array(data.length).keys()]
    .filter(i => styleArrays.visible[i])
    .sort((a, b) => styleArrays.zIndices[a] - styleArrays.zIndices[b]);

const trace = {
    x: sortedIndices.map(i => data[i][xAxis]),
    y: sortedIndices.map(i => data[i][yAxis]),
    marker: {
        color: sortedIndices.map(i => styleArrays.colors[i]),
        size: sortedIndices.map(i => styleArrays.sizes[i]),
        opacity: sortedIndices.map(i => styleArrays.opacity[i]), // Per-point opacity
        // ...
    }
};
```

#### B. For Plotly, use RGBA colors with opacity baked in
```typescript
// Convert hex + opacity to rgba
function applyOpacityToColor(hexColor: string, opacity: number): string {
    const r = parseInt(hexColor.slice(1, 3), 16);
    const g = parseInt(hexColor.slice(3, 5), 16);
    const b = parseInt(hexColor.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${opacity})`;
}

// Apply to colors array
const colorsWithOpacity = sortedIndices.map(i =>
    applyOpacityToColor(styleArrays.colors[i], styleArrays.opacity[i])
);
```

### 5. New UI Component (EmphasisControls.tsx)

```typescript
export const EmphasisControls: React.FC = () => {
    const {
        emphasis,
        setEmphasisEnabled,
        setEmphasisColumn,
        setEmphasisMode,
        setEmphasisThreshold,
        setEmphasisMinOpacity,
        setEmphasisBoostSize
    } = useAttributeStore();

    const { columns } = useAppStore();
    const numericColumns = columns.filter(c =>
        c.type === 'numeric' || c.type === 'float' || c.type === 'integer'
    );

    return (
        <Box sx={{ p: 1, borderTop: '1px solid', borderColor: 'divider' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <TrendingUp fontSize="small" />
                    High Grade Emphasis
                </Typography>
                <Switch
                    checked={emphasis.enabled}
                    onChange={(e) => setEmphasisEnabled(e.target.checked)}
                    size="small"
                />
            </Box>

            {emphasis.enabled && (
                <Stack spacing={1.5}>
                    <FormControl size="small" fullWidth>
                        <InputLabel>Column</InputLabel>
                        <Select
                            value={emphasis.column || ''}
                            onChange={(e) => setEmphasisColumn(e.target.value || null)}
                            label="Column"
                        >
                            {numericColumns.map(col => (
                                <MenuItem key={col.name} value={col.name}>
                                    {col.alias || col.name}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>

                    <ToggleButtonGroup
                        value={emphasis.mode}
                        exclusive
                        onChange={(_, v) => v && setEmphasisMode(v)}
                        size="small"
                        fullWidth
                    >
                        <ToggleButton value="percentile">Percentile</ToggleButton>
                        <ToggleButton value="linear">Linear</ToggleButton>
                    </ToggleButtonGroup>

                    <Box>
                        <Typography variant="caption">
                            Emphasis Threshold: {emphasis.threshold}%
                        </Typography>
                        <Slider
                            value={emphasis.threshold}
                            onChange={(_, v) => setEmphasisThreshold(v as number)}
                            min={50}
                            max={99}
                            size="small"
                        />
                    </Box>

                    <Box>
                        <Typography variant="caption">
                            Min Opacity: {(emphasis.minOpacity * 100).toFixed(0)}%
                        </Typography>
                        <Slider
                            value={emphasis.minOpacity}
                            onChange={(_, v) => setEmphasisMinOpacity(v as number)}
                            min={0.05}
                            max={0.5}
                            step={0.05}
                            size="small"
                        />
                    </Box>

                    <FormControlLabel
                        control={
                            <Checkbox
                                checked={emphasis.boostSize}
                                onChange={(e) => setEmphasisBoostSize(e.target.checked)}
                                size="small"
                            />
                        }
                        label={<Typography variant="caption">Boost high-grade size (+50%)</Typography>}
                    />
                </Stack>
            )}
        </Box>
    );
};
```

## Files to Modify

1. **`store/attributeStore.ts`** - Add emphasis state and actions
2. **`utils/emphasisUtils.ts`** - NEW - Emphasis calculation functions
3. **`utils/attributeUtils.ts`** - Update getStyleArrays to include emphasis
4. **`components/AttributeManager/EmphasisControls.tsx`** - NEW - UI controls
5. **`components/AttributeManager/AttributeManager.tsx`** - Add EmphasisControls
6. **`features/plots/ScatterPlot.tsx`** - Apply emphasis + z-ordering
7. **`features/plots/TernaryPlot.tsx`** - Apply emphasis + z-ordering
8. **`features/plots/AttributeMap.tsx`** - Apply emphasis + z-ordering
9. **`features/plots/AttributeMap3D.tsx`** - Apply emphasis + z-ordering
10. **`features/plots/SpiderPlot.tsx`** - Apply emphasis to line opacity
11. **`features/analysis/ProbabilityPlot.tsx`** - Apply emphasis

## Implementation Order

1. Add emphasis config to attributeStore
2. Create emphasisUtils.ts with calculation functions
3. Update attributeUtils.ts getStyleArrays
4. Create EmphasisControls.tsx UI component
5. Add EmphasisControls to AttributeManager
6. Update ScatterPlot first (main plot type)
7. Update remaining plot components
8. Test and refine

## Visual Example

**Before (emphasis OFF):**
```
All points same opacity, overlapping randomly
   ●  ●     ●
 ●    ●  ●     ●
   ●     ●  ●
```

**After (emphasis ON, threshold 75%):**
```
Low values faded (20% opacity), high values bold and on top
   ○  ●     ○
 ○    ●  ●     ○   (● = high grade, bold, on top)
   ○     ●  ○      (○ = low grade, faded, behind)
```

## Alternative Quick Implementation

If full implementation is too complex, a simpler "Quick Emphasis" could:

1. Just add a single toggle button
2. Auto-detect the color column (if numeric)
3. Apply fixed settings: threshold=75%, minOpacity=0.2, boostSize=true
4. Sort data by value before plotting

This would be ~50 lines of code changes vs the full featured version.
