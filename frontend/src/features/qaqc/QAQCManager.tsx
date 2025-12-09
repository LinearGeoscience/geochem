/**
 * QA/QC Manager Component
 * Main configuration and control panel for QA/QC analysis
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  Box,
  Paper,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button,
  Alert,
  Chip,
  TextField,
  Grid,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  LinearProgress,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  PlayArrow as PlayIcon,
  Refresh as RefreshIcon,
  Settings as SettingsIcon,
  Delete as DeleteIcon,
  CheckCircle as CheckIcon,
  Warning as WarningIcon,
  Error as ErrorIcon,
} from '@mui/icons-material';
import { useAppStore } from '../../store/appStore';
import { useQAQCStore } from '../../store/qaqcStore';
import { MultiColumnSelector } from '../../components/MultiColumnSelector';
import { QCSampleType, DEFAULT_QAQC_THRESHOLDS } from '../../types/qaqc';

interface QAQCManagerProps {
  onNavigate?: (view: 'control-chart' | 'duplicates' | 'blanks' | 'dashboard') => void;
}

export const QAQCManager: React.FC<QAQCManagerProps> = ({ onNavigate }) => {
  const { data, columns, getFilteredColumns } = useAppStore();
  const filteredColumns = getFilteredColumns();

  const {
    sampleIdColumn,
    setSampleIdColumn,
    batchColumn,
    setBatchColumn,
    thresholds,
    setThresholds,
    qcSamples,
    duplicatePairs,
    detectSamples,
    runAnalysis,
    clearAnalysis,
    elementSummaries,
    overallGrade,
    recommendations,
    isAnalysisRunning,
    lastAnalysisTimestamp,
    selectedElements,
    setSelectedElements,
  } = useQAQCStore();

  const [showThresholds, setShowThresholds] = useState(false);

  // Get column options
  const textColumns = useMemo(() =>
    filteredColumns.filter(c =>
      c.type === 'string' || c.type === 'text' || c.type === 'categorical' || c.type === 'category'
    ),
    [filteredColumns]
  );

  const numericColumns = useMemo(() =>
    filteredColumns.filter(c =>
      c.type === 'numeric' || c.type === 'float' || c.type === 'integer'
    ),
    [filteredColumns]
  );

  // Count QC samples by type
  const qcCounts = useMemo(() => {
    const counts: Record<QCSampleType, number> = {
      standard: 0,
      blank: 0,
      field_duplicate: 0,
      pulp_duplicate: 0,
      core_duplicate: 0,
      unknown: 0,
    };
    qcSamples.forEach(s => counts[s.qcType]++);
    return counts;
  }, [qcSamples]);

  // Handle sample detection
  const handleDetectSamples = useCallback(() => {
    if (!sampleIdColumn) {
      // Try to auto-detect
      const possibleCols = textColumns.filter(c =>
        /sample|id|hole/i.test(c.name)
      );
      if (possibleCols.length > 0) {
        setSampleIdColumn(possibleCols[0].name);
      }
    }
    detectSamples(data, columns);
  }, [sampleIdColumn, data, columns, textColumns, setSampleIdColumn, detectSamples]);

  // Handle analysis
  const handleRunAnalysis = useCallback(() => {
    if (selectedElements.length === 0) {
      alert('Please select at least one element to analyze');
      return;
    }
    runAnalysis(data, selectedElements);
  }, [data, selectedElements, runAnalysis]);

  // Grade color
  const getGradeColor = (grade: string | null) => {
    switch (grade) {
      case 'A': return 'success';
      case 'B': return 'success';
      case 'C': return 'warning';
      case 'D': return 'warning';
      case 'F': return 'error';
      default: return 'default';
    }
  };

  // Status icon
  const getStatusIcon = (passRate: number) => {
    if (passRate >= 90) return <CheckIcon color="success" fontSize="small" />;
    if (passRate >= 70) return <WarningIcon color="warning" fontSize="small" />;
    return <ErrorIcon color="error" fontSize="small" />;
  };

  if (!data.length) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="info">
          Please load data to begin QA/QC analysis.
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h5" gutterBottom>
        QA/QC Analysis
      </Typography>

      {/* Configuration Section */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography variant="h6" gutterBottom>
          Configuration
        </Typography>

        <Grid container spacing={2} alignItems="flex-end">
          <Grid item xs={12} md={4}>
            <FormControl fullWidth size="small">
              <InputLabel>Sample ID Column</InputLabel>
              <Select
                value={sampleIdColumn || ''}
                onChange={(e) => setSampleIdColumn(e.target.value || null)}
                label="Sample ID Column"
              >
                <MenuItem value="">
                  <em>Auto-detect</em>
                </MenuItem>
                {textColumns.map((col) => (
                  <MenuItem key={col.name} value={col.name}>
                    {col.alias || col.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>

          <Grid item xs={12} md={4}>
            <FormControl fullWidth size="small">
              <InputLabel>Batch Column (Optional)</InputLabel>
              <Select
                value={batchColumn || ''}
                onChange={(e) => setBatchColumn(e.target.value || null)}
                label="Batch Column (Optional)"
              >
                <MenuItem value="">
                  <em>Auto-assign</em>
                </MenuItem>
                {textColumns.map((col) => (
                  <MenuItem key={col.name} value={col.name}>
                    {col.alias || col.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>

          <Grid item xs={12} md={4}>
            <Button
              variant="contained"
              startIcon={<RefreshIcon />}
              onClick={handleDetectSamples}
              fullWidth
            >
              Detect QC Samples
            </Button>
          </Grid>
        </Grid>

        {/* Threshold Settings */}
        <Accordion
          expanded={showThresholds}
          onChange={() => setShowThresholds(!showThresholds)}
          sx={{ mt: 2 }}
        >
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <SettingsIcon sx={{ mr: 1 }} />
            <Typography>Threshold Settings</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6} md={4}>
                <TextField
                  label="Field Duplicate RPD (%)"
                  type="number"
                  size="small"
                  fullWidth
                  value={thresholds.fieldDuplicateRPD}
                  onChange={(e) => setThresholds({ fieldDuplicateRPD: Number(e.target.value) })}
                />
              </Grid>
              <Grid item xs={12} sm={6} md={4}>
                <TextField
                  label="Pulp Duplicate RPD (%)"
                  type="number"
                  size="small"
                  fullWidth
                  value={thresholds.pulpDuplicateRPD}
                  onChange={(e) => setThresholds({ pulpDuplicateRPD: Number(e.target.value) })}
                />
              </Grid>
              <Grid item xs={12} sm={6} md={4}>
                <TextField
                  label="Core Duplicate RPD (%)"
                  type="number"
                  size="small"
                  fullWidth
                  value={thresholds.coreDuplicateRPD}
                  onChange={(e) => setThresholds({ coreDuplicateRPD: Number(e.target.value) })}
                />
              </Grid>
              <Grid item xs={12} sm={6} md={4}>
                <TextField
                  label="Blank Elevated (× DL)"
                  type="number"
                  size="small"
                  fullWidth
                  value={thresholds.blankElevatedMultiple}
                  onChange={(e) => setThresholds({ blankElevatedMultiple: Number(e.target.value) })}
                />
              </Grid>
              <Grid item xs={12} sm={6} md={4}>
                <TextField
                  label="Blank Contaminated (× DL)"
                  type="number"
                  size="small"
                  fullWidth
                  value={thresholds.blankContaminatedMultiple}
                  onChange={(e) => setThresholds({ blankContaminatedMultiple: Number(e.target.value) })}
                />
              </Grid>
              <Grid item xs={12} sm={6} md={4}>
                <TextField
                  label="Min Insertion Rate (%)"
                  type="number"
                  size="small"
                  fullWidth
                  value={thresholds.minInsertionRate}
                  onChange={(e) => setThresholds({ minInsertionRate: Number(e.target.value) })}
                />
              </Grid>
              <Grid item xs={12}>
                <Button
                  size="small"
                  onClick={() => setThresholds(DEFAULT_QAQC_THRESHOLDS)}
                >
                  Reset to Defaults
                </Button>
              </Grid>
            </Grid>
          </AccordionDetails>
        </Accordion>
      </Paper>

      {/* Detection Results */}
      {qcSamples.length > 0 && (
        <Paper sx={{ p: 2, mb: 2 }}>
          <Typography variant="h6" gutterBottom>
            Detected QC Samples
          </Typography>

          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
            <Chip
              label={`Standards: ${qcCounts.standard}`}
              color={qcCounts.standard > 0 ? 'primary' : 'default'}
              size="small"
            />
            <Chip
              label={`Blanks: ${qcCounts.blank}`}
              color={qcCounts.blank > 0 ? 'info' : 'default'}
              size="small"
            />
            <Chip
              label={`Field Dups: ${qcCounts.field_duplicate}`}
              color={qcCounts.field_duplicate > 0 ? 'success' : 'default'}
              size="small"
            />
            <Chip
              label={`Pulp Dups: ${qcCounts.pulp_duplicate}`}
              color={qcCounts.pulp_duplicate > 0 ? 'success' : 'default'}
              size="small"
            />
            <Chip
              label={`Core Dups: ${qcCounts.core_duplicate}`}
              color={qcCounts.core_duplicate > 0 ? 'success' : 'default'}
              size="small"
            />
            <Chip
              label={`Duplicate Pairs: ${duplicatePairs.length}`}
              color={duplicatePairs.length > 0 ? 'secondary' : 'default'}
              size="small"
            />
          </Box>

          <Typography variant="body2" color="text.secondary">
            Total: {qcSamples.length} QC samples detected ({((qcSamples.length / data.length) * 100).toFixed(1)}% insertion rate)
          </Typography>
        </Paper>
      )}

      {/* Analysis Section */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography variant="h6" gutterBottom>
          Run Analysis
        </Typography>

        <Box sx={{ mb: 2 }}>
          <MultiColumnSelector
            columns={numericColumns}
            selectedColumns={selectedElements}
            onChange={setSelectedElements}
            label="Elements to Analyze"
          />
        </Box>

        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <Button
            variant="contained"
            color="primary"
            startIcon={isAnalysisRunning ? null : <PlayIcon />}
            onClick={handleRunAnalysis}
            disabled={isAnalysisRunning || qcSamples.length === 0 || selectedElements.length === 0}
          >
            {isAnalysisRunning ? 'Running...' : 'Run QA/QC Analysis'}
          </Button>

          {lastAnalysisTimestamp && (
            <Button
              variant="outlined"
              color="secondary"
              startIcon={<DeleteIcon />}
              onClick={clearAnalysis}
            >
              Clear Results
            </Button>
          )}
        </Box>

        {isAnalysisRunning && (
          <Box sx={{ mt: 2 }}>
            <LinearProgress />
          </Box>
        )}
      </Paper>

      {/* Results Summary */}
      {elementSummaries.length > 0 && (
        <Paper sx={{ p: 2, mb: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6">
              Analysis Results
            </Typography>
            {overallGrade && (
              <Chip
                label={`Overall Grade: ${overallGrade}`}
                color={getGradeColor(overallGrade) as any}
                size="medium"
              />
            )}
          </Box>

          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Element</TableCell>
                  <TableCell align="center">Standards</TableCell>
                  <TableCell align="center">Blanks</TableCell>
                  <TableCell align="center">Duplicates</TableCell>
                  <TableCell align="center">Score</TableCell>
                  <TableCell align="center">Grade</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {elementSummaries.map((summary) => (
                  <TableRow key={summary.element}>
                    <TableCell>
                      <Typography variant="body2" fontWeight="medium">
                        {summary.element}
                      </Typography>
                    </TableCell>
                    <TableCell align="center">
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                        {getStatusIcon(summary.standardsPassRate)}
                        <Typography variant="body2">
                          {summary.standardsPass}/{summary.standardsAnalyzed}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell align="center">
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                        {getStatusIcon(summary.blanksPassRate)}
                        <Typography variant="body2">
                          {summary.blanksClean}/{summary.blanksAnalyzed}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell align="center">
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                        {getStatusIcon(summary.duplicatesPassRate)}
                        <Typography variant="body2">
                          {summary.duplicatesPass}/{summary.duplicatesAnalyzed}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell align="center">
                      <Typography variant="body2">
                        {summary.overallScore.toFixed(0)}%
                      </Typography>
                    </TableCell>
                    <TableCell align="center">
                      <Chip
                        label={summary.grade}
                        size="small"
                        color={getGradeColor(summary.grade) as any}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          {/* Recommendations */}
          {recommendations.length > 0 && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle2" gutterBottom>
                Recommendations
              </Typography>
              {recommendations.map((rec, idx) => (
                <Alert
                  key={idx}
                  severity={rec.includes('satisfactory') ? 'success' : rec.includes('failing') ? 'error' : 'warning'}
                  sx={{ mb: 1 }}
                >
                  {rec}
                </Alert>
              ))}
            </Box>
          )}

          {/* Navigation buttons */}
          {onNavigate && (
            <Box sx={{ mt: 2, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <Button variant="outlined" onClick={() => onNavigate('control-chart')}>
                View Control Charts
              </Button>
              <Button variant="outlined" onClick={() => onNavigate('duplicates')}>
                View Duplicate Analysis
              </Button>
              <Button variant="outlined" onClick={() => onNavigate('blanks')}>
                View Blank Analysis
              </Button>
              <Button variant="outlined" onClick={() => onNavigate('dashboard')}>
                View Dashboard
              </Button>
            </Box>
          )}
        </Paper>
      )}
    </Box>
  );
};

export default QAQCManager;
