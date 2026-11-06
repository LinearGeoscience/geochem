/**
 * Single source of truth for transformation formula descriptions and references.
 * Used by audit recording, provenance reports, and any future UI tooltips.
 *
 * When a formula or algorithm changes, update THIS file — all consumers
 * (TransformationManager, RecalculationWizard, report generator) read from here.
 */

export interface TransformationMeta {
    name: string;
    formulaDisplay: string;
    references: string[];
}

export const TRANSFORMATION_METADATA: Record<string, TransformationMeta> = {
    clr: {
        name: 'Centred Log-Ratio',
        formulaDisplay: 'clr(x_i) = ln(x_i / g(x)) where g(x) = geometric mean',
        references: ['Aitchison (1986)', 'Greenacre (2021) GeoCoDA'],
    },
    alr: {
        name: 'Additive Log-Ratio',
        formulaDisplay: 'alr(x_i) = ln(x_i / x_ref)',
        references: ['Aitchison (1986)'],
    },
    ilr: {
        name: 'Isometric Log-Ratio',
        formulaDisplay: 'ILR coordinates via Helmert sub-composition matrix',
        references: ['Egozcue et al. (2003)'],
    },
    plr: {
        name: 'Pivot Log-Ratio',
        formulaDisplay: 'plr(x_i) = sqrt((D-i)/(D-i+1)) * ln(x_i / g(x_{i+1}...x_D))',
        references: ['Egozcue & Pawlowsky-Glahn (2005)'],
    },
    slr: {
        name: 'Subcomposition Log-Ratio',
        formulaDisplay: 'slr = ln(g(numerator) / g(denominator))',
        references: ['Greenacre (2021)'],
    },
    chipower: {
        name: 'Chi-Power',
        formulaDisplay: 'x_ij^lambda / sum_j(x_ij^lambda)',
        references: ['Greenacre (2009)'],
    },
    barnes: {
        name: 'Barnes Recalculation',
        formulaDisplay: 'Pipeline: volatile-free normalization \u2192 MgO-dependent Fe2O3/FeO split \u2192 sulfide correction \u2192 sulfide-free renormalization',
        references: ['Barnes (2023)'],
    },
    'log-additive': {
        name: 'Log Additive Index',
        formulaDisplay: 'LAI = ln(x_1) + ln(x_2) + ... + ln(x_n)',
        references: ['Explorative compositional data analysis'],
    },
};
