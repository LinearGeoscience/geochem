/**
 * Control Chart Component
 * Shewhart control chart visualization for standard reference materials
 */

import React, { useMemo, useState } from 'react';
import Plot from 'react-plotly.js';
import {
  Box,
  Paper,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Grid,
  Chip,
  Alert,
  Card,
  CardContent,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import {
  CheckCircle as CheckIcon,
  Warning as WarningIcon,
  Error as ErrorIcon,
  TrendingUp as TrendIcon,
} from '@mui/icons-material';
import { useQAQCStore } from '../../store/qaqcStore';
import { ControlChartData } from '../../types/qaqc';

type ChartMode = 'values' | 'recovery';

export const ControlChart: React.FC = () => {
  const {
    controlCharts,
    selectedElements,
    selectedStandard,
    setSelectedStandard,
  } = useQAQCStore();

  const [selectedElement, setSelectedElement] = useState<string>(
    selectedElements[0] || ''
  );
  const [chartMode, setChartMode] = useState<ChartMode>('values');

  // Get available standards
  const availableStandards = useMemo(() =>
    Object.keys(controlCharts),
    [controlCharts]
  );

  // Get available elements for selected standard
  const availableElements = useMemo(() => {
    if (!selectedStandard || !controlCharts[selectedStandard]) return [];
    return controlCharts[selectedStandard].map(c => c.element);
  }, [selectedStandard, controlCharts]);

  // Get current chart data
  const chartData = useMemo((): ControlChartData | null => {
    if (!selectedStandard || !selectedElement) return null;
    const charts = controlCharts[selectedStandard];
    if (!charts) return null;
    return charts.find(c => c.element === selectedElement) || null;
  }, [selectedStandard, selectedElement, controlCharts]);

  // Auto-select first standard
  React.useEffect(() => {
    if (!selectedStandard && availableStandards.length > 0) {
      setSelectedStandard(availableStandards[0]);
    }
  }, [availableStandards, selectedStandard, setSelectedStandard]);

  // Auto-select first element
  React.useEffect(() => {
    if (availableElements.length > 0 && !availableElements.includes(selectedElement)) {
      setSelectedElement(availableElements[0]);
    }
  }, [availableElements, selectedElement]);

  // Build Plotly traces
  const { traces, layout } = useMemo(() => {
    if (!chartData) return { traces: [], layout: {} };

    const xValues = chartData.points.map((_, i) => i + 1);
    const yValues = chartMode === 'recovery' && chartData.points[0]?.recovery !== undefined
      ? chartData.points.map(p => p.recovery!)
      : chartData.points.map(p => p.value);

    const centerLine = chartMode === 'recovery'
      ? 100
      : (chartData.limits.certifiedValue ?? chartData.limits.mean);

    const ucl = chartMode === 'recovery'
      ? 100 + (chartData.limits.upperControlLimit - centerLine) / centerLine * 100
      : chartData.limits.upperControlLimit;

    const lcl = chartMode === 'recovery'
      ? 100 - (centerLine - chartData.limits.lowerControlLimit) / centerLine * 100
      : chartData.limits.lowerControlLimit;

    const uwl = chartMode === 'recovery'
      ? 100 + (chartData.limits.upperWarningLimit - centerLine) / centerLine * 100
      : chartData.limits.upperWarningLimit;

    const lwl = chartMode === 'recovery'
      ? 100 - (centerLine - chartData.limits.lowerWarningLimit) / centerLine * 100
      : chartData.limits.lowerWarningLimit;

    // Color points by status
    const colors = chartData.points.map(p => {
      switch (p.status) {
        case 'pass': return '#4caf50';
        case 'warning': return '#ff9800';
        case 'fail': return '#f44336';
        default: return '#9e9e9e';
      }
    });

    const traces: any[] = [
      // Data points
      {
        x: xValues,
        y: yValues,
        type: 'scatter',
        mode: 'markers+lines',
        name: chartData.element,
        marker: {
          color: colors,
          size: 10,
          line: { color: 'white', width: 1 },
        },
        line: { color: '#1976d2', width: 1 },
        text: chartData.points.map(p =>
          `${p.sampleId}<br>Value: ${p.value.toFixed(3)}${p.recovery ? `<br>Recovery: ${p.recovery.toFixed(1)}%` : ''}`
        ),
        hoverinfo: 'text',
      },
      // Center line
      {
        x: [0, xValues.length + 1],
        y: [chartMode === 'recovery' ? 100 : centerLine, chartMode === 'recovery' ? 100 : centerLine],
        type: 'scatter',
        mode: 'lines',
        name: chartData.limits.certifiedValue ? 'Certified Value' : 'Mean',
        line: { color: '#1976d2', width: 2, dash: 'solid' },
        hoverinfo: 'skip',
      },
      // Upper Warning Limit (+2σ)
      {
        x: [0, xValues.length + 1],
        y: [uwl, uwl],
        type: 'scatter',
        mode: 'lines',
        name: '+2σ Warning',
        line: { color: '#ff9800', width: 1.5, dash: 'dash' },
        hoverinfo: 'skip',
      },
      // Lower Warning Limit (-2σ)
      {
        x: [0, xValues.length + 1],
        y: [lwl, lwl],
        type: 'scatter',
        mode: 'lines',
        name: '-2σ Warning',
        line: { color: '#ff9800', width: 1.5, dash: 'dash' },
        hoverinfo: 'skip',
      },
      // Upper Control Limit (+3σ)
      {
        x: [0, xValues.length + 1],
        y: [ucl, ucl],
        type: 'scatter',
        mode: 'lines',
        name: '+3σ Control',
        line: { color: '#f44336', width: 2, dash: 'dot' },
        hoverinfo: 'skip',
      },
      // Lower Control Limit (-3σ)
      {
        x: [0, xValues.length + 1],
        y: [lcl, lcl],
        type: 'scatter',
        mode: 'lines',
        name: '-3σ Control',
        line: { color: '#f44336', width: 2, dash: 'dot' },
        hoverinfo: 'skip',
      },
    ];

    const layout: any = {
      title: {
        text: `${chartData.standardName} - ${chartData.element}`,
        font: { size: 16 },
      },
      xaxis: {
        title: 'Sequence Number',
        zeroline: false,
      },
      yaxis: {
        title: chartMode === 'recovery' ? 'Recovery (%)' : chartData.element,
        zeroline: false,
      },
      showlegend: true,
      legend: {
        orientation: 'h',
        y: -0.2,
        x: 0.5,
        xanchor: 'center',
      },
      autosize: true,
      height: 400,
      margin: { l: 60, r: 30, t: 50, b: 80 },
      hovermode: 'closest',
    };

    return { traces, layout };
  }, [chartData, chartMode]);

  if (Object.keys(controlCharts).length === 0) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="info">
          No control chart data available. Please run QA/QC analysis first.
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h5" gutterBottom>
        Control Charts (Standards)
      </Typography>

      {/* Controls */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm={4}>
            <FormControl fullWidth size="small">
              <InputLabel>Standard</InputLabel>
              <Select
                value={selectedStandard || ''}
                onChange={(e) => setSelectedStandard(e.target.value)}
                label="Standard"
              >
                {availableStandards.map((std) => (
                  <MenuItem key={std} value={std}>
                    {std}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>

          <Grid item xs={12} sm={4}>
            <FormControl fullWidth size="small">
              <InputLabel>Element</InputLabel>
              <Select
                value={selectedElement}
                onChange={(e) => setSelectedElement(e.target.value)}
                label="Element"
              >
                {availableElements.map((el) => (
                  <MenuItem key={el} value={el}>
                    {el}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>

          <Grid item xs={12} sm={4}>
            <ToggleButtonGroup
              value={chartMode}
              exclusive
              onChange={(_, value) => value && setChartMode(value)}
              size="small"
              fullWidth
            >
              <ToggleButton value="values">Values</ToggleButton>
              <ToggleButton value="recovery">Recovery %</ToggleButton>
            </ToggleButtonGroup>
          </Grid>
        </Grid>
      </Paper>

      {/* Chart */}
      {chartData && (
        <>
          <Paper sx={{ p: 2, mb: 2 }}>
            <Plot
              data={traces}
              layout={layout}
              config={{ displayModeBar: true, displaylogo: false, responsive: true }}
              style={{ width: '100%' }}
              useResizeHandler={true}
            />
          </Paper>

          {/* Statistics Summary */}
          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Statistics
                  </Typography>
                  <Grid container spacing={1}>
                    <Grid item xs={6}>
                      <Typography variant="body2" color="text.secondary">
                        Mean:
                      </Typography>
                      <Typography variant="body1">
                        {chartData.limits.mean.toFixed(4)}
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="body2" color="text.secondary">
                        Std Dev:
                      </Typography>
                      <Typography variant="body1">
                        {chartData.limits.standardDeviation.toFixed(4)}
                      </Typography>
                    </Grid>
                    {chartData.limits.certifiedValue && (
                      <>
                        <Grid item xs={6}>
                          <Typography variant="body2" color="text.secondary">
                            Certified:
                          </Typography>
                          <Typography variant="body1">
                            {chartData.limits.certifiedValue.toFixed(4)}
                          </Typography>
                        </Grid>
                        <Grid item xs={6}>
                          <Typography variant="body2" color="text.secondary">
                            Uncertainty (2σ):
                          </Typography>
                          <Typography variant="body1">
                            ±{chartData.limits.certifiedUncertainty?.toFixed(4) || 'N/A'}
                          </Typography>
                        </Grid>
                      </>
                    )}
                    <Grid item xs={6}>
                      <Typography variant="body2" color="text.secondary">
                        UCL (+3σ):
                      </Typography>
                      <Typography variant="body1">
                        {chartData.limits.upperControlLimit.toFixed(4)}
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="body2" color="text.secondary">
                        LCL (-3σ):
                      </Typography>
                      <Typography variant="body1">
                        {chartData.limits.lowerControlLimit.toFixed(4)}
                      </Typography>
                    </Grid>
                  </Grid>
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12} md={6}>
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Results
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
                    <Chip
                      icon={<CheckIcon />}
                      label={`Pass: ${chartData.passCount}`}
                      color="success"
                      size="small"
                    />
                    <Chip
                      icon={<WarningIcon />}
                      label={`Warning: ${chartData.warningCount}`}
                      color="warning"
                      size="small"
                    />
                    <Chip
                      icon={<ErrorIcon />}
                      label={`Fail: ${chartData.failCount}`}
                      color="error"
                      size="small"
                    />
                  </Box>

                  <Typography variant="body2" gutterBottom>
                    Pass Rate: {((chartData.passCount + chartData.warningCount) / chartData.points.length * 100).toFixed(1)}%
                  </Typography>

                  {/* Alerts */}
                  {chartData.biasDetected && (
                    <Alert severity="warning" sx={{ mt: 1 }} icon={<TrendIcon />}>
                      Potential bias detected - consecutive warnings on same side of center line
                    </Alert>
                  )}
                  {chartData.driftDetected && (
                    <Alert severity="warning" sx={{ mt: 1 }} icon={<TrendIcon />}>
                      Potential drift detected - systematic trend over time
                    </Alert>
                  )}
                  {!chartData.biasDetected && !chartData.driftDetected && chartData.failCount === 0 && (
                    <Alert severity="success" sx={{ mt: 1 }}>
                      Standard performance is acceptable
                    </Alert>
                  )}
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </>
      )}
    </Box>
  );
};

export default ControlChart;
