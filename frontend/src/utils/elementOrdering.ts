/**
 * Standard geochemical element orderings for spider diagrams
 * Based on established geochemical literature (Sun & McDonough 1989, McDonough & Sun 1995)
 */

export interface ElementOrder {
    id: string;
    name: string;
    elements: string[];
    description: string;
}

export interface NormalizationValues {
    id: string;
    name: string;
    reference: string;
    values: Record<string, number>;
}

// Standard element orderings for spider diagrams
export const ELEMENT_ORDERS: ElementOrder[] = [
    {
        id: 'ree-atomic',
        name: 'REE (Atomic Number)',
        elements: ['La', 'Ce', 'Pr', 'Nd', 'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb', 'Lu'],
        description: 'Rare Earth Elements in atomic number order (La-Lu)'
    },
    {
        id: 'extended-ree',
        name: 'Extended REE (Sun & McDonough)',
        elements: ['Cs', 'Rb', 'Ba', 'Th', 'U', 'Nb', 'Ta', 'K', 'La', 'Ce', 'Pb', 'Pr', 'Sr', 'P', 'Nd', 'Zr', 'Hf', 'Sm', 'Eu', 'Ti', 'Gd', 'Tb', 'Dy', 'Y', 'Ho', 'Er', 'Tm', 'Yb', 'Lu'],
        description: 'Extended trace elements ordered by incompatibility (Sun & McDonough 1989)'
    },
    {
        id: 'primitive-mantle',
        name: 'Primitive Mantle Order',
        elements: ['Cs', 'Tl', 'Rb', 'Ba', 'W', 'Th', 'U', 'Nb', 'Ta', 'K', 'La', 'Ce', 'Pb', 'Pr', 'Mo', 'Sr', 'P', 'Nd', 'F', 'Sm', 'Zr', 'Hf', 'Eu', 'Sn', 'Sb', 'Ti', 'Gd', 'Tb', 'Dy', 'Li', 'Y', 'Ho', 'Er', 'Tm', 'Yb', 'Lu'],
        description: 'Full primitive mantle element order (McDonough & Sun 1995)'
    },
    {
        id: 'morb',
        name: 'MORB-normalized',
        elements: ['Sr', 'K', 'Rb', 'Ba', 'Th', 'Ta', 'Nb', 'Ce', 'P', 'Zr', 'Hf', 'Sm', 'Ti', 'Y', 'Yb'],
        description: 'Mid-Ocean Ridge Basalt normalization order'
    },
    {
        id: 'arc-volcanic',
        name: 'Arc/Volcanic (Mobile to Immobile)',
        elements: ['Rb', 'Ba', 'K', 'Sr', 'Th', 'U', 'Pb', 'Nb', 'Ta', 'La', 'Ce', 'Nd', 'Zr', 'Hf', 'Sm', 'Ti', 'Y'],
        description: 'Elements ordered from mobile to immobile for arc settings'
    },
    {
        id: 'lile-hfse',
        name: 'LILE to HFSE',
        elements: ['Cs', 'Rb', 'Ba', 'K', 'Sr', 'Pb', 'Th', 'U', 'Nb', 'Ta', 'Zr', 'Hf', 'Ti'],
        description: 'Large Ion Lithophile Elements to High Field Strength Elements'
    }
];

