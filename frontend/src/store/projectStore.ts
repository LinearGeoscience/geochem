import { create } from 'zustand';
import { useCheckpointStore, type Checkpoint } from './checkpointStore';
import { useReportStore, type ReportData } from './reportStore';
import { persist } from 'zustand/middleware';
import { useAppStore } from './appStore';
import { useAttributeStore, migrateConfigV9, DEFAULT_VALUE_FILTER } from './attributeStore';
import { useClassificationStore } from './classificationStore';
import { useCustomDiagramStore } from './customDiagramStore';
import { useAuditStore } from './auditStore';
import { useTransformationStore } from './transformationStore';
import { useCalculationStore } from './calculationStore';
import { useQAQCStore } from './qaqcStore';
import { useVectoringStore } from './vectoringStore';
import { createGeochemMappings } from '../utils/calculations/elementNameNormalizer';
import type { ColumnGeochemMapping } from '../types/associations';
import { DEFAULT_BDL_FACTOR } from '../utils/censoring';
import { encodeDataset, datasetFromProject, EncodedDataset } from '../utils/projectFormat';
import { readProjectFile, serializeProjectWithStore } from '../utils/projectIO';
import { useHistoryStore } from './historyStore';
import type { ColumnarStore } from '../types/columnarData';
import { emptyColumnarStore } from '../types/columnarData';
import { saveSnapshot, clearSnapshot } from '../utils/projectSnapshot';
import {
    projectFilesAvailable, openProjectFile, saveProjectFile, listRecentFiles, addRecentFile, removeRecentFile,
    chooseProjectToOpen, chooseProjectSavePath, folderOf, stemOf, autosaveProjectFile, readRecoveryFile,
    discardRecoveryFile,
} from '../services/projectFiles';
import { AuditEntry } from '../types/audit';
import { useWorkspaceStore } from './workspaceStore';
import { layoutSignature, SerializedLayout } from '../utils/workspaceLayout';

// File extension for project files
export const PROJECT_FILE_EXTENSION = '.chem';
// v3 (Phase 7): adds analysisState (transformation/calculation/QAQC/vectoring
// configs) — previously these lived only in browser localStorage and did NOT
// travel with the project file
// v4 (Phase 16): columnar `appState.dataset` instead of row objects, and the
// file is gzip-compressed (see utils/projectFormat.ts). v1-v3 still load.
// v5 (Phase 25): the classification diagram is a per-plot setting
// (`settings.diagramId`); the old global classificationState.selectedDiagramId
// is copied onto classification plots that have none.
export const PROJECT_VERSION = 9;

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
    /** Full path when saved/opened through the backend, otherwise the file name only */
    filePath: string;
    lastOpened: string;
    /** Full path on disk (backend file service): the project opens in one click */
    path?: string;
    /** False when the file is no longer at `path` */
    exists?: boolean;
    /** An autosave newer than the saved file is waiting */
    hasRecovery?: boolean;
}

/** A recovery copy the user can restore (backend file service) */
export interface RecoveryOffer {
    /** 'project': autosave of a saved project newer than its file; 'unsaved': a never-saved session */
    kind: 'project' | 'unsaved';
    path?: string;
    key?: string;
    modified: string;
    name: string;
}

