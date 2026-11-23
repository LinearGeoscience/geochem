/**
 * Element selection panel: pathfinder element chips (Halley mode) or grouped
 * extended elements with a reference standard / custom backgrounds, plus the
 * Sc/K normalisation options.
 */
import React from 'react';
import {
    Box, Paper, Typography, Chip, Tooltip, Button, FormControl, InputLabel, Select, MenuItem,
    Checkbox, TextField, FormLabel, RadioGroup, FormControlLabel, Radio,
} from '@mui/material';
import { SelectAll, Clear } from '@mui/icons-material';
import {
    PATHFINDER_ELEMENTS, SC_NORMALIZABLE_ELEMENTS, K_NORMALIZABLE_ELEMENTS, type PathfinderElement,
} from '../../../utils/calculations/pathfinderConstants';
import {
    EXTENDED_ELEMENT_CATEGORIES, BACKGROUND_STANDARDS, getBackgroundValue, type ReferenceStandardId,
} from '../../../utils/calculations/elementBackgroundConstants';
import type { PathfinderSettings } from './usePathfinderSettings';
import type { NormalizationType } from './types';
import { ColumnPicker } from '../../../components/ColumnPicker';

export interface PathfinderElementPanelProps {
    settings: PathfinderSettings;
    availableElements: PathfinderElement[];
    availableExtendedElements: string[];
    getElementColumn: (element: PathfinderElement) => string | null;
    getExtendedElementColumn: (element: string) => string | null;
    effectiveScColumn: string;
    effectiveKColumn: string;
    autoDetectedNormColumns: { sc: string | null; k: string | null };
}

