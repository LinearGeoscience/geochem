import { ColumnGeochemMapping } from '../types/associations';
import { ELEMENT_ATOMIC_NUMBERS } from './calculations/constants';

export interface CategorizedColumns {
  majorOxides: string[];
  traceElements: string[];
  ree: string[];
  otherNumeric: string[];
}

/**
 * Categorize and sort numeric columns into geochemical groups.
 * Uses geochemMappings for classification and atomic number for ordering.
 */
export function categorizeColumns(
  numericColumns: string[],
  geochemMappings: ColumnGeochemMapping[]
): CategorizedColumns {
  const mappingByName = new Map<string, ColumnGeochemMapping>();
  for (const m of geochemMappings) {
    mappingByName.set(m.originalName, m);
  }

  const majorOxides: string[] = [];
  const traceElements: string[] = [];
  const ree: string[] = [];
  const otherNumeric: string[] = [];

  for (const col of numericColumns) {
    const mapping = mappingByName.get(col);
    if (!mapping || !mapping.detectedElement) {
      otherNumeric.push(col);
      continue;
    }

    switch (mapping.category) {
      case 'majorOxide':
        majorOxides.push(col);
        break;
      case 'traceElement':
        traceElements.push(col);
        break;
      case 'ree':
        ree.push(col);
        break;
      default:
        otherNumeric.push(col);
        break;
    }
  }

  const sortByAtomicNumber = (a: string, b: string) => {
    const ma = mappingByName.get(a);
    const mb = mappingByName.get(b);
    const za = (ma?.detectedElement && ELEMENT_ATOMIC_NUMBERS[ma.detectedElement]) || 999;
    const zb = (mb?.detectedElement && ELEMENT_ATOMIC_NUMBERS[mb.detectedElement]) || 999;
    return za - zb;
  };

  majorOxides.sort(sortByAtomicNumber);
  traceElements.sort(sortByAtomicNumber);
  ree.sort(sortByAtomicNumber);
  otherNumeric.sort((a, b) => a.localeCompare(b));

  return { majorOxides, traceElements, ree, otherNumeric };
}