export interface ProjectData {
    version: number;
    /** v6+: dock workspace arrangement (null = default layout). */
    workspace?: { version: 1; layout: SerializedLayout | null };
    /** v7+: attribute checkpoints */
    checkpoints?: Checkpoint[];
    /** v8+: report notebook (notes and figures) */
    report?: ReportData;
    metadata: ProjectMetadata;
    appState: {
        /** v1-v3: row objects */
        data?: any[];
        /** v4+: column-wise dataset */
        dataset?: EncodedDataset;
        columns: any[];
        plots: any[];
        activePlotId?: string | null;
        selectedIndices: number[];
        lockAxes: boolean;
        lockFullExtent?: boolean;
        statsSelectedColumns: string[];
        correlationSelectedColumns: string[];
        geochemMappings?: any[];
        /** Projection of the East/North columns (optional; absent = unknown) */
        datasetEpsg?: string | null;
    };
    attributeState: {
        color: any;
        shape: any;
        size: any;
        filter: any;
        customEntries: any[];
        globalOpacity: number;
        emphasis: any;
        /** v9+ */
        valueFilter?: any;
    };
    classificationState?: {
        /** v4 and earlier only (now per plot) */
        selectedDiagramId?: string | null;
        renderOptions: any;
        customDiagrams?: any[];
    };
    /** v3+: analysis configs that previously only lived in browser localStorage */
    analysisState?: {
        transformation?: {
            customAmalgamations: any[];
            customAssociations: any[];
            zeroStrategy: any;
            customZeroValue: number;
            chiPowerLambda: number;
        };
        calculation?: {
            customCalculations: any[];
            savedCalculations: any[];
        };
        qaqc?: {
            sampleIdColumn: string | null;
            batchColumn: string | null;
            duplicatePairColumn: string | null;
            thresholds: any;
            standardReferences: any[];
            detectionLimits: any;
            selectedElements: string[];
        };
        vectoring?: {
            selectedDepositType: string | null;
        };
    };
    settings: {
        autosaveEnabled: boolean;
        autosaveIntervalMinutes: number;
        /** Below-detection substitution factor (null = treat as missing). Absent in older files. */
        bdlFactor?: number | null;
    };
    auditLog?: AuditEntry[];
}

interface ProjectState {
    // Current project info
    currentProject: ProjectMetadata | null;
    isDirty: boolean;
    lastSaved: string | null;

    // File handle for save-in-place (File System Access API)
    // Not persisted - only valid during the session
    fileHandle: FileSystemFileHandle | null;
    /** Full path of the project file (backend file service); null = not saved yet */
    projectPath: string | null;
    /** Folder the Open/Save dialogs start in (persisted) */
    lastFolder: string | null;
    /** Open request from anywhere in the UI; the File menu runs it after the unsaved-changes check */
    openRequest: { path: string | null; at: number } | null;
    /** Recovery copy key of a project not yet saved to a file */
    sessionKey: string;
    /** Newer autosave waiting to be restored */
    recoveryOffer: RecoveryOffer | null;

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
    /** omitDataset: leave appState.dataset out (the save worker encodes it from the live store) */
    exportProject: (opts?: { omitDataset?: boolean }) => ProjectData;
    /** `store`: dataset already decoded (by readProjectFile); otherwise taken from `data`. */
    importProject: (data: ProjectData, store?: ColumnarStore) => boolean;

    // File operations (client-side)
    /** interactive=false (autosave) never opens a picker or triggers a download */
    saveProjectToFile: (saveAs?: boolean, interactive?: boolean) => Promise<boolean>;
    loadProjectFromFile: () => Promise<boolean>;
    /** Open a project by full path (backend file service) */
    openProjectPath: (path: string) => Promise<boolean>;
    /** Reload recent projects from the backend (full paths, missing files flagged) */
    refreshRecents: () => Promise<void>;
    /** Ask the File menu to open a project (path) or show the Open dialog (null) */
    requestOpen: (path: string | null) => void;
    clearOpenRequest: () => void;
    setRecoveryOffer: (offer: RecoveryOffer | null) => void;
    /** Load the offered recovery copy (stays unsaved until Save) */
    restoreRecovery: () => Promise<boolean>;
    /** Close the offer; discard=true deletes the recovery copy */
    dismissRecovery: (discard: boolean) => Promise<void>;
    triggerAutosave: () => Promise<boolean>;
}

/**
 * Re-run element detection for the loaded columns, keeping only the saved
 * mappings the user actually set (confirmed, element override or unit
 * override). Detection fixes therefore reach older project files, while
 * deliberate user choices survive.
 */
/**
 * v4 → v5: the global classification diagram becomes each classification
 * plot's own `settings.diagramId` (exported for tests).
 */
export function migrateV4toV5(data: ProjectData): void {
    const globalId = data.classificationState?.selectedDiagramId ?? null;
    const plots = data.appState?.plots ?? [];
    if (globalId) {
        for (const p of plots) {
            if (p.type === 'classification' && !p.settings?.diagramId) {
                p.settings = { ...(p.settings ?? {}), diagramId: globalId };
            }
        }
    }
    if (data.classificationState) delete data.classificationState.selectedDiagramId;
    data.version = 5;
}

/** v5 → v6: the dock workspace layout is saved; older files get the default. */
export function migrateV5toV6(data: ProjectData): void {
    if (!data.workspace) data.workspace = { version: 1, layout: null };
    data.version = 6;
}

