/**
 * Ranked Eigenvector Plot Component
 *
 * Displays line charts for each principal component showing element loadings
 * ranked from lowest to highest. This visualization clearly shows element
 * associations at the positive and negative ends of each PC.
 *
 * Features:
 * - Optional dropdown to highlight association patterns with glow effects
 * - Connection lines between matched elements
 * - Integration with association analysis results
 *
 * Based on the Exploration Geochemistry Workshop Manual (page 5-6).
 */

import React, { useMemo, useState, useCallback } from 'react';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Switch,
  FormControlLabel,
  FormControl,
  Select,
  MenuItem,
  InputLabel,
  Button,
  Chip,
  Tooltip,
  Snackbar,
  Alert,
} from '@mui/material';
import TouchAppIcon from '@mui/icons-material/TouchApp';
import BookmarkAddIcon from '@mui/icons-material/BookmarkAdd';
import ClearIcon from '@mui/icons-material/Clear';
import PaletteIcon from '@mui/icons-material/Palette';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import TableChartIcon from '@mui/icons-material/TableChart';
import Plot from 'react-plotly.js';
import { FullPCAResult } from '../../../types/compositional';
import { PCAssociationAnalysis, MatchScore } from '../../../types/associations';
import { getSortedLoadings } from '../../../utils/calculations/pcaAnalysis';
import { CATEGORY_INFO } from '../../../data/elementAssociationPatterns';
import { detectElementFromColumnName } from '../../../utils/calculations/elementNameNormalizer';
import { useTransformationStore } from '../../../store/transformationStore';
import { useAppStore } from '../../../store/appStore';
import { getColumnDisplayName } from '../../../utils/attributeUtils';
import { CreateCustomAssociationDialog } from './CreateCustomAssociationDialog';
import { CreateCustomColorScaleDialog } from './CreateCustomColorScaleDialog';
import { SaveAssociationToTableDialog } from './SaveAssociationToTableDialog';
import { PCAFigureGenerator } from './PCAFigureGenerator';

interface RankedEigenvectorPlotProps {
  pcaResult: FullPCAResult;
  nComponents?: number;
  associationAnalyses?: PCAssociationAnalysis[];
  showInterpretations?: boolean;
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
  analysis?: PCAssociationAnalysis;
  showInterpretations?: boolean;
  selectedAssociation?: { match: MatchScore; side: 'positive' | 'negative' } | null;
  // Selection mode props
  selectionMode?: boolean;
  selectedElements?: Set<string>;
  onElementClick?: (element: string, shiftKey: boolean) => void;
  selectionColor?: string;
  // Custom association highlights (supports multiple)
  customAssociationHighlights?: CustomAssociationHighlight[];
}

interface AssociationOption {
  label: string;
  match: MatchScore;
  side: 'positive' | 'negative';
}

/**
 * Format a pattern match for annotation display
 */
function formatMatchAnnotation(match: MatchScore | undefined): string | null {
  if (!match || match.confidenceScore < 25) return null;
  return `${match.patternName} (${Math.round(match.confidenceScore)}%)`;
}

/**
 * Get category styling for annotation
 */
function getCategoryStyle(category: string | undefined): { color: string; bgColor: string } {
  if (!category || !(category in CATEGORY_INFO)) {
    return { color: '#6b7280', bgColor: '#f3f4f6' };
  }
  const info = CATEGORY_INFO[category as keyof typeof CATEGORY_INFO];
  return { color: info.color, bgColor: info.bgColor };
}

