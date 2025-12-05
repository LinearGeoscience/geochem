# Attribute Manager Implementation Plan v2

## Final Requirements Summary

Based on user feedback:
1. **Row selection** - Clicking highlights row (blue) for data assignment
2. **Cross-tab editing** - Custom entries link across tabs by NAME. "High Cu" on Color tab = "High Cu" on Shape/Size tabs
3. **Replace upper tabs** - Remove COLOR/SHAPE/SIZE/VIS tabs completely
4. **Default entry** - Always present, modifiable
5. **Sidebar panel** - Replaces old Style Manager, persists across all plot windows

## Data Model

### Core Insight: Dual Entry System
1. **Field-based entries** - Auto-generated from field values (categorical or numeric ranges)
2. **Custom entries** - Manually created, shared across ALL tabs by name

### AttributeEntry
```typescript
interface AttributeEntry {
    id: string;
    name: string;                    // "High Cu", "D9", "0-10", "Default Colour"
    isDefault: boolean;              // Is this the default entry?
    isCustom: boolean;               // Manually added vs auto-generated
    visible: boolean;

    // Type info (for field-based entries)
    type: 'default' | 'range' | 'category' | 'custom';
    min?: number;                    // For range type
    max?: number;
    categoryValue?: string;          // For category type

    // Visual attributes (set per entry)
    color?: string;
    shape?: string;
    size?: number;

    // For custom entries - manually assigned data point indices
    assignedIndices: Set<number>;
}
```

### AttributeConfig (per tab)
```typescript
interface AttributeConfig {
    field: string | null;            // Selected field (e.g., "Regolith Unit")
    method: 'equal' | 'quantile' | 'jenks' | 'categorical';
    numClasses: number;
    palette: string;
    entries: AttributeEntry[];       // Field-based entries
}
```

### AttributeStore
```typescript
interface AttributeStore {
    // Per-tab configuration
    color: AttributeConfig;
    shape: AttributeConfig;
    size: AttributeConfig;
    filter: AttributeConfig;

    // Custom entries (shared across all tabs)
    customEntries: AttributeEntry[];

    // Currently selected entry name (for cross-tab linking)
    selectedEntryName: string | null;

    // Active tab
    activeTab: 'color' | 'shape' | 'size' | 'filter';

    // Global settings
    globalOpacity: number;
}
```

## Cross-Tab Entry Linking

When user creates "High Cu" on Color tab:
1. Entry added to `customEntries` with color set
2. User switches to Shape tab
3. "High Cu" appears in Shape tab (from customEntries)
4. User can set shape for "High Cu"
5. Switch to Size tab, set size for "High Cu"
6. Result: "High Cu" has color + shape + size

**Top-right indicator**: Shows currently highlighted entry's attributes across all tabs:
```
┌─────────────────────────┐
│ High Cu  ● ▲  10pt     │  ← Shows color (red), shape (triangle), size (10)
└─────────────────────────┘
```

