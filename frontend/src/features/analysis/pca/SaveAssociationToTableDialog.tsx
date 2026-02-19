/**
 * SaveAssociationToTableDialog Component
 *
 * Dialog for saving a PCA element association as a categorical column
 * in the data table. Users can name the association, adjust the classification
 * threshold, and preview how many samples will be classified.
 *
 * Supports multiple associations per PC - subsequent saves merge with existing values.
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
  TextField,
  Slider,
  Chip,
  Alert,
} from '@mui/material';
import TableChartIcon from '@mui/icons-material/TableChart';
import { FullPCAResult } from '../../../types/compositional';
import { useAppStore } from '../../../store/appStore';
import { getSortedLoadings } from '../../../utils/calculations/pcaAnalysis';
import { detectElementFromColumnName } from '../../../utils/calculations/elementNameNormalizer';
import {
  previewClassification,
  classifySamples,
  mergeClassifications,
  getDefaultThreshold,
  ClassificationConfig,
} from '../../../utils/calculations/pcaClassification';

interface SaveAssociationToTableDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: (message: string) => void;
  pcaResult: FullPCAResult;
  componentIndex: number;
  selectedElements: string[];
  defaultSide: 'positive' | 'negative';
}

export const SaveAssociationToTableDialog: React.FC<SaveAssociationToTableDialogProps> = ({
  open,
  onClose,
  onSuccess,
  pcaResult,
  componentIndex,
  selectedElements,
  defaultSide,
}) => {
  const { data, columns, addColumn } = useAppStore();
  const pcNumber = componentIndex + 1;
  const columnName = `PC${pcNumber} Association`;

  // Compute loading range for selected elements
  const loadingInfo = useMemo(() => {
    const sortedLoadings = getSortedLoadings(pcaResult, componentIndex);
    const selectedLoadings = selectedElements
      .map((el) => sortedLoadings.find((l) => l.element === el)?.loading)
      .filter((l): l is number => l !== undefined)
      .map((l) => Math.abs(l));

    if (selectedLoadings.length === 0) return { min: 0.3, max: 0.9 };

    return {
      min: Math.min(...selectedLoadings),
      max: Math.max(...selectedLoadings),
    };
  }, [pcaResult, componentIndex, selectedElements]);

  const defaultThreshold = useMemo(() => getDefaultThreshold(loadingInfo.min), [loadingInfo.min]);

  const [associationName, setAssociationName] = useState('');
  const [thresholdPercentile, setThresholdPercentile] = useState(defaultThreshold);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Get PC scores
  const pcScores = useMemo(() => {
    return pcaResult.scores.map((row) => row[componentIndex]);
  }, [pcaResult, componentIndex]);

  // Live preview
  const preview = useMemo(() => {
    return previewClassification(pcScores, defaultSide, thresholdPercentile);
  }, [pcScores, defaultSide, thresholdPercentile]);

  // Check if column already exists
  const columnExists = columns.some((c) => c.name === columnName);

  // Element symbols for display
  const elementSymbols = useMemo(() => {
    return selectedElements.map((el) => detectElementFromColumnName(el) || el);
  }, [selectedElements]);

  const handleSave = () => {
    setErrorMessage(null);

    if (!associationName.trim()) {
      setErrorMessage('Please enter an association name.');
      return;
    }

    const config: ClassificationConfig = {
      pcNumber,
      side: defaultSide,
      associationName: associationName.trim(),
      thresholdPercentile,
    };

    const newValues = classifySamples(pcScores, config);

    // Load existing column values and merge if column exists
    let finalValues: string[];
    if (columnExists) {
      const existingValues = data.map((row) => row[columnName] as string | null | undefined);
      finalValues = mergeClassifications(existingValues, newValues);
    } else {
      finalValues = newValues.map((v) => v ?? '');
    }

    addColumn(columnName, finalValues, 'categorical', 'Classification');

    const classifiedCount = newValues.filter((v) => v !== null).length;
    onSuccess?.(
      `Saved ${classifiedCount} samples as '${associationName.trim()}' to ${columnName}`
    );
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <TableChartIcon color="primary" />
          <Typography variant="h6">Save Association to Data Table</Typography>
        </Box>
      </DialogTitle>

      <DialogContent>
        {errorMessage && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErrorMessage(null)}>
            {errorMessage}
          </Alert>
        )}

        {/* Association name */}
        <TextField
          autoFocus
          fullWidth
          label="Association Name"
          placeholder='e.g., "Felsic", "Mineralisation", "Mafic"'
          value={associationName}
          onChange={(e) => setAssociationName(e.target.value)}
          sx={{ mt: 1, mb: 2 }}
        />

        {/* Selected elements */}
        <Typography variant="subtitle2" gutterBottom>
          Selected Elements
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 2 }}>
          {elementSymbols.map((symbol, idx) => (
            <Chip
              key={idx}
              label={symbol}
              size="small"
              sx={{
                bgcolor: defaultSide === 'positive' ? '#dcfce7' : '#fee2e2',
                color: defaultSide === 'positive' ? '#166534' : '#991b1b',
              }}
            />
          ))}
        </Box>

        {/* PC info */}
        <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
          <Chip label={`PC${pcNumber}`} variant="outlined" size="small" />
          <Chip
            label={defaultSide === 'positive' ? 'Positive End' : 'Negative End'}
            size="small"
            sx={{
              bgcolor: defaultSide === 'positive' ? '#dcfce7' : '#fee2e2',
              color: defaultSide === 'positive' ? '#166534' : '#991b1b',
            }}
          />
          <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
            Loading range: {loadingInfo.min.toFixed(2)} - {loadingInfo.max.toFixed(2)}
          </Typography>
        </Box>

        {/* Threshold slider */}
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2" gutterBottom>
            Classification Threshold: {thresholdPercentile}th percentile
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
            Higher threshold = fewer, more strongly expressing samples classified
          </Typography>
          <Slider
            value={thresholdPercentile}
            onChange={(_, value) => setThresholdPercentile(value as number)}
            min={10}
            max={90}
            step={5}
            marks={[
              { value: 10, label: '10%' },
              { value: 50, label: '50%' },
              { value: 90, label: '90%' },
            ]}
            valueLabelDisplay="auto"
          />
        </Box>

        {/* Live preview */}
        <Alert severity="info" sx={{ mb: 2 }}>
          <strong>
            {preview.classifiedCount} of {preview.totalSamples} samples
          </strong>{' '}
          will be classified as '{associationName || '...'}'
          {' '}({((preview.classifiedCount / Math.max(preview.totalSamples, 1)) * 100).toFixed(1)}%)
          <br />
          <Typography variant="caption" color="text.secondary">
            Threshold value: {preview.thresholdValue.toFixed(4)}
          </Typography>
        </Alert>

        {/* Column info */}
        <Box
          sx={{
            p: 1.5,
            bgcolor: '#f8fafc',
            borderRadius: 1,
            border: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Typography variant="body2">
            <strong>Column:</strong> {columnName}
          </Typography>
          {columnExists && (
            <Typography variant="caption" color="text.secondary">
              Column already exists - will update with new values (keeping other associations)
            </Typography>
          )}
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={!associationName.trim()}
          startIcon={<TableChartIcon />}
        >
          Save to Data Table
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default SaveAssociationToTableDialog;
