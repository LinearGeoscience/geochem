import { AuditEntry, AuditCategory } from '../types/audit';

interface ReportMetadata {
    projectName: string;
    rowCount: number;
    columnCount: number;
    originalDataSource?: string | null;
}

const SEPARATOR = '='.repeat(80);
const SECTION_SEP = '-'.repeat(80);

function safeDateFormat(timestamp: string): string {
    try {
        const d = new Date(timestamp);
        if (isNaN(d.getTime())) return timestamp;
        return d.toLocaleString();
    } catch {
        return timestamp;
    }
}

function safeStringify(value: unknown): string {
    try {
        return JSON.stringify(value);
    } catch {
        return '[serialization error]';
    }
}

export function generateProvenanceReport(
    entries: AuditEntry[],
    metadata: ReportMetadata
): string {
    const lines: string[] = [];
    const now = new Date().toLocaleString();

    // Header
    lines.push(SEPARATOR);
    lines.push('DATA PROVENANCE REPORT');
    lines.push(SEPARATOR);
    lines.push('');
    lines.push(`Project: ${metadata.projectName}`);
    lines.push(`Generated: ${now}`);
    lines.push(`Rows: ${metadata.rowCount.toLocaleString()}`);
    lines.push(`Columns: ${metadata.columnCount}`);
    if (metadata.originalDataSource) {
        lines.push(`Original Data Source: ${metadata.originalDataSource}`);
    }
    lines.push('');

    if (entries.length === 0) {
        lines.push('No operations recorded.');
        lines.push('');
        lines.push(SEPARATOR);
        lines.push('End of Data Provenance Report');
        lines.push(SEPARATOR);
        return lines.join('\n');
    }

    // Summary
    lines.push(SECTION_SEP);
    lines.push('SUMMARY');
    lines.push(SECTION_SEP);
    lines.push('');
    lines.push(`Total operations: ${entries.length}`);

    const counts = new Map<AuditCategory, number>();
    for (const e of entries) {
        counts.set(e.category, (counts.get(e.category) || 0) + 1);
    }
    for (const [cat, count] of counts) {
        lines.push(`  ${cat}: ${count}`);
    }
    lines.push('');

    // Operation Log
    lines.push(SECTION_SEP);
    lines.push('OPERATION LOG (chronological)');
    lines.push(SECTION_SEP);
    lines.push('');

    const sorted = [...entries].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    sorted.forEach((entry, idx) => {
        const ts = safeDateFormat(entry.timestamp);
        lines.push(`  ${idx + 1}. [${ts}] ${entry.operation}`);
        lines.push(`     Category: ${entry.category}`);
        lines.push(`     ${entry.description}`);

        if (entry.inputColumns?.length) {
            lines.push(`     Input columns: ${entry.inputColumns.join(', ')}`);
        }
        if (entry.outputColumns?.length) {
            lines.push(`     Output columns: ${entry.outputColumns.join(', ')}`);
        }
        if (entry.rowsAffected != null) {
            lines.push(`     Rows affected: ${entry.rowsAffected.toLocaleString()}`);
        }
        if (entry.parameters) {
            lines.push(`     Parameters: ${safeStringify(entry.parameters)}`);
        }
        if (entry.mathFormula) {
            lines.push(`     Formula: ${entry.mathFormula}`);
        }
        if (entry.reference) {
            lines.push(`     Reference: ${entry.reference}`);
        }
        if (entry.details) {
            lines.push(`     Details: ${entry.details}`);
        }
        lines.push('');
    });

    // Mathematical Reference (deduplicated formulas)
    const formulaEntries = sorted.filter((e) => e.mathFormula);
    if (formulaEntries.length > 0) {
        lines.push(SECTION_SEP);
        lines.push('MATHEMATICAL REFERENCE');
        lines.push(SECTION_SEP);
        lines.push('');

        const seen = new Set<string>();
        for (const e of formulaEntries) {
            if (seen.has(e.mathFormula!)) continue;
            seen.add(e.mathFormula!);
            lines.push(`${e.operation}:`);
            lines.push(`  ${e.mathFormula}`);
            if (e.reference) {
                lines.push(`  Ref: ${e.reference}`);
            }
            lines.push('');
        }
    }

    // Footer
    lines.push(SEPARATOR);
    lines.push('End of Data Provenance Report');
    lines.push(SEPARATOR);

    return lines.join('\n');
}
