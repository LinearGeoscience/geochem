import React, { useState, useMemo, useCallback } from 'react';
import {
    Box,
    Typography,
    TextField,
    Button,
    Paper,
    Grid,
    Chip,
    Alert,
    Divider,
    List,
    ListItem,
    ListItemButton,
    ListItemText,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    IconButton,
    Tooltip,
    Tabs,
    Tab,
    InputAdornment,
} from '@mui/material';
import {
    Add,
    Functions,
    Calculate,
    CheckCircle,
    Error as ErrorIcon,
    ContentCopy,
    Search,
    Info,
} from '@mui/icons-material';
import { useAppStore } from '../../store/appStore';
import { useCalculationStore } from '../../store/calculationStore';
import {
    validateFormula,
    extractVariables,
    parseFormula,
    evaluateFormula,
    parseNumericValue,
} from '../../utils/calculations';
import { MissingValueStrategy, CalculationDefinition } from '../../types/calculations';

// Quick ratio templates
const QUICK_TEMPLATES = [
    { label: 'Simple Ratio (A/B)', formula: '{A} / {B}', description: 'Divide column A by column B' },
    { label: 'Sum', formula: '{A} + {B}', description: 'Add two columns' },
    { label: 'Difference', formula: '{A} - {B}', description: 'Subtract B from A' },
    { label: 'Product', formula: '{A} * {B}', description: 'Multiply two columns' },
    { label: 'Percentage', formula: '{A} / {B} * 100', description: 'Calculate A as percentage of B' },
    { label: 'Normalized Ratio', formula: '{A} / ({A} + {B})', description: 'A/(A+B) ratio' },
    { label: 'Log Transform', formula: 'log10({A} + 1)', description: 'Log base 10 with offset' },
    { label: 'Square Root', formula: 'sqrt({A})', description: 'Square root of A' },
    { label: 'Power', formula: 'pow({A}, 2)', description: 'A squared' },
    { label: 'Distance', formula: 'sqrt(pow({X}, 2) + pow({Y}, 2))', description: 'Euclidean distance' },
];

// Available functions
const AVAILABLE_FUNCTIONS = [
    { name: 'log10(x)', description: 'Logarithm base 10' },
    { name: 'ln(x)', description: 'Natural logarithm' },
    { name: 'sqrt(x)', description: 'Square root' },
    { name: 'abs(x)', description: 'Absolute value' },
    { name: 'pow(x, n)', description: 'Power (x to the n)' },
    { name: 'exp(x)', description: 'Exponential (e^x)' },
    { name: 'min(a, b)', description: 'Minimum of two values' },
    { name: 'max(a, b)', description: 'Maximum of two values' },
];

// Available operators
const OPERATORS = [
    { symbol: '+', description: 'Addition' },
    { symbol: '-', description: 'Subtraction' },
    { symbol: '*', description: 'Multiplication' },
    { symbol: '/', description: 'Division' },
    { symbol: '^', description: 'Power' },
    { symbol: '(', description: 'Open parenthesis' },
    { symbol: ')', description: 'Close parenthesis' },
];

interface CustomFormulaBuilderProps {
    onFormulaCreated?: (calc: CalculationDefinition) => void;
}

