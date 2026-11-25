/**
 * The words the modelling uses for its ideas: one entry for each, read by
 * every label, heading, menu and test that names it.
 *
 * An idea has one name wherever it appears, and a short plain-English line
 * saying what it is (`plain`, shown as a tip beside the name; empty: none
 * yet). A control that carries a term is marked with it (`data-term`; the
 * words themselves, where they are written as a label, `data-term-label`), so
 * a test or a probe finds the control by the idea, not by the wording, and
 * the wording can be changed here alone.
 *
 * `RETIRED` lists wordings that are no longer used for any idea: the terms
 * test fails if one of them comes back into the interface.
 */

export interface Term {
    /** What it is called */
    label: string;
    /** What it is, in a plain line ('' = nothing to add to the name) */
    plain: string;
}

const term = (label: string, plain = ''): Term => ({ label, plain });

export const TERMS = {
    // --- The groups of the project tree ---
    drillholes: term('Drillholes'),
    structuralData: term('Structural data', 'Dips and directions, measured or drawn: they tell the surfaces which way the rocks lie.'),
    points: term('Points'),
    polylines: term('Polylines', 'Lines drawn on a section or in 3D, node by node.'),
    surfaces: term('Surfaces'),
    models: term('Geological models'),
    numericModels: term('Numeric models', 'A column of numbers (a grade, say) modelled at several cut-offs at once: one grade shell for each cut-off, all found the same way.'),
    sections: term('Sections'),
    meshes: term('Meshes', 'Triangulated surfaces and solids brought in from files: pit shells, faults, geology from other software.'),
    /** (The panel of a 3D view that lists them) */
    meshesPanel: term('Meshes', 'Triangulated surfaces and solids brought in from files: pit shells, faults, geology from other software.'),

    // --- Structure ---
    globalTrend: term('Global trend', 'The one direction the rocks of the whole model lie in: a dip, a dip direction and a pitch. Surfaces carry further along it than across it.'),
    /** A closed body or a shell joins along the ground as the measurements say it lies */
    useTrendClosed: term('Use structural trend', 'It joins from hole to hole along the ground as the structural measurements say it lies, place by place, round folds and all.'),
    /** A closed body follows the one direction set for the model */
    useTrendGlobal: term('Use global trend', 'It carries further along the one direction set for the whole model than across it.'),
    /** A sheet or a contact lies as the measurements near it say */
    useTrendSheet: term('Use structural trend', 'Where it passes near structural measurements, it lies as they say.'),
    /** A vein: how thick it is, carried further down the plunge of the trend than across it */
    useTrendVein: term('Use global trend', 'How thick it is carries further down the plunge of the global trend than across it.'),
    /** A surface that follows structural data of its own choosing */
    ownTrendLayers: term('The layers of its model', 'It follows the layers of a geological model: how that model\'s contacts between layers lie from place to place, in place of structural data. For a sill, or a lode that keeps to one bed. It is fitted again when one of those contacts changes.'),
    ownTrendSets: term('Its own structural data', 'It follows the sets ticked here and no others, whether or not the rest of the model follows them. Unticked: the sets the model follows.'),
    /** A surface with a direction of its own */
    ownTrendDirection: term('Its own global trend', 'A dip, a plunge and how much further things carry along them than across, for this surface alone, in place of the one set for the whole model.'),

    // --- What a surface is ---
    typeSurface: term('Surface', 'A surface through points and polylines placed by hand.'),
    typeContact: term('Contact surface', 'The surface between logged units: found down the holes and joined between them.'),
    typeBody: term('Intrusion', 'A closed body round logged units.'),
    typeVein: term('Vein', 'A thin closed body round logged units: a vein, a dyke or a shear zone, with a hanging wall and a footwall.'),
    thinSheets: term('Thin sheets', 'An intrusion of many thin sheets (dykes, sills) built as one volume: every logged interval is held on its own side of its skin, it is carried further along its sheets than across them, and it is drawn only near where holes meet it.'),
    veinStretch: term('Stretch', 'Where a hole is in the units a vein is made of: from where it goes in to where it comes out, or one of those where the hole starts or stops inside. Where the units are several veins side by side, each stretch is of one of them.'),
    typeShell: term('Grade shell', 'A closed surface round the ground where a column is above a cut-off.'),
    proportion: term('Proportion', 'How much of the ground is a logged unit, as a number at any place: for units too thin and too broken up to draw as solids (dykes or veins a few centimetres to a metre thick, several to a hole).'),
    typeOffset: term('Offset surface', 'A surface a set distance from another, keeping its shape.'),
    typeFault: term('Fault', 'A surface that cuts a model into blocks.'),
    typeTopography: term('Topography', 'The ground surface: a model stops there.'),
    typeDeposit: term('Deposit', 'A layer laid down on what was there: it fills its younger side up to the next surface, and cuts nothing away.'),
    typeErosion: term('Erosion', 'A surface that cuts away everything older on its younger side.'),
    typeIntrusion: term('Intrusion', 'A body that cuts through the older units and takes their place.'),
    typeModel: term('Geological model', 'Surfaces in order of age, and from them the unit at every place: solids, volumes and sections.'),

    // --- How a surface is fitted ---
    smoothing: term('Smoothing', 'How closely the surface follows its points. Low: it passes through each one. Higher: it may miss some a little, for an even shape.'),
    smoothingShell: term('Smoothing', 'How closely the shell follows the samples. Low: every high sample shows. Higher: an even shape that single samples do not move.'),
    snapToData: term('Snap to data', 'What the surface must pass through exactly, whatever the smoothing.'),
    surfaceExtent: term('Surface extent', 'How far the surface runs past its data before it stops.'),
    surfaceResolution: term('Surface resolution', 'The size of its triangles, in metres. Smaller shows more detail and takes longer.'),
    conformableTo: term('Conformable to', 'It runs alongside another surface, as layers of one sequence do: it takes that surface\'s shape between the holes, and the two cannot cross.'),
    offsetSurface: term('Offset', 'How far it is from the surface it is conformable to, where it has no points of its own.'),
    domain: term('Domain', 'The ground it is kept inside: a unit of a geological model, or the inside of closed solids (a vein system, a vein, an intrusion, another shell, a closed mesh from a file). It stops at the faces of that ground. A shell uses only the samples in it; an intrusion of thin sheets uses all its logging.'),

    // --- A geological model ---
    lithologies: term('Lithologies', 'The rock units of a model: the logged codes, grouped under one name each.'),
    backgroundLithology: term('Background lithology', 'The unit that fills the ground no surface claims: usually the oldest, under everything else.'),
    chronology: term('Surface chronology', 'The surfaces of a model in order of age, the youngest at the top. A younger surface can cut the older ones.'),
    youngerSide: term('younger side', 'The side of a surface on which the younger rock lies.'),
    buildChronology: term('Build chronology from lithologies', 'Makes a contact surface for each lithology from the logging, and puts them in order of age.'),
    /** A surface of a model is used in it, or kept in its list and not used */
    active: term('Active', 'Ticked, the surface is used in the model. Unticked, it stays in the list and the model is built without it.'),
    boundary: term('Boundary', 'The box of ground the model covers, with its topography and an outline if it has one.'),
    topography: term('Topography', 'The ground surface: the model stops there.'),
    refinedModelOf: term('Refined model of', 'This model is built inside one unit of another model, to divide that unit further.'),
    faultSystem: term('Fault system', 'The faults that cut the model into blocks.'),
    outputVolumes: term('Output volumes', 'The solid of each unit, with its volume.'),
    resolution: term('Resolution', 'The size of the cells it is worked out on, in metres. Smaller shows more detail and takes longer.'),
    modelResolution: term('Model resolution', 'The size of the cells the model\'s solids are built on, in metres. Smaller shows thinner units and takes longer. Sections are drawn from the surfaces themselves, so they are sharp whatever this is.'),
    /** The step of setting a model up in which it is started, with the ground it covers */
    stepModel: term('Model and boundary'),
    /** The tabs of a model's editor: a word each */
    tabLithologies: term('Lithologies'),
    tabBoundary: term('Boundary'),
    tabChronology: term('Chronology'),
    tabFaults: term('Faults'),
    tabOutputs: term('Outputs'),

    // --- Checks and outputs ---
    checkAgainstDrilling: term('Check against drilling', 'How much of what was logged down the holes the model puts in the same unit.'),
    crossValidation: term('Cross-validation', 'Some holes at a time are left out, it is fitted again from the rest, and what it says at the holes left out is compared with what they logged.'),
    leapfrogExport: term('Leapfrog export', 'One zip with everything it was built from, as files Leapfrog reads, and a note of how it was set.'),
} as const satisfies Record<string, Term>;

