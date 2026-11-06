/**
 * Treating mixed surveys together: split by medium and protocol, check the
 * overlap between groups, level within groups for whole-area maps, censor
 * to a common detection limit for thresholds, and keep multivariate work
 * inside one group.
 */
import { el, cum, analysis, dialog, step, cite, workflow, TAB } from './builders';

export const combineSurveys = workflow({
    id: 'combine-surveys',
    name: 'Combining surveys, labs and sample media',
    group: 'Basics',
    summary: 'Datasets built from many surveys mix sample media, lab methods and detection limits. Split them, test where groups disagree, then level within groups for whole-area maps and use a common detection limit for thresholds.',
    steps: [
        step('bdl', 'Below-detection format',
            'Convert ½-detection-limit values to <DL first: every later step reads the detection limit of each group from the data.',
            'Data Doctor rows for "½ detection limit as a value"; batch columns it finds (lab method, batch number).',
            [dialog('dataDoctor')]),
        step('protocols', 'Protocols within each medium',
            'Set "Within" to the sample medium (soil, stream, rock chip, lag). Soil and rock are never compared directly; inside each medium the protocols separate lab methods and detection limits.',
            'Media that hold several protocols; protocols that only exist in one medium. Add to report records the split.',
            [dialog('assayProtocols')]),
        step('split-prob', 'Probability plots by group',
            'Colour by the protocol column. Parallel curves offset from each other point to a lab or method difference; curves that only differ at the bottom are detection limits.',
            'A constant shift between curves above the detection limits; steps at different limits.',
            [cum([el('Cu'), el('Pb'), el('Zn'), el('As'), el('Au')])]),
        step('overlap', 'Overlap check',
            'Where two groups sampled the same ground, their medians should match. Group by batch and medium; the auto cell size finds the shared ground.',
            '"Offset" pairs need levelling; "agree" pairs can be pooled (Pool groups that agree); "too little overlap" cannot be checked — levelling them is an assumption.',
            [dialog('overlap')]),
        step('levelling', 'Levelling within groups',
            'Score each value within its own group (percentile 0–100) and Map it: the top classes of every survey now map on one scale.',
            'Groups left blank and why (too few, mostly below detection). Clusters of the top classes that cross survey boundaries are the strongest results.',
            [dialog('levelling')]),
        step('common-dl', 'Common detection limit for thresholds',
            'To use a fixed threshold (e.g. Au ppm) across groups, censor them to one limit: the coarsest limit of the groups you include. Untick a coarse old batch rather than lose the detail of all the others.',
            'The group that sets the level; groups whose limit is not shown in the data.',
            [dialog('commonDl')]),
        step('pca', 'Multivariate work inside one group',
            'PCA, clustering and indices assume one population of one method. In Assay protocols use "Use only" on the largest group of one medium, then run PCA (CLR, "Use filtered data").',
            'Components that repeat in more than one group are geology; components unique to one group may be the method.',
            [analysis(TAB.pca)]),
    ],
    references: [
        cite('Reimann, C., Filzmoser, P., Garrett, R.G. & Dutter, R. (2008) Statistical Data Analysis Explained: Applied Environmental Statistics with R. Wiley.'),
        cite('Grunsky, E.C. (2010) The interpretation of geochemical survey data. Geochemistry: Exploration, Environment, Analysis 10, 27–74.'),
        cite('Darnley, A.G. et al. (1995) A Global Geochemical Database for Environmental and Resource Management. UNESCO Earth Sciences 19.'),
    ],
});