// Single PC line plot with highlighting support
const SinglePCPlot: React.FC<SinglePCPlotProps> = ({
  pcaResult,
  componentIndex,
  analysis,
  showInterpretations = false,
  selectedAssociation = null,
  selectionMode = false,
  selectedElements = new Set(),
  onElementClick,
  selectionColor = '#f59e0b',
  customAssociationHighlights = [],
}) => {
  const { columns } = useAppStore();
  const d = (name: string) => getColumnDisplayName(columns, name);

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

    // Build highlight set for pattern match (single selection)
    const patternHighlightSet = new Set<string>();
    let patternHighlightColor = '#f59e0b';

    if (selectedAssociation) {
      const { match } = selectedAssociation;
      [...match.matchedCoreElements, ...match.matchedCommonElements].forEach((el) =>
        patternHighlightSet.add(el.toLowerCase())
      );
      patternHighlightColor = CATEGORY_INFO[selectedAssociation.match.category]?.color || '#f59e0b';
    }

    const hasHighlights = selectedAssociation || customAssociationHighlights.length > 0;

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
      const isPatternHighlighted = patternHighlightSet.has(elementSymbol);
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
        } else if (isPatternHighlighted) {
          // Pattern match highlight
          markerColors.push(patternHighlightColor);
          markerSizes.push(14);
          markerLineWidths.push(3);
          markerLineColors.push(patternHighlightColor);
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
      patternHighlightSet,
      patternHighlightColor,
    };
  }, [pcaResult, componentIndex, selectedAssociation, selectionMode, selectedElements, selectionColor, customAssociationHighlights, columns]);

  // Build connection shapes for highlighted elements (multiple associations)
  const connectionShapes = useMemo(() => {
    const shapes: any[] = [];

    // Handle pattern match connection
    if (selectedAssociation && plotData.patternHighlightSet.size >= 2) {
      const matchedIndices = plotData.elements
        .map((el, idx) => ({ el, idx }))
        .filter(({ el }) => {
          const elementSymbol = detectElementFromColumnName(el)?.toLowerCase() || el.toLowerCase();
          return plotData.patternHighlightSet.has(elementSymbol);
        })
        .map(({ idx }) => idx);

      if (matchedIndices.length >= 2) {
        const minIdx = Math.min(...matchedIndices);
        const maxIdx = Math.max(...matchedIndices);

        shapes.push({
          type: 'rect',
          x0: plotData.elements[minIdx],
          x1: plotData.elements[maxIdx],
          y0: -0.05,
          y1: 0.05,
          fillcolor: plotData.patternHighlightColor,
          opacity: 0.2,
          line: { width: 0 },
        });

        shapes.push({
          type: 'line',
          x0: plotData.elements[minIdx],
          x1: plotData.elements[maxIdx],
          y0: 0,
          y1: 0,
          line: {
            color: plotData.patternHighlightColor,
            width: 2,
            dash: 'dot',
          },
        });
      }
    }

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
  }, [selectedAssociation, customAssociationHighlights, plotData]);

  // Identify top associations (first elements are highest positive loadings)
  const positiveAssoc = plotData.displayElements
    .slice(0, 5) // First 5 elements (highest loadings)
    .filter((_, i) => plotData.loadings[i] >= 0.3);

  const negativeAssoc = plotData.displayElements
    .slice(-5) // Last 5 elements (most negative loadings)
    .filter((_, i) => plotData.loadings[plotData.loadings.length - 5 + i] <= -0.3);

  const varianceExplained = pcaResult.varianceExplained[componentIndex]?.toFixed(1);

  // Get pattern interpretations if available
  const posMatch = analysis?.positiveAssociation.matches[0];
  const negMatch = analysis?.negativeAssociation.matches[0];
  const posInterpretation = showInterpretations ? formatMatchAnnotation(posMatch) : null;
  const negInterpretation = showInterpretations ? formatMatchAnnotation(negMatch) : null;
  const posStyle = getCategoryStyle(posMatch?.category);
  const negStyle = getCategoryStyle(negMatch?.category);

  // Build annotations array
  const annotations: any[] = [];

  // Positive association label (top left - positioned ABOVE the plot area)
  if (positiveAssoc.length > 0) {
    annotations.push({
      x: 0,
      y: 1.02,
      xref: 'paper',
      yref: 'paper',
      text: positiveAssoc.join('-'),
      showarrow: false,
      font: { size: 10, color: '#166534' },
      bgcolor: '#dcfce7',
      borderpad: 3,
      xanchor: 'left',
      yanchor: 'bottom',
    });
  }

  // Positive interpretation annotation (above element labels)
  if (posInterpretation) {
    annotations.push({
      x: 0,
      y: 1.10,
      xref: 'paper',
      yref: 'paper',
      text: posInterpretation,
      showarrow: false,
      font: { size: 9, color: posStyle.color },
      bgcolor: posStyle.bgColor,
      borderpad: 2,
      xanchor: 'left',
      yanchor: 'bottom',
    });
  }

  // Negative association label (bottom right - positioned BELOW the X-axis labels)
  if (negativeAssoc.length > 0) {
    annotations.push({
      x: 1,
      y: -0.18,
      xref: 'paper',
      yref: 'paper',
      text: negativeAssoc.join('-'),
      showarrow: false,
      font: { size: 10, color: '#991b1b' },
      bgcolor: '#fee2e2',
      borderpad: 3,
      xanchor: 'right',
      yanchor: 'top',
    });
  }

  // Negative interpretation annotation (below element labels)
  if (negInterpretation) {
    annotations.push({
      x: 1,
      y: -0.26,
      xref: 'paper',
      yref: 'paper',
      text: negInterpretation,
      showarrow: false,
      font: { size: 9, color: negStyle.color },
      bgcolor: negStyle.bgColor,
      borderpad: 2,
      xanchor: 'right',
      yanchor: 'top',
    });
  }

  // Add highlight annotation if association is selected
  if (selectedAssociation) {
    annotations.push({
      x: 0.5,
      y: 1.18,
      xref: 'paper',
      yref: 'paper',
      text: `<b>${selectedAssociation.match.patternName}</b> (${Math.round(selectedAssociation.match.confidenceScore)}%)`,
      showarrow: false,
      font: { size: 10, color: plotData.patternHighlightColor },
      bgcolor: CATEGORY_INFO[selectedAssociation.match.category]?.bgColor || '#fef3c7',
      borderpad: 4,
      xanchor: 'center',
      yanchor: 'bottom',
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
      x: 0.5,
      y: 1.18,
      xref: 'paper',
      yref: 'paper',
      text: `<b>Selection Mode</b> - Click to select, Shift+Click for range (${selectedElements.size} selected)`,
      showarrow: false,
      font: { size: 10, color: selectionColor },
      bgcolor: selectionColor + '20',
      borderpad: 4,
      xanchor: 'center',
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

  return (
    <Box>
      <Plot
        data={[
          {
            x: plotData.elements,
            y: plotData.loadings,
            text: plotData.displayElements,
            type: 'scatter',
            mode: 'lines+markers',
            line: {
              color: (selectedAssociation || customAssociationHighlights.length > 0) ? '#d1d5db' : '#6b7280',
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
            hovertemplate: selectionMode
              ? '%{text}<br>Loading: %{y:.3f}<br><i>Click to select, Shift+Click for range</i><extra></extra>'
              : '%{text}<br>Loading: %{y:.3f}<extra></extra>',
          },
        ]}
        layout={{
          title: {
            text: `PC${componentIndex + 1} (${varianceExplained}%)`,
            font: { size: 14 },
          },
          height: 450,
          margin: { t: 80, r: 20, b: 130, l: 60 },
          xaxis: {
            tickangle: 45,
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
        }}
        config={{ responsive: true, displayModeBar: true }}
        style={{ width: '100%', cursor: selectionMode ? 'pointer' : 'default' }}
        onClick={handlePlotClick}
      />
    </Box>
  );
};

/**
 * Single PC plot container with dropdown and selection mode
 */
const SinglePCPlotWithDropdown: React.FC<{
  pcaResult: FullPCAResult;
  componentIndex: number;
  analysis?: PCAssociationAnalysis;
  showInterpretations: boolean;
}> = ({ pcaResult, componentIndex, analysis, showInterpretations }) => {
  const [selectedPatternId, setSelectedPatternId] = useState<string>('none');
  const [selectedCustomAssociationIds, setSelectedCustomAssociationIds] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedElements, setSelectedElements] = useState<Set<string>>(new Set());
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [colorScaleDialogOpen, setColorScaleDialogOpen] = useState(false);
  const [saveToTableDialogOpen, setSaveToTableDialogOpen] = useState(false);
  const [colorScaleInfo, setColorScaleInfo] = useState<{
    name: string;
    side: 'positive' | 'negative';
    color: string;
  } | null>(null);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'warning' }>({
    open: false, message: '', severity: 'success',
  });

  const { columns } = useAppStore();

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

  // Build association options from analysis
  const associationOptions = useMemo((): AssociationOption[] => {
    if (!analysis) return [];

    const options: AssociationOption[] = [];

    // Add positive matches
    analysis.positiveAssociation.matches.forEach((match) => {
      options.push({
        label: `${match.patternName} (${Math.round(match.confidenceScore)}%) - Pos`,
        match,
        side: 'positive',
      });
    });

    // Add negative matches
    analysis.negativeAssociation.matches.forEach((match) => {
      options.push({
        label: `${match.patternName} (${Math.round(match.confidenceScore)}%) - Neg`,
        match,
        side: 'negative',
      });
    });

    return options;
  }, [analysis]);

  // Get selected pattern association (single select for patterns)
  const selectedAssociation = useMemo(() => {
    if (selectedPatternId === 'none' || selectionMode) {
      return null;
    }

    const option = associationOptions.find(
      (opt) => `${opt.match.patternId}-${opt.side}` === selectedPatternId
    );
    return option ? { match: option.match, side: option.side } : null;
  }, [selectedPatternId, associationOptions, selectionMode]);

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

  // Toggle selection mode
  const handleToggleSelectionMode = () => {
    setSelectionMode(!selectionMode);
    if (!selectionMode) {
      // Entering selection mode - clear all selections
      setSelectedPatternId('none');
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
    return Array.from(selectedElements).map((el) => {
      const symbol = detectElementFromColumnName(el);
      return symbol || el;
    });
  }, [selectedElements]);

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

  const hasOptions = associationOptions.length > 0 || relevantCustomAssociations.length > 0;

  return (
    <Paper sx={{ p: 1, height: '100%' }}>
      <SinglePCPlot
        pcaResult={pcaResult}
        componentIndex={componentIndex}
        analysis={analysis}
        showInterpretations={showInterpretations}
        selectedAssociation={selectedAssociation}
        selectionMode={selectionMode}
        selectedElements={selectedElements}
        onElementClick={handleElementClick}
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
            bgcolor: selectionMode ? '#f59e0b' : undefined,
            '&:hover': { bgcolor: selectionMode ? '#d97706' : undefined },
          }}
        >
          {selectionMode ? 'Exit Selection' : 'Select Elements'}
        </Button>

        {selectionMode && selectedElements.size > 0 && (
          <>
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
                bgcolor: '#0891b2',
                '&:hover': { bgcolor: '#0e7490' },
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
                  bgcolor: '#f59e0b20',
                  color: '#b45309',
                  borderColor: '#f59e0b',
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
          {/* Pattern matches dropdown (single select) */}
          {associationOptions.length > 0 && (
            <FormControl size="small" fullWidth sx={{ mb: 1 }}>
              <InputLabel>Pattern Matches</InputLabel>
              <Select
                value={selectedPatternId}
                onChange={(e) => setSelectedPatternId(e.target.value)}
                label="Pattern Matches"
              >
                <MenuItem value="none">
                  <em>None</em>
                </MenuItem>
                {associationOptions.map((opt) => {
                  const categoryInfo = CATEGORY_INFO[opt.match.category];
                  return (
                    <MenuItem
                      key={`${opt.match.patternId}-${opt.side}`}
                      value={`${opt.match.patternId}-${opt.side}`}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box
                          sx={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            bgcolor: categoryInfo?.color || '#6b7280',
                          }}
                        />
                        <Typography variant="body2">{opt.label}</Typography>
                      </Box>
                    </MenuItem>
                  );
                })}
              </Select>
            </FormControl>
          )}

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
                              color: '#ef4444',
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
  associationAnalyses,
  showInterpretations: initialShowInterpretations = false,
}) => {
  const actualComponents = Math.min(nComponents, pcaResult.eigenvalues.length);
  const [showInterpretations, setShowInterpretations] = useState(initialShowInterpretations);

  // Only show toggle if we have association analyses
  const hasAnalyses = associationAnalyses && associationAnalyses.length > 0;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="subtitle1" fontWeight={500}>
          Ranked Eigenvector Plots
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <PCAFigureGenerator pcaResult={pcaResult} nComponents={actualComponents} />
          {hasAnalyses && (
            <FormControlLabel
              control={
                <Switch
                  checked={showInterpretations}
                  onChange={(e) => setShowInterpretations(e.target.checked)}
                  size="small"
                />
              }
              label={<Typography variant="body2">Show Interpretations</Typography>}
            />
          )}
        </Box>
      </Box>
      <Typography variant="body2" color="text.secondary" paragraph>
        Each plot shows elements ranked by their loading (scaled eigenvector value) for one
        principal component. Elements at the positive end (right/top) are positively associated,
        while elements at the negative end (left/bottom) form a separate association. Use the
        dropdown below each plot to highlight specific associations with glow effects and
        connection lines.
      </Typography>

      <Grid container spacing={2}>
        {Array.from({ length: actualComponents }).map((_, i) => (
          <Grid item xs={12} md={6} key={i}>
            <SinglePCPlotWithDropdown
              pcaResult={pcaResult}
              componentIndex={i}
              analysis={hasAnalyses ? associationAnalyses[i] : undefined}
              showInterpretations={showInterpretations}
            />
          </Grid>
        ))}
      </Grid>

      {/* Interpretation guide */}
      <Paper sx={{ mt: 2, p: 2 }}>
        <Typography variant="subtitle2" gutterBottom>
          How to Interpret
        </Typography>
        <Typography variant="body2" color="text.secondary">
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
