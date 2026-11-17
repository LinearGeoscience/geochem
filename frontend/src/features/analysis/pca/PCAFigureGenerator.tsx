/**
 * PCA Figure Generator Component
 *
 * Generates publication-ready figures showing multiple PCs with
 * custom association highlights and labels.
 */

import React, { useMemo, useState, useRef, useCallback } from 'react';
import html2canvas from 'html2canvas';
import {
  Box,
  Typography,
  Paper,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Checkbox,
  FormControlLabel,
  Grid,
  Chip,
  Slider,
  TextField,
  Divider,
} from '@mui/material';
import ImageIcon from '@mui/icons-material/Image';
import DownloadIcon from '@mui/icons-material/Download';
import Plot from 'react-plotly.js';
import { FullPCAResult } from '../../../types/compositional';
import { CustomAssociation } from '../../../types/associations';
import { getSortedLoadings } from '../../../utils/calculations/pcaAnalysis';
import { detectElementFromColumnName } from '../../../utils/calculations/elementNameNormalizer';
import { useTransformationStore } from '../../../store/transformationStore';

interface PCAFigureGeneratorProps {
  pcaResult: FullPCAResult;
  nComponents?: number;
}

interface PCConfig {
  pcIndex: number;
  enabled: boolean;
  associationIds: string[]; // Array of association IDs to highlight
}

interface FigureSettings {
  columns: 1 | 2 | 3 | 4;
  plotHeight: number;
  showTitle: boolean;
  title: string;
  highlightOpacity: number;
  lineWidth: number;
  showConnectionLine: boolean;
}

/**
 * Single PC plot for the figure (simplified, clean version)
 * Supports multiple associations with different colors
 */
