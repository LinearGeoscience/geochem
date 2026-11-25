/**
 * How close together stretches of a unit are one zone: what the gaps
 * between them say (pure, unit-tested).
 *
 * Down a hole through a swarm of thin dykes or veins, the gaps between
 * stretches of the unit are of two kinds: the short ones between the
 * strands of one zone, and the long ones from one zone to the next. Where
 * the data has both, counted by their length on a scale that doubles, they
 * make two heaps with few between: the length between the heaps is the one
 * that joins strands and not zones. Where the gaps run evenly from short to
 * long there is no such length, and that is said rather than one made up.
 */

/** The gaps are counted in classes that double: the first is everything under this, m */
const FIRST = 0.25;
/** ... and the last everything from this up */
const LAST = 64;
/** Two heaps need at least this many gaps, and each heap this share of them */
const MIN_GAPS = 20, MIN_SHARE = 0.1;
/** The dip between the heaps must be this far below the lower of them (as a share of it) */
const DIP = 0.5;

export interface GapClass {
    /** From this length up to that, m (`to` Infinity: and longer) */
    from: number;
    to: number;
    count: number;
}

/** The gaps counted by length, in classes that double (under 0.25 m, 0.25-0.5, ... 64 m and over), empty ones at either end left off */
export function gapClasses(gaps: ArrayLike<number>): GapClass[] {
    const edges: number[] = [0];
    for (let e = FIRST; e <= LAST; e *= 2) edges.push(e);
    edges.push(Infinity);
    const classes: GapClass[] = [];
    for (let k = 0; k + 1 < edges.length; k++) classes.push({ from: edges[k], to: edges[k + 1], count: 0 });
    for (let i = 0; i < gaps.length; i++) {
        const g = gaps[i];
        if (!(g >= 0)) continue;
        let k = 0;
        while (k + 1 < classes.length && g >= classes[k].to) k++;
        classes[k].count++;
    }
    let first = 0, last = classes.length - 1;
    while (first < last && classes[first].count === 0) first++;
    while (last > first && classes[last].count === 0) last--;
    return classes[first].count === 0 ? [] : classes.slice(first, last + 1);
}

const NICE = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60];

export interface JoinSuggestion {
    /** The length that would join the short gaps and leave the long ones, m */
    length: number;
    /** Gaps shorter than it, and not */
    closed: number;
    open: number;
}

/**
 * The join length the gaps point to: between their two heaps, when they
 * make two. Null when they do not (too few gaps, or they run evenly from
 * short to long).
 */
export function suggestJoin(gaps: ArrayLike<number>): JoinSuggestion | null {
    const values: number[] = [];
    for (let i = 0; i < gaps.length; i++) if (gaps[i] > 0) values.push(gaps[i]);
    if (values.length < MIN_GAPS) return null;
    // Counted in half classes (each half as long again as the last, roughly), then smoothed over three
    const at = (g: number) => Math.max(0, Math.min(HALVES - 1, Math.floor(2 * Math.log2(g / (FIRST / 2)))));
    const HALVES = 2 * Math.round(Math.log2(LAST / (FIRST / 2))) + 2;
    const raw = new Array<number>(HALVES).fill(0);
    for (const g of values) raw[at(g)]++;
    const smooth = raw.map((v, k) => ((raw[k - 1] ?? v) + 2 * v + (raw[k + 1] ?? v)) / 4);
    let best = -1, depth = DIP;
    for (let k = 1; k + 1 < HALVES; k++) {
        if (!(smooth[k] <= smooth[k - 1] && smooth[k] <= smooth[k + 1])) continue;
        let left = 0, right = 0, below = 0, above = 0;
        for (let j = 0; j < k; j++) { left = Math.max(left, smooth[j]); below += raw[j]; }
        for (let j = k + 1; j < HALVES; j++) { right = Math.max(right, smooth[j]); above += raw[j]; }
        if (below < MIN_SHARE * values.length || above < MIN_SHARE * values.length) continue;
        const low = Math.min(left, right);
        if (low > 0 && smooth[k] / low < depth) { depth = smooth[k] / low; best = k; }
    }
    if (best < 0) return null;
    // The middle of that half class, as a round number of metres
    const middle = (FIRST / 2) * 2 ** ((best + 0.5) / 2);
    let length = NICE[0];
    for (const n of NICE) if (Math.abs(Math.log(n / middle)) < Math.abs(Math.log(length / middle))) length = n;
    let closed = 0;
    for (const g of values) if (g < length) closed++;
    return { length, closed, open: values.length - closed };
}

const metres = (v: number) => (v >= 10 ? Math.round(v).toString() : v >= 1 ? (Math.round(v * 10) / 10).toString() : (Math.round(v * 100) / 100).toString());

/**
 * What the gaps say of a join length, in a sentence. `join`: the one in
 * use (0: none).
 */
export function gapsNote(gaps: ArrayLike<number>, join: number): string {
    const values: number[] = [];
    for (let i = 0; i < gaps.length; i++) if (gaps[i] >= 0) values.push(gaps[i]);
    if (values.length === 0) return 'No hole meets it twice: there are no gaps to go by.';
    values.sort((a, b) => a - b);
    const n = values.length, many = `${n.toLocaleString()} ${n === 1 ? 'gap' : 'gaps'}`;
    const closed = join > 0 ? values.filter(g => g < join).length : 0;
    const now = join > 0 ? ` At ${metres(join)} m, ${closed.toLocaleString()} of them ${closed === 1 ? 'is' : 'are'} closed.` : '';
    const found = suggestJoin(values);
    if (found) return `Holes meet it again after ${many}, in two groups: ${found.closed.toLocaleString()} shorter than about ${metres(found.length)} m (between the strands of a zone) and ${found.open.toLocaleString()} longer (from one zone to the next).${now}`;
    if (n < MIN_GAPS) return `Holes meet it again after ${many}: too few to say how close is one zone.${now}`;
    const lo = values[Math.floor(0.1 * n)], hi = values[Math.floor(0.9 * n)];
    return `Holes meet it again after ${many}, and they run evenly from ${metres(lo)} to ${metres(hi)} m: nothing in them says where one zone ends and the next begins. The length is a choice of how much other ground a zone may take in.${now}`;
}
