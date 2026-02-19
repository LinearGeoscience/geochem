/**
 * PCA Workflow Component
 *
 * Implements the full PCA analysis workflow from the Exploration Geochemistry Workshop Manual:
 * 1. Element Quality Assessment via probability plots (BLD threshold at N-score = -1)
 * 2. CLR Transformation + Classical PCA with 8 components
 * 3. Results visualization (Scree Plot, Sorted Loading Matrix, Ranked Eigenvector Plots)
 */

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  Stepper,
  Step,
  StepLabel,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Slider,
  Alert,
  CircularProgress,
  Tabs,
  Tab,
  Grid,
  Chip,
  Snackbar,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useAppStore } from '../../store/appStore';
import { useTransformationStore } from '../../store/transformationStore';
import { useAttributeStore } from '../../store/attributeStore';
import { sortColumnsByPriority, getStyleArrays } from '../../utils/attributeUtils';
import { ZeroHandlingStrategy } from '../../types/compositional';
import { PCAssociationAnalysis, MatchingOptions } from '../../types/associations';
import { matchAssociations } from '../../utils/calculations/associationMatcher';
import {
  createElementMappings,
  buildMappingMap,
  getMappingSummary,
  isNonElementColumn,
} from '../../utils/calculations/elementNameNormalizer';

// Import visualization components
import { ScreePlot } from './pca/ScreePlot';
import { SortedLoadingMatrix } from './pca/SortedLoadingMatrix';
import { RankedEigenvectorPlot } from './pca/RankedEigenvectorPlot';
import { PCAReportExport } from './pca/PCAReportExport';
import { AssociationResults } from './pca/AssociationResults';
import { ExpandableElementRow } from './pca/ExpandableElementRow';

// ============================================================================
// MAIN COMPONENT
// ============================================================================

// Inverse normal CDF approximation for probability plots
function inverseNormalCDF(p: number): number {
  if (p <= 0 || p >= 1) return p < 0.5 ? -6 : 6;

  const c0 = 2.515517;
  const c1 = 0.802853;
  const c2 = 0.010328;
  const d1 = 1.432788;
  const d2 = 0.189269;
  const d3 = 0.001308;

  const t = p < 0.5 ? Math.sqrt(-2 * Math.log(p)) : Math.sqrt(-2 * Math.log(1 - p));
  const numerator = c0 + c1 * t + c2 * t * t;
  const denominator = 1 + d1 * t + d2 * t * t + d3 * t * t * t;
  const z = t - numerator / denominator;

  return p < 0.5 ? -z : z;
}

