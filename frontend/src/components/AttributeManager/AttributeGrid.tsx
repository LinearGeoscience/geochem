import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
    Box,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Checkbox,
    Typography,
    TextField,
    Popover,
    Slider,
    IconButton,
    Tooltip,
} from '@mui/material';
import {
    Palette,
    Delete as DeleteIcon,
    Visibility,
    VisibilityOff,
    Opacity as OpacityIcon,
    SelectAll,
    Deselect,
    ArrowUpward,
    ArrowDownward,
} from '@mui/icons-material';
import { HexColorPicker } from 'react-colorful';
import {
    useAttributeStore,
    AttributeType,
    AttributeConfig,
    AttributeEntry,
    MARKER_SHAPES,
} from '../../store/attributeStore';
import { ShapeMarker } from '../ShapeMarker';

// ============================================================================
// Color Picker Popover (react-colorful + hex input + recent colors + debounce)
// ============================================================================
const ColorPickerPopover: React.FC<{
    anchorEl: HTMLElement | null;
    color: string;
    onClose: () => void;
    onChange: (color: string) => void;
}> = ({ anchorEl, color, onClose, onChange }) => {
    const [localColor, setLocalColor] = useState(color);
    const [hexInput, setHexInput] = useState(color);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const { recentColors, addRecentColor } = useAttributeStore();

    // Sync local state when opening with a new color
    useEffect(() => {
        setLocalColor(color);
        setHexInput(color);
    }, [color]);

    const commitColor = useCallback((c: string) => {
        onChange(c);
        addRecentColor(c);
    }, [onChange, addRecentColor]);

    const handlePickerChange = useCallback((c: string) => {
        setLocalColor(c);
        setHexInput(c);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => commitColor(c), 200);
    }, [commitColor]);

    const handleHexChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        setHexInput(val);
        if (/^#[0-9a-fA-F]{6}$/.test(val)) {
            setLocalColor(val);
            commitColor(val);
        }
    };

    const handleClose = () => {
        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
            debounceRef.current = null;
        }
        commitColor(localColor);
        onClose();
    };

    return (
        <Popover
            open={Boolean(anchorEl)}
            anchorEl={anchorEl}
            onClose={handleClose}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        >
            <Box sx={{ p: 1.5, width: 220 }}>
                {/* Preview swatch */}
                <Box sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    mb: 1,
                }}>
                    <Box sx={{
                        width: 24,
                        height: 24,
                        borderRadius: '50%',
                        bgcolor: localColor,
                        border: '1px solid rgba(0,0,0,0.2)',
                        flexShrink: 0,
                    }} />
                    <Typography variant="caption" fontWeight="bold">
                        {localColor}
                    </Typography>
                </Box>
                <HexColorPicker
                    color={localColor}
                    onChange={handlePickerChange}
                    style={{ width: '100%' }}
                />
                {/* Hex text input */}
                <TextField
                    value={hexInput}
                    onChange={handleHexChange}
                    size="small"
                    fullWidth
                    placeholder="#000000"
                    sx={{ mt: 1, '& input': { py: 0.5, px: 1, fontSize: '0.8rem', fontFamily: 'monospace' } }}
                />
                {/* Recent colors */}
                {recentColors.length > 0 && (
                    <Box sx={{ mt: 1 }}>
                        <Typography variant="caption" color="text.secondary">
                            Recent
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.25 }}>
                            {recentColors.map((c) => (
                                <Box
                                    key={c}
                                    onClick={() => {
                                        setLocalColor(c);
                                        setHexInput(c);
                                        commitColor(c);
                                    }}
                                    sx={{
                                        width: 20,
                                        height: 20,
                                        borderRadius: '50%',
                                        bgcolor: c,
                                        border: c === localColor ? '2px solid #333' : '1px solid rgba(0,0,0,0.2)',
                                        cursor: 'pointer',
                                        '&:hover': { transform: 'scale(1.15)' },
                                    }}
                                />
                            ))}
                        </Box>
                    </Box>
                )}
            </Box>
        </Popover>
    );
};

