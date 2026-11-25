/**
 * Vanta PXRF Data Transformation Utility
 *
 * Transforms raw Vanta handheld XRF analyzer CSV exports into a clean,
 * analysis-ready format with proper column naming and LOD handling.
 *
 * References:
 * - EPA Guidelines for LOD handling
 * - Geochemistry best practices (LOD/√2 substitution)
 */

import Papa from 'papaparse';

// Elements in Vanta PXRF output (in order they typically appear)
export const VANTA_ELEMENTS = [
    'Mg', 'Al', 'Si', 'P', 'S', 'K', 'Ca', 'Ti', 'V', 'Cr',
    'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn', 'As', 'Se', 'Rb', 'Sr',
    'Y', 'Zr', 'Nb', 'Mo', 'Ag', 'Cd', 'Sn', 'Sb', 'Ba', 'La',
    'Ce', 'Pr', 'Nd', 'W', 'Hg', 'Pb', 'Bi', 'Th', 'U', 'LE'
];

// Column patterns in Vanta PXRF format (per element)
export const VANTA_COLUMN_PATTERNS = {
    compound: ' Compound',
    compoundLevel: ' Compound Level',
    compoundError: ' Compound Error',
    concentration: ' Concentration',
    error1s: ' Error1s',
    userFactorSlope: ' User Factor Slope',
    userFactorOffset: ' User Factor Offset',
};

// Essential metadata columns to keep (case-insensitive matching used)
// Note: Custom user columns not in this list will ALSO be kept (see keepCustomColumns option)
export const VANTA_METADATA_COLUMNS = [
    'Instrument Serial Num',
    'Reading #',
    'Reading',
    'ShotNo.',
    'Shot',
    'sampleID',
    'SampleID',
    'Sample ID',
    'Sample_ID',
    'SampleName',
    'Sample Name',
    'Sample_Name',
    'Comment',
    'Date',
    'Time',
    'Method Name',
    'Method',
    'Test Label',
    'Latitude',
    'Longitude',
    'Lat',
    'Long',
    'Easting',
    'Northing',
    'X',
    'Y',
    'Z',
    'Elevation',
    'Units',
    'Project No.',
    'Project',
    'Sample Type',
    'SampleType',
    'Operator',
    'User',
    'Notes',
    'Description',
    'Location',
    'Site',
    'Hole',
    'HoleID',
    'Hole ID',
    'Depth',
    'From',
    'To',
];

// Vanta element-related column suffixes that should be REMOVED (not custom data)
const VANTA_REMOVE_SUFFIXES = [
    ' Compound',
    ' Compound Level',
    ' Compound Error',
    ' User Factor Slope',
    ' User Factor Offset',
];

// Priority groups for element ordering in dropdowns
// Lower number = higher priority (appears first)
export const ELEMENT_PRIORITY_GROUPS: Record<string, number> = {
    // Pathfinder/Economic elements - highest priority
    'Au': 2, 'Ag': 2, 'Cu': 2, 'Pb': 2, 'Zn': 2, 'As': 2,
    'Mo': 2, 'W': 2, 'Sn': 2, 'Bi': 2, 'Sb': 2, 'Hg': 2,

    // Base metals and common targets
    'Fe': 3, 'Mn': 3, 'Ni': 3, 'Co': 3, 'Cr': 3, 'V': 3, 'Ti': 3,

    // Major elements
    'Si': 4, 'Al': 4, 'Ca': 4, 'K': 4, 'Mg': 4, 'P': 4, 'S': 4,

    // Trace elements and REE
    'Ba': 5, 'Sr': 5, 'Rb': 5, 'Zr': 5, 'Y': 5, 'Nb': 5,
    'La': 5, 'Ce': 5, 'Pr': 5, 'Nd': 5,

    // Other
    'Th': 6, 'U': 6, 'Se': 6, 'Cd': 6, 'LE': 7,
};

// Priority for metadata columns (key identification columns at the very top)
export const METADATA_PRIORITY: Record<string, number> = {
    'Sample_ID': 0,
    'Sample_Name': 0,
    'sampleID': 0,
    'SampleName': 0,
    'Hole_ID': 1,
    'HoleID': 1,
    'Depth': 1,
    'From': 1,
    'To': 1,
    'Sample_Type': 1,
    'Easting': 1,
    'Northing': 1,
    'Latitude': 1,
    'Longitude': 1,
    // Other metadata gets default priority of 8
};

// Error columns go at the very bottom
export const ERROR_COLUMN_PRIORITY = 20;

