/**
 * Where the open project stands in the steps of setting a geological model
 * up (features/model/workflow): read from the stores, for the model the
 * page is on.
 */
import { useMemo } from 'react';
import { create } from 'zustand';
import { useAppStore } from '../../../store/appStore';
import { useDrillholeStore } from '../../../store/drillholeStore';
import { useModelStore } from '../../../store/modelStore';
import { modelProblemList } from '../../model/geoModel';
import { useGeoModelCache } from '../../model/geoModelCache';
import { useHoleFindings } from '../../model/holeChecks';
import { findingCounts } from '../../model/validation';
import { guessHoleColumn } from '../../plots/viewer3d/coordinateColumns';
import { useModelCache } from '../../model/modelCache';
import { useModelChecks, useModelCompared } from '../../model/modelCheck';
import { modelWorkflow, type WorkflowFacts, type WorkflowStep } from '../../model/workflow';
import { usePickedModel, type PickedModel } from '../pickedModel';

/** The steps shown in full, or only the one to take (kept for the session) */
export const useSetupStrip = create<{ open: boolean; setOpen: (open: boolean) => void }>(set => ({ open: true, setOpen: open => set({ open }) }));

export interface ModelWorkflow extends Pick<PickedModel, 'model' | 'models' | 'choose'> {
    steps: WorkflowStep[];
    facts: WorkflowFacts;
}

export function useModelWorkflow(): ModelWorkflow {
    const { model, models, choose } = usePickedModel();
    const scene = useModelStore(s => s.scene);
    const db = useDrillholeStore(s => s.db);
    const data = useAppStore(s => s.columnarData);
    const columns = useAppStore(s => s.columns);
    // Its surfaces that are being fitted, and those that could not be, as two numbers in one string
    const fits = useModelCache(s => {
        if (!model) return '0 0';
        const used = [...model.contacts.filter(c => !c.off).map(c => c.surface), ...(model.faults ?? []).filter(f => !f.off).map(f => f.surface)];
        let fitting = 0, failed = 0;
        for (const id of used) {
            const state = id ? s.byId[id]?.state : undefined;
            if (state === 'fitting') fitting++;
            else if (state === 'failed') failed++;
        }
        return `${fitting} ${failed}`;
    });
    const build = useGeoModelCache(s => (model ? s.byId[model.id] : undefined));
    const check = useModelChecks(s => (model ? s.byId[model.id] : undefined));
    const compared = useModelCompared(s => (model ? s.byId[model.id] : undefined));
    const share = useModelCompared(s => (model ? s.share[model.id] : undefined));

    const found = useHoleFindings();
    // Holes: those of the drillhole tables, else the different holes of the samples
    const holes = useMemo(() => {
        if (db) return new Set(db.collar.hole).size;
        const name = scene.coords?.hole ?? guessHoleColumn(columns);
        const column = name ? data.columns.get(name) : undefined;
        return column && data.rowCount > 0 ? new Set(column as ArrayLike<unknown> as unknown[]).size : 0;
    }, [db, data, columns, scene.coords?.hole]);

    return useMemo(() => {
        const [fitting, failed] = fits.split(' ').map(Number);
        const out = build?.state === 'ready' ? build.out : null;
        const facts: WorkflowFacts = {
            holes,
            findings: findingCounts(found),
            logged: (db?.tables.length ?? 0) > 0 || columns.some(c => c.type !== 'numeric' && c.role !== 'HoleID'),
            groupings: scene.unitMaps?.length ?? 0,
            model: model ? {
                name: model.name,
                units: scene.unitMaps?.find(u => u.id === model.unitMap)?.units.length ?? 0,
                contacts: model.contacts.filter(c => !c.off).length,
                off: model.contacts.filter(c => c.off).length,
                faults: (model.faults ?? []).filter(f => !f.off).length,
                problems: modelProblemList(scene, model),
                fitting, failed,
                build: build?.state ?? null,
                buildError: build?.error,
                // (A thin unit is measured from its own surface: it is not one with no ground)
                empty: out && build ? build.units.filter((_, i) => !(out.volumes[i] > 0) && !out.thin?.some(x => x.unit === i)) : [],
                checked: !!build && ((check?.key === build.key && check.state === 'done') || compared === build.key),
                ...(build && share && share.key === build.key ? { agreed: { agreed: share.agreed, metres: share.metres } } : {}),
            } : null,
        };
        return { steps: modelWorkflow(facts), facts, model, models, choose };
    }, [holes, found, db, columns, scene, model, models, choose, fits, build, check, compared, share]);
}
