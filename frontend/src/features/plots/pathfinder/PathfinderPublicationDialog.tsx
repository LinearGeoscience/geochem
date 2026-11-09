/**
 * PathfinderPublicationDialog Component
 *
 * Dialog for configuring and exporting publication-quality pathfinder figures.
 */

import React, { useState, useRef, useCallback, useMemo } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Box,
    Typography,
    FormControl,
    FormControlLabel,
    FormLabel,
    RadioGroup,
    Radio,
    Checkbox,
    Select,
    MenuItem,
    InputLabel,
    TextField,
    Divider,
    CircularProgress,
    Alert,
    Slider
} from '@mui/material';
import { Download, Image, Code, Satellite, Science } from '@mui/icons-material';
import { PublicationFigure, PublicationFigureConfig, getOptimalColumns, BasemapConfig, MineralisationConfig } from './PublicationFigure';
import { type PathfinderElement } from '../../../utils/calculations/pathfinderConstants';
import { MapViewStyle } from '../../../utils/basemapUtils';

interface PathfinderPublicationDialogProps {
    open: boolean;
    onClose: () => void;
    elements: PathfinderElement[];
    data: any[];
    xAxis: string;
    yAxis: string;
    getElementColumn: (element: PathfinderElement) => string | null;
    // Basemap settings from parent
    mapViewStyle?: MapViewStyle;
    basemapOpacity?: number;
    transformedCoords?: {
        lats: number[];
        lons: number[];
        center: { lat: number; lon: number };
        zoom: number;
    } | null;
}

type TargetFormat = 'word' | 'powerpoint' | 'custom';

// Preset dimensions in mm
const PRESETS = {
    word: {
        portrait: { width: 165, label: 'Word/Report (A4 Portrait, 165mm)' },
        landscape: { width: 260, label: 'Word/Report (A4 Landscape, 260mm)' }
    },
    powerpoint: {
        portrait: { width: 320, label: 'PowerPoint (16:9, 320mm)' },
        landscape: { width: 320, label: 'PowerPoint (16:9, 320mm)' }
    }
};

