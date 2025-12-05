# Attribute Manager Implementation Plan

## Overview
Complete redesign of the Style Manager to match ioGAS Attribute Manager functionality.

## Current vs Target Architecture

### Current (Problems)
- Separate styleRules for color, shape, size
- Configure button opens dialog to set up rules
- Legend appears inline after configuration
- Duplicated controls (upper tabs + Style Manager)
- No unified attribute entries
- No data selection to attribute assignment

### Target (ioGAS-style)
- Unified AttributeEntry model (each entry can have color + shape + size)
- Tabbed interface: Colour | Shape | Size | Filter
- Data grid showing: Name | Visible | Visual | Rows | Rows visible
- Bottom toolbar with field selector, classification, palette, Auto-Attribute
- Add/Remove custom entries
- Data selection assigns points to highlighted entry

---

## Data Model Changes

### New: AttributeEntry
```typescript
interface AttributeEntry {
    id: string;                    // Unique ID
    name: string;                  // Display name (e.g., "High Cu", "D9", "0-10")

    // Visual attributes (all optional - entry can have any combination)
    color?: string;                // Hex color
    shape?: string;                // Shape name
    size?: number;                 // Point size

    // Membership
    type: 'range' | 'category' | 'custom';

    // For range type
    min?: number;
    max?: number;

    // For category type
    categoryValue?: string;        // The actual value in the data

    // For custom type - indices of data points assigned to this entry
    assignedIndices?: number[];

    // Visibility
    visible: boolean;

    // Statistics (computed)
    rowCount?: number;             // Total rows matching this entry
    visibleRowCount?: number;      // Rows currently visible
}
```

### New: AttributeState
```typescript
interface AttributeState {
    // Active field for each attribute type
    colorField: string | null;
    shapeField: string | null;
    sizeField: string | null;
    filterField: string | null;

    // Classification settings per field
    classificationMethod: 'equal' | 'quantile' | 'jenks' | 'manual';
    numClasses: number;
    palette: string;

    // Unified entries - shared across tabs
    // When colorField is set, entries get colors
    // When shapeField is set, entries get shapes (can be same or different field)
    entries: AttributeEntry[];

    // Global settings
    globalOpacity: number;

    // Currently highlighted entry (for data selection assignment)
    highlightedEntryId: string | null;
}
```

### Key Insight: Field Independence
In ioGAS, you can have:
- Colour by "Regolith Unit" (5 categories)
- Shape by "Geology" (12 categories)
- Size by numeric field (ranges)

Each creates its OWN set of entries. But when you click "Add" on the Colour tab,
it adds a colour entry. The entries are per-attribute-type, not unified.

**Revised Model:**
```typescript
interface AttributeStore {
    // Per-attribute configuration
    color: {
        field: string | null;
        entries: AttributeEntry[];  // Color-specific entries
        method: ClassificationMethod;
        numClasses: number;
        palette: string;
    };

    shape: {
        field: string | null;
        entries: AttributeEntry[];  // Shape-specific entries
        method: ClassificationMethod;
        numClasses: number;
    };

    size: {
        field: string | null;
        entries: AttributeEntry[];  // Size-specific entries
        method: ClassificationMethod;
        numClasses: number;
        minSize: number;
        maxSize: number;
    };

    filter: {
        field: string | null;
        entries: AttributeEntry[];  // Filter-specific entries
    };

    // Global
    globalOpacity: number;
    highlightedEntryId: string | null;
    activeTab: 'color' | 'shape' | 'size' | 'filter';
}
```

---

## UI Structure

### Component Hierarchy
```
AttributeManager/
├── AttributeManager.tsx          # Main container with tabs
├── AttributeTab.tsx              # Reusable tab content (grid + toolbar)
├── AttributeGrid.tsx             # Data grid component
├── AttributeToolbar.tsx          # Bottom toolbar
├── AttributeEntry.tsx            # Single row in grid
├── FilterTab.tsx                 # Filter-specific tab
└── attributeStore.ts             # Zustand store
```

