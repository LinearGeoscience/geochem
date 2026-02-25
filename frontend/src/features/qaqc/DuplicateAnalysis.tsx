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
import { DuplicateAnalysis as DuplicateAnalysisType, DuplicateResult } from '../../types/qaqc';
import { thompsonHowarthAnalysis, calculateHARD } from '../../utils/qaqcCalculations';
import { ExpandablePlotWrapper } from '../../components/ExpandablePlotWrapper';

type DuplicateTypeFilter = 'field_duplicate' | 'pulp_duplicate' | 'core_duplicate' | 'all';
type PlotType = 'scatter' | 'rpd' | 'histogram' | 'hard' | 'thompson_howarth';

export const DuplicateAnalysis: React.FC = () => {
  const { duplicateAnalyses, thresholds, navigateToElement, setNavigateToElement } = useQAQCStore();

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

  // Dashboard drill-down: pre-select element from navigation
  React.useEffect(() => {
    if (navigateToElement && availableElements.includes(navigateToElement)) {
      setSelectedElement(navigateToElement);
      setNavigateToElement(null);
    }
  }, [navigateToElement, availableElements, setNavigateToElement]);

  // Auto-select first element
  React.useEffect(() => {
    if (availableElements.length > 0 && !availableElements.includes(selectedElement)) {
      setSelectedElement(availableElements[0]);
    }
  }, [availableElements, selectedElement]);

  // Get current analysis data
  // Fix 1.4: "All" view preserves per-result original pass/fail status from each type's threshold
  const currentAnalysis = useMemo((): DuplicateAnalysisType | null => {
    if (!selectedElement) return null;

    if (selectedType === 'all') {
      // Combine all duplicate types for this element, preserving original pass/fail
      const allResults: DuplicateResult[] = [];
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

      // For "all" view, use the field threshold as display reference only
      // Individual results retain their per-type pass/fail status
      const differences = allResults.map(r => r.originalValue - r.duplicateValue);
      const sumSquaredDiffs = differences.reduce((sum, d) => sum + d * d, 0);
      const absolutePrecision = Math.sqrt(sumSquaredDiffs / (2 * allResults.length));
      const overallMean = allResults.reduce((sum, r) => sum + r.mean, 0) / allResults.length;
      const relativePrecision = overallMean !== 0 ? (absolutePrecision / overallMean) * 100 : 0;

      return {
        element: selectedElement,
        duplicateType: 'field_duplicate', // Display placeholder
        threshold: thresholds.fieldDuplicateRPD, // Display reference only
        results: allResults,
        passCount: totalPass,
        failCount: totalFail,
        passRate: (totalPass / allResults.length) * 100,
        meanRPD,
        medianRPD,
        precision: meanRPD / 2,
        absolutePrecision,
        relativePrecision,
      };
    }

    const analyses = duplicateAnalyses[selectedType];
    if (!analyses) return null;
    return analyses.find(a => a.element === selectedElement) || null;
  }, [selectedElement, selectedType, duplicateAnalyses, thresholds]);

  // Collect per-type thresholds for "all" view envelope lines
  const typeThresholds = useMemo(() => {
    const result: { type: string; threshold: number; label: string }[] = [];
    if (duplicateAnalyses['field_duplicate']?.length) {
      result.push({ type: 'field_duplicate', threshold: thresholds.fieldDuplicateRPD, label: 'Field' });
    }
    if (duplicateAnalyses['pulp_duplicate']?.length) {
      result.push({ type: 'pulp_duplicate', threshold: thresholds.pulpDuplicateRPD, label: 'Pulp' });
    }
    if (duplicateAnalyses['core_duplicate']?.length) {
      result.push({ type: 'core_duplicate', threshold: thresholds.coreDuplicateRPD, label: 'Core' });
    }
    return result;
  }, [duplicateAnalyses, thresholds]);

  // Build Plotly traces
  const { traces, layout } = useMemo(() => {
    if (!currentAnalysis || currentAnalysis.results.length === 0) {
      return { traces: [], layout: {} };
    }

    let traces: any[] = [];
    let layout: any = {};

    // Separate BDL results for gray markers (Feature 2.2)
    const bdlResults = currentAnalysis.results.filter(r => r.belowDetection);
    const normalResults = currentAnalysis.results.filter(r => !r.belowDetection);
    const passResults = normalResults.filter(r => r.status === 'pass');
    const failResults = normalResults.filter(r => r.status === 'fail');

    if (plotType === 'scatter') {
      // Scatter plot: Original vs Duplicate
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
        // BDL points (Feature 2.2)
        ...(bdlResults.length > 0 ? [{
          x: bdlResults.map(r => r.originalValue),
          y: bdlResults.map(r => r.duplicateValue),
          type: 'scatter' as const,
          mode: 'markers' as const,
          name: 'Below DL',
          marker: { color: '#bdbdbd', size: 7, symbol: 'diamond' },
          text: bdlResults.map(r => `${r.originalId} / ${r.duplicateId}<br>RPD: ${r.rpd.toFixed(1)}%<br>(Below detection)`),
          hoverinfo: 'text',
        }] : []),
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
      ];

      // Fix 1.8: Correct RPD envelope formula: y = x*(2+t)/(2-t) and y = x*(2-t)/(2+t)
      // Fix 1.4: In "all" view, draw envelopes for each type present
      const envelopeColors = ['#ff9800', '#9c27b0', '#00bcd4'];
      const envelopesToDraw = selectedType === 'all'
        ? typeThresholds
        : [{ type: selectedType, threshold: currentAnalysis.threshold, label: '' }];

      envelopesToDraw.forEach(({ threshold, label }, idx) => {
        const t = threshold / 100; // Convert to fraction
        const color = selectedType === 'all' ? (envelopeColors[idx] || '#ff9800') : '#ff9800';
        const suffix = label ? ` (${label})` : '';
        traces.push(
          // Upper RPD envelope
          {
            x: range,
            y: range.map((v: number) => v * (2 + t) / (2 - t)),
            type: 'scatter',
            mode: 'lines',
            name: `+${threshold}% RPD${suffix}`,
            line: { color, width: 1, dash: 'dot' },
            hoverinfo: 'skip',
          },
          // Lower RPD envelope
          {
            x: range,
            y: range.map((v: number) => v * (2 - t) / (2 + t)),
            type: 'scatter',
            mode: 'lines',
            name: `-${threshold}% RPD${suffix}`,
            line: { color, width: 1, dash: 'dot' },
            showlegend: false,
            hoverinfo: 'skip',
          }
        );
      });

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
      // Fix 1.3: Conditional log scale for RPD plot
      const allMeans = currentAnalysis.results.map(r => r.mean);
      const allPositive = allMeans.every(v => v > 0);

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
        ...(bdlResults.length > 0 ? [{
          x: bdlResults.map(r => r.mean),
          y: bdlResults.map(r => r.rpd),
          type: 'scatter' as const,
          mode: 'markers' as const,
          name: 'Below DL',
          marker: { color: '#bdbdbd', size: 7, symbol: 'diamond' },
          text: bdlResults.map(r => `${r.originalId} / ${r.duplicateId}<br>(Below detection)`),
          hoverinfo: 'text+y',
        }] : []),
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
        xaxis: { title: 'Mean Value', type: allPositive ? 'log' : 'linear' },
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
    } else if (plotType === 'hard') {
      // Feature 2.4: HARD plot visualization
      const hardValues = currentAnalysis.results.map(r =>
        calculateHARD(r.originalValue, r.duplicateValue)
      );
      const hardThreshold = currentAnalysis.threshold / 2;
      const allMeans = currentAnalysis.results.map(r => r.mean);
      const allPositive = allMeans.every(v => v > 0);

      traces = [
        {
          x: currentAnalysis.results.map(r => r.mean),
          y: hardValues,
          type: 'scatter',
          mode: 'markers',
          name: 'HARD',
          marker: {
            color: hardValues.map(h => h <= hardThreshold ? '#4caf50' : '#f44336'),
            size: 8,
          },
          text: currentAnalysis.results.map((r, i) =>
            `${r.originalId} / ${r.duplicateId}<br>HARD: ${hardValues[i].toFixed(1)}%`
          ),
          hoverinfo: 'text',
        },
        // Threshold line
        {
          x: [0, Math.max(...allMeans) * 1.1],
          y: [hardThreshold, hardThreshold],
          type: 'scatter',
          mode: 'lines',
          name: `Threshold (${hardThreshold}%)`,
          line: { color: '#f44336', width: 2, dash: 'dash' },
          hoverinfo: 'skip',
        },
      ];

      layout = {
        title: { text: `${currentAnalysis.element} - HARD Plot`, font: { size: 16 } },
        xaxis: { title: 'Mean Value', type: allPositive ? 'log' : 'linear' },
        yaxis: { title: 'HARD (%)', rangemode: 'tozero' },
        showlegend: true,
        legend: { orientation: 'h', y: -0.2, x: 0.5, xanchor: 'center' },
        autosize: true,
        height: 450,
        margin: { l: 60, r: 30, t: 50, b: 80 },
      };
    } else if (plotType === 'thompson_howarth') {
      // Feature 2.3: Thompson-Howarth precision analysis
      const thResult = thompsonHowarthAnalysis(currentAnalysis.results);

      if (thResult && thResult.bins.length > 0) {
        traces = [
          // Bin points
          {
            x: thResult.bins.map(b => b.meanConcentration),
            y: thResult.bins.map(b => b.precision),
            type: 'scatter',
            mode: 'markers',
            name: 'Binned Precision',
            marker: { color: '#1976d2', size: 10 },
            text: thResult.bins.map(b =>
              `Conc: ${b.meanConcentration.toFixed(2)}<br>Precision: ${b.precision.toFixed(3)}<br>n=${b.pairCount}`
            ),
            hoverinfo: 'text',
          },
        ];

        // Regression line
        if (thResult.r2 > 0) {
          const xMin = Math.min(...thResult.bins.map(b => b.meanConcentration));
          const xMax = Math.max(...thResult.bins.map(b => b.meanConcentration));
          const xLine = Array.from({ length: 50 }, (_, i) =>
            Math.pow(10, Math.log10(xMin) + i * (Math.log10(xMax) - Math.log10(xMin)) / 49)
          );
          const yLine = xLine.map(x =>
            Math.pow(10, thResult.slope * Math.log10(x) + thResult.intercept)
          );

          traces.push({
            x: xLine,
            y: yLine,
            type: 'scatter',
            mode: 'lines',
            name: `Fit (R²=${thResult.r2.toFixed(3)})`,
            line: { color: '#f44336', width: 2 },
            hoverinfo: 'skip',
          });
        }

        layout = {
          title: { text: `${currentAnalysis.element} - Thompson-Howarth Precision`, font: { size: 16 } },
          xaxis: { title: 'Concentration', type: 'log' },
          yaxis: { title: 'Precision (1σ)', type: 'log' },
          showlegend: true,
          legend: { orientation: 'h', y: -0.2, x: 0.5, xanchor: 'center' },
          autosize: true,
          height: 450,
          margin: { l: 60, r: 30, t: 50, b: 80 },
        };
      } else {
        // Not enough data
        traces = [];
        layout = {
          title: { text: `${currentAnalysis.element} - Insufficient data for Thompson-Howarth`, font: { size: 16 } },
          annotations: [{
            text: 'Need at least 6 non-BDL pairs',
            xref: 'paper', yref: 'paper',
            x: 0.5, y: 0.5,
            showarrow: false,
            font: { size: 16, color: '#666' },
          }],
          autosize: true,
          height: 450,
          margin: { l: 60, r: 30, t: 50, b: 80 },
        };
      }
    }

    return { traces, layout };
  }, [currentAnalysis, plotType, selectedType, typeThresholds]);

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
              sx={{ flexWrap: 'wrap' }}
            >
              <ToggleButton value="scatter">Scatter</ToggleButton>
              <ToggleButton value="rpd">RPD</ToggleButton>
              <ToggleButton value="histogram">Hist</ToggleButton>
              <ToggleButton value="hard">HARD</ToggleButton>
              <ToggleButton value="thompson_howarth">T-H</ToggleButton>
            </ToggleButtonGroup>
          </Grid>
        </Grid>
      </Paper>

      {/* Chart */}
      {currentAnalysis && (
        <>
          <Paper sx={{ p: 2, mb: 2 }}>
            <ExpandablePlotWrapper>
              <Plot
                data={traces}
                layout={layout}
                config={{ displayModeBar: true, displaylogo: false, responsive: true }}
                style={{ width: '100%' }}
                useResizeHandler={true}
              />
            </ExpandablePlotWrapper>
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
                        ±{currentAnalysis.absolutePrecision?.toFixed(3) ?? currentAnalysis.precision.toFixed(1) + '%'}
                        {currentAnalysis.relativePrecision != null && (
                          <Typography variant="caption" color="text.secondary" component="span">
                            {' '}({currentAnalysis.relativePrecision.toFixed(1)}% rel.)
                          </Typography>
                        )}
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
