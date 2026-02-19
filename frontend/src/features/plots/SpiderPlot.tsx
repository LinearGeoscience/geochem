import React, { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import Plot from 'react-plotly.js';
import { useAppStore } from '../../store/appStore';
import {
    Box,
    Paper,
    Typography,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Chip,
    Tooltip,
    IconButton,
    Collapse,
} from '@mui/material';
import { ExpandMore, ExpandLess, AutoFixHigh } from '@mui/icons-material';
import { MultiColumnSelector } from '../../components/MultiColumnSelector';
import { useAttributeStore } from '../../store/attributeStore';
import { getStyleArrays, applyOpacityToColor, getSortedIndices, sortColumnsByPriority, getColumnDisplayName } from '../../utils/attributeUtils';
import { getPlotConfig, EXPORT_FONT_SIZES } from '../../utils/plotConfig';
import { ExpandablePlotWrapper } from '../../components/ExpandablePlotWrapper';
import { buildSpiderHoverText } from '../../utils/tooltipUtils';
import {
    ELEMENT_ORDERS,
    NORMALIZATION_VALUES,
    findMatchingColumns,
} from '../../utils/elementOrdering';

interface AxisRanges {
    yRange?: [number, number];
}

interface SpiderPlotProps {
    plotId: string;
}

export const SpiderPlot: React.FC<SpiderPlotProps> = ({ plotId }) => {
    const { data, columns, lockAxes, getPlotSettings, updatePlotSettings, getFilteredColumns, getDisplayData, getDisplayIndices, sampleIndices, geochemMappings } = useAppStore();
    const filteredColumns = getFilteredColumns();
    const d = (name: string) => getColumnDisplayName(columns, name);
    useAttributeStore(); // Subscribe to changes

    const displayData = useMemo(() => getDisplayData(), [data, sampleIndices]);
    const displayIndices = useMemo(() => getDisplayIndices(), [data, sampleIndices]);

    // Get stored settings or defaults
    const storedSettings = getPlotSettings(plotId);

    const [selectedElements, setSelectedElementsLocal] = useState<string[]>(storedSettings.selectedElements || []);
    const [elementOrderId, setElementOrderIdLocal] = useState<string>(storedSettings.elementOrderId || 'custom');
    const [normalizationId, setNormalizationIdLocal] = useState<string>(storedSettings.normalizationId || 'none');
    const [controlsExpanded, setControlsExpandedLocal] = useState<boolean>(storedSettings.controlsExpanded ?? true);

    // Wrapper functions to persist settings
    const setSelectedElements = (elements: string[]) => {
        setSelectedElementsLocal(elements);
        updatePlotSettings(plotId, { selectedElements: elements });
    };
    const setElementOrderId = (orderId: string) => {
        setElementOrderIdLocal(orderId);
        updatePlotSettings(plotId, { elementOrderId: orderId });
    };
    const setNormalizationId = (normId: string) => {
        setNormalizationIdLocal(normId);
        updatePlotSettings(plotId, { normalizationId: normId });
    };
    const setControlsExpanded = (expanded: boolean) => {
        setControlsExpandedLocal(expanded);
        updatePlotSettings(plotId, { controlsExpanded: expanded });
    };

    const rangesRef = useRef<AxisRanges>({});

    const handleRelayout = useCallback((event: any) => {
        if (event['yaxis.range[0]'] !== undefined || event['yaxis.range'] !== undefined) {
            const yRange = event['yaxis.range'] || [event['yaxis.range[0]'], event['yaxis.range[1]']];
            rangesRef.current = { yRange: yRange as [number, number] };
        }
        if (event['yaxis.autorange']) {
            rangesRef.current = {};
        }
    }, []);

    const numericColumns = useMemo(() =>
        sortColumnsByPriority(
            filteredColumns.filter(c => c && c.name && (c.type === 'numeric' || c.type === 'float' || c.type === 'integer'))
        ),
        [columns]
    );
    const columnNames = useMemo(() => numericColumns.map(c => c.name), [numericColumns]);

    // Get current element order
    const currentOrder = useMemo(() => {
        if (elementOrderId === 'custom') return null;
        return ELEMENT_ORDERS.find(o => o.id === elementOrderId) || null;
    }, [elementOrderId]);

    // Get matched columns for current order (prefer geochem mappings)
    const matchedColumns = useMemo(() => {
        if (!currentOrder) return {};
        return findMatchingColumns(columnNames, currentOrder, geochemMappings.length > 0 ? geochemMappings : undefined);
    }, [currentOrder, columnNames, geochemMappings]);

    // Get normalization values
    const normalization = useMemo(() => {
        return NORMALIZATION_VALUES.find(n => n.id === normalizationId);
    }, [normalizationId]);

    // Auto-apply element ordering when changed
    useEffect(() => {
        if (elementOrderId !== 'custom' && currentOrder) {
            const orderedColumns = currentOrder.elements
                .filter(el => matchedColumns[el])
                .map(el => matchedColumns[el]);
            if (orderedColumns.length > 0) {
                setSelectedElements(orderedColumns);
            }
        }
    }, [elementOrderId, currentOrder, matchedColumns]);

    // Get the display labels (element symbols when using standard order, aliases in custom mode)
    const getDisplayLabels = (colNames: string[]): string[] => {
        if (elementOrderId === 'custom' || !currentOrder) {
            return colNames.map(col => d(col));
        }
        // Map column names back to element symbols
        const columnToElement: Record<string, string> = {};
        for (const [element, column] of Object.entries(matchedColumns)) {
            columnToElement[column] = element;
        }
        return colNames.map(col => columnToElement[col] || col);
    };

    // Apply normalization to values
    const normalizeValue = (element: string, value: number): number => {
        if (!normalization || normalizationId === 'none') return value;

        // Find the element symbol for this column
        let elementSymbol = element;
        if (currentOrder) {
            for (const [el, col] of Object.entries(matchedColumns)) {
                if (col === element) {
                    elementSymbol = el;
                    break;
                }
            }
        }

        const normValue = normalization.values[elementSymbol];
        if (normValue && normValue > 0) {
            return value / normValue;
        }
        return value;
    };

    // Handle auto-match button
    const handleAutoMatch = () => {
        if (currentOrder) {
            const orderedColumns = currentOrder.elements
                .filter(el => matchedColumns[el])
                .map(el => matchedColumns[el]);
            if (orderedColumns.length > 0) {
                setSelectedElements(orderedColumns);
            }
        }
    };

    const displayLabels = useMemo(() => getDisplayLabels(selectedElements), [selectedElements, elementOrderId, matchedColumns]);

    const plotData = useMemo(() => {
        if (!displayData.length || selectedElements.length === 0) return [];

        // Get styles from attribute store (includes emphasis calculations)
        const styleArrays = getStyleArrays(displayData, displayIndices ?? undefined);

        // Get sorted indices for z-ordering (low-grade first, high-grade last/on top)
        const sortedIndices = getSortedIndices(styleArrays);

        // Limit to first 100 visible samples for performance
        const limitedIndices = sortedIndices.slice(0, 100);

        // Create traces in sorted order (low grade first, high grade last/on top)
        const traces: any[] = limitedIndices.map((idx) => {
            const sampleColor = styleArrays.colors[idx];
            const sampleSize = styleArrays.sizes[idx];
            const sampleOpacity = styleArrays.opacity[idx];
            const colorWithOpacity = applyOpacityToColor(sampleColor, sampleOpacity * 0.8);
            const originalIdx = displayIndices ? displayIndices[idx] : idx;
            const hoverText = buildSpiderHoverText(data, originalIdx);

            // Apply normalization to values
            const yValues = selectedElements.map(el => {
                const rawValue = displayData[idx][el];
                if (rawValue == null || isNaN(rawValue)) return null;
                return normalizeValue(el, rawValue);
            });

            return {
                type: 'scatter',
                mode: 'lines+markers',
                x: displayLabels,
                y: yValues,
                name: hoverText,
                hoverinfo: 'name+x+y',
                line: {
                    color: colorWithOpacity,
                    width: Math.max(1, sampleSize / 6)
                },
                marker: {
                    color: colorWithOpacity,
                    size: sampleSize
                },
                opacity: sampleOpacity * 0.6,
                showlegend: false
            };
        });

        return traces;
    }, [data, displayData, displayIndices, selectedElements, displayLabels, normalizationId, normalization, matchedColumns]);

    // Calculate matched element count for display
    const matchedCount = currentOrder ? Object.keys(matchedColumns).length : 0;
    const totalElements = currentOrder ? currentOrder.elements.length : 0;

    // Get Y-axis title based on normalization
    const yAxisTitle = normalizationId === 'none'
        ? 'Concentration'
        : `Sample / ${normalization?.name || 'Normalized'}`;

    return (
        <Box sx={{ p: 2 }}>
            {/* Header with collapse toggle */}
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                <Typography variant="h6">Spider Plot (Multi-Element)</Typography>
                <IconButton onClick={() => setControlsExpanded(!controlsExpanded)} size="small">
                    {controlsExpanded ? <ExpandLess /> : <ExpandMore />}
                </IconButton>
            </Box>

            <Collapse in={controlsExpanded}>
                {/* Element ordering and normalization controls */}
                <Box sx={{ mb: 2, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                    <FormControl sx={{ minWidth: 200 }}>
                        <InputLabel size="small">Element Order</InputLabel>
                        <Select
                            value={elementOrderId}
                            onChange={(e) => setElementOrderId(e.target.value)}
                            label="Element Order"
                            size="small"
                        >
                            <MenuItem value="custom">Custom (Manual)</MenuItem>
                            {ELEMENT_ORDERS.map((order) => (
                                <MenuItem key={order.id} value={order.id}>
                                    <Tooltip title={order.description} placement="right">
                                        <span>{order.name}</span>
                                    </Tooltip>
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>

                    <FormControl sx={{ minWidth: 250 }}>
                        <InputLabel size="small">Normalization</InputLabel>
                        <Select
                            value={normalizationId}
                            onChange={(e) => setNormalizationId(e.target.value)}
                            label="Normalization"
                            size="small"
                        >
                            {NORMALIZATION_VALUES.map((norm) => (
                                <MenuItem key={norm.id} value={norm.id}>
                                    <Tooltip title={norm.reference || 'Raw values'} placement="right">
                                        <span>{norm.name}</span>
                                    </Tooltip>
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>

                    {elementOrderId !== 'custom' && currentOrder && (
                        <Tooltip title="Auto-match columns to element order">
                            <IconButton onClick={handleAutoMatch} color="primary" size="small">
                                <AutoFixHigh />
                            </IconButton>
                        </Tooltip>
                    )}
                </Box>

                {/* Matched elements indicator */}
                {elementOrderId !== 'custom' && currentOrder && (
                    <Box sx={{ mb: 2 }}>
                        <Typography variant="caption" color="text.secondary">
                            Matched: {matchedCount} / {totalElements} elements
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.5 }}>
                            {currentOrder.elements.slice(0, 20).map((el) => (
                                <Chip
                                    key={el}
                                    label={el}
                                    size="small"
                                    variant={matchedColumns[el] ? 'filled' : 'outlined'}
                                    color={matchedColumns[el] ? 'primary' : 'default'}
                                    sx={{ opacity: matchedColumns[el] ? 1 : 0.5 }}
                                />
                            ))}
                            {currentOrder.elements.length > 20 && (
                                <Chip label={`+${currentOrder.elements.length - 20} more`} size="small" variant="outlined" />
                            )}
                        </Box>
                    </Box>
                )}

                {/* Column selector (always visible for custom, optional for standard orders) */}
                <Box sx={{ mb: 3 }}>
                    <MultiColumnSelector
                        columns={numericColumns}
                        selectedColumns={selectedElements}
                        onChange={setSelectedElements}
                        label={elementOrderId === 'custom' ? 'Select Elements' : 'Selected Elements (auto-matched)'}
                    />
                </Box>
            </Collapse>

            {selectedElements.length === 0 ? (
                <Typography color="text.secondary">Select elements to display spider plot</Typography>
            ) : (
                <Paper sx={{ p: 2 }}>
                    <ExpandablePlotWrapper>
                        <Plot
                            data={plotData}
                            layout={{
                                title: { text: normalizationId !== 'none' ? `Spider Plot - ${normalization?.name}` : 'Spider Plot', font: { size: EXPORT_FONT_SIZES.title }, x: 0, xanchor: 'left' },
                                autosize: true,
                                height: 500,
                                font: { size: EXPORT_FONT_SIZES.tickLabels },
                                margin: { l: 70, r: 40, t: 60, b: 70 },
                                xaxis: { title: { text: 'Elements', font: { size: EXPORT_FONT_SIZES.axisTitle } }, tickfont: { size: EXPORT_FONT_SIZES.tickLabels } },
                                yaxis: {
                                    title: { text: yAxisTitle, font: { size: EXPORT_FONT_SIZES.axisTitle } },
                                    tickfont: { size: EXPORT_FONT_SIZES.tickLabels },
                                    type: 'log',
                                    ...(lockAxes && rangesRef.current.yRange
                                        ? { range: rangesRef.current.yRange, autorange: false }
                                        : { autorange: true })
                                },
                                hovermode: 'closest',
                                showlegend: false,
                                uirevision: lockAxes ? 'locked' : Date.now()
                            }}
                            config={getPlotConfig({ filename: `spider_${normalization}` })}
                            useResizeHandler={true}
                            style={{ width: '100%' }}
                            onRelayout={handleRelayout}
                        />
                    </ExpandablePlotWrapper>
                </Paper>
            )}
        </Box>
    );
};
