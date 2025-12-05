# 3D Map Axis Range Sliders Plan

## Overview
Add double-sided range sliders for X, Y, and Z axes on the 3D Attribute Map, allowing users to zoom into areas of interest by constraining the visible data range on each axis.

## User Interface Design

### Location: Below the 3D Plot
```
┌─────────────────────────────────────────────────────────┐
│                    3D Attribute Map                      │
│                                                          │
│                   [3D Plot Area]                         │
│                                                          │
├─────────────────────────────────────────────────────────┤
│  X Range: [123.45] ═══●════════════●═══ [789.01]        │
│  Y Range: [234.56] ═══●════════════●═══ [890.12]        │
│  Z Range: [-50.00] ═══●════════════●═══ [150.00]        │
│                                    [Reset All]           │
└─────────────────────────────────────────────────────────┘
```

### Controls for Each Axis
1. **Label**: "X Range:", "Y Range:", "Z Range:"
2. **Min Value Input**: Editable number field showing current minimum
3. **Range Slider**: Double-handled slider for selecting range
4. **Max Value Input**: Editable number field showing current maximum
5. **Reset Button**: Per-axis reset to full data range (optional)

### Additional Controls
- **Reset All Button**: Reset all three axes to full data range
- **Collapse/Expand**: Option to hide sliders when not needed

## Technical Implementation

### 1. State Management

Add axis range state to either:
- A) Local component state in AttributeMap3D.tsx (simpler)
- B) appStore.ts (if ranges should persist/be shared)

```typescript
interface AxisRange {
    min: number;
    max: number;
}

interface AxisRangeState {
    x: AxisRange;
    y: AxisRange;
    z: AxisRange;
    dataRanges: {
        x: AxisRange;
        y: AxisRange;
        z: AxisRange;
    };
}
```

### 2. New Component: AxisRangeSlider.tsx

```typescript
interface AxisRangeSliderProps {
    label: string;           // "X", "Y", or "Z"
    value: [number, number]; // [min, max]
    dataRange: [number, number]; // Full data range for this axis
    onChange: (value: [number, number]) => void;
    onReset?: () => void;
}

export const AxisRangeSlider: React.FC<AxisRangeSliderProps> = ({
    label,
    value,
    dataRange,
    onChange,
    onReset
}) => {
    const [localMin, setLocalMin] = useState(value[0].toString());
    const [localMax, setLocalMax] = useState(value[1].toString());

    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2 }}>
            <Typography sx={{ minWidth: 60 }}>{label} Range:</Typography>

            {/* Min input */}
            <TextField
                type="number"
                value={localMin}
                onChange={(e) => setLocalMin(e.target.value)}
                onBlur={() => {
                    const newMin = parseFloat(localMin);
                    if (!isNaN(newMin) && newMin < value[1]) {
                        onChange([newMin, value[1]]);
                    }
                }}
                size="small"
                sx={{ width: 100 }}
                inputProps={{ step: 'any' }}
            />

            {/* Range slider - using MUI Slider with two handles */}
            <Slider
                value={value}
                onChange={(_, newValue) => onChange(newValue as [number, number])}
                min={dataRange[0]}
                max={dataRange[1]}
                step={(dataRange[1] - dataRange[0]) / 1000}
                valueLabelDisplay="auto"
                sx={{ flex: 1, mx: 2 }}
            />

            {/* Max input */}
            <TextField
                type="number"
                value={localMax}
                onChange={(e) => setLocalMax(e.target.value)}
                onBlur={() => {
                    const newMax = parseFloat(localMax);
                    if (!isNaN(newMax) && newMax > value[0]) {
                        onChange([value[0], newMax]);
                    }
                }}
                size="small"
                sx={{ width: 100 }}
                inputProps={{ step: 'any' }}
            />

            {/* Reset button */}
            {onReset && (
                <IconButton size="small" onClick={onReset} title="Reset to full range">
                    <Refresh />
                </IconButton>
            )}
        </Box>
    );
};
```

### 3. Update AttributeMap3D.tsx