// ============================================================================
// Shape Picker Popover
// ============================================================================
const ShapePickerPopover: React.FC<{
    anchorEl: HTMLElement | null;
    shape: string;
    onClose: () => void;
    onChange: (shape: string) => void;
}> = ({ anchorEl, shape, onClose, onChange }) => {
    return (
        <Popover
            open={Boolean(anchorEl)}
            anchorEl={anchorEl}
            onClose={onClose}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        >
            <Box sx={{ p: 1, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0.5 }}>
                {MARKER_SHAPES.map((s) => (
                    <Box
                        key={s.value}
                        onClick={() => { onChange(s.value); onClose(); }}
                        sx={{
                            p: 0.5,
                            cursor: 'pointer',
                            borderRadius: 1,
                            bgcolor: shape === s.value ? 'action.selected' : 'transparent',
                            '&:hover': { bgcolor: 'action.hover' },
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                        title={s.label}
                    >
                        <ShapeMarker shape={s.value} size={20} />
                    </Box>
                ))}
            </Box>
        </Popover>
    );
};

// ============================================================================
// Single Row Component
// ============================================================================
const AttributeRow: React.FC<{
    entry: AttributeEntry;
    tab: AttributeType;
    isSelected: boolean;
    onSelect: (e: React.MouseEvent) => void;
    onVisibilityChange: () => void;
    onNameChange: (name: string) => void;
    onColorChange: (color: string) => void;
    onShapeChange: (shape: string) => void;
    onSizeChange: (size: number) => void;
    onRangeChange: (min: number | undefined, max: number | undefined) => void;
    onOpacityChange: (opacity: number) => void;
}> = ({
    entry,
    tab,
    isSelected,
    onSelect,
    onVisibilityChange,
    onNameChange,
    onColorChange,
    onShapeChange,
    onSizeChange,
    onRangeChange,
    onOpacityChange,
}) => {
    const [editingName, setEditingName] = useState(false);
    const [nameValue, setNameValue] = useState(entry.name);
    const [colorAnchor, setColorAnchor] = useState<HTMLElement | null>(null);
    const [shapeAnchor, setShapeAnchor] = useState<HTMLElement | null>(null);
    const [editingRange, setEditingRange] = useState(false);
    const [minValue, setMinValue] = useState<string>(entry.min?.toString() ?? '');
    const [maxValue, setMaxValue] = useState<string>(entry.max?.toString() ?? '');

    // Update local state when entry changes
    useEffect(() => {
        setMinValue(entry.min?.toString() ?? '');
        setMaxValue(entry.max?.toString() ?? '');
    }, [entry.min, entry.max]);

    const handleNameDoubleClick = () => {
        if (!entry.isDefault) {
            setEditingName(true);
            setNameValue(entry.name);
        }
    };

    const handleNameBlur = () => {
        setEditingName(false);
        if (nameValue.trim() && nameValue !== entry.name) {
            onNameChange(nameValue.trim());
        }
    };

    const handleNameKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleNameBlur();
        } else if (e.key === 'Escape') {
            setEditingName(false);
            setNameValue(entry.name);
        }
    };

    const rangeContainerRef = useRef<HTMLDivElement>(null);

    const saveAndCloseRange = () => {
        const newMin = minValue !== '' ? parseFloat(minValue) : undefined;
        const newMax = maxValue !== '' ? parseFloat(maxValue) : undefined;
        if (newMin !== entry.min || newMax !== entry.max) {
            onRangeChange(newMin, newMax);
        }
        setEditingRange(false);
    };

    const handleRangeBlur = (e: React.FocusEvent) => {
        const relatedTarget = e.relatedTarget as HTMLElement;
        if (rangeContainerRef.current?.contains(relatedTarget)) {
            return;
        }
        saveAndCloseRange();
    };

    const handleRangeKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            saveAndCloseRange();
        } else if (e.key === 'Escape') {
            setMinValue(entry.min?.toString() ?? '');
            setMaxValue(entry.max?.toString() ?? '');
            setEditingRange(false);
        }
    };

    // Determine what visual to show based on tab
    const renderVisual = () => {
        switch (tab) {
            case 'color':
                return (
                    <Box
                        onClick={(e) => !entry.isDefault && setColorAnchor(e.currentTarget)}
                        sx={{
                            width: 20,
                            height: 20,
                            borderRadius: '50%',
                            bgcolor: entry.color || '#808080',
                            border: '1px solid rgba(0,0,0,0.2)',
                            cursor: entry.isDefault ? 'default' : 'pointer',
                            opacity: entry.visible ? 1 : 0.3,
                        }}
                    />
                );
            case 'shape':
                return (
                    <Box
                        onClick={(e) => !entry.isDefault && setShapeAnchor(e.currentTarget)}
                        sx={{
                            cursor: entry.isDefault ? 'default' : 'pointer',
                            opacity: entry.visible ? 1 : 0.3,
                        }}
                    >
                        <ShapeMarker shape={entry.shape || 'circle'} size={20} />
                    </Box>
                );
            case 'size': {
                const sizeVal = entry.size || 8;
                // SVG circle with radius proportional to size value for better preview
                const displayR = Math.max(2, Math.min(10, sizeVal * 0.7));
                return (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <svg width={24} height={24} viewBox="0 0 24 24" style={{ flexShrink: 0, opacity: entry.visible ? 1 : 0.3 }}>
                            <circle cx="12" cy="12" r={displayR} fill="#555" />
                        </svg>
                        {!entry.isDefault && (
                            <Slider
                                value={sizeVal}
                                onChange={(_, val) => onSizeChange(val as number)}
                                min={2}
                                max={30}
                                step={1}
                                size="small"
                                valueLabelDisplay="auto"
                                sx={{ width: 60 }}
                                onClick={(e) => e.stopPropagation()}
                            />
                        )}
                    </Box>
                );
            }
            case 'filter':
                return null;
            default:
                return null;
        }
    };

    // Render name cell content
    const renderNameCell = () => {
        if (entry.type === 'range' && !entry.isDefault) {
            if (editingRange) {
                return (
                    <Box
                        ref={rangeContainerRef}
                        sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <TextField
                            type="number"
                            value={minValue}
                            onChange={(e) => setMinValue(e.target.value)}
                            onBlur={handleRangeBlur}
                            onKeyDown={handleRangeKeyDown}
                            autoFocus
                            size="small"
                            placeholder="Min"
                            sx={{ width: 70, '& input': { py: 0.25, px: 0.5, fontSize: '0.75rem' } }}
                            inputProps={{ step: 'any' }}
                        />
                        <Typography variant="body2">-</Typography>
                        <TextField
                            type="number"
                            value={maxValue}
                            onChange={(e) => setMaxValue(e.target.value)}
                            onBlur={handleRangeBlur}
                            onKeyDown={handleRangeKeyDown}
                            size="small"
                            placeholder="Max"
                            sx={{ width: 70, '& input': { py: 0.25, px: 0.5, fontSize: '0.75rem' } }}
                            inputProps={{ step: 'any' }}
                        />
                    </Box>
                );
            }
            return (
                <Typography
                    variant="body2"
                    onClick={(e) => { e.stopPropagation(); setEditingRange(true); }}
                    sx={{
                        opacity: entry.visible ? 1 : 0.5,
                        cursor: 'pointer',
                        '&:hover': { textDecoration: 'underline' },
                    }}
                    title="Click to edit range"
                >
                    {entry.min !== undefined ? entry.min.toFixed(2) : '-\u221E'} - {entry.max !== undefined ? entry.max.toFixed(2) : '\u221E'}
                </Typography>
            );
        }

        if (editingName) {
            return (
                <TextField
                    value={nameValue}
                    onChange={(e) => setNameValue(e.target.value)}
                    onBlur={handleNameBlur}
                    onKeyDown={handleNameKeyDown}
                    autoFocus
                    size="small"
                    sx={{ '& input': { py: 0.25, px: 0.5, fontSize: '0.8rem' } }}
                />
            );
        }

        return (
            <Typography
                variant="body2"
                onDoubleClick={handleNameDoubleClick}
                sx={{
                    opacity: entry.visible ? 1 : 0.5,
                    fontStyle: entry.isDefault ? 'italic' : 'normal',
                    fontWeight: entry.isCustom ? 'bold' : 'normal',
                }}
            >
                {entry.name}
            </Typography>
        );
    };

    return (
        <>
            <TableRow
                onClick={onSelect}
                selected={isSelected}
                sx={{
                    cursor: 'pointer',
                    '&.Mui-selected': { bgcolor: 'primary.light' },
                    '&:hover': { bgcolor: isSelected ? 'primary.light' : 'action.hover' },
                }}
            >
                {/* Name */}
                <TableCell sx={{ py: 0.5, px: 1 }}>
                    {renderNameCell()}
                </TableCell>

                {/* Visible */}
                <TableCell sx={{ py: 0.5, px: 1, textAlign: 'center' }}>
                    <Checkbox
                        checked={entry.visible}
                        onChange={onVisibilityChange}
                        size="small"
                        sx={{ p: 0 }}
                        onClick={(e) => e.stopPropagation()}
                    />
                </TableCell>

                {/* Visual (Color/Shape/Size) */}
                <TableCell sx={{ py: 0.5, px: 1, textAlign: 'center' }}>
                    {renderVisual()}
                </TableCell>

                {/* Rows */}
                <TableCell sx={{ py: 0.5, px: 1, textAlign: 'right' }}>
                    <Typography variant="body2" sx={{ opacity: entry.visible ? 1 : 0.5 }}>
                        {entry.rowCount}
                    </Typography>
                </TableCell>

                {/* Rows visible */}
                <TableCell sx={{ py: 0.5, px: 1, textAlign: 'right' }}>
                    <Typography variant="body2" sx={{ opacity: entry.visible ? 1 : 0.5 }}>
                        {entry.visibleRowCount}
                    </Typography>
                </TableCell>

                {/* Opacity */}
                <TableCell sx={{ py: 0.5, px: 1 }} onClick={(e) => e.stopPropagation()}>
                    <Slider
                        value={Math.round((entry.opacity ?? 1.0) * 100)}
                        onChange={(_, val) => onOpacityChange((val as number) / 100)}
                        min={0}
                        max={100}
                        step={5}
                        size="small"
                        valueLabelDisplay="auto"
                        valueLabelFormat={(v) => `${v}%`}
                        sx={{ width: 80 }}
                    />
                </TableCell>
            </TableRow>

            {/* Popovers */}
            <ColorPickerPopover
                anchorEl={colorAnchor}
                color={entry.color || '#808080'}
                onClose={() => setColorAnchor(null)}
                onChange={onColorChange}
            />
            <ShapePickerPopover
                anchorEl={shapeAnchor}
                shape={entry.shape || 'circle'}
                onClose={() => setShapeAnchor(null)}
                onChange={onShapeChange}
            />
        </>
    );
};

