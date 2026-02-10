/**
 * CreateColorScaleDialog Component
 *
 * Dialog for creating a color scale in the attribute manager based on a
 * PCA association pattern. Allows users to configure the PC column,
 * palette, number of classes, and classification method.
 */

import React, { useState, useMemo } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  RadioGroup,
  FormControlLabel,
  Radio,
  Slider,
  Chip,
  Alert,
} from '@mui/material';
import PaletteIcon from '@mui/icons-material/Palette';
import { MatchScore, AssociationCategory } from '../../../types/associations';
import { CATEGORY_INFO } from '../../../data/elementAssociationPatterns';
import {
  useAttributeStore,
  createRangeEntry,
  ClassificationMethod,
} from '../../../store/attributeStore';
import { useAppStore } from '../../../store/appStore';
import { COLOR_PALETTES, generateColorsFromPalette } from '../../../utils/colorPalettes';
import { jenksBreaks, equalIntervals, quantileBreaks } from '../../../utils/classification';

interface CreateColorScaleDialogProps {
  open: boolean;
  onClose: () => void;
  pcNumber: number;
  association: MatchScore;
  side: 'positive' | 'negative';
  varianceExplained: number;
}

// Map category to default palette
const CATEGORY_PALETTES: Record<AssociationCategory, string> = {
  mineralisation: 'YlOrRd',
  alteration: 'PuBu',
  regolith: 'BuPu',
  lithological: 'Greys',
};

