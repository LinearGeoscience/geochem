/**
 * Classify by rules (Scott Halley, Porphyry Module 3): an ordered list of
 * groups, each a set of column windows that must all hold; the first rule a
 * row matches decides its group. Repeatable, unlike hand-drawn lassos.
 *
 * Also: compare two classifications row by row (agreement, cross-tab,
 * per-class recall / precision).
 */

export interface RuleCondition {
    column: string;
    min: number | null;
    max: number | null;
}

export interface ClassRule {
    name: string;
    color: string;
    conditions: RuleCondition[];
    enabled: boolean;
}

export interface RuleSet {
    name: string;
    rules: ClassRule[];
}

type ColumnGetter = (name: string) => ArrayLike<unknown> | undefined;

const num = (v: unknown): number => (typeof v === 'number' ? v : v === null || v === undefined || v === '' ? NaN : Number(v));

/** Row indices per rule (first match wins) and the rows no rule took */
export function classifyByRules(rules: ClassRule[], rowCount: number, getCol: ColumnGetter): { indices: number[][]; unassigned: number } {
    const taken = new Uint8Array(rowCount);
    const indices = rules.map(() => [] as number[]);
    rules.forEach((rule, r) => {
        if (!rule.enabled) return;
        const conds = rule.conditions
            .filter(c => c.column && (c.min !== null || c.max !== null))
            .map(c => ({ v: getCol(c.column), lo: c.min ?? -Infinity, hi: c.max ?? Infinity }));
        if (!conds.length || conds.some(c => !c.v)) return;
        for (let i = 0; i < rowCount; i++) {
            if (taken[i]) continue;
            let ok = true;
            for (const c of conds) {
                const x = num(c.v![i]);
                if (!(x >= c.lo && x <= c.hi)) { ok = false; break; }
            }
            if (ok) { taken[i] = 1; indices[r].push(i); }
        }
    });
    let unassigned = 0;
    for (let i = 0; i < rowCount; i++) if (!taken[i]) unassigned++;
    return { indices, unassigned };
}

/** Rule-set as a text column: group name per row, null when unassigned */
export function ruleLabels(rules: ClassRule[], rowCount: number, getCol: ColumnGetter): (string | null)[] {
    const out: (string | null)[] = new Array(rowCount).fill(null);
    classifyByRules(rules, rowCount, getCol).indices.forEach((idx, r) => { for (const i of idx) out[i] = rules[r].name; });
    return out;
}

// ---------------------------------------------------------------------------
// Compare classifications
// ---------------------------------------------------------------------------

export const UNASSIGNED = '(none)';

export interface ClassComparison {
    /** Row labels (classification A) and column labels (B), largest first */
    aClasses: string[];
    bClasses: string[];
    /** counts[a][b] */
    counts: number[][];
    total: number;
    agree: number;
    /** Per B class: share of its rows that A put in the class of the same name */
    recall: Record<string, number | null>;
    /** Per A class: share of its rows that B agrees with */
    precision: Record<string, number | null>;
    /** Cohen's kappa over the rows (chance-corrected agreement) */
    kappa: number | null;
}

/** Labels compare case-, space- and hyphen-insensitively ("Sericite-Chlorite" = "sericite chlorite") */
export const normLabel = (s: string) => s.trim().toLowerCase().replace(/[-_\s]+/g, ' ');

const label = (v: unknown, blanks: Set<string>): string => {
    if (v === null || v === undefined) return UNASSIGNED;
    const s = String(v).trim();
    return s === '' || blanks.has(normLabel(s)) ? UNASSIGNED : s;
};

export function compareClassifications(
    a: ArrayLike<unknown>, b: ArrayLike<unknown>,
    opts: { rows?: number[]; blankLabels?: string[] } = {},
): ClassComparison {
    const blanks = new Set((opts.blankLabels ?? ['Default', 'Default Colour', 'Default Color']).map(normLabel));
    const rows = opts.rows ?? Array.from({ length: Math.min(a.length, b.length) }, (_, i) => i);
    const pairs = new Map<string, number>();
    const aTot = new Map<string, number>(), bTot = new Map<string, number>();
    let agree = 0;
    for (const i of rows) {
        const x = label(a[i], blanks), y = label(b[i], blanks);
        pairs.set(`${x}\u0000${y}`, (pairs.get(`${x}\u0000${y}`) ?? 0) + 1);
        aTot.set(x, (aTot.get(x) ?? 0) + 1);
        bTot.set(y, (bTot.get(y) ?? 0) + 1);
        if (normLabel(x) === normLabel(y)) agree++;
    }
    const order = (m: Map<string, number>) => [...m.keys()].sort((p, q) =>
        (p === UNASSIGNED ? 1 : 0) - (q === UNASSIGNED ? 1 : 0) || m.get(q)! - m.get(p)! || p.localeCompare(q));
    const aClasses = order(aTot), bClasses = order(bTot);
    const counts = aClasses.map(x => bClasses.map(y => pairs.get(`${x}\u0000${y}`) ?? 0));
    const sameIn = (x: string, list: string[]) => list.find(y => normLabel(y) === normLabel(x));

    const recall: Record<string, number | null> = {};
    bClasses.forEach((y, j) => {
        const x = sameIn(y, aClasses);
        recall[y] = x === undefined ? 0 : counts[aClasses.indexOf(x)][j] / bTot.get(y)!;
    });
    const precision: Record<string, number | null> = {};
    aClasses.forEach((x, i) => {
        const y = sameIn(x, bClasses);
        precision[x] = y === undefined ? 0 : counts[i][bClasses.indexOf(y)] / aTot.get(x)!;
    });

    const total = rows.length;
    let chance = 0;
    for (const [x, n] of aTot) {
        const y = sameIn(x, bClasses);
        if (y !== undefined) chance += (n / total) * (bTot.get(y)! / total);
    }
    const po = total ? agree / total : 0;
    const kappa = total && chance < 1 ? (po - chance) / (1 - chance) : null;
    return { aClasses, bClasses, counts, total, agree, recall, precision, kappa };
}