// ============================================================================
// Batch Toolbar (shown when 2+ entries selected)
// ============================================================================
const BatchToolbar: React.FC<{
    tab: AttributeType;
    selectedCount: number;
    selectedNames: string[];
}> = ({ tab, selectedCount, selectedNames }) => {
    const { batchUpdateEntries, batchDeleteEntries, batchToggleVisibility, addRecentColor } = useAttributeStore();
    const [batchColorAnchor, setBatchColorAnchor] = useState<HTMLElement | null>(null);

    if (selectedCount < 2) return null;

    return (
        <Box sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            px: 1,
            py: 0.5,
            bgcolor: 'primary.light',
            borderBottom: '1px solid',
            borderColor: 'divider',
        }}>
            <Typography variant="caption" fontWeight="bold" sx={{ mr: 0.5 }}>
                {selectedCount} selected
            </Typography>

            {tab === 'color' && (
                <Tooltip title="Set colour for all selected">
                    <IconButton
                        size="small"
                        onClick={(e) => setBatchColorAnchor(e.currentTarget)}
                    >
                        <Palette fontSize="small" />
                    </IconButton>
                </Tooltip>
            )}

            <Tooltip title="Show selected">
                <IconButton
                    size="small"
                    onClick={() => batchToggleVisibility(tab, selectedNames, true)}
                >
                    <Visibility fontSize="small" />
                </IconButton>
            </Tooltip>

            <Tooltip title="Hide selected">
                <IconButton
                    size="small"
                    onClick={() => batchToggleVisibility(tab, selectedNames, false)}
                >
                    <VisibilityOff fontSize="small" />
                </IconButton>
            </Tooltip>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 1 }}>
                <OpacityIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                <Slider
                    defaultValue={100}
                    onChange={(_, val) => batchUpdateEntries(tab, selectedNames, { opacity: (val as number) / 100 })}
                    min={0}
                    max={100}
                    step={5}
                    size="small"
                    valueLabelDisplay="auto"
                    valueLabelFormat={(v) => `${v}%`}
                    sx={{ width: 100 }}
                />
            </Box>

            <Tooltip title="Delete selected">
                <IconButton
                    size="small"
                    color="error"
                    onClick={() => batchDeleteEntries(tab, selectedNames)}
                >
                    <DeleteIcon fontSize="small" />
                </IconButton>
            </Tooltip>

            <ColorPickerPopover
                anchorEl={batchColorAnchor}
                color="#ff0000"
                onClose={() => setBatchColorAnchor(null)}
                onChange={(color) => {
                    batchUpdateEntries(tab, selectedNames, { color });
                    addRecentColor(color);
                    setBatchColorAnchor(null);
                }}
            />
        </Box>
    );
};