// Normalization values from various standards
export const NORMALIZATION_VALUES: NormalizationValues[] = [
    {
        id: 'chondrite-sm89',
        name: 'Chondrite (Sun & McDonough 1989)',
        reference: 'Sun & McDonough (1989)',
        values: {
            'La': 0.310, 'Ce': 0.808, 'Pr': 0.122, 'Nd': 0.600, 'Sm': 0.195,
            'Eu': 0.0735, 'Gd': 0.259, 'Tb': 0.0474, 'Dy': 0.322, 'Ho': 0.0718,
            'Er': 0.210, 'Tm': 0.0324, 'Yb': 0.209, 'Lu': 0.0322,
            'Cs': 0.188, 'Rb': 2.32, 'Ba': 2.41, 'Th': 0.029, 'U': 0.0074,
            'Nb': 0.246, 'Ta': 0.0136, 'K': 545, 'Pb': 2.47, 'Sr': 7.26,
            'P': 1220, 'Zr': 3.94, 'Hf': 0.103, 'Ti': 436, 'Y': 1.57
        }
    },
    {
        id: 'primitive-mantle-sm95',
        name: 'Primitive Mantle (McDonough & Sun 1995)',
        reference: 'McDonough & Sun (1995)',
        values: {
            'La': 0.648, 'Ce': 1.675, 'Pr': 0.254, 'Nd': 1.25, 'Sm': 0.406,
            'Eu': 0.154, 'Gd': 0.544, 'Tb': 0.099, 'Dy': 0.674, 'Ho': 0.149,
            'Er': 0.438, 'Tm': 0.068, 'Yb': 0.441, 'Lu': 0.0675,
            'Cs': 0.021, 'Rb': 0.6, 'Ba': 6.6, 'Th': 0.0795, 'U': 0.0203,
            'Nb': 0.658, 'Ta': 0.037, 'K': 240, 'Pb': 0.15, 'Sr': 19.9,
            'P': 90, 'Zr': 10.5, 'Hf': 0.283, 'Ti': 1205, 'Y': 4.3,
            'Tl': 0.0035, 'W': 0.029, 'Mo': 0.05, 'F': 25, 'Sn': 0.13,
            'Sb': 0.0055, 'Li': 1.6
        }
    },
    {
        id: 'nmorb-sm89',
        name: 'N-MORB (Sun & McDonough 1989)',
        reference: 'Sun & McDonough (1989)',
        values: {
            'La': 2.5, 'Ce': 7.5, 'Pr': 1.32, 'Nd': 7.3, 'Sm': 2.63,
            'Eu': 1.02, 'Gd': 3.68, 'Tb': 0.67, 'Dy': 4.55, 'Ho': 1.01,
            'Er': 2.97, 'Tm': 0.456, 'Yb': 3.05, 'Lu': 0.455,
            'Cs': 0.007, 'Rb': 0.56, 'Ba': 6.3, 'Th': 0.12, 'U': 0.047,
            'Nb': 2.33, 'Ta': 0.132, 'K': 600, 'Pb': 0.3, 'Sr': 90,
            'P': 510, 'Zr': 74, 'Hf': 2.05, 'Ti': 7600, 'Y': 28
        }
    },
    {
        id: 'oib-sm89',
        name: 'OIB (Sun & McDonough 1989)',
        reference: 'Sun & McDonough (1989)',
        values: {
            'La': 37, 'Ce': 80, 'Pr': 9.7, 'Nd': 38.5, 'Sm': 10,
            'Eu': 3, 'Gd': 7.62, 'Tb': 1.05, 'Dy': 5.6, 'Ho': 1.06,
            'Er': 2.62, 'Tm': 0.35, 'Yb': 2.16, 'Lu': 0.3,
            'Cs': 0.387, 'Rb': 31, 'Ba': 350, 'Th': 4, 'U': 1.02,
            'Nb': 48, 'Ta': 2.7, 'K': 12000, 'Pb': 3.2, 'Sr': 660,
            'P': 2700, 'Zr': 280, 'Hf': 7.8, 'Ti': 17200, 'Y': 29
        }
    },
    {
        id: 'none',
        name: 'None (Raw Values)',
        reference: '',
        values: {}
    }
];

/**
 * Common element name variations and their standard forms
 * Used for matching column names to element symbols
 */
export const ELEMENT_ALIASES: Record<string, string[]> = {
    'La': ['La', 'La_ppm', 'La ppm', 'Lanthanum', 'LA'],
    'Ce': ['Ce', 'Ce_ppm', 'Ce ppm', 'Cerium', 'CE'],
    'Pr': ['Pr', 'Pr_ppm', 'Pr ppm', 'Praseodymium', 'PR'],
    'Nd': ['Nd', 'Nd_ppm', 'Nd ppm', 'Neodymium', 'ND'],
    'Sm': ['Sm', 'Sm_ppm', 'Sm ppm', 'Samarium', 'SM'],
    'Eu': ['Eu', 'Eu_ppm', 'Eu ppm', 'Europium', 'EU'],
    'Gd': ['Gd', 'Gd_ppm', 'Gd ppm', 'Gadolinium', 'GD'],
    'Tb': ['Tb', 'Tb_ppm', 'Tb ppm', 'Terbium', 'TB'],
    'Dy': ['Dy', 'Dy_ppm', 'Dy ppm', 'Dysprosium', 'DY'],
    'Ho': ['Ho', 'Ho_ppm', 'Ho ppm', 'Holmium', 'HO'],
    'Er': ['Er', 'Er_ppm', 'Er ppm', 'Erbium', 'ER'],
    'Tm': ['Tm', 'Tm_ppm', 'Tm ppm', 'Thulium', 'TM'],
    'Yb': ['Yb', 'Yb_ppm', 'Yb ppm', 'Ytterbium', 'YB'],
    'Lu': ['Lu', 'Lu_ppm', 'Lu ppm', 'Lutetium', 'LU'],
    'Y': ['Y', 'Y_ppm', 'Y ppm', 'Yttrium'],
    'Cs': ['Cs', 'Cs_ppm', 'Cs ppm', 'Cesium', 'CS'],
    'Rb': ['Rb', 'Rb_ppm', 'Rb ppm', 'Rubidium', 'RB'],
    'Ba': ['Ba', 'Ba_ppm', 'Ba ppm', 'Barium', 'BA'],
    'Th': ['Th', 'Th_ppm', 'Th ppm', 'Thorium', 'TH'],
    'U': ['U', 'U_ppm', 'U ppm', 'Uranium'],
    'Nb': ['Nb', 'Nb_ppm', 'Nb ppm', 'Niobium', 'NB'],
    'Ta': ['Ta', 'Ta_ppm', 'Ta ppm', 'Tantalum', 'TA'],
    'K': ['K', 'K_ppm', 'K ppm', 'K2O', 'Potassium'],
    'Pb': ['Pb', 'Pb_ppm', 'Pb ppm', 'Lead', 'PB'],
    'Sr': ['Sr', 'Sr_ppm', 'Sr ppm', 'Strontium', 'SR'],
    'P': ['P', 'P_ppm', 'P ppm', 'P2O5', 'Phosphorus'],
    'Zr': ['Zr', 'Zr_ppm', 'Zr ppm', 'Zirconium', 'ZR'],
    'Hf': ['Hf', 'Hf_ppm', 'Hf ppm', 'Hafnium', 'HF'],
    'Ti': ['Ti', 'Ti_ppm', 'Ti ppm', 'TiO2', 'Titanium', 'TI'],
    'Tl': ['Tl', 'Tl_ppm', 'Tl ppm', 'Thallium', 'TL'],
    'W': ['W', 'W_ppm', 'W ppm', 'Tungsten'],
    'Mo': ['Mo', 'Mo_ppm', 'Mo ppm', 'Molybdenum', 'MO'],
    'F': ['F', 'F_ppm', 'F ppm', 'Fluorine'],
    'Sn': ['Sn', 'Sn_ppm', 'Sn ppm', 'Tin', 'SN'],
    'Sb': ['Sb', 'Sb_ppm', 'Sb ppm', 'Antimony', 'SB'],
    'Li': ['Li', 'Li_ppm', 'Li ppm', 'Lithium', 'LI']
};