## UI Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│                                              [High Cu ● ▲ 10pt]    │  ← Selected indicator
├─────────────────────────────────────────────────────────────────────┤
│ ● Colour - Regolith │ ▲ Shape - Geology │ ■ Size - │ ▼ Filter -   │  ← Tabs with icons
├───────────────┬─────────┬────────┬───────┬─────────────────────────┤
│ Name          │ Visible │ Colour │ Rows  │ Rows visible            │  ← Column headers
├───────────────┼─────────┼────────┼───────┼─────────────────────────┤
│ Default       │   ☑     │   ●    │  100  │      100                │  ← Default entry
│ High Cu       │   ☑     │   ●    │    0  │        0                │  ← Custom (shared)
├───────────────┼─────────┼────────┼───────┼─────────────────────────┤
│ D9            │   ☑     │   ●    │  215  │      215                │  ← Field-based
│ DA            │   ☐     │   ●    │  152  │        0                │
│ DC            │   ☑     │   ●    │  479  │      479                │
│ E             │   ☑     │   ●    │  153  │      153                │
├─────────────────────────────────────────────────────────────────────┤
│  [➕]    [➖]                    [➖ All]              [➖ Global]   │  ← Action buttons
├─────────────────────────────────────────────────────────────────────┤
│ [Regolith Unit ▼] │ [10 Equal Ranges ▼] │ [🎨 Jet] │ [Auto-Attr]  │  ← Config
├─────────────────────────────────────────────────────────────────────┤
│  [👁 All Visible]  [👁̸ All Invisible]  [💾 Save]  [📂 Load]      │  ← Bottom actions
└─────────────────────────────────────────────────────────────────────┘
```

## Component Structure

```
frontend/src/
├── components/
│   └── AttributeManager/
│       ├── AttributeManager.tsx      # Main container
│       ├── AttributeHeader.tsx       # Selected entry indicator + tabs
│       ├── AttributeGrid.tsx         # Data grid with rows
│       ├── AttributeRow.tsx          # Single row component
│       ├── AttributeToolbar.tsx      # Add/Remove/All/Global buttons
│       ├── AttributeConfig.tsx       # Field/Method/Palette/AutoAttr
│       ├── AttributeActions.tsx      # Visible/Invisible/Save/Load
│       ├── ColorPicker.tsx           # Inline color picker
│       ├── ShapePicker.tsx           # Shape selection dropdown
│       └── SizePicker.tsx            # Size input
│
├── store/
│   └── attributeStore.ts             # New Zustand store
│
└── utils/
    └── attributeUtils.ts             # Helper functions
```

## Interaction Flows

### 1. Auto-Attribute Flow
```
User selects "Regolith Unit" from field dropdown
User clicks [Auto-Attribute]
  ↓
System checks field type:
  - Categorical → Get unique values, sort alphabetically
  - Numeric → Apply classification (equal/quantile/jenks)
  ↓
Create AttributeEntry for each category/range:
  - Assign colors from palette
  - Set visible = true
  - Calculate row counts from data
  ↓
Update grid display
Update all open plots
```

### 2. Add Custom Entry Flow
```
User clicks [➕] button
  ↓
New entry created: "New Colour" (on Color tab)
Entry added to customEntries array
Entry selected (highlighted blue)
  ↓
User double-clicks name → Edit mode
User types "High Cu" → Enter
  ↓
User clicks color swatch → Color picker opens
User selects red → Entry color updated
  ↓
User switches to Shape tab
"High Cu" appears (from customEntries)
User clicks [➕] or selects existing "High Cu"
User sets shape to triangle
  ↓
User switches to Size tab
Repeat for size = 10
  ↓
Result: customEntries contains "High Cu" with:
  { color: '#ff0000', shape: 'triangle-up', size: 10 }
```

### 3. Data Selection Assignment Flow
```
User selects "High Cu" row (highlighted blue)
Top-right shows: "High Cu ● ▲ 10pt"
  ↓
User switches to scatter plot
User draws lasso around points
  ↓
Selected point indices captured
assignedIndices updated for "High Cu"
Row count updates in grid
  ↓
All plots re-render with "High Cu" styling
```

### 4. Filter Tab Flow
```
User switches to Filter tab
User selects "Sample Medium" field
User clicks [Auto-Attribute]
  ↓
Categories created: LAKE, SHTW, SOIL, SPL, STRM
All visible by default
  ↓
User unchecks LAKE, SOIL, SPL, STRM
Only SHTW visible (397 rows)
  ↓
All plots filter to show only SHTW samples
Other attribute styling still applies to visible data
```

### 5. Remove Flows
```
[➖] Remove: Delete selected entry (if not default)
[➖ All]: Clear all entries for current tab (keep default)
[➖ Global]: Clear ALL entries across ALL tabs (reset to defaults only)
```

### 6. Save/Load Flow
```
[💾 Save]:
  - Export entire AttributeStore to JSON
  - Prompt for filename
  - Include: color/shape/size/filter configs, customEntries, selectedEntryName

[📂 Load]:
  - Open file picker for JSON
  - Parse and validate
  - Replace AttributeStore state
  - Recalculate row counts from current data
  - Update all plots