export const PathfinderElementPanel: React.FC<PathfinderElementPanelProps> = ({
    settings, availableElements, availableExtendedElements, getElementColumn, getExtendedElementColumn,
    effectiveScColumn, effectiveKColumn, autoDetectedNormColumns,
}) => {
    const {
        mapMode, selectedElements, setSelectedElements, referenceStandard, setReferenceStandard,
        selectedExtendedElements, setSelectedExtendedElements, customBackgrounds, setCustomBackgrounds,
        normalization, setNormalization, setScColumn, setKColumn,
    } = settings;

    const toggleElement = (element: PathfinderElement) => {
        setSelectedElements(selectedElements.includes(element)
            ? selectedElements.filter(e => e !== element)
            : [...selectedElements, element]);
    };

    return (
        <Paper sx={{ p: 2, mb: 2 }}>
            {mapMode === 'pathfinder' ? (
                <Box sx={{ mb: 2 }}>
                    <Typography variant="subtitle2" gutterBottom>
                        Pathfinder Elements ({selectedElements.length}/{availableElements.length} selected)
                        <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                            (Click ⚙ to configure column mappings)
                        </Typography>
                    </Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
                        {PATHFINDER_ELEMENTS.map(element => {
                            const isAvailable = availableElements.includes(element);
                            const isSelected = selectedElements.includes(element);
                            const mappedColumn = getElementColumn(element);
                            return (
                                <Tooltip key={element} title={mappedColumn ? `Column: ${mappedColumn}` : 'No column mapped'}>
                                    <Chip
                                        label={element}
                                        size="small"
                                        color={isSelected ? 'primary' : 'default'}
                                        variant={isSelected ? 'filled' : 'outlined'}
                                        disabled={!isAvailable}
                                        onClick={() => isAvailable && toggleElement(element)}
                                        sx={{ opacity: isAvailable ? 1 : 0.4 }}
                                    />
                                </Tooltip>
                            );
                        })}
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                        <Button size="small" startIcon={<SelectAll />} onClick={() => setSelectedElements([...availableElements])}>
                            Select All
                        </Button>
                        <Button size="small" startIcon={<Clear />} onClick={() => setSelectedElements([])}>
                            Clear
                        </Button>
                    </Box>
                </Box>
            ) : (
                <Box sx={{ mb: 2 }}>
                    {/* Reference Standard Selection */}
                    <Box sx={{ mb: 1.5, display: 'flex', gap: 2, alignItems: 'center' }}>
                        <FormControl size="small" sx={{ minWidth: 240 }}>
                            <InputLabel>Reference Standard</InputLabel>
                            <Select
                                value={referenceStandard}
                                onChange={(e) => setReferenceStandard(e.target.value as ReferenceStandardId)}
                                label="Reference Standard"
                            >
                                {BACKGROUND_STANDARDS.map(std => (
                                    <MenuItem key={std.id} value={std.id}>
                                        {std.name} ({std.reference})
                                    </MenuItem>
                                ))}
                                <MenuItem value="custom">Custom Background Values</MenuItem>
                            </Select>
                        </FormControl>
                        {referenceStandard === 'custom' && (
                            <Button
                                size="small"
                                onClick={() => {
                                    // Pre-fill custom backgrounds from UCC
                                    const uccBg: Record<string, number> = {};
                                    for (const el of selectedExtendedElements) {
                                        const entry = getBackgroundValue('ucc-rudnick-gao-2003', el);
                                        if (entry) uccBg[el] = entry.value;
                                    }
                                    setCustomBackgrounds({ ...customBackgrounds, ...uccBg });
                                }}
                            >
                                Reset to UCC
                            </Button>
                        )}
                    </Box>

                    <Typography variant="subtitle2" gutterBottom>
                        Elements ({selectedExtendedElements.length} selected)
                    </Typography>

                    {/* Grouped element checkboxes */}
                    {Object.entries(EXTENDED_ELEMENT_CATEGORIES).map(([catKey, group]) => {
                        const groupElements = group.elements as readonly string[];
                        const availableInGroup = groupElements.filter(el => availableExtendedElements.includes(el));
                        if (availableInGroup.length === 0) return null;
                        const selectedInGroup = availableInGroup.filter(el => selectedExtendedElements.includes(el));
                        const allSelected = selectedInGroup.length === availableInGroup.length;

                        return (
                            <Box key={catKey} sx={{ mb: 1 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    <Checkbox
                                        size="small"
                                        checked={allSelected && availableInGroup.length > 0}
                                        indeterminate={selectedInGroup.length > 0 && !allSelected}
                                        onChange={() => {
                                            if (allSelected) {
                                                setSelectedExtendedElements(selectedExtendedElements.filter(el => !availableInGroup.includes(el)));
                                            } else {
                                                setSelectedExtendedElements([...new Set([...selectedExtendedElements, ...availableInGroup])]);
                                            }
                                        }}
                                    />
                                    <Typography variant="caption" fontWeight="bold">
                                        {group.label} ({selectedInGroup.length}/{availableInGroup.length})
                                    </Typography>
                                </Box>
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, ml: 3 }}>
                                    {groupElements.map(element => {
                                        const isAvailable = availableExtendedElements.includes(element);
                                        const isSelected = selectedExtendedElements.includes(element);
                                        const col = getExtendedElementColumn(element);
                                        return (
                                            <Tooltip key={element} title={col ? `Column: ${col}` : 'No column found'}>
                                                <Chip
                                                    label={element}
                                                    size="small"
                                                    color={isSelected ? 'primary' : 'default'}
                                                    variant={isSelected ? 'filled' : 'outlined'}
                                                    disabled={!isAvailable}
                                                    onClick={() => {
                                                        if (!isAvailable) return;
                                                        setSelectedExtendedElements(isSelected
                                                            ? selectedExtendedElements.filter(e => e !== element)
                                                            : [...selectedExtendedElements, element]);
                                                    }}
                                                    sx={{ opacity: isAvailable ? 1 : 0.4 }}
                                                />
                                            </Tooltip>
                                        );
                                    })}
                                </Box>
                                {/* Custom background inputs when in custom mode */}
                                {referenceStandard === 'custom' && selectedInGroup.length > 0 && (
                                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, ml: 3, mt: 0.5 }}>
                                        {selectedInGroup.map(el => {
                                            const bgEntry = getBackgroundValue('ucc-rudnick-gao-2003', el);
                                            return (
                                                <TextField
                                                    key={el}
                                                    label={`${el} bg (${bgEntry?.unit || 'ppm'})`}
                                                    type="number"
                                                    size="small"
                                                    sx={{ width: 120 }}
                                                    value={customBackgrounds[el] ?? ''}
                                                    onChange={(e) => {
                                                        const val = parseFloat(e.target.value);
                                                        setCustomBackgrounds({ ...customBackgrounds, [el]: isNaN(val) ? 0 : val });
                                                    }}
                                                    inputProps={{ step: 'any', min: 0 }}
                                                />
                                            );
                                        })}
                                    </Box>
                                )}
                            </Box>
                        );
                    })}

                    <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                        <Button size="small" startIcon={<SelectAll />} onClick={() => setSelectedExtendedElements([...availableExtendedElements])}>
                            Select All
                        </Button>
                        <Button size="small" startIcon={<Clear />} onClick={() => setSelectedExtendedElements([])}>
                            Clear
                        </Button>
                    </Box>
                </Box>
            )}

            {/* Normalization Options (pathfinder mode only) */}
            {mapMode === 'pathfinder' && <Box sx={{ mb: 2 }}>
                <FormControl component="fieldset">
                    <FormLabel component="legend" sx={{ fontSize: '0.875rem' }}>
                        Normalization
                    </FormLabel>
                    <RadioGroup row value={normalization} onChange={(e) => setNormalization(e.target.value as NormalizationType)}>
                        <FormControlLabel value="none" control={<Radio size="small" />} label="None" />
                        <FormControlLabel
                            value="sc"
                            control={<Radio size="small" />}
                            label={`Element/Sc (${SC_NORMALIZABLE_ELEMENTS.join(', ')})`}
                            disabled={!effectiveScColumn}
                        />
                        <FormControlLabel
                            value="k"
                            control={<Radio size="small" />}
                            label={`Element/K (${K_NORMALIZABLE_ELEMENTS.join(', ')})`}
                            disabled={!effectiveKColumn}
                        />
                    </RadioGroup>
                </FormControl>
                {/* Normalization column selectors */}
                <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
                    <ColumnPicker label="Sc Column" value={effectiveScColumn} onChange={setScColumn} allowNone noneLabel={autoDetectedNormColumns.sc ? `Auto: ${autoDetectedNormColumns.sc}` : 'None'} minWidth={150} />
                    <ColumnPicker label="K Column" value={effectiveKColumn} onChange={setKColumn} allowNone noneLabel={autoDetectedNormColumns.k ? `Auto: ${autoDetectedNormColumns.k}` : 'None'} minWidth={150} />
                </Box>
            </Box>}
        </Paper>
    );
};
