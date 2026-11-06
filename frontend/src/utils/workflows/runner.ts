/**
 * Runs one workflow step through the store APIs (a TypeScript port of the
 * halleyRunner.mjs action executors): calcs first, then plots (tiled
 * together), then box plots / analysis tabs / the rules sheet. Nothing is
 * painted or classified for the user: a rules step only opens the sheet.
 */
import { useAppStore } from '../../store/appStore';
import { useUIStore } from '../../store/uiStore';
import { useBoxPlotStore } from '../../store/boxPlotStore';
import { useRuleSetStore } from '../../store/ruleSetStore';
import { useAuditStore } from '../../store/auditStore';
import { useTransformationStore } from '../../store/transformationStore';
import { openPcaResultsWindow } from '../../features/analysis/pca/openPcaResultsWindow';
import { colourByQuantiles } from '../../features/analysis/pca/pcScoreColour';
import { ensureDiagramsLoaded, getDiagramV3, useClassificationStore } from '../../store/classificationStore';
import { createPlotFromDiagram } from '../../features/plots/createPlotFromDiagram';
import { tilePlotsWhenReady } from '../../features/workspace/workspaceApi';
import { evaluateSheet } from '../calculateColumns';
import { attributeColumnValues } from '../attributeUtils';
import { PATHFINDER_ELEMENTS, type PathfinderElement } from '../calculations/pathfinderConstants';
import { NODE_LIBRARY } from '../nodeLibrary';
import type { RefLine } from '../scatterOverlays';
import type { ClassRule } from '../ruleClassifier';
import { buildCalcSheet } from './calc';
import { actionRefs, makeContext, refAvailable, refElement, refLabel, resolveRef, type ResolveContext, type Resolved } from './resolve';
import type { StepResult, Workflow, WorkflowAction, WorkflowStep } from './types';

export const BOX_PLOT_COLOUR_GROUPS = '__colour_groups__';
const DENSITY_CELLS: [number, number] = [240, 180];
const MAX_TILED = 6;
const PLOT_KINDS = new Set(['scatter', 'ternary', 'diagram', 'probability', 'spider', 'map', 'pathfinder', 'pcaResults', 'indices']);

/** Missing-reference labels for the PCA steps */
export const NEEDS_PCA = 'a PCA run';
export const NEEDS_INDICES = 'indices (Build Index on the eigenvector plots)';

/** Columns made with Build Index (PCA additive indices), oldest first. */
export function pcaIndexColumns(): string[] {
    return useAppStore.getState().columns
        .filter(c => c.derivation?.kind === 'pca' && c.derivation.params && 'form' in c.derivation.params)
        .sort((a, b) => (a.derivation!.created < b.derivation!.created ? -1 : a.derivation!.created > b.derivation!.created ? 1 : 0))
        .map(c => c.name);
}

/** What a PCA-dependent action still needs (null = can run). */
function pcaNeeds(a: WorkflowAction): string | null {
    if (a.kind === 'pcaResults') return useTransformationStore.getState().fullPcaResult ? null : NEEDS_PCA;
    if (a.kind === 'indices') return pcaIndexColumns().length ? null : NEEDS_INDICES;
    return null;
}

export function contextFromStore(workflow?: Workflow): ResolveContext {
    const s = useAppStore.getState();
    return makeContext(s.columns, s.geochemMappings, workflow);
}

export interface Availability {
    ok: boolean;
    /** Labels of required references no column satisfies */
    missing: string[];
    /** The step opens a library diagram but the library has not loaded yet */
    diagramsPending: boolean;
}

/**
 * Can the step run on the current dataset? `ok` when at least one action can
 * (a step with three plots still helps when one lacks its element); `missing`
 * lists every reference no column satisfies. The workflow supplies the calc
 * definitions a {calc} ref may rely on.
 */
export function stepAvailability(workflow: Workflow, step: WorkflowStep, ctx: ResolveContext = contextFromStore(workflow)): Availability {
    const missing = new Set<string>();
    let runnable = 0;
    let hasDiagram = false;
    for (const a of step.actions) {
        if (a.kind === 'diagram') hasDiagram = true;
        const refs = actionRefs(a);
        let ok = true;
        const need = pcaNeeds(a);
        if (need) { missing.add(need); ok = false; }
        for (const r of refs.required) if (!refAvailable(r, ctx)) { missing.add(refLabel(r)); ok = false; }
        for (const list of refs.oneOf) {
            const hits = list.filter(r => refAvailable(r, ctx));
            if (!hits.length && list.length) ok = false;
            for (const r of list) if (!refAvailable(r, ctx)) missing.add(refLabel(r));
        }
        if (ok) runnable++;
    }
    const diagramsPending = hasDiagram && !useClassificationStore.getState().isLoaded;
    return { ok: step.actions.length === 0 || runnable > 0, missing: [...missing], diagramsPending };
}