export const CreateColorScaleDialog: React.FC<CreateColorScaleDialogProps> = ({
  open,
  onClose,
  pcNumber,
  association,
  side,
  varianceExplained,
}) => {
  const { data, columns } = useAppStore();
  const { setField, setMethod, setPalette, setNumClasses, setEntries, color } = useAttributeStore();

  // State
  const [useNegated, setUseNegated] = useState(side === 'negative');
  const [selectedPalette, setSelectedPalette] = useState(
    CATEGORY_PALETTES[association.category] || 'Viridis'
  );
  const [numClassesLocal, setNumClassesLocal] = useState(5);
  const [method, setMethodLocal] = useState<ClassificationMethod>('quantile');

  // Column names
  const pcColumn = useNegated ? `negPC${pcNumber}` : `PC${pcNumber}`;

  // Check if PC columns exist
  const pcColumnsExist = useMemo(() => {
    const posCol = columns.find((c) => c.name === `PC${pcNumber}`);
    const negCol = columns.find((c) => c.name === `negPC${pcNumber}`);
    return { positive: !!posCol, negative: !!negCol };
  }, [columns, pcNumber]);

  // Get category styling
  const categoryInfo = CATEGORY_INFO[association.category];

  // Generate preview colors
  const previewColors = useMemo(() => {
    return generateColorsFromPalette(selectedPalette, numClassesLocal);
  }, [selectedPalette, numClassesLocal]);

  // Available palettes - group by type
  const paletteOptions = useMemo(() => {
    return Object.keys(COLOR_PALETTES).slice(0, 15); // Limit to first 15 for UI
  }, []);

  const handleCreate = () => {
    // Validate column exists
    const targetColumn = columns.find((c) => c.name === pcColumn);
    if (!targetColumn) {
      alert(`Column "${pcColumn}" not found. Please add PC scores to data first.`);
      return;
    }

    // Get numeric values for the column
    const values = data
      .map((d) => d[pcColumn])
      .filter((v) => typeof v === 'number' && !isNaN(v)) as number[];

    if (values.length === 0) {
      alert(`No numeric values found in column "${pcColumn}".`);
      return;
    }

    // Calculate breaks based on method
    let breaks: number[];
    switch (method) {
      case 'jenks':
        breaks = jenksBreaks(values, numClassesLocal);
        break;
      case 'quantile':
        breaks = quantileBreaks(values, numClassesLocal);
        break;
      case 'equal':
      default:
        breaks = equalIntervals(values, numClassesLocal);
        break;
    }

    // Generate colors
    const colors = generateColorsFromPalette(selectedPalette, numClassesLocal);

    // Create entries
    const newEntries = [];

    // Keep default entry from current config
    const defaultEntry = color.entries.find((e) => e.isDefault);
    if (defaultEntry) {
      newEntries.push(defaultEntry);
    }

    // Create range entries
    for (let i = 0; i < breaks.length - 1; i++) {
      const entry = createRangeEntry(breaks[i], breaks[i + 1], i, colors[i]);

      // Calculate row count
      entry.rowCount = values.filter(
        (v) =>
          v >= breaks[i] && (i === breaks.length - 2 ? v <= breaks[i + 1] : v < breaks[i + 1])
      ).length;
      entry.visibleRowCount = entry.rowCount;

      newEntries.push(entry);
    }

    // Apply to attribute store
    setField('color', pcColumn);
    setMethod('color', method);
    setPalette('color', selectedPalette);
    setNumClasses('color', numClassesLocal);
    setEntries('color', newEntries);

    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <PaletteIcon sx={{ color: categoryInfo.color }} />
          <Typography variant="h6">Create Color Scale</Typography>
        </Box>
      </DialogTitle>

      <DialogContent>
        {/* Association Info */}
        <Box
          sx={{
            p: 2,
            mb: 2,
            bgcolor: categoryInfo.bgColor,
            borderRadius: 1,
            border: `1px solid ${categoryInfo.color}`,
          }}
        >
          <Typography variant="subtitle2" sx={{ color: categoryInfo.color }}>
            {association.patternName}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Confidence: {Math.round(association.confidenceScore)}% | PC{pcNumber} ({varianceExplained.toFixed(1)}% variance)
          </Typography>
          <Box sx={{ mt: 0.5 }}>
            <Chip
              size="small"
              label={categoryInfo.displayName}
              sx={{ bgcolor: categoryInfo.bgColor, color: categoryInfo.color }}
            />
            <Chip
              size="small"
              label={side === 'positive' ? 'Positive End' : 'Negative End'}
              sx={{ ml: 0.5 }}
              variant="outlined"
            />
          </Box>
        </Box>

        {/* Column Selection */}
        <Typography variant="subtitle2" gutterBottom>
          PC Column
        </Typography>
        <RadioGroup
          value={useNegated ? 'neg' : 'pos'}
          onChange={(e) => setUseNegated(e.target.value === 'neg')}
        >
          <FormControlLabel
            value="pos"
            control={<Radio size="small" />}
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="body2">PC{pcNumber}</Typography>
                {!pcColumnsExist.positive && (
                  <Chip size="small" label="Not found" color="error" />
                )}
              </Box>
            }
          />
          <FormControlLabel
            value="neg"
            control={<Radio size="small" />}
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="body2">negPC{pcNumber}</Typography>
                <Typography variant="caption" color="text.secondary">
                  (inverted scale)
                </Typography>
                {!pcColumnsExist.negative && (
                  <Chip size="small" label="Not found" color="error" />
                )}
              </Box>
            }
          />
        </RadioGroup>

        {!pcColumnsExist.positive && !pcColumnsExist.negative && (
          <Alert severity="warning" sx={{ mt: 1, mb: 2 }}>
            PC score columns not found. Click "Add PC Scores to Data" in the Results tab first.
          </Alert>
        )}

        {/* Palette Selection */}
        <FormControl fullWidth sx={{ mt: 2 }}>
          <InputLabel>Color Palette</InputLabel>
          <Select
            value={selectedPalette}
            onChange={(e) => setSelectedPalette(e.target.value)}
            label="Color Palette"
          >
            {paletteOptions.map((palette) => (
              <MenuItem key={palette} value={palette}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box
                    sx={{
                      display: 'flex',
                      width: 60,
                      height: 12,
                      borderRadius: 0.5,
                      overflow: 'hidden',
                    }}
                  >
                    {generateColorsFromPalette(palette, 5).map((color, i) => (
                      <Box key={i} sx={{ flex: 1, bgcolor: color }} />
                    ))}
                  </Box>
                  <Typography variant="body2">{palette}</Typography>
                </Box>
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {/* Number of Classes */}
        <Box sx={{ mt: 2 }}>
          <Typography variant="body2" gutterBottom>
            Number of Classes: {numClassesLocal}
          </Typography>
          <Slider
            value={numClassesLocal}
            onChange={(_, value) => setNumClassesLocal(value as number)}
            min={2}
            max={10}
            step={1}
            marks
            valueLabelDisplay="auto"
          />
        </Box>

        {/* Classification Method */}
        <FormControl fullWidth sx={{ mt: 2 }}>
          <InputLabel>Classification Method</InputLabel>
          <Select
            value={method}
            onChange={(e) => setMethodLocal(e.target.value as ClassificationMethod)}
            label="Classification Method"
          >
            <MenuItem value="quantile">Quantile (Equal Count)</MenuItem>
            <MenuItem value="jenks">Jenks Natural Breaks</MenuItem>
            <MenuItem value="equal">Equal Intervals</MenuItem>
          </Select>
        </FormControl>

        {/* Preview */}
        <Box sx={{ mt: 3 }}>
          <Typography variant="subtitle2" gutterBottom>
            Preview
          </Typography>
          <Box
            sx={{
              display: 'flex',
              height: 20,
              borderRadius: 1,
              overflow: 'hidden',
              border: '1px solid',
              borderColor: 'divider',
            }}
          >
            {previewColors.map((color, i) => (
              <Box key={i} sx={{ flex: 1, bgcolor: color }} />
            ))}
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
            <Typography variant="caption" color="text.secondary">
              Low {pcColumn}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              High {pcColumn}
            </Typography>
          </Box>
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleCreate}
          disabled={!pcColumnsExist.positive && !pcColumnsExist.negative}
        >
          Create Color Scale
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default CreateColorScaleDialog;
