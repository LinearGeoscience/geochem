import React, { useState } from 'react';
import {
    Paper,
    Typography,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Button,
    Box,
    Stack,
    IconButton,

    TextField,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Slider,
    Divider,
    Tooltip,
    Checkbox,
    Collapse,
} from '@mui/material';
import { Settings, Clear, Save, LibraryBooks, Visibility, VisibilityOff, ExpandMore, ExpandLess } from '@mui/icons-material';
import { Circle } from '@mui/icons-material';
import { useAppStore } from '../../store/appStore';
import { useStyleStore, StyleRule, StyleRange, CategoryStyle } from '../../store/styleStore';
import { RangeEditor } from './RangeEditor';
import { StyleLibrary } from './StyleLibrary';
import { EmphasisControls } from './EmphasisControls';
import { styleRuleToTemplate } from '../../utils/styleTemplates';

// Render a marker shape as SVG
const ShapeMarker: React.FC<{ shape: string; color?: string; size?: number }> = ({ shape, color = '#000', size = 16 }) => {
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

interface InlineLegendProps {
    rule: StyleRule;
    attribute: 'color' | 'shape' | 'size';
}

const InlineLegend: React.FC<InlineLegendProps> = ({ rule, attribute }) => {
    const { toggleRangeVisibility, toggleCategoryVisibility, setAllRangesVisible, setAllCategoriesVisible } = useStyleStore();
    const [expanded, setExpanded] = useState(true);

    const items = rule.type === 'numeric' ? rule.ranges : rule.categories;
    if (!items || items.length === 0) return null;

    const allVisible = items.every(item => item.visible !== false);
    const noneVisible = items.every(item => item.visible === false);

    const handleToggleAll = (visible: boolean) => {
        if (rule.type === 'numeric') {
            setAllRangesVisible(rule.field, rule.attribute, visible);
        } else {
            setAllCategoriesVisible(rule.field, rule.attribute, visible);
        }
    };

    const renderItem = (item: StyleRange | CategoryStyle, index: number) => {
        const isVisible = item.visible !== false;
        const handleToggle = () => {
            if (rule.type === 'numeric') {
                toggleRangeVisibility(rule.field, rule.attribute, index);
            } else {
                toggleCategoryVisibility(rule.field, rule.attribute, index);
            }
        };

        return (
            <Box key={index} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, py: 0.25 }}>
                <Checkbox
                    size="small"
                    checked={isVisible}
                    onChange={handleToggle}
                    sx={{ p: 0 }}
                />
                {attribute === 'color' && (
                    <Box
                        sx={{
                            width: 14,
                            height: 14,
                            backgroundColor: (item as any).color || '#000',
                            borderRadius: '50%',
                            flexShrink: 0,
                            opacity: isVisible ? 1 : 0.3,
                            border: '1px solid rgba(0,0,0,0.2)'
                        }}
                    />
                )}
                {attribute === 'shape' && (
                    <ShapeMarker shape={(item as any).shape || 'circle'} color={isVisible ? '#000' : '#999'} size={14} />
                )}
                {attribute === 'size' && (
                    <Circle sx={{ fontSize: Math.max(8, ((item as any).size || 6) * 1.5), opacity: isVisible ? 1 : 0.3 }} />
                )}
                <Typography
                    variant="caption"
                    sx={{
                        opacity: isVisible ? 1 : 0.5,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        flex: 1
                    }}
                >
                    {item.label}
                </Typography>
            </Box>
        );
    };

    return (
        <Box sx={{ mt: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    px: 1,
                    py: 0.5,
                    bgcolor: 'action.hover',
                    cursor: 'pointer'
                }}
                onClick={() => setExpanded(!expanded)}
            >
                <Typography variant="caption" fontWeight="bold">
                    Legend ({items.length} items)
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Tooltip title="Show All">
                        <IconButton
                            size="small"
                            onClick={(e) => { e.stopPropagation(); handleToggleAll(true); }}
                            disabled={allVisible}
                            sx={{ p: 0.25 }}
                        >
                            <Visibility fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title="Hide All">
                        <IconButton
                            size="small"
                            onClick={(e) => { e.stopPropagation(); handleToggleAll(false); }}
                            disabled={noneVisible}
                            sx={{ p: 0.25 }}
                        >
                            <VisibilityOff fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    {expanded ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
                </Box>
            </Box>
            <Collapse in={expanded}>
                <Box sx={{ p: 1, maxHeight: 200, overflow: 'auto' }}>
                    {items.map((item, index) => renderItem(item, index))}
                </Box>
            </Collapse>
        </Box>
    );
};

