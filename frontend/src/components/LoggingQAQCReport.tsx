import { useState } from 'react';
import {
    Box, Typography, Alert, Chip, Accordion, AccordionSummary, AccordionDetails,
    Table, TableBody, TableCell, TableHead, TableRow, Button
} from '@mui/material';
import { ExpandMore, Download } from '@mui/icons-material';
import type { LoggingQAQCReport as QAQCReportType } from '../types/loggingInterval';

interface LoggingQAQCReportProps {
    report: QAQCReportType;
    columnsAdded: string[];
}

export function LoggingQAQCReport({ report, columnsAdded }: LoggingQAQCReportProps) {
    const [expanded, setExpanded] = useState<string | false>('summary');

    const matchPct = report.total_assay_rows > 0
        ? (report.matched_rows / report.total_assay_rows * 100).toFixed(1)
        : '0.0';
    const matchPctNum = parseFloat(matchPct);

    const overallSeverity: 'success' | 'warning' | 'error' =
        matchPctNum >= 90 ? 'success' : matchPctNum >= 70 ? 'warning' : 'error';

    const handleDownloadCSV = () => {
        const rows = report.per_hole_summary.map(h => [
            h.hole_id, h.assay_count, h.matched_count,
            h.match_pct, h.avg_overlap_pct, h.gaps, h.overlaps,
        ]);
        const header = 'HoleID,AssayCount,MatchedCount,MatchPct,AvgOverlapPct,Gaps,Overlaps';
        const csv = [header, ...rows.map(r => r.join(','))].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'logging_qaqc_report.csv';
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <Box>
            {/* Summary cards */}
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 2, mb: 2 }}>
                <Box sx={{ p: 1.5, bgcolor: 'grey.50', borderRadius: 1, textAlign: 'center' }}>
                    <Typography variant="h5" fontWeight="bold">{columnsAdded.length}</Typography>
                    <Typography variant="caption" color="text.secondary">Columns Added</Typography>
                </Box>
                <Box sx={{ p: 1.5, bgcolor: 'grey.50', borderRadius: 1, textAlign: 'center' }}>
                    <Typography variant="h5" fontWeight="bold" color={overallSeverity === 'error' ? 'error.main' : overallSeverity === 'warning' ? 'warning.main' : 'success.main'}>
                        {matchPct}%
                    </Typography>
                    <Typography variant="caption" color="text.secondary">Match Rate</Typography>
                </Box>
                <Box sx={{ p: 1.5, bgcolor: 'grey.50', borderRadius: 1, textAlign: 'center' }}>
                    <Typography variant="h5" fontWeight="bold">{report.avg_overlap_pct}%</Typography>
                    <Typography variant="caption" color="text.secondary">Avg Overlap</Typography>
                </Box>
                <Box sx={{ p: 1.5, bgcolor: 'grey.50', borderRadius: 1, textAlign: 'center' }}>
                    <Typography variant="h5" fontWeight="bold">
                        {report.matched_rows.toLocaleString()} / {report.total_assay_rows.toLocaleString()}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">Rows Matched</Typography>
                </Box>
            </Box>

            {/* Overall status */}
            <Alert severity={overallSeverity} sx={{ mb: 2 }}>
                {overallSeverity === 'success' && `Excellent coverage: ${matchPct}% of assay intervals matched with ${report.avg_overlap_pct}% average overlap.`}
                {overallSeverity === 'warning' && `Moderate coverage: ${matchPct}% of assay intervals matched. ${report.unmatched_rows} rows have no logging data.`}
                {overallSeverity === 'error' && `Low coverage: Only ${matchPct}% of assay intervals matched. Check HoleID consistency and depth ranges.`}
            </Alert>

            {/* Warnings */}
            {report.holes_in_logging_not_in_assay.length > 0 && (
                <Alert severity="warning" sx={{ mb: 1 }}>
                    {report.holes_in_logging_not_in_assay.length} hole(s) in logging file not found in assay data:{' '}
                    {report.holes_in_logging_not_in_assay.slice(0, 10).map(h => (
                        <Chip key={h} label={h} size="small" sx={{ mx: 0.25 }} />
                    ))}
                    {report.holes_in_logging_not_in_assay.length > 10 && ` ...and ${report.holes_in_logging_not_in_assay.length - 10} more`}
                </Alert>
            )}
            {report.holes_in_assay_not_in_logging.length > 0 && (
                <Alert severity="info" sx={{ mb: 1 }}>
                    {report.holes_in_assay_not_in_logging.length} hole(s) in assay data have no logging coverage:{' '}
                    {report.holes_in_assay_not_in_logging.slice(0, 10).map(h => (
                        <Chip key={h} label={h} size="small" sx={{ mx: 0.25 }} />
                    ))}
                    {report.holes_in_assay_not_in_logging.length > 10 && ` ...and ${report.holes_in_assay_not_in_logging.length - 10} more`}
                </Alert>
            )}
            {report.low_overlap_count > 0 && (
                <Alert severity="warning" sx={{ mb: 1 }}>
                    {report.low_overlap_count} match(es) have less than 50% overlap — logging intervals may not align well with assay intervals.
                </Alert>
            )}
            {report.logging_integrity.total_gaps > 0 && (
                <Alert severity="info" sx={{ mb: 1 }}>
                    {report.logging_integrity.total_gaps} gap(s) detected in logging intervals across {report.logging_integrity.holes_with_gaps.length} hole(s).
                </Alert>
            )}
            {report.logging_integrity.total_overlaps > 0 && (
                <Alert severity="warning" sx={{ mb: 1 }}>
                    {report.logging_integrity.total_overlaps} overlapping interval(s) in logging data across {report.logging_integrity.holes_with_overlaps.length} hole(s).
                </Alert>
            )}

            {/* Columns added */}
            <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Columns added:</Typography>
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                    {columnsAdded.map(col => (
                        <Chip key={col} label={col} size="small" color="primary" variant="outlined" />
                    ))}
                </Box>
            </Box>

            {/* Per-hole detail table */}
            <Accordion expanded={expanded === 'detail'} onChange={(_, isExpanded) => setExpanded(isExpanded ? 'detail' : false)}>
                <AccordionSummary expandIcon={<ExpandMore />}>
                    <Typography variant="subtitle2">Per-Hole Details ({report.per_hole_summary.length} holes)</Typography>
                </AccordionSummary>
                <AccordionDetails>
                    <Box sx={{ maxHeight: 300, overflowY: 'auto' }}>
                        <Table size="small" stickyHeader>
                            <TableHead>
                                <TableRow>
                                    <TableCell>HoleID</TableCell>
                                    <TableCell align="right">Assays</TableCell>
                                    <TableCell align="right">Matched</TableCell>
                                    <TableCell align="right">Match %</TableCell>
                                    <TableCell align="right">Avg Overlap %</TableCell>
                                    <TableCell align="right">Gaps</TableCell>
                                    <TableCell align="right">Overlaps</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {report.per_hole_summary.map(h => (
                                    <TableRow key={h.hole_id} sx={{
                                        bgcolor: h.match_pct === 0 ? 'error.50' : h.match_pct < 70 ? 'warning.50' : undefined
                                    }}>
                                        <TableCell>{h.hole_id}</TableCell>
                                        <TableCell align="right">{h.assay_count}</TableCell>
                                        <TableCell align="right">{h.matched_count}</TableCell>
                                        <TableCell align="right">{h.match_pct}%</TableCell>
                                        <TableCell align="right">{h.avg_overlap_pct}%</TableCell>
                                        <TableCell align="right">{h.gaps}</TableCell>
                                        <TableCell align="right">{h.overlaps}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </Box>
                </AccordionDetails>
            </Accordion>

            {/* Download button */}
            <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end' }}>
                <Button
                    size="small"
                    startIcon={<Download />}
                    onClick={handleDownloadCSV}
                >
                    Download QAQC CSV
                </Button>
            </Box>
        </Box>
    );
}
