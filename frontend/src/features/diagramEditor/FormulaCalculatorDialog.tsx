/**
 * Popup formula calculator dialog for building axis formulas interactively.
 * Provides inline element autocomplete in the formula bar, variable chips,
 * number pad, operator/function buttons, and inline Add Variable form.
 *
 * Typing an element name (e.g. "Si") shows a dropdown of matching elements.
 * Selecting one auto-creates a variable (A = SiO2 pct) and inserts the letter.
 */

import React, { useState, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
    Dialog, DialogTitle, DialogContent, DialogActions, Button,
    Box, Typography, TextField, Chip, IconButton, Autocomplete,
    Tooltip, Paper, MenuList, MenuItem,
} from '@mui/material';
import { Add, Backspace } from '@mui/icons-material';
import { useDiagramEditorStore } from '../../store/diagramEditorStore';
import { useAppStore } from '../../store/appStore';
import { validateFormula } from '../../utils/calculations/formulaParser';
import { buildElementOptions, ElementOption } from './diagramElementOptions';

interface FormulaCalculatorDialogProps {
    open: boolean;
    onClose: () => void;
    axisKey: string;
    initialFormula: string;
    onConfirm: (formula: string) => void;
}

/** Characters that delimit tokens in a formula */
const STOP_CHARS = new Set([' ', '+', '-', '*', '/', '^', '(', ')', ',']);

/** Extract the word being typed at the cursor position */
function extractCurrentWord(text: string, pos: number): { word: string; start: number } {
    let start = pos;
    while (start > 0 && !STOP_CHARS.has(text[start - 1])) start--;
    return { word: text.slice(start, pos), start };
}

