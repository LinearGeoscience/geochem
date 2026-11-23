/**
 * The lithologies of the geological models drawn in a view, for its legend
 * (UnitLegend): pure, from the layers the view draws.
 */
import { keys, parseModelPart } from '../../model/objectKeys';
import type { ModelScene } from '../../model/types';

export interface LegendUnit {
    /** The key of its solid (what a click shows or hides) */
    key: string;
    name: string;
    color: string;
    shown: boolean;
}

export interface LegendModel {
    id: string;
    name: string;
    /** Its lithologies that have a solid, the youngest first */
    units: LegendUnit[];
}

/**
 * The models to list in a view, from the layers it draws: a model whose
 * boundary or any solid is shown there (one hidden altogether is not
 * listed; its lithologies hidden one by one stay, to be shown again).
 */
export function unitLegend(scene: Pick<ModelScene, 'models'>, layers: readonly { id: string; color: string; visible: boolean }[]): LegendModel[] {
    const out: LegendModel[] = [];
    for (const g of scene.models ?? []) {
        const units: LegendUnit[] = [];
        for (const l of layers) {
            const part = l.id.startsWith('volume:') ? parseModelPart(l.id) : null;
            if (part?.kind === 'volume' && part.model === g.id) units.push({ key: l.id, name: part.part, color: l.color, shown: l.visible });
        }
        if (units.length === 0) continue;
        const box = keys.model(g.id);
        if (!units.some(u => u.shown) && !layers.some(l => l.id === box && l.visible)) continue;
        out.push({ id: g.id, name: g.name, units: units.reverse() });
    }
    return out;
}