export const PCAWorkflow: React.FC = () => {
  const { data, addColumn, getFilteredColumns, geochemMappings } = useAppStore();
  const filteredColumns = getFilteredColumns();
  const attributeColor = useAttributeStore((s) => s.color);
  const { setField: setAttributeField, setEntries: setAttributeEntries } = useAttributeStore();

  const {
    fullPcaResult,
    pcaSelectedElements,
    elementQualityInfo,
    zeroStrategy,
    isProcessing,
    error,
    setPcaSelectedElements,
    setZeroStrategy,
    runElementQualityAssessment,
    runFullPCA,
    clearFullPcaResult,
  } = useTransformationStore();

  const [activeStep, setActiveStep] = useState(0);
  const [nComponents, setNComponents] = useState(8);
  const [resultsTab, setResultsTab] = useState(0);
  const [expandedElement, setExpandedElement] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'info' | 'warning' }>({
    open: false, message: '', severity: 'success',
  });

  // Shared association analysis state (lifted from AssociationResults)
  const [associationAnalyses, setAssociationAnalyses] = useState<PCAssociationAnalysis[]>([]);
  const [loadingThreshold] = useState(0.3);

  // Active colour scale detection
  const activeColorScale = useMemo(() => {
    const field = attributeColor.field;
    if (!field || (!field.startsWith('PC') && !field.startsWith('negPC'))) return null;
    const method = attributeColor.method;
    const numClasses = attributeColor.entries.filter((e) => !e.isDefault).length;
    const methodLabels: Record<string, string> = { quantile: 'quantile', jenks: 'Jenks', equal: 'equal interval', categorical: 'categorical', manual: 'manual' };
    return {
      field,
      description: `${field} (${numClasses} classes, ${methodLabels[method] || method})`,
    };
  }, [attributeColor]);

  // Get style arrays for probability plots (respects visibility and coloring)
  const styleArrays = useMemo(() => getStyleArrays(data), [data]);

  // Get numeric columns from filtered set (respects RAW/CLR filter)
  const numericColumns = useMemo(
    () =>
      sortColumnsByPriority(
        filteredColumns.filter(
          (c) => c.type === 'numeric' || c.type === 'float' || c.type === 'integer'
        )
      ),
    [filteredColumns]
  );

  // Identify non-element columns (coordinates, depth, weights, etc.)
  const nonElementColumns = useMemo(() => {
    const set = new Set<string>();
    for (const col of numericColumns) {
      // If geochem mappings exist, use them as source of truth
      const mapping = geochemMappings.find(m => m.originalName === col.name);
      if (mapping) {
        // Column was classified in chemistry dialog
        if (mapping.isExcluded || mapping.category === 'nonGeochemical') {
          set.add(col.name);
        }
        // Otherwise it's a recognized geochemical column - don't add to non-elements
      } else {
        // No mapping exists - fall back to heuristic detection
        if (isNonElementColumn(col.name, col.role)) {
          set.add(col.name);
        }
      }
    }
    return set;
  }, [numericColumns, geochemMappings]);

  // After quality assessment auto-selects elements, filter out non-element columns
  useEffect(() => {
    if (elementQualityInfo.length > 0 && nonElementColumns.size > 0) {
      const filtered = pcaSelectedElements.filter((e) => !nonElementColumns.has(e));
      if (filtered.length !== pcaSelectedElements.length) {
        setPcaSelectedElements(filtered);
      }
    }
  // Only run when elementQualityInfo changes (i.e. after quality assessment)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elementQualityInfo]);

  // Compute association analyses when PCA result changes
  useEffect(() => {
    if (!fullPcaResult || !fullPcaResult.columns) {
      setAssociationAnalyses([]);
      return;
    }

    // Use stored geochem mappings if available, otherwise auto-detect
    const mappings = geochemMappings.length > 0
      ? geochemMappings.filter(m => fullPcaResult.columns.includes(m.originalName))
      : createElementMappings(fullPcaResult.columns);
    const summary = getMappingSummary(mappings);

    // Build element mapping map
    let elementMappingMap: Map<string, string>;
    if (summary.low === 0 && summary.unknown === 0) {
      // All high/medium confidence
      elementMappingMap = buildMappingMap(mappings);
    } else {
      // Use only high confidence mappings
      elementMappingMap = buildMappingMap(mappings.filter((m) => m.confidence === 'high'));
    }

    // Run association matching
    const options: MatchingOptions = {
      loadingThreshold,
      maxMatches: 5,
      minimumConfidence: 25,
      applyDiscrimination: true,
      elementMapping: elementMappingMap.size > 0 ? elementMappingMap : undefined,
    };

    const analyses = matchAssociations(fullPcaResult, options);
    setAssociationAnalyses(analyses);
  }, [fullPcaResult, loadingThreshold, geochemMappings]);

  // Step handlers
  const handleNext = () => setActiveStep((prev) => prev + 1);
  const handleBack = () => setActiveStep((prev) => prev - 1);
  const handleReset = () => {
    setActiveStep(0);
    clearFullPcaResult();
    setAssociationAnalyses([]);
  };

  // Element selection handlers
  const handleAssessQuality = useCallback(() => {
    const columnNames = numericColumns.map((c) => c.name);
    runElementQualityAssessment(data, columnNames);
  }, [data, numericColumns, runElementQualityAssessment]);

  const handleToggleElement = useCallback(
    (element: string) => {
      if (pcaSelectedElements.includes(element)) {
        setPcaSelectedElements(pcaSelectedElements.filter((e) => e !== element));
      } else {
        setPcaSelectedElements([...pcaSelectedElements, element]);
      }
    },
    [pcaSelectedElements, setPcaSelectedElements]
  );

  const handleSelectAllGoodQuality = useCallback(() => {
    const goodElements = elementQualityInfo
      .filter((q) => q.isAcceptable && !nonElementColumns.has(q.element))
      .map((q) => q.element);
    setPcaSelectedElements(goodElements);
  }, [elementQualityInfo, nonElementColumns, setPcaSelectedElements]);

  const handleSelectAll = useCallback(() => {
    setPcaSelectedElements(elementQualityInfo
      .filter((q) => !nonElementColumns.has(q.element))
      .map((q) => q.element));
  }, [elementQualityInfo, nonElementColumns, setPcaSelectedElements]);

  const handleClearSelection = useCallback(() => {
    setPcaSelectedElements([]);
  }, [setPcaSelectedElements]);

  const handleExpandToggle = useCallback((element: string) => {
    setExpandedElement((prev) => (prev === element ? null : element));
  }, []);

  // Generate probability plot data for an element
  const getProbabilityPlotData = useCallback(
    (columnName: string) => {
      const valuesWithColors: { value: number; color: string }[] = [];
      for (let i = 0; i < data.length; i++) {
        if (styleArrays.visible[i]) {
          const v = data[i][columnName];
          if (v != null && !isNaN(v)) {
            valuesWithColors.push({ value: Number(v), color: styleArrays.colors[i] });
          }
        }
      }

      valuesWithColors.sort((a, b) => a.value - b.value);
      const sorted = valuesWithColors.map((v) => v.value);
      const colors = valuesWithColors.map((v) => v.color);
      const n = sorted.length;

      if (n === 0) return null;

      const theoreticalQuantiles = sorted.map((_, i) => {
        const p = (i + 0.5) / n;
        return inverseNormalCDF(p);
      });

      return {
        x: theoreticalQuantiles,
        y: sorted,
        mode: 'markers' as const,
        type: 'scatter' as const,
        marker: { size: 6, color: colors, line: { width: 0 } },
        name: columnName,
      };
    },
    [data, styleArrays]
  );

  // PCA execution
  const handleRunPCA = useCallback(() => {
    if (pcaSelectedElements.length < 2) {
      alert('Please select at least 2 elements');
      return;
    }
    runFullPCA(data, pcaSelectedElements, nComponents);
  }, [data, pcaSelectedElements, nComponents, runFullPCA]);

  // Add PC scores to data
  const handleAddPCScores = useCallback(() => {
    if (!fullPcaResult) return;

    const numPCs = Math.min(nComponents, fullPcaResult.eigenvalues.length);

    for (let i = 0; i < numPCs; i++) {
      // Add positive PC scores
      const pcName = `PC${i + 1}`;
      const pcValues = fullPcaResult.scores.map((row) => row[i]);
      addColumn(pcName, pcValues, 'numeric', 'PCA', 'pca' as any);

      // Add negative PC scores
      const negPcName = `negPC${i + 1}`;
      const negPcValues = fullPcaResult.scores.map((row) => -row[i]);
      addColumn(negPcName, negPcValues, 'numeric', 'PCA', 'pca' as any);
    }

    setSnackbar({
      open: true,
      message: `Added ${numPCs * 2} columns (PC1-PC${numPCs} and negPC1-negPC${numPCs}) to the dataset`,
      severity: 'success',
    });
  }, [fullPcaResult, nComponents, addColumn]);

  // Step content rendering
  const renderStepContent = () => {
    switch (activeStep) {
      case 0:
        return renderElementSelection();
      case 1:
        return renderPCAExecution();
      case 2:
        return renderResults();
      default:
        return null;
    }
  };

  // Step 1: Element Selection
  const renderElementSelection = () => (
    <Box>
      <Typography variant="h6" gutterBottom>
        Step 1: Element Quality Assessment
      </Typography>
      <Typography variant="body2" color="text.secondary" paragraph>
        Assess element quality using probability plots. Elements with Below Detection Limit (BLD)
        values above N-score = -1 should be excluded from PCA to avoid spurious associations.
        Click the expand button on each element to view its probability plot.
      </Typography>

      {elementQualityInfo.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 4 }}>
          <Button
            variant="contained"
            onClick={handleAssessQuality}
            disabled={isProcessing || numericColumns.length === 0}
          >
            {isProcessing ? <CircularProgress size={20} /> : 'Assess Element Quality'}
          </Button>
          <Typography variant="caption" display="block" sx={{ mt: 1 }}>
            This will analyze {numericColumns.length} numeric columns
          </Typography>
        </Box>
      ) : (
        <>
          <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <Button size="small" variant="outlined" onClick={handleSelectAllGoodQuality}>
              Select Good Quality Only
            </Button>
            <Button size="small" variant="outlined" onClick={handleSelectAll}>
              Select All
            </Button>
            <Button size="small" variant="outlined" onClick={handleClearSelection}>
              Clear
            </Button>
            <Chip
              label={`${pcaSelectedElements.length} of ${elementQualityInfo.length} selected${nonElementColumns.size > 0 ? ` (${nonElementColumns.size} non-element excluded)` : ''}`}
              color="primary"
              variant="outlined"
            />
          </Box>

          <Grid container spacing={1}>
            {elementQualityInfo.map((info) => {
              const isExpanded = expandedElement === info.element;
              return (
              <Grid
                item
                xs={12}
                sm={isExpanded ? 12 : 6}
                md={isExpanded ? 12 : 4}
                key={info.element}
              >
                <ExpandableElementRow
                  element={info.element}
                  bldNScore={info.bldNScore}
                  percentBLD={info.percentBLD}
                  isAcceptable={info.isAcceptable}
                  isSelected={pcaSelectedElements.includes(info.element)}
                  onToggle={handleToggleElement}
                  getPlotData={() => getProbabilityPlotData(info.element)}
                  isExpanded={isExpanded}
                  onExpandToggle={handleExpandToggle}
                  isNonElement={nonElementColumns.has(info.element)}
                />
              </Grid>
            );
            })}
          </Grid>

          <Alert severity="info" sx={{ mt: 2 }}>
            Elements with BLD N-score &gt; -1 are flagged in red. Including these elements can
            lead to spurious element associations in PCA. Click the expand button (▼) on any
            element to view its probability plot.
          </Alert>
        </>
      )}
    </Box>
  );

  // Step 2: PCA Execution
  const renderPCAExecution = () => (
    <Box>
      <Typography variant="h6" gutterBottom>
        Step 2: CLR Transformation & PCA
      </Typography>
      <Typography variant="body2" color="text.secondary" paragraph>
        The selected elements will be CLR-transformed and Classical PCA will be performed.
      </Typography>

      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              Selected Elements ({pcaSelectedElements.length})
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 2 }}>
              {pcaSelectedElements.map((elem) => (
                <Chip key={elem} label={elem} size="small" />
              ))}
            </Box>

            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>Zero Handling Strategy</InputLabel>
              <Select
                value={zeroStrategy}
                onChange={(e) => setZeroStrategy(e.target.value as ZeroHandlingStrategy)}
                label="Zero Handling Strategy"
              >
                <MenuItem value="half-min">Half Minimum (recommended)</MenuItem>
                <MenuItem value="small-constant">Small Constant (0.65 x min)</MenuItem>
                <MenuItem value="multiplicative">Multiplicative Replacement</MenuItem>
              </Select>
            </FormControl>

            <Typography gutterBottom>Number of Principal Components: {nComponents}</Typography>
            <Slider
              value={nComponents}
              onChange={(_, value) => setNComponents(value as number)}
              min={2}
              max={Math.min(pcaSelectedElements.length, 15)}
              step={1}
              marks
              valueLabelDisplay="auto"
            />
          </Paper>
        </Grid>

        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2, height: '100%' }}>
            <Typography variant="subtitle2" gutterBottom>
              Analysis Summary
            </Typography>
            <Box sx={{ '& > div': { py: 0.5 } }}>
              <div>
                <strong>Variables:</strong> {pcaSelectedElements.length}
              </div>
              <div>
                <strong>Samples:</strong> {data.length}
              </div>
              <div>
                <strong>Components:</strong> {nComponents}
              </div>
              <div>
                <strong>Transform:</strong> CLR (Centered Log-Ratio)
              </div>
            </Box>
          </Paper>
        </Grid>
      </Grid>

      <Box sx={{ mt: 3, textAlign: 'center' }}>
        <Button
          variant="contained"
          size="large"
          onClick={handleRunPCA}
          disabled={isProcessing || pcaSelectedElements.length < 2}
        >
          {isProcessing ? <CircularProgress size={24} /> : 'Run PCA'}
        </Button>
      </Box>

      {fullPcaResult && (
        <Alert severity="success" sx={{ mt: 2 }}>
          PCA completed! {fullPcaResult.nSamples} samples analyzed.
          {fullPcaResult.zerosReplaced > 0 && ` ${fullPcaResult.zerosReplaced} zeros replaced.`}
          <br />
          PC1 explains {fullPcaResult.varianceExplained[0]?.toFixed(1)}% of variance.
        </Alert>
      )}
    </Box>
  );

  // Step 3: Results
  const renderResults = () => {
    if (!fullPcaResult) {
      return (
        <Alert severity="warning">
          No PCA results available. Please run PCA first.
        </Alert>
      );
    }

    return (
      <Box>
        <Typography variant="h6" gutterBottom>
          Step 3: Results & Visualizations
        </Typography>

        <Box sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button variant="contained" onClick={handleAddPCScores}>
            Add PC Scores to Data
          </Button>
          <PCAReportExport pcaResult={fullPcaResult} />
          {activeColorScale && (
            <Chip
              label={`Active Colour Scale: ${activeColorScale.description}`}
              color="secondary"
              variant="outlined"
              onDelete={() => {
                setAttributeField('color', null);
                setAttributeEntries('color', []);
                setSnackbar({ open: true, message: 'Colour scale cleared', severity: 'info' });
              }}
              deleteIcon={<CloseIcon />}
            />
          )}
        </Box>

        <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
          <Tabs value={resultsTab} onChange={(_, v) => setResultsTab(v)}>
            <Tab label="Scree Plot" />
            <Tab label="Loading Matrix" />
            <Tab label="Eigenvector Plots" />
            <Tab label="Association Analysis" />
          </Tabs>
        </Box>

        {resultsTab === 0 && <ScreePlot pcaResult={fullPcaResult} />}
        {resultsTab === 1 && <SortedLoadingMatrix pcaResult={fullPcaResult} nComponents={nComponents} />}
        {resultsTab === 2 && (
          <RankedEigenvectorPlot
            pcaResult={fullPcaResult}
            nComponents={nComponents}
            associationAnalyses={associationAnalyses}
            showInterpretations={true}
          />
        )}
        {resultsTab === 3 && <AssociationResults pcaResult={fullPcaResult} nComponents={nComponents} />}
      </Box>
    );
  };

  const steps = ['Element Selection', 'Run PCA', 'Results'];

  return (
    <Box sx={{ p: 3, height: '100%', overflow: 'auto' }}>
      <Typography variant="h5" gutterBottom>
        PCA Analysis Workflow
      </Typography>
      <Typography variant="body2" color="text.secondary" paragraph>
        Principal Component Analysis for identifying element associations in geochemical data.
        Based on the Exploration Geochemistry Workshop methodology.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Stepper activeStep={activeStep} sx={{ mb: 3 }}>
        {steps.map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      <Paper sx={{ p: 3 }}>{renderStepContent()}</Paper>

      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 2 }}>
        <Button disabled={activeStep === 0} onClick={handleBack}>
          Back
        </Button>
        <Box>
          {activeStep === steps.length - 1 ? (
            <Button variant="contained" onClick={handleReset}>
              Start New Analysis
            </Button>
          ) : (
            <Button
              variant="contained"
              onClick={handleNext}
              disabled={
                (activeStep === 0 && pcaSelectedElements.length < 2) ||
                (activeStep === 1 && !fullPcaResult)
              }
            >
              Next
            </Button>
          )}
        </Box>
      </Box>

      {/* Snackbar feedback */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={5000}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
          severity={snackbar.severity}
          variant="filled"
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default PCAWorkflow;
