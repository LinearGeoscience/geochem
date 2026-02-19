import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useAppStore } from './appStore';
import { useAttributeStore } from './attributeStore';
import { useClassificationStore } from './classificationStore';
import { useCustomDiagramStore } from './customDiagramStore';
import { createGeochemMappings } from '../utils/calculations/elementNameNormalizer';

// File extension for project files
export const PROJECT_FILE_EXTENSION = '.chem';
export const PROJECT_VERSION = 1;

export interface ProjectMetadata {
    name: string;
    description: string;
    filePath: string | null;
    created: string;
    modified: string;
    dataSource: 'embedded' | 'reference';
    originalDataPath: string | null;
    rowCount: number;
    columnCount: number;
}

export interface RecentProject {
    name: string;
    filePath: string;
    lastOpened: string;
}

export interface ProjectData {
    version: number;
    metadata: ProjectMetadata;
    appState: {
        data: any[];
        columns: any[];
        plots: any[];
        activePlotId?: string | null;
        selectedIndices: number[];
        lockAxes: boolean;
        statsSelectedColumns: string[];
        correlationSelectedColumns: string[];
        geochemMappings?: any[];
    };
    attributeState: {
        color: any;
        shape: any;
        size: any;
        filter: any;
        customEntries: any[];
        globalOpacity: number;
        emphasis: any;
    };
    classificationState?: {
        selectedDiagramId: string | null;
        renderOptions: any;
        customDiagrams?: any[];
    };
    settings: {
        autosaveEnabled: boolean;
        autosaveIntervalMinutes: number;
    };
}

interface ProjectState {
    // Current project info
    currentProject: ProjectMetadata | null;
    isDirty: boolean;
    lastSaved: string | null;

    // File handle for save-in-place (File System Access API)
    // Not persisted - only valid during the session
    fileHandle: FileSystemFileHandle | null;

    // Autosave settings
    autosaveEnabled: boolean;
    autosaveIntervalMinutes: number;
    lastAutosave: string | null;

    // Recent projects
    recentProjects: RecentProject[];

    // Loading state
    isLoading: boolean;
    loadError: string | null;

    // Internal guards (not persisted)
    _isImporting: boolean;
    _isSaving: boolean;
    lastAutosaveError: string | null;

    // Actions
    setCurrentProject: (project: ProjectMetadata | null) => void;
    setDirty: (dirty: boolean) => void;
    setLastSaved: (date: string | null) => void;
    setFileHandle: (handle: FileSystemFileHandle | null) => void;
    addRecentProject: (project: RecentProject) => void;
    removeRecentProject: (filePath: string) => void;
    clearRecentProjects: () => void;

    // Autosave actions
    setAutosaveEnabled: (enabled: boolean) => void;
    setAutosaveInterval: (minutes: number) => void;
    setLastAutosave: (date: string | null) => void;

    // Loading actions
    setLoading: (loading: boolean) => void;
    setLoadError: (error: string | null) => void;

    // Project operations
    createNewProject: (name: string) => void;
    exportProject: () => ProjectData;
    importProject: (data: ProjectData) => boolean;

    // File operations (client-side)
    saveProjectToFile: (saveAs?: boolean) => Promise<boolean>;
    loadProjectFromFile: () => Promise<boolean>;
    triggerAutosave: () => Promise<boolean>;
}

