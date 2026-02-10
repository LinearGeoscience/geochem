/**
 * ElementVerificationDialog Component
 *
 * Dialog for users to verify and correct element name mappings.
 * Shows auto-detected element symbols with confidence indicators
 * and allows manual overrides.
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  TextField,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Tooltip,
  IconButton,
  Alert,
  Grid,
  Divider,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningIcon from '@mui/icons-material/Warning';
import ErrorIcon from '@mui/icons-material/Error';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';

import {
  ElementMapping,
  ElementMappingConfidence,
} from '../../../types/associations';
import {
  createElementMappings,
  buildMappingMap,
  getMappingSummary,
  autoFillMappings,
  PERIODIC_TABLE_SYMBOLS,
} from '../../../utils/calculations/elementNameNormalizer';

interface ElementVerificationDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (mappings: Map<string, string>) => void;
  columnNames: string[];
  initialMappings?: ElementMapping[];
}

/**
 * Get color and icon for confidence level
 */
function getConfidenceStyle(confidence: ElementMappingConfidence): {
  color: string;
  bgColor: string;
  icon: React.ReactNode;
  label: string;
} {
  switch (confidence) {
    case 'high':
      return {
        color: '#166534',
        bgColor: '#dcfce7',
        icon: <CheckCircleIcon fontSize="small" sx={{ color: '#22c55e' }} />,
        label: 'High',
      };
    case 'medium':
      return {
        color: '#854d0e',
        bgColor: '#fef9c3',
        icon: <WarningIcon fontSize="small" sx={{ color: '#eab308' }} />,
        label: 'Medium',
      };
    case 'low':
      return {
        color: '#9a3412',
        bgColor: '#fed7aa',
        icon: <WarningIcon fontSize="small" sx={{ color: '#f97316' }} />,
        label: 'Low',
      };
    case 'unknown':
    default:
      return {
        color: '#991b1b',
        bgColor: '#fee2e2',
        icon: <ErrorIcon fontSize="small" sx={{ color: '#ef4444' }} />,
        label: 'Unknown',
      };
  }
}