export interface RunOptions {
    /** Plots to close before the step's own open (the previous step's) */
    replacePlotIds?: string[];
    /** Tile the step's plots (default true; 2–6 plots) */
    tile?: boolean;
}

interface Acc extends StepResult { ctx: ResolveContext }

const label = (r: Resolved | null, ref: Parameters<typeof refLabel>[0], acc: Acc): string | null => {
    if (!r) { acc.missing.push(refLabel(ref)); return null; }
    if (r.unitAssumed) acc.warnings.push(`${r.column}: unit unknown, assumed`);
    if (r.substituted && r.via === 'oxide') acc.warnings.push(`${r.substituted} column used for ${refLabel(ref)}`);
    return r.column;
};

function resolveList(refs: Parameters<typeof refLabel>[0][], acc: Acc): string[] {
    const out: string[] = [];
    for (const ref of refs) {
        const c = label(resolveRef(ref, acc.ctx), ref, acc);
        if (c && !out.includes(c)) out.push(c);
    }
    return out;
}

function refLines(a: Extract<WorkflowAction, { kind: 'scatter' }>, acc: Acc): RefLine[] {
    const lines: RefLine[] = [];
    for (const l of a.refLines ?? []) {
        if ('ratio' in l) {
            const num = refElement(l.ratio.num), den = refElement(l.ratio.den);
            if (!num || !den) { acc.warnings.push('Ratio line needs element references'); continue; }
            lines.push({ label: l.ratio.label ?? `${num}/${den} = ${l.ratio.value}`, num, den, ratio: l.ratio.value, molar: !!l.ratio.molar });
        } else {
            const r = resolveRef(l.level.on, acc.ctx);
            if (!r) { acc.missing.push(refLabel(l.level.on)); continue; }
            lines.push({ label: l.level.label ?? `${refLabel(l.level.on)} = ${l.level.at}`, num: r.column, ratio: l.level.at / r.scale, molar: false, kind: 'value' });
        }
    }
    return lines;
}

function addPlot(type: Parameters<ReturnType<typeof useAppStore.getState>['addPlot']>[0], settings: Record<string, unknown>, title: string | undefined, acc: Acc): string {
    const id = useAppStore.getState().addPlot(type, { settings, ...(title ? { title } : {}) });
    acc.plotIds.push(id);
    return id;
}

