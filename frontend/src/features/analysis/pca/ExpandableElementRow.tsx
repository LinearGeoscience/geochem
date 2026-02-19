/**
 * ExpandableElementRow Component
 *
 * An accordion-style element row that lazily renders probability plots.
 * Only renders the plot when expanded, preventing mass rendering crashes.
 */

import React from 'react';
import {
  Box,
  Paper,
  Typography,
  Checkbox,
  FormControlLabel,
  Chip,
  Tooltip,
  Collapse,
  IconButton,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import Plot from 'react-plotly.js';
import { ExpandablePlotWrapper } from '../../../components/ExpandablePlotWrapper';
import { getPlotConfig, EXPORT_FONT_SIZES } from '../../../utils/plotConfig';
import { useAppStore } from '../../../store/appStore';
import { getColumnDisplayName } from '../../../utils/attributeUtils';

interface PlotData {
  x: number[];
  y: number[];
  mode: 'markers';
  type: 'scatter';
  marker: { size: number; color: string[]; line: { width: number } };
  name: string;
}

interface ExpandableElementRowProps {
  element: string;
  bldNScore: number;
  percentBLD: number;
  isAcceptable: boolean;
  isSelected: boolean;
  onToggle: (element: string) => void;
  getPlotData: () => PlotData | null;
  isExpanded: boolean;
  onExpandToggle: (element: string) => void;
  isNonElement?: boolean;
}

export const ExpandableElementRow: React.FC<ExpandableElementRowProps> = ({
  element,
  bldNScore,
  percentBLD,
  isAcceptable,
  isSelected,
  onToggle,
  getPlotData,
  isExpanded,
  onExpandToggle,
  isNonElement = false,
}) => {
  const { columns } = useAppStore();
  const displayElement = getColumnDisplayName(columns, element);
  const bgColor = isNonElement ? '#f3f4f6' : isAcceptable ? '#f0fdf4' : '#fef2f2';
  const borderColor = isNonElement ? '#d1d5db' : isAcceptable ? '#86efac' : '#fecaca';

  const handleExpandClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onExpandToggle(element);
  };

  // Only compute plot data when expanded (lazy loading)
  const plotData = isExpanded ? getPlotData() : null;

  return (
    <Paper
      sx={{
        bgcolor: bgColor,
        border: `1px solid ${borderColor}`,
        borderRadius: 1,
        overflow: 'hidden',
      }}
    >
      {/* Header row */}
      <Box
        sx={{
          p: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <FormControlLabel
          control={
            <Checkbox
              checked={isSelected}
              onChange={() => onToggle(element)}
              size="small"
            />
          }
          label={
            <Typography variant="body2" fontWeight={500} color={isNonElement ? 'text.disabled' : 'text.primary'}>
              {displayElement}
            </Typography>
          }
        />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {isNonElement ? (
            <Chip
              label="Non-element"
              size="small"
              variant="outlined"
              sx={{ color: 'text.disabled', borderColor: '#d1d5db' }}
            />
          ) : (
            <Tooltip title={`BLD N-Score: ${bldNScore.toFixed(2)}, ${percentBLD.toFixed(1)}% BLD`}>
              <Chip
                label={isAcceptable ? 'OK' : 'BLD>-1'}
                size="small"
                color={isAcceptable ? 'success' : 'error'}
                variant="outlined"
              />
            </Tooltip>
          )}
          <Tooltip title={isExpanded ? 'Hide probability plot' : 'Show probability plot'}>
            <IconButton size="small" onClick={handleExpandClick}>
              {isExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Expandable plot section */}
      <Collapse in={isExpanded} unmountOnExit>
        <Box sx={{ p: 1, pt: 0, borderTop: `1px solid ${borderColor}` }}>
          {plotData ? (
            <ExpandablePlotWrapper>
              <Plot
                data={[plotData as any]}
                layout={{
                  title: {
                    text: `${displayElement} ${isAcceptable ? '✓' : '⚠'}`,
                    font: { size: EXPORT_FONT_SIZES.title },
                    x: 0,
                    xanchor: 'left',
                  },
                  autosize: true,
                  height: 300,
                  font: { size: EXPORT_FONT_SIZES.tickLabels },
                  margin: { l: 60, r: 30, t: 50, b: 60 },
                  xaxis: {
                    title: {
                      text: 'N-Score (Theoretical Quantiles)',
                      font: { size: EXPORT_FONT_SIZES.axisTitle },
                    },
                    tickfont: { size: EXPORT_FONT_SIZES.tickLabels },
                    gridcolor: '#e0e0e0',
                  },
                  yaxis: {
                    title: {
                      text: 'Value',
                      font: { size: EXPORT_FONT_SIZES.axisTitle },
                    },
                    tickfont: { size: EXPORT_FONT_SIZES.tickLabels },
                    gridcolor: '#e0e0e0',
                    type: 'log',
                  },
                  plot_bgcolor: '#fafafa',
                  hovermode: 'closest',
                  showlegend: false,
                  // BLD threshold line at N-score = -1
                  shapes: [
                    {
                      type: 'line',
                      x0: -1,
                      x1: -1,
                      y0: 0,
                      y1: 1,
                      yref: 'paper',
                      line: { color: '#dc2626', width: 2, dash: 'dash' },
                    },
                  ],
                  annotations: [
                    {
                      x: -1,
                      y: 1,
                      yref: 'paper',
                      text: 'BLD Threshold',
                      showarrow: false,
                      font: { size: 10, color: '#dc2626' },
                      xanchor: 'left',
                      yanchor: 'top',
                    },
                    {
                      x: 0,
                      y: 0,
                      xref: 'paper',
                      yref: 'paper',
                      text: `${percentBLD.toFixed(1)}% BLD`,
                      showarrow: false,
                      font: {
                        size: 11,
                        color: isAcceptable ? '#166534' : '#991b1b',
                      },
                      bgcolor: isAcceptable ? '#dcfce7' : '#fee2e2',
                      borderpad: 4,
                      xanchor: 'left',
                      yanchor: 'bottom',
                    },
                  ],
                }}
                config={getPlotConfig({ filename: `probability_${element}` })}
                style={{ width: '100%' }}
                useResizeHandler={true}
              />
            </ExpandablePlotWrapper>
          ) : (
            <Typography color="text.secondary" textAlign="center" py={2}>
              No data available for this element
            </Typography>
          )}
        </Box>
      </Collapse>
    </Paper>
  );
};

export default ExpandableElementRow;
