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
export const VANTA_METADATA_COLUMNS = [
    'Instrument Serial Num',
    'Reading #',
    'Reading',
    'ShotNo.',
    'Shot',
    'sampleID',
    'SampleID',
    'Sample ID',
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
export type LODHandling = 'zero' | 'half' | 'sqrt2' | 'keep';

export interface VantaTransformOptions {
    includeErrors: boolean;      // Include error columns
    lodHandling: LODHandling;    // How to handle <LOD values
    keepMetadata: boolean;       // Keep metadata columns
    detectUnits: boolean;        // Auto-detect units from Units column
}

export const DEFAULT_TRANSFORM_OPTIONS: VantaTransformOptions = {
    includeErrors: true,
    lodHandling: 'sqrt2',  // Scientifically recommended
    keepMetadata: true,
    detectUnits: true,
};

/**
 * Check if headers indicate Vanta PXRF format
 */
export function isVantaPxrfFormat(headers: string[]): boolean {
    // Check for characteristic Vanta columns
    const hasUnitsColumn = headers.some(h => h.trim() === 'Units');
    const hasConcentrationColumns = headers.some(h => h.includes(' Concentration'));
    const hasCompoundColumns = headers.some(h => h.includes(' Compound Level'));
    const hasSerialNum = headers.some(h => h.includes('Instrument Serial'));

    // Need at least 3 of these indicators
    const indicators = [hasUnitsColumn, hasConcentrationColumns, hasCompoundColumns, hasSerialNum];
    return indicators.filter(Boolean).length >= 3;
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

    // Check for <LOD format (e.g., "<LOD" or the actual LOD value is in Error1s column)
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
        // If we don't have the LOD value, use 0 or null
        return handling === 'keep' ? null : 0;
    }

    switch (handling) {
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
    };
} {
    const unit = options.detectUnits ? extractUnit(data) : 'ppm';
    const newHeaders: string[] = [];
    const columnPriorities: Record<string, number> = {};
    const elementsFound: string[] = [];
    let lodValuesReplaced = 0;

    // Column mapping: old header -> new header (or null to remove)
    const columnMapping: Record<string, string | null> = {};

    // Process headers
    for (const header of headers) {
        const trimmedHeader = header.trim();
        const lowerHeader = trimmedHeader.toLowerCase();

        // Check if it's a metadata column (case-insensitive matching)
        const isMetadata = VANTA_METADATA_COLUMNS.some(m => {
            const lowerM = m.toLowerCase();
            return lowerHeader === lowerM ||
                   lowerHeader.includes(lowerM) ||
                   lowerM.includes(lowerHeader);
        });

        if (isMetadata) {
            // Keep metadata columns but normalize names
            const normalizedName = normalizeMetadataColumn(trimmedHeader);
            columnMapping[header] = normalizedName;
            newHeaders.push(normalizedName);
            // Use specific priority for key columns, default 8 for other metadata
            columnPriorities[normalizedName] = METADATA_PRIORITY[normalizedName] ?? 8;
            continue;
        }

        // Check if it's an element column
        let matched = false;
        for (const element of VANTA_ELEMENTS) {
            if (trimmedHeader.startsWith(element + ' ')) {
                matched = true;

                // Concentration column - KEEP and rename
                if (trimmedHeader === element + VANTA_COLUMN_PATTERNS.concentration) {
                    const newName = `${element}_${unit}`;
                    columnMapping[header] = newName;
                    newHeaders.push(newName);
                    columnPriorities[newName] = ELEMENT_PRIORITY_GROUPS[element] || 5;
                    if (!elementsFound.includes(element)) {
                        elementsFound.push(element);
                    }
                }
                // Error column - optionally keep (at the bottom of lists)
                else if (trimmedHeader === element + VANTA_COLUMN_PATTERNS.error1s) {
                    if (options.includeErrors) {
                        const newName = `${element}_err`;
                        columnMapping[header] = newName;
                        newHeaders.push(newName);
                        columnPriorities[newName] = ERROR_COLUMN_PRIORITY;
                    } else {
                        columnMapping[header] = null; // Remove
                    }
                }
                // Other element columns - REMOVE
                else {
                    columnMapping[header] = null;
                }
                break;
            }
        }

        // If not matched and not in our lists, remove it
        if (!matched && !columnMapping.hasOwnProperty(header)) {
            columnMapping[header] = null;
        }
    }

    // Transform data rows
    const transformedData: Record<string, any>[] = [];

    for (const row of data) {
        const newRow: Record<string, any> = {};

        for (const [oldHeader, newHeader] of Object.entries(columnMapping)) {
            if (newHeader === null) continue; // Skip removed columns

            let value = row[oldHeader];

            // Handle concentration columns specially for LOD
            if (newHeader.endsWith('_' + unit)) {
                const parsed = parseVantaValue(value, options.lodHandling);

                if (parsed.isLOD) {
                    // Get the error column value as the LOD estimate
                    const element = newHeader.replace('_' + unit, '');
                    const errorCol = Object.keys(row).find(k =>
                        k.trim() === element + VANTA_COLUMN_PATTERNS.error1s
                    );
                    const lodEstimate = errorCol ? parseFloat(row[errorCol]) : null;

                    value = getLodSubstitution(
                        lodEstimate && !isNaN(lodEstimate) ? lodEstimate : null,
                        options.lodHandling
                    );
                    lodValuesReplaced++;
                } else {
                    value = parsed.value;
                }
            }

            newRow[newHeader] = value;
        }

        transformedData.push(newRow);
    }

    // Sort headers by priority
    const sortedHeaders = [...newHeaders].sort((a, b) => {
        const prioA = columnPriorities[a] || 10;
        const prioB = columnPriorities[b] || 10;
        if (prioA !== prioB) return prioA - prioB;
        return a.localeCompare(b);
    });

    return {
        headers: sortedHeaders,
        data: transformedData,
        columnPriorities,
        stats: {
            totalRows: transformedData.length,
            elementsFound,
            lodValuesReplaced,
            columnsRemoved: headers.length - newHeaders.length,
            columnsKept: newHeaders.length,
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

        // Determine role
        let role: string | null = null;
        if (header.endsWith('_ppm') || header.endsWith('_percent')) {
            role = 'Concentration';
        } else if (header.endsWith('_err')) {
            role = 'Error';
        } else if (['Latitude', 'Longitude'].includes(header)) {
            role = 'Coordinate';
        } else if (['Sample_ID', 'sampleID'].includes(header)) {
            role = 'Sample ID';
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
