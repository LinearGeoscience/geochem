/**
 * Element references -> dataset columns, with the factor that brings each
 * column to the reference's canonical unit (ppm for elements, wt% for
 * oxides). Reuses the unit-aware element resolver and the oxide lookups.
 */
import type { ColumnGeochemMapping } from '../../types/associations';
import { resolveElementColumn, unitToPpmFactor } from '../calculations/elementColumnResolver';
import { findColumnForOxide, ELEMENT_TO_OXIDES } from '../calculations/elementNameNormalizer';
import { ELEMENT_OXIDE_CONVERSIONS } from '../calculations/constants';
import type { CalcAction, ElementRef, Workflow, WorkflowAction } from './types';

export interface ColumnLike { name: string; type: string; role: string | null }

export interface ResolveContext {
    columns: ColumnLike[];
    mappings: ColumnGeochemMapping[];
    /** Calc actions of the workflow by output name (a {calc} ref may run before its column exists) */
    calcDefs: Map<string, CalcAction>;
    /** Alternative names a calc output may already have in the data */
    aliases: Map<string, string[]>;
}

export interface Resolved {
    column: string;
    /** Multiply column values by this to get the reference's canonical unit */
    scale: number;
    unit: string | null;
    via: 'element' | 'oxide' | 'calc' | 'role' | 'name';
    /** The unit was unknown and assumed */
    unitAssumed: boolean;
    /** A different form than asked for was used (oxide for element or the reverse) */
    substituted?: string;
}

const NUMERIC_TYPES = new Set(['numeric', 'float', 'integer', 'number']);

export function isNumericColumn(c: ColumnLike | undefined): boolean {
    return !!c && NUMERIC_TYPES.has(c.type);
}

/** Context from a workflow's calc actions and the dataset's columns/mappings */
export function makeContext(columns: ColumnLike[], mappings: ColumnGeochemMapping[], workflow?: Workflow): ResolveContext {
    const calcDefs = new Map<string, CalcAction>();
    const aliases = new Map<string, string[]>();
    for (const step of workflow?.steps ?? []) {
        for (const a of step.actions) {
            if (a.kind === 'calc') {
                calcDefs.set(a.name, a);
                if (a.aliases?.length) aliases.set(a.name, a.aliases);
            }
        }
    }
    return { columns, mappings, calcDefs, aliases };
}

/** Short label for the "Missing: …" chip */
export function refLabel(ref: ElementRef): string {
    if ('el' in ref) return ref.el;
    if ('ox' in ref) return ref.ox;
    if ('calc' in ref) return ref.calc;
    if ('role' in ref) return ref.role;
    if ('col' in ref) return ref.col;
    return ref.any.map(refLabel).join(' | ');
}

function oxideToElementFactor(oxide: string): number | null {
    const c = ELEMENT_OXIDE_CONVERSIONS.find(x => x.oxide.toUpperCase() === oxide.toUpperCase());
    return c ? c.oxideToElement : null;
}

function byName(ctx: ResolveContext, name: string): ColumnLike | undefined {
    return ctx.columns.find(c => c.name === name) ?? ctx.columns.find(c => c.name.toLowerCase() === name.toLowerCase());
}

function numericOrNull(ctx: ResolveContext, r: Resolved | null): Resolved | null {
    if (!r) return null;
    return isNumericColumn(byName(ctx, r.column)) ? r : null;
}

function resolveElement(ref: { el: string }, ctx: ResolveContext): Resolved | null {
    const r = resolveElementColumn(ctx.mappings, ref.el);
    if (r && isNumericColumn(byName(ctx, r.column))) {
        return { column: r.column, scale: r.toPpm, unit: r.unit, via: 'element', unitAssumed: r.unitAssumed };
    }
    // Only the oxide is reported (Li2O_pct, MgO_pct): element ppm = oxide wt% * 1e4 * oxideToElement
    for (const ox of ELEMENT_TO_OXIDES[ref.el] ?? []) {
        const col = findColumnForOxide(ctx.mappings, ox);
        const f = oxideToElementFactor(ox);
        if (col && f && isNumericColumn(byName(ctx, col))) {
            const m = ctx.mappings.find(x => x.originalName === col);
            const unit = m?.userUnit ?? m?.detectedUnit ?? null;
            const toPct = unit ? (unitToPpmFactor(unit) ?? 1e4) / 1e4 : 1;
            return { column: col, scale: toPct * 1e4 * f, unit, via: 'oxide', unitAssumed: !unit, substituted: ox };
        }
    }
    return null;
}

