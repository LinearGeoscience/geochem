/**
 * The volumes of the scene's numeric models side by side, by cut-off and by
 * the ground each is kept inside (Phase 233): for the properties of the
 * Numeric models group, and as a table of the report.
 */
import { useModelStore } from '../../store/modelStore';
import { useReportStore } from '../../store/reportStore';
import { useModelCache } from './modelCache';
import { volumeTable, type VolumeTable } from './numericModels';
import { solidsText } from './shellDomains';

/** The table as the scene and its fits are now */
export function numericVolumes(): VolumeTable {
    const scene = useModelStore.getState().scene;
    const fits = useModelCache.getState().byId;
    return volumeTable(
        scene.numericModels ?? [],
        id => { const f = fits[id]; return f?.state === 'ready' ? f.stats?.body?.volume ?? null : null; },
        id => scene.models?.find(g => g.id === id)?.name ?? null,
        id => { const f = fits[id]; return f?.state === 'ready' ? f.stats?.body?.share ?? null : null; },
        domain => { const said = solidsText(domain, scene); return said ? `Inside ${said}` : 'Inside solids no longer in the project'; },
    );
}

/** A volume in a table of the report: whole cubic metres ('' where there is no shell, or it is not fitted) */
const cubic = (v: number | null) => (v === null ? '' : Math.round(v).toLocaleString('en-US'));

/** The table put in the report. False: there is no numeric model to put there. */
export function numericVolumesToReport(): boolean {
    const table = numericVolumes();
    if (table.rows.length === 0) return false;
    useReportStore.getState().addTable({
        title: 'Numeric models: volume by cut-off',
        caption: 'The ground inside each grade shell, in cubic metres: a row for each numeric model, with the ground of the geological model it is kept inside, and a column for each cut-off. Blank: the model has no shell at that cut-off, or it is not fitted.',
        columns: ['Model', 'Column', 'Kept inside', ...table.cutoffs.map(c => `≥ ${c} (m³)`)],
        // (A proportion: a second row, how much of its units that ground holds; its cut-offs are shares, 0.1 = 10%)
        rows: table.rows.flatMap(r => [
            [r.name, r.column, r.where, ...r.volumes.map(cubic)],
            ...(r.share ? [[`${r.name}: ${r.share.units} in that ground`, r.column, r.share.all !== null ? `In all, about ${cubic(r.share.all)} m³` : '', ...r.share.inside.map(cubic)]] : []),
        ]),
    });
    return true;
}
