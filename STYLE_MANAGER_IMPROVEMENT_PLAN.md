# Style Manager Improvement Plan

## Overview

This plan addresses three key issues:
1. **Template Independence**: Allow templates to only affect their specific attribute (color, shape, or size) without overriding other attributes
2. **High Grade Emphasis Mode**: New feature to highlight high-value data points (like Leapfrog's functionality)
3. **Plotly Visibility Fix**: Resolve the issue where Plotly makes some points hard to see when rendering lots of data

---

## Issue 1: Template Independence

### Current Problem
When applying a template that only styles color, existing shape and size configurations may be lost or cannot be independently modified.

### Root Cause Analysis
The current system stores rules as `field + attribute` pairs, which is correct. However, the UI flow when applying templates may not clearly communicate that other attributes remain independent.

### Solution

#### 1.1 Verify Store Behavior (Low Risk)
**File:** `frontend/src/store/styleStore.ts`

- Confirm that `addStyleRule()` only replaces rules matching BOTH field AND attribute
- Current implementation appears correct, but verify edge cases

#### 1.2 Enhance Template Application UI
**File:** `frontend/src/components/StyleManager/StyleLibrary.tsx`

- Add clear indication that applying a template only affects ONE attribute
- Show existing rules for other attributes after template application
- Add "Keep existing [shape/size] settings" checkbox when applying templates

#### 1.3 Add Multi-Attribute Template Panel
**File:** `frontend/src/components/StyleManager/StyleManager.tsx`

- Add a "Quick Style" panel showing all three attributes for a field
- Allow user to configure color, shape, AND size simultaneously for same field
- Each attribute can be independent or "none"

**UI Mockup:**
```
┌─────────────────────────────────────────┐
│ Field: Au_ppm                           │
├─────────────────────────────────────────┤
│ Color:  [Template Dropdown ▼] [Edit]    │
│ Shape:  [Template Dropdown ▼] [Edit]    │
│ Size:   [Template Dropdown ▼] [Edit]    │
└─────────────────────────────────────────┘
```

---

## Issue 2: High Grade Emphasis Mode (Leapfrog-style)

### Current Problem
No way to visually emphasize high-grade values. All points have equal visual weight regardless of grade.

### Solution: Add "Grade Emphasis" Feature

#### 2.1 Add Emphasis State to Store
**File:** `frontend/src/store/styleStore.ts`

```typescript
// New state properties
emphasisMode: 'none' | 'opacity' | 'size' | 'both'
emphasisField: string | null
emphasisDirection: 'high' | 'low'  // Emphasize high or low values
emphasisIntensity: number  // 0-100, how strong the effect is
emphasisRange: { min: number, max: number }  // Data range to emphasize

// New actions
setEmphasisMode(mode)
setEmphasisField(field)
setEmphasisIntensity(intensity)
```

#### 2.2 Create Emphasis Controls UI
**File:** `frontend/src/components/StyleManager/EmphasisControls.tsx` (NEW)

Features:
- **Enable/Disable Toggle**: Quick on/off button
- **Field Selector**: Which numeric field to use for emphasis
- **Mode Selector**:
  - "Opacity" - Fade low values
  - "Size" - Shrink low values
  - "Both" - Combined effect
- **Direction**: Emphasize "High Values" or "Low Values"
- **Intensity Slider**: 0-100% strength
- **Threshold Input**: Optional minimum value below which points become very faint

**UI Mockup:**
```
┌─────────────────────────────────────────┐
│ ⚡ Grade Emphasis           [ON/OFF]    │
├─────────────────────────────────────────┤
│ Field: [Au_ppm ▼]                       │
│                                         │
│ Mode: ○ Opacity  ○ Size  ● Both         │
│                                         │
│ Emphasize: ● High Values  ○ Low Values  │
│                                         │
│ Intensity: ────────●───── 70%           │
│                                         │
│ Threshold: [0.1] (values below = faint) │
└─────────────────────────────────────────┘
```

#### 2.3 Implement Emphasis Calculations
**File:** `frontend/src/utils/emphasisUtils.ts` (NEW)

```typescript
interface EmphasisResult {
  opacity: number[]
  size: number[]
}

function calculateEmphasis(
  data: any[],
  field: string,
  mode: 'opacity' | 'size' | 'both',
  direction: 'high' | 'low',
  intensity: number,
  threshold?: number
): EmphasisResult {
  // Get field values
  // Normalize to 0-1 range
  // Apply emphasis curve (exponential works well)
  // Return opacity and/or size arrays
}
```

**Emphasis Curve Options:**
- Linear: `emphasisValue = normalizedValue`
- Exponential: `emphasisValue = normalizedValue ^ 2` (more contrast)
- Threshold: Below threshold = minOpacity, above = interpolated

#### 2.4 Integrate with ScatterPlot
**File:** `frontend/src/features/plots/ScatterPlot.tsx`

Modify marker configuration:
```typescript
// Current (fixed opacity)
marker: {
  opacity: 0.7,
  size: [size values]
}

// New (with emphasis)
marker: {
  opacity: emphasisMode !== 'none'
    ? emphasisOpacities
    : baseOpacity,
  size: emphasisMode === 'size' || emphasisMode === 'both'
    ? emphasisSizes
    : baseSizes
}
```

---

## Issue 3: Plotly Point Visibility Fix

### Current Problem
When plotting lots of data, Plotly makes some values hard to see/transparent.

### Root Causes
1. **Fixed opacity at 0.7**: All points are 30% transparent
2. **Plotly's WebGL rendering**: Can cause visual artifacts with many overlapping points
3. **No marker outline**: Points blend together
4. **Colorscale overlap**: Similar colors in dense areas

### Solution

#### 3.1 Add Global Opacity Control
**File:** `frontend/src/store/styleStore.ts`

```typescript
globalOpacity: number  // 0.1 to 1.0, default 1.0
setGlobalOpacity(opacity: number)
```

**File:** `frontend/src/components/StyleManager/StyleManager.tsx`

Add opacity slider to settings:
```
Base Opacity: ────────────●── 100%
```

#### 3.2 Improve Marker Rendering
**File:** `frontend/src/features/plots/ScatterPlot.tsx`

```typescript
marker: {
  opacity: globalOpacity,  // User-controlled, default to 1.0
  line: {
    width: 0.5,           // Add subtle outline
    color: 'rgba(0,0,0,0.3)'  // Dark outline for contrast
  }
}
```

#### 3.3 Add "Full Opacity" Quick Toggle
**File:** `frontend/src/components/StyleManager/StyleManager.tsx`

Add button: **[Full Visibility Mode]**
- Sets opacity to 1.0
- Adds marker outline
- Disables any alpha blending

#### 3.4 WebGL Mode Toggle (for large datasets)
**File:** `frontend/src/features/plots/ScatterPlot.tsx`

```typescript
// Use WebGL for large datasets (better performance, consistent rendering)
type: data.length > 5000 ? 'scattergl' : 'scatter'
```

Note: WebGL mode (`scattergl`) has more consistent opacity handling for large datasets.

#### 3.5 Z-Order Control for Overlapping Points
**File:** `frontend/src/features/plots/ScatterPlot.tsx`

Add option to sort points so higher values render on top:
```typescript
if (zOrderByValue && colorField) {
  // Sort data so high values are drawn last (on top)
  const sortedIndices = [...Array(data.length).keys()]
    .sort((a, b) => data[a][colorField] - data[b][colorField])

  // Reorder all arrays by sorted indices
}
```

---

## Implementation Order (Recommended)

### Phase 1: Quick Wins (Low Risk)
1. **Fix base opacity** - Change from 0.7 to 1.0 default
2. **Add global opacity slider** - Simple UI addition
3. **Add marker outline** - Improves visibility immediately
4. **Verify template independence** - Ensure store works correctly

### Phase 2: Emphasis Feature (Medium Risk)
5. **Create emphasisUtils.ts** - Standalone utility
6. **Add EmphasisControls.tsx** - New UI component
7. **Add emphasis state to store** - Extend existing store
8. **Integrate with ScatterPlot** - Modify marker generation

### Phase 3: Advanced Features (Medium Risk)
9. **Z-order control** - Sort points by value
10. **WebGL mode** - For large datasets
11. **Multi-attribute template panel** - Enhanced UI

### Phase 4: Polish
12. **Integrate with other plot types** - AttributeMap, TernaryPlot, etc.
13. **Save emphasis settings to templates** - Persistence
14. **Add presets** - "Geochemistry", "Lithology", etc.

---

## Files to Modify

| File | Changes | Risk |
|------|---------|------|
| `store/styleStore.ts` | Add emphasis state, global opacity | Low |
| `components/StyleManager/StyleManager.tsx` | Add opacity slider, emphasis panel | Low |
| `components/StyleManager/EmphasisControls.tsx` | NEW - Emphasis UI | None (new) |
| `utils/emphasisUtils.ts` | NEW - Emphasis calculations | None (new) |
| `features/plots/ScatterPlot.tsx` | Integrate emphasis, fix opacity | Medium |
| `features/plots/AttributeMap.tsx` | Apply same fixes | Medium |
| `features/plots/TernaryPlot.tsx` | Apply same fixes | Medium |
| `components/StyleManager/StyleLibrary.tsx` | Clarify template behavior | Low |

---

## Testing Plan

### Unit Tests
- [ ] Emphasis calculation produces correct opacity/size arrays
- [ ] Store correctly manages emphasis state
- [ ] Template application doesn't overwrite other attributes

### Integration Tests
- [ ] Emphasis mode toggles correctly in scatter plot
- [ ] Global opacity slider updates all plots
- [ ] Z-order renders high values on top

### Visual Tests
- [ ] Load 10,000+ points - verify no transparency issues
- [ ] Apply color template - verify shape/size remain
- [ ] Enable emphasis - verify high grades are prominent
- [ ] Compare before/after screenshots

---

## Rollback Plan

All changes should be behind feature flags initially:
```typescript
const FEATURES = {
  emphasisMode: true,
  customOpacity: true,
  zOrderControl: true,
  webglMode: true
}
```

If issues arise, features can be disabled without code revert.

---

## Summary

| Issue | Solution | Effort |
|-------|----------|--------|
| Template independence | Verify store + improve UI | Small |
| High grade emphasis | New EmphasisControls component + integration | Medium |
| Plotly visibility | Fix opacity default + add controls | Small |

Total estimated changes: ~500-700 lines of new/modified code across 8-10 files.
