import React, { useState } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Box,
    Stack,
    Typography,
    List,
    ListItem,
    ListItemText,
    ListItemSecondaryAction,
    IconButton,
    Chip,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Divider,
} from '@mui/material';
import { Upload, Download, Delete, Info } from '@mui/icons-material';
import { useStyleStore } from '../../store/styleStore';
import { useAppStore } from '../../store/appStore';
import { StyleTemplate } from '../../types/styleTemplate';
import {
    exportTemplateToFile,
    importTemplateFromFile,
    applyTemplateToField,
    GOLD_STANDARD_TEMPLATE
} from '../../utils/styleTemplates';

interface StyleLibraryProps {
    open: boolean;
    onClose: () => void;
}

export const StyleLibrary: React.FC<StyleLibraryProps> = ({ open, onClose }) => {
    const { savedTemplates, addTemplate, removeTemplate, addStyleRule } = useStyleStore();
    const { columns } = useAppStore();

    const [selectedTemplate, setSelectedTemplate] = useState<StyleTemplate | null>(null);
    const [targetField, setTargetField] = useState('');
    const [showInfo, setShowInfo] = useState<string | null>(null);

    // Initialize with Gold Standard if no templates exist
    React.useEffect(() => {
        if (open && savedTemplates.length === 0) {
            addTemplate(GOLD_STANDARD_TEMPLATE);
        }
    }, [open, savedTemplates.length, addTemplate]);

    const handleImport = async () => {
        try {
            const template = await importTemplateFromFile();
            addTemplate(template);
        } catch (error) {
            console.error('Failed to import template:', error);
        }
    };

    const handleExport = (template: StyleTemplate) => {
        exportTemplateToFile(template);
    };

    const handleDelete = (name: string) => {
        removeTemplate(name);
        if (selectedTemplate?.name === name) {
            setSelectedTemplate(null);
        }
    };

    const handleApply = () => {
        if (selectedTemplate && targetField) {
            const rule = applyTemplateToField(selectedTemplate, targetField);
            addStyleRule(rule);
            onClose();
        }
    };

    const getCompatibleColumns = () => {
        if (!selectedTemplate) return [];

        if (selectedTemplate.type === 'numeric') {
            return columns.filter(c =>
                c.type === 'numeric' || c.type === 'float' || c.type === 'integer'
            );
        } else {
            return columns.filter(c =>
                c.type === 'string' || c.type === 'categorical'
            );
        }
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
            <DialogTitle>
                Style Template Library
            </DialogTitle>

            <DialogContent>
                <Stack spacing={3}>
                    {/* Import/Export Actions */}
                    <Box sx={{ display: 'flex', gap: 1 }}>
                        <Button
                            startIcon={<Upload />}
                            variant="outlined"
                            onClick={handleImport}
                        >
                            Import Template
                        </Button>
                    </Box>

                    <Divider />

                    {/* Template List */}
                    <Box>
                        <Typography variant="h6" gutterBottom>
                            Saved Templates ({savedTemplates.length})
                        </Typography>

                        {savedTemplates.length === 0 ? (
                            <Typography variant="body2" color="text.secondary">
                                No templates saved. Import a template or create one from the Style Manager.
                            </Typography>
                        ) : (
                            <List>
                                {savedTemplates.map((template) => (
                                    <ListItem
                                        key={template.name}
                                        selected={selectedTemplate?.name === template.name}
                                        sx={{
                                            border: 1,
                                            borderColor: 'divider',
                                            borderRadius: 1,
                                            mb: 1,
                                            cursor: 'pointer',
                                            '&:hover': { bgcolor: 'action.hover' }
                                        }}
                                        onClick={() => setSelectedTemplate(template)}
                                    >
                                        <ListItemText
                                            primary={
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                    <Typography variant="subtitle1">
                                                        {template.name}
                                                    </Typography>
                                                    <Chip
                                                        label={template.type}
                                                        size="small"
                                                        color={template.type === 'numeric' ? 'primary' : 'secondary'}
                                                    />
                                                    <Chip
                                                        label={template.attribute}
                                                        size="small"
                                                        variant="outlined"
                                                    />
                                                </Box>
                                            }
                                            secondary={
                                                <>
                                                    {template.description && (
                                                        <Typography variant="body2" color="text.secondary">
                                                            {template.description}
                                                        </Typography>
                                                    )}
                                                    <Typography variant="caption" color="text.secondary">
                                                        {template.type === 'numeric'
                                                            ? `${template.method} · ${template.numClasses} classes · ${template.palette}`
                                                            : `${template.categories?.length || 0} categories`
                                                        }
                                                    </Typography>
                                                </>
                                            }
                                        />
                                        <ListItemSecondaryAction>
                                            <IconButton
                                                size="small"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setShowInfo(template.name);
                                                }}
                                            >
                                                <Info />
                                            </IconButton>
                                            <IconButton
                                                size="small"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleExport(template);
                                                }}
                                            >
                                                <Download />
                                            </IconButton>
                                            <IconButton
                                                size="small"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleDelete(template.name);
                                                }}
                                            >
                                                <Delete />
                                            </IconButton>
                                        </ListItemSecondaryAction>
                                    </ListItem>
                                ))}
                            </List>
                        )}
                    </Box>

                    {/* Apply Template */}
                    {selectedTemplate && (
                        <>
                            <Divider />
                            <Box>
                                <Typography variant="h6" gutterBottom>
                                    Apply "{selectedTemplate.name}"
                                </Typography>

                                <FormControl fullWidth>
                                    <InputLabel>Target Field</InputLabel>
                                    <Select
                                        value={targetField}
                                        onChange={(e) => setTargetField(e.target.value)}
                                        label="Target Field"
                                    >
                                        {getCompatibleColumns().map(col => (
                                            <MenuItem key={col.name} value={col.name}>
                                                {col.alias || col.name}
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>

                                {selectedTemplate.metadata?.hint && (
                                    <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                                        💡 {selectedTemplate.metadata.hint}
                                    </Typography>
                                )}
                            </Box>
                        </>
                    )}

                    {/* Template Info Dialog */}
                    {showInfo && (() => {
                        const template = savedTemplates.find(t => t.name === showInfo);
                        if (!template) return null;

                        return (
                            <Dialog open={!!showInfo} onClose={() => setShowInfo(null)}>
                                <DialogTitle>{template.name}</DialogTitle>
                                <DialogContent>
                                    <Stack spacing={2}>
                                        <Box>
                                            <Typography variant="caption" color="text.secondary">
                                                Description
                                            </Typography>
                                            <Typography variant="body2">
                                                {template.description || 'No description'}
                                            </Typography>
                                        </Box>

                                        <Box>
                                            <Typography variant="caption" color="text.secondary">
                                                Details
                                            </Typography>
                                            <Typography variant="body2">
                                                Type: {template.type}<br />
                                                Attribute: {template.attribute}<br />
                                                {template.type === 'numeric' && (
                                                    <>
                                                        Method: {template.method}<br />
                                                        Classes: {template.numClasses}<br />
                                                        Palette: {template.palette}<br />
                                                    </>
                                                )}
                                                {template.metadata?.originalField && (
                                                    <>Original Field: {template.metadata.originalField}<br /></>
                                                )}
                                            </Typography>
                                        </Box>

                                        {template.ranges && template.ranges.length > 0 && (
                                            <Box>
                                                <Typography variant="caption" color="text.secondary">
                                                    Ranges
                                                </Typography>
                                                <Stack spacing={0.5}>
                                                    {template.ranges.map((range, i) => (
                                                        <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                            {range.color && (
                                                                <Box sx={{
                                                                    width: 16,
                                                                    height: 16,
                                                                    backgroundColor: range.color,
                                                                    borderRadius: '50%'
                                                                }} />
                                                            )}
                                                            <Typography variant="body2">{range.label}</Typography>
                                                        </Box>
                                                    ))}
                                                </Stack>
                                            </Box>
                                        )}
                                    </Stack>
                                </DialogContent>
                                <DialogActions>
                                    <Button onClick={() => setShowInfo(null)}>Close</Button>
                                </DialogActions>
                            </Dialog>
                        );
                    })()}
                </Stack>
            </DialogContent>

            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button
                    variant="contained"
                    onClick={handleApply}
                    disabled={!selectedTemplate || !targetField}
                >
                    Apply Template
                </Button>
            </DialogActions>
        </Dialog>
    );
};
