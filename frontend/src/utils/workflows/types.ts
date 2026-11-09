/**
 * Deposit-style quick workflows: short Scott Halley-style recipes a geologist
 * steps through. A workflow is data. Each step names what to open and why;
 * the runner (runner.ts) turns the actions into plots, calculated columns,
 * box plots and rule presets through the ordinary store APIs. Nothing here
 * labels samples: cut-offs appear as lines, fields and editable rule sheets.
 *
 * Column references are by MEANING, never by column name, so one recipe
 * works on Cu_ppm, cu_ppm_d or Cu %:
 *   { el: 'Sc' }        element column (ppm preferred; falls back to the
 *                       element's oxide column with conversion)
 *   { ox: 'SiO2' }      oxide column (wt%); asElement -> element wt%
 *   { calc: 'V/Sc' }    a column made by a calc action (or already present)
 *   { role: 'East' }    a column by dataset role
 *   { any: [...] }      the first that resolves (Mg | MgO, Au ppm | ppb)
 *   { col: 'Name' }     escape hatch: a raw name (exact / case-insensitive)
 *
 * Units in calcs and rules: element refs are normalised to ppm, oxide refs
 * stay wt% (asElement -> element wt%), calc/col refs are left as they are.
 * Author expressions and thresholds in those units; the runner rewrites the
 * letters ((A*10000)/B) and divides thresholds by each column's scale.
 */

export type ElementRef =
    | { el: string }
    | { ox: string; asElement?: boolean }
    | { calc: string }
    | { role: 'East' | 'North' | 'Elevation' | 'HoleID' | 'ID' | 'From' | 'To' }
    | { any: ElementRef[] }
    | { col: string };

/** A reference line on a scatter panel. */
export type RefLineSpec =
    /** y = value * x in element mass (or molar) units; num/den must be element refs */
    | { ratio: { num: ElementRef; den: ElementRef; value: number; molar?: boolean; label?: string } }
    /** A constant line at `at` on the panel axis showing `on` */
    | { level: { on: ElementRef; at: number; label?: string } };

export interface RulePreset {
    name: string;
    colour: string;
    /** Every window must hold (min/max inclusive; omit one side for open) */
    where: { on: ElementRef; min?: number; max?: number }[];
}

export type WorkflowAction =
    | { kind: 'scatter'; x: ElementRef; ys: ElementRef[]; yx?: boolean; log?: 'x' | 'y' | 'xy'; density?: boolean; refLines?: RefLineSpec[]; nodes?: string[]; title?: string }
    | { kind: 'ternary'; a: ElementRef; b: ElementRef; c: ElementRef; nodes?: string[]; title?: string }
    /** Library diagram by id (legacy ids accepted); nameMatch = regex fallback on the name */
    | { kind: 'diagram'; id: string; nameMatch?: string; nodes?: string[] }
    | { kind: 'probability'; cols: ElementRef[]; split?: boolean; fraction?: boolean; log?: boolean }
    | { kind: 'boxplot'; cols: ElementRef[]; groupBy?: 'colour' | ElementRef; crust?: boolean; log?: boolean; line?: number }
    /** New column from a-dialect expression over single capital letters */
    | { kind: 'calc'; name: string; expr: string; inputs: Record<string, ElementRef>; aliases?: string[]; note?: string }
    /** Pre-filled Classify-by-rules sheet; the user reviews and applies */
    | { kind: 'rules'; name: string; rules: RulePreset[] }
    | { kind: 'spider'; elements: ElementRef[]; normalizationId: string; profiles?: 'samples' | 'groups' | 'both' }
    | { kind: 'map'; style?: 'osm' | 'none' }
    | { kind: 'pathfinder'; elements: string[] }
    /** Colour groups -> a text column ("From Colour") */
    | { kind: 'fromColour'; name: string }
    /** Analysis view tab (0 stats, 1 box plots, 8 transformations, 9 PCA, 11 recalculation) */
    | { kind: 'analysis'; tab: number }
    /** Open a data dialog (the user reviews, then applies) */
    | { kind: 'dialog'; dialog: WorkflowDialog }
    /** PCA results window on the ranked scaled eigenvector plots (needs a PCA run) */
    | { kind: 'pcaResults' }
    /** Plots of the indices made with Build Index on the eigenvector plots, in the order made */
    | { kind: 'indices'; plot: 'probability' | 'scatter' | 'map' }
    | { kind: 'note' };

export interface WorkflowStep {
    id: string;
    title: string;
    /** Why (at most two lines) */
    note: string;
    /** What to look for (one line) */
    look: string;
    actions: WorkflowAction[];
}

export interface WorkflowReference {
    cite: string;
    note?: string;
}

export interface Workflow {
    id: string;
    name: string;
    /** Menu group ("Basics", "Porphyry & epithermal", ...) */
    group: string;
    /** One line */
    summary: string;
    steps: WorkflowStep[];
    references: WorkflowReference[];
}

/** What a step did (or could not do) */
export interface StepResult {
    plotIds: string[];
    /** Calculated / text columns created */
    added: string[];
    /** Columns that already existed and were used as they are */
    reused: string[];
    /** Labels of references that did not resolve on this dataset */
    missing: string[];
    warnings: string[];
    /** Views or dialogs the step opened */
    opened: Array<'plots' | 'analysis' | 'rules' | 'dialog'>;
}

export type CalcAction = Extract<WorkflowAction, { kind: 'calc' }>;
export type ScatterAction = Extract<WorkflowAction, { kind: 'scatter' }>;
export type RulesAction = Extract<WorkflowAction, { kind: 'rules' }>;

/** Data dialogs a workflow step can open (the Combine surveys tabs by name) */
export type WorkflowDialog = 'dataDoctor' | 'assayProtocols' | 'overlap' | 'levelling' | 'commonDl';
