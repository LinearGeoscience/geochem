/**
 * Terse builders for workflow definitions (see ../types.ts for the units:
 * element refs are ppm, oxide refs wt%, calc refs as made).
 */
import type { ElementRef, RefLineSpec, RulePreset, Workflow, WorkflowAction, WorkflowReference, WorkflowStep } from '../types';

type Scatter = Extract<WorkflowAction, { kind: 'scatter' }>;
type Box = Extract<WorkflowAction, { kind: 'boxplot' }>;
type Prob = Extract<WorkflowAction, { kind: 'probability' }>;

export const el = (sym: string): ElementRef => ({ el: sym });
export const ox = (formula: string, asElement = false): ElementRef => (asElement ? { ox: formula, asElement: true } : { ox: formula });
export const calc = (name: string): ElementRef => ({ calc: name });
export const any = (...refs: ElementRef[]): ElementRef => ({ any: refs });

/** SiO2 when assayed, else Sc as Halley's 4-acid proxy for silica */
export const SILICA = any(ox('SiO2'), el('Sc'));

export const xy = (x: ElementRef, ys: ElementRef[], more: Partial<Omit<Scatter, 'kind' | 'x' | 'ys'>> = {}): WorkflowAction =>
    ({ kind: 'scatter', x, ys, ...more });
export const yx = (x: ElementRef, ys: ElementRef[], more: Partial<Omit<Scatter, 'kind' | 'x' | 'ys'>> = {}): WorkflowAction =>
    ({ kind: 'scatter', x, ys, yx: true, ...more });
export const tern = (a: ElementRef, b: ElementRef, c: ElementRef, nodes?: string[]): WorkflowAction =>
    ({ kind: 'ternary', a, b, c, ...(nodes ? { nodes } : {}) });
export const diag = (id: string, nodes?: string[], nameMatch?: string): WorkflowAction =>
    ({ kind: 'diagram', id, ...(nodes ? { nodes } : {}), ...(nameMatch ? { nameMatch } : {}) });
/** Split cumulative-frequency plot by colour group, log scale */
export const cum = (cols: ElementRef[], more: Partial<Omit<Prob, 'kind' | 'cols'>> = {}): WorkflowAction =>
    ({ kind: 'probability', cols, fraction: true, split: true, log: true, ...more });
/** Box plots by colour group against the upper-crust line, log scale */
export const box = (cols: ElementRef[], more: Partial<Omit<Box, 'kind' | 'cols'>> = {}): WorkflowAction =>
    ({ kind: 'boxplot', cols, crust: true, log: true, ...more });
export const spider = (elements: ElementRef[], normalizationId: string, profiles: 'samples' | 'groups' | 'both' = 'both'): WorkflowAction =>
    ({ kind: 'spider', elements, normalizationId, profiles });
export const map = (style: 'osm' | 'none' = 'none'): WorkflowAction => ({ kind: 'map', style });
export const pathfinder = (elements: string[]): WorkflowAction => ({ kind: 'pathfinder', elements });
export const fromColour = (name: string): WorkflowAction => ({ kind: 'fromColour', name });
export const analysis = (tab: number): WorkflowAction => ({ kind: 'analysis', tab });
export const note: WorkflowAction = { kind: 'note' };
export const dialog = (name: 'dataDoctor' | 'assayProtocols'): WorkflowAction => ({ kind: 'dialog', dialog: name });
export const pcaResults: WorkflowAction = { kind: 'pcaResults' };
export const indices = (plot: 'probability' | 'scatter' | 'map'): WorkflowAction => ({ kind: 'indices', plot });

export const ratio = (num: ElementRef, den: ElementRef, value: number, opts: { molar?: boolean; label?: string } = {}): RefLineSpec =>
    ({ ratio: { num, den, value, ...opts } });
export const level = (on: ElementRef, at: number, label?: string): RefLineSpec => ({ level: { on, at, ...(label ? { label } : {}) } });

export const calcAction = (name: string, expr: string, inputs: Record<string, ElementRef>, aliases?: string[], noteText?: string): WorkflowAction =>
    ({ kind: 'calc', name, expr, inputs, ...(aliases ? { aliases } : {}), ...(noteText ? { note: noteText } : {}) });
/** Mass ratio of two refs in their canonical units */
export const calcRatio = (name: string, num: ElementRef, den: ElementRef, aliases?: string[]): WorkflowAction =>
    calcAction(name, 'A/B', { A: num, B: den }, aliases);

export const rules = (name: string, list: RulePreset[]): WorkflowAction => ({ kind: 'rules', name, rules: list });
export const rule = (name: string, colour: string, where: RulePreset['where']): RulePreset => ({ name, colour, where });
export const w = (on: ElementRef, min?: number, max?: number): RulePreset['where'][number] =>
    ({ on, ...(min != null ? { min } : {}), ...(max != null ? { max } : {}) });

