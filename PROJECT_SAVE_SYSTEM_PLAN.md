# Project Save System - Implementation Plan

## Overview

Implement a robust project file system that saves all application state (data, columns, plot configurations, styles, etc.) to a single project file that can be loaded later. Includes autosave functionality.

---

## 1. Project File Format

### File Extension: `.iogas` or `.geochem`

### File Structure (JSON-based, compressed)
```json
{
  "version": "1.0.0",
  "metadata": {
    "name": "Project Name",
    "description": "Optional description",
    "created": "2024-01-15T10:30:00Z",
    "modified": "2024-01-15T14:22:00Z",
    "originalFile": "sample_data.csv",
    "rowCount": 5000,
    "columnCount": 45
  },
  "data": {
    "columns": [/* ColumnInfo array */],
    "rows": [/* Data rows */]
  },
  "state": {
    "attributeStore": {/* Full attribute store state */},
    "plots": [/* Plot configurations */],
    "activePlotId": "abc123",
    "selections": [/* Selected indices */]
  },
  "settings": {
    "autosaveEnabled": true,
    "autosaveIntervalMinutes": 5
  }
}
```

### Compression
- Use pako (zlib) to compress JSON before saving
- Reduces file size significantly for large datasets
- Decompress on load

---

## 2. Project Store (`projectStore.ts`)

### State
```typescript
interface ProjectState {
  // Current project info
  currentProjectPath: string | null;
  projectName: string;
  projectDescription: string;
  isDirty: boolean;  // Has unsaved changes
  lastSaved: Date | null;

  // Autosave settings
  autosaveEnabled: boolean;
  autosaveIntervalMinutes: number;

  // Recent projects
  recentProjects: Array<{
    path: string;
    name: string;
    lastOpened: Date;
  }>;
}
```

### Actions
```typescript
interface ProjectActions {
  // Project operations
  newProject: () => void;
  openProject: (path: string) => Promise<void>;
  saveProject: () => Promise<void>;
  saveProjectAs: (path: string) => Promise<void>;
  closeProject: () => void;

  // State tracking
  markDirty: () => void;
  markClean: () => void;

  // Autosave
  setAutosaveEnabled: (enabled: boolean) => void;
  setAutosaveInterval: (minutes: number) => void;
  triggerAutosave: () => Promise<void>;

  // Recent projects
  addRecentProject: (path: string, name: string) => void;
  removeRecentProject: (path: string) => void;
  clearRecentProjects: () => void;
}
```

---

## 3. Backend API Endpoints

### New Endpoints in `main.py`

```python
# POST /api/project/save
# Save project to specified path
@app.post("/api/project/save")
async def save_project(request: SaveProjectRequest):
    """
    Saves complete project state to file.
    - Receives JSON with all data and state
    - Compresses with zlib
    - Writes to specified path
    - Returns success/failure
    """

# POST /api/project/load
@app.post("/api/project/load")
async def load_project(request: LoadProjectRequest):
    """
    Loads project from file path.
    - Reads file from path
    - Decompresses
    - Validates schema version
    - Returns full project state
    """

# GET /api/project/recent
@app.get("/api/project/recent")
async def get_recent_projects():
    """
    Returns list of recent projects from config file.
    """

# POST /api/project/export
@app.post("/api/project/export")
async def export_data(request: ExportRequest):
    """
    Export data to CSV/Excel without full project state.
    """
```

---

## 4. UI Components

### 4.1 Project Menu Bar
Location: Top of application

```
File | Edit | View | Help
├── New Project           Ctrl+N
├── Open Project...       Ctrl+O
├── Open Recent          →  [Recent projects submenu]
├── ─────────────────────
├── Save                  Ctrl+S
├── Save As...           Ctrl+Shift+S
├── ─────────────────────
├── Import Data...
├── Export Data...
├── ─────────────────────
├── Project Settings...
└── Exit
```

### 4.2 Project Settings Dialog
- Project name and description
- Autosave toggle and interval slider (1-30 minutes)
- Default save location
- Compression level option

### 4.3 Unsaved Changes Dialog
When closing with unsaved changes:
```
┌─────────────────────────────────────────┐
│  Unsaved Changes                        │
│                                         │
│  Do you want to save changes to         │
│  "Project Name" before closing?         │
│                                         │
│  [Don't Save]  [Cancel]  [Save]         │
└─────────────────────────────────────────┘
```

### 4.4 Status Bar Indicator
- Shows current project name
- Shows "Modified" indicator when dirty
- Shows last save time
- Shows autosave countdown when enabled

---

## 5. Autosave Implementation

### Autosave Manager
```typescript
class AutosaveManager {
  private intervalId: NodeJS.Timeout | null = null;
  private lastAutosave: Date | null = null;

  start(intervalMinutes: number) {
    this.stop(); // Clear any existing interval
    this.intervalId = setInterval(async () => {
      const projectStore = useProjectStore.getState();
      if (projectStore.isDirty && projectStore.currentProjectPath) {
        await projectStore.triggerAutosave();
      }
    }, intervalMinutes * 60 * 1000);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}
```

