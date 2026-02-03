/**
 * Scree Plot Component
 *
 * Displays eigenvalues and cumulative variance explained by each principal component.
 * Helps identify the number of meaningful components (where the "elbow" is).
 */

import React, { useMemo } from 'react';
import { Box, Typography, Paper } from '@mui/material';
import Plot from 'react-plotly.js';
import { FullPCAResult } from '../../../types/compositional';
import { ExpandablePlotWrapper } from '../../../components/ExpandablePlotWrapper';

interface ScreePlotProps {
  pcaResult: FullPCAResult;
}

export const ScreePlot: React.FC<ScreePlotProps> = ({ pcaResult }) => {
  const plotData = useMemo(() => {
    const nComponents = pcaResult.eigenvalues.length;
    const pcLabels = Array.from({ length: nComponents }, (_, i) => `PC${i + 1}`);

    return {
      labels: pcLabels,
      eigenvalues: pcaResult.eigenvalues,
      varianceExplained: pcaResult.varianceExplained,
      cumulativeVariance: pcaResult.cumulativeVariance,
    };
  }, [pcaResult]);

  return (
    <Box>
      <Typography variant="subtitle1" gutterBottom fontWeight={500}>
        Scree Plot
      </Typography>
      <Typography variant="body2" color="text.secondary" paragraph>
        Shows the relative importance of each principal component. Most information is
        contained in the first few PCs. The percentage of variance captured by each PC
        is shown alongside the eigenvalues.
      </Typography>

      <Paper sx={{ p: 2 }}>
        <ExpandablePlotWrapper>
          <Plot
            data={[
              // Eigenvalues (bar chart)
              {
                x: plotData.labels,
                y: plotData.eigenvalues,
                type: 'bar',
                name: 'Eigenvalue',
                marker: { color: '#3b82f6' },
                yaxis: 'y',
                hovertemplate: '%{x}<br>Eigenvalue: %{y:.3f}<extra></extra>',
              },
              // Cumulative variance (line chart)
              {
                x: plotData.labels,
                y: plotData.cumulativeVariance,
                type: 'scatter',
                mode: 'lines+markers',
                name: 'Cumulative Variance %',
                line: { color: '#dc2626', width: 2 },
                marker: { size: 8, color: '#dc2626' },
                yaxis: 'y2',
                hovertemplate: '%{x}<br>Cumulative: %{y:.1f}%<extra></extra>',
              },
              // Individual variance (line chart)
              {
                x: plotData.labels,
                y: plotData.varianceExplained,
                type: 'scatter',
                mode: 'lines+markers',
                name: 'Variance Explained %',
                line: { color: '#10b981', width: 2, dash: 'dot' },
                marker: { size: 6, color: '#10b981' },
                yaxis: 'y2',
                hovertemplate: '%{x}<br>Variance: %{y:.1f}%<extra></extra>',
              },
            ]}
            layout={{
              height: 400,
              margin: { t: 20, r: 80, b: 60, l: 60 },
              xaxis: {
                title: { text: 'Principal Component', font: { size: 12 } },
                tickfont: { size: 11 },
              },
              yaxis: {
                title: { text: 'Eigenvalue', font: { size: 12, color: '#3b82f6' } },
                tickfont: { size: 11, color: '#3b82f6' },
                side: 'left',
              },
              yaxis2: {
                title: { text: 'Variance Explained (%)', font: { size: 12, color: '#dc2626' } },
                tickfont: { size: 11, color: '#dc2626' },
                overlaying: 'y',
                side: 'right',
                range: [0, 105],
              },
              legend: {
                orientation: 'h',
                yanchor: 'bottom',
                y: 1.02,
                xanchor: 'center',
                x: 0.5,
              },
              showlegend: true,
              // Kaiser criterion line at eigenvalue = 1
              shapes: [
                {
                  type: 'line',
                  x0: -0.5,
                  x1: plotData.labels.length - 0.5,
                  y0: 1,
                  y1: 1,
                  line: { color: '#6b7280', width: 1, dash: 'dash' },
                },
              ],
              annotations: [
                {
                  x: plotData.labels.length - 0.5,
                  y: 1,
                  text: 'Kaiser criterion',
                  showarrow: false,
                  font: { size: 10, color: '#6b7280' },
                  xanchor: 'right',
                  yanchor: 'bottom',
                },
              ],
            }}
            config={{ responsive: true, displayModeBar: true }}
            style={{ width: '100%' }}
          />
        </ExpandablePlotWrapper>
      </Paper>

      {/* Variance table */}
      <Paper sx={{ mt: 2, p: 2 }}>
        <Typography variant="subtitle2" gutterBottom>
          Variance Summary
        </Typography>
        <Box
          component="table"
          sx={{
            width: '100%',
            borderCollapse: 'collapse',
            '& th, & td': {
              border: '1px solid #e5e7eb',
              p: 1,
              textAlign: 'center',
              fontSize: '13px',
            },
            '& th': {
              bgcolor: '#f3f4f6',
              fontWeight: 600,
            },
          }}
        >
          <thead>
            <tr>
              <th>PC</th>
              <th>Eigenvalue</th>
              <th>Variance (%)</th>
              <th>Cumulative (%)</th>
            </tr>
          </thead>
          <tbody>
            {plotData.labels.map((label, i) => (
              <tr key={label}>
                <td>{label}</td>
                <td>{plotData.eigenvalues[i]?.toFixed(3)}</td>
                <td>{plotData.varianceExplained[i]?.toFixed(1)}%</td>
                <td>{plotData.cumulativeVariance[i]?.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </Box>
      </Paper>
    </Box>
  );
};

export default ScreePlot;
