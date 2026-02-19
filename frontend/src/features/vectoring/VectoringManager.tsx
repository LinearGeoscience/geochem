/**
 * Vectoring Manager Component
 * Comprehensive UI for deposit-specific geochemical vectoring analysis
 * With histogram visualizations and threshold lines for each indicator
 */

import React, { useState, useMemo, useCallback } from 'react';
import Plot from 'react-plotly.js';
import {
  Box, Paper, Typography, Button, Tabs, Tab, Alert, CircularProgress,
  Card, CardActionArea, Chip, Accordion, AccordionSummary,
  AccordionDetails, Table, TableHead, TableBody, TableRow, TableCell,
  Checkbox, IconButton, Tooltip, Snackbar,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import AddchartIcon from '@mui/icons-material/Addchart';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import { useAppStore } from '../../store/appStore';
import { useVectoringStore } from '../../store/vectoringStore';
import { DepositType, CalculatedIndicator } from '../../types/vectoring';
import { DEPOSIT_CONFIGS, VECTORING_INDICATORS, getDepositConfig } from '../../utils/depositVectoring';

// ============================================================================
// DEPOSIT CATEGORY GROUPINGS
// ============================================================================

const DEPOSIT_CATEGORIES: Record<string, DepositType[]> = {
  'Gold Systems': ['orogenic-gold', 'carlin-gold', 'irgs', 'epithermal-hs', 'epithermal-ls'],
  'Porphyry & IOCG': ['porphyry-cu-au', 'porphyry-cu-mo', 'iocg', 'skarn'],
  'Mafic-Ultramafic Ni-Cu-PGE': ['ni-cu-pge-intrusion', 'komatiite-ni'],
  'VMS & Sediment-Hosted': ['vms', 'sedex', 'mvt'],
  'Critical Minerals': ['lct-pegmatite', 'sn-w-greisen', 'carbonatite-ree', 'uranium-rollfront']
};

// ============================================================================
// CSV DOWNLOAD HELPER
// ============================================================================

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

function downloadText(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ============================================================================
// INDICATOR HISTOGRAM COMPONENT
// ============================================================================

interface IndicatorHistogramProps {
  indicator: CalculatedIndicator;
  thresholds: { value: number; color: string; label: string }[];
  onSaveToTable: (indicator: CalculatedIndicator) => void;
}

const IndicatorHistogram: React.FC<IndicatorHistogramProps> = ({ indicator, thresholds, onSaveToTable }) => {
  const validValues = indicator.values.filter((v): v is number => v !== null && !isNaN(v));

  if (validValues.length === 0) {
    return (
      <Paper sx={{ p: 2.5, textAlign: 'center', bgcolor: 'grey.50' }}>
        <Typography variant="body2" color="text.secondary">
          No valid data for {indicator.name}
        </Typography>
      </Paper>
    );
  }

  // Manual binning for proper per-bin coloring
  const binCount = Math.min(30, Math.ceil(Math.sqrt(validValues.length)));
  const min = Math.min(...validValues);
  const max = Math.max(...validValues);
  const binWidth = (max - min) / binCount || 1;

  const bins: { start: number; end: number; count: number; color: string }[] = [];
  for (let i = 0; i < binCount; i++) {
    const start = min + i * binWidth;
    const end = i === binCount - 1 ? max + 0.001 : min + (i + 1) * binWidth;
    const midpoint = (start + end) / 2;

    // Count values in this bin
    const count = validValues.filter(v => v >= start && v < end).length;

    // Determine bin color from threshold at midpoint
    const sortedThresholds = [...thresholds].sort((a, b) => a.value - b.value);
    let color = '#94a3b8'; // default gray
    for (let j = sortedThresholds.length - 1; j >= 0; j--) {
      if (midpoint >= sortedThresholds[j].value) {
        color = sortedThresholds[j].color;
        break;
      }
    }

    bins.push({ start, end, count, color });
  }

  // Threshold shapes (vertical dashed lines)
  const shapes = thresholds.map(t => ({
    type: 'line' as const,
    x0: t.value,
    x1: t.value,
    y0: 0,
    y1: 1,
    yref: 'paper' as const,
    line: { color: t.color, width: 2, dash: 'dash' as const }
  }));

  // Stagger annotations to prevent overlap
  const annotations = thresholds.map((t, idx) => ({
    x: t.value,
    y: 1,
    yref: 'paper' as const,
    yshift: idx % 2 === 0 ? 8 : 24,
    text: t.label,
    showarrow: false,
    font: { size: 10, color: t.color },
    yanchor: 'bottom' as const,
    textangle: '-45' as any
  }));

  return (
    <Paper sx={{ mb: 2, overflow: 'hidden' }}>
      {/* Header with stats */}
      <Box sx={{ p: '12px 16px', borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'grey.50', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, fontSize: '15px' }}>
            {indicator.name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {indicator.statistics.validCount} valid samples
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Box sx={{ display: 'flex', gap: 2, fontSize: '12px' }}>
            <Typography variant="caption"><Typography component="span" variant="caption" color="text.secondary">Min:</Typography> <strong>{indicator.statistics.min.toFixed(2)}</strong></Typography>
            <Typography variant="caption"><Typography component="span" variant="caption" color="text.secondary">Max:</Typography> <strong>{indicator.statistics.max.toFixed(2)}</strong></Typography>
            <Typography variant="caption"><Typography component="span" variant="caption" color="text.secondary">Mean:</Typography> <strong>{indicator.statistics.mean.toFixed(2)}</strong></Typography>
            <Typography variant="caption"><Typography component="span" variant="caption" color="text.secondary">Median:</Typography> <strong>{indicator.statistics.median.toFixed(2)}</strong></Typography>
          </Box>
          <Tooltip title="Save indicator values as a new column in the data table">
            <IconButton size="small" onClick={() => onSaveToTable(indicator)}>
              <AddchartIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Bar chart with manual bins for proper coloring */}
      <Plot
        data={[{
          x: bins.map(b => (b.start + b.end) / 2),
          y: bins.map(b => b.count),
          type: 'bar',
          width: bins.map(b => b.end - b.start),
          marker: {
            color: bins.map(b => b.color),
            line: { color: 'white', width: 1 }
          },
          hovertemplate: 'Range: %{x:.2f}<br>Count: %{y}<extra></extra>'
        } as any]}
        layout={{
          height: 200,
          margin: { t: 30, b: 40, l: 50, r: 20 },
          xaxis: { title: { text: indicator.name, font: { size: 11 } } },
          yaxis: { title: { text: 'Count', font: { size: 11 } } },
          shapes,
          annotations,
          showlegend: false,
          paper_bgcolor: 'white',
          plot_bgcolor: 'white',
          bargap: 0.05,
        }}
        config={{ responsive: true, displayModeBar: false }}
        style={{ width: '100%' }}
      />

      {/* Fertility distribution bar */}
      <Box sx={{ p: '12px 16px', borderTop: '1px solid', borderColor: 'divider' }}>
        <Typography variant="caption" color="text.secondary" sx={{ mb: 0.75, display: 'block' }}>
          Sample Classification
        </Typography>
        <Box sx={{ display: 'flex', height: 24, borderRadius: 1, overflow: 'hidden', bgcolor: 'grey.200' }}>
          {(() => {
            const veryHigh = indicator.fertility.filter(f => f === 'very-high').length;
            const high = indicator.fertility.filter(f => f === 'high').length;
            const mod = indicator.fertility.filter(f => f === 'moderate').length;
            const low = indicator.fertility.filter(f => f === 'low').length;
            const barren = indicator.fertility.filter(f => f === 'barren').length;
            const total = indicator.statistics.validCount;

            const segments = [
              { count: veryHigh, color: '#15803d', label: 'Very High' },
              { count: high, color: '#22c55e', label: 'High' },
              { count: mod, color: '#f59e0b', label: 'Moderate' },
              { count: low, color: '#94a3b8', label: 'Low' },
              { count: barren, color: '#ef4444', label: 'Barren' },
            ];

            return segments.filter(s => s.count > 0).map(s => (
              <Tooltip key={s.label} title={`${s.label}: ${s.count} samples (${((s.count / total) * 100).toFixed(0)}%)`}>
                <Box
                  sx={{
                    width: `${(s.count / total) * 100}%`,
                    bgcolor: s.color,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'white', fontSize: '10px'
                  }}
                >
                  {(s.count / total) * 100 > 10 && `${((s.count / total) * 100).toFixed(0)}%`}
                </Box>
              </Tooltip>
            ));
          })()}
        </Box>
        <Box sx={{ display: 'flex', gap: 1.5, mt: 0.5, fontSize: '10px', color: 'text.secondary' }}>
          {[
            { color: '#15803d', label: 'Very High' },
            { color: '#22c55e', label: 'High' },
            { color: '#f59e0b', label: 'Moderate' },
            { color: '#94a3b8', label: 'Low' },
            { color: '#ef4444', label: 'Barren' },
          ].map(item => (
            <Typography key={item.label} variant="caption" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ width: 8, height: 8, bgcolor: item.color, borderRadius: '2px', flexShrink: 0 }} />
              {item.label}
            </Typography>
          ))}
        </Box>
      </Box>
    </Paper>
  );
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const VectoringManager: React.FC = () => {
  const { data, columns, geochemMappings, addColumn } = useAppStore();
  const {
    selectedDepositType,
    currentResult,
    comparisonResults,
    isProcessing,
    error,
    activeTab,
    setSelectedDepositType,
    setActiveTab,
    runVectoring,
    runMultipleDepositTypes,
    clearError,
  } = useVectoringStore();

  const [selectedForComparison, setSelectedForComparison] = useState<DepositType[]>([]);
  const [expandedCategory, setExpandedCategory] = useState<string | null>('Gold Systems');
  const [snackbarMessage, setSnackbarMessage] = useState<string | null>(null);

  // Get column names
  const columnNames = useMemo(() => columns.map(c => c.name), [columns]);

  // Handle running analysis
  const handleRunAnalysis = useCallback(async () => {
    if (!selectedDepositType) return;
    await runVectoring(data, columnNames, geochemMappings);
  }, [selectedDepositType, data, columnNames, geochemMappings, runVectoring]);

  // Handle comparison analysis
  const handleRunComparison = useCallback(async () => {
    if (selectedForComparison.length < 2) return;
    await runMultipleDepositTypes(data, columnNames, selectedForComparison, geochemMappings);
  }, [selectedForComparison, data, columnNames, geochemMappings, runMultipleDepositTypes]);

  // Toggle deposit for comparison
  const toggleComparisonDeposit = (type: DepositType) => {
    setSelectedForComparison(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
  };

  // Save indicator to data table
  const handleSaveToTable = useCallback((indicator: CalculatedIndicator) => {
    const colName = `VEC_${indicator.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
    addColumn(colName, indicator.values, 'numeric', 'Calculated');
    setSnackbarMessage(`Saved "${indicator.name}" as column "${colName}"`);
  }, [addColumn]);

  // Export report
  const handleExportReport = useCallback(() => {
    if (!currentResult) return;
    const config = getDepositConfig(currentResult.depositType);

    // Summary text
    const lines: string[] = [
      `Vectoring Analysis Report`,
      `========================`,
      `Deposit Type: ${config?.name || currentResult.depositType}`,
      `Date: ${new Date().toISOString().split('T')[0]}`,
      `Samples Analyzed: ${currentResult.sampleCount}`,
      ``,
      `Overall Assessment: ${currentResult.summary.overallAssessment}`,
      ``,
      `Key Findings:`,
      ...currentResult.summary.keyFindings.map(f => `  - ${f}`),
      ``,
      `Recommendations:`,
      ...currentResult.summary.recommendations.map(r => `  - ${r}`),
    ];

    // Element availability
    lines.push('', 'Element Availability:');
    lines.push(`  Found: ${currentResult.elementAvailability.found.join(', ')}`);
    if (currentResult.elementAvailability.missing.length > 0) {
      lines.push(`  Missing: ${currentResult.elementAvailability.missing.join(', ')}`);
    }
    if (currentResult.missingIndicators.length > 0) {
      lines.push('', 'Skipped Indicators:');
      for (const mi of currentResult.missingIndicators) {
        lines.push(`  - ${mi.name}: missing ${mi.missingElements.join(', ')}`);
      }
    }

    downloadText(lines.join('\n'), `vectoring_report_${currentResult.depositType}.txt`);

    // Indicator statistics CSV
    if (currentResult.indicators.length > 0) {
      const csvHeader = 'Indicator,Min,Max,Mean,Median,Std Dev,Valid Count,% High+Very High';
      const csvRows = currentResult.indicators.map(ind => {
        const highPct = ind.statistics.validCount > 0
          ? ((ind.fertility.filter(f => f === 'high' || f === 'very-high').length / ind.statistics.validCount) * 100).toFixed(1)
          : '0';
        return [
          ind.name,
          ind.statistics.min.toFixed(4),
          ind.statistics.max.toFixed(4),
          ind.statistics.mean.toFixed(4),
          ind.statistics.median.toFixed(4),
          ind.statistics.std.toFixed(4),
          ind.statistics.validCount,
          highPct,
        ].join(',');
      });
      downloadCSV([csvHeader, ...csvRows].join('\n'), `vectoring_stats_${currentResult.depositType}.csv`);
    }

    setSnackbarMessage('Report exported');
  }, [currentResult]);

  // Get thresholds for an indicator
  const getIndicatorThresholds = (indicatorId: string): { value: number; color: string; label: string }[] => {
    const indicator = VECTORING_INDICATORS.find(i => i.id === indicatorId);
    if (!indicator) return [];

    return indicator.thresholds
      .filter(t => t.operator !== 'between')
      .map(t => ({
        value: t.value,
        color: t.color,
        label: t.interpretation.split(' ')[0]
      }));
  };

  // Improved comparison scoring
  const getComparisonScore = useCallback((result: typeof comparisonResults[0]) => {
    if (result.indicators.length === 0) return 0;
    let weightedScore = 0;
    let totalWeight = 0;

    for (const ind of result.indicators) {
      if (ind.statistics.validCount === 0) continue;
      const veryHigh = ind.fertility.filter(f => f === 'very-high').length;
      const high = ind.fertility.filter(f => f === 'high').length;
      const mod = ind.fertility.filter(f => f === 'moderate').length;

      // Weighted score: very-high=3, high=2, moderate=1
      const indScore = ((veryHigh * 3 + high * 2 + mod * 1) / (ind.statistics.validCount * 3)) * 100;
      // Core fertility indicators get more weight
      const indicatorDef = VECTORING_INDICATORS.find(i => i.id === ind.indicatorId);
      const weight = indicatorDef?.category === 'fertility' ? 2 : 1;

      weightedScore += indScore * weight;
      totalWeight += weight;
    }

    return totalWeight > 0 ? weightedScore / totalWeight : 0;
  }, []);

  return (
    <Box sx={{ p: 2, height: '100%', overflow: 'auto' }}>
      {/* Header */}
      <Box sx={{ mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          Deposit-Specific Vectoring Analysis
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Analyze your geochemical data against deposit-specific fertility and proximity indicators
        </Typography>
      </Box>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onChange={(_, val) => setActiveTab(val)}
        sx={{ borderBottom: 1, borderColor: 'divider', mb: 2.5 }}
      >
        <Tab label="Select Deposit Type" value="analysis" />
        <Tab label="Results & Visualization" value="results" />
        <Tab label="Compare Multiple Types" value="compare" />
      </Tabs>

      {/* Error display */}
      {error && (
        <Alert severity="error" onClose={clearError} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* ================================================================== */}
      {/* ANALYSIS TAB - Deposit Selection */}
      {/* ================================================================== */}
      {activeTab === 'analysis' && (
        <Box>
          {Object.entries(DEPOSIT_CATEGORIES).map(([category, types]) => (
            <Accordion
              key={category}
              expanded={expandedCategory === category}
              onChange={(_, expanded) => setExpandedCategory(expanded ? category : null)}
              sx={{ mb: 1, '&:before': { display: 'none' } }}
              disableGutters
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center', pr: 1 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>{category}</Typography>
                  <Chip
                    label={`${types.filter(t => DEPOSIT_CONFIGS.some(c => c.type === t)).length} types`}
                    size="small"
                    variant="outlined"
                  />
                </Box>
              </AccordionSummary>
              <AccordionDetails>
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 1 }}>
                  {types.map(type => {
                    const config = DEPOSIT_CONFIGS.find(c => c.type === type);
                    if (!config) return null;
                    const isSelected = selectedDepositType === type;
                    return (
                      <Card
                        key={type}
                        variant="outlined"
                        sx={{
                          border: isSelected ? '2px solid' : '1px solid',
                          borderColor: isSelected ? 'primary.main' : 'divider',
                          bgcolor: isSelected ? 'primary.50' : 'background.paper',
                        }}
                      >
                        <CardActionArea onClick={() => setSelectedDepositType(type)} sx={{ p: '12px 16px' }}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 600, color: isSelected ? 'primary.dark' : 'text.primary' }}>
                            {config.name}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, lineHeight: 1.4, display: 'block' }}>
                            {config.description}
                          </Typography>
                          <Typography variant="caption" sx={{ color: 'text.disabled', mt: 0.75, display: 'block' }}>
                            Pathfinders: {config.pathfinderSuite.slice(0, 5).join(', ')}{config.pathfinderSuite.length > 5 ? '...' : ''}
                          </Typography>
                        </CardActionArea>
                      </Card>
                    );
                  })}
                </Box>
              </AccordionDetails>
            </Accordion>
          ))}

          {/* Selected deposit details */}
          {selectedDepositType && (() => {
            const config = getDepositConfig(selectedDepositType);
            if (!config) return null;

            return (
              <Paper
                sx={{
                  p: 2.5,
                  mt: 2.5,
                  border: '2px solid',
                  borderColor: 'primary.main',
                  bgcolor: 'primary.50',
                }}
              >
                <Typography variant="h6" sx={{ color: 'primary.dark', mb: 1 }}>
                  Selected: {config.name}
                </Typography>
                <Typography variant="body2" color="text.primary" sx={{ mb: 2 }}>
                  {config.description}
                </Typography>

                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2, mb: 2 }}>
                  <Box>
                    <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 600 }}>
                      Indicators
                    </Typography>
                    <Typography variant="body2">
                      {config.indicators.map(id => {
                        const ind = VECTORING_INDICATORS.find(i => i.id === id);
                        return ind?.name;
                      }).filter(Boolean).join(', ')}
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 600 }}>
                      Pathfinder Suite
                    </Typography>
                    <Typography variant="body2">
                      {config.pathfinderSuite.join(', ')}
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 600 }}>
                      Key Ratios
                    </Typography>
                    <Typography variant="body2">
                      {config.keyRatios.length > 0 ? config.keyRatios.join(', ') : 'N/A'}
                    </Typography>
                  </Box>
                </Box>

                <Button
                  variant="contained"
                  fullWidth
                  size="large"
                  onClick={handleRunAnalysis}
                  disabled={isProcessing || data.length === 0}
                  startIcon={isProcessing ? <CircularProgress size={18} color="inherit" /> : undefined}
                >
                  {isProcessing ? 'Analyzing...' : `Analyze for ${config.name}`}
                </Button>

                {data.length === 0 && (
                  <Typography variant="caption" color="error" sx={{ mt: 1, textAlign: 'center', display: 'block' }}>
                    Please load data first before running analysis
                  </Typography>
                )}
              </Paper>
            );
          })()}
        </Box>
      )}

      {/* ================================================================== */}
      {/* RESULTS TAB */}
      {/* ================================================================== */}
      {activeTab === 'results' && (
        <Box>
          {!currentResult ? (
            <Paper sx={{ p: 8, textAlign: 'center', bgcolor: 'grey.50' }}>
              <Typography variant="h5" sx={{ mb: 2, opacity: 0.6 }}>No results yet</Typography>
              <Typography variant="body2" color="text.secondary">
                Select a deposit type and run analysis to see results.
              </Typography>
            </Paper>
          ) : (
            <>
              {/* Summary header */}
              <Paper
                sx={{
                  p: 2.5,
                  mb: 3,
                  border: '2px solid',
                  borderColor: currentResult.summary.overallAssessment.includes('High') ? 'success.main'
                    : currentResult.summary.overallAssessment.includes('Moderate') ? 'warning.main' : 'grey.300',
                  background: currentResult.summary.overallAssessment.includes('High')
                    ? 'linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%)'
                    : currentResult.summary.overallAssessment.includes('Moderate')
                      ? 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)'
                      : 'linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%)',
                }}
              >
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <Box>
                    <Typography variant="h6" sx={{ mb: 0.5 }}>
                      {getDepositConfig(currentResult.depositType)?.name}
                    </Typography>
                    <Typography
                      variant="subtitle1"
                      sx={{
                        fontWeight: 700,
                        color: currentResult.summary.overallAssessment.includes('High') ? 'success.dark'
                          : currentResult.summary.overallAssessment.includes('Moderate') ? 'warning.dark' : 'text.primary'
                      }}
                    >
                      {currentResult.summary.overallAssessment}
                    </Typography>
                  </Box>
                  <Box sx={{ textAlign: 'right' }}>
                    <Typography variant="body2" color="text.secondary">
                      {currentResult.sampleCount.toLocaleString()} samples analyzed
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {currentResult.indicators.length} indicators calculated
                    </Typography>
                    <Button
                      size="small"
                      startIcon={<FileDownloadIcon />}
                      onClick={handleExportReport}
                      sx={{ mt: 0.5 }}
                    >
                      Export Report
                    </Button>
                  </Box>
                </Box>

                {/* Key findings */}
                {currentResult.summary.keyFindings.length > 0 && currentResult.summary.keyFindings[0] !== 'No significant anomalies detected' && (
                  <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid rgba(0,0,0,0.1)' }}>
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>Key Findings:</Typography>
                    <ul style={{ margin: 0, paddingLeft: '20px' }}>
                      {currentResult.summary.keyFindings.map((f, i) => (
                        <li key={i}><Typography variant="body2">{f}</Typography></li>
                      ))}
                    </ul>
                  </Box>
                )}
              </Paper>

              {/* Element Availability Card */}
              {(currentResult.missingIndicators.length > 0 || currentResult.elementAvailability.missing.length > 0) && (
                <Alert
                  severity="info"
                  icon={<WarningAmberIcon />}
                  sx={{ mb: 3 }}
                >
                  <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Element Availability</Typography>
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }}>
                    {currentResult.elementAvailability.found.map(el => (
                      <Chip key={el} label={el} size="small" color="success" variant="outlined" icon={<CheckCircleOutlineIcon />} />
                    ))}
                    {currentResult.elementAvailability.missing.map(el => (
                      <Chip key={el} label={el} size="small" color="warning" variant="outlined" icon={<WarningAmberIcon />} />
                    ))}
                  </Box>
                  {currentResult.missingIndicators.length > 0 && (
                    <Typography variant="caption" color="text.secondary">
                      Skipped: {currentResult.missingIndicators.map(m => `${m.name} (needs ${m.missingElements.join(', ')})`).join('; ')}
                    </Typography>
                  )}
                </Alert>
              )}

              {/* Indicator Histograms */}
              <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
                Indicator Analysis
              </Typography>

              {currentResult.indicators.length === 0 ? (
                <Paper sx={{ p: 5, textAlign: 'center', bgcolor: 'grey.50' }}>
                  <Typography variant="body2" color="text.secondary">
                    No indicators could be calculated. Check that required elements are present in your data.
                  </Typography>
                </Paper>
              ) : (
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(500px, 1fr))', gap: 2 }}>
                  {currentResult.indicators.map(indicator => (
                    <IndicatorHistogram
                      key={indicator.indicatorId}
                      indicator={indicator}
                      thresholds={getIndicatorThresholds(indicator.indicatorId)}
                      onSaveToTable={handleSaveToTable}
                    />
                  ))}
                </Box>
              )}

              {/* Recommendations */}
              {currentResult.summary.recommendations.length > 0 && (
                <Alert severity="info" sx={{ mt: 3 }}>
                  <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Recommendations</Typography>
                  <ul style={{ margin: 0, paddingLeft: '20px' }}>
                    {currentResult.summary.recommendations.map((rec, i) => (
                      <li key={i}><Typography variant="body2">{rec}</Typography></li>
                    ))}
                  </ul>
                </Alert>
              )}
            </>
          )}
        </Box>
      )}

      {/* ================================================================== */}
      {/* COMPARE TAB */}
      {/* ================================================================== */}
      {activeTab === 'compare' && (
        <Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Select 2-6 deposit types to compare. This will run all indicators and show which deposit type best matches your data.
          </Typography>

          {/* Quick select chips */}
          <Box sx={{ mb: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {Object.entries(DEPOSIT_CATEGORIES).map(([category, types]) => (
              <Chip
                key={category}
                label={category}
                variant="outlined"
                size="small"
                onClick={() => {
                  const validTypes = types.filter(t => DEPOSIT_CONFIGS.some(c => c.type === t));
                  setSelectedForComparison(prev => {
                    const allSelected = validTypes.every(t => prev.includes(t));
                    if (allSelected) {
                      return prev.filter(t => !validTypes.includes(t));
                    }
                    return [...new Set([...prev, ...validTypes])];
                  });
                }}
              />
            ))}
          </Box>

          {/* Deposit grid for selection */}
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 1, mb: 2 }}>
            {DEPOSIT_CONFIGS.map(config => (
              <Card
                key={config.type}
                variant="outlined"
                sx={{
                  border: selectedForComparison.includes(config.type) ? '2px solid' : '1px solid',
                  borderColor: selectedForComparison.includes(config.type) ? 'primary.main' : 'divider',
                  bgcolor: selectedForComparison.includes(config.type) ? 'primary.50' : 'background.paper',
                }}
              >
                <CardActionArea
                  onClick={() => toggleComparisonDeposit(config.type)}
                  sx={{ p: '10px 12px', display: 'flex', justifyContent: 'flex-start', gap: 1 }}
                >
                  <Checkbox
                    checked={selectedForComparison.includes(config.type)}
                    size="small"
                    sx={{ p: 0 }}
                    tabIndex={-1}
                  />
                  <Typography variant="body2">{config.name}</Typography>
                </CardActionArea>
              </Card>
            ))}
          </Box>

          <Button
            variant="contained"
            fullWidth
            size="large"
            onClick={handleRunComparison}
            disabled={selectedForComparison.length < 2 || isProcessing || data.length === 0}
            startIcon={isProcessing ? <CircularProgress size={18} color="inherit" /> : undefined}
            sx={{ mb: 2.5 }}
          >
            {isProcessing ? 'Comparing...' : `Compare ${selectedForComparison.length} Deposit Types`}
          </Button>

          {/* Comparison results */}
          {comparisonResults.length > 0 && (
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
                Comparison Results
              </Typography>

              {/* Ranking table */}
              <Paper variant="outlined" sx={{ mb: 3, overflow: 'hidden' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: 'grey.50' }}>
                      <TableCell sx={{ fontWeight: 600 }}>Rank</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Deposit Type</TableCell>
                      <TableCell align="center" sx={{ fontWeight: 600 }}>Calculated</TableCell>
                      <TableCell align="center" sx={{ fontWeight: 600 }}>Positive</TableCell>
                      <TableCell align="center" sx={{ fontWeight: 600 }}>Score</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Assessment</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {comparisonResults
                      .map(result => {
                        const positiveIndicators = result.indicators.filter(ind =>
                          ind.fertility.filter(f => f === 'high' || f === 'very-high').length > ind.statistics.validCount * 0.1
                        ).length;
                        const score = getComparisonScore(result);
                        return { ...result, positiveIndicators, score };
                      })
                      .sort((a, b) => b.score - a.score)
                      .map((result, index) => {
                        const config = getDepositConfig(result.depositType);
                        return (
                          <TableRow key={result.depositType}>
                            <TableCell sx={{ fontWeight: 600 }}>#{index + 1}</TableCell>
                            <TableCell>{config?.name}</TableCell>
                            <TableCell align="center">{result.indicators.length}</TableCell>
                            <TableCell align="center">
                              {result.positiveIndicators} / {result.indicators.length}
                            </TableCell>
                            <TableCell align="center">
                              <Chip
                                label={`${result.score.toFixed(0)}%`}
                                size="small"
                                color={result.score > 50 ? 'success' : result.score > 25 ? 'warning' : 'default'}
                                sx={{ fontWeight: 600 }}
                              />
                            </TableCell>
                            <TableCell>
                              <Typography variant="caption" color="text.secondary">
                                {result.summary.overallAssessment}
                              </Typography>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                  </TableBody>
                </Table>
              </Paper>

              {/* Radar chart */}
              <Paper variant="outlined" sx={{ p: 1 }}>
                <Plot
                  data={comparisonResults.slice(0, 6).map((result, i) => {
                    const config = getDepositConfig(result.depositType);
                    const scores = result.indicators.map(ind => {
                      const high = ind.fertility.filter(f => f === 'high' || f === 'very-high').length;
                      return ind.statistics.validCount > 0 ? (high / ind.statistics.validCount) * 100 : 0;
                    });
                    const labels = result.indicators.map(ind =>
                      ind.name.length > 15 ? ind.name.slice(0, 15) + '...' : ind.name
                    );

                    return {
                      type: 'scatterpolar',
                      r: [...scores, scores[0]],
                      theta: [...labels, labels[0]],
                      fill: 'toself',
                      name: config?.name || result.depositType,
                      opacity: 0.6,
                      marker: { color: ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'][i] }
                    } as any;
                  })}
                  layout={{
                    title: { text: 'Indicator Comparison by Deposit Type', font: { size: 14 } },
                    polar: { radialaxis: { visible: true, range: [0, 100] } },
                    height: 450,
                    margin: { t: 60, b: 40, l: 80, r: 80 },
                    showlegend: true,
                    legend: { x: 1.1, y: 0.5 }
                  }}
                  config={{ responsive: true }}
                  style={{ width: '100%' }}
                />
              </Paper>
            </Box>
          )}
        </Box>
      )}

      {/* Snackbar for notifications */}
      <Snackbar
        open={!!snackbarMessage}
        autoHideDuration={3000}
        onClose={() => setSnackbarMessage(null)}
        message={snackbarMessage}
      />
    </Box>
  );
};

export default VectoringManager;