export const useProjectStore = create<ProjectState>()(
    persist(
        (set, get) => ({
            currentProject: null,
            isDirty: false,
            lastSaved: null,
            fileHandle: null,
            autosaveEnabled: true,
            autosaveIntervalMinutes: 5,
            lastAutosave: null,
            recentProjects: [],
            isLoading: false,
            loadError: null,
            _isImporting: false,
            _isSaving: false,
            lastAutosaveError: null,

            setCurrentProject: (project) => set({ currentProject: project }),

            setDirty: (dirty) => set({ isDirty: dirty }),

            setLastSaved: (date) => set({ lastSaved: date }),

            setFileHandle: (handle) => set({ fileHandle: handle }),

            addRecentProject: (project) => set((state) => {
                const filtered = state.recentProjects.filter(p => p.filePath !== project.filePath);
                return {
                    recentProjects: [project, ...filtered].slice(0, 10) // Keep last 10
                };
            }),

            removeRecentProject: (filePath) => set((state) => ({
                recentProjects: state.recentProjects.filter(p => p.filePath !== filePath)
            })),

            clearRecentProjects: () => set({ recentProjects: [] }),

            setAutosaveEnabled: (enabled) => set({ autosaveEnabled: enabled }),

            setAutosaveInterval: (minutes) => set({
                autosaveIntervalMinutes: Math.max(1, Math.min(30, minutes))
            }),

            setLastAutosave: (date) => set({ lastAutosave: date }),

            setLoading: (loading) => set({ isLoading: loading }),

            setLoadError: (error) => set({ loadError: error }),

            createNewProject: (name) => {
                // Reset app state — clear everything including geochem, sampling, filters
                useAppStore.setState({
                    data: [],
                    columns: [],
                    plots: [],
                    selectedIndices: [],
                    activePlotId: null,
                    currentView: 'import',
                    statsSelectedColumns: [],
                    correlationSelectedColumns: [],
                    geochemMappings: [],
                    showGeochemDialog: false,
                    sampleIndices: null,
                    samplingResult: null,
                    samplingConfig: {
                        enabled: false,
                        sampleSize: 10000,
                        method: 'random',
                        outlierColumns: [],
                        classificationColumn: null,
                        drillholeColumn: null,
                        iqrMultiplier: 1.5,
                        seed: null,
                    },
                    columnFilter: 'all',
                    availableFilters: ['all', 'raw'],
                    lockAxes: false,
                });

                // Reset attributes
                useAttributeStore.getState().removeGlobalEntries();
                useAttributeStore.setState({
                    globalOpacity: 1.0,
                    emphasis: {
                        enabled: false,
                        column: null,
                        mode: 'category',
                        threshold: 75,
                        minOpacity: 0.15,
                        boostSize: true,
                        sizeBoostFactor: 1.5,
                    },
                });

                // Reset classification state
                useClassificationStore.setState({
                    selectedDiagramId: null,
                    renderOptions: {
                        style: 'color',
                        showLabels: true,
                        showGrid: true,
                        showData: true,
                        fillOpacity: 0.35,
                    },
                });

                // Set new project metadata and clear file handle
                const now = new Date().toISOString();
                set({
                    currentProject: {
                        name,
                        description: '',
                        filePath: null,
                        created: now,
                        modified: now,
                        dataSource: 'embedded',
                        originalDataPath: null,
                        rowCount: 0,
                        columnCount: 0
                    },
                    fileHandle: null, // Clear file handle for new project
                    isDirty: false,
                    lastSaved: null,
                    loadError: null
                });
            },

            exportProject: () => {
                const appState = useAppStore.getState();
                const attributeState = useAttributeStore.getState();
                const classificationState = useClassificationStore.getState();
                const projectState = get();

                const now = new Date().toISOString();

                const projectData: ProjectData = {
                    version: PROJECT_VERSION,
                    metadata: {
                        name: projectState.currentProject?.name || 'Untitled Project',
                        description: projectState.currentProject?.description || '',
                        filePath: projectState.currentProject?.filePath || null,
                        created: projectState.currentProject?.created || now,
                        modified: now,
                        dataSource: 'embedded',
                        originalDataPath: projectState.currentProject?.originalDataPath || null,
                        rowCount: appState.data.length,
                        columnCount: appState.columns.length
                    },
                    appState: {
                        data: appState.data,
                        columns: appState.columns,
                        plots: appState.plots,
                        activePlotId: appState.activePlotId,
                        selectedIndices: appState.selectedIndices,
                        lockAxes: appState.lockAxes,
                        statsSelectedColumns: appState.statsSelectedColumns,
                        correlationSelectedColumns: appState.correlationSelectedColumns,
                        geochemMappings: appState.geochemMappings
                    },
                    attributeState: {
                        color: attributeState.color,
                        shape: attributeState.shape,
                        size: attributeState.size,
                        filter: attributeState.filter,
                        customEntries: attributeState.customEntries,
                        globalOpacity: attributeState.globalOpacity,
                        emphasis: attributeState.emphasis
                    },
                    classificationState: {
                        selectedDiagramId: classificationState.selectedDiagramId,
                        renderOptions: classificationState.renderOptions,
                        customDiagrams: useCustomDiagramStore.getState().diagrams
                    },
                    settings: {
                        autosaveEnabled: projectState.autosaveEnabled,
                        autosaveIntervalMinutes: projectState.autosaveIntervalMinutes
                    }
                };

                return projectData;
            },

            importProject: (data: ProjectData) => {
                set({ _isImporting: true });
                try {
                    if (data.version !== PROJECT_VERSION) {
                        console.warn('Project version mismatch, attempting import anyway');
                    }

                    // Compute available filters from columns
                    const columns = data.appState.columns || [];
                    const availableFilters: string[] = ['all', 'raw'];
                    const transformTypes = new Set<string>();
                    for (const col of columns) {
                        if (col.transformationType && col.transformationType !== 'raw') {
                            transformTypes.add(col.transformationType);
                        }
                    }
                    availableFilters.push(...Array.from(transformTypes));

                    // Restore app state
                    useAppStore.setState({
                        data: data.appState.data || [],
                        columns: columns,
                        plots: data.appState.plots || [],
                        selectedIndices: data.appState.selectedIndices || [],
                        availableFilters: availableFilters as any,
                        lockAxes: data.appState.lockAxes || false,
                        activePlotId: data.appState.activePlotId ?? data.appState.plots?.[0]?.id ?? null,
                        currentView: data.appState.data?.length > 0 ? 'plots' : 'import',
                        statsSelectedColumns: data.appState.statsSelectedColumns || [],
                        correlationSelectedColumns: data.appState.correlationSelectedColumns || [],
                        geochemMappings: data.appState.geochemMappings || []
                    });

                    // Fallback: reconstruct geochemMappings for older project files
                    if (!data.appState.geochemMappings?.length && columns.length > 0) {
                        const columnNames = columns.map((c: any) => c.name);
                        const mappings = createGeochemMappings(columnNames, columns);
                        useAppStore.setState({ geochemMappings: mappings });
                    }

                    // Restore attribute state — use clean defaults as fallback, never previous session
                    const defaultEmphasis = {
                        enabled: false,
                        column: null,
                        mode: 'category' as const,
                        threshold: 75,
                        minOpacity: 0.15,
                        boostSize: true,
                        sizeBoostFactor: 1.5,
                    };
                    if (data.attributeState) {
                        useAttributeStore.setState({
                            color: data.attributeState.color ?? { field: null, method: 'categorical', numClasses: 5, palette: 'Jet', entries: [{ id: 'default-color', name: 'Default Colour', isDefault: true, isCustom: false, visible: true, type: 'default', color: '#1f77b4', opacity: 1.0, assignedIndices: [], rowCount: 0, visibleRowCount: 0 }] },
                            shape: data.attributeState.shape ?? { field: null, method: 'categorical', numClasses: 5, palette: 'Jet', entries: [{ id: 'default-shape', name: 'Default Shape', isDefault: true, isCustom: false, visible: true, type: 'default', shape: 'circle', opacity: 1.0, assignedIndices: [], rowCount: 0, visibleRowCount: 0 }] },
                            size: data.attributeState.size ?? { field: null, method: 'categorical', numClasses: 5, palette: 'Jet', entries: [{ id: 'default-size', name: 'Default Size', isDefault: true, isCustom: false, visible: true, type: 'default', size: 8, opacity: 1.0, assignedIndices: [], rowCount: 0, visibleRowCount: 0 }] },
                            filter: data.attributeState.filter ?? { field: null, method: 'categorical', numClasses: 5, palette: 'Jet', entries: [{ id: 'default-filter', name: 'Default Filter', isDefault: true, isCustom: false, visible: true, type: 'default', opacity: 1.0, assignedIndices: [], rowCount: 0, visibleRowCount: 0 }] },
                            customEntries: data.attributeState.customEntries ?? [],
                            globalOpacity: data.attributeState.globalOpacity ?? 1.0,
                            emphasis: data.attributeState.emphasis ?? defaultEmphasis,
                        });
                    } else {
                        // No attribute state in file — reset to clean defaults
                        useAttributeStore.getState().removeGlobalEntries();
                        useAttributeStore.setState({ globalOpacity: 1.0, emphasis: defaultEmphasis });
                    }

                    // Restore classification state
                    if (data.classificationState) {
                        // Restore custom diagrams if present
                        if (data.classificationState.customDiagrams?.length) {
                            const customStore = useCustomDiagramStore.getState();
                            for (const d of data.classificationState.customDiagrams) {
                                if (!customStore.getDiagram(d.id)) {
                                    customStore.addDiagram(d);
                                }
                            }
                            // Refresh classification store to include custom diagrams
                            useClassificationStore.getState().refreshCustomDiagrams();
                        }

                        useClassificationStore.setState({
                            selectedDiagramId: data.classificationState.selectedDiagramId || null,
                            renderOptions: data.classificationState.renderOptions || {
                                style: 'color',
                                showLabels: true,
                                showGrid: true,
                                showData: true,
                                fillOpacity: 0.35
                            }
                        });
                    }

                    // Restore settings
                    if (data.settings) {
                        set({
                            autosaveEnabled: data.settings.autosaveEnabled ?? true,
                            autosaveIntervalMinutes: data.settings.autosaveIntervalMinutes ?? 5
                        });
                    }

                    // Set project metadata and clear importing flag
                    set({
                        currentProject: data.metadata,
                        isDirty: false,
                        lastSaved: data.metadata.modified,
                        loadError: null,
                        _isImporting: false,
                    });

                    // Sync to QGIS after loading project
                    useAppStore.getState().syncToQgis();

                    return true;
                } catch (error) {
                    console.error('Failed to import project:', error);
                    set({
                        loadError: 'Failed to import project: ' + (error as Error).message,
                        _isImporting: false,
                    });
                    return false;
                }
            },

            saveProjectToFile: async (saveAs: boolean = false) => {
                // Concurrency guard — prevent overlapping saves
                if (get()._isSaving) return false;
                set({ _isSaving: true });

                const state = get();
                const projectData = state.exportProject();
                const projectName = projectData.metadata.name || 'project';
                const suggestedFileName = `${projectName.replace(/[^a-z0-9]/gi, '_')}${PROJECT_FILE_EXTENSION}`;

                try {
                    set({ isLoading: true });

                    const jsonString = JSON.stringify(projectData);
                    const blob = new Blob([jsonString], { type: 'application/json' });

                    // Try to use existing file handle for save-in-place (not "Save As")
                    if (!saveAs && state.fileHandle) {
                        try {
                            console.log('[Save] Using existing file handle for save-in-place');
                            const writable = await state.fileHandle.createWritable();
                            await writable.write(blob);
                            await writable.close();

                            const now = new Date().toISOString();
                            set((s) => ({
                                isDirty: false,
                                lastSaved: now,
                                isLoading: false,
                                currentProject: { ...(s.currentProject ?? projectData.metadata), modified: now }
                            }));

                            console.log('[Save] Project saved successfully to existing location');
                            return true;
                        } catch (err: any) {
                            console.warn('[Save] Failed to write to existing handle, will prompt for new location:', err.message);
                            // Fall through to show picker
                        }
                    }

                    // No handle, saveAs requested, or handle failed - show picker
                    if ('showSaveFilePicker' in window) {
                        try {
                            console.log('[Save] Showing save file picker');
                            const handle = await (window as any).showSaveFilePicker({
                                suggestedName: suggestedFileName,
                                types: [{
                                    description: 'Geochem Project Files',
                                    accept: { 'application/json': [PROJECT_FILE_EXTENSION] }
                                }]
                            });

                            // Derive project name from the chosen file name
                            const derivedName = handle.name.replace(/\.[^.]+$/, '');
                            projectData.metadata.name = derivedName;

                            // Write with the updated name in metadata
                            const updatedBlob = new Blob([JSON.stringify(projectData)], { type: 'application/json' });
                            const writable = await handle.createWritable();
                            await writable.write(updatedBlob);
                            await writable.close();

                            const now = new Date().toISOString();
                            set((s) => ({
                                fileHandle: handle, // Store handle for future saves
                                isDirty: false,
                                lastSaved: now,
                                isLoading: false,
                                currentProject: { ...(s.currentProject ?? projectData.metadata), name: derivedName, modified: now, filePath: handle.name }
                            }));

                            // Add to recent projects
                            state.addRecentProject({
                                name: derivedName,
                                filePath: handle.name,
                                lastOpened: now
                            });

                            console.log('[Save] Project saved to new location:', handle.name);
                            return true;
                        } catch (err: any) {
                            // User cancelled
                            if (err.name === 'AbortError') {
                                set({ isLoading: false });
                                return false;
                            }
                            console.warn('[Save] File System Access API failed, falling back to download:', err.message);
                            // Fall through to legacy method
                        }
                    }

                    // Legacy download method (Firefox, Safari, or API failure)
                    console.log('[Save] Using legacy download method');
                    const link = document.createElement('a');
                    const url = URL.createObjectURL(blob);
                    link.setAttribute('href', url);
                    link.setAttribute('download', suggestedFileName);
                    link.style.visibility = 'hidden';
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(url);

                    // Update project state (no fileHandle for legacy method)
                    const legacyName = suggestedFileName.replace(/\.[^.]+$/, '');
                    const now = new Date().toISOString();
                    set((s) => ({
                        isDirty: false,
                        lastSaved: now,
                        isLoading: false,
                        currentProject: { ...(s.currentProject ?? projectData.metadata), name: legacyName, modified: now, filePath: suggestedFileName }
                    }));

                    // Add to recent projects
                    state.addRecentProject({
                        name: legacyName,
                        filePath: suggestedFileName,
                        lastOpened: now
                    });

                    return true;
                } catch (error) {
                    console.error('Failed to save project:', error);
                    set({
                        loadError: 'Failed to save project: ' + (error as Error).message,
                        isLoading: false
                    });
                    return false;
                } finally {
                    set({ _isSaving: false });
                }
            },

            loadProjectFromFile: async () => {
                return new Promise((resolve) => {
                    set({ isLoading: true, loadError: null });

                    // Use File System Access API if available
                    if ('showOpenFilePicker' in window) {
                        (async () => {
                            try {
                                const [handle] = await (window as any).showOpenFilePicker({
                                    types: [{
                                        description: 'Geochem Project Files',
                                        accept: { 'application/json': [PROJECT_FILE_EXTENSION, '.gcp', '.json'] }
                                    }]
                                });
                                const file = await handle.getFile();
                                const text = await file.text();
                                const data = JSON.parse(text) as ProjectData;

                                const success = get().importProject(data);

                                if (success) {
                                    // Store file handle for save-in-place and update file path
                                    set((s) => ({
                                        fileHandle: handle, // Store handle for future saves!
                                        currentProject: s.currentProject ? {
                                            ...s.currentProject,
                                            filePath: file.name
                                        } : null
                                    }));

                                    // Add to recent projects
                                    get().addRecentProject({
                                        name: data.metadata.name,
                                        filePath: file.name,
                                        lastOpened: new Date().toISOString()
                                    });

                                    console.log('[Load] Project loaded with file handle for save-in-place:', file.name);
                                }

                                set({ isLoading: false });
                                resolve(success);
                            } catch (err: any) {
                                if (err.name === 'AbortError') {
                                    set({ isLoading: false });
                                    resolve(false);
                                    return;
                                }
                                // Fall through to legacy method
                                legacyLoadMethod();
                            }
                        })();
                        return;
                    }

                    legacyLoadMethod();

                    function legacyLoadMethod() {
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.accept = `${PROJECT_FILE_EXTENSION},.gcp,.json`;

                        input.onchange = async (e) => {
                            const file = (e.target as HTMLInputElement).files?.[0];
                            if (!file) {
                                set({ isLoading: false });
                                resolve(false);
                                return;
                            }

                            try {
                                const text = await file.text();
                                const data = JSON.parse(text) as ProjectData;

                                const success = get().importProject(data);

                                if (success) {
                                    // Update file path (no file handle in legacy mode)
                                    set((s) => ({
                                        fileHandle: null, // No handle in legacy mode
                                        currentProject: s.currentProject ? {
                                            ...s.currentProject,
                                            filePath: file.name
                                        } : null
                                    }));

                                    // Add to recent projects
                                    get().addRecentProject({
                                        name: data.metadata.name,
                                        filePath: file.name,
                                        lastOpened: new Date().toISOString()
                                    });

                                    console.log('[Load] Project loaded via legacy method (no save-in-place):', file.name);
                                }

                                set({ isLoading: false });
                                resolve(success);
                            } catch (error) {
                                console.error('Failed to load project file:', error);
                                set({
                                    loadError: 'Failed to load project: Invalid file format',
                                    isLoading: false
                                });
                                resolve(false);
                            }
                        };

                        input.oncancel = () => {
                            set({ isLoading: false });
                            resolve(false);
                        };

                        input.click();
                    }
                });
            },

            triggerAutosave: async () => {
                const state = get();

                // Only autosave if dirty AND we have a file handle (can save in place)
                if (!state.isDirty || !state.fileHandle) {
                    return false;
                }

                console.log('[Autosave] Saving project to existing location...');
                const success = await state.saveProjectToFile(false); // false = not "Save As"

                if (success) {
                    set({ lastAutosave: new Date().toISOString(), lastAutosaveError: null });
                    console.log('[Autosave] Project saved successfully');
                } else {
                    const errMsg = 'Autosave failed — please save manually';
                    set({ lastAutosaveError: errMsg, loadError: errMsg });
                    console.warn('[Autosave] Failed to save');
                }

                return success;
            }
        }),
        {
            name: 'project-storage',
            version: 2,
            partialize: (state) => ({
                recentProjects: state.recentProjects,
                autosaveEnabled: state.autosaveEnabled,
                autosaveIntervalMinutes: state.autosaveIntervalMinutes
            })
        }
    )
);

