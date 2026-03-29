/**
 * Data Provenance Audit Types
 * Records every data manipulation for QAQC reporting
 */

export type AuditCategory =
    | 'import'
    | 'transform'
    | 'zero-handling'
    | 'recalculation'
    | 'normalization'
    | 'sampling'
    | 'column-operation'
    | 'unit-conversion'
    | 'classification'
    | 'calculation'
    | 'bdl-handling';

export interface AuditEntry {
    id: string;
    timestamp: string;
    category: AuditCategory;
    operation: string;
    description: string;
    details?: string;
    mathFormula?: string;
    reference?: string;
    parameters?: Record<string, unknown>;
    inputColumns?: string[];
    outputColumns?: string[];
    rowsAffected?: number;
}
