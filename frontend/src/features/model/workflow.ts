/**
 * Setting a geological model up, step by step (Phase 211): drillholes, the
 * units grouped from their logging, the model and the ground it covers, its
 * contacts in age order, its faults (if it has any), the comparison with the
 * logging, and what it gives. Where the project stands in each is worked
 * out from the project as it is, never kept: the steps cannot fall out of
 * date, and a project made before they existed shows them the same.
 *
 * One step at most is the next one to take: the first that is not done
 * (shown as busy, or as having something the matter, when that is why it
 * is not). Faults are never the next step: a model need not have any.
 */
import { t } from './terms';
import { sharePercent } from './geoModelFlag';

export const STEP_IDS = ['data', 'lithologies', 'model', 'chronology', 'faults', 'check', 'outputs'] as const;
export type StepId = (typeof STEP_IDS)[number];

/**
 * done = nothing more is needed; next = the one to take now; todo = it waits
 * for an earlier step; optional = it can be left; busy = being worked out;
 * problem = something is the matter with it (the note says what).
 */
export type StepState = 'done' | 'next' | 'todo' | 'optional' | 'busy' | 'problem';

/** What is known of the model the steps are for */
export interface WorkflowModel {
    name: string;
    /** The units of the grouping it reads (0: it reads none) */
    units: number;
    /** Its contacts that are in it for now, and those left out */
    contacts: number;
    off: number;
    faults: number;
    /** What is the matter with how it is set up, and the part of the model each is put right in (geoModel.modelProblemList) */
    problems: readonly { text: string; part: 'lithologies' | 'boundary' | 'chronology' | 'faults' }[];
    /** Surfaces of it being fitted, and those that could not be */
    fitting: number;
    failed: number;
    /** Its build (null: none asked for yet) */
    build: 'building' | 'ready' | 'waiting' | 'empty' | 'stale' | 'failed' | null;
    buildError?: string;
    /** Units of the build with no ground in the model */
    empty: readonly string[];
    /** The build it has now has been compared with the logging, or checked against holes left out */
    checked: boolean;
    /** Compared with the logging: the metres compared, and of those the metres in the unit they were logged as (absent: not compared) */
    agreed?: { agreed: number; metres: number };
}

export interface WorkflowFacts {
    /** Holes there are to model from (0: none) */
    holes: number;
    /** Something is logged down them to make units from */
    logged: boolean;
    /** What is the matter with the drillholes and their logging (holeChecks): how many kinds of problem, and of things to look at */
    findings?: { problems: number; warnings: number };
    /** Groupings of logged codes in the project */
    groupings: number;
    /** The model the steps are for (null: the project has none) */
    model: WorkflowModel | null;
}

export interface WorkflowStep {
    id: StepId;
    /** What the step is called */
    label: string;
    state: StepState;
    /** Where it stands, in a few plain words */
    note: string;
}