### Layout (matches ioGAS)
```
┌─────────────────────────────────────────────────────────────┐
│  Colour - Regolith Unit │ Shape - Geology │ Size - │ Filter │  ← Tabs
├─────────────────────────────────────────────────────────────┤
│ Name          │ Visible │ Colour │ Rows  │ Rows visible    │  ← Header
├───────────────┼─────────┼────────┼───────┼─────────────────┤
│ Default Colour│   ☑     │   ●    │   0   │       0         │
│ D9            │   ☐     │   ●    │  215  │       0         │
│ DA            │   ☐     │   ●    │  152  │       0         │
│ DC            │   ☑     │   ●    │  479  │     479         │
│ E             │   ☑     │   ●    │  153  │     153         │
├─────────────────────────────────────────────────────────────┤
│  [+]    [-]         [-] All              [-] Global        │  ← Action buttons
├─────────────────────────────────────────────────────────────┤
│ [Field ▼] │ [10 Equal Ranges ▼] │ [Palette] │ [Auto-Attr]  │  ← Config
├─────────────────────────────────────────────────────────────┤
│ [All Visible] [All Invisible] [Save Attrs] [Load Attrs]    │  ← Visibility
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Steps

### Phase 1: New Store & Data Model
1. Create `attributeStore.ts` with new data model
2. Migrate existing styleRules to new format
3. Add computed selectors for row counts

### Phase 2: UI Components
1. Create `AttributeManager.tsx` - main tabbed container
2. Create `AttributeGrid.tsx` - data grid with selection
3. Create `AttributeToolbar.tsx` - bottom toolbar
4. Create `FilterTab.tsx` - filter-specific logic

### Phase 3: Core Functionality
1. **Auto-Attribute**: Generate entries when field selected
2. **Add Entry**: Create custom entry with default values
3. **Remove Entry**: Delete selected entry
4. **Remove All**: Clear all entries for current tab
5. **Global**: Clear ALL attributes (color + shape + size + filter)

### Phase 4: Classification Methods
1. Equal Intervals
2. Quantiles
3. Jenks Natural Breaks
4. Manual (user-defined ranges)
5. Categorical (unique values)

### Phase 5: Data Selection Integration
1. Track highlighted entry in store
2. Lasso/polygon selection on plots
3. Assign selected points to highlighted entry
4. Update row counts

### Phase 6: Save/Load
1. Export attribute state to JSON
2. Import from JSON file
3. Validate imported data

### Phase 7: Plot Integration
1. Update all plots to use new attribute store
2. Apply combined color/shape/size from entries
3. Respect filter visibility

---

## Interaction Flows

### Auto-Attribute Flow
1. User selects field from dropdown (e.g., "Regolith Unit")
2. User clicks "Auto-Attribute"
3. System detects field type (categorical vs numeric)
4. For categorical: Get unique values, create entry per value
5. For numeric: Apply classification method, create ranges
6. Assign colors/shapes/sizes from palette
7. Calculate row counts
8. Update all plots

### Custom Entry Flow
1. User clicks [+] Add button
2. New entry added: "New Colour" / "New Shape" / "New Size"
3. User can rename by double-clicking
4. User can change color/shape/size by clicking visual
5. Entry has 0 rows initially
6. User selects entry (highlights in blue)
7. User draws selection on plot
8. Selected points assigned to highlighted entry
9. Row count updates

### Filter Flow
1. User switches to Filter tab
2. User selects categorical field
3. User clicks Auto-Attribute
4. Categories listed with visibility checkboxes
5. Unchecking visibility hides those points from ALL plots
6. Row counts show filtered vs total

---

## File Changes Required

### Remove/Replace
- `components/StyleManager/StyleManager.tsx` → Replace entirely
- `components/StyleManager/StyleLegend.tsx` → Remove (integrated into grid)
- `components/StyleManager/RangeEditor.tsx` → Replace with inline editing
- `store/styleStore.ts` → Replace with `attributeStore.ts`

### Keep/Modify
- `utils/styleUtils.ts` → Update to use new store
- `utils/classification.ts` → Keep classification algorithms
- `utils/colorPalettes.ts` → Keep palettes

### New Files
- `components/AttributeManager/AttributeManager.tsx`
- `components/AttributeManager/AttributeTab.tsx`
- `components/AttributeManager/AttributeGrid.tsx`
- `components/AttributeManager/AttributeToolbar.tsx`
- `components/AttributeManager/FilterTab.tsx`
- `store/attributeStore.ts`

---

## Questions to Confirm

1. **Row selection on grid**: Should clicking a row highlight it (for assignment)?
2. **Multi-select**: Can multiple entries be selected at once?
3. **Drag reorder**: Should entries be reorderable?
4. **Color picker**: Inline color picker or popup?
5. **Shape picker**: Dropdown or visual grid?
6. **Keyboard shortcuts**: Ctrl+A for Attribute Manager?

---

## Migration Strategy

1. Build new AttributeManager alongside existing StyleManager
2. Add feature flag to switch between them
3. Test thoroughly with all plot types
4. Remove old StyleManager once validated
5. Clean up unused code

---

## Estimated Effort

- Phase 1 (Store): 2-3 hours
- Phase 2 (UI): 4-5 hours
- Phase 3 (Core): 3-4 hours
- Phase 4 (Classification): 2 hours (mostly exists)
- Phase 5 (Selection): 3-4 hours
- Phase 6 (Save/Load): 1-2 hours
- Phase 7 (Plot Integration): 2-3 hours

**Total: ~20 hours**
