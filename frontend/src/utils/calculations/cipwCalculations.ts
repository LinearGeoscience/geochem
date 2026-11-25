/**
 * CIPW norm minerals as Calculation Manager definitions (category "norms").
 * Each mineral is its own output column; the norm itself is computed once
 * per analysis and cached, so adding many minerals stays cheap.
 */
import type { CalculationDefinition, InputDefinition } from '../../types/calculations';
import { COLUMN_PATTERNS } from './constants';
import { CIPW_MINERALS, CIPW_MINERAL_NAMES, CIPW_OXIDES, CipwInput, CipwResult, cipwNorm, CipwMineral } from './cipwNorm';

const OPTIONAL = new Set(['MnO', 'P2O5', 'ZrO2', 'FeO', 'Fe2O3', 'TiO2']);

function oxideInput(ox: string): InputDefinition {
    const known = COLUMN_PATTERNS[ox];
    return {
        name: ox,
        description: ox === 'Fe2O3'
            ? 'Fe2O3 (wt%): ferric iron, or TOTAL iron as Fe2O3 when no FeO column is mapped'
            : ox === 'FeO' ? 'FeO (wt%): ferrous iron, or total iron as FeO when no Fe2O3 column is mapped'
                : `${ox} (wt%)`,
        required: !OPTIONAL.has(ox),
        unit: 'wt%',
        aliases: known?.aliases ?? [ox, `${ox}_pct`, `${ox}_wt`],
        patterns: known?.patterns ?? [new RegExp(`^${ox}`, 'i')],
    };
}

// Small cache: identical analyses (the same row seen by several mineral
// calculations) compute the norm once
const cache = new Map<string, CipwResult | null>();
function normFor(inputs: Record<string, number | null>): CipwResult | null {
    const key = CIPW_OXIDES.map(k => inputs[k] ?? '').join('|');
    let r = cache.get(key);
    if (r === undefined) {
        const given: CipwInput = {};
        for (const k of CIPW_OXIDES) given[k] = inputs[k] ?? null;
        // Only one iron oxide mapped → it is total iron; split it with Le Maitre (1976, volcanic)
        const hasFe3 = given.Fe2O3 != null && given.Fe2O3 > 0;
        const hasFe2 = given.FeO != null && given.FeO > 0;
        const fe = hasFe3 !== hasFe2 ? { kind: 'le-maitre' as const, rock: 'volcanic' as const } : { kind: 'as-given' as const };
        r = cipwNorm(given, { normalize: true, fe });
        if (cache.size > 20000) cache.clear();
        cache.set(key, r);
    }
    return r;
}

const REFERENCES = [
    'Cross W., Iddings J.P., Pirsson L.V., Washington H.S. (1902) A quantitative chemico-mineralogical classification and nomenclature of igneous rocks. J. Geol. 10, 555-690.',
    'Le Maitre R.W. (1976) Some problems of the projection of chemical data into mineralogical classifications. Contrib. Mineral. Petrol. 56, 181-189.',
];

export function generateCipwDefinitions(): CalculationDefinition[] {
    const inputs = CIPW_OXIDES.map(oxideInput);
    const description =
        'CIPW norm on the anhydrous analysis recalculated to 100 %. If only one iron oxide is mapped it is treated as total iron and split with Le Maitre (1976).';
    const defs: CalculationDefinition[] = CIPW_MINERALS.map((m: CipwMineral) => ({
        id: `cipw-${m.toLowerCase()}`,
        name: `CIPW ${CIPW_MINERAL_NAMES[m]} (${m}, wt%)`,
        category: 'norms',
        description,
        formula: null,
        formulaDisplay: `CIPW norm: ${CIPW_MINERAL_NAMES[m]} (wt %)`,
        inputs,
        outputUnit: 'wt%',
        validationRules: [],
        calculateFn: (vals) => normFor(vals)?.wt[m] ?? null,
        references: REFERENCES,
    }));
    defs.push({
        id: 'cipw-differentiation-index',
        name: 'CIPW Differentiation Index (Q+Or+Ab+Ne+Lc+Kp)',
        category: 'norms',
        description,
        formula: null,
        formulaDisplay: 'DI = Q + Or + Ab + Ne + Lc + Kp (CIPW wt %)',
        inputs,
        outputUnit: 'index',
        validationRules: [],
        calculateFn: (vals) => normFor(vals)?.DI ?? null,
        references: REFERENCES,
    });
    for (const m of ['Q', 'Or', 'Ab', 'An'] as const) {
        defs.push({
            id: `cipw-vol-${m.toLowerCase()}`,
            name: `CIPW ${CIPW_MINERAL_NAMES[m]} (${m}, vol%)`,
            category: 'norms',
            description: `${description} Volume % from mineral densities (for QAP).`,
            formula: null,
            formulaDisplay: `CIPW norm: ${CIPW_MINERAL_NAMES[m]} (volume %)`,
            inputs,
            outputUnit: 'wt%',
            validationRules: [],
            calculateFn: (vals) => normFor(vals)?.vol[m] ?? null,
            references: REFERENCES,
        });
    }
    return defs;
}