export const StyleManager: React.FC = () => {
    const { columns } = useAppStore();
    const { styleRules, addStyleRule, removeStyleRule, addTemplate, clearAllStyles, globalOpacity, setGlobalOpacity } = useStyleStore();

    const [colorField, setColorField] = useState('');
    const [shapeField, setShapeField] = useState('');
    const [sizeField, setSizeField] = useState('');

    const [editorOpen, setEditorOpen] = useState(false);
    const [editorField, setEditorField] = useState('');
    const [editorAttribute, setEditorAttribute] = useState<'color' | 'shape' | 'size'>('color');

    const [libraryOpen, setLibraryOpen] = useState(false);
    const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
    const [saveTemplateField, setSaveTemplateField] = useState('');
    const [saveTemplateAttribute, setSaveTemplateAttribute] = useState<'color' | 'shape' | 'size'>('color');
    const [templateName, setTemplateName] = useState('');
    const [templateDescription, setTemplateDescription] = useState('');

    const numericColumns = columns.filter(c => c.type === 'numeric' || c.type === 'float' || c.type === 'integer');
    const allColumns = columns;

    const openEditor = (field: string, attribute: 'color' | 'shape' | 'size') => {
        setEditorField(field);
        setEditorAttribute(attribute);
        setEditorOpen(true);
    };

    const handleSaveRule = (rule: StyleRule) => {
        addStyleRule(rule);
    };

    const clearField = (attribute: 'color' | 'shape' | 'size') => {
        const field = attribute === 'color' ? colorField : attribute === 'shape' ? shapeField : sizeField;
        if (field) {
            removeStyleRule(field, attribute);
            if (attribute === 'color') setColorField('');
            if (attribute === 'shape') setShapeField('');
            if (attribute === 'size') setSizeField('');
        }
    };

    const getActiveRule = (field: string, attribute: 'color' | 'shape' | 'size') => {
        return styleRules.find(r => r.field === field && r.attribute === attribute);
    };

    const openSaveTemplate = (field: string, attribute: 'color' | 'shape' | 'size') => {
        setSaveTemplateField(field);
        setSaveTemplateAttribute(attribute);
        setSaveTemplateOpen(true);
        setTemplateName('');
        setTemplateDescription('');
    };

    const handleSaveTemplate = () => {
        const rule = getActiveRule(saveTemplateField, saveTemplateAttribute);
        if (rule && templateName) {
            const template = styleRuleToTemplate(rule, templateName, undefined, templateDescription);
            addTemplate(template);
            setSaveTemplateOpen(false);
        }
    };

    return (
        <Paper sx={{ p: 2, mt: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6">
                    Style Manager
                </Typography>
                <Box sx={{ display: 'flex', gap: 1 }}>
                    {styleRules.length > 0 && (
                        <Button
                            variant="outlined"
                            color="error"
                            startIcon={<Clear />}
                            onClick={clearAllStyles}
                            size="small"
                        >
                            Clear All
                        </Button>
                    )}
                    <Button
                        variant="outlined"
                        startIcon={<LibraryBooks />}
                        onClick={() => setLibraryOpen(true)}
                        size="small"
                    >
                        Templates
                    </Button>
                </Box>
            </Box>

            <Stack spacing={2}>
                {/* Color Styling */}
                <Box>
                    <Typography variant="subtitle2" gutterBottom>
                        Colour
                    </Typography>
                    <FormControl fullWidth size="small">
                        <InputLabel>Field</InputLabel>
                        <Select
                            value={colorField}
                            onChange={(e) => setColorField(e.target.value)}
                            label="Field"
                        >
                            <MenuItem value="">None</MenuItem>
                            {numericColumns.map(col => (
                                <MenuItem key={col.name} value={col.name}>
                                    {col.alias || col.name}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    {colorField && (
                        <Box sx={{ mt: 1, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                            <Button
                                size="small"
                                variant="outlined"
                                startIcon={<Settings />}
                                onClick={() => openEditor(colorField, 'color')}
                            >
                                Configure
                            </Button>
                            {getActiveRule(colorField, 'color') && (
                                <Button
                                    size="small"
                                    variant="outlined"
                                    startIcon={<Save />}
                                    onClick={() => openSaveTemplate(colorField, 'color')}
                                >
                                    Save
                                </Button>
                            )}
                            <IconButton size="small" onClick={() => clearField('color')}>
                                <Clear />
                            </IconButton>
                        </Box>
                    )}
                    {colorField && getActiveRule(colorField, 'color') && (
                        <InlineLegend rule={getActiveRule(colorField, 'color')!} attribute="color" />
                    )}
                </Box>

                <Divider />

                {/* Shape Styling */}
                <Box>
                    <Typography variant="subtitle2" gutterBottom>
                        Shape
                    </Typography>
                    <FormControl fullWidth size="small">
                        <InputLabel>Field</InputLabel>
                        <Select
                            value={shapeField}
                            onChange={(e) => setShapeField(e.target.value)}
                            label="Field"
                        >
                            <MenuItem value="">None</MenuItem>
                            {allColumns.map(col => (
                                <MenuItem key={col.name} value={col.name}>
                                    {col.alias || col.name}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    {shapeField && (
                        <Box sx={{ mt: 1, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                            <Button
                                size="small"
                                variant="outlined"
                                startIcon={<Settings />}
                                onClick={() => openEditor(shapeField, 'shape')}
                            >
                                Configure
                            </Button>
                            {getActiveRule(shapeField, 'shape') && (
                                <Button
                                    size="small"
                                    variant="outlined"
                                    startIcon={<Save />}
                                    onClick={() => openSaveTemplate(shapeField, 'shape')}
                                >
                                    Save
                                </Button>
                            )}
                            <IconButton size="small" onClick={() => clearField('shape')}>
                                <Clear />
                            </IconButton>
                        </Box>
                    )}
                    {shapeField && getActiveRule(shapeField, 'shape') && (
                        <InlineLegend rule={getActiveRule(shapeField, 'shape')!} attribute="shape" />
                    )}
                </Box>

                <Divider />

                {/* Size Styling */}
                <Box>
                    <Typography variant="subtitle2" gutterBottom>
                        Size
                    </Typography>
                    <FormControl fullWidth size="small">
                        <InputLabel>Field</InputLabel>
                        <Select
                            value={sizeField}
                            onChange={(e) => setSizeField(e.target.value)}
                            label="Field"
                        >
                            <MenuItem value="">None</MenuItem>
                            {numericColumns.map(col => (
                                <MenuItem key={col.name} value={col.name}>
                                    {col.alias || col.name}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    {sizeField && (
                        <Box sx={{ mt: 1, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                            <Button
                                size="small"
                                variant="outlined"
                                startIcon={<Settings />}
                                onClick={() => openEditor(sizeField, 'size')}
                            >
                                Configure
                            </Button>
                            {getActiveRule(sizeField, 'size') && (
                                <Button
                                    size="small"
                                    variant="outlined"
                                    startIcon={<Save />}
                                    onClick={() => openSaveTemplate(sizeField, 'size')}
                                >
                                    Save
                                </Button>
                            )}
                            <IconButton size="small" onClick={() => clearField('size')}>
                                <Clear />
                            </IconButton>
                        </Box>
                    )}
                    {sizeField && getActiveRule(sizeField, 'size') && (
                        <InlineLegend rule={getActiveRule(sizeField, 'size')!} attribute="size" />
                    )}
                </Box>

                <Divider />

                {/* Global Opacity Control */}
                <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                        <Visibility fontSize="small" />
                        <Typography variant="subtitle2">
                            Point Opacity
                        </Typography>
                        <Tooltip title="Set to 100% for full visibility">
                            <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                                {Math.round(globalOpacity * 100)}%
                            </Typography>
                        </Tooltip>
                    </Box>
                    <Slider
                        value={globalOpacity}
                        onChange={(_, value) => setGlobalOpacity(value as number)}
                        min={0.1}
                        max={1.0}
                        step={0.05}
                        valueLabelDisplay="auto"
                        valueLabelFormat={(v) => `${Math.round(v * 100)}%`}
                        size="small"
                    />
                </Box>

                {/* Grade Emphasis Controls */}
                <EmphasisControls />
            </Stack>

            {/* Range Editor Dialog */}
            <RangeEditor
                open={editorOpen}
                onClose={() => setEditorOpen(false)}
                field={editorField}
                attribute={editorAttribute}
                onSave={handleSaveRule}
            />

            {/* Style Library Dialog */}
            <StyleLibrary
                open={libraryOpen}
                onClose={() => setLibraryOpen(false)}
            />

            {/* Save Template Dialog */}
            <Dialog open={saveTemplateOpen} onClose={() => setSaveTemplateOpen(false)}>
                <DialogTitle>Save as Template</DialogTitle>
                <DialogContent>
                    <Stack spacing={2} sx={{ mt: 1 }}>
                        <TextField
                            label="Template Name"
                            value={templateName}
                            onChange={(e) => setTemplateName(e.target.value)}
                            fullWidth
                            required
                        />
                        <TextField
                            label="Description"
                            value={templateDescription}
                            onChange={(e) => setTemplateDescription(e.target.value)}
                            fullWidth
                            multiline
                            rows={3}
                        />
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setSaveTemplateOpen(false)}>Cancel</Button>
                    <Button
                        variant="contained"
                        onClick={handleSaveTemplate}
                        disabled={!templateName}
                    >
                        Save Template
                    </Button>
                </DialogActions>
            </Dialog>
        </Paper>
    );
};
