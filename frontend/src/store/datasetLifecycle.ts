/**
 * State that is keyed by the rows or columns of one dataset must not survive
 * into the next one. appStore bumps `datasetGeneration` whenever a different
 * dataset is loaded (file import, drillhole import, sheet switch, project
 * open); everything row-indexed is cleared here, in one place, instead of in
 * each import flow (several of which used to forget some of it).
 *
 * Runs synchronously inside setColumnarDataset, so a loader that brings its
 * own state (project checkpoints, .gas checkpoints, saved QA/QC settings)
 * simply sets it afterwards.
 */
import { useAppStore } from './appStore';
import { useQAQCStore } from './qaqcStore';
import { useCheckpointStore } from './checkpointStore';
import { useDataFilterStore } from '../features/data_features/dataFilters';
import { useAttributeStore } from './attributeStore';
import { useTransformationStore } from './transformationStore';
import { useRecalculationStore } from './recalculationStore';
import { useVectoringStore } from './vectoringStore';

useAppStore.subscribe((state, prev) => {
    if (state.datasetGeneration === prev.datasetGeneration) return;

    // QA/QC: detections and results hold row numbers of the old dataset;
    // column choices are kept only if the column still exists
    const names = new Set(state.columns.map(c => c.name));
    const keep = (c: string | null) => (c && names.has(c) ? c : null);
    const q = useQAQCStore.getState();
    q.clearDetections();
    useQAQCStore.setState({
        sampleIdColumn: keep(q.sampleIdColumn),
        batchColumn: keep(q.batchColumn),
        duplicatePairColumn: keep(q.duplicatePairColumn),
        selectedElements: q.selectedElements.filter(e => names.has(e)),
    });

    // Classes and painted groups belong to the old rows. (Done here, after the
    // new data is in, so a failed import no longer wipes the styling of the
    // dataset that stays open.)
    useAttributeStore.getState().removeGlobalEntries();

    // Analysis results indexed by old rows: PCA scores / input rows,
    // recalculation output, vectoring results
    useTransformationStore.getState().clearResults();
    useRecalculationStore.getState().reset();
    if (useVectoringStore.getState().currentResult) useVectoringStore.getState().clearResults();

    // Attribute checkpoints store painted row numbers
    if (useCheckpointStore.getState().checkpoints.length) useCheckpointStore.getState().setCheckpoints([]);

    // Data view filters name the old columns
    const f = useDataFilterStore.getState();
    if (f.search || Object.keys(f.filters).length) f.clearAll();
});
