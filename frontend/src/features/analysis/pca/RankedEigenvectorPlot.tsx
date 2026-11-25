/**
 * Ranked Eigenvector Plot Component
 *
 * Displays line charts for each principal component showing element loadings
 * ranked from lowest to highest. This visualization clearly shows element
 * associations at the positive and negative ends of each PC.
 *
 * Features:
 * - Pick the elements at either end (|loading| >= threshold), drag across a
 *   run of markers, or click / Shift+click them
 * - Plot the picked elements (spider, probability, ...) or keep them in the
 *   variable selection history
 * - Save them as your own named association; colour scales from them
 *
 * Based on the Exploration Geochemistry Workshop Manual (page 5-6).
 */

import React, { useMemo, useState, useCallback } from 'react';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Button,
  Chip,
  Tooltip,
  Snackbar,
  Alert,
  TextField,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import TouchAppIcon from '@mui/icons-material/TouchApp';
import BookmarkAddIcon from '@mui/icons-material/BookmarkAdd';
import ClearIcon from '@mui/icons-material/Clear';
import PaletteIcon from '@mui/icons-material/Palette';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import TableChartIcon from '@mui/icons-material/TableChart';
import FunctionsIcon from '@mui/icons-material/Functions';
import Plot from '../../../components/ThemedPlot';
import { FullPCAResult } from '../../../types/compositional';
import { getSortedLoadings } from '../../../utils/calculations/pcaAnalysis';
import { detectElementFromColumnName } from '../../../utils/calculations/elementNameNormalizer';
import { useTransformationStore } from '../../../store/transformationStore';
import { ExpandablePlotWrapper } from '../../../components/ExpandablePlotWrapper';
import { useAppStore } from '../../../store/appStore';
import { getColumnDisplayName } from '../../../utils/attributeUtils';
import { CreateCustomAssociationDialog } from './CreateCustomAssociationDialog';
import { CreateCustomColorScaleDialog } from './CreateCustomColorScaleDialog';
import { SaveAssociationToTableDialog } from './SaveAssociationToTableDialog';
import { PCAFigureGenerator } from './PCAFigureGenerator';
import { PlotElementsMenu } from './PlotElementsMenu';
import { BuildIndexDialog } from './BuildIndexDialog';
import { PcEndGroups } from './PcEndGroups';
import { endElements, sideOf, PcEnd } from './pcaElementPicks';

interface RankedEigenvectorPlotProps {
  pcaResult: FullPCAResult;
  nComponents?: number;
}

interface CustomAssociationHighlight {
  elements: string[];
  color: string;
  name: string;
  side: 'positive' | 'negative';
}

interface SinglePCPlotProps {
  pcaResult: FullPCAResult;
  componentIndex: number;
  // Selection mode props
  selectionMode?: boolean;
  selectedElements?: Set<string>;
  onElementClick?: (element: string, shiftKey: boolean) => void;
  /** Elements inside a drag box (selection mode) */
  onElementsSelected?: (elements: string[]) => void;
  selectionColor?: string;
  // Custom association highlights (supports multiple)
  customAssociationHighlights?: CustomAssociationHighlight[];
}