function resolveOxide(ref: { ox: string; asElement?: boolean }, ctx: ResolveContext): Resolved | null {
    const col = findColumnForOxide(ctx.mappings, ref.ox);
    if (col && isNumericColumn(byName(ctx, col))) {
        const m = ctx.mappings.find(x => x.originalName === col);
        const unit = m?.userUnit ?? m?.detectedUnit ?? null;
        const toPct = unit ? (unitToPpmFactor(unit) ?? 1e4) / 1e4 : 1;
        const f = ref.asElement ? (oxideToElementFactor(ref.ox) ?? 1) : 1;
        return { column: col, scale: toPct * f, unit, via: 'oxide', unitAssumed: !unit };
    }
    // Element reported instead of the oxide: wt% oxide = element ppm / 1e4 / oxideToElement
    const el = ELEMENT_OXIDE_CONVERSIONS.find(x => x.oxide.toUpperCase() === ref.ox.toUpperCase())?.element;
    if (el) {
        const r = resolveElementColumn(ctx.mappings, el);
        if (r && isNumericColumn(byName(ctx, r.column))) {
            const f = ref.asElement ? 1 : 1 / (oxideToElementFactor(ref.ox) ?? 1);
            return { column: r.column, scale: r.toPpm / 1e4 * f, unit: r.unit, via: 'element', unitAssumed: r.unitAssumed, substituted: el };
        }
    }
    return null;
}

function resolveCalc(ref: { calc: string }, ctx: ResolveContext): Resolved | null {
    const names = [ref.calc, ...(ctx.aliases.get(ref.calc) ?? [])];
    for (const n of names) {
        const c = byName(ctx, n);
        if (isNumericColumn(c)) return { column: c!.name, scale: 1, unit: null, via: 'calc', unitAssumed: false };
    }
    return null;
}

/** Resolve one reference against the dataset; null when nothing numeric matches. */
export function resolveRef(ref: ElementRef, ctx: ResolveContext): Resolved | null {
    if ('el' in ref) return resolveElement(ref, ctx);
    if ('ox' in ref) return resolveOxide(ref, ctx);
    if ('calc' in ref) return resolveCalc(ref, ctx);
    if ('role' in ref) {
        const c = ctx.columns.find(x => x.role === ref.role);
        return c ? { column: c.name, scale: 1, unit: null, via: 'role', unitAssumed: false } : null;
    }
    if ('col' in ref) {
        const c = byName(ctx, ref.col);
        return numericOrNull(ctx, c ? { column: c.name, scale: 1, unit: null, via: 'name', unitAssumed: false } : null);
    }
    for (const r of ref.any) {
        const hit = resolveRef(r, ctx);
        if (hit) return hit;
    }
    return null;
}

/**
 * Can this reference be satisfied, now or by a calc action of the workflow
 * (whose own inputs must resolve)? Calc refs count as available when their
 * definition's inputs resolve, since the runner makes the column first.
 */
export function refAvailable(ref: ElementRef, ctx: ResolveContext, depth = 0): boolean {
    if (resolveRef(ref, ctx)) return true;
    if ('calc' in ref && depth < 4) {
        const def = ctx.calcDefs.get(ref.calc);
        return !!def && Object.values(def.inputs).every(r => refAvailable(r, ctx, depth + 1));
    }
    if ('any' in ref) return ref.any.some(r => refAvailable(r, ctx, depth));
    return false;
}

/** Element symbol behind a ratio-line reference (element refs only) */
export function refElement(ref: ElementRef): string | null {
    if ('el' in ref) return ref.el;
    if ('any' in ref) for (const r of ref.any) { const e = refElement(r); if (e) return e; }
    return null;
}

export interface ActionRefs {
    /** All must resolve */
    required: ElementRef[];
    /** At least one of each list must resolve */
    oneOf: ElementRef[][];
}

/** Which references an action needs. */
export function actionRefs(a: WorkflowAction): ActionRefs {
    switch (a.kind) {
        case 'scatter': return { required: [a.x], oneOf: [a.ys] };
        case 'ternary': return { required: [a.a, a.b, a.c], oneOf: [] };
        case 'probability': return { required: [], oneOf: [a.cols] };
        case 'boxplot': return { required: a.groupBy && a.groupBy !== 'colour' ? [a.groupBy] : [], oneOf: [a.cols] };
        case 'calc': return { required: Object.values(a.inputs), oneOf: [] };
        case 'rules': return { required: [], oneOf: [a.rules.flatMap(r => r.where.map(w => w.on))] };
        case 'spider': return { required: [], oneOf: [a.elements] };
        case 'map':
        case 'pathfinder': return { required: [{ role: 'East' }, { role: 'North' }], oneOf: [] };
        case 'indices': return a.plot === 'map' ? { required: [{ role: 'East' }, { role: 'North' }], oneOf: [] } : { required: [], oneOf: [] };
        default: return { required: [], oneOf: [] };
    }
}
