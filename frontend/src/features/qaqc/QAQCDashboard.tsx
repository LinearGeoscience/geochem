/**
 * QA/QC Dashboard Component
 * Comprehensive overview of all QA/QC analysis results
 */

import React, { useMemo } from 'react';
import Plot from 'react-plotly.js';
import {
  Box,
  Paper,
  Typography,
  Grid,
  Chip,
  Alert,
  Card,
  CardContent,
  LinearProgress,
  Divider,
  Button,
} from '@mui/material';
import {
  CheckCircle as CheckIcon,
  Warning as WarningIcon,
  Error as ErrorIcon,
  Assessment as AssessmentIcon,
  Science as ScienceIcon,
  ContentCopy as DuplicateIcon,
  Opacity as BlankIcon,
  Download as DownloadIcon,
} from '@mui/icons-material';
import { useQAQCStore } from '../../store/qaqcStore';
import { useAppStore } from '../../store/appStore';
import { useProjectStore } from '../../store/projectStore';

interface QAQCDashboardProps {
  onNavigate?: (view: 'manager' | 'control-chart' | 'duplicates' | 'blanks') => void;
}

export const QAQCDashboard: React.FC<QAQCDashboardProps> = ({ onNavigate }) => {
  const { data } = useAppStore();
  const { currentProject } = useProjectStore();
  const {
    qcSamples,
    duplicatePairs,
    elementSummaries,
    overallGrade,
    recommendations,
    controlCharts,
    duplicateAnalyses,
    blankAnalyses,
    lastAnalysisTimestamp,
    generateReport,
  } = useQAQCStore();

  // Calculate summary statistics
  const stats = useMemo(() => {
    const standardSamples = qcSamples.filter(s => s.qcType === 'standard');
    const blankSamples = qcSamples.filter(s => s.qcType === 'blank');
    const duplicateSamples = qcSamples.filter(s =>
      s.qcType === 'field_duplicate' ||
      s.qcType === 'pulp_duplicate' ||
      s.qcType === 'core_duplicate'
    );

    const totalSamples = data.length;
    const qcCount = qcSamples.length;
    const insertionRate = totalSamples > 0 ? (qcCount / totalSamples) * 100 : 0;

    return {
      totalSamples,
      qcCount,
      insertionRate,
      standardCount: standardSamples.length,
      blankCount: blankSamples.length,
      duplicateCount: duplicateSamples.length,
      duplicatePairCount: duplicatePairs.length,
    };
  }, [data, qcSamples, duplicatePairs]);

  // Build element summary chart data
  const elementChartData = useMemo(() => {
    if (elementSummaries.length === 0) return null;

    const elements = elementSummaries.map(e => e.element);
    const standardRates = elementSummaries.map(e => e.standardsPassRate);
    const blankRates = elementSummaries.map(e => e.blanksPassRate);
    const duplicateRates = elementSummaries.map(e => e.duplicatesPassRate);

    return {
      traces: [
        {
          x: elements,
          y: standardRates,
          name: 'Standards',
          type: 'bar' as const,
          marker: { color: '#1976d2' },
        },
        {
          x: elements,
          y: blankRates,
          name: 'Blanks',
          type: 'bar' as const,
          marker: { color: '#4caf50' },
        },
        {
          x: elements,
          y: duplicateRates,
          name: 'Duplicates',
          type: 'bar' as const,
          marker: { color: '#ff9800' },
        },
      ] as any[],
      layout: {
        barmode: 'group',
        yaxis: { title: 'Pass Rate (%)', range: [0, 105] },
        xaxis: { title: 'Element' },
        showlegend: true,
        legend: { orientation: 'h', y: -0.2, x: 0.5, xanchor: 'center' },
        autosize: true,
        height: 300,
        margin: { l: 50, r: 30, t: 30, b: 80 },
        shapes: [
          // 80% threshold line
          {
            type: 'line',
            x0: -0.5,
            x1: elements.length - 0.5,
            y0: 80,
            y1: 80,
            line: { color: '#f44336', width: 2, dash: 'dash' },
          },
        ],
      } as any,
    };
  }, [elementSummaries]);

  // Build grade distribution chart
  const gradeChartData = useMemo(() => {
    if (elementSummaries.length === 0) return null;

    const gradeCounts = { A: 0, B: 0, C: 0, D: 0, F: 0 };
    elementSummaries.forEach(e => {
      gradeCounts[e.grade]++;
    });

    return {
      traces: [
        {
          labels: ['A', 'B', 'C', 'D', 'F'],
          values: [gradeCounts.A, gradeCounts.B, gradeCounts.C, gradeCounts.D, gradeCounts.F],
          type: 'pie' as const,
          marker: {
            colors: ['#4caf50', '#8bc34a', '#ff9800', '#ff5722', '#f44336'],
          },
          textinfo: 'label+value',
          hole: 0.4,
        },
      ] as any[],
      layout: {
        showlegend: false,
        autosize: true,
        height: 200,
        margin: { l: 20, r: 20, t: 20, b: 20 },
      } as any,
    };
  }, [elementSummaries]);

  // Export report
  const handleExportReport = () => {
    const report = generateReport(currentProject?.name || 'Dataset');
    if (!report) {
      alert('No analysis data to export');
      return;
    }

    const reportText = formatReportAsText(report);
    const blob = new Blob([reportText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `QAQC_Report_${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatReportAsText = (report: any) => {
    let text = `QA/QC ANALYSIS REPORT\n`;
    text += `${'='.repeat(50)}\n\n`;
    text += `Dataset: ${report.datasetName}\n`;
    text += `Generated: ${new Date(report.generatedAt).toLocaleString()}\n`;
    text += `Overall Grade: ${report.overallGrade}\n\n`;
    text += `SUMMARY\n${'-'.repeat(30)}\n`;
    text += `Total Samples: ${report.totalSamples}\n`;
    text += `QC Samples: ${report.qcSamples}\n`;
    text += `Insertion Rate: ${report.insertionRate.toFixed(1)}%\n\n`;
    text += `ELEMENT SUMMARIES\n${'-'.repeat(30)}\n`;

    report.elementSummaries.forEach((e: any) => {
      text += `\n${e.element}:\n`;
      text += `  Standards: ${e.standardsPass}/${e.standardsAnalyzed} (${e.standardsPassRate.toFixed(0)}%)\n`;
      text += `  Blanks: ${e.blanksClean}/${e.blanksAnalyzed} (${e.blanksPassRate.toFixed(0)}%)\n`;
      text += `  Duplicates: ${e.duplicatesPass}/${e.duplicatesAnalyzed} (${e.duplicatesPassRate.toFixed(0)}%)\n`;
      text += `  Grade: ${e.grade}\n`;
    });

    text += `\nRECOMMENDATIONS\n${'-'.repeat(30)}\n`;
    report.recommendations.forEach((r: string, i: number) => {
      text += `${i + 1}. ${r}\n`;
    });

    return text;
  };

  // Get grade color
  const getGradeColor = (grade: string | null) => {
    switch (grade) {
      case 'A': return '#4caf50';
      case 'B': return '#8bc34a';
      case 'C': return '#ff9800';
      case 'D': return '#ff5722';
      case 'F': return '#f44336';
      default: return '#9e9e9e';
    }
  };

  if (!lastAnalysisTimestamp) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="info" sx={{ mb: 2 }}>
          No QA/QC analysis has been run yet. Please configure and run analysis first.
        </Alert>
        {onNavigate && (
          <Button variant="contained" onClick={() => onNavigate('manager')}>
            Go to QA/QC Manager
          </Button>
        )}
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5">
          QA/QC Dashboard
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            variant="outlined"
            startIcon={<DownloadIcon />}
            onClick={handleExportReport}
          >
            Export Report
          </Button>
        </Box>
      </Box>

      {/* Overall Grade Card */}
      <Grid container spacing={2}>
        <Grid item xs={12} md={4}>
          <Card sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CardContent sx={{ textAlign: 'center' }}>
              <Typography variant="h6" color="text.secondary" gutterBottom>
                Overall Grade
              </Typography>
              <Box
                sx={{
                  width: 100,
                  height: 100,
                  borderRadius: '50%',
                  backgroundColor: getGradeColor(overallGrade),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto',
                  mb: 2,
                }}
              >
                <Typography variant="h2" color="white" fontWeight="bold">
                  {overallGrade || '-'}
                </Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">
                Last updated: {new Date(lastAnalysisTimestamp).toLocaleString()}
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        {/* Summary Stats */}
        <Grid item xs={12} md={8}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Sample Summary
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={6} sm={3}>
                  <Box sx={{ textAlign: 'center' }}>
                    <AssessmentIcon sx={{ fontSize: 40, color: 'primary.main' }} />
                    <Typography variant="h4">{stats.totalSamples.toLocaleString()}</Typography>
                    <Typography variant="caption" color="text.secondary">Total Samples</Typography>
                  </Box>
                </Grid>
                <Grid item xs={6} sm={3}>
                  <Box sx={{ textAlign: 'center' }}>
                    <ScienceIcon sx={{ fontSize: 40, color: 'info.main' }} />
                    <Typography variant="h4">{stats.standardCount}</Typography>
                    <Typography variant="caption" color="text.secondary">Standards</Typography>
                  </Box>
                </Grid>
                <Grid item xs={6} sm={3}>
                  <Box sx={{ textAlign: 'center' }}>
                    <BlankIcon sx={{ fontSize: 40, color: 'success.main' }} />
                    <Typography variant="h4">{stats.blankCount}</Typography>
                    <Typography variant="caption" color="text.secondary">Blanks</Typography>
                  </Box>
                </Grid>
                <Grid item xs={6} sm={3}>
                  <Box sx={{ textAlign: 'center' }}>
                    <DuplicateIcon sx={{ fontSize: 40, color: 'warning.main' }} />
                    <Typography variant="h4">{stats.duplicatePairCount}</Typography>
                    <Typography variant="caption" color="text.secondary">Duplicate Pairs</Typography>
                  </Box>
                </Grid>
              </Grid>

              <Divider sx={{ my: 2 }} />

              <Typography variant="body2" gutterBottom>
                QC Insertion Rate: <strong>{stats.insertionRate.toFixed(1)}%</strong>
              </Typography>
              <LinearProgress
                variant="determinate"
                value={Math.min(stats.insertionRate, 100)}
                color={stats.insertionRate >= 5 ? 'success' : 'warning'}
                sx={{ height: 10, borderRadius: 5 }}
              />
              {stats.insertionRate < 5 && (
                <Typography variant="caption" color="warning.main">
                  Below recommended 5% minimum
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Element Pass Rates Chart */}
      {elementChartData && (
        <Paper sx={{ p: 2, mt: 2 }}>
          <Typography variant="h6" gutterBottom>
            Element Pass Rates
          </Typography>
          <Plot
            data={elementChartData.traces}
            layout={elementChartData.layout}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: '100%' }}
            useResizeHandler={true}
          />
        </Paper>
      )}

      {/* Grade Distribution and Quick Stats */}
      <Grid container spacing={2} sx={{ mt: 1 }}>
        {/* Grade Distribution */}
        {gradeChartData && (
          <Grid item xs={12} md={4}>
            <Paper sx={{ p: 2, height: '100%' }}>
              <Typography variant="h6" gutterBottom>
                Grade Distribution
              </Typography>
              <Plot
                data={gradeChartData.traces}
                layout={gradeChartData.layout}
                config={{ displayModeBar: false, responsive: true }}
                style={{ width: '100%' }}
                useResizeHandler={true}
              />
            </Paper>
          </Grid>
        )}

        {/* Quick Navigation */}
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 2, height: '100%' }}>
            <Typography variant="h6" gutterBottom>
              Quick Access
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {Object.keys(controlCharts).length > 0 && onNavigate && (
                <Button
                  variant="outlined"
                  startIcon={<ScienceIcon />}
                  onClick={() => onNavigate('control-chart')}
                  fullWidth
                >
                  Control Charts ({Object.keys(controlCharts).length} standards)
                </Button>
              )}
              {Object.keys(duplicateAnalyses).length > 0 && onNavigate && (
                <Button
                  variant="outlined"
                  startIcon={<DuplicateIcon />}
                  onClick={() => onNavigate('duplicates')}
                  fullWidth
                >
                  Duplicate Analysis ({duplicatePairs.length} pairs)
                </Button>
              )}
              {blankAnalyses.length > 0 && onNavigate && (
                <Button
                  variant="outlined"
                  startIcon={<BlankIcon />}
                  onClick={() => onNavigate('blanks')}
                  fullWidth
                >
                  Blank Analysis ({blankAnalyses.length} elements)
                </Button>
              )}
            </Box>
          </Paper>
        </Grid>

        {/* Recommendations */}
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 2, height: '100%' }}>
            <Typography variant="h6" gutterBottom>
              Recommendations
            </Typography>
            <Box sx={{ maxHeight: 200, overflow: 'auto' }}>
              {recommendations.map((rec, idx) => (
                <Alert
                  key={idx}
                  severity={
                    rec.includes('satisfactory') ? 'success' :
                    rec.includes('failing') ? 'error' : 'warning'
                  }
                  sx={{ mb: 1 }}
                  icon={
                    rec.includes('satisfactory') ? <CheckIcon /> :
                    rec.includes('failing') ? <ErrorIcon /> : <WarningIcon />
                  }
                >
                  <Typography variant="body2">{rec}</Typography>
                </Alert>
              ))}
            </Box>
          </Paper>
        </Grid>
      </Grid>

      {/* Element Summary Table */}
      <Paper sx={{ p: 2, mt: 2 }}>
        <Typography variant="h6" gutterBottom>
          Element Summary
        </Typography>
        <Grid container spacing={1}>
          {elementSummaries.map((summary) => (
            <Grid item xs={6} sm={4} md={3} lg={2} key={summary.element}>
              <Card
                variant="outlined"
                sx={{
                  p: 1,
                  borderColor: getGradeColor(summary.grade),
                  borderWidth: 2,
                }}
              >
                <Typography variant="subtitle2" fontWeight="bold">
                  {summary.element}
                </Typography>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography variant="caption" color="text.secondary">
                    Score: {summary.overallScore.toFixed(0)}%
                  </Typography>
                  <Chip
                    label={summary.grade}
                    size="small"
                    sx={{
                      backgroundColor: getGradeColor(summary.grade),
                      color: 'white',
                      fontWeight: 'bold',
                    }}
                  />
                </Box>
                <Typography variant="caption" display="block" color="text.secondary">
                  Std: {summary.standardsPassRate.toFixed(0)}% |
                  Blk: {summary.blanksPassRate.toFixed(0)}% |
                  Dup: {summary.duplicatesPassRate.toFixed(0)}%
                </Typography>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Paper>
    </Box>
  );
};

export default QAQCDashboard;