// Autosave manager singleton
class AutosaveManager {
    private intervalId: ReturnType<typeof setInterval> | null = null;
    private started = false;

    start() {
        if (this.started) return;
        this.started = true;

        const state = useProjectStore.getState();
        if (!state.autosaveEnabled) return;

        this.setupInterval(state.autosaveIntervalMinutes);
    }

    private setupInterval(minutes: number) {
        this.clearInterval();
        console.log(`[Autosave] Starting with ${minutes} minute interval`);

        this.intervalId = setInterval(async () => {
            const state = useProjectStore.getState();
            // Only autosave if enabled, dirty, and we have a file handle (can save in place)
            if (state.autosaveEnabled && state.isDirty && state.fileHandle) {
                await state.triggerAutosave();
            }
        }, minutes * 60 * 1000);
    }

    private clearInterval() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    stop() {
        this.clearInterval();
        this.started = false;
    }

    restart() {
        const state = useProjectStore.getState();
        if (state.autosaveEnabled) {
            this.setupInterval(state.autosaveIntervalMinutes);
        } else {
            this.clearInterval();
        }
    }
}

export const autosaveManager = new AutosaveManager();

// Subscribe to app changes to mark project as dirty
// Guard: skip during import to avoid false dirty flags
useAppStore.subscribe((state, prevState) => {
    if (useProjectStore.getState()._isImporting) return;
    if (
        state.data !== prevState.data ||
        state.columns !== prevState.columns ||
        state.plots !== prevState.plots ||
        state.geochemMappings !== prevState.geochemMappings ||
        state.selectedIndices !== prevState.selectedIndices ||
        state.lockAxes !== prevState.lockAxes
    ) {
        useProjectStore.getState().setDirty(true);
    }
});

useAttributeStore.subscribe((state, prevState) => {
    if (useProjectStore.getState()._isImporting) return;
    if (
        state.color !== prevState.color ||
        state.shape !== prevState.shape ||
        state.size !== prevState.size ||
        state.filter !== prevState.filter ||
        state.customEntries !== prevState.customEntries ||
        state.globalOpacity !== prevState.globalOpacity ||
        state.emphasis !== prevState.emphasis
    ) {
        useProjectStore.getState().setDirty(true);
    }
});

useClassificationStore.subscribe((state, prevState) => {
    if (useProjectStore.getState()._isImporting) return;
    if (
        state.selectedDiagramId !== prevState.selectedDiagramId ||
        state.renderOptions !== prevState.renderOptions
    ) {
        useProjectStore.getState().setDirty(true);
    }
});

// Subscribe to autosave settings changes
useProjectStore.subscribe((state, prevState) => {
    if (state.autosaveEnabled !== prevState.autosaveEnabled ||
        state.autosaveIntervalMinutes !== prevState.autosaveIntervalMinutes) {
        autosaveManager.restart();
    }
});