/**
 * Match a column name to a standard element symbol
 * @param columnName - The column name from the data
 * @returns The matched element symbol or null
 */
export function matchColumnToElement(columnName: string): string | null {
    const normalized = columnName.trim();

    for (const [element, aliases] of Object.entries(ELEMENT_ALIASES)) {
        for (const alias of aliases) {
            if (normalized.toLowerCase() === alias.toLowerCase()) {
                return element;
            }
            // Also check if column starts with element symbol followed by underscore or space
            const pattern = new RegExp(`^${element}[_\\s]`, 'i');
            if (pattern.test(normalized)) {
                return element;
            }
        }
    }

    return null;
}

/**
 * Find matching columns for a given element order
 * @param columns - Array of column names from the data
 * @param order - The element order to match against
 * @returns Object mapping element symbols to column names
 */
export function findMatchingColumns(
    columns: string[],
    order: ElementOrder
): Record<string, string> {
    const matches: Record<string, string> = {};

    for (const element of order.elements) {
        // First try direct match
        const directMatch = columns.find(col =>
            col.toLowerCase() === element.toLowerCase() ||
            col.toLowerCase() === `${element.toLowerCase()}_ppm` ||
            col.toLowerCase() === `${element.toLowerCase()} ppm`
        );

        if (directMatch) {
            matches[element] = directMatch;
            continue;
        }

        // Then try alias matching
        for (const col of columns) {
            const matchedElement = matchColumnToElement(col);
            if (matchedElement === element) {
                matches[element] = col;
                break;
            }
        }
    }

    return matches;
}

/**
 * Order columns according to a standard element ordering
 * @param columns - Array of column names
 * @param orderId - ID of the element order to use
 * @returns Ordered array of column names (only matched elements)
 */
export function orderColumns(columns: string[], orderId: string): string[] {
    const order = ELEMENT_ORDERS.find(o => o.id === orderId);
    if (!order) return columns;

    const matches = findMatchingColumns(columns, order);

    // Return columns in the order specified, filtering out unmatched elements
    return order.elements
        .filter(el => matches[el])
        .map(el => matches[el]);
}

/**
 * Normalize values using a standard
 * @param values - Raw element values
 * @param normalizationId - ID of the normalization standard
 * @param columnMapping - Mapping from element symbols to column names
 * @returns Normalized values
 */
export function normalizeValues(
    values: Record<string, number>,
    normalizationId: string,
    columnMapping: Record<string, string>
): Record<string, number> {
    const normalization = NORMALIZATION_VALUES.find(n => n.id === normalizationId);
    if (!normalization || normalizationId === 'none') {
        return values;
    }

    const normalized: Record<string, number> = {};

    // Invert the column mapping for lookup
    const elementMapping: Record<string, string> = {};
    for (const [element, column] of Object.entries(columnMapping)) {
        elementMapping[column] = element;
    }

    for (const [column, value] of Object.entries(values)) {
        const element = elementMapping[column];
        const normValue = element ? normalization.values[element] : undefined;

        if (normValue && normValue > 0) {
            normalized[column] = value / normValue;
        } else {
            normalized[column] = value;
        }
    }

    return normalized;
}

export default {
    ELEMENT_ORDERS,
    NORMALIZATION_VALUES,
    ELEMENT_ALIASES,
    matchColumnToElement,
    findMatchingColumns,
    orderColumns,
    normalizeValues
};