// Single PC line plot with highlighting support
const SinglePCPlotInner: React.FC<SinglePCPlotProps> = ({
  pcaResult,
  componentIndex,
  selectionMode = false,
  selectedElements = new Set(),
  onElementClick,
  onElementsSelected,
  selectionColor = '#f59e0b',
  customAssociationHighlights = [],
}) => {
  const columns = useAppStore(s => s.columns);
  const d = useCallback((name: string) => getColumnDisplayName(columns, name), [columns]);

  const plotData = useMemo(() => {
    // getSortedLoadings returns loadings sorted from highest to lowest
    const sortedLoadings = getSortedLoadings(pcaResult, componentIndex);

    // Build element to association map for multi-association coloring
    const elementToAssociation = new Map<string, CustomAssociationHighlight>();

    // Add custom associations to the map
    customAssociationHighlights.forEach((assoc) => {
      assoc.elements.forEach((el) => {
        const elLower = el.toLowerCase();
        if (!elementToAssociation.has(elLower)) {
          elementToAssociation.set(elLower, assoc);
        }
      });
    });

    const hasHighlights = customAssociationHighlights.length > 0;

    // Build arrays for plot data
    const elements = sortedLoadings.map((l) => l.element);
    const loadings = sortedLoadings.map((l) => l.loading);

    // Determine colors, sizes, and line properties based on highlighting
    const markerColors: string[] = [];
    const markerSizes: number[] = [];
    const markerLineWidths: number[] = [];
    const markerLineColors: string[] = [];
    const markerOpacities: number[] = [];

    sortedLoadings.forEach((l) => {
      // Extract element symbol from column name (e.g., "Y_ppm" -> "y")
      const elementSymbol = detectElementFromColumnName(l.element)?.toLowerCase() || l.element.toLowerCase();
      const customAssoc = elementToAssociation.get(elementSymbol);
      const isSelected = selectionMode && selectedElements.has(l.element);

      if (selectionMode) {
        // Selection mode - show selected elements with selection color
        if (isSelected) {
          markerColors.push(selectionColor);
          markerSizes.push(14);
          markerLineWidths.push(3);
          markerLineColors.push(selectionColor);
          markerOpacities.push(1.0);
        } else {
          // Unselected - normal but slightly faded
          markerColors.push(l.loading >= 0 ? '#22c55e' : '#ef4444');
          markerSizes.push(10);
          markerLineWidths.push(2);
          markerLineColors.push('#374151');
          markerOpacities.push(0.6);
        }
      } else if (hasHighlights) {
        if (customAssoc) {
          // Custom association highlight - use association's color
          markerColors.push(customAssoc.color);
          markerSizes.push(14);
          markerLineWidths.push(3);
          markerLineColors.push(customAssoc.color);
          markerOpacities.push(1.0);
        } else {
          // Non-highlighted - smaller, greyed out
          markerColors.push('#d1d5db');
          markerSizes.push(6);
          markerLineWidths.push(0);
          markerLineColors.push('#d1d5db');
          markerOpacities.push(0.3);
        }
      } else {
        // No selection - normal coloring based on loading sign
        markerColors.push(l.loading >= 0 ? '#22c55e' : '#ef4444');
        markerSizes.push(8);
        markerLineWidths.push(1);
        markerLineColors.push('#374151');
        markerOpacities.push(1.0);
      }
    });

    return {
      elements,
      displayElements: elements.map(el => d(el)),
      loadings,
      markerColors,
      markerSizes,
      markerLineWidths,
      markerLineColors,
      markerOpacities,
      elementToAssociation,
    };
  }, [pcaResult, componentIndex, selectionMode, selectedElements, selectionColor, customAssociationHighlights, d]);

  // Build connection shapes for highlighted elements (multiple associations)
  const connectionShapes = useMemo(() => {
    const shapes: any[] = [];

    // Handle custom association connections (each with its own color)
    // Group by side for y-positioning
    const positiveAssocs = customAssociationHighlights.filter(a => a.side === 'positive');
    const negativeAssocs = customAssociationHighlights.filter(a => a.side === 'negative');

    positiveAssocs.forEach((assoc, assocIdx) => {
      const assocElements = new Set(assoc.elements.map((e) => e.toLowerCase()));

      const matchedIndices = plotData.elements
        .map((el, idx) => ({ el, idx }))
        .filter(({ el }) => {
          const elementSymbol = detectElementFromColumnName(el)?.toLowerCase() || el.toLowerCase();
          return assocElements.has(elementSymbol);
        })
        .map(({ idx }) => idx);

      if (matchedIndices.length >= 2) {
        const minIdx = Math.min(...matchedIndices);
        const maxIdx = Math.max(...matchedIndices);

        // Position positive associations above 0
        const yPos = 0.85 - (assocIdx * 0.08);

        shapes.push({
          type: 'line',
          x0: plotData.elements[minIdx],
          x1: plotData.elements[maxIdx],
          y0: yPos,
          y1: yPos,
          line: {
            color: assoc.color,
            width: 2.5,
            dash: 'dot',
          },
        });
      }
    });

    negativeAssocs.forEach((assoc, assocIdx) => {
      const assocElements = new Set(assoc.elements.map((e) => e.toLowerCase()));

      const matchedIndices = plotData.elements
        .map((el, idx) => ({ el, idx }))
        .filter(({ el }) => {
          const elementSymbol = detectElementFromColumnName(el)?.toLowerCase() || el.toLowerCase();
          return assocElements.has(elementSymbol);
        })
        .map(({ idx }) => idx);

      if (matchedIndices.length >= 2) {
        const minIdx = Math.min(...matchedIndices);
        const maxIdx = Math.max(...matchedIndices);

        // Position negative associations below 0
        const yPos = -0.85 + (assocIdx * 0.08);

        shapes.push({
          type: 'line',
          x0: plotData.elements[minIdx],
          x1: plotData.elements[maxIdx],
          y0: yPos,
          y1: yPos,
          line: {
            color: assoc.color,
            width: 2.5,
            dash: 'dot',
          },
        });
      }
    });

    return shapes;
  }, [customAssociationHighlights, plotData]);

  // Identify top associations (first elements are highest positive loadings)
  const positiveAssoc = plotData.displayElements
    .slice(0, 5) // First 5 elements (highest loadings)
    .filter((_, i) => plotData.loadings[i] >= 0.3);

  const negativeAssoc = plotData.displayElements
    .slice(-5) // Last 5 elements (most negative loadings)
    .filter((_, i) => plotData.loadings[plotData.loadings.length - 5 + i] <= -0.3);

  const varianceExplained = pcaResult.varianceExplained[componentIndex]?.toFixed(1);

  // Build annotations array
  const annotations: any[] = [];

  // End associations, as on the workshop's ranked eigenvector charts: the
  // element chain inside the plot's empty corners - a ranked curve always runs
  // top-left to bottom-right, so top-right and bottom-left are free
  const endLabel = (chain: string[]) => `<b>${chain.join('-')}</b>`;
  if (positiveAssoc.length > 0) {
    annotations.push({
      x: 0.99, y: 0.97, xref: 'paper', yref: 'paper', xanchor: 'right', yanchor: 'top', align: 'right',
      text: endLabel(positiveAssoc),
      showarrow: false,
      font: { size: 10, color: '#166534' },
      bgcolor: 'rgba(220,252,231,0.85)',
      borderpad: 3,
    });
  }
  if (negativeAssoc.length > 0) {
    annotations.push({
      x: 0.01, y: 0.03, xref: 'paper', yref: 'paper', xanchor: 'left', yanchor: 'bottom', align: 'left',
      text: endLabel([...negativeAssoc].reverse()),
      showarrow: false,
      font: { size: 10, color: '#991b1b' },
      bgcolor: 'rgba(254,226,226,0.85)',
      borderpad: 3,
    });
  }

  // Add custom association highlight annotations (multiple, stacked inside plot)
  if (customAssociationHighlights.length > 0) {
    // Group by side for stacking
    const positiveAssocs = customAssociationHighlights.filter(a => a.side === 'positive');
    const negativeAssocs = customAssociationHighlights.filter(a => a.side === 'negative');

    // Positive side annotations (inside plot area, top left)
    positiveAssocs.forEach((assoc, idx) => {
      annotations.push({
        x: 0.02,
        y: 0.85 - idx * 0.08,
        xref: 'paper',
        yref: 'y',
        yanchor: 'middle',
        text: `<b>${assoc.name}</b>`,
        showarrow: false,
        font: { size: 11, color: assoc.color },
        bgcolor: 'rgba(255,255,255,0.9)',
        bordercolor: assoc.color,
        borderwidth: 1,
        borderpad: 4,
        xanchor: 'left',
      });
    });

    // Negative side annotations (inside plot area, bottom right)
    negativeAssocs.forEach((assoc, idx) => {
      annotations.push({
        x: 0.98,
        y: -0.85 + idx * 0.08,
        xref: 'paper',
        yref: 'y',
        yanchor: 'middle',
        text: `<b>${assoc.name}</b>`,
        showarrow: false,
        font: { size: 11, color: assoc.color },
        bgcolor: 'rgba(255,255,255,0.9)',
        bordercolor: assoc.color,
        borderwidth: 1,
        borderpad: 4,
        xanchor: 'right',
      });
    });
  }

  // Add selection mode indicator
  if (selectionMode) {
    annotations.push({
      x: 1,
      y: 1.0,
      xref: 'paper',
      yref: 'paper',
      text: `<b>Selection Mode</b> - drag across markers, click, or Shift+Click for a range (${selectedElements.size} selected)`,
      showarrow: false,
      font: { size: 10, color: selectionColor },
      bgcolor: selectionColor + '20',
      borderpad: 4,
      xanchor: 'right',
      yanchor: 'bottom',
    });
  }

  // Handle click on plot points
  const handlePlotClick = useCallback((event: any) => {
    if (!selectionMode || !onElementClick) return;

    // Check if we clicked on a point
    if (event.points && event.points.length > 0) {
      const point = event.points[0];
      const element = point.x as string;
      // Check if shift key was held (from the native event)
      const shiftKey = event.event?.shiftKey || false;
      onElementClick(element, shiftKey);
    }
  }, [selectionMode, onElementClick]);

  // Drag box (horizontal) over a run of markers
  const handlePlotSelected = useCallback((event: any) => {
    if (!selectionMode || !onElementsSelected || !event?.points?.length) return;
    onElementsSelected(event.points.map((p: any) => p.x as string));
  }, [selectionMode, onElementsSelected]);

  return (
    <Box>
      <ExpandablePlotWrapper>
      <Plot
        data={[
          {
            x: plotData.elements,
            y: plotData.loadings,
            text: plotData.displayElements,
            type: 'scatter',
            mode: 'lines+markers',
            line: {
              color: customAssociationHighlights.length > 0 ? '#d1d5db' : '#6b7280',
              width: 1,
            },
            marker: {
              size: plotData.markerSizes,
              color: plotData.markerColors,
              opacity: plotData.markerOpacities,
              line: {
                width: plotData.markerLineWidths,
                color: plotData.markerLineColors,
              },
            },
            // Our marker colours show the selection; no Plotly dimming
            selected: { marker: { opacity: 1 } },
            unselected: { marker: { opacity: 1 } },
            hovertemplate: selectionMode
              ? '%{text}<br>Loading: %{y:.3f}<br><i>Drag across or click to select, Shift+Click for a range</i><extra></extra>'
              : '%{text}<br>Loading: %{y:.3f}<extra></extra>',
          } as any,
        ]}
        layout={{
          title: {
            text: `PC${componentIndex + 1} (${varianceExplained}%)`,
            font: { size: 13 },
            x: 0,
            xanchor: 'left' as const,
          },
          height: 300,
          margin: { t: 32, r: 12, b: 40, l: 52 },
          xaxis: {
            tickangle: -90,
            tickfont: { size: 10 },
            showgrid: false,
            tickmode: 'array' as const,
            tickvals: plotData.elements,
            ticktext: plotData.displayElements,
          },
          yaxis: {
            title: { text: 'Loading', font: { size: 11 } },
            tickfont: { size: 10 },
            range: [-1.1, 1.1],
            zeroline: true,
            zerolinecolor: '#374151',
            zerolinewidth: 1,
            gridcolor: '#e5e7eb',
          },
          showlegend: false,
          annotations,
          shapes: connectionShapes,
          clickmode: selectionMode ? 'event' : 'none',
          dragmode: selectionMode ? 'select' : false,
          selectdirection: 'h',
        }}
        config={{ responsive: true }}
        style={{ width: '100%', cursor: selectionMode ? 'pointer' : 'default' }}
        onClick={handlePlotClick}
        onSelected={handlePlotSelected}
      />
      </ExpandablePlotWrapper>
    </Box>
  );
};