const FigurePCPlot: React.FC<{
  pcaResult: FullPCAResult;
  componentIndex: number;
  associations: CustomAssociation[];
  settings: FigureSettings;
}> = ({ pcaResult, componentIndex, associations, settings }) => {
  const plotData = useMemo(() => {
    const sortedLoadings = getSortedLoadings(pcaResult, componentIndex);

    // Build highlight map: element -> association (for color)
    // If element is in multiple associations, use the first one's color
    const elementToAssociation = new Map<string, CustomAssociation>();
    associations.forEach((assoc) => {
      assoc.elementSymbols.forEach((el) => {
        const elLower = el.toLowerCase();
        if (!elementToAssociation.has(elLower)) {
          elementToAssociation.set(elLower, assoc);
        }
      });
    });

    const elements = sortedLoadings.map((l) => l.element);
    const loadings = sortedLoadings.map((l) => l.loading);

    // Determine colors and sizes
    const markerColors: string[] = [];
    const markerSizes: number[] = [];
    const markerLineWidths: number[] = [];
    const markerLineColors: string[] = [];
    const markerOpacities: number[] = [];

    sortedLoadings.forEach((l) => {
      const elementSymbol = detectElementFromColumnName(l.element)?.toLowerCase() || l.element.toLowerCase();
      const matchedAssoc = elementToAssociation.get(elementSymbol);

      if (associations.length > 0 && elementToAssociation.size > 0) {
        if (matchedAssoc) {
          // Gentle highlight - use association color with configurable opacity
          markerColors.push(matchedAssoc.color);
          markerSizes.push(10);
          markerLineWidths.push(settings.lineWidth);
          markerLineColors.push(matchedAssoc.color);
          markerOpacities.push(settings.highlightOpacity);
        } else {
          // Non-highlighted - grey and smaller
          markerColors.push('#9ca3af');
          markerSizes.push(6);
          markerLineWidths.push(0);
          markerLineColors.push('#9ca3af');
          markerOpacities.push(0.4);
        }
      } else {
        // No association - normal coloring
        markerColors.push(l.loading >= 0 ? '#22c55e' : '#ef4444');
        markerSizes.push(7);
        markerLineWidths.push(1);
        markerLineColors.push('#374151');
        markerOpacities.push(0.9);
      }
    });

    return {
      elements,
      loadings,
      markerColors,
      markerSizes,
      markerLineWidths,
      markerLineColors,
      markerOpacities,
      elementToAssociation,
    };
  }, [pcaResult, componentIndex, associations, settings]);

  // Build connection lines for each association
  const connectionShapes = useMemo(() => {
    const shapes: any[] = [];

    if (!settings.showConnectionLine || associations.length === 0) {
      return shapes;
    }

    // Group by side for y-positioning
    const positiveAssocs = associations.filter(a => a.side === 'positive');
    const negativeAssocs = associations.filter(a => a.side === 'negative');

    // Create connection line for each association
    positiveAssocs.forEach((assoc, assocIdx) => {
      const assocElements = new Set(assoc.elementSymbols.map(e => e.toLowerCase()));

      const matchedIndices = plotData.elements
        .map((el, idx) => ({ el, idx }))
        .filter(({ el }) => {
          const elementSymbol = detectElementFromColumnName(el)?.toLowerCase() || el.toLowerCase();
          return assocElements.has(elementSymbol);
        })
        .map(({ idx }) => idx);

      if (matchedIndices.length < 2) return;

      const minIdx = Math.min(...matchedIndices);
      const maxIdx = Math.max(...matchedIndices);

      // Position positive associations above 0, stacked
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
    });

    negativeAssocs.forEach((assoc, assocIdx) => {
      const assocElements = new Set(assoc.elementSymbols.map(e => e.toLowerCase()));

      const matchedIndices = plotData.elements
        .map((el, idx) => ({ el, idx }))
        .filter(({ el }) => {
          const elementSymbol = detectElementFromColumnName(el)?.toLowerCase() || el.toLowerCase();
          return assocElements.has(elementSymbol);
        })
        .map(({ idx }) => idx);

      if (matchedIndices.length < 2) return;

      const minIdx = Math.min(...matchedIndices);
      const maxIdx = Math.max(...matchedIndices);

      // Position negative associations below 0, stacked
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
    });

    return shapes;
  }, [associations, settings.showConnectionLine, plotData]);

  // Build annotations for each association
  const annotations = useMemo(() => {
    const annots: any[] = [];

    // Group associations by side
    const positiveAssocs = associations.filter(a => a.side === 'positive');
    const negativeAssocs = associations.filter(a => a.side === 'negative');

    // Add labels for positive side associations (inside plot area, top-left)
    positiveAssocs.forEach((assoc, idx) => {
      annots.push({
        x: 0.02,
        y: 0.85 - (idx * 0.08),
        xref: 'paper',
        yref: 'y',
        yanchor: 'middle',
        text: `<b>${assoc.name}</b>`,
        showarrow: false,
        font: { size: 11, color: assoc.color },
        bgcolor: 'rgba(255,255,255,0.85)',
        bordercolor: assoc.color,
        borderwidth: 1,
        borderpad: 4,
        xanchor: 'left',
      });
    });

    // Add labels for negative side associations (inside plot area, bottom-right)
    negativeAssocs.forEach((assoc, idx) => {
      annots.push({
        x: 0.98,
        y: -0.85 + (idx * 0.08),
        xref: 'paper',
        yref: 'y',
        yanchor: 'middle',
        text: `<b>${assoc.name}</b>`,
        showarrow: false,
        font: { size: 11, color: assoc.color },
        bgcolor: 'rgba(255,255,255,0.85)',
        bordercolor: assoc.color,
        borderwidth: 1,
        borderpad: 4,
        xanchor: 'right',
      });
    });

    return annots;
  }, [associations]);

  const varianceExplained = pcaResult.varianceExplained[componentIndex]?.toFixed(1);

  return (
    <Plot
      data={[
        {
          x: plotData.elements,
          y: plotData.loadings,
          type: 'scatter',
          mode: 'lines+markers',
          line: {
            color: associations.length > 0 ? '#d1d5db' : '#9ca3af',
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
          hovertemplate: '%{x}<br>Loading: %{y:.3f}<extra></extra>',
        },
      ]}
      layout={{
        title: {
          text: `PC${componentIndex + 1} (${varianceExplained}%)`,
          font: { size: 13 },
        },
        height: settings.plotHeight,
        margin: { t: 40, r: 15, b: 80, l: 50 },
        xaxis: {
          tickangle: 45,
          tickfont: { size: 9 },
          showgrid: false,
        },
        yaxis: {
          title: { text: 'Loading', font: { size: 10 } },
          tickfont: { size: 9 },
          range: [-1.1, 1.1],
          zeroline: true,
          zerolinecolor: '#374151',
          zerolinewidth: 1,
          gridcolor: '#e5e7eb',
        },
        showlegend: false,
        annotations,
        shapes: connectionShapes,
      }}
      config={{
        responsive: true,
        displayModeBar: true,
        toImageButtonOptions: {
          format: 'png',
          filename: `PC${componentIndex + 1}_figure`,
          height: settings.plotHeight,
          width: 600,
          scale: 2,
        },
      }}
      style={{ width: '100%' }}
    />
  );
};

/**
 * Main Figure Generator Dialog
 */
export const PCAFigureGenerator: React.FC<PCAFigureGeneratorProps> = ({
  pcaResult,
  nComponents = 8,
}) => {
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const customAssociations = useTransformationStore((state) => state.customAssociations);

  // Export the figure as PNG
  const handleExportFigure = useCallback(async () => {
    if (!previewRef.current) return;

    setExporting(true);
    try {
      const canvas = await html2canvas(previewRef.current, {
        backgroundColor: '#ffffff',
        scale: 2, // Higher resolution
        logging: false,
        useCORS: true,
      });

      const link = document.createElement('a');
      link.download = 'pca_associations_figure.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (error) {
      console.error('Export failed:', error);
    } finally {
      setExporting(false);
    }
  }, []);

  const actualComponents = Math.min(nComponents, pcaResult.eigenvalues.length);

  // PC configuration state
  const [pcConfigs, setPcConfigs] = useState<PCConfig[]>(() =>
    Array.from({ length: actualComponents }, (_, i) => ({
      pcIndex: i,
      enabled: i < 4, // Enable first 4 by default
      associationIds: [],
    }))
  );

  // Figure settings
  const [settings, setSettings] = useState<FigureSettings>({
    columns: 2,
    plotHeight: 280,
    showTitle: true,
    title: 'PCA Element Associations',
    highlightOpacity: 0.85,
    lineWidth: 2,
    showConnectionLine: true,
  });

  // Get enabled PCs
  const enabledPCs = pcConfigs.filter((pc) => pc.enabled);

  // Get associations for a PC (returns array of CustomAssociation objects)
  const getAssociationsForPCConfig = (pcIndex: number): CustomAssociation[] => {
    const config = pcConfigs.find((c) => c.pcIndex === pcIndex);
    if (!config || config.associationIds.length === 0) return [];
    return config.associationIds
      .map((id) => customAssociations.find((a) => a.id === id))
      .filter((a): a is CustomAssociation => a !== undefined);
  };

  // Get available associations for a PC (by PC number)
  const getAvailableAssociationsForPC = (pcNumber: number) => {
    return customAssociations.filter((a) => a.pcNumber === pcNumber);
  };

  // Toggle PC enabled
  const togglePC = (pcIndex: number) => {
    setPcConfigs((prev) =>
      prev.map((pc) =>
        pc.pcIndex === pcIndex ? { ...pc, enabled: !pc.enabled } : pc
      )
    );
  };

  // Toggle association for PC (add/remove from array)
  const toggleAssociation = (pcIndex: number, associationId: string) => {
    setPcConfigs((prev) =>
      prev.map((pc) => {
        if (pc.pcIndex !== pcIndex) return pc;
        const hasId = pc.associationIds.includes(associationId);
        return {
          ...pc,
          associationIds: hasId
            ? pc.associationIds.filter((id) => id !== associationId)
            : [...pc.associationIds, associationId],
        };
      })
    );
  };

  // Calculate grid layout
  const gridCols = settings.columns;

  return (
    <>
      <Button
        variant="outlined"
        startIcon={<ImageIcon />}
        onClick={() => setOpen(true)}
        size="small"
      >
        Generate Figure
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        maxWidth="xl"
        fullWidth
        PaperProps={{ sx: { minHeight: '80vh' } }}
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <ImageIcon />
            <Typography variant="h6">Generate PCA Figure</Typography>
          </Box>
        </DialogTitle>

        <DialogContent>
          <Grid container spacing={2}>
            {/* Settings Panel */}
            <Grid item xs={12} md={3}>
              <Paper sx={{ p: 2, height: '100%' }}>
                <Typography variant="subtitle2" gutterBottom>
                  Figure Settings
                </Typography>

                {/* Title */}
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={settings.showTitle}
                      onChange={(e) =>
                        setSettings({ ...settings, showTitle: e.target.checked })
                      }
                      size="small"
                    />
                  }
                  label="Show Title"
                />
                {settings.showTitle && (
                  <TextField
                    fullWidth
                    size="small"
                    value={settings.title}
                    onChange={(e) =>
                      setSettings({ ...settings, title: e.target.value })
                    }
                    sx={{ mb: 2 }}
                  />
                )}

                {/* Columns */}
                <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                  <InputLabel>Columns</InputLabel>
                  <Select
                    value={settings.columns}
                    onChange={(e) =>
                      setSettings({ ...settings, columns: e.target.value as 1 | 2 | 3 | 4 })
                    }
                    label="Columns"
                  >
                    <MenuItem value={1}>1 Column</MenuItem>
                    <MenuItem value={2}>2 Columns</MenuItem>
                    <MenuItem value={3}>3 Columns</MenuItem>
                    <MenuItem value={4}>4 Columns</MenuItem>
                  </Select>
                </FormControl>

                {/* Plot Height */}
                <Typography variant="body2" gutterBottom>
                  Plot Height: {settings.plotHeight}px
                </Typography>
                <Slider
                  value={settings.plotHeight}
                  onChange={(_, v) => setSettings({ ...settings, plotHeight: v as number })}
                  min={200}
                  max={500}
                  step={20}
                  sx={{ mb: 2 }}
                />

                {/* Highlight Opacity */}
                <Typography variant="body2" gutterBottom>
                  Highlight Intensity: {Math.round(settings.highlightOpacity * 100)}%
                </Typography>
                <Slider
                  value={settings.highlightOpacity}
                  onChange={(_, v) => setSettings({ ...settings, highlightOpacity: v as number })}
                  min={0.3}
                  max={1}
                  step={0.05}
                  sx={{ mb: 2 }}
                />

                {/* Connection Line */}
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={settings.showConnectionLine}
                      onChange={(e) =>
                        setSettings({ ...settings, showConnectionLine: e.target.checked })
                      }
                      size="small"
                    />
                  }
                  label="Show Connection Line"
                />

                <Divider sx={{ my: 2 }} />

                {/* PC Selection */}
                <Typography variant="subtitle2" gutterBottom>
                  Select PCs & Associations
                </Typography>
                {pcConfigs.map((config) => {
                  const availableAssocs = getAvailableAssociationsForPC(config.pcIndex + 1);
                  return (
                    <Box key={config.pcIndex} sx={{ mb: 2 }}>
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={config.enabled}
                            onChange={() => togglePC(config.pcIndex)}
                            size="small"
                          />
                        }
                        label={
                          <Typography variant="body2" fontWeight={500}>
                            PC{config.pcIndex + 1} ({pcaResult.varianceExplained[config.pcIndex]?.toFixed(1)}%)
                          </Typography>
                        }
                      />
                      {config.enabled && availableAssocs.length > 0 && (
                        <Box sx={{ ml: 3, mt: 0.5 }}>
                          <Typography variant="caption" color="text.secondary">
                            Highlight associations:
                          </Typography>
                          {availableAssocs.map((assoc) => (
                            <FormControlLabel
                              key={assoc.id}
                              control={
                                <Checkbox
                                  checked={config.associationIds.includes(assoc.id)}
                                  onChange={() => toggleAssociation(config.pcIndex, assoc.id)}
                                  size="small"
                                  sx={{
                                    color: assoc.color,
                                    '&.Mui-checked': { color: assoc.color },
                                  }}
                                />
                              }
                              label={
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                  <Box
                                    sx={{
                                      width: 8,
                                      height: 8,
                                      borderRadius: '50%',
                                      bgcolor: assoc.color,
                                    }}
                                  />
                                  <Typography variant="caption">{assoc.name}</Typography>
                                </Box>
                              }
                              sx={{ display: 'block', ml: 0 }}
                            />
                          ))}
                        </Box>
                      )}
                      {config.enabled && availableAssocs.length === 0 && (
                        <Typography variant="caption" color="text.secondary" sx={{ ml: 3, display: 'block' }}>
                          No associations for this PC
                        </Typography>
                      )}
                    </Box>
                  );
                })}

                {customAssociations.length === 0 && (
                  <Typography variant="caption" color="text.secondary">
                    No custom associations created yet. Use "Select Elements" on the
                    Eigenvector Plots tab to create associations.
                  </Typography>
                )}
              </Paper>
            </Grid>

            {/* Preview Panel */}
            <Grid item xs={12} md={9}>
              <Paper ref={previewRef} sx={{ p: 2, bgcolor: '#fafafa' }}>
                {settings.showTitle && (
                  <Typography variant="h6" align="center" gutterBottom>
                    {settings.title}
                  </Typography>
                )}

                {enabledPCs.length === 0 ? (
                  <Box sx={{ p: 4, textAlign: 'center' }}>
                    <Typography color="text.secondary">
                      Select at least one PC to preview the figure
                    </Typography>
                  </Box>
                ) : (
                  <Grid container spacing={1}>
                    {enabledPCs.map((config) => (
                      <Grid
                        item
                        xs={12}
                        sm={gridCols >= 2 ? 6 : 12}
                        md={12 / gridCols}
                        key={config.pcIndex}
                      >
                        <FigurePCPlot
                          pcaResult={pcaResult}
                          componentIndex={config.pcIndex}
                          associations={getAssociationsForPCConfig(config.pcIndex)}
                          settings={settings}
                        />
                      </Grid>
                    ))}
                  </Grid>
                )}

                {/* Legend for associations */}
                {enabledPCs.some((c) => c.associationIds.length > 0) && (
                  <Box sx={{ mt: 2, display: 'flex', flexWrap: 'wrap', gap: 1, justifyContent: 'center' }}>
                    {enabledPCs.flatMap((config) =>
                      getAssociationsForPCConfig(config.pcIndex).map((assoc) => (
                        <Chip
                          key={`${config.pcIndex}-${assoc.id}`}
                          size="small"
                          label={`PC${config.pcIndex + 1}: ${assoc.name}`}
                          sx={{
                            bgcolor: assoc.color + '20',
                            color: assoc.color,
                            border: `1px solid ${assoc.color}`,
                          }}
                        />
                      ))
                    )}
                  </Box>
                )}
              </Paper>
            </Grid>
          </Grid>
        </DialogContent>

        <DialogActions>
          <Typography variant="caption" color="text.secondary" sx={{ mr: 'auto', ml: 2 }}>
            Use the camera icon on each plot to download individual images
          </Typography>
          <Button
            variant="contained"
            startIcon={<DownloadIcon />}
            onClick={handleExportFigure}
            disabled={exporting || enabledPCs.length === 0}
          >
            {exporting ? 'Exporting...' : 'Export All as PNG'}
          </Button>
          <Button onClick={() => setOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default PCAFigureGenerator;
