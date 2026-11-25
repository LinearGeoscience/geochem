/** Helpers for the join dialog (kept out of the component so they can be tested). */
import type { DuplicateRule } from '../../../utils/joinOnKey';

/** Rows as lists (in `fields` order, as the workbook reader returns them) -> rows keyed by column name */
export function recordsFrom(fields: string[], rows: unknown[][]): Record<string, unknown>[] {
    return rows.map(r => {
        const o: Record<string, unknown> = {};
        fields.forEach((f, j) => { o[f] = r[j] ?? null; });
        return o;
    });
}

/** What each rule for repeated keys does, in the order offered */
export const DUPLICATE_HELP: Record<DuplicateRule, string> = {
    first: 'Use the first row',
    last: 'Use the last row',
    mean: 'Average numbers (text: first value)',
    skip: 'Leave blank (ambiguous)',
    error: 'Stop: list the repeated keys',
};
