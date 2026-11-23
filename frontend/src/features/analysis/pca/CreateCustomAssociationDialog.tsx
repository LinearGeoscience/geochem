/**
 * CreateCustomAssociationDialog Component
 *
 * Dialog for creating a custom element association from selected elements
 * on the eigenvector plot. Users can name the association, select the PC side,
 * and choose a highlight color.
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
  RadioGroup,
  FormControlLabel,
  Radio,
  Chip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import BookmarkIcon from '@mui/icons-material/Bookmark';
import { useTransformationStore } from '../../../store/transformationStore';
import { detectElementFromColumnName } from '../../../utils/calculations/elementNameNormalizer';

interface CreateCustomAssociationDialogProps {
  open: boolean;
  onClose: () => void;
  selectedElements: string[]; // Original column names
  pcNumber: number;
  defaultSide?: 'positive' | 'negative';
  onCreated?: (associationId: string) => void;
}

// Predefined color options for associations
const COLOR_OPTIONS = [
  { name: 'Gold', color: '#f59e0b' },
  { name: 'Emerald', color: '#10b981' },
  { name: 'Blue', color: '#3b82f6' },
  { name: 'Purple', color: '#8b5cf6' },
  { name: 'Rose', color: '#f43f5e' },
  { name: 'Cyan', color: '#06b6d4' },
  { name: 'Orange', color: '#f97316' },
  { name: 'Lime', color: '#84cc16' },
];

export const CreateCustomAssociationDialog: React.FC<CreateCustomAssociationDialogProps> = ({
  open,
  onClose,
  selectedElements,
  pcNumber,
  defaultSide = 'positive',
  onCreated,
}) => {
  const addCustomAssociation = useTransformationStore((state) => state.addCustomAssociation);

  // Form state
  const [name, setName] = useState('');
  const [side, setSide] = useState<'positive' | 'negative'>(defaultSide);
  const [selectedColor, setSelectedColor] = useState(COLOR_OPTIONS[0].color);

  // Get element symbols from column names
  const elementSymbols = useMemo(() => {
    return selectedElements
      .map((col) => detectElementFromColumnName(col))
      .filter((el): el is string => el !== null);
  }, [selectedElements]);

  // Generate suggested name from element symbols
  const suggestedName = useMemo(() => {
    if (elementSymbols.length === 0) return '';
    if (elementSymbols.length <= 3) {
      return elementSymbols.join('-');
    }
    return `${elementSymbols.slice(0, 3).join('-')}+${elementSymbols.length - 3}`;
  }, [elementSymbols]);

  // Reset form when dialog opens
  React.useEffect(() => {
    if (open) {
      setName('');
      setSide(defaultSide);
      setSelectedColor(COLOR_OPTIONS[0].color);
    }
  }, [open, defaultSide]);

  const handleCreate = () => {
    if (!name.trim() || selectedElements.length === 0) return;

    const newAssociation = addCustomAssociation({
      name: name.trim(),
      elements: selectedElements,
      elementSymbols,
      pcNumber,
      side,
      color: selectedColor,
    });

    onCreated?.(newAssociation.id);
    onClose();
  };

  const isValid = name.trim().length > 0 && selectedElements.length > 0;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <BookmarkIcon sx={{ color: selectedColor }} />
          <Typography variant="h6">Create Custom Association</Typography>
        </Box>
      </DialogTitle>

      <DialogContent>
        {/* Name input */}
        <TextField
          autoFocus
          fullWidth
          label="Association Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={suggestedName || 'My Custom Association'}
          helperText={suggestedName ? `Suggested: ${suggestedName}` : undefined}
          sx={{ mt: 1, mb: 2 }}
        />

        {/* Selected elements display */}
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2" gutterBottom>
            Selected Elements ({selectedElements.length})
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {elementSymbols.map((symbol, idx) => (
              <Chip
                key={idx}
                label={symbol}
                size="small"
                sx={{
                  bgcolor: selectedColor + '20',
                  color: selectedColor,
                  borderColor: selectedColor,
                  border: '1px solid',
                }}
              />
            ))}
          </Box>
          {selectedElements.length === 0 && (
            <Typography variant="caption" color="error">
              No elements selected. Select elements on the eigenvector plot first.
            </Typography>
          )}
        </Box>

        {/* PC and Side info */}
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2" gutterBottom>
            PC{pcNumber} Side
          </Typography>
          <RadioGroup
            row
            value={side}
            onChange={(e) => setSide(e.target.value as 'positive' | 'negative')}
          >
            <FormControlLabel
              value="positive"
              control={<Radio size="small" />}
              label={
                <Typography variant="body2" color="#22c55e">
                  Positive
                </Typography>
              }
            />
            <FormControlLabel
              value="negative"
              control={<Radio size="small" />}
              label={
                <Typography variant="body2" color="#ef4444">
                  Negative
                </Typography>
              }
            />
          </RadioGroup>
        </Box>

        {/* Color selection */}
        <FormControl fullWidth sx={{ mb: 2 }}>
          <InputLabel>Highlight Color</InputLabel>
          <Select
            value={selectedColor}
            onChange={(e) => setSelectedColor(e.target.value)}
            label="Highlight Color"
          >
            {COLOR_OPTIONS.map((option) => (
              <MenuItem key={option.color} value={option.color}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box
                    sx={{
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      bgcolor: option.color,
                    }}
                  />
                  <Typography variant="body2">{option.name}</Typography>
                </Box>
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {/* Preview */}
        <Box
          sx={{
            p: 2,
            bgcolor: selectedColor + '10',
            border: `2px solid ${selectedColor}`,
            borderRadius: 1,
          }}
        >
          <Typography variant="caption" color="text.secondary">
            Preview
          </Typography>
          <Typography variant="body1" fontWeight={600} sx={{ color: selectedColor }}>
            {name || suggestedName || 'Custom Association'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            PC{pcNumber} • {side === 'positive' ? 'Positive' : 'Negative'} • {elementSymbols.length} elements
          </Typography>
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleCreate}
          disabled={!isValid}
          sx={{
            bgcolor: selectedColor,
            '&:hover': { bgcolor: selectedColor, filter: 'brightness(0.9)' },
          }}
        >
          Create Association
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default CreateCustomAssociationDialog;