/**
 * Single PC plot container with dropdown and selection mode
 */
// Memoised: the Plotly chart only re-renders when its own props change,
// not on every dropdown/selection state change in the parent
const SinglePCPlot = React.memo(SinglePCPlotInner);

const SinglePCPlotWithDropdown: React.FC<{
  pcaResult: FullPCAResult;
  componentIndex: number;
  /** |loading| for the end quick picks */
  endThreshold: number;
}> = ({ pcaResult, componentIndex, endThreshold }) => {
  const [selectedCustomAssociationIds, setSelectedCustomAssociationIds] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedElements, setSelectedElements] = useState<Set<string>>(new Set());
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [colorScaleDialogOpen, setColorScaleDialogOpen] = useState(false);
  const [saveToTableDialogOpen, setSaveToTableDialogOpen] = useState(false);
  const [indexDialogOpen, setIndexDialogOpen] = useState(false);
  const [colorScaleInfo, setColorScaleInfo] = useState<{
    name: string;
    side: 'positive' | 'negative';
    color: string;
  } | null>(null);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'warning'; showPlots?: boolean }>({
    open: false, message: '', severity: 'success',
  });

  const columns = useAppStore(s => s.columns);
  const currentView = useAppStore(s => s.currentView);

  // Get custom associations from store
  const customAssociations = useTransformationStore((state) => state.customAssociations);
  const removeCustomAssociation = useTransformationStore((state) => state.removeCustomAssociation);
  const pcNumber = componentIndex + 1;

  // Filter custom associations for this PC
  const relevantCustomAssociations = useMemo(() => {
    return customAssociations.filter((ca) => ca.pcNumber === pcNumber);
  }, [customAssociations, pcNumber]);

  // Toggle custom association selection
  const toggleCustomAssociation = useCallback((id: string) => {
    setSelectedCustomAssociationIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  }, []);

  // Get custom association highlights (multi-select)
  const customAssociationHighlights = useMemo((): CustomAssociationHighlight[] => {
    if (selectionMode) {
      return [];
    }

    return Array.from(selectedCustomAssociationIds)
      .map((id) => {
        const customAssoc = customAssociations.find((ca) => ca.id === id);
        if (!customAssoc) return null;
        return {
          elements: customAssoc.elementSymbols,
          color: customAssoc.color,
          name: customAssoc.name,
          side: customAssoc.side,
        };
      })
      .filter((h): h is CustomAssociationHighlight => h !== null);
  }, [selectedCustomAssociationIds, customAssociations, selectionMode]);

  // Track last clicked element for shift-click range selection
  const [lastClickedElement, setLastClickedElement] = useState<string | null>(null);

  // Get sorted elements for range selection
  const sortedElements = useMemo(() => {
    return getSortedLoadings(pcaResult, componentIndex).map(l => l.element);
  }, [pcaResult, componentIndex]);

  // Handle element click in selection mode (with shift-click support)
  const handleElementClick = useCallback((element: string, shiftKey: boolean) => {
    if (shiftKey && lastClickedElement && lastClickedElement !== element) {
      // Shift-click: select range between last clicked and current
      const lastIdx = sortedElements.indexOf(lastClickedElement);
      const currentIdx = sortedElements.indexOf(element);

      if (lastIdx !== -1 && currentIdx !== -1) {
        const startIdx = Math.min(lastIdx, currentIdx);
        const endIdx = Math.max(lastIdx, currentIdx);
        const rangeElements = sortedElements.slice(startIdx, endIdx + 1);

        setSelectedElements((prev) => {
          const newSet = new Set(prev);
          rangeElements.forEach(el => newSet.add(el));
          return newSet;
        });
      }
    } else {
      // Normal click: toggle single element
      setSelectedElements((prev) => {
        const newSet = new Set(prev);
        if (newSet.has(element)) {
          newSet.delete(element);
        } else {
          newSet.add(element);
        }
        return newSet;
      });
    }

    // Always update last clicked element
    setLastClickedElement(element);
  }, [lastClickedElement, sortedElements]);

  // Pick one end of the PC (enters selection mode)
  const pickEnd = (side: PcEnd) => {
    setSelectedCustomAssociationIds(new Set());
    setSelectionMode(true);
    setSelectedElements(new Set(side === 'positive' ? posEnd : negEnd));
    setLastClickedElement(null);
  };
  const posEnd = useMemo(() => endElements(pcaResult, componentIndex, 'positive', endThreshold), [pcaResult, componentIndex, endThreshold]);
  const negEnd = useMemo(() => endElements(pcaResult, componentIndex, 'negative', endThreshold), [pcaResult, componentIndex, endThreshold]);

  const handleElementsSelected = useCallback((elements: string[]) => {
    setSelectedElements(new Set(elements));
    setLastClickedElement(null);
  }, []);

  // Picked elements in ranked order, from the end they sit on inward
  const pickedInOrder = useMemo(() => {
    const ordered = sortedElements.filter(e => selectedElements.has(e));
    return ordered.length && sideOf(pcaResult, componentIndex, ordered) === 'negative' ? ordered.reverse() : ordered;
  }, [sortedElements, selectedElements, pcaResult, componentIndex]);

  // Toggle selection mode
  const handleToggleSelectionMode = () => {
    setSelectionMode(!selectionMode);
    if (!selectionMode) {
      // Entering selection mode - clear all selections
      setSelectedCustomAssociationIds(new Set());
      setLastClickedElement(null);
    } else {
      // Exiting selection mode - clear element selection
      setSelectedElements(new Set());
      setLastClickedElement(null);
    }
  };

  // Clear selection
  const handleClearSelection = () => {
    setSelectedElements(new Set());
  };

  // Get selected element symbols for display
  const selectedElementSymbols = useMemo(() => {
    return pickedInOrder.map((el) => {
      const symbol = detectElementFromColumnName(el);
      return symbol || el;
    });
  }, [pickedInOrder]);

  // Determine default side based on selected elements' loadings
  const defaultSide = useMemo((): 'positive' | 'negative' => {
    if (selectedElements.size === 0) return 'positive';

    const sortedLoadings = getSortedLoadings(pcaResult, componentIndex);
    let posCount = 0;
    let negCount = 0;

    selectedElements.forEach((el) => {
      const loading = sortedLoadings.find((l) => l.element === el)?.loading;
      if (loading !== undefined) {
        if (loading >= 0) posCount++;
        else negCount++;
      }
    });

    return posCount >= negCount ? 'positive' : 'negative';
  }, [selectedElements, pcaResult, componentIndex]);

  // Check if PC score columns exist
  const pcColumnsExist = useMemo(() => {
    return columns.some((c) => c.name === `PC${pcNumber}` || c.name === `negPC${pcNumber}`);
  }, [columns, pcNumber]);

  // Guard function for operations requiring PC columns
  const guardPcColumns = useCallback((): boolean => {
    if (!pcColumnsExist) {
      setSnackbar({ open: true, message: 'Add PC Scores to Data first', severity: 'warning' });
      return false;
    }
    return true;
  }, [pcColumnsExist]);

  const hasOptions = relevantCustomAssociations.length > 0;

  return (
    <Paper sx={{ p: 1, height: '100%' }}>
      <SinglePCPlot
        pcaResult={pcaResult}
        componentIndex={componentIndex}
        selectionMode={selectionMode}
        selectedElements={selectedElements}
        onElementClick={handleElementClick}
        onElementsSelected={handleElementsSelected}
        selectionColor="#f59e0b"
        customAssociationHighlights={customAssociationHighlights}
      />

      {/* Selection mode controls */}
      <Box sx={{ px: 1, pb: 1, display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button
          size="small"
          variant={selectionMode ? 'contained' : 'outlined'}
          startIcon={<TouchAppIcon />}
          onClick={handleToggleSelectionMode}
          sx={{
            bgcolor: selectionMode ? 'warning.main' : undefined,
            '&:hover': { bgcolor: selectionMode ? 'warning.dark' : undefined },
          }}
        >
          {selectionMode ? 'Exit Selection' : 'Select Elements'}
        </Button>
        <Tooltip title={posEnd.length ? `Loading ≥ ${endThreshold}: ${posEnd.join('-')}` : `No loading ≥ ${endThreshold}`}>
          <span>
            <Button size="small" variant="outlined" color="success" disabled={!posEnd.length} onClick={() => pickEnd('positive')}>
              + end ({posEnd.length})
            </Button>
          </span>
        </Tooltip>
        <Tooltip title={negEnd.length ? `Loading ≤ −${endThreshold}: ${negEnd.join('-')}` : `No loading ≤ −${endThreshold}`}>
          <span>
            <Button size="small" variant="outlined" color="error" disabled={!negEnd.length} onClick={() => pickEnd('negative')}>
              − end ({negEnd.length})
            </Button>
          </span>
        </Tooltip>

        {selectionMode && selectedElements.size > 0 && (
          <>
            <PlotElementsMenu
              result={pcaResult}
              componentIndex={componentIndex}
              labels={pickedInOrder}
              onDone={(message, showPlots) => setSnackbar({ open: true, message, severity: 'success', showPlots: showPlots && currentView !== 'plots' })}
            />
            <Tooltip title="Add an additive index column (Σ CLR or Σ log10) of the picked elements">
              <Button size="small" variant="contained" color="secondary" startIcon={<FunctionsIcon />} onClick={() => setIndexDialogOpen(true)}>
                Build Index
              </Button>
            </Tooltip>
            <Button
              size="small"
              variant="outlined"
              startIcon={<ClearIcon />}
              onClick={handleClearSelection}
            >
              Clear
            </Button>
            <Button
              size="small"
              variant="contained"
              color="primary"
              startIcon={<BookmarkAddIcon />}
              onClick={() => setCreateDialogOpen(true)}
            >
              Save Association
            </Button>
            <Button
              size="small"
              variant="contained"
              startIcon={<PaletteIcon />}
              onClick={() => {
                if (!guardPcColumns()) return;
                setColorScaleInfo({
                  name: `Selected Elements (${selectedElements.size})`,
                  side: defaultSide,
                  color: '#f59e0b',
                });
                setColorScaleDialogOpen(true);
              }}
              sx={{
                bgcolor: '#8b5cf6',
                '&:hover': { bgcolor: '#7c3aed' },
              }}
            >
              Color Scale
            </Button>
            <Button
              size="small"
              variant="contained"
              startIcon={<TableChartIcon />}
              onClick={() => setSaveToTableDialogOpen(true)}
              sx={{
                bgcolor: 'primary.main',
                '&:hover': { bgcolor: 'primary.dark' },
              }}
            >
              Save to Table
            </Button>
          </>
        )}
      </Box>

      {/* Selection summary */}
      {selectionMode && selectedElements.size > 0 && (
        <Box sx={{ px: 1, pb: 1 }}>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {selectedElementSymbols.map((symbol, idx) => (
              <Chip
                key={idx}
                label={symbol}
                size="small"
                sx={{
                  bgcolor: (theme) => alpha(theme.palette.warning.main, 0.12),
                  color: 'warning.main',
                  borderColor: 'warning.main',
                  border: '1px solid',
                }}
              />
            ))}
          </Box>
        </Box>
      )}

      {/* Dropdown for highlighting associations (hidden in selection mode) */}
      {!selectionMode && hasOptions && (
        <Box sx={{ px: 1, pb: 1 }}>
          {/* Custom associations (multi-select with delete option) */}
          {relevantCustomAssociations.length > 0 && (
            <Box sx={{ mb: 1 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                Custom Associations (click to toggle, right-click or use × to delete)
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }}>
                {relevantCustomAssociations.map((ca) => {
                  const isSelected = selectedCustomAssociationIds.has(ca.id);
                  return (
                    <Box
                      key={ca.id}
                      sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}
                    >
                      <Chip
                        label={`${ca.name} (${ca.side === 'positive' ? '+' : '-'})`}
                        size="small"
                        onClick={() => toggleCustomAssociation(ca.id)}
                        onDelete={() => {
                          // Deselect if selected, then remove
                          if (isSelected) {
                            toggleCustomAssociation(ca.id);
                          }
                          removeCustomAssociation(ca.id);
                        }}
                        deleteIcon={
                          <Tooltip title="Delete association">
                            <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                          </Tooltip>
                        }
                        sx={{
                          bgcolor: isSelected ? ca.color + '40' : 'transparent',
                          color: isSelected ? ca.color : 'text.secondary',
                          borderColor: ca.color,
                          border: '1px solid',
                          fontWeight: isSelected ? 600 : 400,
                          '&:hover': {
                            bgcolor: ca.color + '30',
                          },
                          '& .MuiChip-deleteIcon': {
                            color: isSelected ? ca.color : 'text.secondary',
                            '&:hover': {
                              color: 'error.main',
                            },
                          },
                        }}
                        icon={
                          <Box
                            sx={{
                              width: 8,
                              height: 8,
                              borderRadius: '50%',
                              bgcolor: ca.color,
                              ml: 0.5,
                            }}
                          />
                        }
                      />
                    </Box>
                  );
                })}
              </Box>
            </Box>
          )}

          {/* Create Color Scale buttons for selected custom associations */}
          {customAssociationHighlights.length > 0 && (
            <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {customAssociationHighlights.map((assoc) => (
                <Button
                  key={assoc.name}
                  size="small"
                  variant="outlined"
                  startIcon={<PaletteIcon />}
                  onClick={() => {
                    if (!guardPcColumns()) return;
                    setColorScaleInfo({
                      name: assoc.name,
                      side: assoc.side,
                      color: assoc.color,
                    });
                    setColorScaleDialogOpen(true);
                  }}
                  sx={{
                    borderColor: assoc.color,
                    color: assoc.color,
                    '&:hover': {
                      bgcolor: assoc.color + '20',
                      borderColor: assoc.color,
                    },
                  }}
                >
                  Color Scale: {assoc.name}
                </Button>
              ))}
            </Box>
          )}
        </Box>
      )}

      {/* Create Custom Association Dialog */}
      <CreateCustomAssociationDialog
        open={createDialogOpen}
        onClose={() => {
          setCreateDialogOpen(false);
        }}
        selectedElements={Array.from(selectedElements)}
        pcNumber={pcNumber}
        defaultSide={defaultSide}
        onCreated={() => {
          setSelectionMode(false);
          setSelectedElements(new Set());
        }}
      />

      {/* Create Color Scale Dialog */}
      {colorScaleInfo && (
        <CreateCustomColorScaleDialog
          open={colorScaleDialogOpen}
          onClose={() => {
            setColorScaleDialogOpen(false);
            setColorScaleInfo(null);
          }}
          onSuccess={(msg) => setSnackbar({ open: true, message: msg, severity: 'success' })}
          pcNumber={pcNumber}
          associationName={colorScaleInfo.name}
          side={colorScaleInfo.side}
          color={colorScaleInfo.color}
        />
      )}

      {/* Save Association to Table Dialog */}
      <BuildIndexDialog
        open={indexDialogOpen}
        onClose={() => setIndexDialogOpen(false)}
        result={pcaResult}
        labels={pickedInOrder}
        source={`PC${pcNumber}${sideOf(pcaResult, componentIndex, pickedInOrder) === 'negative' ? '−' : '+'}`}
      />
      <SaveAssociationToTableDialog
        open={saveToTableDialogOpen}
        onClose={() => setSaveToTableDialogOpen(false)}
        onSuccess={(msg) => {
          setSnackbar({ open: true, message: msg, severity: 'success' });
          setSelectionMode(false);
          setSelectedElements(new Set());
        }}
        pcaResult={pcaResult}
        componentIndex={componentIndex}
        selectedElements={Array.from(selectedElements)}
        defaultSide={defaultSide}
      />

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
          action={snackbar.showPlots ? (
            <Button color="inherit" size="small" onClick={() => { useAppStore.getState().setCurrentView('plots'); setSnackbar((s) => ({ ...s, open: false })); }}>
              Show
            </Button>
          ) : undefined}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Paper>
  );
};