const many = (n: number, one: string, more = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : more}`;

export const stepLabel = (id: StepId): string => {
    switch (id) {
        case 'data': return t('drillholes');
        case 'lithologies': return t('lithologies');
        case 'model': return t('stepModel');
        case 'chronology': return t('chronology');
        case 'faults': return t('faultSystem');
        case 'check': return t('checkAgainstDrilling');
        case 'outputs': return t('tabOutputs');
    }
};

/** The steps, in order, with where each stands */
export function modelWorkflow(facts: WorkflowFacts): WorkflowStep[] {
    const m = facts.model;
    // (With no contacts it is one block of its base unit: built, but nothing to compare or to give yet)
    const built = m?.build === 'ready' && m.contacts > 0;
    // What is the matter with how it is set up, by the step it is put right in (the first of each)
    const wrong = (part: 'lithologies' | 'boundary' | 'chronology' | 'faults'): string | null => m?.problems.find(p => p.part === part)?.text ?? null;
    // Kinds of problem in the drillholes and their logging, and of things to look at (none without holes)
    const wrongData = facts.holes > 0 ? facts.findings?.problems ?? 0 : 0;
    const lookAt = facts.holes > 0 ? facts.findings?.warnings ?? 0 : 0;
    // What is finished, step by step (a later step can be finished before an earlier one: nothing is locked)
    const done: Record<StepId, boolean> = {
        data: facts.holes > 0,
        lithologies: m ? m.units > 0 : facts.groupings > 0,
        model: !!m && m.build !== 'empty',
        chronology: !!m && m.contacts > 0 && m.failed === 0,
        faults: !!m && m.faults > 0,
        check: !!m && built && m.checked,
        outputs: !!m && built && m.empty.length === 0,
    };
    const note: Record<StepId, string> = {
        data: facts.holes === 0 ? 'Import drillholes and their logging'
            : wrongData > 0 ? `${many(facts.holes, 'hole')}: ${many(wrongData, 'problem')} in them or their logging`
                : `${many(facts.holes, 'hole')}${facts.logged ? '' : ', no logging yet'}${lookAt > 0 ? `, ${many(lookAt, 'thing')} to look at` : ''}`,
        lithologies: wrong('lithologies') ?? (m && m.units > 0 ? many(m.units, 'unit')
            : m && facts.groupings > 0 ? 'The model reads none yet: choose them'
                : !m && facts.groupings > 0 ? many(facts.groupings, 'grouping')
                    : 'Group the logged codes into units'),
        model: wrong('boundary') ?? (!m ? 'Start a model: its lithologies, its boundary, its topography'
            : m.build === 'empty' ? `${m.name}: it has no box to be built in`
                : m.name),
        chronology: !m ? 'The surfaces between its units'
            : wrong('chronology') !== null ? wrong('chronology')!
                : m.failed > 0 ? `${many(m.failed, 'surface')} could not be fitted`
                    : m.contacts === 0 ? (m.off > 0 ? 'No contact is active' : 'Build its chronology from its lithologies')
                        : `${many(m.contacts, 'contact')}${m.off > 0 ? `, ${m.off} not active` : ''}${m.fitting > 0 ? ': being fitted…' : ''}`,
        faults: wrong('faults') ?? (!m ? 'If faults cut it' : m.faults > 0 ? many(m.faults, 'fault') : 'None: add them if faults cut it'),
        check: !m || m.contacts === 0 ? 'Once it is built'
            : !built ? 'Once it is built'
                : m.checked && m.agreed && m.agreed.metres > 0 ? `Compared: ${sharePercent(m.agreed.agreed, m.agreed.metres)}% of the logging is in the unit it was logged as`
                    : m.checked ? 'Compared with what was logged'
                    : 'See how much of the logging it agrees with',
        outputs: !m || m.contacts === 0 ? 'Volumes, sections, meshes'
            : m.build === 'building' || m.build === 'waiting' ? 'Being built…'
                : m.build === 'failed' ? `It could not be built${m.buildError ? `: ${m.buildError}` : ''}`
                    : m.build === 'stale' ? 'Out of date: build it again'
                        : built && m.empty.length > 0 ? `No ground in the model for ${m.empty.join(', ')}`
                            : built ? 'Built: volumes, sections, meshes'
                                : 'Volumes, sections, meshes',
    };
    const problem: Record<StepId, boolean> = {
        data: wrongData > 0,
        lithologies: wrong('lithologies') !== null,
        model: m?.build === 'empty' || wrong('boundary') !== null,
        chronology: !!m && (wrong('chronology') !== null || m.failed > 0),
        faults: wrong('faults') !== null,
        check: false,
        outputs: !!m && m.contacts > 0 && (m.build === 'failed' || m.build === 'stale' || (built && m.empty.length > 0)),
    };
    const busy: Record<StepId, boolean> = {
        data: false, lithologies: false, model: false,
        chronology: !!m && m.fitting > 0,
        faults: false, check: false,
        outputs: !!m && m.contacts > 0 && (m.build === 'building' || m.build === 'waiting'),
    };
    // A step is settled when it is done and nothing is being worked out or the matter in it. The one to look at is the
    // first that is not (the comparison only once there is a build to compare)
    // (Problems in the drillholes do not hold the later steps up: they are said, and the user goes on or puts them right)
    const settled = (id: StepId) => done[id] && !busy[id] && (id === 'data' || !problem[id]);
    const next = STEP_IDS.find(id => id !== 'faults' && !settled(id) && (id !== 'check' || built)) ?? null;
    return STEP_IDS.map(id => ({
        id,
        label: stepLabel(id),
        note: note[id],
        state: problem[id] ? 'problem'
            : busy[id] ? 'busy'
                : done[id] ? 'done'
                    : id === next ? 'next'
                        : id === 'faults' ? 'optional'
                            : 'todo',
    }));
}

/** The step to take now (null: every step is done, or the one that is not is being worked out or has something the matter) */
export const nextStep = (steps: readonly WorkflowStep[]): WorkflowStep | null => steps.find(s => s.state === 'next') ?? null;

/** How far along it is: the steps done, of those that must be */
export function progress(steps: readonly WorkflowStep[]): { done: number; of: number } {
    const must = steps.filter(s => s.id !== 'faults');
    return { done: must.filter(s => s.state === 'done').length, of: must.length };
}
