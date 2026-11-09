/**
 * PCA Workflow Component
 *
 * Implements the full PCA analysis workflow from the Exploration Geochemistry Workshop Manual:
 * 1. Element Quality Assessment via probability plots (BLD threshold at N-score = -1)
 * 2. CLR Transformation + Classical PCA with 8 components
 * 3. Results visualization (Scree Plot, Sorted Loading Matrix, Ranked Eigenvector Plots)
 *
 * The step, settings and result live in the transformation store, so leaving
 * Analysis and coming back returns to the same place; the results can also be
 * opened in a plot window (PCAResultsPanel).
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
  Grid,
  Chip,
  Tooltip,
} from '@mui/material';
import FilterListIcon from '@mui/icons-material/FilterList';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useAppStore, useDisplayRows } from '../../store/appStore';
import { useShallow } from 'zustand/react/shallow';
import { useTransformationStore } from '../../store/transformationStore';
import { useAttributeStore } from '../../store/attributeStore';
import { useStyleInputs } from '../../hooks/useStyleInputs';
import { sortColumnsByPriority, getStyleArraysColumnar } from '../../utils/attributeUtils';
import { ZeroHandlingStrategy } from '../../types/compositional';
import type { PCATransform } from '../../utils/calculations/pcaAnalysis';

const TRANSFORM_LABELS: Record<PCATransform, string> = {
  clr: 'CLR (centred log-ratio) — raw element columns',
  none: 'None — inputs already transformed (e.g. CLR columns)',
  log10: 'Log10',
};
import {
  isNonElementColumn,
  detectElementFromColumnName,
} from '../../utils/calculations/elementNameNormalizer';

import { PCAResultsPanel } from './pca/PCAResultsPanel';
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
  const geochemMappings = useAppStore(s => s.geochemMappings);
  const getDisplayColumn = useAppStore(s => s.getDisplayColumn);
  // Shallow-compared selector: re-renders only when the filtered list changes
  const filteredColumns = useAppStore(useShallow(s => s.getFilteredColumns()));
  const attributeColor = useAttributeStore((s) => s.color);
  const attributeShape = useAttributeStore((s) => s.shape);
  const attributeFilter = useAttributeStore((s) => s.filter);
  const valueFilter = useAttributeStore((s) => s.valueFilter);

  const {
      fullPcaResult,
      pcaRowBasis,
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
      pcaUi,
      setPcaUi,
  } = useTransformationStore(useShallow(s => ({
      fullPcaResult: s.fullPcaResult,
      pcaRowBasis: s.pcaRowBasis,
      pcaSelectedElements: s.pcaSelectedElements,
      elementQualityInfo: s.elementQualityInfo,
      zeroStrategy: s.zeroStrategy,
      isProcessing: s.isProcessing,
      error: s.error,
      setPcaSelectedElements: s.setPcaSelectedElements,
      setZeroStrategy: s.setZeroStrategy,
      runElementQualityAssessment: s.runElementQualityAssessment,
      runFullPCA: s.runFullPCA,
      clearFullPcaResult: s.clearFullPcaResult,
      pcaUi: s.pcaUi,
      setPcaUi: s.setPcaUi,
  })));

  const { step: activeStep, nComponents, transform: pcaTransform, useFilteredData } = pcaUi;
  const setActiveStep = (step: number) => setPcaUi({ step });
  const setNComponents = (n: number) => setPcaUi({ nComponents: n });
  // PCA "Transform": CLR inputs must use None (CLR of CLR distorts the result)
  const setPcaTransform = (transform: PCATransform) => setPcaUi({ transform });
  const setUseFilteredData = (on: boolean) => setPcaUi({ useFilteredData: on });
  const storeColumns = useAppStore(s => s.columns);
  const clrInputs = useMemo(() => {
    const info = new Map(storeColumns.map(c => [c.name, c]));
    return pcaSelectedElements.filter(n => info.get(n)?.transformationType === 'clr' || /[-_ ]clr$/i.test(n));
  }, [storeColumns, pcaSelectedElements]);
  const allClrInputs = pcaSelectedElements.length > 0 && clrInputs.length === pcaSelectedElements.length;
  useEffect(() => {
    if (allClrInputs) setPcaUi({ transform: 'none' });
  }, [allClrInputs, setPcaUi]);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  // Compute columns per row based on breakpoint for row-based expansion
  const theme = useTheme();
  const isSmDown = useMediaQuery(theme.breakpoints.down('md'));
  const isXsDown = useMediaQuery(theme.breakpoints.down('sm'));
  const columnsPerRow = isXsDown ? 1 : isSmDown ? 2 : 3;

  // Display data accounts for sampling; displayIndices maps back to original rows
  const displayData = useDisplayRows();
  const displayIndices = useAppStore(s => s._sampleIndicesArray);

  // Get style arrays for probability plots (respects visibility and coloring)
  const styleInputs = useStyleInputs();
  const styleArrays = useMemo(() => {
    void styleInputs;
    return getStyleArraysColumnar(displayData.length, (name) => getDisplayColumn(name), displayIndices ?? undefined);
  }, [displayData, displayIndices, getDisplayColumn, styleInputs]);

  // Compute visible sample count and indices for filtered PCA
  const { visibleCount, visibleKey } = useMemo(() => {
    let count = 0, h = 0;
    for (let i = 0; i < styleArrays.visible.length; i++) {
      if (styleArrays.visible[i]) { count++; h = (Math.imul(h, 31) + i) | 0; }
    }
    return { visibleCount: count, visibleKey: `${count}:${h}` };
  }, [styleArrays.visible]);

  // The samples PCA works on: all, or only the visible ones (hidden groups / filters left out).
  // Element quality, coverage and complete cases in Step 1 are counted on the same rows.
  const candidateKey = useFilteredData ? visibleKey : 'all';
  const candidateRows = useMemo(
    () => (useFilteredData ? displayData.filter((_, i) => styleArrays.visible[i]) : displayData),
    // candidateKey stands for styleArrays.visible (which changes identity on any style edit)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [displayData, candidateKey]
  );

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

  /** Why the Run button is disabled, in words */
  const runBlockedReason = useMemo((): string | null => {
    if (pcaSelectedElements.length < 2) return 'Select at least 2 elements.';
    if (effectiveCompleteCount >= 2) return null;
    const pool = useFilteredData ? styleArrays.visible.filter(Boolean).length : displayData.length;
    if (useFilteredData && pool === 0) return 'No rows are visible: classes are hidden in the Attribute Manager (see the status bar), or switch off "visible groups only".';
    return `Only ${effectiveCompleteCount} of ${pool.toLocaleString()} ${useFilteredData ? 'visible ' : ''}samples have values for every selected element.`;
  }, [pcaSelectedElements.length, effectiveCompleteCount, useFilteredData, styleArrays.visible, displayData.length]);

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
  const { filteredQualityInfo, notAnalysed } = useMemo(() => {
    if (elementQualityInfo.length === 0) return { filteredQualityInfo: [], notAnalysed: [] as string[] };
    const numericNames = new Set(numericColumns.map(c => c.name));
    const inFilter = elementQualityInfo.filter(info => numericNames.has(info.element));
    // Columns with no value at all in the candidate rows (e.g. elements not in the visible protocol)
    return {
      filteredQualityInfo: inFilter.filter(info => info.totalCount > 0),
      notAnalysed: inFilter.filter(info => info.totalCount === 0 && !nonElementColumns.has(info.element)).map(info => info.element),
    };
  }, [elementQualityInfo, numericColumns, nonElementColumns]);

  // Step 1 counts against the candidate rows (all, or visible only) — the denominator of the
  // per-element coverage chip is `candidateRows.length`.
  const step1CompleteCount = useMemo(() => {
    if (pcaSelectedElements.length === 0) return 0;
    let count = 0;
    for (let i = 0; i < candidateRows.length; i++) {
      const row = candidateRows[i];
      let complete = true;
      for (const col of pcaSelectedElements) {
        const val = row[col];
        if (typeof val !== 'number' || !isFinite(val)) { complete = false; break; }
      }
      if (complete) count++;
    }
    return count;
  }, [candidateRows, pcaSelectedElements]);

  // For each unselected element, how many complete cases would survive if added?
  // Uses a precomputed completeness mask for the current selection — O(N_rows × N_columns).
  const wouldDropToByElement = useMemo(() => {
    const map = new Map<string, number>();
    if (pcaSelectedElements.length === 0) return map;

    const completeMask = new Uint8Array(candidateRows.length);
    for (let i = 0; i < candidateRows.length; i++) {
      let complete = true;
      for (const col of pcaSelectedElements) {
        const val = candidateRows[i][col];
        if (typeof val !== 'number' || !isFinite(val)) { complete = false; break; }
      }
      completeMask[i] = complete ? 1 : 0;
    }

    for (const col of numericColumns) {
      if (pcaSelectedElements.includes(col.name)) continue;
      if (nonElementColumns.has(col.name)) continue;

      let count = 0;
      for (let i = 0; i < candidateRows.length; i++) {
        if (!completeMask[i]) continue;
        const val = candidateRows[i][col.name];
        if (typeof val === 'number' && isFinite(val)) count++;
      }
      map.set(col.name, count);
    }

    return map;
  }, [candidateRows, pcaSelectedElements, numericColumns, nonElementColumns]);

  // After quality assessment auto-selects elements, filter out non-element
  // columns. Runs only when elementQualityInfo changes (so a later manual
  // selection of a non-element column is respected); the other values are
  // read through a ref.
  const autoFilterInputs = useRef({ nonElementColumns, pcaSelectedElements, setPcaSelectedElements });
  autoFilterInputs.current = { nonElementColumns, pcaSelectedElements, setPcaSelectedElements };
  useEffect(() => {
    const { nonElementColumns, pcaSelectedElements, setPcaSelectedElements } = autoFilterInputs.current;
    if (elementQualityInfo.length > 0 && nonElementColumns.size > 0) {
      const filtered = pcaSelectedElements.filter((e) => !nonElementColumns.has(e));
      if (filtered.length !== pcaSelectedElements.length) {
        setPcaSelectedElements(filtered);
      }
    }
  }, [elementQualityInfo]);

  // Step handlers
  const handleNext = () => setActiveStep(activeStep + 1);
  const handleBack = () => setActiveStep(activeStep - 1);
  const handleReset = () => {
    setActiveStep(0);
    clearFullPcaResult();
  };

  // Element selection handlers — assess the candidate rows so counts/BLD match what PCA will consume
  const handleAssessQuality = useCallback(() => {
    const columnNames = numericColumns.map((c) => c.name);
    runElementQualityAssessment(candidateRows, columnNames);
  }, [candidateRows, numericColumns, runElementQualityAssessment]);

  // When the candidate rows change (visible-only switched, groups shown / hidden), re-assess on
  // the new rows. The user's picks are kept, minus elements with no values in the new rows.
  const reassessInputs = useRef({ candidateRows, numericColumns, pcaSelectedElements, elementQualityInfo });
  reassessInputs.current = { candidateRows, numericColumns, pcaSelectedElements, elementQualityInfo };
  const lastCandidateKey = useRef(candidateKey);
  useEffect(() => {
    if (lastCandidateKey.current === candidateKey) return;
    lastCandidateKey.current = candidateKey;
    const { candidateRows, numericColumns, pcaSelectedElements: kept, elementQualityInfo } = reassessInputs.current;
    if (!elementQualityInfo.length) return;
    runElementQualityAssessment(candidateRows, numericColumns.map((c) => c.name));
    if (kept.length) {
      const analysed = new Set(useTransformationStore.getState().elementQualityInfo.filter(q => q.totalCount > 0).map(q => q.element));
      setPcaSelectedElements(kept.filter(e => analysed.has(e)));
    }
  }, [candidateKey, runElementQualityAssessment, setPcaSelectedElements]);

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
    [displayData, styleArrays]
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
      runFullPCA(filtered, pcaSelectedElements, nComponents, displayNames, pcaTransform, inputIndices, 'visible');
    } else {
      // Unfiltered — but displayData may still be a sample of `data`, so map through displayIndices
      const inputIndices: number[] = displayIndices
        ? Array.from(displayIndices)
        : displayData.map((_, i) => i);
      runFullPCA(displayData, pcaSelectedElements, nComponents, displayNames, pcaTransform, inputIndices, 'all');
    }
  }, [displayData, displayIndices, pcaSelectedElements, nComponents, runFullPCA, useFilteredData, styleArrays.visible, resolveDisplayName, pcaTransform]);

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

      {renderSampleSwitch()}

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
            {pcaSelectedElements.length >= 2 && candidateRows.length > 0 && (() => {
              const ratio = step1CompleteCount / candidateRows.length;
              const color: 'success' | 'warning' | 'error' = ratio >= 0.5 ? 'success' : ratio >= 0.2 ? 'warning' : 'error';
              return (
                <Tooltip title={`After complete-case filtering, ${step1CompleteCount.toLocaleString()} of ${candidateRows.length.toLocaleString()} candidate samples will be used by PCA.`}>
                  <Chip
                    label={`Complete cases: ${step1CompleteCount.toLocaleString()} of ${candidateRows.length.toLocaleString()}`}
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
                  totalSamples={candidateRows.length}
                  wouldDropTo={wouldDropToByElement.get(info.element) ?? null}
                  currentCompleteCases={step1CompleteCount}
                />
              </Grid>
            );
            })}
          </Grid>

          {notAnalysed.length > 0 && (
            <Alert severity="info" variant="outlined" sx={{ mt: 2 }}>
              <strong>Not assayed in {useFilteredData ? 'the visible samples' : 'any sample'} ({notAnalysed.length}):</strong> {notAnalysed.join(', ')}
            </Alert>
          )}

          <Alert severity="info" sx={{ mt: 2 }}>
            Elements with BLD N-score &gt; -1 are flagged in red. Including these elements can
            lead to spurious element associations in PCA. Click the expand button (▼) on any
            element to view its probability plot.
          </Alert>
        </>
      )}
    </Box>
  );

  // Which samples PCA uses — shown on Step 1 (so element quality matches) and Step 2
  const renderSampleSwitch = () => (
    <Paper sx={{ p: 2, mb: 2, border: useFilteredData ? 2 : 1, borderColor: useFilteredData ? 'primary.main' : 'divider' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <FilterListIcon color={useFilteredData ? 'primary' : 'disabled'} />
        <Tooltip title="When enabled, element quality and PCA use only the samples currently visible (hidden colour / shape classes, filters and value ranges are left out)">
          <FormControlLabel
            control={<Switch checked={useFilteredData} onChange={(e) => setUseFilteredData(e.target.checked)} />}
            label="Use visible data only"
          />
        </Tooltip>
        {useFilteredData && (
          <Chip label={`${visibleCount.toLocaleString()} of ${displayData.length.toLocaleString()} samples`} color="primary" size="small" variant="outlined" />
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
      {!useFilteredData && visibleCount < displayData.length && (
        <Typography variant="caption" color="warning.main" sx={{ mt: 0.5, display: 'block', ml: 5.5 }}>
          {(displayData.length - visibleCount).toLocaleString()} samples are hidden ({hasActiveFilters.join(', ') || 'filters'}) but would still be used — switch on to work on the visible groups only.
        </Typography>
      )}
    </Paper>
  );

  // Step 2: PCA Execution
  const renderPCAExecution = () => {
    const candidateCount = useFilteredData ? visibleCount : displayData.length;
    const droppedPreview = candidateCount - effectiveCompleteCount;
    const dropFraction = candidateCount > 0 ? droppedPreview / candidateCount : 0;

    return (
    <Box>
      <Typography variant="h6" gutterBottom>
        Step 2: Transform &amp; Classical PCA
      </Typography>
      <Typography variant="body2" color="text.secondary" paragraph>
        Classical PCA on the correlation matrix ("Scaling true"). Choose CLR for raw element columns, or None when the
        inputs are already CLR columns.
      </Typography>

      {renderSampleSwitch()}

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
              <InputLabel>Transform</InputLabel>
              <Select
                value={pcaTransform}
                onChange={(e) => setPcaTransform(e.target.value as PCATransform)}
                label="Transform"
              >
                {(Object.keys(TRANSFORM_LABELS) as PCATransform[]).map(t => (
                  <MenuItem key={t} value={t}>{TRANSFORM_LABELS[t]}</MenuItem>
                ))}
              </Select>
            </FormControl>
            {pcaTransform === 'clr' && clrInputs.length > 0 && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                {clrInputs.length} input{clrInputs.length > 1 ? 's look' : ' looks'} like CLR columns ({clrInputs.slice(0, 4).join(', ')}{clrInputs.length > 4 ? '…' : ''}).
                Use Transform: None — applying CLR twice distorts the result.
              </Alert>
            )}
            {pcaTransform === 'log10' && (
              <Alert severity="info" sx={{ mb: 2 }}>Rows with a zero or negative value in any input are left out.</Alert>
            )}

            {pcaTransform === 'clr' && <FormControl fullWidth sx={{ mb: 2 }}>
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
            </FormControl>}

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
                <strong>Transform:</strong> {TRANSFORM_LABELS[pcaTransform].split(' — ')[0]}
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

      {pcaSelectedElements.length >= 2 && effectiveCompleteCount >= 2 && effectiveCompleteCount <= pcaSelectedElements.length && (
        <Alert severity="warning" sx={{ mt: 2 }}>
          Only {effectiveCompleteCount.toLocaleString()} complete samples for {pcaSelectedElements.length} elements: with no more samples than
          variables the components are not meaningful. Select fewer elements or include more samples.
        </Alert>
      )}
      <Box sx={{ mt: 3, textAlign: 'center' }}>
        <Tooltip title={runBlockedReason ?? ''}>
          <span>
            <Button
              variant="contained"
              size="large"
              onClick={handleRunPCA}
              disabled={isProcessing || !!runBlockedReason}
            >
              {isProcessing
                ? <CircularProgress size={24} />
                : `Run PCA (${effectiveCompleteCount.toLocaleString()} complete cases)`}
            </Button>
          </span>
        </Tooltip>
        {runBlockedReason && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{runBlockedReason}</Typography>
        )}
      </Box>

      {fullPcaResult && (
        <Alert severity="success" sx={{ mt: 2 }}>
          PCA completed: {fullPcaResult.nSamples.toLocaleString()} complete cases analysed
          {pcaRowBasis === 'visible' ? ' (visible rows only).' : pcaRowBasis === 'all' ? ' (all rows, hidden ones included).' : '.'}
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
        <PCAResultsPanel />
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

    </Box>
  );
};

export default PCAWorkflow;