### Autosave Behavior
1. Only autosave if:
   - Autosave is enabled
   - Project has been saved at least once (has a path)
   - There are unsaved changes (isDirty)
2. Show brief notification on autosave: "Autosaved at 14:32"
3. Don't interrupt user workflow
4. Create backup before overwriting (`.iogas.bak`)

---

## 6. Change Detection

### Track Dirty State
Set `isDirty = true` when:
- Data is modified (column type changes, calculations)
- Attribute store changes (colors, shapes, filters)
- Plot configurations change
- Any user action that modifies state

Set `isDirty = false` when:
- Project is saved
- Project is loaded (fresh state)
- New project is created

### Implementation
```typescript
// In relevant stores, call markDirty on state changes
const useAppStore = create<AppState>()((set, get) => ({
  // ... existing state ...

  updateColumn: async (column, role, alias) => {
    set(state => ({ /* update */ }));
    useProjectStore.getState().markDirty(); // Mark as dirty
  },
}));
```

---

## 7. File Operations Flow

### New Project
1. If current project is dirty, prompt to save
2. Clear all stores to default state
3. Set currentProjectPath = null
4. Set projectName = "Untitled Project"

### Open Project
1. If current project is dirty, prompt to save
2. Show file picker (filter: .iogas files)
3. Call backend to load file
4. Validate and migrate if needed
5. Populate all stores with loaded state
6. Set currentProjectPath
7. Add to recent projects
8. Mark as clean

### Save Project
1. If no currentProjectPath, show Save As dialog
2. Gather state from all stores
3. Call backend to save
4. Update lastSaved timestamp
5. Mark as clean
6. Show success notification

### Save As
1. Show file picker (save mode)
2. Set new currentProjectPath
3. Continue with Save flow

---

## 8. Migration Strategy

### Version Handling
```typescript
interface MigrationHandler {
  fromVersion: string;
  toVersion: string;
  migrate: (data: any) => any;
}

const migrations: MigrationHandler[] = [
  {
    fromVersion: '1.0.0',
    toVersion: '1.1.0',
    migrate: (data) => {
      // Add new fields, transform old ones
      return { ...data, newField: defaultValue };
    }
  }
];

function migrateProject(data: any): any {
  let current = data;
  let currentVersion = data.version || '1.0.0';

  for (const migration of migrations) {
    if (currentVersion === migration.fromVersion) {
      current = migration.migrate(current);
      currentVersion = migration.toVersion;
      current.version = currentVersion;
    }
  }

  return current;
}
```

---

## 9. Implementation Order

### Phase 1: Core Save/Load (Priority)
1. Create `projectStore.ts` with basic state
2. Add backend endpoints for save/load
3. Implement file format with compression
4. Add Save and Open menu items
5. Basic dirty state tracking

### Phase 2: UI Polish
1. Add Project Settings dialog
2. Add Recent Projects menu
3. Add unsaved changes warning
4. Add status bar indicators

### Phase 3: Autosave
1. Implement AutosaveManager
2. Add autosave settings
3. Add backup file creation
4. Add autosave notifications

### Phase 4: Advanced Features
1. Project templates
2. Import/Export subsets
3. Project comparison
4. Undo/Redo history saving

---

## 10. Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+N | New Project |
| Ctrl+O | Open Project |
| Ctrl+S | Save Project |
| Ctrl+Shift+S | Save As |
| Ctrl+W | Close Project |

---

## 11. Storage Locations

### Default Locations
- **Windows**: `%USERPROFILE%\Documents\IOGAS Projects\`
- **macOS**: `~/Documents/IOGAS Projects/`
- **Linux**: `~/Documents/IOGAS Projects/`

### Config File Location
- **Windows**: `%APPDATA%\IOGAS\config.json`
- **macOS**: `~/Library/Application Support/IOGAS/config.json`
- **Linux**: `~/.config/iogas/config.json`

Config stores:
- Recent projects list
- Last used directory
- User preferences

---

## 12. Error Handling

### File Operations
- File not found: "Project file not found. It may have been moved or deleted."
- Permission denied: "Cannot save to this location. Check file permissions."
- Corrupted file: "Project file is corrupted. Would you like to try recovery?"
- Version mismatch: "This project was created with a newer version. Please update."

### Recovery
- Keep `.bak` files for last 3 saves
- Offer to restore from backup on corruption
- Log all file operations for debugging

---

## Summary

This plan provides a comprehensive project management system that:
1. Saves all application state to a single file
2. Supports autosave with configurable intervals
3. Tracks unsaved changes and warns before closing
4. Maintains recent projects list
5. Handles version migrations gracefully
6. Provides clear error handling and recovery options
