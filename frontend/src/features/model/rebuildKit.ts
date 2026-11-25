/**
 * A surface's rebuild kit: everything it was built from, its mesh, and a
 * plain-text note of what it is and how it was set, as the files of one
 * folder (pure, unit-tested). With it the surface can be built again in
 * Leapfrog, or checked against one built there.
 */
import { formatMetres } from './describe';
import { directionsCsv, linesCsv, linesDxf, linesGocad, linesSurpac, pointsCsv, readingsCsv, shapesToLfpl, type OutDirection, type OutLine, type OutPoint } from './inputWriters';
import { isOrientedLine } from './ribbons';
import { checkMesh, cleanMesh, describeClean, type CleanReport } from './meshClean';
import { meshesToDxf, meshesToGocad, meshesToMsh, meshesToObj } from './meshWriters';
import type { Box3, SceneCoords, SurfaceObject, SurfaceRule, TriMesh } from './types';

export interface KitFile {
    path: string;
    data: string | Uint8Array;
}

export interface KitInput {
    surface: SurfaceObject;
    coords: SceneCoords | null;
    /** The contacts its logging gives, xyz triples (a surface read from logging) */
    logged?: ArrayLike<number> | null;
    /** Its finished mesh (null: not fitted yet) */
    mesh: TriMesh | null;
    /** The box it was fitted in */
    box?: Box3 | null;
    /** The app's version, and the day, for the note */
    version?: string;
    date?: string;
}

export interface SurfaceKit {
    /** The folder's name: the surface's, made safe for a file system */
    folder: string;
    files: KitFile[];
    /** What cleaning the mesh did (null: there is no mesh) */
    clean: CleanReport | null;
}

