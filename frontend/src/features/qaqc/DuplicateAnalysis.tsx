/**
 * Duplicate Analysis Component
 * RPD plots and precision analysis for field, pulp, and core duplicates
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
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from '@mui/material';
import {
  CheckCircle as CheckIcon,
  Error as ErrorIcon,
} from '@mui/icons-material';
import { useQAQCStore } from '../../store/qaqcStore';
import { DuplicateAnalysis as DuplicateAnalysisType } from '../../types/qaqc';

type DuplicateTypeFilter = 'field_duplicate' | 'pulp_duplicate' | 'core_duplicate' | 'all';
type PlotType = 'scatter' | 'rpd' | 'histogram';

export const DuplicateAnalysis: React.FC = () => {
  const { duplicateAnalyses, thresholds } = useQAQCStore();

  const [selectedType, setSelectedType] = useState<DuplicateTypeFilter>('all');
  const [selectedElement, setSelectedElement] = useState<string>('');
  const [plotType, setPlotType] = useState<PlotType>('scatter');

  // Get all available elements across all duplicate types
  const availableElements = useMemo(() => {
    const elements = new Set<string>();
    Object.values(duplicateAnalyses).forEach((analyses) => {
      analyses.forEach((a) => elements.add(a.element));
    });
    return Array.from(elements).sort();
  }, [duplicateAnalyses]);

  // Get available duplicate types
  const availableTypes = useMemo(() => {
    return Object.keys(duplicateAnalyses) as (keyof typeof duplicateAnalyses)[];
  }, [duplicateAnalyses]);

  // Auto-select first element
  React.useEffect(() => {
    if (availableElements.length > 0 && !availableElements.includes(selectedElement)) {
      setSelectedElement(availableElements[0]);
    }
  }, [availableElements, selectedElement]);

  // Get current analysis data
  const currentAnalysis = useMemo((): DuplicateAnalysisType | null => {
    if (!selectedElement) return null;

    if (selectedType === 'all') {
      // Combine all duplicate types for this element
      const allResults: DuplicateAnalysisType['results'] = [];
      let totalPass = 0;
      let totalFail = 0;

      Object.entries(duplicateAnalyses).forEach(([_type, analyses]) => {
        const analysis = analyses.find(a => a.element === selectedElement);
        if (analysis) {
          allResults.push(...analysis.results);
          totalPass += analysis.passCount;
          totalFail += analysis.failCount;
        }
      });

      if (allResults.length === 0) return null;

      const rpdValues = allResults.map(r => r.rpd);
      const meanRPD = rpdValues.reduce((a, b) => a + b, 0) / rpdValues.length;
      const sortedRPD = [...rpdValues].sort((a, b) => a - b);
      const medianRPD = sortedRPD[Math.floor(sortedRPD.length / 2)];

      return {
        element: selectedElement,
        duplicateType: 'field_duplicate', // Placeholder
        threshold: thresholds.fieldDuplicateRPD,
        results: allResults,
        passCount: totalPass,
        failCount: totalFail,
        passRate: (totalPass / allResults.length) * 100,
        meanRPD,
        medianRPD,
        precision: meanRPD / 2,
      };
    }

    const analyses = duplicateAnalyses[selectedType];
    if (!analyses) return null;
    return analyses.find(a => a.element === selectedElement) || null;
  }, [selectedElement, selectedType, duplicateAnalyses, thresholds]);

  // Build Plotly traces
  const { traces, layout } = useMemo(() => {
    if (!currentAnalysis || currentAnalysis.results.length === 0) {
      return { traces: [], layout: {} };
    }

    let traces: any[] = [];
    let layout: any = {};

    if (plotType === 'scatter') {
      // Scatter plot: Original vs Duplicate
      const passResults = currentAnalysis.results.filter(r => r.status === 'pass');
      const failResults = currentAnalysis.results.filter(r => r.status === 'fail');

      // Calculate axis range
      const allValues = currentAnalysis.results.flatMap(r => [r.originalValue, r.duplicateValue]);
      const minVal = Math.min(...allValues);
      const maxVal = Math.max(...allValues);
      const range = [minVal * 0.9, maxVal * 1.1];

      traces = [
        // Pass points
        {
          x: passResults.map(r => r.originalValue),
          y: passResults.map(r => r.duplicateValue),
          type: 'scatter',
          mode: 'markers',
          name: 'Pass',
          marker: { color: '#4caf50', size: 8 },
          text: passResults.map(r => `${r.originalId} / ${r.duplicateId}<br>RPD: ${r.rpd.toFixed(1)}%`),
          hoverinfo: 'text',
        },
        // Fail points
        {
          x: failResults.map(r => r.originalValue),
          y: failResults.map(r => r.duplicateValue),
          type: 'scatter',
          mode: 'markers',
          name: 'Fail',
          marker: { color: '#f44336', size: 8 },
          text: failResults.map(r => `${r.originalId} / ${r.duplicateId}<br>RPD: ${r.rpd.toFixed(1)}%`),
          hoverinfo: 'text',
        },
        // 1:1 line
        {
          x: range,
          y: range,
          type: 'scatter',
          mode: 'lines',
          name: '1:1 Line',
          line: { color: '#1976d2', width: 2, dash: 'dash' },
          hoverinfo: 'skip',
        },
        // Upper threshold envelope (e.g., +30% for field duplicates)
        {
          x: range,
          y: range.map(v => v * (1 + currentAnalysis.threshold / 100)),
          type: 'scatter',
          mode: 'lines',
          name: `+${currentAnalysis.threshold}%`,
          line: { color: '#ff9800', width: 1, dash: 'dot' },
          hoverinfo: 'skip',
        },
        // Lower threshold envelope
        {
          x: range,
          y: range.map(v => v * (1 - currentAnalysis.threshold / 100)),
          type: 'scatter',
          mode: 'lines',
          name: `-${currentAnalysis.threshold}%`,
          line: { color: '#ff9800', width: 1, dash: 'dot' },
          hoverinfo: 'skip',
        },
      ];

      layout = {
        title: { text: `${currentAnalysis.element} - Original vs Duplicate`, font: { size: 16 } },
        xaxis: { title: 'Original Value', range },
        yaxis: { title: 'Duplicate Value', range, scaleanchor: 'x', scaleratio: 1 },
        showlegend: true,
        legend: { orientation: 'h', y: -0.2, x: 0.5, xanchor: 'center' },
        autosize: true,
        height: 450,
        margin: { l: 60, r: 30, t: 50, b: 80 },
      };
    } else if (plotType === 'rpd') {
      // RPD vs Mean plot
      const passResults = currentAnalysis.results.filter(r => r.status === 'pass');
      const failResults = currentAnalysis.results.filter(r => r.status === 'fail');

      traces = [
        {
          x: passResults.map(r => r.mean),
          y: passResults.map(r => r.rpd),
          type: 'scatter',
          mode: 'markers',
          name: 'Pass',
          marker: { color: '#4caf50', size: 8 },
          text: passResults.map(r => `${r.originalId} / ${r.duplicateId}`),
          hoverinfo: 'text+y',
        },
        {
          x: failResults.map(r => r.mean),
          y: failResults.map(r => r.rpd),
          type: 'scatter',
          mode: 'markers',
          name: 'Fail',
          marker: { color: '#f44336', size: 8 },
          text: failResults.map(r => `${r.originalId} / ${r.duplicateId}`),
          hoverinfo: 'text+y',
        },
        // Threshold line
        {
          x: [0, Math.max(...currentAnalysis.results.map(r => r.mean)) * 1.1],
          y: [currentAnalysis.threshold, currentAnalysis.threshold],
          type: 'scatter',
          mode: 'lines',
          name: `Threshold (${currentAnalysis.threshold}%)`,
          line: { color: '#f44336', width: 2, dash: 'dash' },
          hoverinfo: 'skip',
        },
      ];

      layout = {
        title: { text: `${currentAnalysis.element} - RPD vs Mean`, font: { size: 16 } },
        xaxis: { title: 'Mean Value', type: 'log' },
        yaxis: { title: 'RPD (%)', rangemode: 'tozero' },
        showlegend: true,
        legend: { orientation: 'h', y: -0.2, x: 0.5, xanchor: 'center' },
        autosize: true,
        height: 450,
        margin: { l: 60, r: 30, t: 50, b: 80 },
      };
    } else if (plotType === 'histogram') {
      // RPD histogram
      traces = [
        {
          x: currentAnalysis.results.map(r => r.rpd),
          type: 'histogram',
          name: 'RPD Distribution',
          marker: { color: '#1976d2' },
          nbinsx: 20,
        },
        // Vertical line at threshold
        {
          x: [currentAnalysis.threshold, currentAnalysis.threshold],
          y: [0, currentAnalysis.results.length],
          type: 'scatter',
          mode: 'lines',
          name: `Threshold (${currentAnalysis.threshold}%)`,
          line: { color: '#f44336', width: 2, dash: 'dash' },
          hoverinfo: 'skip',
        },
      ];

      layout = {
        title: { text: `${currentAnalysis.element} - RPD Distribution`, font: { size: 16 } },
        xaxis: { title: 'RPD (%)' },
        yaxis: { title: 'Count' },
        showlegend: true,
        legend: { orientation: 'h', y: -0.2, x: 0.5, xanchor: 'center' },
        autosize: true,
        height: 400,
        margin: { l: 60, r: 30, t: 50, b: 80 },
        bargap: 0.1,
      };
    }

    return { traces, layout };
  }, [currentAnalysis, plotType]);

  // Get summary by type
  const typeSummary = useMemo(() => {
    const summary: Record<string, { count: number; passRate: number; meanRPD: number }> = {};

    Object.entries(duplicateAnalyses).forEach(([type, analyses]) => {
      const analysis = analyses.find(a => a.element === selectedElement);
      if (analysis) {
        summary[type] = {
          count: analysis.results.length,
          passRate: analysis.passRate,
          meanRPD: analysis.meanRPD,
        };
      }
    });

    return summary;
  }, [duplicateAnalyses, selectedElement]);

  if (Object.keys(duplicateAnalyses).length === 0) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="info">
          No duplicate analysis data available. Please run QA/QC analysis first.
        </Alert>
      </Box>
    );
  }

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'field_duplicate': return 'Field Duplicates';
      case 'pulp_duplicate': return 'Pulp Duplicates';
      case 'core_duplicate': return 'Core Duplicates';
      default: return type;
    }
  };

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h5" gutterBottom>
        Duplicate Analysis
      </Typography>

      {/* Controls */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Grid container spacing={2} alignItems="center">
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
            <FormControl fullWidth size="small">
              <InputLabel>Duplicate Type</InputLabel>
              <Select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value as DuplicateTypeFilter)}
                label="Duplicate Type"
              >
                <MenuItem value="all">All Types</MenuItem>
                {availableTypes.map((type) => (
                  <MenuItem key={type} value={type}>
                    {getTypeLabel(type)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>

          <Grid item xs={12} sm={4}>
            <ToggleButtonGroup
              value={plotType}
              exclusive
              onChange={(_, value) => value && setPlotType(value)}
              size="small"
              fullWidth
            >
              <ToggleButton value="scatter">Scatter</ToggleButton>
              <ToggleButton value="rpd">RPD Plot</ToggleButton>
              <ToggleButton value="histogram">Histogram</ToggleButton>
            </ToggleButtonGroup>
          </Grid>
        </Grid>
      </Paper>

      {/* Chart */}
      {currentAnalysis && (
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
                    Precision Statistics
                  </Typography>
                  <Grid container spacing={1}>
                    <Grid item xs={6}>
                      <Typography variant="body2" color="text.secondary">
                        Mean RPD:
                      </Typography>
                      <Typography variant="body1">
                        {currentAnalysis.meanRPD.toFixed(1)}%
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="body2" color="text.secondary">
                        Median RPD:
                      </Typography>
                      <Typography variant="body1">
                        {currentAnalysis.medianRPD.toFixed(1)}%
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="body2" color="text.secondary">
                        Threshold:
                      </Typography>
                      <Typography variant="body1">
                        {currentAnalysis.threshold}%
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="body2" color="text.secondary">
                        Precision (1σ):
                      </Typography>
                      <Typography variant="body1">
                        ±{currentAnalysis.precision.toFixed(1)}%
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
                      label={`Pass: ${currentAnalysis.passCount}`}
                      color="success"
                      size="small"
                    />
                    <Chip
                      icon={<ErrorIcon />}
                      label={`Fail: ${currentAnalysis.failCount}`}
                      color="error"
                      size="small"
                    />
                  </Box>

                  <Typography variant="body2" gutterBottom>
                    Pass Rate: {currentAnalysis.passRate.toFixed(1)}%
                  </Typography>

                  {currentAnalysis.passRate >= 90 ? (
                    <Alert severity="success" sx={{ mt: 1 }}>
                      Duplicate precision is acceptable
                    </Alert>
                  ) : currentAnalysis.passRate >= 70 ? (
                    <Alert severity="warning" sx={{ mt: 1 }}>
                      Marginal duplicate precision - review outliers
                    </Alert>
                  ) : (
                    <Alert severity="error" sx={{ mt: 1 }}>
                      Poor duplicate precision - investigate sampling/preparation
                    </Alert>
                  )}
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          {/* Type breakdown */}
          {selectedType === 'all' && Object.keys(typeSummary).length > 1 && (
            <Paper sx={{ p: 2, mt: 2 }}>
              <Typography variant="h6" gutterBottom>
                By Duplicate Type
              </Typography>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Type</TableCell>
                      <TableCell align="center">Pairs</TableCell>
                      <TableCell align="center">Pass Rate</TableCell>
                      <TableCell align="center">Mean RPD</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {Object.entries(typeSummary).map(([type, stats]) => (
                      <TableRow key={type}>
                        <TableCell>{getTypeLabel(type)}</TableCell>
                        <TableCell align="center">{stats.count}</TableCell>
                        <TableCell align="center">
                          <Chip
                            label={`${stats.passRate.toFixed(0)}%`}
                            color={stats.passRate >= 90 ? 'success' : stats.passRate >= 70 ? 'warning' : 'error'}
                            size="small"
                          />
                        </TableCell>
                        <TableCell align="center">{stats.meanRPD.toFixed(1)}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          )}
        </>
      )}
    </Box>
  );
};

export default DuplicateAnalysis;
