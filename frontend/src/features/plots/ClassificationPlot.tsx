import React, { useState, useMemo, useCallback } from 'react';
import Plot from 'react-plotly.js';
import {
    Box, Paper, Typography, FormControl, InputLabel, Select, MenuItem,
    TextField, Switch, FormControlLabel, Divider,
    ToggleButtonGroup, ToggleButton, Dialog, DialogTitle, DialogContent,
    List, ListItemButton, ListItemText, ListItemIcon, Grid, Chip, IconButton,
    InputAdornment, Button
} from '@mui/material';
import {
    Palette, TextFields, GridOn, Search, Close, Category,
    ScatterPlot as ScatterIcon, ChangeHistory, FolderOpen
} from '@mui/icons-material';
import { useAppStore } from '../../store/appStore';
import { useClassificationStore, TOTAL_DIAGRAMS } from '../../store/classificationStore';
import {
    xmlCartesianToTernary,
    calculatePolygonCentroid,
    calculatePolygonArea,
    shouldUseExternalLabel
} from '../../types/classificationDiagram';
import { getStyleArrays, shapeToPlotlySymbol, applyOpacityToColor, getSortedIndices, sortColumnsByPriority } from '../../utils/attributeUtils';
import { buildCustomData, buildTernaryHoverTemplate, buildScatterHoverTemplate } from '../../utils/tooltipUtils';

interface ClassificationPlotProps {
    plotId: string;
}

// Helper to format multi-line labels
function formatLabelMultiline(name: string, area: number): string {
    let maxWidth = 12;
    if (area < 30) maxWidth = 8;
    else if (area < 50) maxWidth = 10;
    else if (area < 80) maxWidth = 12;
    else maxWidth = 16;

    if (name.length <= maxWidth && !name.includes('/')) return name;

    // Handle slashes
    if (name.includes('/')) {
        const parts = name.split('/');
        if (parts.every(p => p.trim().length <= maxWidth)) {
            return parts.map(p => p.trim()).join('<br>');
        }
    }

    if (!name.includes(' ')) return name;

    // Wrap on spaces
    const words = name.split(' ');
    const lines: string[] = [];
    let currentLine: string[] = [];
    let currentLen = 0;

    for (const word of words) {
        if (currentLen + word.length + (currentLine.length ? 1 : 0) > maxWidth) {
            if (currentLine.length) {
                lines.push(currentLine.join(' '));
                currentLine = [word];
                currentLen = word.length;
            } else {
                lines.push(word);
                currentLen = 0;
            }
        } else {
            currentLine.push(word);
            currentLen += word.length + (currentLine.length > 1 ? 1 : 0);
        }
    }
    if (currentLine.length) lines.push(currentLine.join(' '));

    return lines.join('<br>');
}

// Get font size based on area and name length
function getFontSize(name: string, area: number, baseSize: number = 7): number {
    let size = baseSize;
    if (name.length > 18) size -= 1.5;
    else if (name.length > 14) size -= 1;
    else if (name.length > 10) size -= 0.5;

    if (area < 20) size -= 1.5;
    else if (area < 40) size -= 1;
    else if (area < 70) size -= 0.5;

    return Math.max(size, 4.5);
}

