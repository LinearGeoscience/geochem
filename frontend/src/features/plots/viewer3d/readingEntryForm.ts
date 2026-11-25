/** What the box for typing a dip reading in place reads (ReadingEntry.tsx; pure, unit-tested). */
import { cleanReading } from '../../model/readings';
import type { PointReading } from '../../model/types';

/** The box's width (px): the view puts it where it fits */
export const READING_ENTRY_WIDTH = 236;
/** The reading the boxes say (null: not one); `blank`: all three are empty */
export function typedReading(dip: string, towards: string, reach: string, overturned?: boolean): { reading: PointReading | null; blank: boolean } {
    const blank = dip.trim() === '' && towards.trim() === '' && reach.trim() === '';
    if (dip.trim() === '' || towards.trim() === '') return { reading: null, blank };
    const d = Number(dip), t = Number(towards), r = reach.trim() === '' ? undefined : Number(reach);
    if (!Number.isFinite(d) || d < 0 || d > 90 || !Number.isFinite(t) || (r !== undefined && !(r > 0))) return { reading: null, blank };
    return { reading: cleanReading({ dip: d, dipDirection: t, ...(overturned ? { overturned: true } : {}), ...(r !== undefined ? { reach: r } : {}) }), blank };
}