export const PathfinderPublicationDialog: React.FC<PathfinderPublicationDialogProps> = ({
    open,
    onClose,
    elements,
    data,
    xAxis,
    yAxis,
    getElementColumn,
    mapViewStyle = 'normal',
    basemapOpacity = 0.7,
    transformedCoords = null
}) => {
    // Configuration state
    const [targetFormat, setTargetFormat] = useState<TargetFormat>('word');
    const [customWidth, setCustomWidth] = useState(165);
    const [columns, setColumns] = useState<number | 'auto'>('auto');
    const [showScaleBar, setShowScaleBar] = useState(true);
    const [showNorthArrow, setShowNorthArrow] = useState(true);
    const [showCoordinateGrid, setShowCoordinateGrid] = useState(true);
    const [showProbabilityPlots, setShowProbabilityPlots] = useState(true);
    const [useBasemap, setUseBasemap] = useState(mapViewStyle !== 'normal' && transformedCoords !== null);
    const [pubBasemapOpacity, setPubBasemapOpacity] = useState(basemapOpacity);
    const [landscape, setLandscape] = useState(false);
    const [maxRowsPerPage, setMaxRowsPerPage] = useState(2);
    const [exportPNG, setExportPNG] = useState(true);
    const [exportSVG, setExportSVG] = useState(true);
    const [exportDPI, setExportDPI] = useState(300);

    // Mineralisation state - uses attribute manager styling
    const [includeMineralisation, setIncludeMineralisation] = useState(false);
    const [mineralisationColumn, setMineralisationColumn] = useState<string>('');
    const [mineralisationName, setMineralisationName] = useState('Au');
    const [mineralisationUnit, setMineralisationUnit] = useState('ppm');

    // Get available numeric columns for mineralisation
    const numericColumns = useMemo(() => {
        if (!data || data.length === 0) return [];
        const firstRow = data[0];
        return Object.keys(firstRow).filter(key => {
            const val = firstRow[key];
            return typeof val === 'number' || (typeof val === 'string' && !isNaN(parseFloat(val)));
        }).sort();
    }, [data]);

    // Export state
    const [isExporting, setIsExporting] = useState(false);
    const [exportError, setExportError] = useState<string | null>(null);

    const figureRef = useRef<HTMLDivElement>(null);

    // Check if basemap is available
    const basemapAvailable = mapViewStyle !== 'normal' && transformedCoords !== null;

    // Calculate effective settings based on orientation
    const orientation = landscape ? 'landscape' : 'portrait';
    const effectiveWidth = targetFormat === 'custom' ? customWidth :
        PRESETS[targetFormat][orientation].width;
    const effectiveColumns = columns === 'auto' ? getOptimalColumns(elements.length) : columns;

    // Build basemap config
    const basemapConfig: BasemapConfig = useMemo(() => ({
        enabled: useBasemap && basemapAvailable,
        style: mapViewStyle,
        opacity: pubBasemapOpacity,
        transformedCoords: transformedCoords
    }), [useBasemap, basemapAvailable, mapViewStyle, pubBasemapOpacity, transformedCoords]);

    // Build mineralisation config - uses attribute manager styling
    const mineralisationConfig: MineralisationConfig | undefined = useMemo(() => {
        if (!includeMineralisation || !mineralisationColumn) return undefined;
        return {
            enabled: true,
            column: mineralisationColumn,
            displayName: mineralisationName,
            unit: mineralisationUnit
        };
    }, [includeMineralisation, mineralisationColumn, mineralisationName, mineralisationUnit]);

    // Build config
    const config: PublicationFigureConfig = useMemo(() => ({
        elements,
        columns: effectiveColumns,
        widthMm: effectiveWidth,
        showScaleBar,
        showNorthArrow,
        showCoordinateGrid,
        showProbabilityPlots,
        basemap: basemapConfig,
        landscape,
        maxRowsPerPage,
        mineralisation: mineralisationConfig
    }), [elements, effectiveColumns, effectiveWidth, showScaleBar, showNorthArrow, showCoordinateGrid, showProbabilityPlots, basemapConfig, landscape, maxRowsPerPage, mineralisationConfig]);

    // Preview scale (fit in dialog)
    const previewScale = useMemo(() => {
        const maxPreviewWidth = 600; // pixels
        const figureWidthPx = (effectiveWidth / 25.4) * 96; // at 96 DPI
        return Math.min(1, maxPreviewWidth / figureWidthPx);
    }, [effectiveWidth]);

    // Export handler - exports each page as a separate file
    const handleExport = useCallback(async () => {
        if (!figureRef.current) return;

        setIsExporting(true);
        setExportError(null);

        try {
            const { toPng, toSvg } = await import('html-to-image');
            const timestamp = new Date().toISOString().slice(0, 10);
            const elementStr = elements.slice(0, 4).join('-') + (elements.length > 4 ? `-etc` : '');

            // Find all pages within the figure
            const pages = figureRef.current.querySelectorAll('[data-publication-page]');
            const totalPages = pages.length;

            // Helper to add delay between downloads (browsers may block rapid downloads)
            const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

            // Export each page separately
            for (let i = 0; i < totalPages; i++) {
                const page = pages[i] as HTMLElement;
                const pageNum = i + 1;
                const pageSuffix = totalPages > 1 ? `_page${pageNum}` : '';

                // Export PNG
                if (exportPNG) {
                    const pixelRatio = exportDPI / 96;

                    const pngDataUrl = await toPng(page, {
                        backgroundColor: '#ffffff',
                        pixelRatio: pixelRatio,
                        style: {
                            transform: 'scale(1)',
                            transformOrigin: 'top left'
                        }
                    });

                    const pngLink = document.createElement('a');
                    pngLink.download = `pathfinder_${elementStr}${pageSuffix}_${timestamp}.png`;
                    pngLink.href = pngDataUrl;
                    pngLink.click();

                    // Small delay to prevent browser from blocking multiple downloads
                    if (i < totalPages - 1 || exportSVG) {
                        await delay(300);
                    }
                }

                // Export SVG
                if (exportSVG) {
                    const svgDataUrl = await toSvg(page, {
                        backgroundColor: '#ffffff'
                    });

                    const svgLink = document.createElement('a');
                    svgLink.download = `pathfinder_${elementStr}${pageSuffix}_${timestamp}.svg`;
                    svgLink.href = svgDataUrl;
                    svgLink.click();

                    // Small delay between downloads
                    if (i < totalPages - 1) {
                        await delay(300);
                    }
                }
            }

            // Close dialog on success
            onClose();
        } catch (err) {
            console.error('Export failed:', err);
            setExportError('Export failed. Please try again or adjust settings.');
        } finally {
            setIsExporting(false);
        }
    }, [elements, exportPNG, exportSVG, exportDPI, onClose]);

    return (
        <Dialog
            open={open}
            onClose={onClose}
            maxWidth="lg"
            fullWidth
            PaperProps={{ sx: { maxHeight: '90vh' } }}
        >
            <DialogTitle>
                Export Publication Figure
                <Typography variant="body2" color="text.secondary">
                    Generate a publication-ready figure with {elements.length} pathfinder element{elements.length !== 1 ? 's' : ''}
                </Typography>
            </DialogTitle>

            <DialogContent dividers>
                <Box sx={{ display: 'flex', gap: 3 }}>
                    {/* Settings Panel */}
                    <Box sx={{ width: 280, flexShrink: 0 }}>
                        {/* Target Format */}
                        <FormControl component="fieldset" sx={{ mb: 2 }}>
                            <FormLabel component="legend">Target Format</FormLabel>
                            <RadioGroup
                                value={targetFormat}
                                onChange={(e) => setTargetFormat(e.target.value as TargetFormat)}
                            >
                                <FormControlLabel
                                    value="word"
                                    control={<Radio size="small" />}
                                    label={PRESETS.word[orientation].label}
                                />
                                <FormControlLabel
                                    value="powerpoint"
                                    control={<Radio size="small" />}
                                    label={PRESETS.powerpoint[orientation].label}
                                />
                                <FormControlLabel
                                    value="custom"
                                    control={<Radio size="small" />}
                                    label="Custom dimensions"
                                />
                            </RadioGroup>
                        </FormControl>

                        {targetFormat === 'custom' && (
                            <TextField
                                label="Width (mm)"
                                type="number"
                                size="small"
                                value={customWidth}
                                onChange={(e) => setCustomWidth(Number(e.target.value))}
                                sx={{ mb: 2, width: '100%' }}
                                inputProps={{ min: 100, max: 500 }}
                            />
                        )}

                        {/* Grid Columns */}
                        <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                            <InputLabel>Grid Columns</InputLabel>
                            <Select
                                value={columns}
                                onChange={(e) => setColumns(e.target.value as number | 'auto')}
                                label="Grid Columns"
                            >
                                <MenuItem value="auto">Auto ({getOptimalColumns(elements.length)} columns)</MenuItem>
                                <MenuItem value={2}>2 columns</MenuItem>
                                <MenuItem value={3}>3 columns</MenuItem>
                                <MenuItem value={4}>4 columns</MenuItem>
                            </Select>
                        </FormControl>

                        {/* Max Rows Per Page */}
                        <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                            <InputLabel>Rows Per Page</InputLabel>
                            <Select
                                value={maxRowsPerPage}
                                onChange={(e) => setMaxRowsPerPage(e.target.value as number)}
                                label="Rows Per Page"
                            >
                                <MenuItem value={1}>1 row (split more)</MenuItem>
                                <MenuItem value={2}>2 rows</MenuItem>
                                <MenuItem value={3}>3 rows</MenuItem>
                                <MenuItem value={4}>4 rows (fewer pages)</MenuItem>
                            </Select>
                        </FormControl>

                        <Divider sx={{ my: 2 }} />

                        {/* Mineralisation Options */}
                        <Typography variant="subtitle2" gutterBottom>Mineralisation Map</Typography>

                        <FormControlLabel
                            control={
                                <Checkbox
                                    checked={includeMineralisation}
                                    onChange={(e) => setIncludeMineralisation(e.target.checked)}
                                    size="small"
                                />
                            }
                            label={
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    <Science fontSize="small" color={includeMineralisation ? 'primary' : 'inherit'} />
                                    <span>Include mineralisation map</span>
                                </Box>
                            }
                        />
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 4, mb: 1 }}>
                            Shows selected element as first cell with classified coloring
                        </Typography>

                        {includeMineralisation && (
                            <Box sx={{ ml: 2, mb: 1 }}>
                                {/* Column Selection */}
                                <FormControl fullWidth size="small" sx={{ mb: 1 }}>
                                    <InputLabel>Element Column</InputLabel>
                                    <Select
                                        value={mineralisationColumn}
                                        onChange={(e) => {
                                            setMineralisationColumn(e.target.value);
                                            // Auto-set name from column
                                            const col = e.target.value;
                                            const name = col.replace(/_ppm|_ppb|_%/gi, '').replace(/_/g, ' ').trim();
                                            setMineralisationName(name);
                                            // Auto-detect unit
                                            if (col.toLowerCase().includes('ppm')) setMineralisationUnit('ppm');
                                            else if (col.toLowerCase().includes('ppb')) setMineralisationUnit('ppb');
                                            else if (col.includes('%')) setMineralisationUnit('%');
                                        }}
                                        label="Element Column"
                                    >
                                        {numericColumns.map(col => (
                                            <MenuItem key={col} value={col}>{col}</MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>

                                {/* Display Name */}
                                <TextField
                                    label="Display Name"
                                    size="small"
                                    value={mineralisationName}
                                    onChange={(e) => setMineralisationName(e.target.value)}
                                    sx={{ mb: 1, width: '48%', mr: '4%' }}
                                />
                                <TextField
                                    label="Unit"
                                    size="small"
                                    value={mineralisationUnit}
                                    onChange={(e) => setMineralisationUnit(e.target.value)}
                                    sx={{ mb: 1, width: '48%' }}
                                />

                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontStyle: 'italic' }}>
                                    Uses styling from Attribute Manager
                                </Typography>
                            </Box>
                        )}

                        <Divider sx={{ my: 2 }} />

                        {/* Map Options */}
                        <Typography variant="subtitle2" gutterBottom>Map Options</Typography>

                        {/* Basemap toggle */}
                        <FormControlLabel
                            control={
                                <Checkbox
                                    checked={useBasemap && basemapAvailable}
                                    onChange={(e) => setUseBasemap(e.target.checked)}
                                    size="small"
                                    disabled={!basemapAvailable}
                                />
                            }
                            label={
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    <Satellite fontSize="small" color={basemapAvailable ? 'primary' : 'disabled'} />
                                    <span>Include basemap ({mapViewStyle})</span>
                                </Box>
                            }
                        />
                        {!basemapAvailable && (
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 4, mb: 1 }}>
                                Enable a basemap in the main view first
                            </Typography>
                        )}
                        {useBasemap && basemapAvailable && (
                            <Box sx={{ ml: 4, mb: 1, width: 180 }}>
                                <Typography variant="caption" color="text.secondary">
                                    Basemap Opacity
                                </Typography>
                                <Slider
                                    value={pubBasemapOpacity}
                                    onChange={(_, v) => setPubBasemapOpacity(v as number)}
                                    min={0.1}
                                    max={1}
                                    step={0.1}
                                    size="small"
                                    valueLabelDisplay="auto"
                                    valueLabelFormat={(v) => `${Math.round(v * 100)}%`}
                                />
                            </Box>
                        )}

                        <FormControlLabel
                            control={<Checkbox checked={showScaleBar} onChange={(e) => setShowScaleBar(e.target.checked)} size="small" />}
                            label="Show scale bar"
                        />
                        <FormControlLabel
                            control={<Checkbox checked={showNorthArrow} onChange={(e) => setShowNorthArrow(e.target.checked)} size="small" />}
                            label="Show north arrow"
                        />
                        <FormControlLabel
                            control={
                                <Checkbox
                                    checked={showCoordinateGrid}
                                    onChange={(e) => setShowCoordinateGrid(e.target.checked)}
                                    size="small"
                                />
                            }
                            label="Show coordinate ticks (E/N)"
                        />
                        <FormControlLabel
                            control={<Checkbox checked={showProbabilityPlots} onChange={(e) => setShowProbabilityPlots(e.target.checked)} size="small" />}
                            label="Show probability plots"
                        />
                        <FormControlLabel
                            control={<Checkbox checked={landscape} onChange={(e) => setLandscape(e.target.checked)} size="small" />}
                            label="Landscape orientation"
                        />

                        <Divider sx={{ my: 2 }} />

                        {/* Export Format */}
                        <Typography variant="subtitle2" gutterBottom>Export Format</Typography>
                        <FormControlLabel
                            control={<Checkbox checked={exportPNG} onChange={(e) => setExportPNG(e.target.checked)} size="small" />}
                            label={
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    <Image fontSize="small" />
                                    <span>PNG (raster)</span>
                                </Box>
                            }
                        />
                        <FormControlLabel
                            control={<Checkbox checked={exportSVG} onChange={(e) => setExportSVG(e.target.checked)} size="small" />}
                            label={
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    <Code fontSize="small" />
                                    <span>SVG (vector)</span>
                                </Box>
                            }
                        />

                        {exportPNG && (
                            <Box sx={{ mt: 1, pl: 2 }}>
                                <Typography variant="caption" color="text.secondary">
                                    PNG Resolution (DPI)
                                </Typography>
                                <Slider
                                    value={exportDPI}
                                    onChange={(_, v) => setExportDPI(v as number)}
                                    min={150}
                                    max={600}
                                    step={50}
                                    marks={[
                                        { value: 150, label: '150' },
                                        { value: 300, label: '300' },
                                        { value: 600, label: '600' }
                                    ]}
                                    valueLabelDisplay="auto"
                                    size="small"
                                />
                            </Box>
                        )}

                        {exportError && (
                            <Alert severity="error" sx={{ mt: 2 }}>
                                {exportError}
                            </Alert>
                        )}
                    </Box>

                    {/* Preview Panel */}
                    <Box sx={{ flex: 1, overflow: 'auto', bgcolor: '#f5f5f5', p: 2, borderRadius: 1, minWidth: 0 }}>
                        <Typography variant="subtitle2" gutterBottom>
                            Preview (scaled {Math.round(previewScale * 100)}%)
                        </Typography>
                        <Box sx={{ position: 'relative', overflow: 'visible' }}>
                            <Box
                                sx={{
                                    transform: `scale(${previewScale})`,
                                    transformOrigin: 'top left',
                                    boxShadow: 2,
                                    display: 'inline-block'
                                }}
                            >
                                <PublicationFigure
                                    ref={figureRef}
                                    config={config}
                                    data={data}
                                    xAxis={xAxis}
                                    yAxis={yAxis}
                                    getElementColumn={getElementColumn}
                                    dpi={96}
                                />
                            </Box>
                        </Box>
                    </Box>
                </Box>
            </DialogContent>

            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button
                    variant="contained"
                    onClick={handleExport}
                    disabled={isExporting || (!exportPNG && !exportSVG)}
                    startIcon={isExporting ? <CircularProgress size={16} /> : <Download />}
                >
                    {isExporting ? 'Exporting...' : 'Export'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default PathfinderPublicationDialog;
