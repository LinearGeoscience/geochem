/** Scott Halley: rock types from 4-acid immobile elements (Barcode / Golden Mile / Kalgoorlie tutorials). */
import { el, ox, xy, yx, diag, rules, rule, w, fromColour, step, cite, workflow, ratio, SILICA, CALC_V_SC, DIAGRAM } from './builders';

const density = { density: true };

export const lithologyFromAssays = workflow({
    id: 'lithology-from-assays',
    name: 'Lithology from assays',
    group: 'Basics',
    summary: 'Immobile elements with Sc as the silica proxy: ultramafics first, then basalts, then felsics. Every other recipe starts here.',
    steps: [
        step('sc-proxy', 'Sc as the SiO2 proxy',
            'Si is lost to HF in 4-acid digests and Zr is incomplete. Sc tracks silica: basalt 30–50 ppm, andesite 20–30, dacite 10–20, rhyolite <10.',
            'Tight linear populations against Ti, Th, V, Nb, P; density contours show the populations.',
            [yx(el('Sc'), [el('Ti'), el('Th'), el('V'), el('Zr'), el('Nb'), el('P'), el('Al'), el('Cr')], density)]),
        step('ultramafics', 'Ultramafics first',
            'Pick the ultramafics before anything else: Cr >1000 ppm, Mg >11 % (MgO >18 %), Zr <50 ppm, low Al. Review the rule sheet, then Apply.',
            'Komatiite field on the Jensen plot; chromite-bearing rocks above Cr 4000 ppm.',
            [yx(el('Sc'), [el('Cr'), el('Mg'), el('Al'), el('Zr')]), diag(DIAGRAM.jensenKalgoorlie),
                rules('Ultramafic picks (Halley)', [
                    rule('Cr pyroxenite', '#4a148c', [w(el('Cr'), 4000)]),
                    rule('Ultramafic', '#6a1b9a', [w(el('Mg'), 110000), w(el('Cr'), 1000), w(el('Zr'), undefined, 50)]),
                ])]),
        step('komatiite-trend', 'Komatiite olivine trend',
            'Komatiites make one linear Sc–Cr trend that follows olivine. With Fe the transition metals rise and Mg falls.',
            'Points above the trend hold chromite; Cu falling off the trend = sulphide stripped Cu (Ni potential).',
            [diag(DIAGRAM.komatiiteScCr), xy(el('Fe'), [el('Mg'), el('Sc'), el('Cr'), el('Cu'), el('Zn'), el('Mn')])]),
        step('mafic-felsic', 'Mafic vs felsic',
            'Silica against the majors separates basalt from the intermediate–felsic rocks. SiO2 cut-offs: andesite 52–63 %, dacite 63–70, rhyolite >70 (SiO2 assays only).',
            'Dense mafic cluster at 45–55 % SiO2 (Sc 30–50 ppm) and a felsic tail.',
            [xy(SILICA, [el('Mg'), el('Fe'), el('Al'), el('Ti')], density),
                rules('Felsic picks by SiO2', [
                    rule('Rhyolite', '#e53935', [w(ox('SiO2'), 70)]),
                    rule('Dacite', '#fdd835', [w(ox('SiO2'), 63, 70)]),
                    rule('Andesite', '#fb8c00', [w(ox('SiO2'), 52, 63)]),
                ])]),
        step('basalt-strat', 'Basalt stratigraphy: Ti vs Th',
            'Each basalt suite sits on its own linear Ti–Th trend (Kalgoorlie: Lunnon, Devon Consols, Paringa). HFSE-enriched suites mark the better-mineralised districts.',
            'Separate linear trends on Ti vs Th; confirm each holds on Ti vs V, Zr, Nb, P.',
            [diag(DIAGRAM.basaltTiTh), yx(el('Ti'), [el('Sc'), el('V'), el('Zr'), el('Nb'), el('P')])]),
        step('dolerite', 'Dolerite fractionation',
            'Reduced tholeiites keep V/Sc ≈ 7; at magnetite saturation V spikes then collapses. Al vs Sc tracks plagioclase accumulation (leucogabbro = high Al, low Sc).',
            'Points dropping below the V/Sc = 7 line; high-Ni quench margins.',
            [CALC_V_SC, xy(el('Sc'), [el('V')], { refLines: [ratio(el('V'), el('Sc'), 7, { label: 'V/Sc = 7' })] }), xy(el('Sc'), [el('Al'), el('Ni')])]),
        step('felsics', 'Felsic suites',
            'Sc vs the HFSE separates felsic suites; Pearce (1996) Nb/Y–Zr/Ti names them without the alkalis. TAS only on fresh rocks.',
            'Coherent felsic trends; alkaline vs sub-alkaline split on Nb/Y.',
            [xy(el('Sc'), [el('Ti'), el('Th'), el('V'), el('Zr'), el('Nb'), el('P')]), diag(DIAGRAM.pearce1996)]),
        step('keep', 'Keep the lithology',
            'Turn the colour groups into a Lithology column before alteration work (From Colour), and save a checkpoint.',
            'A Lithology text column in the grid; alteration is read against it.',
            [fromColour('Lithology')]),
    ],
    references: [
        cite('Halley, S. (2020–2021) Barcode workshop; Golden Mile geochemistry tutorial; Kalgoorlie diagrams (Jensen MUM, Sc vs Cr, Ti vs Th).'),
        cite('Jensen, L.S. (1976) A new cation plot for classifying subalkalic volcanic rocks. Ontario Div. Mines MP 66.'),
        cite('Pearce, J.A. (1996) A user\'s guide to basalt discrimination diagrams. GAC Short Course Notes 12.'),
    ],
});
