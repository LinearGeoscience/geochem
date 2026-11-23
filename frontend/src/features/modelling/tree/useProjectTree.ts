/** The project tree of the open project, rebuilt when the scene, the drillhole tables, the dataset or a surface's fit state change */
import { useMemo } from 'react';
import { useAppStore } from '../../../store/appStore';
import { useDrillholeStore } from '../../../store/drillholeStore';
import { useModelStore } from '../../../store/modelStore';
import { formatVolume } from '../../model/describe';
import { useGeoModelCache, type ModelResult } from '../../model/geoModelCache';
import { useModelCache } from '../../model/modelCache';
import { keys } from '../../model/objectKeys';
import { buildProjectTree, type NodeStatus, type TreeNode } from '../../model/projectTree';

/** A model's state as the tree shows it (null: built and up to date) */
export function modelNodeStatus(state: ModelResult['state']): NodeStatus | null {
    switch (state) {
        case 'building': case 'waiting': return 'fitting';
        case 'failed': return 'failed';
        case 'empty': return 'empty';
        // Built, but from what the project was before: it is rebuilt when asked
        case 'stale': return 'stale';
        default: return null;
    }
}

/** Parts of a line of the states, which never have a tab or a line end in them */
const SEP = '\t';

export function useProjectTree(): TreeNode[] {
    const scene = useModelStore(s => s.scene);
    const db = useDrillholeStore(s => s.db);
    const rows = useAppStore(s => s.columnarData.rowCount);
    const columns = useAppStore(s => s.columns);
    // Surfaces not ready (and why one failed), as one string, so fits that only move on do not rebuild the tree
    // (One whose fit was stopped is not as it is set now: stale, whatever it shows)
    const states = useModelCache(s => Object.entries(s.byId).filter(([, r]) => r.state !== 'ready' || r.stopped)
        .map(([id, r]) => [id, r.stopped ? 'stale' : r.state, (r.state === 'failed' && r.error) || ''].join(SEP).replace(/\n/g, ' ')).join('\n'));
    // The models' states and volumes, as one string
    const models = useGeoModelCache(s => Object.entries(s.byId).map(([id, r]) => `${id}=${r.state}=${r.out ? r.units.map((u, i) => `${u}\t${r.out!.volumes[i]}`).join('\t') : ''}`).join('\n'));
    // Why a model's build failed
    const modelErrors = useGeoModelCache(s => Object.entries(s.byId).filter(([, r]) => r.state === 'failed' && r.error)
        .map(([id, r]) => [id, r.error].join(SEP).replace(/\n/g, ' ')).join('\n'));
    return useMemo(() => {
        const byKey = new Map<string, NodeStatus>();
        const said = new Map<string, string>();
        const volumes = new Map<string, number>();
        for (const line of models ? models.split('\n') : []) {
            const [id, state, rest] = line.split('=');
            const status = modelNodeStatus(state as ModelResult['state']);
            if (status) byKey.set(keys.model(id), status);
            const parts = rest ? rest.split('\t') : [];
            for (let i = 0; i + 1 < parts.length; i += 2) volumes.set(keys.volume(id, parts[i]), Number(parts[i + 1]));
        }
        for (const line of modelErrors ? modelErrors.split('\n') : []) {
            const at = line.indexOf(SEP);
            said.set(keys.model(line.slice(0, at)), line.slice(at + 1));
        }
        for (const line of states ? states.split('\n') : []) {
            const [id, state, error] = line.split(SEP);
            byKey.set(keys.surface(id), state as NodeStatus);
            if (error) said.set(keys.surface(id), error);
        }
        return buildProjectTree(scene, db, {
            samples: rows > 0 ? { rows } : null, traces: columns.some(c => c.role === 'HoleID'), columns: columns.map(c => c.name),
            status: k => byKey.get(k) ?? null, statusText: k => said.get(k) ?? null,
            volume: (model, unit) => { const v = volumes.get(keys.volume(model, unit)); return v === undefined ? null : v > 0 ? formatVolume(v) : 'none of it in the model'; },
        });
    }, [scene, db, rows, columns, states, models, modelErrors]);
}
