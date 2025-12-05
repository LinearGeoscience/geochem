import React, { useState } from 'react';
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
} from '@mui/material';
import { Circle } from '@mui/icons-material';
import {
    useAttributeStore,
    AttributeType,
    AttributeConfig,
    AttributeEntry,
    MARKER_SHAPES,
} from '../../store/attributeStore';

// Shape marker SVG component
const ShapeMarker: React.FC<{ shape: string; color?: string; size?: number }> = ({
    shape,
    color = '#000',
    size = 16
}) => {
    const getPath = () => {
        switch (shape) {
            case 'circle':
                return <circle cx="8" cy="8" r="6" fill={color} />;
            case 'square':
                return <rect x="2" y="2" width="12" height="12" fill={color} />;
            case 'diamond':
                return <path d="M 8 2 L 14 8 L 8 14 L 2 8 Z" fill={color} />;
            case 'cross':
                return <path d="M 8 2 L 8 14 M 2 8 L 14 8" stroke={color} strokeWidth="2" fill="none" />;
            case 'x':
                return <path d="M 2 2 L 14 14 M 14 2 L 2 14" stroke={color} strokeWidth="2" fill="none" />;
            case 'triangle-up':
                return <path d="M 8 2 L 14 14 L 2 14 Z" fill={color} />;
            case 'triangle-down':
                return <path d="M 8 14 L 14 2 L 2 2 Z" fill={color} />;
            case 'triangle-left':
                return <path d="M 2 8 L 14 2 L 14 14 Z" fill={color} />;
            case 'triangle-right':
                return <path d="M 14 8 L 2 2 L 2 14 Z" fill={color} />;
            case 'pentagon':
                return <path d="M 8 2 L 13.5 6 L 11 12 L 5 12 L 2.5 6 Z" fill={color} />;
            case 'hexagon':
                return <path d="M 8 1 L 13 4.5 L 13 11.5 L 8 15 L 3 11.5 L 3 4.5 Z" fill={color} />;
            case 'star':
                return <path d="M 8 1 L 9.5 6 L 15 6.5 L 11 10 L 12 15 L 8 12 L 4 15 L 5 10 L 1 6.5 L 6.5 6 Z" fill={color} />;
            case 'hourglass':
                return <path d="M 2 2 L 14 2 L 8 8 L 14 14 L 2 14 L 8 8 Z" fill={color} />;
            default:
                return <circle cx="8" cy="8" r="6" fill={color} />;
        }
    };

    return (
        <svg width={size} height={size} viewBox="0 0 16 16" style={{ flexShrink: 0 }}>
            {getPath()}
        </svg>
    );
};

// Color picker popover
const ColorPickerPopover: React.FC<{
    anchorEl: HTMLElement | null;
    color: string;
    onClose: () => void;
    onChange: (color: string) => void;
}> = ({ anchorEl, color, onClose, onChange }) => {
    return (
        <Popover
            open={Boolean(anchorEl)}
            anchorEl={anchorEl}
            onClose={onClose}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        >
            <Box sx={{ p: 1 }}>
                <input
                    type="color"
                    value={color}
                    onChange={(e) => onChange(e.target.value)}
                    style={{ width: 100, height: 30, cursor: 'pointer' }}
                />
            </Box>
        </Popover>
    );
};

// Shape picker popover
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