// ============================================================================
// Main Grid Component
// ============================================================================
interface AttributeGridProps {
    tab: AttributeType;
    config: AttributeConfig;
}

export const AttributeGrid: React.FC<AttributeGridProps> = ({ tab, config }) => {
    const {
        selectedEntryNames,
        setSelectedEntryNames,
        toggleSelectedEntryName,
        selectEntryRange,
        clearSelection,
        customEntries,
        toggleEntryVisibility,
        updateEntry,
        updateCustomEntry,
    } = useAttributeStore();

    // Combine custom entries with field-based entries
    const combinedEntries = React.useMemo(() => {
        const defaultEntry = config.entries.find(e => e.isDefault);
        const fieldEntries = config.entries.filter(e => !e.isDefault);

        return [
            ...(defaultEntry ? [defaultEntry] : []),
            ...customEntries,
            ...fieldEntries,
        ];
    }, [config.entries, customEntries]);

    const allNames = React.useMemo(
        () => combinedEntries.map(e => e.name),
        [combinedEntries]
    );

    const handleSelect = (entryName: string, e: React.MouseEvent) => {
        if (e.ctrlKey || e.metaKey) {
            // Ctrl+Click: toggle individual
            toggleSelectedEntryName(entryName);
        } else if (e.shiftKey) {
            // Shift+Click: range select
            selectEntryRange(entryName, allNames);
        } else {
            // Normal click: single select (toggle if already sole selection)
            if (selectedEntryNames.length === 1 && selectedEntryNames[0] === entryName) {
                clearSelection();
            } else {
                setSelectedEntryNames([entryName]);
            }
        }
    };

    const handleVisibilityChange = (entry: AttributeEntry) => {
        if (entry.isCustom) {
            updateCustomEntry(entry.id, { visible: !entry.visible });
        } else {
            toggleEntryVisibility(tab, entry.id);
        }
    };

    const handleNameChange = (entry: AttributeEntry, newName: string) => {
        if (entry.isCustom) {
            updateCustomEntry(entry.id, { name: newName });
        } else {
            updateEntry(tab, entry.id, { name: newName });
        }
    };

    const handleColorChange = (entry: AttributeEntry, color: string) => {
        if (entry.isCustom) {
            updateCustomEntry(entry.id, { color });
        } else {
            updateEntry(tab, entry.id, { color });
        }
    };

    const handleShapeChange = (entry: AttributeEntry, shape: string) => {
        if (entry.isCustom) {
            updateCustomEntry(entry.id, { shape });
        } else {
            updateEntry(tab, entry.id, { shape });
        }
    };

    const handleSizeChange = (entry: AttributeEntry, size: number) => {
        if (entry.isCustom) {
            updateCustomEntry(entry.id, { size });
        } else {
            updateEntry(tab, entry.id, { size });
        }
    };

    const handleOpacityChange = (entry: AttributeEntry, opacity: number) => {
        if (entry.isCustom) {
            updateCustomEntry(entry.id, { opacity });
        } else {
            updateEntry(tab, entry.id, { opacity });
        }
    };

    const handleRangeChange = (entry: AttributeEntry, min: number | undefined, max: number | undefined) => {
        if (!entry.isCustom && entry.type === 'range') {
            const newName = min !== undefined && max !== undefined
                ? `${min.toFixed(2)} - ${max.toFixed(2)}`
                : min !== undefined
                ? `>= ${min.toFixed(2)}`
                : max !== undefined
                ? `< ${max.toFixed(2)}`
                : entry.name;

            updateEntry(tab, entry.id, { min, max, name: newName });
        }
    };

    const handleSelectAll = () => {
        const nonDefaultNames = combinedEntries.filter(e => !e.isDefault).map(e => e.name);
        setSelectedEntryNames(nonDefaultNames);
    };

    const visualHeader = tab === 'color' ? 'Colour' :
                         tab === 'shape' ? 'Shape' :
                         tab === 'size' ? 'Size' : '';

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Batch toolbar */}
            <BatchToolbar
                tab={tab}
                selectedCount={selectedEntryNames.length}
                selectedNames={selectedEntryNames}
            />

            {/* Select All / Deselect All buttons */}
            <Box sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                px: 1,
                py: 0.25,
                borderBottom: '1px solid',
                borderColor: 'divider',
            }}>
                <Tooltip title="Select all entries">
                    <IconButton size="small" onClick={handleSelectAll}>
                        <SelectAll fontSize="small" />
                    </IconButton>
                </Tooltip>
                <Tooltip title="Deselect all">
                    <IconButton
                        size="small"
                        onClick={() => clearSelection()}
                        disabled={selectedEntryNames.length === 0}
                    >
                        <Deselect fontSize="small" />
                    </IconButton>
                </Tooltip>
                <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                    {selectedEntryNames.length > 0
                        ? `${selectedEntryNames.length} of ${combinedEntries.length} selected`
                        : `${combinedEntries.length} entries`}
                </Typography>

                {/* Size scale buttons (visible on size tab) */}
                {tab === 'size' && (
                    <>
                        <Box sx={{ flex: 1 }} />
                        <Tooltip title="Scale all sizes up (1.5x)">
                            <IconButton
                                size="small"
                                onClick={() => useAttributeStore.getState().scaleAllSizes(tab, 1.5)}
                            >
                                <ArrowUpward fontSize="small" />
                            </IconButton>
                        </Tooltip>
                        <Tooltip title="Scale all sizes down (0.67x)">
                            <IconButton
                                size="small"
                                onClick={() => useAttributeStore.getState().scaleAllSizes(tab, 0.67)}
                            >
                                <ArrowDownward fontSize="small" />
                            </IconButton>
                        </Tooltip>
                    </>
                )}
            </Box>

            <TableContainer sx={{ flex: 1, overflow: 'auto' }}>
                <Table size="small" stickyHeader>
                    <TableHead>
                        <TableRow>
                            <TableCell sx={{ py: 0.5, px: 1, fontWeight: 'bold', bgcolor: 'background.paper' }}>
                                Name
                            </TableCell>
                            <TableCell sx={{ py: 0.5, px: 1, fontWeight: 'bold', textAlign: 'center', bgcolor: 'background.paper' }}>
                                Visible
                            </TableCell>
                            {tab !== 'filter' && (
                                <TableCell sx={{ py: 0.5, px: 1, fontWeight: 'bold', textAlign: 'center', bgcolor: 'background.paper' }}>
                                    {visualHeader}
                                </TableCell>
                            )}
                            <TableCell sx={{ py: 0.5, px: 1, fontWeight: 'bold', textAlign: 'right', bgcolor: 'background.paper' }}>
                                Rows
                            </TableCell>
                            <TableCell sx={{ py: 0.5, px: 1, fontWeight: 'bold', textAlign: 'right', bgcolor: 'background.paper' }}>
                                Rows visible
                            </TableCell>
                            <TableCell sx={{ py: 0.5, px: 1, fontWeight: 'bold', textAlign: 'center', bgcolor: 'background.paper' }}>
                                Opacity
                            </TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {combinedEntries.map((entry) => (
                            <AttributeRow
                                key={entry.id}
                                entry={entry}
                                tab={tab}
                                isSelected={selectedEntryNames.includes(entry.name)}
                                onSelect={(e) => handleSelect(entry.name, e)}
                                onVisibilityChange={() => handleVisibilityChange(entry)}
                                onNameChange={(name) => handleNameChange(entry, name)}
                                onColorChange={(color) => handleColorChange(entry, color)}
                                onShapeChange={(shape) => handleShapeChange(entry, shape)}
                                onSizeChange={(size) => handleSizeChange(entry, size)}
                                onRangeChange={(min, max) => handleRangeChange(entry, min, max)}
                                onOpacityChange={(opacity) => handleOpacityChange(entry, opacity)}
                            />
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>
        </Box>
    );
};

export default AttributeGrid;