export const ElementVerificationDialog: React.FC<ElementVerificationDialogProps> = ({
  open,
  onClose,
  onConfirm,
  columnNames,
  initialMappings,
}) => {
  // Initialize mappings from column names or use provided initial mappings
  const [mappings, setMappings] = useState<ElementMapping[]>(() => {
    if (initialMappings && initialMappings.length > 0) {
      return initialMappings;
    }
    return createElementMappings(columnNames);
  });

  // Track user edits
  const [editedValues, setEditedValues] = useState<Record<string, string>>({});

  // Summary statistics
  const summary = useMemo(() => getMappingSummary(mappings), [mappings]);

  // Handle user editing an override value
  const handleOverrideChange = useCallback((originalName: string, value: string) => {
    setEditedValues(prev => ({
      ...prev,
      [originalName]: value.trim(),
    }));
  }, []);

  // Validate if a value is a valid element symbol
  const isValidElement = useCallback((value: string): boolean => {
    if (!value) return true; // Empty is valid (clears override)
    const normalized = value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
    return PERIODIC_TABLE_SYMBOLS.has(normalized);
  }, []);

  // Auto-fill low confidence mappings
  const handleAutoFill = useCallback(() => {
    const filled = autoFillMappings(mappings);
    setMappings(filled);
    // Update editedValues to reflect auto-filled overrides
    const newEdits: Record<string, string> = { ...editedValues };
    for (const m of filled) {
      if (m.userOverride && !editedValues[m.originalName]) {
        newEdits[m.originalName] = m.userOverride;
      }
    }
    setEditedValues(newEdits);
  }, [mappings, editedValues]);

  // Handle confirm
  const handleConfirm = useCallback(() => {
    // Apply edited values as userOverride
    const finalMappings = mappings.map(m => {
      const edited = editedValues[m.originalName];
      if (edited !== undefined && edited !== '') {
        // Normalize case
        const normalized = edited.charAt(0).toUpperCase() + edited.slice(1).toLowerCase();
        return { ...m, userOverride: normalized };
      }
      return m;
    });

    // Build the mapping map
    const map = buildMappingMap(finalMappings);
    onConfirm(map);
  }, [mappings, editedValues, onConfirm]);

  // Filter to show only element columns (non-excluded)
  const elementMappings = useMemo(
    () => mappings.filter(m => !m.isExcluded),
    [mappings]
  );

  // Count issues
  const issueCount = summary.low + summary.unknown;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{ sx: { maxHeight: '80vh' } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="h6">Verify Element Names</Typography>
          <Tooltip title="Element names in your data may have suffixes (like _ppm, _pct) or be in oxide form. This dialog helps ensure they are correctly mapped to element symbols for pattern matching.">
            <IconButton size="small">
              <HelpOutlineIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
        <IconButton onClick={onClose} size="small">
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        <Grid container spacing={2}>
          {/* Summary panel */}
          <Grid item xs={12} md={3}>
            <Paper sx={{ p: 2, height: '100%' }}>
              <Typography variant="subtitle2" gutterBottom fontWeight={600}>
                Summary
              </Typography>
              <Box sx={{ '& > div': { py: 0.5 } }}>
                <div>
                  <Typography variant="body2">
                    <strong>{summary.total}</strong> columns
                  </Typography>
                </div>
                <Divider sx={{ my: 1 }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <CheckCircleIcon fontSize="small" sx={{ color: '#22c55e' }} />
                  <Typography variant="body2">
                    {summary.high} high confidence
                  </Typography>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <WarningIcon fontSize="small" sx={{ color: '#eab308' }} />
                  <Typography variant="body2">
                    {summary.medium} medium
                  </Typography>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <WarningIcon fontSize="small" sx={{ color: '#f97316' }} />
                  <Typography variant="body2">
                    {summary.low} low
                  </Typography>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <ErrorIcon fontSize="small" sx={{ color: '#ef4444' }} />
                  <Typography variant="body2">
                    {summary.unknown} unknown
                  </Typography>
                </div>
                <Divider sx={{ my: 1 }} />
                <div>
                  <Typography variant="body2" color="text.secondary">
                    {summary.excluded} excluded
                  </Typography>
                </div>
              </Box>

              <Box sx={{ mt: 2 }}>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<AutoFixHighIcon />}
                  onClick={handleAutoFill}
                  fullWidth
                >
                  Auto-fill
                </Button>
              </Box>
            </Paper>
          </Grid>

          {/* Mapping table */}
          <Grid item xs={12} md={9}>
            {issueCount > 0 && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                {issueCount} column(s) have low or unknown confidence. Please verify or provide overrides.
              </Alert>
            )}

            <TableContainer component={Paper} sx={{ maxHeight: 400 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>Original Name</TableCell>
                    <TableCell align="center">Confidence</TableCell>
                    <TableCell>Detected</TableCell>
                    <TableCell>Override</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {elementMappings.map((mapping) => {
                    const style = getConfidenceStyle(mapping.confidence);
                    const editedValue = editedValues[mapping.originalName] ?? '';
                    const currentElement = editedValue || mapping.userOverride || mapping.detectedElement;
                    const isInvalidEdit = Boolean(editedValue) && !isValidElement(editedValue);

                    return (
                      <TableRow
                        key={mapping.originalName}
                        sx={{
                          bgcolor: mapping.confidence === 'unknown' || mapping.confidence === 'low'
                            ? '#fef3c7'
                            : undefined,
                        }}
                      >
                        <TableCell>
                          <Tooltip title={mapping.detectedUnit ? `Unit: ${mapping.detectedUnit}` : ''}>
                            <Typography variant="body2" fontFamily="monospace">
                              {mapping.originalName}
                            </Typography>
                          </Tooltip>
                        </TableCell>
                        <TableCell align="center">
                          <Tooltip title={style.label}>
                            <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                              {style.icon}
                            </Box>
                          </Tooltip>
                        </TableCell>
                        <TableCell>
                          {mapping.detectedElement ? (
                            <Chip
                              size="small"
                              label={mapping.detectedElement}
                              sx={{
                                bgcolor: style.bgColor,
                                color: style.color,
                                fontWeight: 500,
                              }}
                            />
                          ) : (
                            <Typography variant="body2" color="text.disabled">
                              —
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell>
                          <TextField
                            size="small"
                            placeholder={currentElement || 'Enter symbol'}
                            value={editedValue}
                            onChange={(e) => handleOverrideChange(mapping.originalName, e.target.value)}
                            error={isInvalidEdit}
                            helperText={isInvalidEdit ? 'Invalid element' : undefined}
                            inputProps={{
                              maxLength: 3,
                              style: { fontFamily: 'monospace', width: 60 },
                            }}
                            sx={{ '& .MuiInputBase-root': { height: 32 } }}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </Grid>
        </Grid>

        {/* Excluded columns info */}
        {summary.excluded > 0 && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="caption" color="text.secondary">
              <strong>Excluded columns:</strong>{' '}
              {mappings
                .filter(m => m.isExcluded)
                .map(m => m.originalName)
                .join(', ')}
            </Typography>
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} color="inherit">
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleConfirm}
          startIcon={<CheckCircleIcon />}
        >
          Confirm & Continue
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ElementVerificationDialog;