const count = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** Today's date as the user's clock has it (not the UTC date, which is yesterday's in the early morning east of Greenwich) */
export function localDate(now = new Date()): string {
    const two = (n: number) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}

/** A name that can be a folder or a file anywhere. */
export function safeFileName(name: string, fallback = 'surface'): string {
    const kept = Array.from(name, c => (c.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(c) ? ' ' : c)).join('');
    const clean = kept.trim().replace(/\s+/g, ' ').replace(/[. ]+$/, '').trim();
    return clean || fallback;
}

/** The steps to build a surface again in Leapfrog, naming only the files its kit has */
function leapfrogSteps(has: { lfpl: boolean; lines: boolean; points: boolean; readings: boolean; directions: boolean; mesh: boolean }): string[] {
    const steps: string[][] = [];
    if (has.lfpl) steps.push([`Import "hand inputs.lfpl" as a polyline${has.lines ? ' (or lines.dxf, which holds the lines alone)' : ''}.`]);
    if (has.points) steps.push(['Import points.csv as points.']);
    if (has.readings) steps.push(['Import structural data.csv as planar structural data', '(columns Dip, Dip Azimuth, Polarity: 1 the right way up, -1 overturned).']);
    if (has.directions) steps.push(['Import directions.csv as lineations (Plunge, Plunge Azimuth): the tangents in the .lfpl hold those on nodes.']);
    const from = [has.lines ? 'the polyline' : '', has.points ? 'the points' : '', has.readings ? 'the structural data' : ''].filter(Boolean);
    if (from.length > 0) steps.push([`Make a mesh from ${from.length > 1 ? `${from.slice(0, -1).join(', ')} and ${from[from.length - 1]}` : from[0]}.`]);
    if (has.mesh) steps.push([from.length > 0 ? 'Import mesh.msh to compare the two.' : 'Import mesh.msh: there is nothing placed by hand to build it from.']);
    if (steps.length === 0) return ['  There is nothing in this kit to build it from.'];
    return steps.flatMap((lines, i) => lines.map((line, k) => (k === 0 ? `  ${i + 1}. ${line}` : `     ${line}`)));
}

/** What a surface is built by, in a sentence */
export function ruleText(rule: SurfaceRule): string {
    const list = (units: readonly string[]) => units.join(', ') || 'none';
    if (rule.kind === 'contact') return `The contact between two groups of logged units in "${rule.column}": ${list(rule.sideA)} on one side, ${list(rule.sideB)} on the other.`;
    if (rule.kind === 'body' && rule.vein) return `A vein of the logged units ${list(rule.inside)} in "${rule.column}", built from its two walls${(rule.vein.join ?? 0) > 0 ? `, stretches of it less than ${rule.vein.join} m apart read as one zone` : ''}${rule.vein.held ? ', kept along the lie of the ground between holes' : ''}${rule.vein.least > 0 ? `, never thinner than ${rule.vein.least} m` : ''}.`;
    if (rule.kind === 'body') return `A closed body of the logged units ${list(rule.inside)} in "${rule.column}".`;
    if (rule.kind === 'shell' && rule.of) return `A shell round the ground where ${100 * rule.cutoff}% or more is the logged units ${list(rule.of.inside)} in "${rule.of.column}", from pieces of hole ${rule.of.length} m long.`;
    if (rule.kind === 'shell') return `A shell round the samples at or above ${rule.cutoff} in "${rule.column}".`;
    return 'A surface through points, lines and dip measurements placed by hand.';
}

/** The files of a surface's rebuild kit, each under the kit's folder. */
export function surfaceKit(input: KitInput): SurfaceKit {
    const { surface, coords } = input;
    // A name like "A / B" keeps its two halves apart as a folder
    const folder = safeFileName(surface.name.replace(/\s*\/\s*/g, ' - '));
    const files: KitFile[] = [];
    const add = (name: string, data: string | Uint8Array) => files.push({ path: `${folder}/${name}`, data });
    const listed: string[] = [];
    const row = (what: string, where: string) => listed.push(`  ${what.padEnd(58)} ${where}`);

    // --- what it passes through ---
    const placed: OutPoint[] = surface.points.map(p => ({
        p: p.p, ...(p.snap ? { hole: p.snap.hole, depth: p.snap.depth } : {}), ...(p.reading ? { reading: p.reading } : {}), source: 'placed',
    }));
    const logged: OutPoint[] = [];
    for (let i = 0; input.logged && i + 2 < input.logged.length; i += 3) logged.push({ p: [input.logged[i], input.logged[i + 1], input.logged[i + 2]], source: 'logged' });
    const lines: OutLine[] = surface.polylines.map((l, i) => ({ name: `Line ${i + 1}`, points: l.points, plane: l.plane, ...(l.nodes ? { nodes: l.nodes } : {}), ...(l.smooth ? { smooth: true } : {}) }));
    // Dip readings: at its points, and at the nodes of its lines
    const onNodes: OutPoint[] = surface.polylines.flatMap((l, k) => (l.nodes ?? []).flatMap((node, i): OutPoint[] => (node?.reading && i < l.points.length
        ? [{ p: l.points[i], reading: node.reading, ...(node.snap ? { hole: node.snap.hole, depth: node.snap.depth } : {}), source: `line ${k + 1}, node ${i + 1}` }]
        : [])));
    const measured = [...placed.filter(p => p.reading), ...onNodes];
    // Directions the surface runs in: at its points, and at the nodes of its lines
    const directions: OutDirection[] = [
        ...surface.points.flatMap((p): OutDirection[] => (p.direction ? [{ p: p.p, direction: p.direction, ...(p.snap ? { hole: p.snap.hole, depth: p.snap.depth } : {}), source: 'placed' }] : [])),
        ...surface.polylines.flatMap((l, k) => (l.nodes ?? []).flatMap((node, i): OutDirection[] => (node?.direction && i < l.points.length
            ? [{ p: l.points[i], direction: node.direction, ...(node.snap ? { hole: node.snap.hole, depth: node.snap.depth } : {}), source: `line ${k + 1}, node ${i + 1}` }]
            : []))),
    ];

    if (placed.length + logged.length > 0) {
        add('points.csv', pointsCsv([...placed, ...logged]));
        const onHoles = placed.filter(p => p.hole !== undefined).length;
        if (placed.length > 0) row(`${count(placed.length, 'point', 'points')} placed by hand${onHoles > 0 ? ` (${onHoles} on drillholes)` : ''}`, 'points.csv');
        if (logged.length > 0) row(`${count(logged.length, 'contact', 'contacts')} read from the logging`, 'points.csv (Source = logged)');
    }
    if (lines.length > 0) {
        add('lines.dxf', linesDxf(lines));
        add('lines.pl', linesGocad(lines));
        add('lines.str', linesSurpac(lines, surface.name));
        add('lines.csv', linesCsv(lines));
        const inSpace = surface.polylines.filter(l => !l.plane).length;
        const smooth = surface.polylines.filter(l => l.smooth).length;
        row(`${count(lines.length, 'line', 'lines')} (${lines.length - inSpace} on sections or plans, ${inSpace} in space${smooth > 0 ? `; ${smooth} smooth` : ''})`, 'lines.dxf, lines.pl, lines.str, lines.csv');
    }
    if (measured.length > 0) {
        add('structural data.csv', readingsCsv(measured));
        row(`${count(measured.length, 'dip measurement', 'dip measurements')}${onNodes.length > 0 ? ` (${onNodes.length} on nodes of lines)` : ''}`, 'structural data.csv');
    }
    if (directions.length > 0) {
        add('directions.csv', directionsCsv(directions));
        row(`${count(directions.length, 'direction', 'directions')} the surface runs in (at nodes of lines and at points)`, 'directions.csv');
    }
    if (lines.length + placed.length > 0) {
        add('hand inputs.lfpl', shapesToLfpl(lines, placed));
        row('The lines and hand-placed points together, for Leapfrog', 'hand inputs.lfpl');
    }
    const outline = surface.params.extent === 'outline' ? surface.params.outline : null;
    if (outline && outline.points.length >= 3) add('boundary.dxf', linesDxf([{ name: 'Boundary', points: outline.points, plane: null }], true));

    // --- its mesh ---
    let clean: CleanReport | null = null;
    const meshText: string[] = [];
    if (input.mesh && input.mesh.triangles.length > 0) {
        const cleaned = cleanMesh(input.mesh);
        clean = cleaned.report;
        const named = [{ name: surface.name, vertices: cleaned.mesh.vertices, triangles: cleaned.mesh.triangles }];
        add('mesh.msh', meshesToMsh(named));
        add('mesh.ts', meshesToGocad(named));
        add('mesh.obj', meshesToObj(named));
        add('mesh.dxf', meshesToDxf(named));
        const check = checkMesh(cleaned.mesh);
        const did = describeClean(clean);
        meshText.push(
            `  ${count(check.vertices, 'corner', 'corners')}, ${count(check.triangles, 'triangle', 'triangles')}; ${check.closed ? 'closed' : 'open (it has an edge)'}.`,
            '  mesh.msh (Leapfrog), mesh.ts (GOCAD), mesh.obj, mesh.dxf (3D faces)',
            `  No edge has more than two triangles on it. ${did ? `Before writing: ${did}.` : 'It needed no cleaning.'}`,
        );
    } else {
        meshText.push('  Not fitted yet: there is no mesh in this kit.');
    }

    // --- the note ---
    const p = surface.params;
    const extent = p.extent === 'near' ? `within ${p.reach === null ? 'a distance worked out from the spacing' : formatMetres(p.reach)} of what it passes through`
        : outline && outline.points.length >= 3 ? 'inside an outline drawn in a view (boundary.dxf)' : 'to the edges of the data';
    const box = input.box;
    const at = (v: readonly number[]) => v.map(x => (Math.round(x * 100) / 100).toLocaleString('en-US', { useGrouping: false })).join(', ');
    const note = [
        `Leapfrog export: ${surface.name}`,
        `Written by GeoChem${input.version ? ` ${input.version}` : ''}${input.date ? ` on ${input.date}` : ''}.`,
        coords ? `Coordinates are the project's: ${coords.x} (east), ${coords.y} (north), ${coords.z} (elevation).` : '',
        '',
        'What it is',
        `  ${ruleText(surface.rule)}`,
        '',
        'What it was built from',
        ...(listed.length > 0 ? listed : ['  Nothing placed by hand.']),
        '',
        'How it was set',
        `  Smoothing: ${p.follow <= 0 ? 'through every one exactly' : `loosely (${Math.round(p.follow * 100)} of 100)`}`,
        `  How far it runs: ${extent}`,
        ...(box ? [`  The box it was fitted in: ${at(box.min)} to ${at(box.max)}`] : []),
        `  Surface resolution: ${p.resolution === null ? 'worked out from its size' : formatMetres(p.resolution)}`,
        ...(surface.polylines.some(l => isOrientedLine(l) && l.flipped) ? [`  Lines turned over for this surface: ${surface.polylines.flatMap((l, i) => (isOrientedLine(l) && l.flipped ? [i + 1] : [])).join(', ')}`] : []),
        '',
        'Its mesh',
        ...meshText,
        '',
        'To build it again in Leapfrog',
        ...leapfrogSteps({
            lfpl: lines.length + placed.length > 0, lines: lines.length > 0, points: placed.length + logged.length > 0,
            readings: measured.length > 0, directions: directions.length > 0, mesh: meshText.length > 1,
        }),
        '',
        'Notes',
        '  A node\'s direction is written to the .lfpl as its tangent. A dip measurement on a node with no direction is',
        '  written as the tangent too: a tangent and the line give one plane; where the line does not run in the',
        '  measured plane, structural data.csv has the measurement as taken.',
        '  A smooth line is written to the .lfpl with its curve\'s handles, and point by point along its curve to the',
        '  other line files. The reach of a measurement (Reach in structural data.csv) has no place in Leapfrog\'s files.',
        '  A line in space is written to the .lfpl with the plane that fits it best as its drawing plane.',
        '',
    ].join('\r\n');
    files.unshift({ path: `${folder}/README.txt`, data: note });
    return { folder, files, clean };
}
