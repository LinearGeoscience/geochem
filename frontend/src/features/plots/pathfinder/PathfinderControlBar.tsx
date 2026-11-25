/**
 * Pathfinder map control bar: axes, 2D/3D and mode toggles (primary row);
 * display, basemap, interaction and visible-class settings (popover).
 */
import React from 'react';
import {
    Box, FormControl, InputLabel, Select, MenuItem, Typography, Checkbox, FormControlLabel, Chip, Button,
    Tooltip, TextField, Autocomplete, CircularProgress, Slider, ToggleButton, ToggleButtonGroup,
} from '@mui/material';
import { SelectAll, ZoomOutMap, PanTool, HighlightAlt, CropFree } from '@mui/icons-material';
import { PlotControlBar, ControlSection, SettingChip } from '../../../components/plot_controls/PlotControlBar';
import { ALL_EPSG_CODES, type MapViewStyle } from '../../../utils/basemapUtils';
import { ANOMALY_CLASSES, ANOMALY_COLORS, ANOMALY_LABELS, type AnomalyClass } from '../../../utils/calculations/pathfinderConstants';
import type { PathfinderSettings } from './usePathfinderSettings';
import { ColumnPicker } from '../../../components/ColumnPicker';

export interface PathfinderControlBarProps {
    settings: PathfinderSettings;
    basemapEnabled: boolean;
    projectionError: string | null;
    isTransforming: boolean;
    selectedCount: number;
    onDeselect: () => void;
    onZoomToData: () => void;
}

const normalizeEpsg = (code: string) => (code.toUpperCase().startsWith('EPSG:') ? code.toUpperCase() : `EPSG:${code}`);