export const FormulaCalculatorDialog: React.FC<FormulaCalculatorDialogProps> = ({
    open, onClose, axisKey, initialFormula, onConfirm,
}) => {
    const [formula, setFormula] = useState(initialFormula);
    const [showAddVariable, setShowAddVariable] = useState(false);
    const [newElement, setNewElement] = useState('');
    const [newUnit, setNewUnit] = useState('pct');

    // Autocomplete state — currentWord is always extracted from the DOM,
    // so it never desyncs from the actual cursor position.
    const [currentWord, setCurrentWord] = useState({ word: '', start: 0 });
    const [highlightIdx, setHighlightIdx] = useState(0);
    const [dismissed, setDismissed] = useState(false);

    const inputRef = useRef<HTMLInputElement>(null);

    const { variables, addVariable, updateVariable } = useDiagramEditorStore();
    const { geochemMappings } = useAppStore();

    // Reset state when dialog opens
    React.useEffect(() => {
        if (open) {
            setFormula(initialFormula);
            setCurrentWord({ word: '', start: 0 });
            setShowAddVariable(false);
            setDismissed(false);
        }
    }, [open, initialFormula]);

    const elementOptions = useMemo(() => buildElementOptions(geochemMappings), [geochemMappings]);

    const unitOptions = ['pct', 'ppm', 'ppb', 'wt%', 'mol/kg'];

    // ─── Inline autocomplete ──────────────────────────────────────

    /** Read the current word from the native <input> and store it */
    const syncCurrentWord = useCallback(() => {
        const el = inputRef.current;
        if (!el) return;
        const pos = el.selectionStart ?? el.value.length;
        setCurrentWord(extractCurrentWord(el.value, pos));
        setDismissed(false);
    }, []);

    /** Filter element options matching the current word */
    const suggestions = useMemo(() => {
        const { word } = currentWord;
        if (!word || /^\d+\.?\d*$/.test(word)) return [];
        const lower = word.toLowerCase();
        return elementOptions.filter(o => o.label.toLowerCase().startsWith(lower)).slice(0, 8);
    }, [currentWord, elementOptions]);

    const showSuggestions = suggestions.length > 0 && !dismissed;

    // Reset highlight when the suggestion list changes
    React.useEffect(() => { setHighlightIdx(0); }, [suggestions]);

    /** Select an element from the dropdown: find-or-create a variable, insert its letter */
    const handleSelectSuggestion = useCallback((option: ElementOption) => {
        const el = inputRef.current;
        if (!el) return;

        // Read live text and cursor from the DOM
        const text = el.value;
        const pos = el.selectionStart ?? text.length;
        const { start } = extractCurrentWord(text, pos);
        const before = text.slice(0, start);
        const after = text.slice(pos);

        // Find existing variable or create a new one
        let varLetter: string;
        const store = useDiagramEditorStore.getState();
        const existing = store.variables.find(
            v => v.element === option.label && v.unit === option.defaultUnit,
        );
        if (existing) {
            varLetter = existing.letter;
        } else {
            addVariable(); // synchronous Zustand update
            const updated = useDiagramEditorStore.getState().variables;
            const newVar = updated[updated.length - 1];
            updateVariable(updated.length - 1, {
                element: option.label,
                unit: option.defaultUnit,
            });
            varLetter = newVar.letter;
        }

        const newFormula = before + varLetter + after;
        const newPos = start + varLetter.length;
        setFormula(newFormula);
        setCurrentWord({ word: '', start: newPos });
        setDismissed(true);

        // Restore focus + cursor position after React re-render
        requestAnimationFrame(() => {
            if (inputRef.current) {
                inputRef.current.focus();
                inputRef.current.setSelectionRange(newPos, newPos);
            }
        });
    }, [addVariable, updateVariable]);

    // ─── Formula input handlers ────────────────────────────────────

    const getCursorPos = useCallback((): number => {
        return inputRef.current?.selectionStart ?? formula.length;
    }, [formula.length]);

    const insertAtCursor = useCallback((text: string) => {
        const pos = getCursorPos();
        const before = formula.slice(0, pos);
        const after = formula.slice(pos);
        const newFormula = before + text + after;
        const newPos = pos + text.length;
        setFormula(newFormula);
        setDismissed(false);
        requestAnimationFrame(() => {
            if (inputRef.current) {
                inputRef.current.focus();
                inputRef.current.setSelectionRange(newPos, newPos);
            }
            syncCurrentWord();
        });
    }, [formula, getCursorPos, syncCurrentWord]);

    const handleBackspace = useCallback(() => {
        const pos = getCursorPos();
        if (pos <= 0) return;
        const newFormula = formula.slice(0, pos - 1) + formula.slice(pos);
        setFormula(newFormula);
        setDismissed(false);
        const newPos = pos - 1;
        requestAnimationFrame(() => {
            if (inputRef.current) {
                inputRef.current.focus();
                inputRef.current.setSelectionRange(newPos, newPos);
            }
            syncCurrentWord();
        });
    }, [formula, getCursorPos, syncCurrentWord]);

    const handleClear = useCallback(() => {
        setFormula('');
        setCurrentWord({ word: '', start: 0 });
        setDismissed(false);
    }, []);

    const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        setFormula(e.target.value);
        const pos = e.target.selectionStart ?? e.target.value.length;
        setCurrentWord(extractCurrentWord(e.target.value, pos));
        setDismissed(false);
    }, []);

    /** Also track cursor when user clicks to reposition it */
    const handleInputClick = useCallback(() => {
        syncCurrentWord();
    }, [syncCurrentWord]);

    /** Keyboard navigation for the suggestions dropdown */
    const handleFormulaKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (suggestions.length === 0 || dismissed) return;

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setHighlightIdx(i => Math.min(i + 1, suggestions.length - 1));
                break;
            case 'ArrowUp':
                e.preventDefault();
                setHighlightIdx(i => Math.max(i - 1, 0));
                break;
            case 'Enter':
            case 'Tab':
                e.preventDefault();
                e.stopPropagation();
                handleSelectSuggestion(suggestions[highlightIdx]);
                break;
            case 'Escape':
                e.preventDefault();
                e.stopPropagation(); // don't close dialog
                setDismissed(true);
                break;
        }
    }, [suggestions, dismissed, highlightIdx, handleSelectSuggestion]);

    const handleAddVariable = useCallback(() => {
        if (!newElement.trim()) return;
        addVariable();
        const newIdx = useDiagramEditorStore.getState().variables.length - 1;
        updateVariable(newIdx, { element: newElement.trim(), unit: newUnit });
        setNewElement('');
        setNewUnit('pct');
        setShowAddVariable(false);
    }, [newElement, newUnit, addVariable, updateVariable]);

    const validation = useMemo(() => {
        if (!formula.trim()) return null;
        return validateFormula(formula);
    }, [formula]);

    const operators = ['+', '-', '*', '/', '^', '(', ')'];
    const functions = ['log10', 'ln', 'sqrt', 'abs', 'pow', 'exp'];
    const numpadKeys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '0', '.'];

    // ─── Dropdown position (fixed, portaled to body) ──────────────
    // Computed at render-time from the live input rect. This avoids
    // ALL overflow-clipping issues from Dialog / DialogContent.
    const inputRect = showSuggestions ? inputRef.current?.getBoundingClientRect() : null;

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>
                Formula for {axisKey.toUpperCase()} Axis
            </DialogTitle>
            <DialogContent>
                {/* Formula input */}
                <TextField
                    inputRef={inputRef}
                    value={formula}
                    onChange={handleInputChange}
                    onClick={handleInputClick}
                    onKeyDown={handleFormulaKeyDown}
                    fullWidth
                    variant="outlined"
                    placeholder="Type element name or variable letter..."
                    sx={{ mb: 2, mt: 1, '& input': { fontFamily: 'monospace', fontSize: '1.1rem' } }}
                    error={validation !== null && !validation.valid}
                    helperText={validation !== null && !validation.valid ? validation.error : ''}
                    autoComplete="off"
                />

                {/* Autocomplete dropdown — portaled to body with fixed positioning */}
                {inputRect && createPortal(
                    <Paper
                        elevation={8}
                        onMouseDown={(e) => e.preventDefault()} // keep focus in input
                        sx={{
                            position: 'fixed',
                            top: inputRect.bottom + 2,
                            left: inputRect.left,
                            width: inputRect.width,
                            zIndex: 1400,
                            maxHeight: 240,
                            overflow: 'auto',
                        }}
                    >
                        <MenuList dense>
                            {suggestions.map((opt, idx) => {
                                const existing = useDiagramEditorStore.getState().variables.find(
                                    v => v.element === opt.label && v.unit === opt.defaultUnit,
                                );
                                return (
                                    <MenuItem
                                        key={opt.label}
                                        selected={idx === highlightIdx}
                                        onClick={() => handleSelectSuggestion(opt)}
                                        sx={{ display: 'flex', justifyContent: 'space-between' }}
                                    >
                                        <span>{opt.label}</span>
                                        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                                            <Typography variant="caption" color="text.secondary">
                                                {opt.defaultUnit}
                                            </Typography>
                                            {existing && (
                                                <Chip
                                                    label={existing.letter}
                                                    size="small"
                                                    color="primary"
                                                    variant="outlined"
                                                    sx={{ height: 18, fontSize: '0.7rem', fontFamily: 'monospace' }}
                                                />
                                            )}
                                        </Box>
                                    </MenuItem>
                                );
                            })}
                        </MenuList>
                    </Paper>,
                    document.body,
                )}

                {/* Variable chips */}
                <Typography variant="body2" color="text.secondary" gutterBottom>
                    Variables (click to insert):
                </Typography>
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 2 }}>
                    {variables.map((v) => (
                        <Chip
                            key={v.letter}
                            label={`${v.letter}${v.element ? ` = ${v.element}` : ''}${v.unit ? ` (${v.unit})` : ''}`}
                            onClick={() => insertAtCursor(v.letter)}
                            color="primary"
                            variant="outlined"
                            size="small"
                            sx={{ fontFamily: 'monospace' }}
                        />
                    ))}
                    <Chip
                        icon={<Add />}
                        label="Add"
                        onClick={() => setShowAddVariable(true)}
                        variant="outlined"
                        size="small"
                    />
                </Box>

                {/* Inline Add Variable form */}
                {showAddVariable && (
                    <Box sx={{
                        p: 1.5, mb: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1,
                        display: 'flex', gap: 1, alignItems: 'flex-end',
                    }}>
                        <Autocomplete<ElementOption, false, false, true>
                            freeSolo
                            options={elementOptions}
                            getOptionLabel={(option) => typeof option === 'string' ? option : option.label}
                            renderOption={(props, option) => (
                                <li {...props} key={typeof option === 'string' ? option : option.label}>
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                                        <span>{typeof option === 'string' ? option : option.label}</span>
                                        {typeof option !== 'string' && (
                                            <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                                                {option.defaultUnit}
                                            </Typography>
                                        )}
                                    </Box>
                                </li>
                            )}
                            filterOptions={(options, state) => {
                                const input = state.inputValue.toLowerCase();
                                if (!input) return options;
                                return options.filter(o =>
                                    (typeof o === 'string' ? o : o.label).toLowerCase().includes(input)
                                );
                            }}
                            value={newElement ? elementOptions.find(o => o.label === newElement) ?? newElement : ''}
                            onChange={(_, val) => {
                                if (val && typeof val !== 'string') {
                                    setNewElement(val.label);
                                    setNewUnit(val.defaultUnit);
                                } else if (typeof val === 'string') {
                                    setNewElement(val);
                                }
                            }}
                            onInputChange={(_, val, reason) => {
                                if (reason === 'input') setNewElement(val);
                            }}
                            size="small"
                            renderInput={(params) => (
                                <TextField {...params} label="Element/Oxide" placeholder="SiO2" />
                            )}
                            sx={{ flex: 1 }}
                        />
                        <Autocomplete
                            freeSolo
                            options={unitOptions}
                            value={newUnit}
                            onInputChange={(_, val) => setNewUnit(val)}
                            size="small"
                            renderInput={(params) => (
                                <TextField {...params} label="Unit" />
                            )}
                            sx={{ width: 100 }}
                        />
                        <Tooltip title="Add variable">
                            <IconButton
                                onClick={handleAddVariable}
                                color="primary"
                                size="small"
                                disabled={!newElement.trim()}
                            >
                                <Add />
                            </IconButton>
                        </Tooltip>
                        <Button size="small" onClick={() => setShowAddVariable(false)}>
                            Cancel
                        </Button>
                    </Box>
                )}

                {/* Number pad + Operators + Functions */}
                <Box sx={{ display: 'flex', gap: 2 }}>
                    {/* Number pad */}
                    <Box sx={{
                        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0.5,
                        '& button': { minWidth: 40, height: 36 },
                    }}>
                        {numpadKeys.map((key) => (
                            <Button
                                key={key}
                                variant="outlined"
                                size="small"
                                onClick={() => insertAtCursor(key)}
                            >
                                {key}
                            </Button>
                        ))}
                        <Button
                            variant="outlined"
                            size="small"
                            onClick={handleClear}
                            color="error"
                        >
                            C
                        </Button>
                    </Box>

                    {/* Operators + Functions */}
                    <Box sx={{ flex: 1 }}>
                        <Typography variant="caption" color="text.secondary">Operators:</Typography>
                        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1 }}>
                            {operators.map((op) => (
                                <Button
                                    key={op}
                                    variant="outlined"
                                    size="small"
                                    onClick={() => {
                                        const spaced = ['(', ')'].includes(op) ? op : ` ${op} `;
                                        insertAtCursor(spaced);
                                    }}
                                    sx={{ minWidth: 36 }}
                                >
                                    {op}
                                </Button>
                            ))}
                            <Tooltip title="Backspace">
                                <IconButton size="small" onClick={handleBackspace}>
                                    <Backspace fontSize="small" />
                                </IconButton>
                            </Tooltip>
                        </Box>

                        <Typography variant="caption" color="text.secondary">Functions:</Typography>
                        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                            {functions.map((fn) => (
                                <Button
                                    key={fn}
                                    variant="outlined"
                                    size="small"
                                    onClick={() => insertAtCursor(`${fn}(`)}
                                    sx={{ textTransform: 'none', fontFamily: 'monospace', fontSize: '0.75rem' }}
                                >
                                    {fn}
                                </Button>
                            ))}
                        </Box>
                    </Box>
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button
                    variant="contained"
                    onClick={() => { onConfirm(formula); onClose(); }}
                >
                    Apply
                </Button>
            </DialogActions>
        </Dialog>
    );
};
