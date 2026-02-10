/**
 * MiniEigenvectorPlot Component
 *
 * A compact version of the eigenvector plot for display in the Association tab.
 * Highlights matched elements from a pattern with larger markers and category-specific colors.
 */

import React, { useMemo } from 'react';
import { Box, Tooltip, Typography } from '@mui/material';
import Plot from 'react-plotly.js';
import { FullPCAResult } from '../../../types/compositional';
import { getSortedLoadings } from '../../../utils/calculations/pcaAnalysis';

interface MiniEigenvectorPlotProps {
  pcaResult: FullPCAResult;
  componentIndex: number;
  highlightedElements: string[];
  highlightColor: string;
  side: 'positive' | 'negative';
  height?: number;
}

export const MiniEigenvectorPlot: React.FC<MiniEigenvectorPlotProps> = ({
  pcaResult,
  componentIndex,
  highlightedElements,
  highlightColor,
  side,
  height = 120,
}) => {
  const plotData = useMemo(() => {
    const sortedLoadings = getSortedLoadings(pcaResult, componentIndex);

    // Create a Set for fast lookup of highlighted elements (case-insensitive)
    const highlightSet = new Set(highlightedElements.map(e => e.toLowerCase()));

    // Map loadings to plot data with highlighting
    const elements: string[] = [];
    const loadings: number[] = [];
    const sizes: number[] = [];
    const colors: string[] = [];
    const lineWidths: number[] = [];
    const lineColors: string[] = [];
    const opacities: number[] = [];

    sortedLoadings.forEach((l) => {
      const isHighlighted = highlightSet.has(l.element.toLowerCase());
      const isOnCorrectSide = side === 'positive' ? l.loading > 0 : l.loading < 0;

      elements.push(l.element);
      loadings.push(l.loading);

      if (isHighlighted) {
        // Highlighted element - larger, colored, with border
        sizes.push(10);
        colors.push(highlightColor);
        lineWidths.push(2);
        lineColors.push('#374151');
        opacities.push(1.0);
      } else if (isOnCorrectSide && Math.abs(l.loading) > 0.2) {
        // On the emphasized side but not highlighted - medium size, semi-transparent
        sizes.push(6);
        colors.push(side === 'positive' ? '#86efac' : '#fca5a5');
        lineWidths.push(0.5);
        lineColors.push('#9ca3af');
        opacities.push(0.5);
      } else {
        // Other elements - small, grey, low opacity
        sizes.push(4);
        colors.push('#d1d5db');
        lineWidths.push(0);
        lineColors.push('#d1d5db');
        opacities.push(0.3);
      }
    });

    return { elements, loadings, sizes, colors, lineWidths, lineColors, opacities };
  }, [pcaResult, componentIndex, highlightedElements, highlightColor, side]);

  // Build shapes for connection band between matched elements
  const connectionShapes = useMemo(() => {
    const shapes: any[] = [];

    if (highlightedElements.length < 2) return shapes;

    const highlightSet = new Set(highlightedElements.map(e => e.toLowerCase()));
    const matchedIndices = plotData.elements
      .map((el, idx) => ({ el, idx }))
      .filter(({ el }) => highlightSet.has(el.toLowerCase()))
      .map(({ idx }) => idx);

    if (matchedIndices.length < 2) return shapes;

    const minIdx = Math.min(...matchedIndices);
    const maxIdx = Math.max(...matchedIndices);

    // Draw a subtle connection line at y=0 between matched elements
    shapes.push({
      type: 'line',
      x0: minIdx,
      y0: 0,
      x1: maxIdx,
      y1: 0,
      line: {
        color: highlightColor,
        width: 2,
        dash: 'dot',
      },
    });

    return shapes;
  }, [plotData.elements, highlightedElements, highlightColor]);

  return (
    <Tooltip
      title={
        <Box>
          <Typography variant="caption" fontWeight={600}>
            PC{componentIndex + 1} Eigenvector Plot
          </Typography>
          <Typography variant="caption" display="block">
            Highlighted: {highlightedElements.join(', ') || 'None'}
          </Typography>
        </Box>
      }
      arrow
      placement="top"
    >
      <Box sx={{ width: '100%', cursor: 'pointer' }}>
        <Plot
          data={[
            {
              x: plotData.elements,
              y: plotData.loadings,
              type: 'scatter',
              mode: 'lines+markers',
              line: { color: '#9ca3af', width: 1 },
              marker: {
                size: plotData.sizes,
                color: plotData.colors,
                opacity: plotData.opacities,
                line: {
                  width: plotData.lineWidths,
                  color: plotData.lineColors,
                },
              },
              hoverinfo: 'text',
              hovertext: plotData.elements.map(
                (el, i) => `${el}: ${plotData.loadings[i].toFixed(3)}`
              ),
            },
          ]}
          layout={{
            height,
            margin: { t: 5, r: 5, b: 25, l: 5 },
            xaxis: {
              showticklabels: true,
              tickangle: 45,
              tickfont: { size: 7 },
              showgrid: false,
              zeroline: false,
            },
            yaxis: {
              showticklabels: false,
              showgrid: false,
              zeroline: true,
              zerolinecolor: '#374151',
              zerolinewidth: 1,
              range: [-1.1, 1.1],
            },
            showlegend: false,
            shapes: connectionShapes,
            paper_bgcolor: 'transparent',
            plot_bgcolor: 'transparent',
          }}
          config={{
            displayModeBar: false,
            staticPlot: false,
          }}
          style={{ width: '100%' }}
        />
      </Box>
    </Tooltip>
  );
};

export default MiniEigenvectorPlot;