/** v6 → v7: attribute checkpoints are saved; older files have none. */
export function migrateV6toV7(data: ProjectData): void {
    if (!data.checkpoints) data.checkpoints = [];
    data.version = 7;
}

/** v7 → v8: the report notebook is saved; older files start with an empty one. */
export function migrateV7toV8(data: ProjectData): void {
    if (!data.report) data.report = { title: '', author: '', items: [] };
    data.version = 8;
}

/**
 * v8 → v9: attribute classes get keys (so live reclassify keeps edits),
 * 'manual' becomes hand-edited breaks, the value filter is saved.
 */
export function migrateV8toV9(data: ProjectData): void {
    const a = data.attributeState;
    if (a) {
        for (const t of ['color', 'shape', 'size', 'filter'] as const) if (a[t]) a[t] = migrateConfigV9(a[t]);
        if (!a.valueFilter) a.valueFilter = { ...DEFAULT_VALUE_FILTER };
    }
    data.version = 9;
}

function rebuildGeochemMappings(columns: any[], saved: ColumnGeochemMapping[]): ColumnGeochemMapping[] {
    if (columns.length === 0) return [];
    const fresh = createGeochemMappings(columns.map((c: any) => c.name), columns);
    const userSet = new Map(
        saved
            .filter(m => m.isConfirmed || m.userOverride || m.userUnit)
            .map(m => [m.originalName, m] as const)
    );
    return fresh.map(m => userSet.get(m.originalName) ?? m);
}

// Incremented whenever the project is marked dirty; lets an in-flight save
// detect edits that happened during its await and keep isDirty set.
let dirtyGeneration = 0;
// dirtyGeneration at the last successful autosave (skip autosaves with nothing new)
let autosavedGeneration = -1;
let autosaving = false;

