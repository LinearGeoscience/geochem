/**
 * CreateCustomColorScaleDialog Component
 *
 * Dialog for creating a color scale based on selected elements or a custom association.
 * Simplified version of CreateColorScaleDialog that doesn't require a MatchScore.
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
import {
  useAttributeStore,
  createRangeEntry,
  ClassificationMethod,
} from '../../../store/attributeStore';
import { useAppStore } from '../../../store/appStore';
import { COLOR_PALETTES, generateColorsFromPalette } from '../../../utils/colorPalettes';
import { jenksBreaks, equalIntervals, quantileBreaks } from '../../../utils/classification';

interface CreateCustomColorScaleDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: (message: string) => void;
  pcNumber: number;
  associationName: string;
  side: 'positive' | 'negative';
  color?: string;
}

export const CreateCustomColorScaleDialog: React.FC<CreateCustomColorScaleDialogProps> = ({
  open,
  onClose,
  onSuccess,
  pcNumber,
  associationName,
  side,
  color = '#f59e0b',
}) => {
  const { data, columns } = useAppStore();
  const { setField, setMethod, setPalette, setNumClasses, setEntries, color: colorConfig } = useAttributeStore();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // State
  const [useNegated, setUseNegated] = useState(side === 'negative');
  const [selectedPalette, setSelectedPalette] = useState('YlOrRd');
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

  // Generate preview colors
  const previewColors = useMemo(() => {
    return generateColorsFromPalette(selectedPalette, numClassesLocal);
  }, [selectedPalette, numClassesLocal]);

  // Available palettes
  const paletteOptions = useMemo(() => {
    return Object.keys(COLOR_PALETTES).slice(0, 15);
  }, []);

  const handleCreate = () => {
    setErrorMessage(null);

    // Validate column exists
    const targetColumn = columns.find((c) => c.name === pcColumn);
    if (!targetColumn) {
      setErrorMessage(`Column "${pcColumn}" not found. Please add PC scores to data first.`);
      return;
    }

    // Get numeric values for the column
    const values = data
      .map((d) => d[pcColumn])
      .filter((v) => typeof v === 'number' && !isNaN(v)) as number[];

    if (values.length === 0) {
      setErrorMessage(`No numeric values found in column "${pcColumn}".`);
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
    const defaultEntry = colorConfig.entries.find((e) => e.isDefault);
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

    const methodLabels: Record<string, string> = { quantile: 'quantile', jenks: 'Jenks', equal: 'equal interval' };
    onSuccess?.(`Colour scale applied: ${pcColumn} (${numClassesLocal} classes, ${methodLabels[method] || method})`);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <PaletteIcon sx={{ color }} />
          <Typography variant="h6">Create Color Scale</Typography>
        </Box>
      </DialogTitle>

      <DialogContent>
        {errorMessage && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErrorMessage(null)}>
            {errorMessage}
          </Alert>
        )}
        {/* Association Info */}
        <Box
          sx={{
            p: 2,
            mb: 2,
            bgcolor: color + '15',
            borderRadius: 1,
            border: `1px solid ${color}`,
          }}
        >
          <Typography variant="subtitle2" sx={{ color }}>
            {associationName}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            PC{pcNumber} | {side === 'positive' ? 'Positive' : 'Negative'} End
          </Typography>
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
                    {generateColorsFromPalette(palette, 5).map((c, i) => (
                      <Box key={i} sx={{ flex: 1, bgcolor: c }} />
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
            {previewColors.map((c, i) => (
              <Box key={i} sx={{ flex: 1, bgcolor: c }} />
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

export default CreateCustomColorScaleDialog;