// Single row component
const AttributeRow: React.FC<{
    entry: AttributeEntry;
    tab: AttributeType;
    isSelected: boolean;
    onSelect: () => void;
    onVisibilityChange: () => void;
    onNameChange: (name: string) => void;
    onColorChange: (color: string) => void;
    onShapeChange: (shape: string) => void;
    onSizeChange: (size: number) => void;
    onRangeChange: (min: number | undefined, max: number | undefined) => void;
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
}) => {
    const [editingName, setEditingName] = useState(false);
    const [nameValue, setNameValue] = useState(entry.name);
    const [colorAnchor, setColorAnchor] = useState<HTMLElement | null>(null);
    const [shapeAnchor, setShapeAnchor] = useState<HTMLElement | null>(null);
    const [editingRange, setEditingRange] = useState(false);
    const [minValue, setMinValue] = useState<string>(entry.min?.toString() ?? '');
    const [maxValue, setMaxValue] = useState<string>(entry.max?.toString() ?? '');

    // Update local state when entry changes
    React.useEffect(() => {
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

    const rangeContainerRef = React.useRef<HTMLDivElement>(null);

    const saveAndCloseRange = () => {
        const newMin = minValue !== '' ? parseFloat(minValue) : undefined;
        const newMax = maxValue !== '' ? parseFloat(maxValue) : undefined;
        if (newMin !== entry.min || newMax !== entry.max) {
            onRangeChange(newMin, newMax);
        }
        setEditingRange(false);
    };

    const handleRangeBlur = (e: React.FocusEvent) => {
        // Check if the new focus target is still within the range editor container
        const relatedTarget = e.relatedTarget as HTMLElement;
        if (rangeContainerRef.current?.contains(relatedTarget)) {
            // Focus moved to another element within the range editor, don't close
            return;
        }
        // Focus moved outside, save and close
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
            case 'size':
                return (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Circle sx={{ fontSize: Math.min(24, (entry.size || 8) * 2), opacity: entry.visible ? 1 : 0.3 }} />
                        {!entry.isDefault && (
                            <TextField
                                type="number"
                                value={entry.size || 8}
                                onChange={(e) => onSizeChange(parseInt(e.target.value) || 8)}
                                size="small"
                                sx={{ width: 50 }}
                                inputProps={{ min: 2, max: 30, style: { padding: '2px 4px', fontSize: '0.75rem' } }}
                            />
                        )}
                    </Box>
                );
            case 'filter':
                return null;
            default:
                return null;
        }
    };

    // Render name cell content - show editable range fields for range entries
    const renderNameCell = () => {
        // If it's a range entry and we're editing or showing range fields
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
            // Show clickable range that opens editor
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
                    {entry.min !== undefined ? entry.min.toFixed(2) : '-∞'} - {entry.max !== undefined ? entry.max.toFixed(2) : '∞'}
                </Typography>
            );
        }

        // Default name editing behavior
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

interface AttributeGridProps {
    tab: AttributeType;
    config: AttributeConfig;
}

export const AttributeGrid: React.FC<AttributeGridProps> = ({ tab, config }) => {
    const {
        selectedEntryName,
        setSelectedEntryName,
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

    const handleSelect = (entryName: string) => {
        setSelectedEntryName(entryName === selectedEntryName ? null : entryName);
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

    const handleRangeChange = (entry: AttributeEntry, min: number | undefined, max: number | undefined) => {
        if (!entry.isCustom && entry.type === 'range') {
            // Update both min/max and regenerate the name based on the new range
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

    // Column header based on tab
    const visualHeader = tab === 'color' ? 'Colour' :
                         tab === 'shape' ? 'Shape' :
                         tab === 'size' ? 'Size' : '';

    return (
        <TableContainer sx={{ maxHeight: '100%' }}>
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
                    </TableRow>
                </TableHead>
                <TableBody>
                    {combinedEntries.map((entry) => (
                        <AttributeRow
                            key={entry.id}
                            entry={entry}
                            tab={tab}
                            isSelected={entry.name === selectedEntryName}
                            onSelect={() => handleSelect(entry.name)}
                            onVisibilityChange={() => handleVisibilityChange(entry)}
                            onNameChange={(name) => handleNameChange(entry, name)}
                            onColorChange={(color) => handleColorChange(entry, color)}
                            onShapeChange={(shape) => handleShapeChange(entry, shape)}
                            onSizeChange={(size) => handleSizeChange(entry, size)}
                            onRangeChange={(min, max) => handleRangeChange(entry, min, max)}
                        />
                    ))}
                </TableBody>
            </Table>
        </TableContainer>
    );
};

export default AttributeGrid;