// LOD handling strategies
// 'censored' stores -LOD (standard convention) so the app-wide below-detection
// substitution (Settings) applies; the others substitute at import.
export type LODHandling = 'censored' | 'zero' | 'half' | 'sqrt2' | 'keep';

export interface VantaTransformOptions {
    includeErrors: boolean;      // Include error columns
    /**
     * Exports that write below-detection results as 0 (newer Vanta / cloud
     * exports): read a 0 concentration as below detection, not a measured zero.
     */
    zeroIsBelowLod?: boolean;
    /** Leave out elements with no detected value in any row (default true) */
    dropEmptyElements?: boolean;
    lodHandling: LODHandling;    // How to handle <LOD values
    keepMetadata: boolean;       // Keep metadata columns
    keepCustomColumns: boolean;  // Keep any custom user-added columns (not in standard Vanta format)
    detectUnits: boolean;        // Auto-detect units from Units column
}

export const DEFAULT_TRANSFORM_OPTIONS: VantaTransformOptions = {
    includeErrors: true,
    lodHandling: 'censored',  // keep the LOD; substitute at use (Settings)
    keepMetadata: true,
    keepCustomColumns: true,  // Always keep custom columns by default
    detectUnits: true,
    zeroIsBelowLod: true,
    dropEmptyElements: true,
};

/** One element column of a Vanta export, recognised from its header. */
export interface VantaElementHeader {
    element: string;
    kind: 'concentration' | 'error' | 'other';
    /** Unit written in the header ("(PPM)", "(%)"), else null */
    unit: 'ppm' | 'percent' | null;
}

/**
 * Recognise an element column in any of the Vanta export styles:
 *   "Fe Concentration", "Fe Error1s"                       (instrument CSV)
 *   "Fe Concentration (PPM)", "Fe Error (1sigma, PPM)"     (cloud / LIMS export)
 *   "Fe Compound Level", "Fe User Factor Slope", ...      (other per-element columns)
 * Returns null for anything else.
 */
export function parseVantaElementHeader(header: string): VantaElementHeader | null {
    const h = header.trim();
    const m = /^([A-Z][a-z]?)\s+(.+)$/.exec(h);
    if (!m) return null;
    const [, element, rest] = m;
    const unitOf = (txt: string): VantaElementHeader['unit'] =>
        /ppm/i.test(txt) ? 'ppm' : /%|pct|percent/i.test(txt) ? 'percent' : null;
    if (/^Concentration(\s*\(([^)]*)\))?$/i.test(rest)) {
        return { element, kind: 'concentration', unit: unitOf(rest) };
    }
    if (/^Error1s$/i.test(rest) || /^Error\s*\(\s*1\s*sigma[^)]*\)$/i.test(rest)) {
        return { element, kind: 'error', unit: unitOf(rest) };
    }
    if (/^(Compound|Compound Level|Compound Error|User Factor Slope|User Factor Offset)/i.test(rest)) {
        return { element, kind: 'other', unit: null };
    }
    return null;
}

/**
 * Check if headers indicate Vanta PXRF format
 */
export function isVantaPxrfFormat(headers: string[]): boolean {
    // Check for characteristic Vanta columns
    const hasUnitsColumn = headers.some(h => h.trim() === 'Units');
    const concentration = headers.filter(h => parseVantaElementHeader(h)?.kind === 'concentration').length;
    const hasConcentrationColumns = concentration > 0;
    const hasCompoundColumns = headers.some(h => h.includes(' Compound Level'));
    const hasSerialNum = headers.some(h => h.includes('Instrument Serial'));
    const hasErrorColumns = headers.some(h => parseVantaElementHeader(h)?.kind === 'error');

    // Element concentrations with their 1-sigma errors and an instrument
    // serial is a Vanta export whatever else it carries (cloud exports have
    // no Units / Compound columns); otherwise need 3 of the 4 classic markers
    if (concentration >= 5 && hasErrorColumns && hasSerialNum) return true;
    const indicators = [hasUnitsColumn, hasConcentrationColumns, hasCompoundColumns, hasSerialNum];
    return indicators.filter(Boolean).length >= 3;
}

/**
 * Does the start of a CSV file (its header line at least) look like a Vanta
 * export? Used to offer the converter when a file is loaded as a plain table.
 */