export const CustomFormulaBuilder: React.FC<CustomFormulaBuilderProps> = ({ onFormulaCreated }) => {
    const { columns, data } = useAppStore();
    const { addCustomCalculation, addToQueue } = useCalculationStore();

    // Form state
    const [formulaName, setFormulaName] = useState('');
    const [formulaExpression, setFormulaExpression] = useState('');
    const [outputColumnName, setOutputColumnName] = useState('');
    const [description, setDescription] = useState('');
    const [missingValueStrategy, setMissingValueStrategy] = useState<MissingValueStrategy>('skip');

    // UI state
    const [columnSearch, setColumnSearch] = useState('');
    const [activeTab, setActiveTab] = useState(0);
    const [cursorPosition, setCursorPosition] = useState(0);

    // Get numeric columns
    const numericColumns = useMemo(() =>
        columns.filter(c => c.type === 'numeric').map(c => c.name),
        [columns]
    );

    // Filter columns by search
    const filteredColumns = useMemo(() => {
        if (!columnSearch) return numericColumns;
        const search = columnSearch.toLowerCase();
        return numericColumns.filter(c => c.toLowerCase().includes(search));
    }, [numericColumns, columnSearch]);

    // Validate formula
    const validation = useMemo(() => {
        if (!formulaExpression.trim()) {
            return { valid: false, error: 'Enter a formula', variables: [] };
        }
        return validateFormula(formulaExpression);
    }, [formulaExpression]);

    // Check if all variables are mapped to columns
    const unmappedVariables = useMemo(() => {
        if (!validation.valid || !validation.variables) return [];
        return validation.variables.filter(v => !numericColumns.includes(v));
    }, [validation, numericColumns]);

    // Calculate preview
    const preview = useMemo(() => {
        if (!validation.valid || unmappedVariables.length > 0 || data.length === 0) {
            return null;
        }

        try {
            const ast = parseFormula(formulaExpression);
            const previewRows = data.slice(0, 5);

            return previewRows.map((row, idx) => {
                const variables: Record<string, number | null> = {};
                for (const varName of validation.variables || []) {
                    variables[varName] = parseNumericValue(row[varName]);
                }

                const result = evaluateFormula(ast, variables);
                return {
                    rowIndex: idx,
                    inputs: validation.variables?.map(v => ({ name: v, value: row[v] })) || [],
                    result,
                };
            });
        } catch (err) {
            return null;
        }
    }, [validation, formulaExpression, data, unmappedVariables]);

    // Insert text at cursor position
    const insertAtCursor = useCallback((text: string) => {
        const before = formulaExpression.slice(0, cursorPosition);
        const after = formulaExpression.slice(cursorPosition);
        const newFormula = before + text + after;
        setFormulaExpression(newFormula);
        setCursorPosition(cursorPosition + text.length);
    }, [formulaExpression, cursorPosition]);

    // Insert column reference
    const insertColumn = useCallback((columnName: string) => {
        insertAtCursor(`{${columnName}}`);
    }, [insertAtCursor]);

    // Insert operator
    const insertOperator = useCallback((op: string) => {
        insertAtCursor(` ${op} `);
    }, [insertAtCursor]);

    // Insert function
    const insertFunction = useCallback((func: string) => {
        const funcName = func.split('(')[0];
        insertAtCursor(`${funcName}(`);
    }, [insertAtCursor]);

    // Apply template
    const applyTemplate = useCallback((template: typeof QUICK_TEMPLATES[0]) => {
        setFormulaExpression(template.formula);
        if (!formulaName) {
            setFormulaName(template.label);
        }
    }, [formulaName]);

    // Handle formula input change
    const handleFormulaChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormulaExpression(e.target.value);
        setCursorPosition(e.target.selectionStart || 0);
    };

    // Handle cursor position update
    const handleFormulaClick = (e: React.MouseEvent<HTMLInputElement>) => {
        const target = e.target as HTMLInputElement;
        setCursorPosition(target.selectionStart || 0);
    };

    // Create the calculation
    const handleCreate = () => {
        if (!validation.valid || !formulaName.trim() || !outputColumnName.trim()) {
            return;
        }

        try {
            const ast = parseFormula(formulaExpression);

            // Create calculation definition
            const calcDef: CalculationDefinition = {
                id: `custom_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                name: formulaName,
                category: 'custom',
                description: description || `Custom formula: ${formulaExpression}`,
                formula: ast,
                formulaDisplay: formulaExpression,
                inputs: (validation.variables || []).map(varName => ({
                    name: varName,
                    description: `Column: ${varName}`,
                    required: true,
                    unit: 'none' as const,
                    aliases: [varName],
                    patterns: [new RegExp(`^${varName}$`, 'i')],
                })),
                outputUnit: 'ratio',
                validationRules: [],
                calculateFn: (inputs) => {
                    try {
                        return evaluateFormula(ast, inputs);
                    } catch {
                        return null;
                    }
                },
            };

            // Add to custom calculations
            addCustomCalculation(calcDef);

            // Add to queue with auto-mapped columns
            addToQueue({
                calculationId: calcDef.id,
                outputColumnName,
                columnMappings: (validation.variables || []).map(v => ({
                    inputName: v,
                    columnName: v,
                })),
                missingValueStrategy,
            });

            // Notify parent
            if (onFormulaCreated) {
                onFormulaCreated(calcDef);
            }

            // Reset form
            setFormulaName('');
            setFormulaExpression('');
            setOutputColumnName('');
            setDescription('');
        } catch (err) {
            console.error('Failed to create formula:', err);
        }
    };

    const canCreate = validation.valid &&
                      unmappedVariables.length === 0 &&
                      formulaName.trim() &&
                      outputColumnName.trim();

    return (
        <Box>
            <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Functions /> Custom Formula Builder
            </Typography>

            <Alert severity="info" sx={{ mb: 2 }}>
                <Typography variant="body2">
                    Create custom calculations using column references like <code>{'{Cu}'}</code> or <code>{'{Au_ppm}'}</code>.
                    Example: <code>{'{Au_ppb} / {As_ppm}'}</code> for Au/As ratio.
                </Typography>
            </Alert>

            <Grid container spacing={2}>
                {/* Left side - Formula input */}
                <Grid item xs={7}>
                    <Paper variant="outlined" sx={{ p: 2 }}>
                        {/* Formula Name */}
                        <TextField
                            fullWidth
                            size="small"
                            label="Formula Name"
                            value={formulaName}
                            onChange={(e) => setFormulaName(e.target.value)}
                            placeholder="e.g., Au/As Ratio"
                            sx={{ mb: 2 }}
                        />

                        {/* Formula Expression */}
                        <TextField
                            fullWidth
                            label="Formula Expression"
                            value={formulaExpression}
                            onChange={handleFormulaChange}
                            onClick={handleFormulaClick}
                            placeholder="e.g., {Au_ppb} / {As_ppm}"
                            multiline
                            rows={2}
                            error={formulaExpression.length > 0 && !validation.valid}
                            helperText={
                                formulaExpression.length > 0 && !validation.valid
                                    ? validation.error
                                    : 'Use {ColumnName} to reference columns'
                            }
                            sx={{ mb: 2, fontFamily: 'monospace' }}
                            InputProps={{
                                sx: { fontFamily: 'monospace' },
                                endAdornment: validation.valid && formulaExpression && (
                                    <InputAdornment position="end">
                                        <CheckCircle color="success" />
                                    </InputAdornment>
                                ),
                            }}
                        />

                        {/* Operator buttons */}
                        <Box sx={{ mb: 2 }}>
                            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                                Operators:
                            </Typography>
                            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                                {OPERATORS.map(op => (
                                    <Tooltip key={op.symbol} title={op.description}>
                                        <Chip
                                            label={op.symbol}
                                            size="small"
                                            onClick={() => insertOperator(op.symbol)}
                                            sx={{ fontFamily: 'monospace', fontWeight: 'bold' }}
                                        />
                                    </Tooltip>
                                ))}
                            </Box>
                        </Box>

                        {/* Function buttons */}
                        <Box sx={{ mb: 2 }}>
                            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                                Functions:
                            </Typography>
                            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                                {AVAILABLE_FUNCTIONS.map(func => (
                                    <Tooltip key={func.name} title={func.description}>
                                        <Chip
                                            label={func.name}
                                            size="small"
                                            onClick={() => insertFunction(func.name)}
                                            sx={{ fontFamily: 'monospace' }}
                                        />
                                    </Tooltip>
                                ))}
                            </Box>
                        </Box>

                        {/* Unmapped variables warning */}
                        {unmappedVariables.length > 0 && (
                            <Alert severity="warning" sx={{ mb: 2 }}>
                                <Typography variant="body2">
                                    Unknown columns: {unmappedVariables.map(v => `{${v}}`).join(', ')}
                                </Typography>
                            </Alert>
                        )}

                        {/* Detected variables */}
                        {validation.valid && validation.variables && validation.variables.length > 0 && (
                            <Box sx={{ mb: 2 }}>
                                <Typography variant="caption" color="text.secondary">
                                    Using columns:
                                </Typography>
                                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.5 }}>
                                    {validation.variables.map(v => (
                                        <Chip
                                            key={v}
                                            label={v}
                                            size="small"
                                            color={numericColumns.includes(v) ? 'success' : 'error'}
                                            variant="outlined"
                                        />
                                    ))}
                                </Box>
                            </Box>
                        )}

                        <Divider sx={{ my: 2 }} />

                        {/* Output settings */}
                        <TextField
                            fullWidth
                            size="small"
                            label="Output Column Name"
                            value={outputColumnName}
                            onChange={(e) => setOutputColumnName(e.target.value)}
                            placeholder="e.g., Au_As_ratio"
                            sx={{ mb: 2 }}
                        />

                        <TextField
                            fullWidth
                            size="small"
                            label="Description (optional)"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Describe what this calculation does"
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
                            onClick={handleCreate}
                            disabled={!canCreate}
                        >
                            Create & Add to Queue
                        </Button>
                    </Paper>

                    {/* Preview */}
                    {preview && preview.length > 0 && (
                        <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
                            <Typography variant="subtitle2" gutterBottom>
                                Preview (first 5 rows)
                            </Typography>
                            <Table size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell>Row</TableCell>
                                        {validation.variables?.map(v => (
                                            <TableCell key={v}>{v}</TableCell>
                                        ))}
                                        <TableCell sx={{ fontWeight: 'bold' }}>Result</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {preview.map((row, idx) => (
                                        <TableRow key={idx}>
                                            <TableCell>{row.rowIndex + 1}</TableCell>
                                            {row.inputs.map((input, i) => (
                                                <TableCell key={i}>
                                                    {input.value ?? <em>null</em>}
                                                </TableCell>
                                            ))}
                                            <TableCell sx={{ fontWeight: 'bold' }}>
                                                {row.result !== null
                                                    ? row.result.toFixed(4)
                                                    : <em>null</em>
                                                }
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </Paper>
                    )}
                </Grid>

                {/* Right side - Column picker and templates */}
                <Grid item xs={5}>
                    <Paper variant="outlined" sx={{ height: '100%' }}>
                        <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} variant="fullWidth">
                            <Tab label="Columns" />
                            <Tab label="Templates" />
                        </Tabs>

                        {activeTab === 0 && (
                            <Box sx={{ p: 1 }}>
                                <TextField
                                    fullWidth
                                    size="small"
                                    placeholder="Search columns..."
                                    value={columnSearch}
                                    onChange={(e) => setColumnSearch(e.target.value)}
                                    InputProps={{
                                        startAdornment: <Search fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} />,
                                    }}
                                    sx={{ mb: 1 }}
                                />
                                <Typography variant="caption" color="text.secondary">
                                    Click to insert column reference
                                </Typography>
                                <List dense sx={{ maxHeight: 350, overflow: 'auto' }}>
                                    {filteredColumns.map(col => (
                                        <ListItemButton
                                            key={col}
                                            onClick={() => insertColumn(col)}
                                            dense
                                        >
                                            <ListItemText
                                                primary={col}
                                                primaryTypographyProps={{ variant: 'body2', fontFamily: 'monospace' }}
                                            />
                                            <Tooltip title="Copy reference">
                                                <IconButton
                                                    size="small"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        navigator.clipboard.writeText(`{${col}}`);
                                                    }}
                                                >
                                                    <ContentCopy fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                        </ListItemButton>
                                    ))}
                                    {filteredColumns.length === 0 && (
                                        <ListItem>
                                            <ListItemText
                                                primary="No numeric columns found"
                                                secondary="Import data with numeric columns first"
                                            />
                                        </ListItem>
                                    )}
                                </List>
                            </Box>
                        )}

                        {activeTab === 1 && (
                            <Box sx={{ p: 1 }}>
                                <Typography variant="caption" color="text.secondary">
                                    Click a template to use it as a starting point
                                </Typography>
                                <List dense sx={{ maxHeight: 400, overflow: 'auto' }}>
                                    {QUICK_TEMPLATES.map((template, idx) => (
                                        <ListItemButton
                                            key={idx}
                                            onClick={() => applyTemplate(template)}
                                            dense
                                        >
                                            <ListItemText
                                                primary={template.label}
                                                secondary={
                                                    <Box component="span">
                                                        <code style={{ fontSize: '0.75rem' }}>{template.formula}</code>
                                                        <br />
                                                        <Typography variant="caption" color="text.secondary">
                                                            {template.description}
                                                        </Typography>
                                                    </Box>
                                                }
                                            />
                                        </ListItemButton>
                                    ))}
                                </List>
                            </Box>
                        )}
                    </Paper>
                </Grid>
            </Grid>
        </Box>
    );
};

export default CustomFormulaBuilder;