export type TermKey = keyof typeof TERMS;

/** What an idea is called */
export const t = (key: TermKey): string => TERMS[key].label;

/** What an idea is, in a plain line ('' = nothing to add) */
export const plain = (key: TermKey): string => TERMS[key].plain;

/** For a control that carries an idea: its accessible name, and the mark a test or a probe finds it by */
export const termProps = (key: TermKey, suffix = ''): { 'aria-label': string; 'data-term': TermKey } => ({ 'aria-label': `${t(key)}${suffix}`, 'data-term': key });

/** Wordings no longer used for any idea (each with the term that took its place): see modelHome.test.ts */
export const RETIRED: readonly { was: string; now: TermKey }[] = [
    { was: 'Age order', now: 'chronology' }, { was: 'age order', now: 'chronology' },
    { was: 'young side', now: 'youngerSide' },
    { was: 'Base unit', now: 'backgroundLithology' }, { was: 'base unit', now: 'backgroundLithology' },
    { was: 'Model units', now: 'lithologies' }, { was: 'model units', now: 'lithologies' },
    { was: 'Overall direction', now: 'globalTrend' }, { was: 'overall direction', now: 'globalTrend' },
    { was: 'runs alongside', now: 'conformableTo' },
    { was: 'Rebuild kit', now: 'leapfrogExport' }, { was: 'rebuild kit', now: 'leapfrogExport' },
    { was: 'Compare with the logging', now: 'checkAgainstDrilling' },
    { was: 'Check it against holes left out', now: 'crossValidation' },
    { was: 'How closely it follows', now: 'smoothing' },
    { was: 'What it passes through exactly', now: 'snapToData' },
    { was: 'Where it stops', now: 'surfaceExtent' },
    { was: 'Make its contacts from its units', now: 'buildChronology' },
    { was: 'The ground it covers', now: 'boundary' },
    { was: 'It is kept inside', now: 'domain' }, { was: 'what it is kept inside', now: 'domain' },
    { was: 'Surface between logged units', now: 'typeContact' }, { was: 'Body round logged units', now: 'typeBody' },
    { was: 'Vein, dyke or shear zone', now: 'typeVein' }, { was: 'Shell round high values', now: 'typeShell' },
    { was: 'Wireframe', now: 'meshes' }, { was: 'wireframe', now: 'meshes' },
    { was: 'readings', now: 'structuralData' }, { was: 'Readings', now: 'structuralData' },
];

/** The retired wordings found in a piece of the interface's text (a label, a tip, a heading) */
export function retiredIn(text: string, retired: readonly { was: string; now: TermKey }[] = RETIRED): { was: string; now: TermKey }[] {
    return retired.filter(r => text.includes(r.was));
}