export const PathfinderControlBar: React.FC<PathfinderControlBarProps> = ({
    settings, basemapEnabled, projectionError, isTransforming,
    selectedCount, onDeselect, onZoomToData,
}) => {
    const {
        xAxis, setXAxis, yAxis, setYAxis, zAxis, setZAxis, is3D, setIs3D, mapMode, setMapMode,
        mapViewStyle, setMapViewStyle, dragMode, setDragMode, basemapOpacity, setBasemapOpacity,
        basePointSize, setBasePointSize, showProbabilityPlots, setShowProbabilityPlots,
        equalAxes, setEqualAxes, visibleClasses, setVisibleClasses, epsgCode, setEpsgCode,
    } = settings;

    const toggleClass = (cls: AnomalyClass) => {
        setVisibleClasses(visibleClasses.includes(cls)
            ? visibleClasses.filter(c => c !== cls)
            : [...visibleClasses, cls]);
    };

    const axisSelect = (label: string, value: string, onChange: (v: string) => void) => (
        <ColumnPicker label={label} value={value} onChange={onChange} minWidth={140} />
    );

    return (
        <PlotControlBar
            primary={<>
                {axisSelect('X-Axis', xAxis, setXAxis)}
                {axisSelect('Y-Axis', yAxis, setYAxis)}
                {is3D && axisSelect('Z-Axis', zAxis, setZAxis)}
                <FormControlLabel
                    control={<Checkbox checked={is3D} onChange={(e) => setIs3D(e.target.checked)} />}
                    label="3D Mode"
                />
                <ToggleButtonGroup value={mapMode} exclusive onChange={(_, val) => val && setMapMode(val)} size="small">
                    <ToggleButton value="pathfinder">Pathfinder (Halley)</ToggleButton>
                    <ToggleButton value="extended">Extended Elements</ToggleButton>
                </ToggleButtonGroup>
            </>}
            settingsActive={
                mapViewStyle !== 'normal' || (!is3D && dragMode !== 'zoom') || basemapOpacity !== 0.7 ||
                basePointSize !== 6 || !showProbabilityPlots || (is3D && !equalAxes) ||
                visibleClasses.length !== ANOMALY_CLASSES.length
            }
            summary={<>
                {mapViewStyle !== 'normal' && (
                    <SettingChip
                        label={mapViewStyle === 'osm' ? 'OpenStreetMap' : mapViewStyle === 'satellite' ? 'Satellite' : 'Hybrid'}
                        onDelete={() => setMapViewStyle('normal')}
                    />
                )}
                {!is3D && dragMode !== 'zoom' && (
                    <SettingChip
                        label={dragMode === 'pan' ? 'Pan' : dragMode === 'lasso' ? 'Lasso' : 'Box Select'}
                        onDelete={() => setDragMode('zoom')}
                    />
                )}
                {is3D && !equalAxes && <SettingChip label="Free axes" onDelete={() => setEqualAxes(true)} />}
                {!showProbabilityPlots && <SettingChip label="No prob. plots" onDelete={() => setShowProbabilityPlots(true)} />}
                {basePointSize !== 6 && <SettingChip label={`Point size ${basePointSize}`} onDelete={() => setBasePointSize(6)} />}
                {visibleClasses.length !== ANOMALY_CLASSES.length && (
                    <SettingChip
                        label={`Classes ${visibleClasses.length}/${ANOMALY_CLASSES.length}`}
                        onDelete={() => setVisibleClasses([...ANOMALY_CLASSES])}
                    />
                )}
                {!is3D && selectedCount > 0 && (
                    <Chip label={`${selectedCount} selected`} size="small" onDelete={onDeselect} color="primary" variant="outlined" />
                )}
            </>}
            settings={<>
                <ControlSection label="Display">
                    {is3D && (
                        <FormControlLabel
                            control={<Checkbox checked={equalAxes} onChange={(e) => setEqualAxes(e.target.checked)} />}
                            label="Equal Axes"
                        />
                    )}
                    <FormControlLabel
                        control={<Checkbox checked={showProbabilityPlots} onChange={(e) => setShowProbabilityPlots(e.target.checked)} />}
                        label="Show Probability Plots"
                    />
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 180 }}>
                        <Typography variant="caption" sx={{ whiteSpace: 'nowrap' }}>Point Size:</Typography>
                        <Slider
                            value={basePointSize}
                            onChange={(_, v) => setBasePointSize(v as number)}
                            min={2} max={16} step={1} size="small" valueLabelDisplay="auto" sx={{ width: 100 }}
                        />
                    </Box>
                </ControlSection>

                {!is3D && (
                    <ControlSection label="Map View">
                        <FormControl sx={{ minWidth: 150 }} size="small">
                            <InputLabel>Map View</InputLabel>
                            <Select value={mapViewStyle} onChange={(e) => setMapViewStyle(e.target.value as MapViewStyle)} label="Map View">
                                <MenuItem value="normal">Normal (X/Y)</MenuItem>
                                <MenuItem value="osm">OpenStreetMap</MenuItem>
                                <MenuItem value="satellite">Satellite</MenuItem>
                                <MenuItem value="hybrid">Hybrid</MenuItem>
                            </Select>
                        </FormControl>
                        {basemapEnabled && (
                            <Box sx={{ ml: 3.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
                                <Autocomplete
                                    freeSolo
                                    options={ALL_EPSG_CODES}
                                    getOptionLabel={(option) => typeof option === 'string' ? option : option.label}
                                    value={ALL_EPSG_CODES.find(e => e.code === epsgCode) || (epsgCode ? { code: epsgCode, label: epsgCode, numericCode: 0 } : null)}
                                    onChange={(_event, newValue) => {
                                        if (typeof newValue === 'string') setEpsgCode(normalizeEpsg(newValue));
                                        else if (newValue) setEpsgCode(newValue.code);
                                        else setEpsgCode('');
                                    }}
                                    onBlur={(event) => {
                                        const inputValue = (event.target as HTMLInputElement).value;
                                        if (inputValue && !ALL_EPSG_CODES.some(e => e.label === inputValue || e.code === inputValue)) {
                                            setEpsgCode(normalizeEpsg(inputValue));
                                        }
                                    }}
                                    renderInput={(params) => (
                                        <TextField
                                            {...params}
                                            label="EPSG Code"
                                            size="small"
                                            error={!!projectionError}
                                            placeholder="Search or enter code..."
                                            fullWidth
                                        />
                                    )}
                                    ListboxProps={{ style: { maxHeight: 400 } }}
                                    isOptionEqualToValue={(option, value) => option.code === value.code}
                                />
                                {isTransforming && <CircularProgress size={20} />}
                                {(mapViewStyle === 'satellite' || mapViewStyle === 'hybrid') && (
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 160 }}>
                                        <Typography variant="caption" sx={{ whiteSpace: 'nowrap' }}>Opacity</Typography>
                                        <Slider
                                            value={basemapOpacity}
                                            onChange={(_, v) => setBasemapOpacity(v as number)}
                                            min={0.1} max={1} step={0.1} size="small" valueLabelDisplay="auto"
                                            valueLabelFormat={(v) => `${Math.round(v * 100)}%`}
                                            sx={{ width: 100 }}
                                        />
                                    </Box>
                                )}
                            </Box>
                        )}
                    </ControlSection>
                )}

                <ControlSection label="Interaction">
                    {!is3D && (
                        <ToggleButtonGroup value={dragMode} exclusive onChange={(_, newMode) => newMode && setDragMode(newMode)} size="small">
                            <ToggleButton value="zoom"><Tooltip title="Box Zoom"><CropFree fontSize="small" /></Tooltip></ToggleButton>
                            <ToggleButton value="pan"><Tooltip title="Pan"><PanTool fontSize="small" /></Tooltip></ToggleButton>
                            <ToggleButton value="lasso"><Tooltip title="Lasso Select"><HighlightAlt fontSize="small" /></Tooltip></ToggleButton>
                            <ToggleButton value="select"><Tooltip title="Box Select"><SelectAll fontSize="small" /></Tooltip></ToggleButton>
                        </ToggleButtonGroup>
                    )}
                    <Tooltip title="Zoom to All Data (Reset View)">
                        <Button size="small" variant="outlined" onClick={onZoomToData} startIcon={<ZoomOutMap fontSize="small" />}>
                            Zoom to Data
                        </Button>
                    </Tooltip>
                </ControlSection>

                <ControlSection label="Show Classes">
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                        {ANOMALY_CLASSES.map(cls => (
                            <FormControlLabel
                                key={cls}
                                control={
                                    <Checkbox
                                        checked={visibleClasses.includes(cls)}
                                        onChange={() => toggleClass(cls)}
                                        size="small"
                                        sx={{ color: ANOMALY_COLORS[cls], '&.Mui-checked': { color: ANOMALY_COLORS[cls] } }}
                                    />
                                }
                                label={
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                        <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: ANOMALY_COLORS[cls] }} />
                                        <Typography variant="body2">{ANOMALY_LABELS[cls]}</Typography>
                                    </Box>
                                }
                            />
                        ))}
                    </Box>
                </ControlSection>
            </>}
        />
    );
};