async function runPlot(a: WorkflowAction, acc: Acc): Promise<void> {
    const s = useAppStore.getState();
    switch (a.kind) {
        case 'scatter': {
            const x = label(resolveRef(a.x, acc.ctx), a.x, acc);
            const ys = resolveList(a.ys, acc);
            if (!x || !ys.length) return;
            const settings: Record<string, unknown> = { xAxis: x, yAxes: ys };
            if (a.yx) settings.yxMode = true;
            if (a.log === 'x' || a.log === 'xy') settings.logScaleX = true;
            if (a.log === 'y' || a.log === 'xy') settings.logScaleY = true;
            if (a.density) { settings.densityOverlay = true; settings.densityCells = DENSITY_CELLS; }
            const lines = refLines(a, acc);
            if (lines.length) settings.refLines = lines;
            if (a.nodes?.length) settings.nodes = a.nodes;
            addPlot('scatter', settings, a.title, acc);
            return;
        }
        case 'ternary': {
            const [p, q, r] = [a.a, a.b, a.c].map(ref => label(resolveRef(ref, acc.ctx), ref, acc));
            if (!p || !q || !r) return;
            const settings: Record<string, unknown> = { aAxis: p, bAxis: q, cAxis: r };
            if (a.nodes?.length) settings.nodes = a.nodes;
            addPlot('ternary', settings, a.title, acc);
            return;
        }
        case 'diagram': {
            await ensureDiagramsLoaded();
            let d = getDiagramV3(a.id);
            if (!d && a.nameMatch) {
                const re = new RegExp(a.nameMatch, 'i');
                const hit = useClassificationStore.getState().diagrams.find(x => re.test(x.name) || re.test(x.id));
                if (hit) d = getDiagramV3(hit.id) ?? { id: hit.id, name: hit.name } as ReturnType<typeof getDiagramV3>;
            }
            if (!d) { acc.warnings.push(`Diagram not in the library: ${a.id}`); return; }
            const id = createPlotFromDiagram(d.id);
            acc.plotIds.push(id);
            if (a.nodes?.length) useAppStore.getState().updatePlotSettings(id, { nodes: a.nodes });
            return;
        }
        case 'probability': {
            const cols = resolveList(a.cols, acc);
            if (!cols.length) return;
            addPlot('probability', {
                selectedColumns: cols,
                probabilityKind: a.fraction ? 'fraction' : 'probability',
                valueScale: a.log === false ? 'linear' : 'log',
                splitByColour: a.split ?? true,
            }, undefined, acc);
            return;
        }
        case 'spider': {
            const cols = resolveList(a.elements, acc);
            if (!cols.length) return;
            addPlot('spider', { selectedElements: cols, elementOrderId: 'custom', normalizationId: a.normalizationId, profileMode: a.profiles ?? 'both' }, undefined, acc);
            return;
        }
        case 'pcaResults': {
            const need = pcaNeeds(a);
            if (need) { acc.missing.push(need); return; }
            useTransformationStore.getState().setPcaUi({ resultsTab: 2 });
            acc.plotIds.push(openPcaResultsWindow());
            return;
        }
        case 'indices': {
            const cols = pcaIndexColumns();
            if (!cols.length) { acc.missing.push(NEEDS_INDICES); return; }
            if (a.plot === 'probability') {
                // Indices are sums of logs (can be negative): linear axis
                addPlot('probability', { selectedColumns: cols, probabilityKind: 'probability', valueScale: 'linear', splitByColour: true }, 'Indices', acc);
            } else if (a.plot === 'scatter') {
                let ys = cols.slice(1);
                if (!ys.length) {
                    ys = s.columns.map(c => c.name).filter(n => /^PC\d+$/.test(n)).slice(0, 3);
                    if (!ys.length) { acc.warnings.push('Build a second index (or add the PC scores) to plot indices against each other'); return; }
                }
                addPlot('scatter', { xAxis: cols[0], yAxes: ys, yxMode: true }, `${cols[0]} vs indices`, acc);
            } else {
                const east = s.columns.find(c => c.role === 'East')?.name;
                const north = s.columns.find(c => c.role === 'North')?.name;
                if (!east || !north) { acc.missing.push('East', 'North'); return; }
                const r = colourByQuantiles(cols[0]);
                if (!r.ok) acc.warnings.push(r.message);
                addPlot('map', { xAxis: east, yAxis: north }, `Map: ${cols[0]}`, acc);
            }
            return;
        }
        case 'map':
        case 'pathfinder': {
            const east = s.columns.find(c => c.role === 'East')?.name;
            const north = s.columns.find(c => c.role === 'North')?.name;
            if (!east || !north) { acc.missing.push('East', 'North'); return; }
            if (a.kind === 'map') {
                addPlot('map', { xAxis: east, yAxis: north, ...(a.style === 'osm' ? { mapViewStyle: 'osm' } : {}) }, undefined, acc);
                return;
            }
            const std = new Set<string>(PATHFINDER_ELEMENTS);
            const core = a.elements.filter(e => std.has(e)) as PathfinderElement[];
            const extended = a.elements.filter(e => !std.has(e));
            const settings: Record<string, unknown> = { xAxis: east, yAxis: north };
            if (core.length) settings.selectedElements = core;
            if (extended.length && !core.length) { settings.mapMode = 'extended'; settings.selectedExtendedElements = extended; }
            else if (extended.length) acc.warnings.push(`Pathfinder map: ${extended.join(', ')} are only in Extended mode`);
            addPlot('pathfinder', settings, undefined, acc);
            return;
        }
        default:
            return;
    }
}

