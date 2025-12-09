/**
 * Blank Analysis Component
 * Visualization and analysis of blank samples for contamination detection
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
  TextField,
} from '@mui/material';
import {
  CheckCircle as CheckIcon,
  Warning as WarningIcon,
  Error as ErrorIcon,
} from '@mui/icons-material';
import { useQAQCStore } from '../../store/qaqcStore';
import { BlankAnalysis as BlankAnalysisType } from '../../types/qaqc';

type PlotType = 'sequence' | 'histogram' | 'boxplot';

export const BlankAnalysis: React.FC = () => {
  const {
    blankAnalyses,
    detectionLimits,
    setDetectionLimit,
    thresholds,
  } = useQAQCStore();

  const [selectedElement, setSelectedElement] = useState<string>('');
  const [plotType, setPlotType] = useState<PlotType>('sequence');

  // Get available elements
  const availableElements = useMemo(() =>
    blankAnalyses.map(a => a.element).sort(),
    [blankAnalyses]
  );

  // Auto-select first element
  React.useEffect(() => {
    if (availableElements.length > 0 && !availableElements.includes(selectedElement)) {
      setSelectedElement(availableElements[0]);
    }
  }, [availableElements, selectedElement]);

  // Get current analysis data
  const currentAnalysis = useMemo((): BlankAnalysisType | null => {
    return blankAnalyses.find(a => a.element === selectedElement) || null;
  }, [selectedElement, blankAnalyses]);

  // Build Plotly traces
  const { traces, layout } = useMemo(() => {
    if (!currentAnalysis || currentAnalysis.results.length === 0) {
      return { traces: [], layout: {} };
    }

    let traces: any[] = [];
    let layout: any = {};

    if (plotType === 'sequence') {
      // Sequence plot - blank values over time
      const cleanResults = currentAnalysis.results.filter(r => r.status === 'clean');
      const elevatedResults = currentAnalysis.results.filter(r => r.status === 'elevated');
      const contaminatedResults = currentAnalysis.results.filter(r => r.status === 'contaminated');

      traces = [
        // Clean blanks
        {
          x: cleanResults.map(r => r.index + 1),
          y: cleanResults.map(r => r.value),
          type: 'scatter',
          mode: 'markers',
          name: 'Clean',
          marker: { color: '#4caf50', size: 10 },
          text: cleanResults.map(r => `${r.sampleId}<br>Value: ${r.value.toFixed(4)}`),
          hoverinfo: 'text',
        },
        // Elevated blanks
        {
          x: elevatedResults.map(r => r.index + 1),
          y: elevatedResults.map(r => r.value),
          type: 'scatter',
          mode: 'markers',
          name: 'Elevated',
          marker: { color: '#ff9800', size: 10 },
          text: elevatedResults.map(r =>
            `${r.sampleId}<br>Value: ${r.value.toFixed(4)}${r.multipleOfDL ? `<br>${r.multipleOfDL.toFixed(1)}× DL` : ''}`
          ),
          hoverinfo: 'text',
        },
        // Contaminated blanks
        {
          x: contaminatedResults.map(r => r.index + 1),
          y: contaminatedResults.map(r => r.value),
          type: 'scatter',
          mode: 'markers',
          name: 'Contaminated',
          marker: { color: '#f44336', size: 10 },
          text: contaminatedResults.map(r =>
            `${r.sampleId}<br>Value: ${r.value.toFixed(4)}${r.multipleOfDL ? `<br>${r.multipleOfDL.toFixed(1)}× DL` : ''}${r.precedingSampleId ? `<br>After: ${r.precedingSampleId}` : ''}`
          ),
          hoverinfo: 'text',
        },
      ];

      // Add threshold lines if DL is defined
      if (currentAnalysis.detectionLimit) {
        const dl = currentAnalysis.detectionLimit;
        const xRange = [0, currentAnalysis.results.length + 1];

        traces.push(
          // Detection Limit
          {
            x: xRange,
            y: [dl, dl],
            type: 'scatter',
            mode: 'lines',
            name: 'Detection Limit',
            line: { color: '#1976d2', width: 1, dash: 'solid' },
            hoverinfo: 'skip',
          },
          // Elevated threshold (5× DL)
          {
            x: xRange,
            y: [dl * thresholds.blankElevatedMultiple, dl * thresholds.blankElevatedMultiple],
            type: 'scatter',
            mode: 'lines',
            name: `${thresholds.blankElevatedMultiple}× DL (Elevated)`,
            line: { color: '#ff9800', width: 1.5, dash: 'dash' },
            hoverinfo: 'skip',
          },
          // Contaminated threshold (10× DL)
          {
            x: xRange,
            y: [dl * thresholds.blankContaminatedMultiple, dl * thresholds.blankContaminatedMultiple],
            type: 'scatter',
            mode: 'lines',
            name: `${thresholds.blankContaminatedMultiple}× DL (Contaminated)`,
            line: { color: '#f44336', width: 1.5, dash: 'dot' },
            hoverinfo: 'skip',
          }
        );
      }

      layout = {
        title: { text: `${currentAnalysis.element} - Blank Values`, font: { size: 16 } },
        xaxis: { title: 'Blank Sequence' },
        yaxis: { title: currentAnalysis.element, type: 'log' },
        showlegend: true,
        legend: { orientation: 'h', y: -0.2, x: 0.5, xanchor: 'center' },
        autosize: true,
        height: 400,
        margin: { l: 60, r: 30, t: 50, b: 80 },
      };
    } else if (plotType === 'histogram') {
      // Histogram of blank values
      traces = [
        {
          x: currentAnalysis.results.map(r => r.value),
          type: 'histogram',
          name: 'Blank Values',
          marker: { color: '#1976d2' },
          nbinsx: Math.min(20, currentAnalysis.results.length),
        },
      ];

      // Add vertical lines for thresholds
      if (currentAnalysis.detectionLimit) {
        const dl = currentAnalysis.detectionLimit;
        const maxCount = currentAnalysis.results.length;

        traces.push(
          {
            x: [dl, dl],
            y: [0, maxCount],
            type: 'scatter',
            mode: 'lines',
            name: 'DL',
            line: { color: '#1976d2', width: 2, dash: 'solid' },
            hoverinfo: 'skip',
          },
          {
            x: [dl * thresholds.blankElevatedMultiple, dl * thresholds.blankElevatedMultiple],
            y: [0, maxCount],
            type: 'scatter',
            mode: 'lines',
            name: `${thresholds.blankElevatedMultiple}× DL`,
            line: { color: '#ff9800', width: 2, dash: 'dash' },
            hoverinfo: 'skip',
          },
          {
            x: [dl * thresholds.blankContaminatedMultiple, dl * thresholds.blankContaminatedMultiple],
            y: [0, maxCount],
            type: 'scatter',
            mode: 'lines',
            name: `${thresholds.blankContaminatedMultiple}× DL`,
            line: { color: '#f44336', width: 2, dash: 'dot' },
            hoverinfo: 'skip',
          }
        );
      }

      layout = {
        title: { text: `${currentAnalysis.element} - Blank Distribution`, font: { size: 16 } },
        xaxis: { title: currentAnalysis.element },
        yaxis: { title: 'Count' },
        showlegend: true,
        legend: { orientation: 'h', y: -0.2, x: 0.5, xanchor: 'center' },
        autosize: true,
        height: 400,
        margin: { l: 60, r: 30, t: 50, b: 80 },
        bargap: 0.1,
      };
    } else if (plotType === 'boxplot') {
      // Box plot
      traces = [
        {
          y: currentAnalysis.results.map(r => r.value),
          type: 'box',
          name: currentAnalysis.element,
          marker: { color: '#1976d2' },
          boxpoints: 'all',
          jitter: 0.3,
          pointpos: 0,
        },
      ];

      layout = {
        title: { text: `${currentAnalysis.element} - Blank Box Plot`, font: { size: 16 } },
        yaxis: { title: currentAnalysis.element },
        showlegend: false,
        autosize: true,
        height: 400,
        margin: { l: 60, r: 30, t: 50, b: 40 },
      };
    }

    return { traces, layout };
  }, [currentAnalysis, plotType, thresholds]);

  // Get status icon
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'clean': return <CheckIcon color="success" fontSize="small" />;
      case 'elevated': return <WarningIcon color="warning" fontSize="small" />;
      case 'contaminated': return <ErrorIcon color="error" fontSize="small" />;
      default: return null;
    }
  };

  if (blankAnalyses.length === 0) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="info">
          No blank analysis data available. Please run QA/QC analysis first.
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h5" gutterBottom>
        Blank Analysis
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
            <TextField
              label="Detection Limit"
              type="number"
              size="small"
              fullWidth
              value={detectionLimits[selectedElement] || ''}
              onChange={(e) => {
                const val = Number(e.target.value);
                if (val > 0) setDetectionLimit(selectedElement, val);
              }}
              placeholder="Enter DL"
              InputProps={{
                inputProps: { min: 0, step: 'any' }
              }}
            />
          </Grid>

          <Grid item xs={12} sm={4}>
            <ToggleButtonGroup
              value={plotType}
              exclusive
              onChange={(_, value) => value && setPlotType(value)}
              size="small"
              fullWidth
            >
              <ToggleButton value="sequence">Sequence</ToggleButton>
              <ToggleButton value="histogram">Histogram</ToggleButton>
              <ToggleButton value="boxplot">Box Plot</ToggleButton>
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
                    Statistics
                  </Typography>
                  <Grid container spacing={1}>
                    <Grid item xs={6}>
                      <Typography variant="body2" color="text.secondary">
                        Mean Value:
                      </Typography>
                      <Typography variant="body1">
                        {currentAnalysis.meanValue.toFixed(4)}
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="body2" color="text.secondary">
                        Max Value:
                      </Typography>
                      <Typography variant="body1">
                        {currentAnalysis.maxValue.toFixed(4)}
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="body2" color="text.secondary">
                        Detection Limit:
                      </Typography>
                      <Typography variant="body1">
                        {currentAnalysis.detectionLimit?.toFixed(4) || 'Not set'}
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="body2" color="text.secondary">
                        Max Multiple of DL:
                      </Typography>
                      <Typography variant="body1">
                        {currentAnalysis.detectionLimit
                          ? `${(currentAnalysis.maxValue / currentAnalysis.detectionLimit).toFixed(1)}×`
                          : 'N/A'}
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
                      label={`Clean: ${currentAnalysis.cleanCount}`}
                      color="success"
                      size="small"
                    />
                    <Chip
                      icon={<WarningIcon />}
                      label={`Elevated: ${currentAnalysis.elevatedCount}`}
                      color="warning"
                      size="small"
                    />
                    <Chip
                      icon={<ErrorIcon />}
                      label={`Contaminated: ${currentAnalysis.contaminatedCount}`}
                      color="error"
                      size="small"
                    />
                  </Box>

                  <Typography variant="body2" gutterBottom>
                    Pass Rate: {((currentAnalysis.cleanCount / currentAnalysis.results.length) * 100).toFixed(1)}%
                  </Typography>

                  {currentAnalysis.contaminationEvents > 0 && (
                    <Alert severity="warning" sx={{ mt: 1 }}>
                      {currentAnalysis.contaminationEvents} contamination event(s) detected after high-grade samples
                    </Alert>
                  )}

                  {currentAnalysis.contaminatedCount === 0 && currentAnalysis.elevatedCount === 0 ? (
                    <Alert severity="success" sx={{ mt: 1 }}>
                      All blanks are clean - no contamination detected
                    </Alert>
                  ) : currentAnalysis.contaminatedCount === 0 ? (
                    <Alert severity="info" sx={{ mt: 1 }}>
                      Some elevated blanks detected - monitor for trends
                    </Alert>
                  ) : (
                    <Alert severity="error" sx={{ mt: 1 }}>
                      Contamination detected - review sample preparation
                    </Alert>
                  )}
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          {/* Detailed table for contaminated/elevated blanks */}
          {(currentAnalysis.contaminatedCount > 0 || currentAnalysis.elevatedCount > 0) && (
            <Paper sx={{ p: 2, mt: 2 }}>
              <Typography variant="h6" gutterBottom>
                Flagged Blanks
              </Typography>
              <TableContainer sx={{ maxHeight: 300 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>Status</TableCell>
                      <TableCell>Sample ID</TableCell>
                      <TableCell align="right">Value</TableCell>
                      <TableCell align="right">× DL</TableCell>
                      <TableCell>Preceding Sample</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {currentAnalysis.results
                      .filter(r => r.status !== 'clean')
                      .sort((a, b) => (b.multipleOfDL || 0) - (a.multipleOfDL || 0))
                      .map((result) => (
                        <TableRow key={result.index}>
                          <TableCell>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              {getStatusIcon(result.status)}
                              <Typography variant="body2" sx={{ textTransform: 'capitalize' }}>
                                {result.status}
                              </Typography>
                            </Box>
                          </TableCell>
                          <TableCell>{result.sampleId}</TableCell>
                          <TableCell align="right">{result.value.toFixed(4)}</TableCell>
                          <TableCell align="right">
                            {result.multipleOfDL?.toFixed(1) || '-'}
                          </TableCell>
                          <TableCell>
                            {result.precedingSampleId ? (
                              <Typography variant="body2">
                                {result.precedingSampleId}
                                {result.precedingSampleValue && (
                                  <span style={{ color: '#666' }}>
                                    {' '}({result.precedingSampleValue.toFixed(2)})
                                  </span>
                                )}
                              </Typography>
                            ) : '-'}
                          </TableCell>
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

export default BlankAnalysis;
