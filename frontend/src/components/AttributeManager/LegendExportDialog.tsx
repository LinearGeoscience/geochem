/**
 * LegendExportDialog Component
 *
 * Dialog for configuring and exporting legend as PNG or SVG.
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
    FormControlLabel,
    Checkbox,
    TextField,
    ToggleButton,
    ToggleButtonGroup,
    Slider,
    Divider,
    CircularProgress,
    Alert,
} from '@mui/material';
import { Download, Image, Code, ViewColumn, ViewStream } from '@mui/icons-material';
import { LegendExport, LegendExportConfig } from './LegendExport';
import { useAttributeStore } from '../../store/attributeStore';

interface LegendExportDialogProps {
    open: boolean;
    onClose: () => void;
}

export const LegendExportDialog: React.FC<LegendExportDialogProps> = ({
    open,
    onClose,
}) => {
    const { color, shape, size } = useAttributeStore();

    // Configuration state
    const [showColor, setShowColor] = useState(true);
    const [showShape, setShowShape] = useState(false);
    const [showSize, setShowSize] = useState(false);
    const [title, setTitle] = useState('');
    const [orientation, setOrientation] = useState<'horizontal' | 'vertical'>('vertical');
    const [fontSize, setFontSize] = useState(12);
    const [symbolSize, setSymbolSize] = useState(16);
    const [showRangeValues, setShowRangeValues] = useState(true);
    const [combinedMode, setCombinedMode] = useState(false);

    // Export state
    const [exportPNG, setExportPNG] = useState(true);
    const [exportSVG, setExportSVG] = useState(true);
    const [exportDPI, setExportDPI] = useState(300);
    const [isExporting, setIsExporting] = useState(false);
    const [exportError, setExportError] = useState<string | null>(null);

    const legendRef = useRef<HTMLDivElement>(null);

    // Check what attributes have entries
    const hasColorEntries = color.entries.filter(e => e.visible).length > 0;
    const hasShapeEntries = shape.entries.filter(e => e.visible).length > 0;
    const hasSizeEntries = size.entries.filter(e => e.visible).length > 0;

    // Build config
    const legendConfig: LegendExportConfig = useMemo(() => ({
        showColor,
        showShape,
        showSize,
        title: title || undefined,
        orientation,
        fontSize,
        symbolSize,
        showEntryNames: true,
        showRangeValues,
        combinedMode,
    }), [showColor, showShape, showSize, title, orientation, fontSize, symbolSize, showRangeValues, combinedMode]);

    // Preview scale
    const previewScale = 1;

    // Export handler
    const handleExport = useCallback(async () => {
        if (!legendRef.current) return;

        setIsExporting(true);
        setExportError(null);

        try {
            const { toPng, toSvg } = await import('html-to-image');
            const timestamp = new Date().toISOString().slice(0, 10);
            const filename = `legend_${timestamp}`;

            // Export PNG
            if (exportPNG) {
                const pixelRatio = exportDPI / 96;

                const pngDataUrl = await toPng(legendRef.current, {
                    backgroundColor: '#ffffff',
                    pixelRatio: pixelRatio,
                    style: {
                        transform: 'scale(1)',
                        transformOrigin: 'top left',
                    },
                });

                const pngLink = document.createElement('a');
                pngLink.download = `${filename}.png`;
                pngLink.href = pngDataUrl;
                pngLink.click();
            }

            // Export SVG
            if (exportSVG) {
                const svgDataUrl = await toSvg(legendRef.current, {
                    backgroundColor: '#ffffff',
                });

                const svgLink = document.createElement('a');
                svgLink.download = `${filename}.svg`;
                svgLink.href = svgDataUrl;
                svgLink.click();
            }

            onClose();
        } catch (err) {
            console.error('Export failed:', err);
            setExportError('Export failed. Please try again.');
        } finally {
            setIsExporting(false);
        }
    }, [exportPNG, exportSVG, exportDPI, onClose]);

    // Determine if export is possible
    const canExport = (showColor || showShape || showSize) && (exportPNG || exportSVG);

    return (
        <Dialog
            open={open}
            onClose={onClose}
            maxWidth="md"
            fullWidth
            PaperProps={{ sx: { maxHeight: '90vh' } }}
        >
            <DialogTitle>
                Export Legend
                <Typography variant="body2" color="text.secondary">
                    Export the current legend as an image for publications
                </Typography>
            </DialogTitle>

            <DialogContent dividers>
                <Box sx={{ display: 'flex', gap: 3 }}>
                    {/* Settings Panel */}
                    <Box sx={{ width: 260, flexShrink: 0 }}>
                        {/* Attributes to Include */}
                        <Typography variant="subtitle2" gutterBottom>
                            Include Attributes
                        </Typography>

                        <FormControlLabel
                            control={
                                <Checkbox
                                    checked={showColor}
                                    onChange={(e) => setShowColor(e.target.checked)}
                                    size="small"
                                    disabled={!hasColorEntries}
                                />
                            }
                            label={`Color${color.field ? ` (${color.field})` : ''}`}
                        />
                        <FormControlLabel
                            control={
                                <Checkbox
                                    checked={showShape}
                                    onChange={(e) => setShowShape(e.target.checked)}
                                    size="small"
                                    disabled={!hasShapeEntries}
                                />
                            }
                            label={`Shape${shape.field ? ` (${shape.field})` : ''}`}
                        />
                        <FormControlLabel
                            control={
                                <Checkbox
                                    checked={showSize}
                                    onChange={(e) => setShowSize(e.target.checked)}
                                    size="small"
                                    disabled={!hasSizeEntries}
                                />
                            }
                            label={`Size${size.field ? ` (${size.field})` : ''}`}
                        />

                        <Divider sx={{ my: 2 }} />

                        {/* Layout Options */}
                        <Typography variant="subtitle2" gutterBottom>
                            Layout
                        </Typography>

                        <TextField
                            label="Title (optional)"
                            size="small"
                            fullWidth
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            sx={{ mb: 2 }}
                        />

                        <Box sx={{ mb: 2 }}>
                            <Typography variant="caption" color="text.secondary">
                                Orientation
                            </Typography>
                            <ToggleButtonGroup
                                value={orientation}
                                exclusive
                                onChange={(_, v) => v && setOrientation(v)}
                                size="small"
                                fullWidth
                            >
                                <ToggleButton value="vertical">
                                    <ViewStream sx={{ mr: 0.5 }} fontSize="small" />
                                    Vertical
                                </ToggleButton>
                                <ToggleButton value="horizontal">
                                    <ViewColumn sx={{ mr: 0.5 }} fontSize="small" />
                                    Horizontal
                                </ToggleButton>
                            </ToggleButtonGroup>
                        </Box>

                        <FormControlLabel
                            control={
                                <Checkbox
                                    checked={combinedMode}
                                    onChange={(e) => setCombinedMode(e.target.checked)}
                                    size="small"
                                />
                            }
                            label="Combined legend (all attributes per entry)"
                        />

                        <FormControlLabel
                            control={
                                <Checkbox
                                    checked={showRangeValues}
                                    onChange={(e) => setShowRangeValues(e.target.checked)}
                                    size="small"
                                />
                            }
                            label="Show range values"
                        />

                        <Divider sx={{ my: 2 }} />

                        {/* Sizing */}
                        <Typography variant="subtitle2" gutterBottom>
                            Sizing
                        </Typography>

                        <Box sx={{ mb: 2 }}>
                            <Typography variant="caption" color="text.secondary">
                                Font Size: {fontSize}px
                            </Typography>
                            <Slider
                                value={fontSize}
                                onChange={(_, v) => setFontSize(v as number)}
                                min={8}
                                max={24}
                                step={1}
                                size="small"
                            />
                        </Box>

                        <Box sx={{ mb: 2 }}>
                            <Typography variant="caption" color="text.secondary">
                                Symbol Size: {symbolSize}px
                            </Typography>
                            <Slider
                                value={symbolSize}
                                onChange={(_, v) => setSymbolSize(v as number)}
                                min={10}
                                max={40}
                                step={2}
                                size="small"
                            />
                        </Box>

                        <Divider sx={{ my: 2 }} />

                        {/* Export Format */}
                        <Typography variant="subtitle2" gutterBottom>
                            Export Format
                        </Typography>

                        <FormControlLabel
                            control={
                                <Checkbox
                                    checked={exportPNG}
                                    onChange={(e) => setExportPNG(e.target.checked)}
                                    size="small"
                                />
                            }
                            label={
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    <Image fontSize="small" />
                                    <span>PNG (raster)</span>
                                </Box>
                            }
                        />

                        <FormControlLabel
                            control={
                                <Checkbox
                                    checked={exportSVG}
                                    onChange={(e) => setExportSVG(e.target.checked)}
                                    size="small"
                                />
                            }
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
                                    PNG Resolution: {exportDPI} DPI
                                </Typography>
                                <Slider
                                    value={exportDPI}
                                    onChange={(_, v) => setExportDPI(v as number)}
                                    min={150}
                                    max={600}
                                    step={50}
                                    size="small"
                                    marks={[
                                        { value: 150, label: '150' },
                                        { value: 300, label: '300' },
                                        { value: 600, label: '600' },
                                    ]}
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
                    <Box
                        sx={{
                            flex: 1,
                            overflow: 'auto',
                            bgcolor: '#f5f5f5',
                            p: 2,
                            borderRadius: 1,
                            minWidth: 0,
                            display: 'flex',
                            justifyContent: 'center',
                            alignItems: 'flex-start',
                        }}
                    >
                        <Box
                            sx={{
                                transform: `scale(${previewScale})`,
                                transformOrigin: 'top center',
                                boxShadow: 2,
                            }}
                        >
                            {canExport ? (
                                <LegendExport ref={legendRef} config={legendConfig} />
                            ) : (
                                <Box sx={{ p: 4, bgcolor: 'white', borderRadius: 1 }}>
                                    <Typography color="text.secondary">
                                        Select at least one attribute to preview legend
                                    </Typography>
                                </Box>
                            )}
                        </Box>
                    </Box>
                </Box>
            </DialogContent>

            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button
                    variant="contained"
                    onClick={handleExport}
                    disabled={isExporting || !canExport}
                    startIcon={isExporting ? <CircularProgress size={16} /> : <Download />}
                >
                    {isExporting ? 'Exporting...' : 'Export'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default LegendExportDialog;
