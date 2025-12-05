# Enhanced Point Tooltips Implementation Plan

## Overview
Add rich, informative hover tooltips to all plot types that display:
1. Plot axis values (X, Y, Z as applicable)
2. Color classification field and its value/category
3. Shape classification field and its value/category
4. Size classification field and its value/category
5. Sample index for reference

## Current State Analysis

### Existing Tooltip Implementation
| Plot | Current Tooltip | Has `text` property? |
|------|-----------------|---------------------|
| ScatterPlot | `Sample ${i}` | Yes (minimal) |
| TernaryPlot | `Sample ${idx}` | Yes (minimal) |
| AttributeMap | None | No |
| AttributeMap3D | None | No |
| SpiderPlot | `Sample ${idx}` (in name) | No |
| DownholePlot | TBD | TBD |
| HistogramPlot | N/A (aggregated) | N/A |

### Data Available in AttributeStore
- `color.field`: Column name used for color classification
- `color.entries`: Array of entries with names (category labels)
- `shape.field`: Column name used for shape classification
- `shape.entries`: Array of entries with shape names
- `size.field`: Column name used for size classification
- `size.entries`: Array of entries with size values

## Implementation Approach

### 1. Create Tooltip Utility (`tooltipUtils.ts`)

Create a new utility file with functions to build rich hover content:

```typescript
// frontend/src/utils/tooltipUtils.ts

interface TooltipContext {
  dataPoint: Record<string, any>;
  dataIndex: number;
  axisColumns: {
    x?: string;
    y?: string;
    z?: string;
    a?: string;  // For ternary
    b?: string;
    c?: string;
  };
}

/**
 * Build hover text array for all data points
 * Returns array of HTML-formatted tooltip strings
 */
export function buildHoverTexts(
  data: Record<string, any>[],
  sortedIndices: number[],
  axisColumns: TooltipContext['axisColumns']
): string[]

/**
 * Build a Plotly hovertemplate string for consistent formatting
 */
export function getHoverTemplate(axisColumns: TooltipContext['axisColumns']): string
```

### 2. Tooltip Content Structure

Each tooltip will display (when applicable):

```
Sample: 1234
─────────────
X (Au ppm): 0.45
Y (Cu ppm): 123.5
─────────────
Color: Lithology = Granite
Shape: RockType = Volcanic
Size: Grade = High
```

Using Plotly's HTML formatting:
- `<b>` for labels
- `<br>` for line breaks
- `<extra></extra>` to hide trace name

### 3. Plot-Specific Customdata

Each plot will pass relevant values via `customdata` array:

```typescript
customdata: sortedIndices.map(i => ({
  idx: i,
  colorValue: color.field ? data[i][color.field] : null,
  colorCategory: getEntryNameForPoint(i, 'color'),
  shapeValue: shape.field ? data[i][shape.field] : null,
  shapeCategory: getEntryNameForPoint(i, 'shape'),
  sizeValue: size.field ? data[i][size.field] : null,
  sizeCategory: getEntryNameForPoint(i, 'size'),
}))
```

### 4. Files to Modify

#### New File
- `frontend/src/utils/tooltipUtils.ts` - Tooltip building utilities

#### Updates Required
1. **ScatterPlot.tsx** (lines ~138-151)
   - Add `customdata` with styling info
   - Add `hovertemplate` using tooltip utility

2. **TernaryPlot.tsx** (lines ~101-114)
   - Add `customdata` with styling info
   - Add `hovertemplate` for A/B/C axes

3. **AttributeMap.tsx** (lines ~103-114)
   - Add `text` or `hovertemplate` property
   - Include X/Y coordinates and styling

4. **AttributeMap3D.tsx** (lines ~191-203)
   - Add `hovertemplate` for X/Y/Z values
   - Include styling categories

5. **SpiderPlot.tsx** (lines ~59-82)
   - Update hover to show sample info and styling

6. **attributeUtils.ts**
   - Add helper function to get entry name for a data point

## Implementation Steps

### Step 1: Create tooltipUtils.ts
- `buildHoverTexts()` function
- `getHoverTemplate()` function
- `formatValue()` helper for number formatting

### Step 2: Add helper to attributeUtils.ts
- `getEntryNameForPoint(dataIndex, tab)` - returns the entry name (category) for a point

### Step 3: Update ScatterPlot
- Build customdata array with styling info
- Set hovertemplate

### Step 4: Update TernaryPlot
- Similar to ScatterPlot but with A/B/C axes

### Step 5: Update AttributeMap
- Add hover info to the trace

### Step 6: Update AttributeMap3D
- Add hover info with X/Y/Z values

### Step 7: Update SpiderPlot
- Add sample styling info to hover

## Example Hovertemplate

```typescript
const hovertemplate = `
<b>Sample %{customdata.idx}</b><br>
<br>
<b>${xAxis}:</b> %{x:.4g}<br>
<b>${yAxis}:</b> %{y:.4g}<br>
${color.field ? `<br><b>Color (${color.field}):</b> %{customdata.colorCategory}<br>` : ''}
${shape.field ? `<b>Shape (${shape.field}):</b> %{customdata.shapeCategory}<br>` : ''}
${size.field ? `<b>Size (${size.field}):</b> %{customdata.sizeCategory}<br>` : ''}
<extra></extra>
`;
```

## Benefits
1. Users can quickly identify what determines a point's appearance
2. Easy to see actual data values without clicking
3. Consistent tooltip format across all plot types
4. Shows both the classification field name and the category/value

## Testing
- Verify tooltips appear on all plot types
- Test with no styling (defaults)
- Test with color-only classification
- Test with color + shape + size classifications
- Test with categorical vs numeric classifications
- Verify performance with large datasets (10k+ points)
