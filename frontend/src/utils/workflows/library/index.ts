/** The built-in deposit-style workflows, in menu order. */
import type { Workflow } from '../types';
import { lithologyFromAssays } from './lithologyFromAssays';
import { pcaIndices } from './pcaIndices';
import { combineSurveys } from './combineSurveys';
import { intrusionFertility } from './intrusionFertility';
import { porphyryAlteration } from './porphyryAlteration';
import { epithermalLS } from './epithermalLS';
import { orogenicAu } from './orogenicAu';
import { komatiiteNi } from './komatiiteNi';
import { niCuPgeIntrusion } from './niCuPgeIntrusion';
import { lctPegmatite } from './lctPegmatite';

export const WORKFLOWS: Workflow[] = [
    lithologyFromAssays,
    pcaIndices,
    combineSurveys,
    intrusionFertility,
    porphyryAlteration,
    epithermalLS,
    orogenicAu,
    komatiiteNi,
    niCuPgeIntrusion,
    lctPegmatite,
];

/** Groups in menu order */
export const WORKFLOW_GROUPS: string[] = [...new Set(WORKFLOWS.map(w => w.group))];

export function workflowById(id: string): Workflow | undefined {
    return WORKFLOWS.find(w => w.id === id);
}