export const RankedEigenvectorPlot: React.FC<RankedEigenvectorPlotProps> = ({
  pcaResult,
  nComponents = 8,
}) => {
  const actualComponents = Math.min(nComponents, pcaResult.eigenvalues.length);
  const [endThreshold, setEndThreshold] = useState(0.5);

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="subtitle1" fontWeight={500}>
          Ranked Eigenvector Plots
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Tooltip title="+ end / − end pick the elements whose loading is at least this far from zero">
            <TextField
              size="small" type="number" label="End |loading| ≥" value={endThreshold}
              onChange={e => { const v = Number(e.target.value); if (v > 0 && v < 1) setEndThreshold(v); }}
              inputProps={{ step: 0.05, min: 0.05, max: 0.95 }}
              sx={{ width: 130 }}
            />
          </Tooltip>
          <PCAFigureGenerator pcaResult={pcaResult} nComponents={actualComponents} />
        </Box>
      </Box>
      <Typography variant="body2" color="text.secondary" paragraph>
        Each plot shows elements ranked by their loading (scaled eigenvector value) for one
        principal component. Elements at the positive end (right/top) are positively associated,
        while elements at the negative end (left/bottom) form a separate association. Pick an
        end with + end / − end, drag across markers or click them, then Plot them (spider,
        probability, …), save them as an association or colour samples by them. The table
        below holds every end at once.
      </Typography>

      <PcEndGroups pcaResult={pcaResult} nComponents={actualComponents} threshold={endThreshold} />

      <Grid container spacing={2}>
        {Array.from({ length: actualComponents }).map((_, i) => (
          <Grid item xs={12} key={i}>
            <SinglePCPlotWithDropdown
              pcaResult={pcaResult}
              componentIndex={i}
              endThreshold={endThreshold}
            />
          </Grid>
        ))}
      </Grid>

      {/* Interpretation guide */}
      <Paper sx={{ mt: 2, p: 2 }}>
        <Typography variant="subtitle2" gutterBottom>
          How to Interpret
        </Typography>
        <Typography variant="body2" color="text.secondary" component="div">
          <strong>PC1</strong> typically captures the largest source of variation in your data.
          In exploration geochemistry, this might represent:
          <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
            <li>
              <strong>Mineralisation vs. Host Rock:</strong> Ore elements (Pb, Ag, As, Cd, Zn, Sb)
              at one end, lithogenic elements (Y, Al, Hf, Zr, Ti) at the other
            </li>
            <li>
              <strong>Mafic vs. Felsic:</strong> Mafic indicators (Co, Cr, Ni, Sc, V, Mg) vs.
              felsic indicators (K, Rb, Th, La, Zr)
            </li>
            <li>
              <strong>Alteration:</strong> Sericite (K, Rb, Ba, Tl) vs. chlorite (Mg, Fe, Mn)
            </li>
          </ul>
          Element associations at the same end of a PC are geochemically related and can be
          mapped together using the PC scores.
        </Typography>
      </Paper>
    </Box>
  );
};

export default RankedEigenvectorPlot;
