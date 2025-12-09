import React, { useState, useMemo, useEffect } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Box,
    Typography,
    Button,
    TextField,
    Select,
    MenuItem,
    FormControl,
    InputLabel,
    List,
    ListItemButton,
    ListItemText,
    ListItemIcon,
    Divider,
    Chip,
    Alert,
    Paper,
    Grid,
    Accordion,
    AccordionSummary,
    AccordionDetails,
    IconButton,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    LinearProgress,
} from '@mui/material';
import {
    ExpandMore,
    Calculate,
    Functions,
    Science,
    Terrain,
    TrendingUp,
    AutoAwesome,
    Close,
    PlayArrow,
    Add,
    Delete,
    CheckCircle,
    Error as ErrorIcon,
    Warning,
    Info,
    Search,
    SwapHoriz,
} from '@mui/icons-material';
import { useCalculationStore } from '../../store/calculationStore';
import { useAppStore } from '../../store/appStore';
import {
    CalculationDefinition,
    CalculationCategory,
    ColumnMapping,
    MissingValueStrategy,
} from '../../types/calculations';
import { CustomFormulaBuilder } from './CustomFormulaBuilder';

// Category icons
const CATEGORY_ICONS: Record<CalculationCategory, React.ReactNode> = {
    'unit-conversion': <SwapHoriz fontSize="small" />,
    'element-oxide': <Science fontSize="small" />,
    'oxide-element': <Science fontSize="small" />,
    'petrochemical-index': <Calculate fontSize="small" />,
    'weathering-index': <Terrain fontSize="small" />,
    'ree-normalization': <AutoAwesome fontSize="small" />,
    'exploration-ratio': <TrendingUp fontSize="small" />,
    'custom': <Functions fontSize="small" />,
};

const CATEGORY_LABELS: Record<CalculationCategory, string> = {
    'unit-conversion': 'Unit Conversions',
    'element-oxide': 'Element → Oxide',
    'oxide-element': 'Oxide → Element',
    'petrochemical-index': 'Petrochemical Indices',
    'weathering-index': 'Weathering Indices',
    'ree-normalization': 'REE Normalization',
    'exploration-ratio': 'Exploration Ratios',
    'custom': 'Custom Formulas',
};

