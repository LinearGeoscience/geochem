/**
 * Comprehensive alphabetical element/oxide list for the diagram editor.
 * Always available regardless of whether data is loaded.
 * Each entry includes a default unit so the dropdown shows "element (unit)"
 * and auto-fills the unit field on selection.
 */

import { ColumnGeochemMapping } from '../../types/associations';

export interface ElementOption {
    label: string;       // "SiO2", "Fe-mol", "Au"
    defaultUnit: string; // "pct", "ppm", "mol/kg", etc.
}

/** Master list — alphabetical */
export const DIAGRAM_ELEMENT_OPTIONS: ElementOption[] = [
    { label: 'Ag', defaultUnit: 'ppm' },
    { label: 'Al', defaultUnit: 'pct' },
    { label: 'Al-mol', defaultUnit: 'mol/kg' },
    { label: 'Al2O3', defaultUnit: 'pct' },
    { label: 'As', defaultUnit: 'ppm' },
    { label: 'Au', defaultUnit: 'ppm' },
    { label: 'B', defaultUnit: 'ppm' },
    { label: 'Ba', defaultUnit: 'ppm' },
    { label: 'Ba-mol', defaultUnit: 'mol/kg' },
    { label: 'Be', defaultUnit: 'ppm' },
    { label: 'Bi', defaultUnit: 'ppm' },
    { label: 'C', defaultUnit: 'pct' },
    { label: 'Ca', defaultUnit: 'pct' },
    { label: 'Ca-mol', defaultUnit: 'mol/kg' },
    { label: 'CaO', defaultUnit: 'pct' },
    { label: 'Cd', defaultUnit: 'ppm' },
    { label: 'Ce', defaultUnit: 'ppm' },
    { label: 'Cl', defaultUnit: 'ppm' },
    { label: 'Cl_ppm', defaultUnit: 'ppm' },
    { label: 'Co', defaultUnit: 'ppm' },
    { label: 'Co-mol', defaultUnit: 'mol/kg' },
    { label: 'CO2', defaultUnit: 'pct' },
    { label: 'Cr', defaultUnit: 'ppm' },
    { label: 'Cr-mol', defaultUnit: 'mol/kg' },
    { label: 'Cr2O3', defaultUnit: 'pct' },
    { label: 'Cs', defaultUnit: 'ppm' },
    { label: 'Cu', defaultUnit: 'ppm' },
    { label: 'Dy', defaultUnit: 'ppm' },
    { label: 'Er', defaultUnit: 'ppm' },
    { label: 'Eu', defaultUnit: 'ppm' },
    { label: 'F', defaultUnit: 'ppm' },
    { label: 'F_ppm', defaultUnit: 'ppm' },
    { label: 'Fe', defaultUnit: 'pct' },
    { label: 'Fe-mol', defaultUnit: 'mol/kg' },
    { label: 'Fe2O3', defaultUnit: 'pct' },
    { label: 'Fe2O3*', defaultUnit: 'pct' },
    { label: 'FeO', defaultUnit: 'pct' },
    { label: 'FeO*', defaultUnit: 'pct' },
    { label: 'Ga', defaultUnit: 'ppm' },
    { label: 'Gd', defaultUnit: 'ppm' },
    { label: 'Ge', defaultUnit: 'ppm' },
    { label: 'H', defaultUnit: 'pct' },
    { label: 'H2O', defaultUnit: 'pct' },
    { label: 'HCO3_ppm', defaultUnit: 'ppm' },
    { label: 'Hf', defaultUnit: 'ppm' },
    { label: 'Ho', defaultUnit: 'ppm' },
    { label: 'In', defaultUnit: 'ppm' },
    { label: 'Ir', defaultUnit: 'ppb' },
    { label: 'K', defaultUnit: 'pct' },
    { label: 'K-mol', defaultUnit: 'mol/kg' },
    { label: 'K2O', defaultUnit: 'pct' },
    { label: 'La', defaultUnit: 'ppm' },
    { label: 'Li', defaultUnit: 'ppm' },
    { label: 'LOI', defaultUnit: 'pct' },
    { label: 'Lu', defaultUnit: 'ppm' },
    { label: 'Mg', defaultUnit: 'pct' },
    { label: 'Mg-mol', defaultUnit: 'mol/kg' },
    { label: 'MgO', defaultUnit: 'pct' },
    { label: 'Mn', defaultUnit: 'ppm' },
    { label: 'Mn-mol', defaultUnit: 'mol/kg' },
    { label: 'MnO', defaultUnit: 'pct' },
    { label: 'Mo', defaultUnit: 'ppm' },
    { label: 'N', defaultUnit: 'pct' },
    { label: 'Na', defaultUnit: 'pct' },
    { label: 'Na-mol', defaultUnit: 'mol/kg' },
    { label: 'Na2O', defaultUnit: 'pct' },
    { label: 'Nb', defaultUnit: 'ppm' },
    { label: 'Nd', defaultUnit: 'ppm' },
    { label: 'Ni', defaultUnit: 'ppm' },
    { label: 'Ni-mol', defaultUnit: 'mol/kg' },
    { label: 'NiO', defaultUnit: 'pct' },
    { label: 'NO3_ppm', defaultUnit: 'ppm' },
    { label: 'O', defaultUnit: 'pct' },
    { label: 'Os', defaultUnit: 'ppb' },
    { label: 'P', defaultUnit: 'ppm' },
    { label: 'P-mol', defaultUnit: 'mol/kg' },
    { label: 'P2O5', defaultUnit: 'pct' },
    { label: 'Pb', defaultUnit: 'ppm' },
    { label: 'Pd', defaultUnit: 'ppb' },
    { label: 'Pr', defaultUnit: 'ppm' },
    { label: 'Pt', defaultUnit: 'ppb' },
    { label: 'Rb', defaultUnit: 'ppm' },
    { label: 'Rb-mol', defaultUnit: 'mol/kg' },
    { label: 'Re', defaultUnit: 'ppb' },
    { label: 'Rh', defaultUnit: 'ppb' },
    { label: 'Ru', defaultUnit: 'ppb' },
    { label: 'S', defaultUnit: 'pct' },
    { label: 'S-mol', defaultUnit: 'mol/kg' },
    { label: 'Sb', defaultUnit: 'ppm' },
    { label: 'Sc', defaultUnit: 'ppm' },
    { label: 'Se', defaultUnit: 'ppm' },
    { label: 'Si', defaultUnit: 'pct' },
    { label: 'Si-mol', defaultUnit: 'mol/kg' },
    { label: 'SiO2', defaultUnit: 'pct' },
    { label: 'Sm', defaultUnit: 'ppm' },
    { label: 'Sn', defaultUnit: 'ppm' },
    { label: 'SO4_ppm', defaultUnit: 'ppm' },
    { label: 'Sr', defaultUnit: 'ppm' },
    { label: 'Sr-mol', defaultUnit: 'mol/kg' },
    { label: 'Ta', defaultUnit: 'ppm' },
    { label: 'Tb', defaultUnit: 'ppm' },
    { label: 'Te', defaultUnit: 'ppm' },
    { label: 'Th', defaultUnit: 'ppm' },
    { label: 'Ti', defaultUnit: 'pct' },
    { label: 'Ti-mol', defaultUnit: 'mol/kg' },
    { label: 'TiO2', defaultUnit: 'pct' },
    { label: 'Tl', defaultUnit: 'ppm' },
    { label: 'Tm', defaultUnit: 'ppm' },
    { label: 'U', defaultUnit: 'ppm' },
    { label: 'V', defaultUnit: 'ppm' },
    { label: 'V-mol', defaultUnit: 'mol/kg' },
    { label: 'W', defaultUnit: 'ppm' },
    { label: 'Y', defaultUnit: 'ppm' },
    { label: 'Yb', defaultUnit: 'ppm' },
    { label: 'Zn', defaultUnit: 'ppm' },
    { label: 'Zr', defaultUnit: 'ppm' },
    { label: 'Zr-mol', defaultUnit: 'mol/kg' },
    { label: 'ZrO2', defaultUnit: 'pct' },
];

/** Quick lookup: element label → default unit */
const DEFAULT_UNIT_MAP = new Map(DIAGRAM_ELEMENT_OPTIONS.map(o => [o.label, o.defaultUnit]));

/** Get the default unit for an element, or 'ppm' as fallback */
export function getDefaultUnit(element: string): string {
    return DEFAULT_UNIT_MAP.get(element) ?? 'ppm';
}

/**
 * Merge the master list with any extra elements from user's loaded data.
 * Result is always sorted alphabetically.
 */
export function buildElementOptions(geochemMappings: ColumnGeochemMapping[]): ElementOption[] {
    const masterLabels = new Set(DIAGRAM_ELEMENT_OPTIONS.map(o => o.label));
    const extras: ElementOption[] = [];
    const seen = new Set<string>();

    for (const m of geochemMappings) {
        for (const name of [m.detectedElement, m.oxideFormula]) {
            if (name && !masterLabels.has(name) && !seen.has(name)) {
                extras.push({ label: name, defaultUnit: 'ppm' });
                seen.add(name);
            }
        }
    }

    return [...DIAGRAM_ELEMENT_OPTIONS, ...extras].sort((a, b) => a.label.localeCompare(b.label));
}
