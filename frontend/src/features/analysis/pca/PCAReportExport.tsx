/**
 * PCA Report Export Component
 *
 * Exports PCA results to CSV files:
 * - Correlation matrix
 * - Eigenvalues and variance explained
 * - Loadings (scaled eigenvectors)
 */

import React, { useCallback } from 'react';
import { Button, Menu, MenuItem, ListItemText } from '@mui/material';
import { FullPCAResult } from '../../../types/compositional';

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

export const PCAReportExport: React.FC<PCAReportExportProps> = ({ pcaResult }) => {
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

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

  // Export all as ZIP (simplified - just downloads all separately)
  const exportAll = useCallback(() => {
    exportCorrelationMatrix();
    setTimeout(exportEigenvalues, 100);
    setTimeout(exportLoadings, 200);
    setTimeout(exportScores, 300);
  }, [exportCorrelationMatrix, exportEigenvalues, exportLoadings, exportScores]);

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
        <MenuItem onClick={exportAll} sx={{ borderTop: '1px solid #e5e7eb', mt: 1 }}>
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