export function csvStartLooksLikeVanta(text: string): boolean {
    const firstLine = text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? '';
    const parsed = Papa.parse<string[]>(firstLine, { header: false });
    const headers = (parsed.data[0] ?? []).map(h => String(h).trim()).filter(Boolean);
    return headers.length > 0 && isVantaPxrfFormat(headers);
}

/**
 * Extract the unit from the Units column (typically "PPM" or "%")
 */
export function extractUnit(data: Record<string, any>[]): string {
    for (const row of data) {
        const unit = row['Units'] || row[' Units'];
        if (unit && typeof unit === 'string' && unit.trim()) {
            return unit.trim().toLowerCase();
        }
    }
    return 'ppm'; // Default
}

/**
 * Parse a value that might be "<LOD" format
 * Returns { value: number | null, isLOD: boolean, lodValue: number | null }
 */
export function parseVantaValue(value: any, _lodHandling: LODHandling): {
    value: number | null;
    isLOD: boolean;
    lodValue: number | null;
} {
    if (value === null || value === undefined || value === '') {
        return { value: null, isLOD: false, lodValue: null };
    }

    const strValue = String(value).trim();

    // "<LOD" (or "<LOD: x"): below detection
    if (strValue.startsWith('<LOD') || strValue === '<LOD') {
        return { value: null, isLOD: true, lodValue: null };
    }

    // Try to parse as number
    const numValue = parseFloat(strValue);
    if (isNaN(numValue)) {
        return { value: null, isLOD: false, lodValue: null };
    }

    return { value: numValue, isLOD: false, lodValue: null };
}

/**
 * Get the substitution value for LOD based on handling method
 */
export function getLodSubstitution(lodValue: number | null, handling: LODHandling): number | null {
    if (lodValue === null) {
        // Without an LOD estimate the value can only be missing (or 0)
        return handling === 'keep' || handling === 'censored' ? null : 0;
    }

    switch (handling) {
        case 'censored':
            return -lodValue;  // negative = below this detection limit
        case 'zero':
            return 0;
        case 'half':
            return lodValue / 2;
        case 'sqrt2':
            return lodValue / Math.sqrt(2);  // ~0.707 * LOD - scientifically recommended
        case 'keep':
            return null;  // Keep as null/missing
        default:
            return 0;
    }
}

/**
 * Transform Vanta PXRF data to clean format
 */
