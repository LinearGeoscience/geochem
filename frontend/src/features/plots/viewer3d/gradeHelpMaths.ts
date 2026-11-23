/**
 * The maths of the guide page "A shell kept inside other ground"
 * (SurfaceHelp.tsx): a shell made free or kept inside a zone, with or
 * without one of its holes, and read against that hole. The same score the
 * local trials give a shell against holes it was not shown (gradeScore.ts)
 * and the same table the app gives of what a shell holds (gradeTable.ts), on
 * the small section of the closed-surface pages.
 */
import { scoreCutoff } from '../../model/gradeScore';
import { gradeTable, type GradeTable } from '../../model/gradeTable';
import { gridValues, NX, NZ, shellDemo, STEP, valuesAt, WIDTH, type DemoSample, type Pt } from './surfaceHelpMaths';

/** Where the section's holes are, left to right */
export const GRADE_HOLES = [50, 130, 210, 290, 370, 450];
/** Each sample is this long, m */
export const GRADE_SAMPLE = 20;

/** The zone a shell can be kept inside: a solid through the rich patch, dipping gently, this far either side of its middle */
export const ZONE_HALF = 35;
export const zoneMiddle = (x: number) => 160 + 0.12 * (250 - x);
/** How far inside the zone a place is, m (below nothing: outside it) */
export const zoneNearness = (p: Pt) => ZONE_HALF - Math.abs(p[1] - zoneMiddle(p[0]));
/** The zone's outline, for the picture */
export function zoneOutline(): Pt[] {
    const top: Pt[] = [], bottom: Pt[] = [];
    for (let x = 0; x <= WIDTH; x += 2 * STEP) { top.push([x, zoneMiddle(x) + ZONE_HALF]); bottom.unshift([x, zoneMiddle(x) - ZONE_HALF]); }
    return [...top, ...bottom];
}

/** Where the pod of grade outside the zone is: under it, between the fourth and fifth holes */
export const POD: Pt = [330, 62];
/**
 * The grade at a place: rich along the middle of the zone (more in some
 * stretches than others), a pod of it below the zone, little elsewhere.
 */
export const gradeAt = (x: number, z: number) => 0.1
    + 2.4 * Math.exp(-(((z - zoneMiddle(x)) / 22) ** 2)) * (0.75 + 0.25 * Math.cos(x / 60))
    + 2 * Math.exp(-(((x - POD[0]) / 60) ** 2) - ((z - POD[1]) / 22) ** 2);

/** The section's samples: six holes, one every 20 m down each */
export function gradeHoles(): DemoSample[] {
    const out: DemoSample[] = [];
    for (const x of GRADE_HOLES) for (let z = 280; z >= 40; z -= GRADE_SAMPLE) out.push({ p: [x, z], v: Number(gradeAt(x, z).toFixed(2)) });
    return out;
}

export interface GradeDemo {
    /** The samples the shell was made from (kept inside the zone: only those in it) */
    used: DemoSample[];
    /** The samples of the holes it was shown, used or not */
    shown: DemoSample[];
    /** Those of the hole it was not shown (none: it was shown them all) */
    hidden: DemoSample[];
    /** The shell's number at the grid's corners, cut at the zone's faces when kept inside it (null: nothing reaches the cut-off) */
    values: Float64Array | null;
    /** For each sample read (the hidden hole's; all of them when none is hidden): is it inside the shell */
    inside: boolean[];
    /** Of the metal at or above the cut-off in the samples read, the share inside the shell (null: there is none) */
    found: number | null;
    /** Of the metres inside the shell there, the share at or above the cut-off (null: nothing is inside) */
    right: number | null;
    /** What the shell holds of the samples read, and what is outside it */
    table: GradeTable;
}

/**
 * The shell at a cut-off, made without one hole (its place in GRADE_HOLES;
 * null: with them all) and free or kept inside the zone, read against the
 * hole left out (against all its samples when none is).
 */
export function gradeDemo(leftOut: number | null, cutoff: number, kept: boolean): GradeDemo {
    const all = gradeHoles();
    const x = leftOut === null ? null : GRADE_HOLES[leftOut];
    const shown = all.filter(s => s.p[0] !== x);
    const hidden = all.filter(s => s.p[0] === x);
    const used = kept ? shown.filter(s => zoneNearness(s.p) > 0) : shown;
    const read = hidden.length > 0 ? hidden : all;
    const field = used.some(s => s.v >= cutoff) ? shellDemo(used, cutoff) : null;
    const at = field ? valuesAt(field, read.map(s => s.p)) : null;
    // (A sample the shell was made from is inside it when its value is at or above the cut-off: the shell passes through its samples)
    const inside = read.map((s, k) => !!at && (!kept || zoneNearness(s.p) > 0) && (hidden.length > 0 ? at[k] > 0 : s.v >= cutoff));
    const length = read.map(() => GRADE_SAMPLE), value = read.map(s => s.v);
    const score = scoreCutoff(length, value, inside, cutoff);
    const table = gradeTable({ length, value }, [{ name: 'Inside the shell', share: inside.map(Number) }], null, 'Outside it');
    let values = field ? gridValues(field) : null;
    if (values && kept) {
        // Cut at the zone's faces: inside the shell and inside the zone (the grid's rows run from the bottom)
        values = Float64Array.from(values);
        for (let j = 0, k = 0; j <= NZ; j++) for (let i = 0; i <= NX; i++, k++) values[k] = Math.min(values[k], zoneNearness([i * STEP, j * STEP]));
    }
    return { used, shown, hidden, values, inside, found: score.found, right: score.right, table };
}
