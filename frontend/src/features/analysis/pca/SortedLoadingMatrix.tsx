/**
 * Sorted Loading Matrix Component
 *
 * Displays the scaled eigenvector loadings for each PC, sorted from highest to lowest.
 * This is the key visualization from the Exploration Geochemistry Workshop Manual (page 5)
 * for identifying element associations.
 *
 * Format:
 * | PC1          | PC2          | PC3          | ... |
 * | Pb    0.89   | Co    0.71   | Sn    0.45   |     |
 * | Ag    0.82   | Cr    0.68   | Mo    0.38   |     |
 * | ...          | ...          | ...          |     |
 * | Al   -0.89   | Fe   -0.62   | Cu   -0.58   |     |
 */

import React, { useMemo } from 'react';
import { Box, Typography, Paper } from '@mui/material';
import { FullPCAResult, SortedLoading } from '../../../types/compositional';
import { getSortedLoadings } from '../../../utils/calculations/pcaAnalysis';

interface SortedLoadingMatrixProps {
  pcaResult: FullPCAResult;
  nComponents?: number;
}

// Get background color based on loading value
function getLoadingColor(loading: number): string {
  const absLoading = Math.abs(loading);

  if (loading > 0) {
    // Green shades for positive loadings
    if (absLoading >= 0.7) return '#166534'; // Dark green
    if (absLoading >= 0.5) return '#22c55e'; // Green
    if (absLoading >= 0.3) return '#86efac'; // Light green
    if (absLoading >= 0.1) return '#dcfce7'; // Very light green
    return 'transparent';
  } else {
    // Red shades for negative loadings
    if (absLoading >= 0.7) return '#991b1b'; // Dark red
    if (absLoading >= 0.5) return '#ef4444'; // Red
    if (absLoading >= 0.3) return '#fca5a5'; // Light red
    if (absLoading >= 0.1) return '#fee2e2'; // Very light red
    return 'transparent';
  }
}

// Get text color based on background
function getTextColor(loading: number): string {
  const absLoading = Math.abs(loading);
  return absLoading >= 0.5 ? 'white' : '#1f2937';
}

export const SortedLoadingMatrix: React.FC<SortedLoadingMatrixProps> = ({
  pcaResult,
  nComponents = 8,
}) => {
  // Calculate sorted loadings for each PC
  const sortedLoadingsPerPC = useMemo(() => {
    const result: SortedLoading[][] = [];
    const actualComponents = Math.min(nComponents, pcaResult.eigenvalues.length);

    for (let i = 0; i < actualComponents; i++) {
      result.push(getSortedLoadings(pcaResult, i));
    }

    return result;
  }, [pcaResult, nComponents]);

  const numElements = pcaResult.columns.length;

  return (
    <Box>
      <Typography variant="subtitle1" gutterBottom fontWeight={500}>
        Sorted Loading Matrix (Scaled Eigenvectors)
      </Typography>
      <Typography variant="body2" color="text.secondary" paragraph>
        Shows elements ranked by their loading (correlation with each PC) from highest positive
        to highest negative. Dark green indicates strong positive association, dark red indicates
        strong negative association. This matrix helps identify element associations for each PC.
      </Typography>

      <Paper sx={{ p: 2, overflowX: 'auto' }}>
        <Box
          component="table"
          sx={{
            borderCollapse: 'collapse',
            minWidth: '100%',
            '& th, & td': {
              border: '1px solid #d1d5db',
              textAlign: 'center',
              minWidth: 80,
              fontSize: '12px',
            },
            '& th': {
              bgcolor: '#f3f4f6',
              fontWeight: 600,
              p: 1,
            },
            '& td': {
              p: 0.5,
            },
          }}
        >
          <thead>
            <tr>
              {sortedLoadingsPerPC.map((_, i) => (
                <th key={i} colSpan={2}>
                  PC{i + 1}
                  <br />
                  <span style={{ fontWeight: 400, fontSize: '10px', color: '#6b7280' }}>
                    ({pcaResult.varianceExplained[i]?.toFixed(1)}%)
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: numElements }).map((_, rowIdx) => (
              <tr key={rowIdx}>
                {sortedLoadingsPerPC.map((pcLoadings, pcIdx) => {
                  const item = pcLoadings[rowIdx];
                  if (!item) {
                    return (
                      <React.Fragment key={pcIdx}>
                        <td>-</td>
                        <td>-</td>
                      </React.Fragment>
                    );
                  }

                  const bgColor = getLoadingColor(item.loading);
                  const textColor = getTextColor(item.loading);

                  return (
                    <React.Fragment key={pcIdx}>
                      <td
                        style={{
                          backgroundColor: bgColor,
                          color: textColor,
                          fontWeight: Math.abs(item.loading) >= 0.5 ? 600 : 400,
                        }}
                      >
                        {item.element}
                      </td>
                      <td
                        style={{
                          backgroundColor: bgColor,
                          color: textColor,
                          fontWeight: Math.abs(item.loading) >= 0.5 ? 600 : 400,
                        }}
                      >
                        {item.loading.toFixed(2)}
                      </td>
                    </React.Fragment>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </Box>
      </Paper>

      {/* Legend */}
      <Paper sx={{ mt: 2, p: 2 }}>
        <Typography variant="subtitle2" gutterBottom>
          Interpretation Guide
        </Typography>
        <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', fontSize: '13px' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box
              sx={{
                width: 24,
                height: 24,
                bgcolor: '#166534',
                borderRadius: 0.5,
              }}
            />
            <span>Strong positive (&ge;0.7)</span>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box
              sx={{
                width: 24,
                height: 24,
                bgcolor: '#86efac',
                borderRadius: 0.5,
              }}
            />
            <span>Moderate positive (0.3-0.5)</span>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box
              sx={{
                width: 24,
                height: 24,
                bgcolor: '#fca5a5',
                borderRadius: 0.5,
              }}
            />
            <span>Moderate negative (0.3-0.5)</span>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box
              sx={{
                width: 24,
                height: 24,
                bgcolor: '#991b1b',
                borderRadius: 0.5,
              }}
            />
            <span>Strong negative (&ge;0.7)</span>
          </Box>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Elements at the positive and negative ends of each PC represent element associations.
          For example, if Pb-Ag-As are strongly positive on PC1 while Y-Al-Hf are strongly
          negative, this indicates two distinct geochemical signatures (e.g., mineralisation vs.
          host rock).
        </Typography>
      </Paper>
    </Box>
  );
};

export default SortedLoadingMatrix;
