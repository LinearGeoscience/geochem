/**
 * PCA Workflow Component
 *
 * Implements the full PCA analysis workflow from the Exploration Geochemistry Workshop Manual:
 * 1. Element Quality Assessment via probability plots (BLD threshold at N-score = -1)
 * 2. CLR Transformation + Classical PCA with 8 components
 * 3. Results visualization (Scree Plot, Sorted Loading Matrix, Ranked Eigenvector Plots)
 */

import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  Stepper,
  Step,
  StepLabel,
  FormControl,
  FormControlLabel,
  Switch,
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
  Tooltip,
} from '@mui/material';
import FilterListIcon from '@mui/icons-material/FilterList';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import CloseIcon from '@mui/icons-material/Close';
import { useAppStore } from '../../store/appStore';
import { useShallow } from 'zustand/react/shallow';
import { useTransformationStore } from '../../store/transformationStore';
import { useAttributeStore } from '../../store/attributeStore';
import { sortColumnsByPriority, getStyleArrays, getStyleArraysColumnar } from '../../utils/attributeUtils';
import { ZeroHandlingStrategy } from '../../types/compositional';
import { PCAssociationAnalysis, MatchingOptions } from '../../types/associations';
import { matchAssociations } from '../../utils/calculations/associationMatcher';
import {
  createElementMappings,
  buildMappingMap,
  getMappingSummary,
  isNonElementColumn,
  detectElementFromColumnName,
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
  const { data, columns, columnarRowCount, geochemMappings } = useAppStore(useShallow(s => ({
    data: s.data,
    columns: s.columns,
    columnarRowCount: s.columnarData.rowCount,
    geochemMappings: s.geochemMappings,
  })));
  const getFilteredColumns = useAppStore(s => s.getFilteredColumns);
  const getDisplayData = useAppStore(s => s.getDisplayData);
  const getDisplayIndices = useAppStore(s => s.getDisplayIndices);
  const getDisplayColumn = useAppStore(s => s.getDisplayColumn);
  const sampleIndices = useAppStore(s => s.sampleIndices);
  const addColumn = useAppStore(s => s.addColumn);
  const columnFilter = useAppStore(s => s.columnFilter);
  const filteredColumns = useMemo(() => getFilteredColumns(), [columns, columnFilter, getFilteredColumns]);
  const attributeColor = useAttributeStore((s) => s.color);
  const attributeShape = useAttributeStore((s) => s.shape);
  const attributeFilter = useAttributeStore((s) => s.filter);
  const valueFilter = useAttributeStore((s) => s.valueFilter);
  const setAttributeField = useAttributeStore(s => s.setField);
  const setAttributeEntries = useAttributeStore(s => s.setEntries);

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
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [useFilteredData, setUseFilteredData] = useState(false);

  // Original-data indices for each row passed to runFullPCA (so PC scores can be mapped back).
  // Always populated (filtered or not) — length matches the array passed to runFullPCA.
  const pcaInputIndicesRef = useRef<number[] | null>(null);

  // Compute columns per row based on breakpoint for row-based expansion
  const theme = useTheme();
  const isSmDown = useMediaQuery(theme.breakpoints.down('md'));
  const isXsDown = useMediaQuery(theme.breakpoints.down('sm'));
  const columnsPerRow = isXsDown ? 1 : isSmDown ? 2 : 3;
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

  // Display data accounts for sampling; displayIndices maps back to original rows
  const displayData = useMemo(() => getDisplayData(), [data, sampleIndices]);
  const displayIndices = useMemo(() => getDisplayIndices(), [data, sampleIndices]);

  // Get style arrays for probability plots (respects visibility and coloring)
  const styleArrays = useMemo(() => columnarRowCount > 0
    ? getStyleArraysColumnar(displayData.length, (name) => getDisplayColumn(name), displayIndices ?? undefined)
    : getStyleArrays(displayData, displayIndices ?? undefined), [displayData, displayIndices, columnarRowCount, getDisplayColumn]);

  // Compute visible sample count and indices for filtered PCA
  const visibleCount = useMemo(() => {
    let count = 0;
    for (let i = 0; i < styleArrays.visible.length; i++) {
      if (styleArrays.visible[i]) count++;
    }
    return count;
  }, [styleArrays.visible]);

  // Resolve unit-stripped display names for the selected elements.
  // Prefer user's chemistry-dialog mappings (userOverride > detectedElement), fall back to auto-detect.
  const resolveDisplayName = useCallback((col: string): string => {
    const mapping = geochemMappings.find(m => m.originalName === col);
    const fromMapping = mapping?.userOverride ?? mapping?.detectedElement ?? null;
    if (fromMapping) return fromMapping;
    return detectElementFromColumnName(col) ?? col;
  }, [geochemMappings]);

  // Preview: how many rows have a finite numeric value for EVERY selected element?
  // Computed against the candidate set the user is about to feed to PCA.
  const effectiveCompleteCount = useMemo(() => {
    if (pcaSelectedElements.length === 0) return 0;
    const candidates = useFilteredData
      ? displayData.filter((_, i) => styleArrays.visible[i])
      : displayData;
    let count = 0;
    for (const row of candidates) {
      let complete = true;
      for (const col of pcaSelectedElements) {
        const val = row[col];
        if (typeof val !== 'number' || !isFinite(val)) { complete = false; break; }
      }
      if (complete) count++;
    }
    return count;
  }, [displayData, styleArrays.visible, pcaSelectedElements, useFilteredData]);

  const hasActiveFilters = useMemo(() => {
    const descriptions: string[] = [];
    // Check categorical filter field
    if (attributeFilter.field && attributeFilter.entries.some(e => !e.visible)) {
      descriptions.push(attributeFilter.field);
    }
    // Check color entries with hidden items
    if (attributeColor.field && attributeColor.entries.some(e => !e.visible)) {
      descriptions.push(`${attributeColor.field} (colour)`);
    }
    // Check shape entries with hidden items
    if (attributeShape.field && attributeShape.entries.some(e => !e.visible)) {
      descriptions.push(`${attributeShape.field} (shape)`);
    }
    // Check value filter
    if (valueFilter.enabled) {
      descriptions.push(`Value range${valueFilter.column ? ` (${valueFilter.column})` : ''}`);
    }
    return descriptions;
  }, [attributeFilter, attributeColor, attributeShape, valueFilter]);

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

  // Filter elementQualityInfo to only include elements present in current numericColumns (respects column filter)
  const filteredQualityInfo = useMemo(() => {
    if (elementQualityInfo.length === 0) return [];
    const numericNames = new Set(numericColumns.map(c => c.name));
    return elementQualityInfo.filter(info => numericNames.has(info.element));
  }, [elementQualityInfo, numericColumns]);

  // Step 1 always counts against displayData (no visibility filter) — this is the candidate set
  // for which the per-element coverage chip's denominator is `displayData.length`.
  const step1CompleteCount = useMemo(() => {
    if (pcaSelectedElements.length === 0) return 0;
    let count = 0;
    for (let i = 0; i < displayData.length; i++) {
      const row = displayData[i];
      let complete = true;
      for (const col of pcaSelectedElements) {
        const val = row[col];
        if (typeof val !== 'number' || !isFinite(val)) { complete = false; break; }
      }
      if (complete) count++;
    }
    return count;
  }, [displayData, pcaSelectedElements]);

  // For each unselected element, how many complete cases would survive if added?
  // Uses a precomputed completeness mask for the current selection — O(N_rows × N_columns).
  const wouldDropToByElement = useMemo(() => {
    const map = new Map<string, number>();
    if (pcaSelectedElements.length === 0) return map;

    const completeMask = new Uint8Array(displayData.length);
    for (let i = 0; i < displayData.length; i++) {
      let complete = true;
      for (const col of pcaSelectedElements) {
        const val = displayData[i][col];
        if (typeof val !== 'number' || !isFinite(val)) { complete = false; break; }
      }
      completeMask[i] = complete ? 1 : 0;
    }

    for (const col of numericColumns) {
      if (pcaSelectedElements.includes(col.name)) continue;
      if (nonElementColumns.has(col.name)) continue;

      let count = 0;
      for (let i = 0; i < displayData.length; i++) {
        if (!completeMask[i]) continue;
        const val = displayData[i][col.name];
        if (typeof val === 'number' && isFinite(val)) count++;
      }
      map.set(col.name, count);
    }

    return map;
  }, [displayData, pcaSelectedElements, numericColumns, nonElementColumns]);

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

  // Element selection handlers — use displayData so counts/BLD match what PCA will actually consume
  const handleAssessQuality = useCallback(() => {
    const columnNames = numericColumns.map((c) => c.name);
    runElementQualityAssessment(displayData, columnNames);
  }, [displayData, numericColumns, runElementQualityAssessment]);

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
    const goodElements = filteredQualityInfo
      .filter((q) => q.isAcceptable && !nonElementColumns.has(q.element))
      .map((q) => q.element);
    setPcaSelectedElements(goodElements);
  }, [filteredQualityInfo, nonElementColumns, setPcaSelectedElements]);

  const handleSelectAll = useCallback(() => {
    setPcaSelectedElements(filteredQualityInfo
      .filter((q) => !nonElementColumns.has(q.element))
      .map((q) => q.element));
  }, [filteredQualityInfo, nonElementColumns, setPcaSelectedElements]);

  const handleClearSelection = useCallback(() => {
    setPcaSelectedElements([]);
  }, [setPcaSelectedElements]);

  const handleExpandToggle = useCallback((_element: string, index: number) => {
    const rowIdx = Math.floor(index / columnsPerRow);
    setExpandedRow((prev) => (prev === rowIdx ? null : rowIdx));
  }, [columnsPerRow]);

  // Generate probability plot data for an element
  const getProbabilityPlotData = useCallback(
    (columnName: string) => {
      const valuesWithColors: { value: number; color: string }[] = [];
      for (let i = 0; i < displayData.length; i++) {
        if (styleArrays.visible[i]) {
          const v = displayData[i][columnName];
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

    const displayNames = pcaSelectedElements.map(resolveDisplayName);

    if (useFilteredData) {
      // Build filtered data and track original-data indices for each row passed to PCA
      const inputIndices: number[] = [];
      const filtered: Record<string, any>[] = [];
      for (let i = 0; i < displayData.length; i++) {
        if (styleArrays.visible[i]) {
          inputIndices.push(displayIndices ? displayIndices[i] : i);
          filtered.push(displayData[i]);
        }
      }
      pcaInputIndicesRef.current = inputIndices;
      runFullPCA(filtered, pcaSelectedElements, nComponents, displayNames);
    } else {
      // Unfiltered — but displayData may still be a sample of `data`, so map through displayIndices
      const inputIndices: number[] = displayIndices
        ? Array.from(displayIndices)
        : displayData.map((_, i) => i);
      pcaInputIndicesRef.current = inputIndices;
      runFullPCA(displayData, pcaSelectedElements, nComponents, displayNames);
    }
  }, [displayData, displayIndices, pcaSelectedElements, nComponents, runFullPCA, useFilteredData, styleArrays.visible, resolveDisplayName]);

  // Add PC scores to data
  const handleAddPCScores = useCallback(() => {
    if (!fullPcaResult) return;

    const numPCs = Math.min(nComponents, fullPcaResult.eigenvalues.length);
    const inputIndices = pcaInputIndicesRef.current;
    const { keptIndices, scores } = fullPcaResult;

    if (!inputIndices || keptIndices.length !== scores.length) {
      // Defensive: refuse to write misaligned scores
      setSnackbar({
        open: true,
        message: 'Could not add PC scores — row mapping is inconsistent. Please re-run PCA.',
        severity: 'warning',
      });
      return;
    }

    for (let i = 0; i < numPCs; i++) {
      const pcValues: (number | null)[] = new Array(data.length).fill(NaN);
      const negPcValues: (number | null)[] = new Array(data.length).fill(NaN);

      // For each CLR row j, the global data index is inputIndices[keptIndices[j]].
      // Rows excluded by complete-case filter or visibility filter remain NaN.
      for (let j = 0; j < scores.length; j++) {
        const globalIdx = inputIndices[keptIndices[j]];
        if (globalIdx == null || globalIdx < 0 || globalIdx >= data.length) continue;
        pcValues[globalIdx] = scores[j][i];
        negPcValues[globalIdx] = -scores[j][i];
      }

      const pcName = `PC${i + 1}`;
      addColumn(pcName, pcValues, 'numeric', 'PCA', 'pca' as any);

      const negPcName = `negPC${i + 1}`;
      addColumn(negPcName, negPcValues, 'numeric', 'PCA', 'pca' as any);
    }

    setSnackbar({
      open: true,
      message: `Added ${numPCs * 2} columns (PC1-PC${numPCs} and negPC1-negPC${numPCs}) to the dataset (${scores.length} of ${data.length} samples populated)`,
      severity: 'success',
    });
  }, [fullPcaResult, nComponents, addColumn, data.length]);

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
      ) : filteredQualityInfo.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 4 }}>
          <Alert severity="info" sx={{ mb: 2 }}>
            No assessed elements match the current column filter. Try changing the filter at the top of the page, or re-run the assessment for the current filter.
          </Alert>
          <Button
            variant="contained"
            onClick={handleAssessQuality}
            disabled={isProcessing || numericColumns.length === 0}
          >
            {isProcessing ? <CircularProgress size={20} /> : 'Re-assess Element Quality'}
          </Button>
          <Typography variant="caption" display="block" sx={{ mt: 1 }}>
            This will analyze {numericColumns.length} numeric columns in the current filter
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
              label={`${pcaSelectedElements.length} of ${filteredQualityInfo.length} selected${nonElementColumns.size > 0 ? ` (${nonElementColumns.size} non-element excluded)` : ''}`}
              color="primary"
              variant="outlined"
            />
            {pcaSelectedElements.length >= 2 && displayData.length > 0 && (() => {
              const ratio = step1CompleteCount / displayData.length;
              const color: 'success' | 'warning' | 'error' = ratio >= 0.5 ? 'success' : ratio >= 0.2 ? 'warning' : 'error';
              return (
                <Tooltip title={`After complete-case filtering, ${step1CompleteCount.toLocaleString()} of ${displayData.length.toLocaleString()} candidate samples will be used by PCA.`}>
                  <Chip
                    label={`Complete cases: ${step1CompleteCount.toLocaleString()} of ${displayData.length.toLocaleString()}`}
                    color={color}
                    variant="filled"
                    size="small"
                  />
                </Tooltip>
              );
            })()}
          </Box>

          <Grid container spacing={1}>
            {filteredQualityInfo.map((info, index) => {
              const rowIndex = Math.floor(index / columnsPerRow);
              const isExpanded = expandedRow === rowIndex;
              return (
              <Grid
                item
                xs={12}
                sm={6}
                md={4}
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
                  onExpandToggle={(el) => handleExpandToggle(el, index)}
                  isNonElement={nonElementColumns.has(info.element)}
                  totalCount={info.totalCount}
                  totalSamples={displayData.length}
                  wouldDropTo={wouldDropToByElement.get(info.element) ?? null}
                  currentCompleteCases={step1CompleteCount}
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
  const renderPCAExecution = () => {
    const candidateCount = useFilteredData ? visibleCount : displayData.length;
    const droppedPreview = candidateCount - effectiveCompleteCount;
    const dropFraction = candidateCount > 0 ? droppedPreview / candidateCount : 0;

    return (
    <Box>
      <Typography variant="h6" gutterBottom>
        Step 2: CLR Transformation & PCA
      </Typography>
      <Typography variant="body2" color="text.secondary" paragraph>
        The selected elements will be CLR-transformed and Classical PCA will be performed.
      </Typography>

      {/* Data filter toggle */}
      <Paper sx={{ p: 2, mb: 2, border: useFilteredData ? 2 : 1, borderColor: useFilteredData ? 'primary.main' : 'divider' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
          <FilterListIcon color={useFilteredData ? 'primary' : 'disabled'} />
          <Tooltip title="When enabled, PCA will only run on samples that are currently visible (respecting all active filters, colour/shape visibility, and value range filters)">
            <FormControlLabel
              control={
                <Switch
                  checked={useFilteredData}
                  onChange={(e) => setUseFilteredData(e.target.checked)}
                />
              }
              label="Use visible data only"
            />
          </Tooltip>
          {useFilteredData && (
            <Chip
              label={`${visibleCount.toLocaleString()} of ${displayData.length.toLocaleString()} samples`}
              color="primary"
              size="small"
              variant="outlined"
            />
          )}
        </Box>
        {useFilteredData && hasActiveFilters.length > 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block', ml: 5.5 }}>
            Active filters: {hasActiveFilters.join(', ')}
          </Typography>
        )}
        {useFilteredData && hasActiveFilters.length === 0 && visibleCount === displayData.length && (
          <Typography variant="caption" color="warning.main" sx={{ mt: 0.5, display: 'block', ml: 5.5 }}>
            No filters are currently active — all samples will be used
          </Typography>
        )}
      </Paper>

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
                <strong>Candidate samples:</strong>{' '}
                {useFilteredData
                  ? <>{visibleCount.toLocaleString()} <Typography component="span" variant="body2" color="text.secondary">(of {displayData.length.toLocaleString()} visible)</Typography></>
                  : displayData.length.toLocaleString()
                }
              </div>
              <div>
                <strong>Complete cases:</strong>{' '}
                <Typography component="span" sx={{ color: dropFraction > 0.3 ? 'warning.main' : 'success.main', fontWeight: 600 }}>
                  {effectiveCompleteCount.toLocaleString()}
                </Typography>
                {droppedPreview > 0 && (
                  <Typography component="span" variant="body2" color="text.secondary">
                    {' '}({droppedPreview.toLocaleString()} dropped — at least one selected element is null)
                  </Typography>
                )}
              </div>
              <div>
                <strong>Components:</strong> {nComponents}
              </div>
              <div>
                <strong>Transform:</strong> CLR (Centered Log-Ratio)
              </div>
            </Box>
            {dropFraction > 0.3 && (
              <Alert severity="warning" sx={{ mt: 1 }}>
                Over {Math.round(dropFraction * 100)}% of candidate samples will be dropped for missing data. Consider deselecting elements with limited coverage.
              </Alert>
            )}
          </Paper>
        </Grid>
      </Grid>

      <Box sx={{ mt: 3, textAlign: 'center' }}>
        <Button
          variant="contained"
          size="large"
          onClick={handleRunPCA}
          disabled={isProcessing || pcaSelectedElements.length < 2 || effectiveCompleteCount < 2}
        >
          {isProcessing
            ? <CircularProgress size={24} />
            : `Run PCA (${effectiveCompleteCount.toLocaleString()} complete cases)`}
        </Button>
      </Box>

      {fullPcaResult && (
        <Alert severity="success" sx={{ mt: 2 }}>
          PCA completed: {fullPcaResult.nSamples.toLocaleString()} complete cases analysed.
          {fullPcaResult.nDropped > 0 && ` ${fullPcaResult.nDropped.toLocaleString()} rows dropped for missing elements.`}
          {fullPcaResult.zerosReplaced > 0 && ` ${fullPcaResult.zerosReplaced.toLocaleString()} BLD zeros replaced.`}
          <br />
          PC1 explains {fullPcaResult.varianceExplained[0]?.toFixed(1)}% of variance.
        </Alert>
      )}
    </Box>
    );
  };

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
