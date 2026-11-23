/**
 * The forms one logged unit is modelled in, side by side (Phase 262): an
 * intrusion, an intrusion of thin sheets, a vein, a vein system and a
 * proportion of the same units of the same logging column. What each
 * holds, and what its check against holes left out found (drillCheck.ts),
 * as rows for the properties and as a table of the report.
 */
import { useModelStore } from '../../store/modelStore';
import { useReportStore } from '../../store/reportStore';
import { drillCheckOf, useDrillChecks, whereAt, type CheckTarget, type DrillCheckState } from './drillCheck';
import { useModelCache, type SurfaceResult } from './modelCache';
import { keys } from './objectKeys';
import { sharePercent } from './proportion';
import { listText } from './shellDomains';
import { t } from './terms';
import type { ModelScene, SurfaceObject } from './types';

export type FormKind = 'intrusion' | 'thinSheets' | 'vein' | 'veinSystem' | 'proportion';

export interface UnitForm {
    target: CheckTarget;
    kind: FormKind;
    name: string;
    /** Its object in the project tree */
    object: string;
    /** The surfaces it is made of (a vein system: its veins; a proportion: its lowest shell) */
    surfaces: string[];
    /** A proportion: the share its lowest shell is drawn at */
    share: number | null;
}

/** The units a surface is of, as one key: the logging it reads and the units it counts (null: not built from logged units) */
export function unitKey(surface: SurfaceObject): string | null {
    const rule = surface.rule;
    const of = rule.kind === 'body' ? { table: rule.table ?? null, column: rule.units ? `units:${rule.units}` : rule.column, inside: rule.inside }
        : rule.kind === 'shell' && rule.of ? { table: rule.of.table ?? null, column: rule.of.column, inside: rule.of.inside } : null;
    return of ? JSON.stringify([of.table ?? '', of.column, [...new Set(of.inside.map(c => c.trim()))].sort()]) : null;
}

/** The units a surface is of, in words */
export function unitName(surface: SurfaceObject): string {
    const rule = surface.rule;
    return rule.kind === 'body' ? listText(rule.inside) : rule.kind === 'shell' && rule.of ? listText(rule.of.inside) : '';
}

export const formKindName = (kind: FormKind): string => (
    kind === 'intrusion' ? t('typeBody') : kind === 'thinSheets' ? `${t('typeBody')}, ${t('thinSheets').toLowerCase()}` : kind === 'vein' ? t('typeVein')
        : kind === 'veinSystem' ? 'Vein system' : t('proportion')
);

/** Every form of the scene, with the key of its units: a vein of a system is of its system, a proportion's shells are of its model */
export function sceneForms(scene: ModelScene): { key: string; form: UnitForm }[] {
    const out: { key: string; form: UnitForm }[] = [];
    const byId = new Map(scene.surfaces.map(s => [s.id, s]));
    const inSystem = new Set<string>();
    for (const system of scene.veinSystems ?? []) {
        const veins = system.veins.filter(id => byId.has(id));
        veins.forEach(id => inSystem.add(id));
        const key = veins.length > 0 ? unitKey(byId.get(veins[0])!) : null;
        if (key) out.push({ key, form: { target: { kind: 'system', id: system.id }, kind: 'veinSystem', name: system.name, object: keys.veinSystem(system.id), surfaces: veins, share: null } });
    }
    const shells = new Set<string>();
    for (const model of scene.numericModels ?? []) {
        if (!model.rule.of) continue;
        model.shells.forEach(s => shells.add(s.surface));
        const lowest = model.shells[0] ? byId.get(model.shells[0].surface) : undefined;
        const key = lowest ? unitKey(lowest) : null;
        if (lowest && key) out.push({ key, form: { target: { kind: 'surface', id: lowest.id }, kind: 'proportion', name: model.name, object: keys.numericModel(model.id), surfaces: [lowest.id], share: model.shells[0].cutoff } });
    }
    for (const s of scene.surfaces) {
        if (inSystem.has(s.id) || shells.has(s.id) || s.blockOf) continue;
        const key = unitKey(s);
        if (!key) continue;
        const rule = s.rule;
        const kind: FormKind = rule.kind === 'shell' ? 'proportion' : rule.kind === 'body' && rule.vein ? 'vein' : rule.kind === 'body' && rule.sheets ? 'thinSheets' : 'intrusion';
        out.push({ key, form: { target: { kind: 'surface', id: s.id }, kind, name: s.name, object: keys.surface(s.id), surfaces: [s.id], share: rule.kind === 'shell' ? rule.cutoff : null } });
    }
    return out;
}