function runCalc(a: Extract<WorkflowAction, { kind: 'calc' }>, acc: Acc, workflow: Workflow): void {
    const s = useAppStore.getState();
    const exists = resolveRef({ calc: a.name }, acc.ctx);
    if (exists) { acc.reused.push(exists.column); return; }
    const built = buildCalcSheet(a, acc.ctx);
    acc.warnings.push(...built.warnings);
    if (!built.sheet) { acc.missing.push(...built.missing); return; }
    const rowCount = s.columnarData.rowCount;
    const out = evaluateSheet(built.sheet, n => s.getNumericColumn(n), rowCount, s.columns.map(c => c.name));
    if (!out.length) { acc.warnings.push(`${a.name}: expression could not be evaluated`); return; }
    const created = new Date().toISOString();
    const description = `${built.sheet.outputs[0].expression} (${built.letters.join(', ')})`;
    for (const o of out) {
        s.addColumn(o.name, Array.from(o.values, v => (Number.isFinite(v) ? v : null)), 'numeric', 'Calculated', null, `workflow-${workflow.id}`,
            { kind: 'calculation', description, params: { inputs: built.sheet.inputs, mode: 'multivariate', workflow: workflow.id }, created });
        acc.added.push(o.name);
    }
    useAuditStore.getState().recordAudit({
        category: 'calculation',
        operation: 'Workflow calculation',
        description: `${workflow.name}: ${a.name} = ${description}`,
        parameters: { workflow: workflow.id, expression: a.expr, inputs: built.sheet.inputs },
        inputColumns: built.sheet.inputs.map(i => i.column),
        outputColumns: out.map(o => o.name),
        rowsAffected: rowCount,
    });
    acc.ctx = contextFromStore(workflow);
}

function runRules(a: Extract<WorkflowAction, { kind: 'rules' }>, acc: Acc): void {
    // A rule missing one of its columns loads disabled: dropping the condition would silently widen the rule
    const rules: ClassRule[] = a.rules.map(r => {
        const unresolved: string[] = [];
        const conditions = r.where.map(w => {
            const res = resolveRef(w.on, acc.ctx);
            if (!res) { unresolved.push(refLabel(w.on)); return { column: '', min: w.min ?? null, max: w.max ?? null }; }
            return { column: res.column, min: w.min != null ? w.min / res.scale : null, max: w.max != null ? w.max / res.scale : null };
        });
        if (unresolved.length) {
            acc.missing.push(...unresolved);
            acc.warnings.push(`Rule "${r.name}" disabled: needs ${unresolved.join(', ')}`);
        }
        return { name: r.name, color: r.colour, enabled: unresolved.length === 0, conditions };
    });
    const rs = useRuleSetStore.getState();
    rs.setName(a.name);
    rs.setRules(rules);
    useUIStore.getState().setRulesOpen(true);
    acc.opened.push('rules');
}

function runFromColour(a: Extract<WorkflowAction, { kind: 'fromColour' }>, acc: Acc): void {
    const s = useAppStore.getState();
    if (s.columns.some(c => c.name === a.name)) { acc.reused.push(a.name); return; }
    const values = attributeColumnValues('color', s.columnarData.rowCount, n => s.getRawColumn(n));
    if (!values.some(Boolean)) { acc.warnings.push('No colour groups to keep: paint groups first'); return; }
    s.addColumn(a.name, values, 'categorical', 'Classification');
    acc.added.push(a.name);
}

