import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useAppStore } from './appStore';
import { useAttributeStore } from './attributeStore';

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
        selectedIndices: number[];
        lockAxes: boolean;
        statsSelectedColumns: string[];
        correlationSelectedColumns: string[];
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

    // Autosave settings
    autosaveEnabled: boolean;
    autosaveIntervalMinutes: number;
    lastAutosave: string | null;

    // Recent projects
    recentProjects: RecentProject[];

    // Loading state
    isLoading: boolean;
    loadError: string | null;

    // Actions
    setCurrentProject: (project: ProjectMetadata | null) => void;
    setDirty: (dirty: boolean) => void;
    setLastSaved: (date: string | null) => void;
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
    saveProjectToFile: (savePath?: string) => Promise<boolean>;
    loadProjectFromFile: () => Promise<boolean>;
    triggerAutosave: () => Promise<boolean>;
}

export const useProjectStore = create<ProjectState>()(
    persist(
        (set, get) => ({
            currentProject: null,
            isDirty: false,
            lastSaved: null,
            autosaveEnabled: true,
            autosaveIntervalMinutes: 5,
            lastAutosave: null,
            recentProjects: [],
            isLoading: false,
            loadError: null,

            setCurrentProject: (project) => set({ currentProject: project }),

            setDirty: (dirty) => set({ isDirty: dirty }),

            setLastSaved: (date) => set({ lastSaved: date }),

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
                // Reset app state
                const attributeStore = useAttributeStore.getState();

                // Clear data
                useAppStore.setState({
                    data: [],
                    columns: [],
                    plots: [],
                    selectedIndices: [],
                    activePlotId: null,
                    currentView: 'import',
                    statsSelectedColumns: [],
                    correlationSelectedColumns: []
                });

                // Reset attributes
                attributeStore.removeGlobalEntries();

                // Set new project metadata
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
                    isDirty: false,
                    lastSaved: null,
                    loadError: null
                });
            },

            exportProject: () => {
                const appState = useAppStore.getState();
                const attributeState = useAttributeStore.getState();
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
                        selectedIndices: appState.selectedIndices,
                        lockAxes: appState.lockAxes,
                        statsSelectedColumns: appState.statsSelectedColumns,
                        correlationSelectedColumns: appState.correlationSelectedColumns
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
                    settings: {
                        autosaveEnabled: projectState.autosaveEnabled,
                        autosaveIntervalMinutes: projectState.autosaveIntervalMinutes
                    }
                };

                return projectData;
            },

            importProject: (data: ProjectData) => {
                try {
                    if (data.version !== PROJECT_VERSION) {
                        console.warn('Project version mismatch, attempting import anyway');
                    }

                    // Restore app state
                    useAppStore.setState({
                        data: data.appState.data || [],
                        columns: data.appState.columns || [],
                        plots: data.appState.plots || [],
                        selectedIndices: data.appState.selectedIndices || [],
                        lockAxes: data.appState.lockAxes || false,
                        activePlotId: data.appState.plots?.[0]?.id || null,
                        currentView: data.appState.data?.length > 0 ? 'plots' : 'import',
                        statsSelectedColumns: data.appState.statsSelectedColumns || [],
                        correlationSelectedColumns: data.appState.correlationSelectedColumns || []
                    });

                    // Restore attribute state
                    const attributeStore = useAttributeStore.getState();
                    if (data.attributeState) {
                        useAttributeStore.setState({
                            color: data.attributeState.color || attributeStore.color,
                            shape: data.attributeState.shape || attributeStore.shape,
                            size: data.attributeState.size || attributeStore.size,
                            filter: data.attributeState.filter || attributeStore.filter,
                            customEntries: data.attributeState.customEntries || [],
                            globalOpacity: data.attributeState.globalOpacity ?? 1.0,
                            emphasis: data.attributeState.emphasis || attributeStore.emphasis
                        });
                    }

                    // Restore settings
                    if (data.settings) {
                        set({
                            autosaveEnabled: data.settings.autosaveEnabled ?? true,
                            autosaveIntervalMinutes: data.settings.autosaveIntervalMinutes ?? 5
                        });
                    }

                    // Set project metadata
                    set({
                        currentProject: data.metadata,
                        isDirty: false,
                        lastSaved: data.metadata.modified,
                        loadError: null
                    });

                    return true;
                } catch (error) {
                    console.error('Failed to import project:', error);
                    set({ loadError: 'Failed to import project: ' + (error as Error).message });
                    return false;
                }
            },

            saveProjectToFile: async (savePath?: string) => {
                const state = get();
                const projectData = state.exportProject();
                const projectName = projectData.metadata.name || 'project';
                const fileName = savePath || `${projectName.replace(/[^a-z0-9]/gi, '_')}${PROJECT_FILE_EXTENSION}`;

                try {
                    set({ isLoading: true });

                    const jsonString = JSON.stringify(projectData);
                    const blob = new Blob([jsonString], { type: 'application/json' });

                    // Use File System Access API if available for better UX
                    if ('showSaveFilePicker' in window && !savePath) {
                        try {
                            const handle = await (window as any).showSaveFilePicker({
                                suggestedName: fileName,
                                types: [{
                                    description: 'Geochem Project Files',
                                    accept: { 'application/json': [PROJECT_FILE_EXTENSION] }
                                }]
                            });
                            const writable = await handle.createWritable();
                            await writable.write(blob);
                            await writable.close();

                            const now = new Date().toISOString();
                            set((s) => ({
                                isDirty: false,
                                lastSaved: now,
                                isLoading: false,
                                currentProject: s.currentProject ? {
                                    ...s.currentProject,
                                    modified: now,
                                    filePath: handle.name
                                } : null
                            }));

                            // Add to recent projects
                            state.addRecentProject({
                                name: projectData.metadata.name,
                                filePath: handle.name,
                                lastOpened: now
                            });

                            return true;
                        } catch (err: any) {
                            // User cancelled or API not supported
                            if (err.name === 'AbortError') {
                                set({ isLoading: false });
                                return false;
                            }
                            // Fall through to legacy method
                        }
                    }

                    // Legacy download method
                    const link = document.createElement('a');
                    const url = URL.createObjectURL(blob);
                    link.setAttribute('href', url);
                    link.setAttribute('download', fileName);
                    link.style.visibility = 'hidden';
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(url);

                    // Update project state
                    const now = new Date().toISOString();
                    set((s) => ({
                        isDirty: false,
                        lastSaved: now,
                        isLoading: false,
                        currentProject: s.currentProject ? {
                            ...s.currentProject,
                            modified: now,
                            filePath: fileName
                        } : null
                    }));

                    // Add to recent projects
                    state.addRecentProject({
                        name: projectData.metadata.name,
                        filePath: fileName,
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
                                    // Update file path
                                    set((s) => ({
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
                                    // Update file path
                                    set((s) => ({
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
                if (!state.isDirty || !state.currentProject?.filePath) {
                    return false;
                }

                console.log('[Autosave] Saving project...');
                const success = await state.saveProjectToFile(state.currentProject.filePath);

                if (success) {
                    set({ lastAutosave: new Date().toISOString() });
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
            if (state.autosaveEnabled && state.isDirty && state.currentProject?.filePath) {
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
useAppStore.subscribe((state, prevState) => {
    if (
        state.data !== prevState.data ||
        state.columns !== prevState.columns ||
        state.plots !== prevState.plots
    ) {
        useProjectStore.getState().setDirty(true);
    }
});

useAttributeStore.subscribe((state, prevState) => {
    if (
        state.color !== prevState.color ||
        state.shape !== prevState.shape ||
        state.size !== prevState.size ||
        state.customEntries !== prevState.customEntries
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