export function transformVantaData(
    headers: string[],
    data: Record<string, any>[],
    options: VantaTransformOptions = DEFAULT_TRANSFORM_OPTIONS
): {
    headers: string[];
    data: Record<string, any>[];
    columnPriorities: Record<string, number>;
    stats: {
        totalRows: number;
        elementsFound: string[];
        lodValuesReplaced: number;
        columnsRemoved: number;
        columnsKept: number;
        /** Elements left out because no row has a detected value */
        emptyElementsDropped?: string[];
        /** Per element: the detection limit assumed for below-detection rows (lowest detected value) */
        assumedLod?: Record<string, number>;
    };
} {
    const columnUnit = options.detectUnits ? extractUnit(data) : 'ppm';
    const zeroIsBelowLod = options.zeroIsBelowLod ?? true;
    const dropEmpty = options.dropEmptyElements ?? true;
    const unitSuffix = (u: string | null) => {
        const x = (u ?? columnUnit).toLowerCase();
        return x === '%' || x === 'percent' || x === 'pct' ? 'percent' : x;
    };

    const newHeaders: string[] = [];
    const columnPriorities: Record<string, number> = {};
    let lodValuesReplaced = 0;

    // Column mapping: old header -> new header (or null to remove)
    const columnMapping: Record<string, string | null> = {};
    /** concentration column (new name) -> its element */
    const concElement: Record<string, string> = {};

    for (const header of headers) {
        const trimmedHeader = header.trim();
        const lowerHeader = trimmedHeader.toLowerCase();

        // Element columns first, so "Y Concentration" is never taken for metadata
        const el = parseVantaElementHeader(trimmedHeader);
        if (el) {
            if (el.kind === 'concentration') {
                const newName = `${el.element}_${unitSuffix(el.unit)}`;
                columnMapping[header] = newName;
                concElement[newName] = el.element;
                newHeaders.push(newName);
                columnPriorities[newName] = ELEMENT_PRIORITY_GROUPS[el.element] || 5;
            } else if (el.kind === 'error' && options.includeErrors) {
                const newName = `${el.element}_err`;
                columnMapping[header] = newName;
                newHeaders.push(newName);
                columnPriorities[newName] = ERROR_COLUMN_PRIORITY;
            } else {
                columnMapping[header] = null;
            }
            continue;
        }

        // Metadata column (case-insensitive matching)
        const isMetadata = VANTA_METADATA_COLUMNS.some(m => {
            const lowerM = m.toLowerCase();
            // Partial matches only between longer names: the one-letter
            // metadata names X / Y / Z matched "Zn Concentration", "Zr ...",
            // "Y ..." and those elements were imported as text
            return lowerHeader === lowerM ||
                   (lowerM.length >= 5 && lowerHeader.length >= 5 &&
                    (lowerHeader.includes(lowerM) || lowerM.includes(lowerHeader)));
        });
        if (isMetadata) {
            const normalizedName = normalizeMetadataColumn(trimmedHeader);
            columnMapping[header] = normalizedName;
            newHeaders.push(normalizedName);
            columnPriorities[normalizedName] = METADATA_PRIORITY[normalizedName] ?? 8;
            continue;
        }

        if (VANTA_REMOVE_SUFFIXES.some(suffix => trimmedHeader.endsWith(suffix))) {
            columnMapping[header] = null;
        } else if (options.keepCustomColumns) {
            const normalizedName = trimmedHeader.replace(/[^a-zA-Z0-9_]/g, '_');
            columnMapping[header] = normalizedName;
            newHeaders.push(normalizedName);
            columnPriorities[normalizedName] = 9;
        } else {
            columnMapping[header] = null;
        }
    }

    // Pass 1: parse concentrations, note below-detection cells and find each
    // element's lowest detected value. The 1-sigma error is NOT a detection
    // limit, so the lowest detected value stands in for the limit (half of it
    // is then the usual half-minimum substitution).
    const concCols = Object.entries(columnMapping)
        .filter(([, n]) => n !== null && n in concElement) as [string, string][];
    const parsedConc: Record<string, (number | null)[]> = {};
    const belowLod: Record<string, Uint8Array> = {};
    const minDetected: Record<string, number> = {};
    for (const [oldHeader, newHeader] of concCols) {
        const vals: (number | null)[] = new Array(data.length);
        const below = new Uint8Array(data.length);
        let min = Infinity;
        for (let r = 0; r < data.length; r++) {
            const parsed = parseVantaValue(data[r][oldHeader], options.lodHandling);
            if (parsed.isLOD || (zeroIsBelowLod && parsed.value === 0)) {
                below[r] = 1;
                vals[r] = null;
            } else {
                vals[r] = parsed.value;
                if (parsed.value !== null && parsed.value > 0 && parsed.value < min) min = parsed.value;
            }
        }
        parsedConc[newHeader] = vals;
        belowLod[newHeader] = below;
        if (Number.isFinite(min)) minDetected[newHeader] = min;
    }

    // Elements never detected in any row
    const emptyElementsDropped: string[] = [];
    if (dropEmpty) {
        for (const [, newHeader] of concCols) {
            if (minDetected[newHeader] !== undefined) continue;
            const element = concElement[newHeader];
            emptyElementsDropped.push(element);
            for (const [oh, nh] of Object.entries(columnMapping)) {
                if (nh === newHeader || nh === `${element}_err`) columnMapping[oh] = null;
            }
        }
    }
    const kept = new Set(Object.values(columnMapping).filter((n): n is string => n !== null));
    const keptHeaders = newHeaders.filter(h => kept.has(h));
    const elementsFound = [...new Set(keptHeaders.filter(h => h in concElement).map(h => concElement[h]))];

    // Pass 2: build rows
    const transformedData: Record<string, any>[] = [];
    for (let r = 0; r < data.length; r++) {
        const row = data[r];
        const newRow: Record<string, any> = {};
        for (const [oldHeader, newHeader] of Object.entries(columnMapping)) {
            if (newHeader === null) continue;
            if (newHeader in parsedConc) {
                if (belowLod[newHeader][r]) {
                    newRow[newHeader] = getLodSubstitution(minDetected[newHeader] ?? null, options.lodHandling);
                    lodValuesReplaced++;
                } else {
                    newRow[newHeader] = parsedConc[newHeader][r];
                }
            } else {
                newRow[newHeader] = row[oldHeader];
            }
        }
        transformedData.push(newRow);
    }

    // Sort headers by priority
    const sortedHeaders = [...keptHeaders].sort((a, b) => {
        const prioA = columnPriorities[a] || 10;
        const prioB = columnPriorities[b] || 10;
        if (prioA !== prioB) return prioA - prioB;
        return a.localeCompare(b);
    });

    const assumedLod: Record<string, number> = {};
    for (const h of keptHeaders) if (h in minDetected) assumedLod[concElement[h]] = minDetected[h];

    return {
        headers: sortedHeaders,
        data: transformedData,
        columnPriorities,
        stats: {
            totalRows: transformedData.length,
            elementsFound,
            lodValuesReplaced,
            columnsRemoved: headers.length - keptHeaders.length,
            columnsKept: keptHeaders.length,
            emptyElementsDropped,
            assumedLod,
        },
    };
}

