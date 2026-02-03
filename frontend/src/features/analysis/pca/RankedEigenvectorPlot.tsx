/**
 * Ranked Eigenvector Plot Component
 *
 * Displays line charts for each principal component showing element loadings
 * ranked from lowest to highest. This visualization clearly shows element
 * associations at the positive and negative ends of each PC.
 *
 * Based on the Exploration Geochemistry Workshop Manual (page 5-6).
 */

import React, { useMemo } from 'react';
import { Box, Typography, Paper, Grid } from '@mui/material';
import Plot from 'react-plotly.js';
import { FullPCAResult } from '../../../types/compositional';
import { getSortedLoadings } from '../../../utils/calculations/pcaAnalysis';

interface RankedEigenvectorPlotProps {
  pcaResult: FullPCAResult;
  nComponents?: number;
}

interface SinglePCPlotProps {
  pcaResult: FullPCAResult;
  componentIndex: number;
}

// Single PC line plot
const SinglePCPlot: React.FC<SinglePCPlotProps> = ({ pcaResult, componentIndex }) => {
  const plotData = useMemo(() => {
    // getSortedLoadings returns loadings sorted from highest to lowest
    const sortedLoadings = getSortedLoadings(pcaResult, componentIndex);

    return {
      elements: sortedLoadings.map((l) => l.element),
      loadings: sortedLoadings.map((l) => l.loading),
      colors: sortedLoadings.map((l) => (l.loading >= 0 ? '#22c55e' : '#ef4444')),
    };
  }, [pcaResult, componentIndex]);

  // Identify top associations (first elements are highest positive loadings)
  const positiveAssoc = plotData.elements
    .slice(0, 5) // First 5 elements (highest loadings)
    .filter((_, i) => plotData.loadings[i] >= 0.3);

  const negativeAssoc = plotData.elements
    .slice(-5) // Last 5 elements (most negative loadings)
    .filter((_, i) => plotData.loadings[plotData.loadings.length - 5 + i] <= -0.3);

  const varianceExplained = pcaResult.varianceExplained[componentIndex]?.toFixed(1);

  return (
    <Paper sx={{ p: 1, height: '100%' }}>
      <Plot
        data={[
          {
            x: plotData.elements,
            y: plotData.loadings,
            type: 'scatter',
            mode: 'lines+markers',
            line: { color: '#6b7280', width: 1 },
            marker: {
              size: 8,
              color: plotData.colors,
              line: { width: 1, color: '#374151' },
            },
            hovertemplate: '%{x}<br>Loading: %{y:.3f}<extra></extra>',
          },
        ]}
        layout={{
          title: {
            text: `PC${componentIndex + 1} (${varianceExplained}%)`,
            font: { size: 14 },
          },
          height: 400,
          margin: { t: 40, r: 20, b: 100, l: 60 },
          xaxis: {
            tickangle: 45,
            tickfont: { size: 10 },
            showgrid: false,
          },
          yaxis: {
            title: { text: 'Loading', font: { size: 11 } },
            tickfont: { size: 10 },
            range: [-1.1, 1.1],
            zeroline: true,
            zerolinecolor: '#374151',
            zerolinewidth: 1,
            gridcolor: '#e5e7eb',
          },
          showlegend: false,
          // Annotations for element associations
          annotations: [
            // Positive association label (top left - highest loadings are first)
            positiveAssoc.length > 0
              ? {
                  x: 0,
                  y: 1,
                  xref: 'paper',
                  yref: 'paper',
                  text: positiveAssoc.join('-'),
                  showarrow: false,
                  font: { size: 10, color: '#166534' },
                  bgcolor: '#dcfce7',
                  borderpad: 3,
                  xanchor: 'left',
                  yanchor: 'top',
                }
              : null,
            // Negative association label (bottom right - lowest loadings are last)
            negativeAssoc.length > 0
              ? {
                  x: 1,
                  y: 0,
                  xref: 'paper',
                  yref: 'paper',
                  text: negativeAssoc.join('-'),
                  showarrow: false,
                  font: { size: 10, color: '#991b1b' },
                  bgcolor: '#fee2e2',
                  borderpad: 3,
                  xanchor: 'right',
                  yanchor: 'bottom',
                }
              : null,
          ].filter(Boolean) as any[],
        }}
        config={{ responsive: true, displayModeBar: true }}
        style={{ width: '100%' }}
      />
    </Paper>
  );
};

export const RankedEigenvectorPlot: React.FC<RankedEigenvectorPlotProps> = ({
  pcaResult,
  nComponents = 8,
}) => {
  const actualComponents = Math.min(nComponents, pcaResult.eigenvalues.length);

  return (
    <Box>
      <Typography variant="subtitle1" gutterBottom fontWeight={500}>
        Ranked Eigenvector Plots
      </Typography>
      <Typography variant="body2" color="text.secondary" paragraph>
        Each plot shows elements ranked by their loading (scaled eigenvector value) for one
        principal component. Elements at the positive end (right/top) are positively associated,
        while elements at the negative end (left/bottom) form a separate association. These
        associations can represent different geological processes (e.g., mineralisation vs. host
        rock, mafic vs. felsic).
      </Typography>

      <Grid container spacing={2}>
        {Array.from({ length: actualComponents }).map((_, i) => (
          <Grid item xs={12} md={6} key={i}>
            <SinglePCPlot pcaResult={pcaResult} componentIndex={i} />
          </Grid>
        ))}
      </Grid>

      {/* Interpretation guide */}
      <Paper sx={{ mt: 2, p: 2 }}>
        <Typography variant="subtitle2" gutterBottom>
          How to Interpret
        </Typography>
        <Typography variant="body2" color="text.secondary">
          <strong>PC1</strong> typically captures the largest source of variation in your data.
          In exploration geochemistry, this might represent:
          <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
            <li>
              <strong>Mineralisation vs. Host Rock:</strong> Ore elements (Pb, Ag, As, Cd, Zn, Sb)
              at one end, lithogenic elements (Y, Al, Hf, Zr, Ti) at the other
            </li>
            <li>
              <strong>Mafic vs. Felsic:</strong> Mafic indicators (Co, Cr, Ni, Sc, V, Mg) vs.
              felsic indicators (K, Rb, Th, La, Zr)
            </li>
            <li>
              <strong>Alteration:</strong> Sericite (K, Rb, Ba, Tl) vs. chlorite (Mg, Fe, Mn)
            </li>
          </ul>
          Element associations at the same end of a PC are geochemically related and can be
          mapped together using the PC scores.
        </Typography>
      </Paper>
    </Box>
  );
};

export default RankedEigenvectorPlot;