export const step = (id: string, title: string, noteText: string, look: string, actions: WorkflowAction[]): WorkflowStep =>
    ({ id, title, note: noteText, look, actions });
export const cite = (text: string, extra?: string): WorkflowReference => ({ cite: text, ...(extra ? { note: extra } : {}) });
export const workflow = (def: Workflow): Workflow => def;

// Mineral reference lines (presets)
export const PYRITE = ratio(el('S'), el('Fe'), 2, { molar: true, label: 'Pyrite (Fe:S = 1:2 molar)' });
export const CALCITE = ratio(el('C'), el('Ca'), 1, { molar: true, label: 'Calcite (Ca:C = 1:1 molar)' });
export const DOLOMITE = ratio(el('Mg'), el('Ca'), 1, { molar: true, label: 'Dolomite (Ca:Mg = 1:1 molar)' });
export const ANHYDRITE = ratio(el('S'), el('Ca'), 1, { molar: true, label: 'Anhydrite (Ca:S = 1:1 molar)' });

// Shared calculated columns
export const CALC_V_SC = calcRatio('V/Sc', el('V'), el('Sc'), ['VSc', 'V_Sc']);
export const CALC_SR_Y = calcRatio('Sr/Y', el('Sr'), el('Y'), ['SrY', 'Sr_Y']);
export const CALC_ZR_HF = calcRatio('Zr/Hf', el('Zr'), el('Hf'), ['ZrHf', 'Zr_Hf']);
export const CALC_K_AL = calcAction('K/Al molar', '(A/39.098)/(B/26.982)', { A: el('K'), B: el('Al') }, ['K/Al', 'K_Al', 'K/Al (molar)']);
export const CALC_NA_AL = calcAction('Na/Al molar', '(A/22.990)/(B/26.982)', { A: el('Na'), B: el('Al') }, ['Na/Al', 'Na_Al', 'Na/Al (molar)']);
export const CALC_MG_NUMBER = calcAction('Mg#', '(A/24.305)/((A/24.305)+(B/55.845))', { A: el('Mg'), B: el('Fe') }, ['Mg/(Mg+Fe) molar', 'Mg_number', 'Mg number']);
/** Eu/Eu* on CI chondrite (McDonough & Sun 1995: Sm 0.148, Eu 0.0563, Gd 0.199) */
export const CALC_EU = calcAction('Eu/Eu*', '(A/0.0563)/SQRT((B/0.148)*(C/0.199))', { A: el('Eu'), B: el('Sm'), C: el('Gd') }, ['Eu Anomaly Norm', 'Eu_anomaly', 'EuEu*', 'Eu anomaly']);

// Library diagram ids (frontend/src/data/classificationDiagrams.json)
export const DIAGRAM = {
    feldsparNaK: 'molar_ratio__element_ratio_ger__feldspar__feldspar_na_k_control_diagram',
    alKMg: 'exploration__porphyry_cu_exploration__scott_halley__al_k_mg_ternary_plot',
    caFeS: 'exploration__porphyry_cu_exploration__scott_halley__ca_fe_s_ternary_plot',
    vScVsSc: 'exploration__porphyry_cu_exploration__scott_halley__vsc_vs_sc',
    srYVsY: 'exploration__porphyry_cu_exploration__adakites__sry_vs_y',
    jensenKalgoorlie: 'rock_classification__major_elements__jensen_cation_plot_kalgoorlie_mum_halley_2021',
    komatiiteScCr: 'rock_classification__trace_elements__komatiite_sc_vs_cr_kalgoorlie_halley_2021',
    basaltTiTh: 'rock_classification__trace_elements__basalt_ti_vs_th_kalgoorlie_halley_2021',
    pearce1996: 'rock_classification__trace_elements__volcanic_rocks_modified_pearce_1996',
    tasVolcanic: 'rock_classification__major_elements__tas_volcanic_le_maitre_et_al_1989',
    komatiiteMgOFeO: 'exploration__ni_exploration__komatiite_classification_mgo_vs_feo_barnes_et_al_2004',
    barrenKomatiite: 'exploration__ni_exploration__barren_komatiite_mgo_vs_ni_barnes_et_al_2004',
    komatiiteFacies: 'exploration__ni_exploration__komatiite_all_facies_s_rich_ni_cr_vs_ni_ti_barnes_et_al_2004',
    cuPdVsPd: 'exploration__ni_exploration__cupd_vs_pd_karykowski_et_al_2017',
    pdIrVsNiCu: 'exploration__pge_exploration__pd_ir_vs_ni_cu_barnes_1990',
    pdPtVsNiCu: 'exploration__pge_exploration__pd_pt_vs_ni_cu_barnes_1990',
} as const;

/** Analysis view tabs (features/analysis/AnalysisNav.tsx) */
export const TAB = { stats: 0, boxPlots: 1, transformations: 8, pca: 9, recalculation: 11 } as const;
