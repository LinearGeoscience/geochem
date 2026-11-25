/**
 * Upper continental crust abundance (Rudnick & Gao 2003) of a column's
 * element, in that column's own units: the reference line Halley's
 * tutorials draw on box plots to show enrichment or depletion. Major
 * elements come from the UCC oxide values (Fe from Fe2O3T).
 */
import type { ColumnGeochemMapping } from '../types/associations';
import { ELEMENT_OXIDE_CONVERSIONS } from './calculations/constants';
import { getBackgroundValue, UCC_RUDNICK_GAO_2003 } from './calculations/elementBackgroundConstants';
import { resolveColumnToPpm } from './calculations/elementColumnResolver';

const UCC = 'ucc-rudnick-gao-2003' as const;

/** UCC abundance of an element in ppm */
export function uccPpm(element: string): number | null {
    const direct = getBackgroundValue(UCC, element);
    if (direct) return direct.unit === 'ppm' ? direct.value : direct.value * 1e4;
    const conv = ELEMENT_OXIDE_CONVERSIONS.find(c => c.element === element && (element !== 'Fe' || c.oxide === 'Fe2O3'));
    const ox = conv && (getBackgroundValue(UCC, conv.oxide) ?? (element === 'Fe' ? getBackgroundValue(UCC, 'Fe2O3T') : null));
    return conv && ox ? ox.value * conv.oxideToElement * 1e4 : null;
}

/** UCC abundance in the column's units, or null when the column is not a known element */
export function crustalAbundance(column: string, mappings: ColumnGeochemMapping[]): number | null {
    const r = resolveColumnToPpm(mappings, column);
    if (!r) return null;
    const ppm = uccPpm(r.element);
    return ppm == null ? null : ppm / r.toPpm;
}

/** Spider normalisation to the upper crust: every UCC element in ppm (majors from oxides) */
export function uccNormalization(): { id: string; name: string; reference: string; values: Record<string, number> } {
    const values: Record<string, number> = {};
    for (const [key, e] of Object.entries(UCC_RUDNICK_GAO_2003.values)) {
        if (e.unit === 'ppm') values[key] = e.value;
    }
    for (const c of ELEMENT_OXIDE_CONVERSIONS) {
        if (values[c.element] == null) {
            const v = uccPpm(c.element);
            if (v != null) values[c.element] = v;
        }
    }
    return { id: 'ucc-rudnick-gao-2003', name: 'Upper Crust (Rudnick & Gao 2003)', reference: UCC_RUDNICK_GAO_2003.reference, values };
}
