/**
 * PCA Report Export Component
 *
 * Exports PCA results to CSV files:
 * - Correlation matrix
 * - Eigenvalues and variance explained
 * - Loadings (scaled eigenvectors)
 * - Association interpretations
 */

import React, { useCallback, useMemo } from 'react';
import { Button, Menu, MenuItem, ListItemText, Divider } from '@mui/material';
import { FullPCAResult } from '../../../types/compositional';
import {
  matchAssociations,
  summarizeAssociations,
  extractAssociation,
  scoreAllPatterns,
} from '../../../utils/calculations/associationMatcher';
import { AssociationExportRow } from '../../../types/associations';
import { REFERENCE_PATTERNS, CATEGORY_INFO } from '../../../data/elementAssociationPatterns';
import { getSortedLoadings } from '../../../utils/calculations/pcaAnalysis';

interface PCAReportExportProps {
  pcaResult: FullPCAResult;
}

// Helper to trigger download
function downloadCSV(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Helper to trigger text file download
function downloadText(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export const PCAReportExport: React.FC<PCAReportExportProps> = ({ pcaResult }) => {
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  // Pre-compute association analysis for export
  const associationAnalyses = useMemo(() => {
    return matchAssociations(pcaResult, {
      loadingThreshold: 0.3,
      maxMatches: 5,
      minimumConfidence: 25,
      applyDiscrimination: true,
    });
  }, [pcaResult]);

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  // Export correlation matrix
  const exportCorrelationMatrix = useCallback(() => {
    const { correlationMatrix, columns } = pcaResult;

    const header = ['', ...columns].join(',');
    const rows = correlationMatrix.map((row, i) => [columns[i], ...row.map((v) => v.toFixed(6))].join(','));

    const csv = [header, ...rows].join('\n');
    downloadCSV(csv, 'pca_correlation_matrix.csv');
    handleClose();
  }, [pcaResult]);

  // Export eigenvalues
  const exportEigenvalues = useCallback(() => {
    const { eigenvalues, varianceExplained, cumulativeVariance } = pcaResult;

    const header = 'PC,Eigenvalue,VarianceExplained(%),CumulativeVariance(%)';
    const rows = eigenvalues.map((ev, i) =>
      [`PC${i + 1}`, ev.toFixed(6), varianceExplained[i].toFixed(2), cumulativeVariance[i].toFixed(2)].join(',')
    );

    const csv = [header, ...rows].join('\n');
    downloadCSV(csv, 'pca_eigenvalues.csv');
    handleClose();
  }, [pcaResult]);

  // Export loadings (scaled eigenvectors)
  const exportLoadings = useCallback(() => {
    const { loadings, columns, eigenvalues } = pcaResult;

    const header = ['Element', ...eigenvalues.map((_, i) => `PC${i + 1}`)].join(',');
    const rows = columns.map((col, i) => [col, ...loadings[i].map((l) => l.toFixed(6))].join(','));

    const csv = [header, ...rows].join('\n');
    downloadCSV(csv, 'pca_loadings.csv');
    handleClose();
  }, [pcaResult]);

  // Export scores
  const exportScores = useCallback(() => {
    const { scores, eigenvalues } = pcaResult;

    const header = ['Sample', ...eigenvalues.map((_, i) => `PC${i + 1}`)].join(',');
    const rows = scores.map((row, i) => [`Sample_${i + 1}`, ...row.map((s) => s.toFixed(6))].join(','));

    const csv = [header, ...rows].join('\n');
    downloadCSV(csv, 'pca_scores.csv');
    handleClose();
  }, [pcaResult]);

  // Export association interpretations
  const exportAssociations = useCallback(() => {
    const rows: AssociationExportRow[] = [];

    for (const analysis of associationAnalyses) {
      // Positive end matches
      analysis.positiveAssociation.matches.forEach((match, idx) => {
        rows.push({
          pcNumber: analysis.pcNumber,
          varianceExplained: analysis.varianceExplained,
          end: 'positive',
          elements: analysis.positiveAssociation.elementString,
          rank: idx + 1,
          patternName: match.patternName,
          category: match.category,
          confidenceScore: match.confidenceScore,
          matchedCoreElements: match.matchedCoreElements.join(';'),
          missingCoreElements: match.missingCoreElements.join(';'),
          patternCompleteness: match.patternCompleteness,
          notes: match.lithophileInterference ? 'Lithophile interference' : '',
        });
      });

      // Negative end matches
      analysis.negativeAssociation.matches.forEach((match, idx) => {
        rows.push({
          pcNumber: analysis.pcNumber,
          varianceExplained: analysis.varianceExplained,
          end: 'negative',
          elements: analysis.negativeAssociation.elementString,
          rank: idx + 1,
          patternName: match.patternName,
          category: match.category,
          confidenceScore: match.confidenceScore,
          matchedCoreElements: match.matchedCoreElements.join(';'),
          missingCoreElements: match.missingCoreElements.join(';'),
          patternCompleteness: match.patternCompleteness,
          notes: match.lithophileInterference ? 'Lithophile interference' : '',
        });
      });
    }

    const header = [
      'PC',
      'VarianceExplained(%)',
      'End',
      'Elements',
      'Rank',
      'PatternName',
      'Category',
      'ConfidenceScore(%)',
      'MatchedCoreElements',
      'MissingCoreElements',
      'PatternCompleteness(%)',
      'Notes',
    ].join(',');

    const csvRows = rows.map((row) =>
      [
        `PC${row.pcNumber}`,
        row.varianceExplained.toFixed(2),
        row.end,
        `"${row.elements}"`,
        row.rank,
        `"${row.patternName}"`,
        row.category,
        row.confidenceScore.toFixed(1),
        `"${row.matchedCoreElements}"`,
        `"${row.missingCoreElements}"`,
        row.patternCompleteness.toFixed(1),
        `"${row.notes}"`,
      ].join(',')
    );

    const csv = [header, ...csvRows].join('\n');
    downloadCSV(csv, 'pca_associations.csv');
    handleClose();
  }, [associationAnalyses]);

  // Export association summary (one row per PC)
  const exportAssociationSummary = useCallback(() => {
    const summary = summarizeAssociations(associationAnalyses);

    const header = [
      'PC',
      'VarianceExplained(%)',
      'PositiveInterpretation',
      'PositiveConfidence(%)',
      'PositiveCategory',
      'NegativeInterpretation',
      'NegativeConfidence(%)',
      'NegativeCategory',
      'HasMineralisation',
    ].join(',');

    const rows = summary.map((s) =>
      [
        `PC${s.pcNumber}`,
        s.varianceExplained.toFixed(2),
        `"${s.positiveInterpretation}"`,
        s.positiveConfidence.toFixed(1),
        s.positiveCategory || 'none',
        `"${s.negativeInterpretation}"`,
        s.negativeConfidence.toFixed(1),
        s.negativeCategory || 'none',
        s.hasMineralisation ? 'Yes' : 'No',
      ].join(',')
    );

    const csv = [header, ...rows].join('\n');
    downloadCSV(csv, 'pca_associations_summary.csv');
    handleClose();
  }, [associationAnalyses]);

  // Export comprehensive diagnostic report for algorithm comparison
  const exportDiagnosticReport = useCallback(() => {
    const lines: string[] = [];
    const threshold = 0.3;

    // Header
    lines.push('=' .repeat(80));
    lines.push('PCA ASSOCIATION ANALYSIS - DIAGNOSTIC REPORT');
    lines.push('For comparison between algorithm interpretation and manual interpretation');
    lines.push('=' .repeat(80));
    lines.push('');
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push(`Loading Threshold: ${threshold}`);
    lines.push(`Number of Samples: ${pcaResult.nSamples}`);
    lines.push(`Number of Elements: ${pcaResult.columns.length}`);
    lines.push(`Elements: ${pcaResult.columns.join(', ')}`);
    lines.push('');

    // Eigenvalues summary
    lines.push('-'.repeat(80));
    lines.push('VARIANCE EXPLAINED');
    lines.push('-'.repeat(80));
    pcaResult.eigenvalues.forEach((_, i) => {
      lines.push(`PC${i + 1}: ${pcaResult.varianceExplained[i].toFixed(2)}% (cumulative: ${pcaResult.cumulativeVariance[i].toFixed(2)}%)`);
    });
    lines.push('');

    // For each PC, show detailed analysis
    for (let pcIdx = 0; pcIdx < pcaResult.eigenvalues.length; pcIdx++) {
      const pcNum = pcIdx + 1;
      const variance = pcaResult.varianceExplained[pcIdx];

      lines.push('='.repeat(80));
      lines.push(`PC${pcNum} - ${variance.toFixed(2)}% of variance`);
      lines.push('='.repeat(80));
      lines.push('');

      // Get sorted loadings for this PC
      const sortedLoadings = getSortedLoadings(pcaResult, pcIdx);

      // Show ALL loadings sorted from highest to lowest
      lines.push('SORTED LOADINGS (all elements, highest to lowest):');
      lines.push('-'.repeat(40));
      sortedLoadings.forEach((sl) => {
        const bar = sl.loading >= 0
          ? '+'.repeat(Math.round(Math.abs(sl.loading) * 20))
          : '-'.repeat(Math.round(Math.abs(sl.loading) * 20));
        const marker = Math.abs(sl.loading) >= threshold ? ' ***' : '';
        lines.push(`  ${sl.element.padEnd(6)} ${sl.loading >= 0 ? '+' : ''}${sl.loading.toFixed(4)} ${bar}${marker}`);
      });
      lines.push('');
      lines.push(`  *** = Above threshold (|loading| >= ${threshold})`);
      lines.push('');

      // Extract positive association
      const positiveAssoc = extractAssociation(sortedLoadings, 'positive', threshold);
      const negativeAssoc = extractAssociation(sortedLoadings, 'negative', threshold);

      // Positive end
      lines.push('POSITIVE END ASSOCIATION:');
      lines.push('-'.repeat(40));
      if (positiveAssoc.elements.length === 0) {
        lines.push('  No elements above threshold');
      } else {
        lines.push(`  Elements: ${positiveAssoc.elements.map(e => e.element).join(' - ')}`);
        lines.push(`  Count: ${positiveAssoc.elements.length}`);
        lines.push(`  Avg Loading Magnitude: ${positiveAssoc.averageLoadingMagnitude.toFixed(4)}`);
        lines.push(`  Max Loading Magnitude: ${positiveAssoc.maxLoadingMagnitude.toFixed(4)}`);
        lines.push('');
        lines.push('  Individual loadings:');
        positiveAssoc.elements.forEach(e => {
          lines.push(`    ${e.element}: ${e.loading.toFixed(4)}`);
        });
      }
      lines.push('');

      // Negative end
      lines.push('NEGATIVE END ASSOCIATION:');
      lines.push('-'.repeat(40));
      if (negativeAssoc.elements.length === 0) {
        lines.push('  No elements below threshold');
      } else {
        lines.push(`  Elements: ${negativeAssoc.elements.map(e => e.element).join(' - ')}`);
        lines.push(`  Count: ${negativeAssoc.elements.length}`);
        lines.push(`  Avg Loading Magnitude: ${negativeAssoc.averageLoadingMagnitude.toFixed(4)}`);
        lines.push(`  Max Loading Magnitude: ${negativeAssoc.maxLoadingMagnitude.toFixed(4)}`);
        lines.push('');
        lines.push('  Individual loadings:');
        negativeAssoc.elements.forEach(e => {
          lines.push(`    ${e.element}: ${e.loading.toFixed(4)}`);
        });
      }
      lines.push('');

      // Score ALL patterns for positive end (not just top 5)
      if (positiveAssoc.elements.length > 0) {
        lines.push('POSITIVE END - ALL PATTERN SCORES:');
        lines.push('-'.repeat(40));
        const positiveScores = scoreAllPatterns(positiveAssoc, REFERENCE_PATTERNS);

        // Group by category
        const byCategory: Record<string, typeof positiveScores> = {};
        positiveScores.forEach(score => {
          if (!byCategory[score.category]) byCategory[score.category] = [];
          byCategory[score.category].push(score);
        });

        // Show each category
        for (const category of ['mineralisation', 'alteration', 'regolith', 'lithological']) {
          const catScores = byCategory[category] || [];
          const catInfo = CATEGORY_INFO[category as keyof typeof CATEGORY_INFO];
          lines.push('');
          lines.push(`  ${catInfo.displayName.toUpperCase()}:`);

          if (catScores.length === 0) {
            lines.push('    (no patterns in this category)');
          } else {
            catScores.forEach(score => {
              const confidenceBar = '█'.repeat(Math.round(score.confidenceScore / 5));
              lines.push(`    ${score.confidenceScore.toFixed(1).padStart(5)}% ${confidenceBar} ${score.patternName}`);
              if (score.confidenceScore > 0) {
                lines.push(`           Core matched: ${score.matchedCoreElements.join(', ') || 'none'}`);
                lines.push(`           Core missing: ${score.missingCoreElements.join(', ') || 'none'}`);
                lines.push(`           Common matched: ${score.matchedCommonElements.join(', ') || 'none'}`);
                if (score.presentAntiElements.length > 0) {
                  lines.push(`           Anti-elements present: ${score.presentAntiElements.join(', ')}`);
                }
                if (score.lithophileInterference) {
                  lines.push('           WARNING: Lithophile interference detected');
                }
              }
            });
          }
        }
        lines.push('');
      }

      // Score ALL patterns for negative end
      if (negativeAssoc.elements.length > 0) {
        lines.push('NEGATIVE END - ALL PATTERN SCORES:');
        lines.push('-'.repeat(40));
        const negativeScores = scoreAllPatterns(negativeAssoc, REFERENCE_PATTERNS);

        // Group by category
        const byCategory: Record<string, typeof negativeScores> = {};
        negativeScores.forEach(score => {
          if (!byCategory[score.category]) byCategory[score.category] = [];
          byCategory[score.category].push(score);
        });

        // Show each category
        for (const category of ['mineralisation', 'alteration', 'regolith', 'lithological']) {
          const catScores = byCategory[category] || [];
          const catInfo = CATEGORY_INFO[category as keyof typeof CATEGORY_INFO];
          lines.push('');
          lines.push(`  ${catInfo.displayName.toUpperCase()}:`);

          if (catScores.length === 0) {
            lines.push('    (no patterns in this category)');
          } else {
            catScores.forEach(score => {
              const confidenceBar = '█'.repeat(Math.round(score.confidenceScore / 5));
              lines.push(`    ${score.confidenceScore.toFixed(1).padStart(5)}% ${confidenceBar} ${score.patternName}`);
              if (score.confidenceScore > 0) {
                lines.push(`           Core matched: ${score.matchedCoreElements.join(', ') || 'none'}`);
                lines.push(`           Core missing: ${score.missingCoreElements.join(', ') || 'none'}`);
                lines.push(`           Common matched: ${score.matchedCommonElements.join(', ') || 'none'}`);
                if (score.presentAntiElements.length > 0) {
                  lines.push(`           Anti-elements present: ${score.presentAntiElements.join(', ')}`);
                }
                if (score.lithophileInterference) {
                  lines.push('           WARNING: Lithophile interference detected');
                }
              }
            });
          }
        }
        lines.push('');
      }

      lines.push('');
    }

    // Reference pattern definitions
    lines.push('='.repeat(80));
    lines.push('REFERENCE PATTERN DEFINITIONS');
    lines.push('='.repeat(80));
    lines.push('');

    for (const category of ['mineralisation', 'alteration', 'regolith', 'lithological']) {
      const catInfo = CATEGORY_INFO[category as keyof typeof CATEGORY_INFO];
      const patterns = REFERENCE_PATTERNS.filter(p => p.category === category);

      lines.push(`${catInfo.displayName.toUpperCase()} PATTERNS:`);
      lines.push('-'.repeat(40));

      patterns.forEach(pattern => {
        lines.push(`  ${pattern.id}: ${pattern.name}`);
        lines.push(`    Core elements (required, weight 50%): ${pattern.coreElements.join(', ')}`);
        lines.push(`    Common elements (weight 25%): ${pattern.commonElements.join(', ') || 'none'}`);
        lines.push(`    Optional elements (weight 10%): ${pattern.optionalElements.join(', ') || 'none'}`);
        lines.push(`    Anti-elements (penalty): ${pattern.antiElements.join(', ') || 'none'}`);
        lines.push(`    Min core match required: ${(pattern.minimumCoreMatch * 100).toFixed(0)}%`);
        lines.push(`    Description: ${pattern.description}`);
        if (pattern.notes) {
          lines.push(`    Notes: ${pattern.notes}`);
        }
        lines.push('');
      });
      lines.push('');
    }

    // Footer with instructions
    lines.push('='.repeat(80));
    lines.push('HOW TO USE THIS REPORT');
    lines.push('='.repeat(80));
    lines.push('');
    lines.push('1. For each PC, compare the "SORTED LOADINGS" with your visual interpretation');
    lines.push('2. Check if elements you expect to see together are grouped at the same end');
    lines.push('3. Compare the algorithm\'s pattern matches with your interpretation');
    lines.push('4. Note any patterns you expect but are missing from the matches');
    lines.push('5. Check the "Core missing" elements to see why patterns scored lower');
    lines.push('');
    lines.push('SCORING WEIGHTS:');
    lines.push('  - Core elements matched: 50% of score');
    lines.push('  - Common elements matched: 25% of score');
    lines.push('  - Optional elements matched: 10% of score');
    lines.push('  - Loading strength bonus: 15% of score');
    lines.push('  - Anti-element penalty: -15% per element');
    lines.push('');
    lines.push('MINIMUM THRESHOLDS:');
    lines.push('  - Loading threshold: 0.3 (elements with |loading| < 0.3 are excluded)');
    lines.push('  - Minimum confidence to report: 25%');
    lines.push('  - Each pattern has its own minimum core match requirement (40-67%)');
    lines.push('');

    const report = lines.join('\n');
    downloadText(report, 'pca_diagnostic_report.txt');
    handleClose();
  }, [pcaResult]);

  // Export all as ZIP (simplified - just downloads all separately)
  const exportAll = useCallback(() => {
    exportCorrelationMatrix();
    setTimeout(exportEigenvalues, 100);
    setTimeout(exportLoadings, 200);
    setTimeout(exportScores, 300);
    setTimeout(exportAssociationSummary, 400);
  }, [exportCorrelationMatrix, exportEigenvalues, exportLoadings, exportScores, exportAssociationSummary]);

  return (
    <>
      <Button variant="outlined" onClick={handleClick}>
        Export Report
      </Button>
      <Menu anchorEl={anchorEl} open={open} onClose={handleClose}>
        <MenuItem onClick={exportCorrelationMatrix}>
          <ListItemText
            primary="Correlation Matrix"
            secondary="pca_correlation_matrix.csv"
          />
        </MenuItem>
        <MenuItem onClick={exportEigenvalues}>
          <ListItemText
            primary="Eigenvalues"
            secondary="pca_eigenvalues.csv"
          />
        </MenuItem>
        <MenuItem onClick={exportLoadings}>
          <ListItemText
            primary="Loadings (Scaled Eigenvectors)"
            secondary="pca_loadings.csv"
          />
        </MenuItem>
        <MenuItem onClick={exportScores}>
          <ListItemText
            primary="Sample Scores"
            secondary="pca_scores.csv"
          />
        </MenuItem>
        <Divider sx={{ my: 1 }} />
        <MenuItem onClick={exportAssociationSummary}>
          <ListItemText
            primary="Association Summary"
            secondary="pca_associations_summary.csv"
          />
        </MenuItem>
        <MenuItem onClick={exportAssociations}>
          <ListItemText
            primary="Association Details"
            secondary="pca_associations.csv (all matches)"
          />
        </MenuItem>
        <Divider sx={{ my: 1 }} />
        <MenuItem onClick={exportDiagnosticReport}>
          <ListItemText
            primary="Diagnostic Report"
            secondary="Full analysis for interpretation comparison"
          />
        </MenuItem>
        <Divider sx={{ my: 1 }} />
        <MenuItem onClick={exportAll}>
          <ListItemText
            primary="Export All"
            secondary="Downloads all CSV files"
          />
        </MenuItem>
      </Menu>
    </>
  );
};

export default PCAReportExport;