/** Key of the recovery copy for a project not saved to a file yet */
function newSessionKey(): string {
    return `untitled-${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useProjectStore = create<ProjectState>()(
    persist(
        (set, get) => ({
            currentProject: null,
            isDirty: false,
            lastSaved: null,
            fileHandle: null,
            projectPath: null,
            lastFolder: null,
            openRequest: null,
            sessionKey: newSessionKey(),
            recoveryOffer: null,
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

            setDirty: (dirty) => {
                if (dirty) dirtyGeneration++;
                set({ isDirty: dirty });
            },

            setLastSaved: (date) => set({ lastSaved: date }),

            setFileHandle: (handle) => set({ fileHandle: handle }),

            addRecentProject: (project) => {
                set((state) => {
                    const filtered = state.recentProjects.filter(p => p.filePath !== project.filePath);
                    return {
                        recentProjects: [project, ...filtered].slice(0, 10) // Keep last 10
                    };
                });
                if (project.path) {
                    addRecentFile(project.path, project.name).then(() => get().refreshRecents()).catch(() => { /* list stays local */ });
                }
            },

            removeRecentProject: (filePath) => {
                const entry = get().recentProjects.find(p => p.filePath === filePath);
                set((state) => ({
                    recentProjects: state.recentProjects.filter(p => p.filePath !== filePath)
                }));
                if (entry?.path) removeRecentFile(entry.path).catch(() => { /* best-effort */ });
            },

            refreshRecents: async () => {
                if (!(await projectFilesAvailable())) return;
                try {
                    const disk = await listRecentFiles();
                    set({
                        recentProjects: disk.map(r => ({
                            name: r.name, filePath: r.path, path: r.path, lastOpened: r.lastOpened, exists: r.exists,
                            hasRecovery: r.hasRecovery,
                        })),
                    });
                } catch { /* keep the local list */ }
            },

            requestOpen: (path) => set({ openRequest: { path, at: Date.now() } }),
            clearOpenRequest: () => set({ openRequest: null }),

            setRecoveryOffer: (offer) => set({ recoveryOffer: offer }),

            restoreRecovery: async () => {
                const offer = get().recoveryOffer;
                if (!offer) return false;
                set({ isLoading: true, loadError: null, recoveryOffer: null });
                try {
                    const blob = await readRecoveryFile(offer.path ?? null, offer.key);
                    const { project: data, store } = await readProjectFile(blob);
                    if (!get().importProject(data as ProjectData, store)) {
                        set({ isLoading: false });
                        return false;
                    }
                    set((s) => ({
                        isLoading: false,
                        projectPath: offer.path ?? null,
                        // Keep autosaving into the same recovery copy
                        sessionKey: offer.key ?? s.sessionKey,
                        currentProject: s.currentProject ? { ...s.currentProject, filePath: offer.path ?? null } : null,
                    }));
                    // Restored work is not in the project file yet
                    get().setDirty(true);
                    autosavedGeneration = -1;
                    return true;
                } catch (err: any) {
                    set({ isLoading: false, loadError: 'Could not restore the autosave: ' + (err?.message ?? err) });
                    return false;
                }
            },

            dismissRecovery: async (discard) => {
                const offer = get().recoveryOffer;
                set({ recoveryOffer: null });
                if (offer && discard) {
                    await discardRecoveryFile(offer.path ?? null, offer.key).catch(() => { /* best-effort */ });
                    get().refreshRecents();
                }
            },

            openProjectPath: async (path) => {
                set({ isLoading: true, loadError: null });
                try {
                    const { blob, recoveryModified } = await openProjectFile(path);
                    const { project: data, store } = await readProjectFile(blob);
                    const success = get().importProject(data as ProjectData, store);
                    if (success) {
                        const name = data.metadata?.name || stemOf(path);
                        set((s) => ({
                            fileHandle: null,
                            projectPath: path,
                            lastFolder: folderOf(folderOf(path)),
                            currentProject: s.currentProject ? { ...s.currentProject, name, filePath: path } : null,
                            // Autosave from a session that ended without saving
                            recoveryOffer: recoveryModified ? { kind: 'project', path, modified: recoveryModified, name } : null,
                        }));
                        get().addRecentProject({ name, filePath: path, path, lastOpened: new Date().toISOString(), exists: true });
                    }
                    set({ isLoading: false });
                    return success;
                } catch (err: any) {
                    const missing = err?.status === 404;
                    set({
                        isLoading: false,
                        loadError: missing
                            ? `The project is no longer at ${path} - it may have been moved or renamed. Use Open to find it.`
                            : 'Failed to open project: ' + (err?.message ?? err),
                    });
                    if (missing) get().refreshRecents();
                    return false;
                }
            },

            clearRecentProjects: () => set({ recentProjects: [] }),

            setAutosaveEnabled: (enabled) => set({ autosaveEnabled: enabled }),

            setAutosaveInterval: (minutes) => set({
                autosaveIntervalMinutes: Math.max(1, Math.min(30, minutes))
            }),

            setLastAutosave: (date) => set({ lastAutosave: date }),

            setLoading: (loading) => set({ isLoading: loading }),

            setLoadError: (error) => set({ loadError: error }),

            createNewProject: (name) => {
                useWorkspaceStore.getState().resetLayout();
                // Reset app state — clear everything including geochem, sampling, filters
                useAppStore.setState({
                    columnarData: emptyColumnarStore(),
                    _sampleIndicesArray: null,
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
                    lockFullExtent: false,
                });

                useCheckpointStore.getState().setCheckpoints([]);
                useReportStore.getState().setReport(undefined);
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
                    renderOptions: {
                        style: 'color',
                        showLabels: true,
                        showGrid: true,
                        showData: true,
                        fillOpacity: 0.2,
                    },
                });

                // Reset audit log
                useAuditStore.getState().clearAudit();

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
                    projectPath: null,
                    sessionKey: newSessionKey(),
                    recoveryOffer: null,
                    isDirty: false,
                    lastSaved: null,
                    loadError: null
                });

                // The old session's recovery snapshot no longer applies
                clearSnapshot().catch(() => { /* best-effort */ });
                useHistoryStore.getState().clear();
            },

            exportProject: (opts) => {
                const appState = useAppStore.getState();
                const attributeState = useAttributeStore.getState();
                const classificationState = useClassificationStore.getState();
                const projectState = get();

                const now = new Date().toISOString();

                const projectData: ProjectData = {
                    version: PROJECT_VERSION,
                    workspace: { version: 1, layout: useWorkspaceStore.getState().layout },
                    checkpoints: useCheckpointStore.getState().checkpoints,
                    report: (({ title, author, items }) => ({ title, author, items }))(useReportStore.getState()),
                    metadata: {
                        name: projectState.currentProject?.name || 'Untitled Project',
                        description: projectState.currentProject?.description || '',
                        filePath: projectState.currentProject?.filePath || null,
                        created: projectState.currentProject?.created || now,
                        modified: now,
                        dataSource: 'embedded',
                        originalDataPath: projectState.currentProject?.originalDataPath || null,
                        rowCount: appState.columnarData.rowCount,
                        columnCount: appState.columns.length
                    },
                    appState: {
                        // Stored values (-DL), not substituted; column-wise (v4)
                        dataset: opts?.omitDataset ? undefined : encodeDataset(appState.columnarData, appState.columns.map(c => c.name)),
                        columns: appState.columns,
                        plots: appState.plots,
                        activePlotId: appState.activePlotId,
                        selectedIndices: appState.selectedIndices,
                        lockAxes: appState.lockAxes,
                        lockFullExtent: appState.lockFullExtent,
                        statsSelectedColumns: appState.statsSelectedColumns,
                        correlationSelectedColumns: appState.correlationSelectedColumns,
                        geochemMappings: appState.geochemMappings,
                        datasetEpsg: appState.datasetEpsg,
                    },
                    attributeState: {
                        color: attributeState.color,
                        shape: attributeState.shape,
                        size: attributeState.size,
                        filter: attributeState.filter,
                        customEntries: attributeState.customEntries,
                        globalOpacity: attributeState.globalOpacity,
                        emphasis: attributeState.emphasis,
                        valueFilter: attributeState.valueFilter,
                    },
                    classificationState: {
                        renderOptions: classificationState.renderOptions,
                        customDiagrams: useCustomDiagramStore.getState().diagrams
                    },
                    analysisState: (() => {
                        const t = useTransformationStore.getState();
                        const c = useCalculationStore.getState();
                        const q = useQAQCStore.getState();
                        const v = useVectoringStore.getState();
                        return {
                            transformation: {
                                customAmalgamations: t.customAmalgamations,
                                customAssociations: t.customAssociations,
                                zeroStrategy: t.zeroStrategy,
                                customZeroValue: t.customZeroValue,
                                chiPowerLambda: t.chiPowerLambda,
                            },
                            calculation: {
                                customCalculations: c.customCalculations,
                                savedCalculations: c.savedCalculations,
                            },
                            qaqc: {
                                sampleIdColumn: q.sampleIdColumn,
                                batchColumn: q.batchColumn,
                                duplicatePairColumn: q.duplicatePairColumn,
                                thresholds: q.thresholds,
                                standardReferences: q.standardReferences,
                                detectionLimits: q.detectionLimits,
                                selectedElements: q.selectedElements,
                            },
                            vectoring: {
                                selectedDepositType: v.selectedDepositType,
                            },
                        };
                    })(),
                    settings: {
                        autosaveEnabled: projectState.autosaveEnabled,
                        autosaveIntervalMinutes: projectState.autosaveIntervalMinutes,
                        bdlFactor: appState.bdlFactor,
                    },
                    auditLog: useAuditStore.getState().entries
                };

                return projectData;
            },

            importProject: (data: ProjectData, store?: ColumnarStore) => {
                set({ _isImporting: true });
                try {
                    // Migrate v1 → v2: add empty auditLog
                    if (data.version === 1) {
                        data.auditLog = [];
                        data.version = 2;
                    }
                    // Migrate v2 → v3: analysisState is optional, nothing to backfill
                    if (data.version === 2) {
                        data.version = 3;
                    }
                    // Migrate v3 → v4: rows are converted to columns below
                    if (data.version === 3) {
                        data.version = 4;
                    }
                    if (data.version === 4) {
                        migrateV4toV5(data);
                    }
                    if (data.version === 5) {
                        migrateV5toV6(data);
                    }
                    if (data.version === 6) {
                        migrateV6toV7(data);
                    }
                    if (data.version === 7) {
                        migrateV7toV8(data);
                    }
                    if (data.version === 8) {
                        migrateV8toV9(data);
                    }
                    useCheckpointStore.getState().setCheckpoints(data.checkpoints ?? []);
                    useReportStore.getState().setReport(data.report);
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

                    // Restore app state — including the columnar store (previously
                    // left stale/empty after import) and with stale sampling cleared
                    // (saved sample indices reference the previous session's rows)
                    // Only keys listed in `columns` are loaded, so orphan row keys
                    // in older files (hidden empty columns) are dropped here.
                    const datasetStore = store ?? datasetFromProject(data);
                    useAppStore.getState().setColumnarDataset(datasetStore, columns, {
                        geochemMappings: rebuildGeochemMappings(columns, data.appState.geochemMappings || []),
                        datasetEpsg: data.appState.datasetEpsg ?? null,
                    });
                    useAppStore.setState({
                        plots: data.appState.plots || [],
                        selectedIndices: data.appState.selectedIndices || [],
                        sampleIndices: null,
                        samplingResult: null,
                        availableFilters: availableFilters as any,
                        lockAxes: data.appState.lockAxes || false,
                        lockFullExtent: data.appState.lockFullExtent || false,
                        activePlotId: data.appState.activePlotId ?? data.appState.plots?.[0]?.id ?? null,
                        currentView: datasetStore.rowCount > 0 ? 'plots' : 'import',
                        statsSelectedColumns: data.appState.statsSelectedColumns || [],
                        correlationSelectedColumns: data.appState.correlationSelectedColumns || [],
                    });
                    // Dock arrangement (reconciled against the plots when the workspace loads it)
                    useWorkspaceStore.getState().applyLayout(data.workspace?.layout ?? null);

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
                            valueFilter: data.attributeState.valueFilter ?? DEFAULT_VALUE_FILTER,
                            selectedEntryIds: [],
                            activeEntryId: null,
                            paintMode: false,
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
                            renderOptions: data.classificationState.renderOptions || {
                                style: 'color',
                                showLabels: true,
                                showGrid: true,
                                showData: true,
                                fillOpacity: 0.2
                            }
                        });
                    }

                    // Restore analysis configs (v3+). Older files: leave whatever is
                    // in localStorage — that matches pre-v3 behavior on this machine.
                    if (data.analysisState) {
                        const a = data.analysisState;
                        if (a.transformation) {
                            useTransformationStore.setState({
                                customAmalgamations: a.transformation.customAmalgamations ?? [],
                                customAssociations: a.transformation.customAssociations ?? [],
                                zeroStrategy: a.transformation.zeroStrategy ?? 'half-min',
                                customZeroValue: a.transformation.customZeroValue ?? 0.001,
                                chiPowerLambda: a.transformation.chiPowerLambda ?? 0.5,
                            } as any);
                        }
                        if (a.calculation) {
                            useCalculationStore.setState({
                                customCalculations: a.calculation.customCalculations ?? [],
                                savedCalculations: a.calculation.savedCalculations ?? [],
                            } as any);
                        }
                        if (a.qaqc) {
                            useQAQCStore.setState({
                                sampleIdColumn: a.qaqc.sampleIdColumn ?? null,
                                batchColumn: a.qaqc.batchColumn ?? null,
                                duplicatePairColumn: a.qaqc.duplicatePairColumn ?? null,
                                // keep store defaults when the file has none
                                ...(a.qaqc.thresholds ? { thresholds: a.qaqc.thresholds } : {}),
                                standardReferences: a.qaqc.standardReferences ?? [],
                                detectionLimits: a.qaqc.detectionLimits ?? {},
                                selectedElements: a.qaqc.selectedElements ?? [],
                            } as any);
                        }
                        if (a.vectoring) {
                            useVectoringStore.setState({
                                selectedDepositType: a.vectoring.selectedDepositType ?? null,
                            } as any);
                        }
                    }

                    // Restore audit log
                    useAuditStore.getState().setEntries(data.auditLog ?? []);

                    // Below-detection substitution (older files: default)
                    useAppStore.getState().setBdlFactor(
                        data.settings && 'bdlFactor' in data.settings
                            ? (data.settings.bdlFactor ?? null)
                            : DEFAULT_BDL_FACTOR
                    );

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
                    // A loaded project starts with an empty undo history
                    useHistoryStore.getState().clear();

                    // Push the loaded dataset to the backend (it otherwise keeps
                    // whatever was last uploaded) and then QGIS — deferred so
                    // the load itself isn't blocked by serialisation
                    setTimeout(() => {
                        useAppStore.getState().syncBackendData(true)
                            .then(() => useAppStore.getState().syncToQgis())
                            .catch((err) => console.warn('[importProject] Backend sync failed (will retry on demand):', err));
                    }, 0);

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

            saveProjectToFile: async (saveAs: boolean = false, interactive: boolean = true) => {
                // Concurrency guard — prevent overlapping saves
                if (get()._isSaving) return false;
                set({ _isSaving: true });

                // Changes made while the (async) write is in flight must keep
                // the project dirty — only clear isDirty if nothing changed.
                const startGeneration = dirtyGeneration;
                const stillDirty = () => dirtyGeneration !== startGeneration;

                const state = get();
                // Dataset encoded from this (immutable) store in the worker
                const liveStore = useAppStore.getState().columnarData;
                const columnOrder = useAppStore.getState().columns.map(c => c.name);
                const projectData = state.exportProject({ omitDataset: true });
                const projectName = projectData.metadata.name || 'project';
                const suggestedFileName = `${projectName.replace(/[^a-z0-9]/gi, '_')}${PROJECT_FILE_EXTENSION}`;

                try {
                    set({ isLoading: true });

                    // Serialised (JSON + gzip) only for the write that happens
                    const toBlob = () => serializeProjectWithStore(projectData, liveStore, columnOrder);

                    // Backend file service: save by full path (in a project folder)
                    if ((state.projectPath || !state.fileHandle || saveAs) && await projectFilesAvailable()) {
                        let path = saveAs ? null : state.projectPath;
                        if (!path) {
                            if (!interactive) {
                                set({ isLoading: false });
                                return false;
                            }
                            path = await chooseProjectSavePath(`${projectName}.chem`, state.lastFolder);
                            if (!path) {
                                set({ isLoading: false });
                                return false; // cancelled
                            }
                        }
                        const name = stemOf(path);
                        projectData.metadata.name = name;
                        projectData.metadata.filePath = path;
                        const info = await saveProjectFile(path, await toBlob());
                        const now = new Date().toISOString();
                        const savedPath = path;
                        set((s) => ({
                            fileHandle: null,
                            projectPath: savedPath,
                            lastFolder: folderOf(folderOf(savedPath)),
                            isDirty: stillDirty(),
                            lastSaved: now,
                            isLoading: false,
                            currentProject: { ...(s.currentProject ?? projectData.metadata), name, modified: info.modified ?? now, filePath: savedPath },
                        }));
                        get().addRecentProject({ name, filePath: savedPath, path: savedPath, lastOpened: now, exists: true });
                        clearSnapshot().catch(() => { /* best-effort */ });
                        // A never-saved session's recovery copy is now obsolete
                        if (!state.projectPath) discardRecoveryFile(null, state.sessionKey).catch(() => { /* best-effort */ });
                        return true;
                    }

                    // Try to use existing file handle for save-in-place (not "Save As")
                    if (!saveAs && state.fileHandle) {
                        try {
                            const blob = await toBlob();
                            const writable = await state.fileHandle.createWritable();
                            await writable.write(blob);
                            await writable.close();

                            const now = new Date().toISOString();
                            set((s) => ({
                                isDirty: stillDirty(),
                                lastSaved: now,
                                isLoading: false,
                                currentProject: { ...(s.currentProject ?? projectData.metadata), modified: now }
                            }));

                            clearSnapshot().catch(() => { /* best-effort */ });
                            return true;
                        } catch (err: any) {
                            if (!interactive) {
                                // Autosave: never fall back to a picker or a download
                                console.warn('[Save] Failed to write to existing handle (non-interactive):', err.message);
                                set({ isLoading: false });
                                return false;
                            }
                            console.warn('[Save] Failed to write to existing handle, will prompt for new location:', err.message);
                            // Fall through to show picker
                        }
                    }

                    if (!interactive) {
                        set({ isLoading: false });
                        return false;
                    }

                    // No handle, saveAs requested, or handle failed - show picker
                    if ('showSaveFilePicker' in window) {
                        try {
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
                            const blob = await toBlob();
                            const writable = await handle.createWritable();
                            await writable.write(blob);
                            await writable.close();

                            const now = new Date().toISOString();
                            set((s) => ({
                                fileHandle: handle, // Store handle for future saves
                                isDirty: stillDirty(),
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

                            clearSnapshot().catch(() => { /* best-effort */ });
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
                    const blob = await toBlob();
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
                        isDirty: stillDirty(),
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

                    clearSnapshot().catch(() => { /* best-effort */ });
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
                if (await projectFilesAvailable()) {
                    try {
                        const path = await chooseProjectToOpen(get().lastFolder);
                        return path ? await get().openProjectPath(path) : false;
                    } catch (err: any) {
                        set({ loadError: 'Could not show the Open dialog: ' + (err?.message ?? err) });
                        return false;
                    }
                }
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
                                const { project: data, store } = await readProjectFile(file);

                                const success = get().importProject(data as ProjectData, store);

                                if (success) {
                                    // Store file handle for save-in-place and update file path
                                    set((s) => ({
                                        fileHandle: handle, // Store handle for future saves!
                                        projectPath: null,
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
                                const { project: data, store } = await readProjectFile(file);

                                const success = get().importProject(data as ProjectData, store);

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
                // Autosave never touches the project file: it keeps a recovery
                // copy (backend: <folder>/.autosave/<name>.autosave.chem, or the
                // app's recovery folder for unsaved projects; otherwise an
                // IndexedDB snapshot). The .chem changes only on Save.
                const state = get();
                if (!state.isDirty || state._isSaving || autosaving) return false;
                if (dirtyGeneration === autosavedGeneration) return false; // nothing new since the last autosave
                if (useAppStore.getState().columnarData.rowCount === 0) return false;
                autosaving = true;
                const generation = dirtyGeneration;
                try {
                    if (await projectFilesAvailable()) {
                        const project = state.exportProject({ omitDataset: true });
                        const app = useAppStore.getState();
                        const blob = await serializeProjectWithStore(project, app.columnarData, app.columns.map(c => c.name));
                        await autosaveProjectFile(state.projectPath, state.sessionKey, blob);
                    } else {
                        await saveSnapshot(state.exportProject());
                    }
                    autosavedGeneration = generation;
                    set({ lastAutosave: new Date().toISOString(), lastAutosaveError: null });
                    return true;
                } catch (err) {
                    console.warn('[Autosave] failed:', err);
                    set({ lastAutosaveError: 'Autosave failed - please save manually' });
                    return false;
                } finally {
                    autosaving = false;
                }
            }
        }),
        {
            name: 'project-storage',
            version: 2,
            partialize: (state) => ({
                recentProjects: state.recentProjects,
                lastFolder: state.lastFolder,
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

        this.intervalId = setInterval(async () => {
            const state = useProjectStore.getState();
            // triggerAutosave saves in place when a file handle exists, and
            // falls back to an IndexedDB recovery snapshot otherwise
            if (state.autosaveEnabled && state.isDirty) {
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
        state.columnarData !== prevState.columnarData ||
        state.columns !== prevState.columns ||
        state.plots !== prevState.plots ||
        state.geochemMappings !== prevState.geochemMappings ||
        state.lockAxes !== prevState.lockAxes ||
        state.lockFullExtent !== prevState.lockFullExtent ||
        state.datasetEpsg !== prevState.datasetEpsg ||
        state.bdlFactor !== prevState.bdlFactor
    ) {
        useProjectStore.getState().setDirty(true);
    }
});

// Dock arrangement changes (structure only; splitter sizes don't dirty the project)
useWorkspaceStore.subscribe((state, prevState) => {
    if (useProjectStore.getState()._isImporting || state.layout === prevState.layout) return;
    if (layoutSignature(state.layout) !== layoutSignature(prevState.layout)) {
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
        state.emphasis !== prevState.emphasis ||
        state.valueFilter !== prevState.valueFilter
    ) {
        useProjectStore.getState().setDirty(true);
    }
});

useCheckpointStore.subscribe((state, prevState) => {
    if (useProjectStore.getState()._isImporting) return;
    if (state.checkpoints !== prevState.checkpoints) useProjectStore.getState().setDirty(true);
});

useReportStore.subscribe((state, prevState) => {
    if (useProjectStore.getState()._isImporting) return;
    if (state.items !== prevState.items || state.title !== prevState.title || state.author !== prevState.author) {
        useProjectStore.getState().setDirty(true);
    }
});

useClassificationStore.subscribe((state, prevState) => {
    if (useProjectStore.getState()._isImporting) return;
    if (
        state.renderOptions !== prevState.renderOptions
    ) {
        useProjectStore.getState().setDirty(true);
    }
});

useAuditStore.subscribe((state, prevState) => {
    if (useProjectStore.getState()._isImporting) return;
    if (state.entries !== prevState.entries) {
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