/** The forms of the same units as a surface (itself among them, in the scene's order). Empty: it is not built from logged units. */
export function formsOf(scene: ModelScene, surfaceId: string): UnitForm[] {
    const surface = scene.surfaces.find(s => s.id === surfaceId);
    const key = surface ? unitKey(surface) : null;
    return key ? sceneForms(scene).filter(f => f.key === key).map(f => f.form) : [];
}

export interface FormRow {
    form: UnitForm;
    /** The ground it encloses, m³ (a vein system: its veins together); null while it is not fitted */
    volume: number | null;
    /** How much of its units that is: a proportion says (its ground times its mean share, and the ground outside its shell); else null */
    unit: number | null;
    pieces: number | null;
    /** Its check against holes left out, when it has one that still stands */
    check: DrillCheckState | null;
}

/** The forms as rows, from the fits and the checks as they are now */
export function formRows(forms: readonly UnitForm[], fits: Record<string, SurfaceResult | undefined> = useModelCache.getState().byId, checks = useDrillChecks.getState().byKey): FormRow[] {
    return forms.map(form => {
        const bodies = form.surfaces.map(id => (fits[id]?.state === 'ready' ? fits[id]!.stats?.body ?? null : null));
        const ready = bodies.length > 0 && bodies.every(b => b && b.volume !== null && b.volume !== undefined);
        const volume = ready ? bodies.reduce((sum, b) => sum + (b!.volume ?? 0), 0) : null;
        const share = form.kind === 'proportion' ? bodies[0]?.share ?? null : null;
        return {
            form, volume,
            unit: volume !== null && share && share.inside !== null && share.allOverInside !== null ? volume * share.inside * share.allOverInside : null,
            pieces: ready ? bodies.reduce((sum, b) => sum + (b!.pieces ?? 0), 0) : null,
            check: drillCheckOf(form.target, checks),
        };
    });
}

const cubic = (v: number | null) => (v === null ? '' : Math.round(v).toLocaleString('en-US'));
const share = (v: number | null | undefined) => (v === null || v === undefined ? '' : `${Math.round(100 * v)}%`);

/** A row's check in short cells: found, sure, the length it says how much from, where over 5 m ('' where there is none) */
export function checkCells(row: FormRow): { found: string; sure: string; holds: string; where: string } {
    const c = row.check?.state === 'done' ? row.check.check : null;
    if (!c) return { found: '', sure: '', holds: '', where: '' };
    const where = whereAt(c.scale);
    return {
        found: share(c.without.foundShare), sure: share(c.without.sureShare),
        holds: c.scale.holds !== null ? `${c.scale.holds} m` : 'at no length',
        where: where ? `${where.where.toFixed(2)}${where.window !== 5 ? ` (${where.window} m)` : ''}` : '',
    };
}

export const FORMS_COLUMNS = ['Form', 'Built as', 'Ground enclosed (m³)', 'Of it, the unit (m³)', 'Found in holes left out', 'Of what it took in, the unit', 'Says how much from', 'Says where, over 5 m'];

export const FORMS_CAPTION = 'Each row is one way the same logged units are modelled. Ground enclosed: the volume inside it (a vein system: its veins together; a proportion: its lowest shell). '
    + 'Of it, the unit: only a proportion says, from the share it gives the ground. The check: each form is fitted again several times without about a fifth of the holes, '
    + 'holes that lie together left out together, and the logging of those holes is read against it. Found: of the unit logged in them, the share it took in. '
    + 'Of what it took in, the unit: the rest is other ground. Says how much from: the shortest stretch of hole over which it says how much of the unit there is better than quoting '
    + 'the overall share everywhere would. Says where: how well it follows where there is more and where less over 5 m of hole, from 0 (not at all) to 1 (exactly). Blank: not checked.';

/** The forms of a surface's units as a table of the report. False: there is nothing to put there. */
export function formsToReport(surfaceId: string): boolean {
    const scene = useModelStore.getState().scene;
    const surface = scene.surfaces.find(s => s.id === surfaceId);
    const rows = formRows(formsOf(scene, surfaceId));
    if (!surface || rows.length === 0) return false;
    useReportStore.getState().addTable({
        title: `${unitName(surface)}: the forms it is modelled in`,
        caption: FORMS_CAPTION,
        columns: FORMS_COLUMNS,
        rows: rows.map(r => {
            const c = checkCells(r);
            const built = r.form.kind === 'proportion' && r.form.share !== null ? `${formKindName(r.form.kind)}, shell at ${sharePercent(r.form.share)}` : formKindName(r.form.kind);
            return [r.form.name, built, cubic(r.volume), cubic(r.unit), c.found, c.sure, c.holds, c.where];
        }),
    });
    return true;
}