```typescript
// Add state for axis ranges
const [axisRanges, setAxisRanges] = useState<{
    x: [number, number];
    y: [number, number];
    z: [number, number];
} | null>(null);

// Calculate data ranges when data or axes change
const dataRanges = useMemo(() => {
    if (!data.length || !xAxis || !yAxis || !zAxis) return null;

    const xValues = data.map(d => d[xAxis]).filter(v => v != null && !isNaN(v));
    const yValues = data.map(d => d[yAxis]).filter(v => v != null && !isNaN(v));
    const zValues = data.map(d => d[zAxis]).filter(v => v != null && !isNaN(v));

    return {
        x: [Math.min(...xValues), Math.max(...xValues)] as [number, number],
        y: [Math.min(...yValues), Math.max(...yValues)] as [number, number],
        z: [Math.min(...zValues), Math.max(...zValues)] as [number, number],
    };
}, [data, xAxis, yAxis, zAxis]);

// Initialize ranges when data ranges change
useEffect(() => {
    if (dataRanges && !axisRanges) {
        setAxisRanges(dataRanges);
    }
}, [dataRanges]);

// Filter data based on axis ranges
const getPlotData = () => {
    // ... existing code ...

    // Filter by axis ranges
    for (const i of sortedIndices) {
        const x = data[i][xAxis];
        const y = data[i][yAxis];
        const z = data[i][zAxis];

        // Skip if outside range
        if (axisRanges) {
            if (x < axisRanges.x[0] || x > axisRanges.x[1]) continue;
            if (y < axisRanges.y[0] || y > axisRanges.y[1]) continue;
            if (z < axisRanges.z[0] || z > axisRanges.z[1]) continue;
        }

        // ... add to arrays ...
    }

    // ... rest of function ...
};
```

### 4. Render Sliders Below Plot

```typescript
{/* Axis Range Sliders */}
{dataRanges && axisRanges && (
    <Paper sx={{ p: 2, mt: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="subtitle2">Axis Ranges</Typography>
            <Button
                size="small"
                startIcon={<Refresh />}
                onClick={() => setAxisRanges(dataRanges)}
            >
                Reset All
            </Button>
        </Box>

        <Stack spacing={2}>
            <AxisRangeSlider
                label="X"
                value={axisRanges.x}
                dataRange={dataRanges.x}
                onChange={(val) => setAxisRanges(prev => prev ? {...prev, x: val} : null)}
                onReset={() => setAxisRanges(prev => prev ? {...prev, x: dataRanges.x} : null)}
            />
            <AxisRangeSlider
                label="Y"
                value={axisRanges.y}
                dataRange={dataRanges.y}
                onChange={(val) => setAxisRanges(prev => prev ? {...prev, y: val} : null)}
                onReset={() => setAxisRanges(prev => prev ? {...prev, y: dataRanges.y} : null)}
            />
            <AxisRangeSlider
                label="Z"
                value={axisRanges.z}
                dataRange={dataRanges.z}
                onChange={(val) => setAxisRanges(prev => prev ? {...prev, z: val} : null)}
                onReset={() => setAxisRanges(prev => prev ? {...prev, z: dataRanges.z} : null)}
            />
        </Stack>
    </Paper>
)}
```

## Files to Modify/Create

1. **`components/AxisRangeSlider.tsx`** - NEW - Reusable double-slider component
2. **`features/plots/AttributeMap3D.tsx`** - Add state, filtering, and slider UI

## Implementation Steps

1. Create AxisRangeSlider component
2. Add axis range state to AttributeMap3D
3. Calculate data ranges from the data
4. Add filtering logic to getPlotData
5. Render sliders below the plot
6. Test with different datasets

## Additional Considerations

### Performance
- Only recalculate data ranges when axes change, not on every render
- Consider debouncing slider changes for smoother interaction
- Filter data efficiently in the plot data function

### UX Enhancements
- Show point count in the filtered range
- Add zoom presets (e.g., "Center 50%", "Top Quartile")
- Remember slider positions per dataset/column combination
- Add keyboard shortcuts for fine-tuning values

### Future Extensions
- Apply same filtering to 2D AttributeMap
- Link ranges across multiple plots
- Save/load range presets
- Animate transitions when range changes

## Visual Mockup

```
┌────────────────────────────────────────────────────────────────┐
│  3D Attribute Map                    [▲ Collapse Controls]     │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│                        [3D Scatter Plot]                        │
│                                                                 │
│                     Points: 1,234 / 5,000                       │
│                                                                 │
├────────────────────────────────────────────────────────────────┤
│  ┌─ Axis Ranges ─────────────────────────────── [Reset All] ─┐ │
│  │                                                            │ │
│  │  X: [584723.5] ──●══════════════════●── [584892.1] [↺]    │ │
│  │                                                            │ │
│  │  Y: [6734521.0] ──●════════════════●── [6734890.5] [↺]    │ │
│  │                                                            │ │
│  │  Z: [-125.5] ──●══════════════════════●── [52.3] [↺]      │ │
│  │                                                            │ │
│  └────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

The slider handles (●) can be dragged independently to set min/max values,
or the values can be typed directly into the text fields on either side.