/**
 * Normalize metadata column names
 */
function normalizeMetadataColumn(header: string): string {
    const trimmed = header.trim();

    // Normalize common variations (case-insensitive lookup)
    const normalizations: Record<string, string> = {
        'sampleid': 'Sample_ID',
        'sample id': 'Sample_ID',
        'sample_id': 'Sample_ID',
        'samplename': 'Sample_Name',
        'sample name': 'Sample_Name',
        'sample_name': 'Sample_Name',
        'shotno.': 'Shot_No',
        'shot': 'Shot_No',
        'reading #': 'Reading_No',
        'reading': 'Reading_No',
        'instrument serial num': 'Instrument_SN',
        'method name': 'Method',
        'method': 'Method',
        'test label': 'Test_Label',
        'project no.': 'Project',
        'project': 'Project',
        'sample type': 'Sample_Type',
        'sampletype': 'Sample_Type',
        'real time 1': 'Time_Beam1',
        'real time 2': 'Time_Beam2',
        'real time 3': 'Time_Beam3',
        'holeid': 'Hole_ID',
        'hole id': 'Hole_ID',
        'hole': 'Hole_ID',
    };

    const lowerTrimmed = trimmed.toLowerCase();
    return normalizations[lowerTrimmed] || trimmed.replace(/[^a-zA-Z0-9]/g, '_');
}

/**
 * Get column info with type detection and priority
 */
export function getVantaColumnInfo(
    headers: string[],
    data: Record<string, any>[],
    columnPriorities: Record<string, number>
): Array<{
    name: string;
    type: string;
    role: string | null;
    alias: string | null;
    priority: number;
}> {
    return headers.map(header => {
        // Determine type by sampling data
        let type = 'text';
        const sampleValues = data.slice(0, 100).map(row => row[header]).filter(v => v != null);

        if (sampleValues.length > 0) {
            const numericCount = sampleValues.filter(v =>
                typeof v === 'number' || (!isNaN(parseFloat(v)) && isFinite(v))
            ).length;

            if (numericCount > sampleValues.length * 0.8) {
                type = 'numeric';
            }
        }

        // Determine role. Concentration columns get NO role: a role marks a
        // column as non-geochemical, which stopped <LOD values (stored as -LOD)
        // being substituted and hid the elements from every element picker.
        let role: string | null = null;
        if (['Sample_ID', 'sampleID'].includes(header)) {
            // Identifiers stay text ("0012" must not become 12)
            role = 'ID';
            type = 'text';
        } else if (header.endsWith('_ppm') || header.endsWith('_percent')) {
            role = null;
        } else if (header.endsWith('_err')) {
            role = 'Error';
        } else if (['Latitude', 'Longitude'].includes(header)) {
            role = 'Coordinate';
        }

        // Create alias (friendly name)
        let alias: string | null = null;
        if (header.endsWith('_ppm')) {
            alias = header.replace('_ppm', ' (ppm)');
        } else if (header.endsWith('_err')) {
            alias = header.replace('_err', ' Error');
        }

        return {
            name: header,
            type,
            role,
            alias,
            priority: columnPriorities[header] || 10,
        };
    });
}

/**
 * Format summary of transformation for display
 */
export function formatTransformSummary(stats: {
    totalRows: number;
    elementsFound: string[];
    lodValuesReplaced: number;
    columnsRemoved: number;
    columnsKept: number;
}): string {
    const lines = [
        `Rows: ${stats.totalRows}`,
        `Elements found: ${stats.elementsFound.length} (${stats.elementsFound.slice(0, 10).join(', ')}${stats.elementsFound.length > 10 ? '...' : ''})`,
        `Columns: ${stats.columnsKept} kept, ${stats.columnsRemoved} removed`,
    ];

    if (stats.lodValuesReplaced > 0) {
        lines.push(`<LOD values handled: ${stats.lodValuesReplaced}`);
    }

    return lines.join('\n');
}