export const ClassificationPlot: React.FC<ClassificationPlotProps> = ({ plotId }) => {
    const { data, getPlotSettings, updatePlotSettings, getFilteredColumns } = useAppStore();
    const filteredColumns = getFilteredColumns();
    const {
        diagrams, renderOptions, categories,
        setSelectedDiagram, setRenderOptions, getSelectedDiagram
    } = useClassificationStore();

    // Get stored settings
    const storedSettings = getPlotSettings(plotId);

    // Local state for axis mappings
    const [axisA, setAxisA] = useState<string>(storedSettings.axisA || '');
    const [axisB, setAxisB] = useState<string>(storedSettings.axisB || '');
    const [axisC, setAxisC] = useState<string>(storedSettings.axisC || '');
    const [axisX, setAxisX] = useState<string>(storedSettings.axisX || '');
    const [axisY, setAxisY] = useState<string>(storedSettings.axisY || '');

    // Dialog state
    const [selectorOpen, setSelectorOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

    const selectedDiagram = getSelectedDiagram();

    // Filter diagrams based on search and category
    const filteredDiagrams = useMemo(() => {
        let filtered = diagrams;

        if (selectedCategory) {
            filtered = filtered.filter(d => d.category === selectedCategory);
        }

        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            filtered = filtered.filter(d =>
                d.name.toLowerCase().includes(query) ||
                d.category.toLowerCase().includes(query) ||
                (d.subCategory && d.subCategory.toLowerCase().includes(query))
            );
        }

        return filtered;
    }, [diagrams, selectedCategory, searchQuery]);

    // Group diagrams by category for display
    const diagramsByCategory = useMemo(() => {
        const grouped: Record<string, typeof diagrams> = {};
        for (const diagram of filteredDiagrams) {
            if (!grouped[diagram.category]) {
                grouped[diagram.category] = [];
            }
            grouped[diagram.category].push(diagram);
        }
        return grouped;
    }, [filteredDiagrams]);

    // Category counts
    const categoryCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        for (const diagram of diagrams) {
            counts[diagram.category] = (counts[diagram.category] || 0) + 1;
        }
        return counts;
    }, [diagrams]);

    const handleSelectDiagram = (diagramId: string) => {
        setSelectedDiagram(diagramId);
        setSelectorOpen(false);
    };

    const numericColumns = useMemo(() =>
        sortColumnsByPriority(
            filteredColumns.filter(c => c && c.name && (c.type === 'numeric' || c.type === 'float' || c.type === 'integer'))
        ),
        [filteredColumns]
    );

    // Persist axis selections
    const handleAxisChange = useCallback((axis: string, value: string) => {
        switch (axis) {
            case 'a': setAxisA(value); updatePlotSettings(plotId, { axisA: value }); break;
            case 'b': setAxisB(value); updatePlotSettings(plotId, { axisB: value }); break;
            case 'c': setAxisC(value); updatePlotSettings(plotId, { axisC: value }); break;
            case 'x': setAxisX(value); updatePlotSettings(plotId, { axisX: value }); break;
            case 'y': setAxisY(value); updatePlotSettings(plotId, { axisY: value }); break;
        }
    }, [plotId, updatePlotSettings]);

    // Build ternary classification plot
    const buildTernaryPlot = useCallback(() => {
        if (!selectedDiagram || selectedDiagram.type !== 'ternary') return null;
        if (!axisA || !axisB || !axisC) return null;

        const traces: any[] = [];
        const { style, showLabels, fillOpacity } = renderOptions;
        const isBW = style === 'bw';

        // Process polygons
        for (const poly of selectedDiagram.polygons) {
            if (!poly.points.length) continue;

            // Convert points to ternary
            const ternaryPoints = poly.points.map(p => xmlCartesianToTernary(p.x, p.y));

            // Close polygon
            const pts = [...ternaryPoints];
            if (pts[0].a !== pts[pts.length - 1].a ||
                pts[0].b !== pts[pts.length - 1].b) {
                pts.push(pts[0]);
            }

            const fillColor = isBW
                ? 'rgba(0,0,0,0)'
                : `rgba(${poly.color.r}, ${poly.color.g}, ${poly.color.b}, ${fillOpacity})`;
            const lineColor = isBW
                ? 'black'
                : `rgb(${Math.floor(poly.color.r * 0.6)}, ${Math.floor(poly.color.g * 0.6)}, ${Math.floor(poly.color.b * 0.6)})`;

            // Add polygon trace
            traces.push({
                type: 'scatterternary',
                mode: 'lines',
                a: pts.map(p => p.a),
                b: pts.map(p => p.b),
                c: pts.map(p => p.c),
                fill: isBW ? 'none' : 'toself',
                fillcolor: fillColor,
                line: { color: lineColor, width: isBW ? 1 : 1.2 },
                name: poly.name,
                showlegend: false,
                hoverinfo: 'name'
            });

            // Add label
            if (showLabels) {
                const centroid = calculatePolygonCentroid(ternaryPoints);
                const area = calculatePolygonArea(ternaryPoints);
                const useExternal = shouldUseExternalLabel(centroid, area, poly.name.length);

                let labelPos = centroid;
                if (useExternal) {
                    // Move label outside
                    const { a, b, c } = centroid;
                    if (b > c && b > 50) {
                        labelPos = { a: Math.max(a - 3, 0), b: Math.min(b + 8, 100), c: 100 - Math.max(a - 3, 0) - Math.min(b + 8, 100) };
                    } else if (c > b && c > 50) {
                        labelPos = { a: Math.max(a - 3, 0), b: 100 - Math.max(a - 3, 0) - Math.min(c + 8, 100), c: Math.min(c + 8, 100) };
                    } else {
                        labelPos = { a: Math.max(a - 8, -5), b, c };
                    }

                    // Add leader line
                    traces.push({
                        type: 'scatterternary',
                        mode: 'lines',
                        a: [labelPos.a, centroid.a],
                        b: [labelPos.b, centroid.b],
                        c: [labelPos.c, centroid.c],
                        line: { color: 'black', width: 0.8 },
                        showlegend: false,
                        hoverinfo: 'skip'
                    });
                }

                const fontSize = getFontSize(poly.name, area);
                const displayName = formatLabelMultiline(poly.name, useExternal ? area * 2 : area);

                traces.push({
                    type: 'scatterternary',
                    mode: 'text',
                    a: [labelPos.a],
                    b: [labelPos.b],
                    c: [labelPos.c],
                    text: [displayName],
                    textfont: { size: fontSize, color: 'black', family: 'Arial' },
                    showlegend: false,
                    hoverinfo: 'skip',
                    cliponaxis: false
                });
            }
        }

        // Add user data points
        if (renderOptions.showData && data.length > 0) {
            const styleArrays = getStyleArrays(data);
            const sortedIndices = getSortedIndices(styleArrays);

            const normalizedData: { a: number; b: number; c: number; idx: number }[] = [];

            for (const i of sortedIndices) {
                const d = data[i];
                const a = Number(d[axisA]) || 0;
                const b = Number(d[axisB]) || 0;
                const c = Number(d[axisC]) || 0;
                const sum = a + b + c;

                if (sum > 0) {
                    normalizedData.push({
                        a: (a / sum) * 100,
                        b: (b / sum) * 100,
                        c: (c / sum) * 100,
                        idx: i
                    });
                }
            }

            if (normalizedData.length > 0) {
                const dataIndices = normalizedData.map(d => d.idx);
                const customData = buildCustomData(data, dataIndices);

                traces.push({
                    type: 'scatterternary',
                    mode: 'markers',
                    a: normalizedData.map(d => d.a),
                    b: normalizedData.map(d => d.b),
                    c: normalizedData.map(d => d.c),
                    customdata: customData,
                    hovertemplate: buildTernaryHoverTemplate(axisA, axisB, axisC),
                    marker: {
                        size: normalizedData.map(d => styleArrays.sizes[d.idx]),
                        color: normalizedData.map(d => applyOpacityToColor(styleArrays.colors[d.idx], styleArrays.opacity[d.idx])),
                        symbol: normalizedData.map(d => shapeToPlotlySymbol(styleArrays.shapes[d.idx])),
                        line: { width: 0.5, color: 'white' }
                    },
                    name: 'Data',
                    showlegend: true
                });
            }
        }

        const layout: any = {
            title: { text: `<b>${selectedDiagram.name}</b>`, x: 0.5, font: { size: 14 } },
            autosize: true,
            height: 650,
            ternary: {
                sum: 100,
                aaxis: {
                    title: { text: `<b>${selectedDiagram.axes.a?.name || axisA}</b>`, font: { size: 12 } },
                    tickfont: { size: 10 },
                    min: 0,
                    linewidth: 2.5,
                    linecolor: 'black',
                    showgrid: renderOptions.showGrid,
                    gridcolor: 'rgba(0,0,0,0.15)'
                },
                baxis: {
                    title: { text: `<b>${selectedDiagram.axes.b?.name || axisB}</b>`, font: { size: 12 } },
                    tickfont: { size: 10 },
                    min: 0,
                    linewidth: 2.5,
                    linecolor: 'black',
                    showgrid: renderOptions.showGrid,
                    gridcolor: 'rgba(0,0,0,0.15)'
                },
                caxis: {
                    title: { text: `<b>${selectedDiagram.axes.c?.name || axisC}</b>`, font: { size: 12 } },
                    tickfont: { size: 10 },
                    min: 0,
                    linewidth: 2.5,
                    linecolor: 'black',
                    showgrid: renderOptions.showGrid,
                    gridcolor: 'rgba(0,0,0,0.15)'
                },
                bgcolor: 'white'
            },
            showlegend: renderOptions.showData && data.length > 0,
            paper_bgcolor: 'white',
            margin: { l: 70, r: 70, t: 80, b: 70 }
        };

        return { traces, layout };
    }, [selectedDiagram, axisA, axisB, axisC, data, renderOptions]);

    // Build XY classification plot
    const buildXYPlot = useCallback(() => {
        if (!selectedDiagram || selectedDiagram.type !== 'xy') return null;
        if (!axisX || !axisY) return null;

        const traces: any[] = [];
        const { style, showLabels, fillOpacity } = renderOptions;
        const isBW = style === 'bw';

        // Find bounds
        let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
        for (const poly of selectedDiagram.polygons) {
            for (const p of poly.points) {
                xMin = Math.min(xMin, p.x);
                xMax = Math.max(xMax, p.x);
                yMin = Math.min(yMin, p.y);
                yMax = Math.max(yMax, p.y);
            }
        }

        // Process polygons
        for (const poly of selectedDiagram.polygons) {
            if (!poly.points.length) continue;

            const pts = [...poly.points];
            if (pts[0].x !== pts[pts.length - 1].x || pts[0].y !== pts[pts.length - 1].y) {
                pts.push(pts[0]);
            }

            const fillColor = isBW
                ? 'rgba(0,0,0,0)'
                : `rgba(${poly.color.r}, ${poly.color.g}, ${poly.color.b}, ${fillOpacity})`;
            const lineColor = isBW
                ? 'black'
                : `rgb(${Math.floor(poly.color.r * 0.6)}, ${Math.floor(poly.color.g * 0.6)}, ${Math.floor(poly.color.b * 0.6)})`;

            traces.push({
                type: 'scatter',
                mode: 'lines',
                x: pts.map(p => p.x),
                y: pts.map(p => p.y),
                fill: isBW ? 'none' : 'toself',
                fillcolor: fillColor,
                line: { color: lineColor, width: isBW ? 1 : 1.2 },
                name: poly.name,
                showlegend: false,
                hoverinfo: 'name'
            });

            // Add label at labelPos if available
            if (showLabels && poly.labelPos) {
                traces.push({
                    type: 'scatter',
                    mode: 'text',
                    x: [poly.labelPos.x],
                    y: [poly.labelPos.y],
                    text: [poly.name],
                    textfont: { size: 8, color: 'black', family: 'Arial' },
                    showlegend: false,
                    hoverinfo: 'skip'
                });
            }
        }

        // Add user data points
        if (renderOptions.showData && data.length > 0) {
            const styleArrays = getStyleArrays(data);
            const sortedIndices = getSortedIndices(styleArrays);

            const validData: { x: number; y: number; idx: number }[] = [];

            for (const i of sortedIndices) {
                const d = data[i];
                const x = Number(d[axisX]);
                const y = Number(d[axisY]);

                if (!isNaN(x) && !isNaN(y)) {
                    validData.push({ x, y, idx: i });
                }
            }

            if (validData.length > 0) {
                const dataIndices = validData.map(d => d.idx);
                const customData = buildCustomData(data, dataIndices);

                traces.push({
                    type: 'scatter',
                    mode: 'markers',
                    x: validData.map(d => d.x),
                    y: validData.map(d => d.y),
                    customdata: customData,
                    hovertemplate: buildScatterHoverTemplate(axisX, axisY),
                    marker: {
                        size: validData.map(d => styleArrays.sizes[d.idx]),
                        color: validData.map(d => applyOpacityToColor(styleArrays.colors[d.idx], styleArrays.opacity[d.idx])),
                        symbol: validData.map(d => shapeToPlotlySymbol(styleArrays.shapes[d.idx])),
                        line: { width: 0.5, color: 'white' }
                    },
                    name: 'Data',
                    showlegend: true
                });
            }
        }

        const layout: any = {
            title: { text: `<b>${selectedDiagram.name}</b>`, x: 0.5, font: { size: 14 } },
            autosize: true,
            height: 550,
            xaxis: {
                title: { text: `<b>${selectedDiagram.axes.x?.name || axisX}</b>`, font: { size: 12 } },
                range: [xMin - 1, xMax + 1],
                showgrid: renderOptions.showGrid,
                gridcolor: 'rgba(0,0,0,0.12)',
                linewidth: 2,
                linecolor: 'black',
                showline: true,
                mirror: true
            },
            yaxis: {
                title: { text: `<b>${selectedDiagram.axes.y?.name || axisY}</b>`, font: { size: 12 } },
                range: [yMin - 0.5, yMax + 0.5],
                showgrid: renderOptions.showGrid,
                gridcolor: 'rgba(0,0,0,0.12)',
                linewidth: 2,
                linecolor: 'black',
                showline: true,
                mirror: true
            },
            showlegend: renderOptions.showData && data.length > 0,
            paper_bgcolor: 'white',
            plot_bgcolor: 'white',
            margin: { l: 70, r: 40, t: 60, b: 70 }
        };

        return { traces, layout };
    }, [selectedDiagram, axisX, axisY, data, renderOptions]);

    // Build the appropriate plot
    const plotData = selectedDiagram?.type === 'ternary' ? buildTernaryPlot() : buildXYPlot();

    return (
        <Box sx={{ p: 2 }}>
            {/* Diagram Selector */}
            <Paper sx={{ p: 2, mb: 2 }}>
                <Typography variant="subtitle1" gutterBottom fontWeight="bold">
                    Classification Diagram ({TOTAL_DIAGRAMS} available)
                </Typography>

                {/* Selected diagram display / selector button */}
                <Button
                    variant="outlined"
                    onClick={() => setSelectorOpen(true)}
                    fullWidth
                    sx={{
                        justifyContent: 'flex-start',
                        textTransform: 'none',
                        py: 1.5,
                        mb: 2,
                        borderColor: selectedDiagram ? 'primary.main' : 'grey.400'
                    }}
                    startIcon={selectedDiagram?.type === 'ternary' ? <ChangeHistory /> : <ScatterIcon />}
                >
                    {selectedDiagram ? (
                        <Box sx={{ textAlign: 'left' }}>
                            <Typography variant="body1" fontWeight="medium">
                                {selectedDiagram.name}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                                {selectedDiagram.category} • {selectedDiagram.type === 'ternary' ? 'Ternary' : 'XY'} diagram
                            </Typography>
                        </Box>
                    ) : (
                        <Typography color="text.secondary">
                            Click to select a classification diagram...
                        </Typography>
                    )}
                </Button>

                {/* Diagram Selector Dialog */}
                <Dialog
                    open={selectorOpen}
                    onClose={() => setSelectorOpen(false)}
                    maxWidth="md"
                    fullWidth
                    PaperProps={{ sx: { height: '70vh' } }}
                >
                    <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Category />
                            <Typography variant="h6">Select Classification Diagram</Typography>
                        </Box>
                        <IconButton onClick={() => setSelectorOpen(false)} size="small">
                            <Close />
                        </IconButton>
                    </DialogTitle>
                    <DialogContent dividers sx={{ p: 0 }}>
                        <Grid container sx={{ height: '100%' }}>
                            {/* Left panel - Categories */}
                            <Grid item xs={3} sx={{ borderRight: 1, borderColor: 'divider', height: '100%', overflow: 'auto' }}>
                                <Box sx={{ p: 1 }}>
                                    <TextField
                                        size="small"
                                        fullWidth
                                        placeholder="Search diagrams..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        InputProps={{
                                            startAdornment: (
                                                <InputAdornment position="start">
                                                    <Search fontSize="small" />
                                                </InputAdornment>
                                            ),
                                        }}
                                    />
                                </Box>
                                <Divider />
                                <List dense>
                                    <ListItemButton
                                        selected={selectedCategory === null}
                                        onClick={() => setSelectedCategory(null)}
                                    >
                                        <ListItemIcon sx={{ minWidth: 32 }}>
                                            <FolderOpen fontSize="small" />
                                        </ListItemIcon>
                                        <ListItemText primary="All Diagrams" />
                                        <Chip label={diagrams.length} size="small" />
                                    </ListItemButton>
                                    {categories.map(cat => (
                                        <ListItemButton
                                            key={cat}
                                            selected={selectedCategory === cat}
                                            onClick={() => setSelectedCategory(cat)}
                                        >
                                            <ListItemIcon sx={{ minWidth: 32 }}>
                                                <Category fontSize="small" />
                                            </ListItemIcon>
                                            <ListItemText
                                                primary={cat}
                                                primaryTypographyProps={{ variant: 'body2', noWrap: true }}
                                            />
                                            <Chip label={categoryCounts[cat] || 0} size="small" />
                                        </ListItemButton>
                                    ))}
                                </List>
                            </Grid>

                            {/* Right panel - Diagram list */}
                            <Grid item xs={9} sx={{ height: '100%', overflow: 'auto' }}>
                                <Box sx={{ p: 1 }}>
                                    <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                                        {filteredDiagrams.length} diagram{filteredDiagrams.length !== 1 ? 's' : ''} found
                                    </Typography>

                                    {selectedCategory === null && !searchQuery ? (
                                        // Show grouped by category
                                        Object.entries(diagramsByCategory).map(([category, categoryDiagrams]) => (
                                            <Box key={category} sx={{ mb: 2 }}>
                                                <Typography
                                                    variant="subtitle2"
                                                    sx={{
                                                        px: 1,
                                                        py: 0.5,
                                                        bgcolor: 'grey.100',
                                                        borderRadius: 1,
                                                        fontWeight: 'bold',
                                                        mb: 0.5
                                                    }}
                                                >
                                                    {category} ({categoryDiagrams.length})
                                                </Typography>
                                                <List dense disablePadding>
                                                    {categoryDiagrams.map(diagram => (
                                                        <ListItemButton
                                                            key={diagram.id}
                                                            onClick={() => handleSelectDiagram(diagram.id)}
                                                            selected={selectedDiagram?.id === diagram.id}
                                                            sx={{ pl: 2 }}
                                                        >
                                                            <ListItemIcon sx={{ minWidth: 28 }}>
                                                                {diagram.type === 'ternary' ? (
                                                                    <ChangeHistory fontSize="small" color="primary" />
                                                                ) : (
                                                                    <ScatterIcon fontSize="small" color="secondary" />
                                                                )}
                                                            </ListItemIcon>
                                                            <ListItemText
                                                                primary={diagram.name}
                                                                secondary={diagram.subCategory}
                                                                primaryTypographyProps={{ variant: 'body2' }}
                                                                secondaryTypographyProps={{ variant: 'caption' }}
                                                            />
                                                            <Chip
                                                                label={diagram.type}
                                                                size="small"
                                                                variant="outlined"
                                                                color={diagram.type === 'ternary' ? 'primary' : 'secondary'}
                                                                sx={{ fontSize: '0.65rem', height: 20 }}
                                                            />
                                                        </ListItemButton>
                                                    ))}
                                                </List>
                                            </Box>
                                        ))
                                    ) : (
                                        // Show flat list when filtering
                                        <List dense>
                                            {filteredDiagrams.map(diagram => (
                                                <ListItemButton
                                                    key={diagram.id}
                                                    onClick={() => handleSelectDiagram(diagram.id)}
                                                    selected={selectedDiagram?.id === diagram.id}
                                                >
                                                    <ListItemIcon sx={{ minWidth: 28 }}>
                                                        {diagram.type === 'ternary' ? (
                                                            <ChangeHistory fontSize="small" color="primary" />
                                                        ) : (
                                                            <ScatterIcon fontSize="small" color="secondary" />
                                                        )}
                                                    </ListItemIcon>
                                                    <ListItemText
                                                        primary={diagram.name}
                                                        secondary={`${diagram.category}${diagram.subCategory ? ' • ' + diagram.subCategory : ''}`}
                                                        primaryTypographyProps={{ variant: 'body2' }}
                                                        secondaryTypographyProps={{ variant: 'caption' }}
                                                    />
                                                    <Chip
                                                        label={diagram.type}
                                                        size="small"
                                                        variant="outlined"
                                                        color={diagram.type === 'ternary' ? 'primary' : 'secondary'}
                                                        sx={{ fontSize: '0.65rem', height: 20 }}
                                                    />
                                                </ListItemButton>
                                            ))}
                                        </List>
                                    )}
                                </Box>
                            </Grid>
                        </Grid>
                    </DialogContent>
                </Dialog>

                {selectedDiagram && (
                    <>
                        <Divider sx={{ my: 2 }} />

                        {/* Axis Mapping */}
                        <Typography variant="subtitle2" gutterBottom>
                            Map Data Columns to Diagram Axes
                        </Typography>

                        {selectedDiagram.type === 'ternary' ? (
                            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                                <FormControl size="small" sx={{ minWidth: 150 }}>
                                    <InputLabel>{selectedDiagram.axes.a?.name || 'A (Top)'}</InputLabel>
                                    <Select
                                        value={axisA}
                                        label={selectedDiagram.axes.a?.name || 'A (Top)'}
                                        onChange={(e) => handleAxisChange('a', e.target.value)}
                                    >
                                        <MenuItem value="">None</MenuItem>
                                        {numericColumns.map(c => (
                                            <MenuItem key={c.name} value={c.name}>{c.alias || c.name}</MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>
                                <FormControl size="small" sx={{ minWidth: 150 }}>
                                    <InputLabel>{selectedDiagram.axes.b?.name || 'B (Left)'}</InputLabel>
                                    <Select
                                        value={axisB}
                                        label={selectedDiagram.axes.b?.name || 'B (Left)'}
                                        onChange={(e) => handleAxisChange('b', e.target.value)}
                                    >
                                        <MenuItem value="">None</MenuItem>
                                        {numericColumns.map(c => (
                                            <MenuItem key={c.name} value={c.name}>{c.alias || c.name}</MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>
                                <FormControl size="small" sx={{ minWidth: 150 }}>
                                    <InputLabel>{selectedDiagram.axes.c?.name || 'C (Right)'}</InputLabel>
                                    <Select
                                        value={axisC}
                                        label={selectedDiagram.axes.c?.name || 'C (Right)'}
                                        onChange={(e) => handleAxisChange('c', e.target.value)}
                                    >
                                        <MenuItem value="">None</MenuItem>
                                        {numericColumns.map(c => (
                                            <MenuItem key={c.name} value={c.name}>{c.alias || c.name}</MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>
                            </Box>
                        ) : (
                            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                                <FormControl size="small" sx={{ minWidth: 150 }}>
                                    <InputLabel>{selectedDiagram.axes.x?.name || 'X Axis'}</InputLabel>
                                    <Select
                                        value={axisX}
                                        label={selectedDiagram.axes.x?.name || 'X Axis'}
                                        onChange={(e) => handleAxisChange('x', e.target.value)}
                                    >
                                        <MenuItem value="">None</MenuItem>
                                        {numericColumns.map(c => (
                                            <MenuItem key={c.name} value={c.name}>{c.alias || c.name}</MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>
                                <FormControl size="small" sx={{ minWidth: 150 }}>
                                    <InputLabel>{selectedDiagram.axes.y?.name || 'Y Axis'}</InputLabel>
                                    <Select
                                        value={axisY}
                                        label={selectedDiagram.axes.y?.name || 'Y Axis'}
                                        onChange={(e) => handleAxisChange('y', e.target.value)}
                                    >
                                        <MenuItem value="">None</MenuItem>
                                        {numericColumns.map(c => (
                                            <MenuItem key={c.name} value={c.name}>{c.alias || c.name}</MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>
                            </Box>
                        )}

                        <Divider sx={{ my: 2 }} />

                        {/* Render Options */}
                        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                            <ToggleButtonGroup
                                value={renderOptions.style}
                                exclusive
                                onChange={(_, v) => v && setRenderOptions({ style: v })}
                                size="small"
                            >
                                <ToggleButton value="color"><Palette fontSize="small" sx={{ mr: 0.5 }} />Color</ToggleButton>
                                <ToggleButton value="bw">B&W</ToggleButton>
                            </ToggleButtonGroup>

                            <FormControlLabel
                                control={
                                    <Switch
                                        checked={renderOptions.showLabels}
                                        onChange={(e) => setRenderOptions({ showLabels: e.target.checked })}
                                        size="small"
                                    />
                                }
                                label={<Typography variant="body2"><TextFields fontSize="small" sx={{ verticalAlign: 'middle', mr: 0.5 }} />Labels</Typography>}
                            />

                            <FormControlLabel
                                control={
                                    <Switch
                                        checked={renderOptions.showGrid}
                                        onChange={(e) => setRenderOptions({ showGrid: e.target.checked })}
                                        size="small"
                                    />
                                }
                                label={<Typography variant="body2"><GridOn fontSize="small" sx={{ verticalAlign: 'middle', mr: 0.5 }} />Grid</Typography>}
                            />

                            <FormControlLabel
                                control={
                                    <Switch
                                        checked={renderOptions.showData}
                                        onChange={(e) => setRenderOptions({ showData: e.target.checked })}
                                        size="small"
                                    />
                                }
                                label={<Typography variant="body2">Show Data</Typography>}
                            />
                        </Box>
                    </>
                )}
            </Paper>

            {/* Plot */}
            {plotData ? (
                <Paper sx={{ p: 1 }}>
                    <Plot
                        data={plotData.traces}
                        layout={plotData.layout}
                        config={{ responsive: true, displayModeBar: true }}
                        style={{ width: '100%' }}
                    />
                </Paper>
            ) : (
                <Paper sx={{ p: 4, textAlign: 'center' }}>
                    <Typography color="text.secondary">
                        {!selectedDiagram
                            ? 'Select a classification diagram to display'
                            : selectedDiagram.type === 'ternary'
                                ? 'Select columns for A, B, and C axes'
                                : 'Select columns for X and Y axes'}
                    </Typography>
                </Paper>
            )}
        </Box>
    );
};