export const CalculationManager: React.FC = () => {
    const {
        isCalculationManagerOpen,
        closeCalculationManager,
        builtInCalculations,
        queue,
        addToQueue,
        removeFromQueue,
        executeAllCalculations,
        autoDetectMappings,
    } = useCalculationStore();

    const { columns } = useAppStore();

    // UI State
    const [selectedCategory, setSelectedCategory] = useState<CalculationCategory | null>(null);
    const [selectedCalculation, setSelectedCalculation] = useState<CalculationDefinition | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [columnMappings, setColumnMappings] = useState<ColumnMapping[]>([]);
    const [outputColumnName, setOutputColumnName] = useState('');
    const [missingValueStrategy, setMissingValueStrategy] = useState<MissingValueStrategy>('skip');
    const [isExecuting, setIsExecuting] = useState(false);

    // Get column names for dropdowns
    const columnNames = useMemo(() => columns.map(c => c.name), [columns]);

    // Filter calculations by category and search
    const filteredCalculations = useMemo(() => {
        let calcs = builtInCalculations;

        if (selectedCategory) {
            calcs = calcs.filter(c => c.category === selectedCategory);
        }

        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            calcs = calcs.filter(c =>
                c.name.toLowerCase().includes(query) ||
                c.description.toLowerCase().includes(query)
            );
        }

        return calcs;
    }, [builtInCalculations, selectedCategory, searchQuery]);

    // Group calculations by category
    const calculationsByCategory = useMemo(() => {
        const grouped: Record<CalculationCategory, CalculationDefinition[]> = {
            'unit-conversion': [],
            'element-oxide': [],
            'oxide-element': [],
            'petrochemical-index': [],
            'weathering-index': [],
            'ree-normalization': [],
            'exploration-ratio': [],
            'custom': [],
        };

        filteredCalculations.forEach(calc => {
            grouped[calc.category].push(calc);
        });

        return grouped;
    }, [filteredCalculations]);

    // Auto-detect column mappings when calculation is selected
    useEffect(() => {
        if (selectedCalculation && columnNames.length > 0) {
            const mappings = autoDetectMappings(selectedCalculation.id, columnNames);
            setColumnMappings(mappings);
            setOutputColumnName(selectedCalculation.name.replace(/[^a-zA-Z0-9]/g, '_'));
        }
    }, [selectedCalculation, columnNames, autoDetectMappings]);

    const handleSelectCalculation = (calc: CalculationDefinition) => {
        setSelectedCalculation(calc);
    };

    const handleColumnMappingChange = (inputName: string, columnName: string) => {
        setColumnMappings(prev =>
            prev.map(m => m.inputName === inputName ? { ...m, columnName } : m)
        );
    };

    const handleAddToQueue = () => {
        if (!selectedCalculation) return;

        addToQueue({
            calculationId: selectedCalculation.id,
            outputColumnName,
            columnMappings,
            missingValueStrategy,
        });

        // Reset form
        setSelectedCalculation(null);
        setColumnMappings([]);
        setOutputColumnName('');
    };

    const handleExecuteAll = async () => {
        setIsExecuting(true);
        try {
            await executeAllCalculations();
        } finally {
            setIsExecuting(false);
        }
    };

    const canAddToQueue = useMemo(() => {
        if (!selectedCalculation) return false;
        if (!outputColumnName.trim()) return false;

        // Check required inputs have mappings
        const requiredInputs = selectedCalculation.inputs.filter(i => i.required);
        const allMapped = requiredInputs.every(input =>
            columnMappings.find(m => m.inputName === input.name && m.columnName)
        );

        return allMapped;
    }, [selectedCalculation, outputColumnName, columnMappings]);

    const getQueueItemStatusIcon = (status: string) => {
        switch (status) {
            case 'completed': return <CheckCircle color="success" fontSize="small" />;
            case 'error': return <ErrorIcon color="error" fontSize="small" />;
            case 'warning': return <Warning color="warning" fontSize="small" />;
            case 'running': return <LinearProgress sx={{ width: 20 }} />;
            default: return <Info color="info" fontSize="small" />;
        }
    };

    return (
        <Dialog
            open={isCalculationManagerOpen}
            onClose={closeCalculationManager}
            maxWidth="lg"
            fullWidth
            PaperProps={{ sx: { height: '80vh' } }}
        >
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Calculate />
                    <Typography variant="h6">Geochemical Calculations</Typography>
                </Box>
                <IconButton onClick={closeCalculationManager} size="small">
                    <Close />
                </IconButton>
            </DialogTitle>

            <DialogContent dividers>
                <Grid container spacing={2} sx={{ height: '100%' }}>
                    {/* Left Panel - Category Browser */}
                    <Grid item xs={3}>
                        <Paper variant="outlined" sx={{ height: '100%', overflow: 'auto' }}>
                            <Box sx={{ p: 1 }}>
                                <TextField
                                    size="small"
                                    fullWidth
                                    placeholder="Search calculations..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    InputProps={{
                                        startAdornment: <Search fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} />,
                                    }}
                                />
                            </Box>
                            <Divider />
                            <List dense>
                                <ListItemButton
                                    selected={selectedCategory === null}
                                    onClick={() => setSelectedCategory(null)}
                                >
                                    <ListItemText primary="All Calculations" />
                                    <Chip label={builtInCalculations.length} size="small" />
                                </ListItemButton>

                                {Object.entries(CATEGORY_LABELS).map(([category, label]) => {
                                    const count = calculationsByCategory[category as CalculationCategory]?.length || 0;
                                    if (count === 0 && searchQuery) return null;

                                    return (
                                        <ListItemButton
                                            key={category}
                                            selected={selectedCategory === category}
                                            onClick={() => setSelectedCategory(category as CalculationCategory)}
                                        >
                                            <ListItemIcon sx={{ minWidth: 32 }}>
                                                {CATEGORY_ICONS[category as CalculationCategory]}
                                            </ListItemIcon>
                                            <ListItemText primary={label} />
                                            <Chip label={count} size="small" />
                                        </ListItemButton>
                                    );
                                })}
                            </List>
                        </Paper>
                    </Grid>

                    {/* Middle Panel - Calculation List */}
                    <Grid item xs={4}>
                        <Paper variant="outlined" sx={{ height: '100%', overflow: 'auto' }}>
                            <Typography variant="subtitle2" sx={{ p: 1, bgcolor: 'action.hover' }}>
                                Available Calculations ({filteredCalculations.length})
                            </Typography>
                            <Divider />
                            <List dense sx={{ maxHeight: 400, overflow: 'auto' }}>
                                {filteredCalculations.map(calc => (
                                    <ListItemButton
                                        key={calc.id}
                                        selected={selectedCalculation?.id === calc.id}
                                        onClick={() => handleSelectCalculation(calc)}
                                    >
                                        <ListItemIcon sx={{ minWidth: 32 }}>
                                            {CATEGORY_ICONS[calc.category]}
                                        </ListItemIcon>
                                        <ListItemText
                                            primary={calc.name}
                                            secondary={calc.description.slice(0, 50) + '...'}
                                            primaryTypographyProps={{ variant: 'body2' }}
                                            secondaryTypographyProps={{ variant: 'caption', noWrap: true }}
                                        />
                                    </ListItemButton>
                                ))}
                            </List>
                        </Paper>
                    </Grid>

                    {/* Right Panel - Configuration */}
                    <Grid item xs={5}>
                        <Paper variant="outlined" sx={{ height: '100%', overflow: 'auto', p: 2 }}>
                            {selectedCategory === 'custom' ? (
                                <CustomFormulaBuilder />
                            ) : selectedCalculation ? (
                                <Box>
                                    <Typography variant="h6" gutterBottom>
                                        {selectedCalculation.name}
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary" paragraph>
                                        {selectedCalculation.description}
                                    </Typography>

                                    <Alert severity="info" sx={{ mb: 2 }}>
                                        <Typography variant="caption">
                                            <strong>Formula:</strong> {selectedCalculation.formulaDisplay}
                                        </Typography>
                                    </Alert>

                                    <Typography variant="subtitle2" gutterBottom>
                                        Input Column Mappings
                                    </Typography>

                                    {selectedCalculation.inputs.map(input => {
                                        const mapping = columnMappings.find(m => m.inputName === input.name);
                                        return (
                                            <FormControl
                                                key={input.name}
                                                fullWidth
                                                size="small"
                                                sx={{ mb: 1 }}
                                                error={input.required && !mapping?.columnName}
                                            >
                                                <InputLabel>
                                                    {input.name} ({input.unit}){input.required ? ' *' : ''}
                                                </InputLabel>
                                                <Select
                                                    value={mapping?.columnName || ''}
                                                    onChange={(e) => handleColumnMappingChange(input.name, e.target.value)}
                                                    label={`${input.name} (${input.unit})${input.required ? ' *' : ''}`}
                                                >
                                                    <MenuItem value="">
                                                        <em>Not mapped</em>
                                                    </MenuItem>
                                                    {columnNames.map(col => (
                                                        <MenuItem key={col} value={col}>{col}</MenuItem>
                                                    ))}
                                                </Select>
                                            </FormControl>
                                        );
                                    })}

                                    <Divider sx={{ my: 2 }} />

                                    <TextField
                                        fullWidth
                                        size="small"
                                        label="Output Column Name"
                                        value={outputColumnName}
                                        onChange={(e) => setOutputColumnName(e.target.value)}
                                        sx={{ mb: 2 }}
                                    />

                                    <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                                        <InputLabel>Missing Value Handling</InputLabel>
                                        <Select
                                            value={missingValueStrategy}
                                            onChange={(e) => setMissingValueStrategy(e.target.value as MissingValueStrategy)}
                                            label="Missing Value Handling"
                                        >
                                            <MenuItem value="skip">Skip (return null)</MenuItem>
                                            <MenuItem value="zero">Use Zero</MenuItem>
                                            <MenuItem value="half-dl">Half Detection Limit</MenuItem>
                                        </Select>
                                    </FormControl>

                                    <Button
                                        fullWidth
                                        variant="contained"
                                        startIcon={<Add />}
                                        onClick={handleAddToQueue}
                                        disabled={!canAddToQueue}
                                    >
                                        Add to Queue
                                    </Button>
                                </Box>
                            ) : (
                                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                                    <Typography color="text.secondary">
                                        Select a calculation to configure
                                    </Typography>
                                </Box>
                            )}
                        </Paper>
                    </Grid>
                </Grid>

                {/* Queue Section */}
                {queue.length > 0 && (
                    <Box sx={{ mt: 2 }}>
                        <Accordion defaultExpanded>
                            <AccordionSummary expandIcon={<ExpandMore />}>
                                <Typography variant="subtitle1">
                                    Calculation Queue ({queue.length})
                                </Typography>
                            </AccordionSummary>
                            <AccordionDetails>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>Calculation</TableCell>
                                            <TableCell>Output Column</TableCell>
                                            <TableCell>Status</TableCell>
                                            <TableCell width={50}>Action</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {queue.map(item => {
                                            const calc = builtInCalculations.find(c => c.id === item.config.calculationId);
                                            return (
                                                <TableRow key={item.id}>
                                                    <TableCell>{calc?.name || item.config.calculationId}</TableCell>
                                                    <TableCell>{item.config.outputColumnName}</TableCell>
                                                    <TableCell>
                                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                            {getQueueItemStatusIcon(item.status)}
                                                            <Typography variant="caption">
                                                                {item.status}
                                                                {item.errorMessage && `: ${item.errorMessage}`}
                                                            </Typography>
                                                        </Box>
                                                    </TableCell>
                                                    <TableCell>
                                                        <IconButton
                                                            size="small"
                                                            onClick={() => removeFromQueue(item.id)}
                                                            disabled={item.status === 'running'}
                                                        >
                                                            <Delete fontSize="small" />
                                                        </IconButton>
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })}
                                    </TableBody>
                                </Table>
                            </AccordionDetails>
                        </Accordion>
                    </Box>
                )}
            </DialogContent>

            <DialogActions>
                <Button onClick={closeCalculationManager}>Close</Button>
                <Button
                    variant="contained"
                    startIcon={isExecuting ? undefined : <PlayArrow />}
                    onClick={handleExecuteAll}
                    disabled={queue.filter(q => q.status === 'pending').length === 0 || isExecuting}
                >
                    {isExecuting ? 'Executing...' : 'Execute All Calculations'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default CalculationManager;