/** Run every action of a step. Plot actions open together; analysis actions switch the view. */
export async function runStep(workflow: Workflow, step: WorkflowStep, opts: RunOptions = {}): Promise<StepResult> {
    const acc: Acc = { plotIds: [], added: [], reused: [], missing: [], warnings: [], opened: [], ctx: contextFromStore(workflow) };
    const app = useAppStore.getState();
    for (const a of step.actions) if (a.kind === 'calc') runCalc(a, acc, workflow);
    for (const a of step.actions) if (a.kind === 'fromColour') runFromColour(a, acc);

    const plotActions = step.actions.filter(a => PLOT_KINDS.has(a.kind));
    if (plotActions.length && opts.replacePlotIds?.length) {
        const open = new Set(useAppStore.getState().plots.map(p => p.id));
        for (const id of opts.replacePlotIds) if (open.has(id)) app.removePlot(id);
    }
    for (const a of plotActions) await runPlot(a, acc);
    if (acc.plotIds.length) {
        useAppStore.getState().setActivePlotId(acc.plotIds[0]);
        useAppStore.getState().setCurrentView('plots');
        acc.opened.push('plots');
        if (opts.tile !== false && acc.plotIds.length >= 2 && acc.plotIds.length <= MAX_TILED) tilePlotsWhenReady(acc.plotIds);
    }

    for (const a of step.actions) {
        if (a.kind === 'boxplot') {
            const cols = resolveList(a.cols, acc);
            if (!cols.length) continue;
            const groupBy = !a.groupBy || a.groupBy === 'colour' ? BOX_PLOT_COLOUR_GROUPS : (label(resolveRef(a.groupBy, acc.ctx), a.groupBy, acc) ?? BOX_PLOT_COLOUR_GROUPS);
            useBoxPlotStore.getState().set({
                numericColumns: cols, categoryColumn: groupBy, logScale: a.log ?? true,
                showCrust: !!a.crust, refValue: a.line != null ? String(a.line) : '', panels: true,
            });
            useUIStore.getState().setAnalysisTab(1);
            useAppStore.getState().setCurrentView('analysis');
            acc.opened.push('analysis');
        } else if (a.kind === 'analysis') {
            useUIStore.getState().setAnalysisTab(a.tab);
            useAppStore.getState().setCurrentView('analysis');
            acc.opened.push('analysis');
        } else if (a.kind === 'rules') {
            runRules(a, acc);
        } else if (a.kind === 'dialog') {
            if (a.dialog === 'dataDoctor') useUIStore.getState().setDataDoctorOpen(true);
            else useUIStore.getState().setAssayProtocolsOpen(true);
            acc.opened.push('dialog');
        }
    }
    acc.missing = [...new Set(acc.missing)];
    acc.warnings = [...new Set(acc.warnings)];
    const { ctx: _ctx, ...result } = acc;
    void _ctx;
    return result;
}

/** Close plots (a step's, or every plot when no ids are given) */
export function clearWorkflowPlots(ids?: string[]): void {
    const s = useAppStore.getState();
    const open = new Set(s.plots.map(p => p.id));
    for (const id of ids ?? [...open]) if (open.has(id)) s.removePlot(id);
}

/** Lint a workflow definition (library test and authoring aid). */
export function validateWorkflow(w: Workflow): string[] {
    const errors: string[] = [];
    const ids = new Set<string>();
    const calcsSoFar = new Set<string>();
    const nodeIds = new Set(NODE_LIBRARY.map(n => n.id));
    if (!w.summary || w.summary.includes('\n')) errors.push(`${w.id}: summary must be one line`);
    for (const step of w.steps) {
        const at = `${w.id}/${step.id}`;
        if (ids.has(step.id)) errors.push(`${at}: duplicate step id`);
        ids.add(step.id);
        if (!step.actions.length) errors.push(`${at}: no actions`);
        if (step.note.split('\n').length > 2) errors.push(`${at}: note longer than two lines`);
        if (step.look.includes('\n')) errors.push(`${at}: look must be one line`);
        for (const a of step.actions) if (a.kind === 'calc') calcsSoFar.add(a.name);
        const plot = step.actions.some(a => PLOT_KINDS.has(a.kind));
        const view = step.actions.some(a => a.kind === 'boxplot' || a.kind === 'analysis');
        if (plot && view) errors.push(`${at}: mixes plots with an Analysis view (the view would hide the plots)`);
        const checkRef = (ref: Parameters<typeof refLabel>[0]) => {
            if ('calc' in ref && !calcsSoFar.has(ref.calc)) errors.push(`${at}: {calc:'${ref.calc}'} has no calc action in this or an earlier step`);
            if ('any' in ref) ref.any.forEach(checkRef);
        };
        for (const a of step.actions) {
            const refs = actionRefs(a);
            refs.required.forEach(checkRef);
            refs.oneOf.flat().forEach(checkRef);
            if (a.kind === 'scatter') for (const l of a.refLines ?? []) {
                if ('level' in l) checkRef(l.level.on);
                else if (!refElement(l.ratio.num) || !refElement(l.ratio.den)) errors.push(`${at}: ratio lines need element refs`);
            }
            const nodes = a.kind === 'scatter' || a.kind === 'ternary' || a.kind === 'diagram' ? a.nodes ?? [] : [];
            for (const n of nodes) if (!n.startsWith('tie:') && !n.startsWith('opt:') && !nodeIds.has(n)) errors.push(`${at}: unknown node '${n}'`);
        }
    }
    return errors;
}
