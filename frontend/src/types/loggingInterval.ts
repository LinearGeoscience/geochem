export interface LoggingColumnInfo {
    name: string;
    type: string;
    suggested_role: string | null;
    confidence: number;
    sample_values: any[];
    non_null_count: number;
    unique_count: number;
}

export interface OverlapExample {
    hole_id: string;
    assay_from: number;
    assay_to: number;
    log_values: string[];
    log_froms: number[];
    log_tos: number[];
}

export interface OverlapDetection {
    has_overlaps: boolean;
    overlap_count: number;
    holes_with_overlaps: string[];
    overlapping_values: string[];
    sample_overlaps: OverlapExample[];
}

export interface LoggingPreviewResponse {
    columns: LoggingColumnInfo[];
    preview: Record<string, any>[];
    total_rows: number;
    detected_overlaps: OverlapDetection;
}

export interface HoleMatchSummary {
    hole_id: string;
    assay_count: number;
    matched_count: number;
    match_pct: number;
    avg_overlap_pct: number;
    gaps: number;
    overlaps: number;
}

export interface LoggingIntegrity {
    total_gaps: number;
    total_overlaps: number;
    holes_with_gaps: string[];
    holes_with_overlaps: string[];
}

export interface LoggingQAQCReport {
    holes_in_logging_not_in_assay: string[];
    holes_in_assay_not_in_logging: string[];
    total_assay_rows: number;
    matched_rows: number;
    unmatched_rows: number;
    low_overlap_count: number;
    avg_overlap_pct: number;
    per_hole_summary: HoleMatchSummary[];
    logging_integrity: LoggingIntegrity;
}

export interface LoggingProcessResponse {
    success: boolean;
    columns_added: string[];
    data: Record<string, any>[];
    column_info: any[];
    qaqc: LoggingQAQCReport;
}

export type OverlapStrategy = 'max_overlap' | 'split_columns' | 'combine_codes';

export interface LoggingMapping {
    hole_id: string;
    from: string;
    to: string;
    category: string;
}