```

## Plot Integration

### Style Resolution Order
For each data point, resolve styling in order:

1. **Check custom entries first** (by assignedIndices)
   - If point index in "High Cu".assignedIndices → use "High Cu" styling

2. **Check field-based entries** (by value matching)
   - Color: Match point's colorField value to entry's categoryValue/range
   - Shape: Match point's shapeField value to entry's categoryValue/range
   - Size: Match point's sizeField value to entry's categoryValue/range

3. **Fall back to default**
   - Use "Default Colour/Shape/Size" entry styling

4. **Apply filter**
   - If point's filterField value matches a hidden filter entry → hide point

### Visibility Logic
```typescript
function isPointVisible(pointIndex: number, pointData: any): boolean {
    // Check filter first
    if (filter.field) {
        const filterValue = pointData[filter.field];
        const filterEntry = filter.entries.find(e => e.categoryValue === filterValue);
        if (filterEntry && !filterEntry.visible) return false;
    }

    // Check if point is in any hidden entry
    // (Custom entries and field-based entries)
    // ...

    return true;
}
```

## Files to Modify/Remove

### Remove
- `components/StyleManager/*` (all files)
- `store/styleStore.ts`
- Upper tabs section in sidebar (COLOR/SHAPE/SIZE/VIS)

### Create
- `components/AttributeManager/*` (new directory)
- `store/attributeStore.ts`
- `utils/attributeUtils.ts`

### Modify
- `components/Layout.tsx` - Remove old sidebar sections
- `components/Sidebar.tsx` - Replace with AttributeManager
- All plot files - Update to use attributeStore
- `utils/styleUtils.ts` - Update to use new store (or replace)

## Implementation Order

### Phase 1: Store & Types (1-2 hours)
1. Create `attributeStore.ts` with full type definitions
2. Implement all store actions
3. Add computed selectors for row counts

### Phase 2: Core UI Components (3-4 hours)
1. `AttributeManager.tsx` - Main container with tabs
2. `AttributeHeader.tsx` - Selected entry indicator
3. `AttributeGrid.tsx` - Scrollable data grid
4. `AttributeRow.tsx` - Row with selection, visibility, visual

### Phase 3: Toolbar & Config (2 hours)
1. `AttributeToolbar.tsx` - Add/Remove/All/Global
2. `AttributeConfig.tsx` - Field/Method/Palette/AutoAttr
3. `AttributeActions.tsx` - Visible/Invisible/Save/Load

### Phase 4: Pickers (1 hour)
1. `ColorPicker.tsx` - Inline color selection
2. `ShapePicker.tsx` - Shape dropdown with icons
3. `SizePicker.tsx` - Number input with preview

### Phase 5: Auto-Attribute Logic (2 hours)
1. Categorical field detection and entry generation
2. Numeric classification with existing algorithms
3. Palette application
4. Row count calculation

### Phase 6: Remove Old Code (1 hour)
1. Remove StyleManager components
2. Remove styleStore
3. Update Layout/Sidebar

### Phase 7: Plot Integration (3-4 hours)
1. Create new `attributeUtils.ts` for style resolution
2. Update ScatterPlot
3. Update AttributeMap
4. Update AttributeMap3D
5. Update TernaryPlot
6. Update SpiderPlot
7. Update DownholePlot

### Phase 8: Data Selection (2-3 hours)
1. Lasso selection on plots
2. Assign selection to highlighted entry
3. Clear assignment functionality

### Phase 9: Save/Load (1 hour)
1. JSON export
2. JSON import with validation
3. File dialogs

### Phase 10: Testing & Polish (2 hours)
1. Test all interactions
2. Fix edge cases
3. Performance optimization

**Total: ~18-22 hours**

## Edge Cases to Handle

1. **No data loaded** - Disable Auto-Attribute, show empty grid
2. **Field change** - Clear field-based entries, keep custom
3. **Entry name conflict** - Prevent duplicate names
4. **Empty custom entry** - Allow 0 rows (for future selection)
5. **Large datasets** - Virtualize grid for 1000+ entries
6. **Missing values** - "null"/"undefined" as category or skip?
7. **Numeric as categorical** - Handle integer fields with few values

## Success Criteria

- [ ] UI matches ioGAS layout
- [ ] Auto-Attribute generates correct entries
- [ ] Custom entries link across tabs
- [ ] Selection assignment works
- [ ] Filter hides data correctly
- [ ] Save/Load preserves state
- [ ] All plots render correctly
- [ ] Performance acceptable with large data
