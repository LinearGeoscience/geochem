import React, { useState } from 'react';
import { Box, Paper, Typography, Tabs, Tab, FormControl, InputLabel, Select, MenuItem } from '@mui/material';
import { useAppStore } from '../../store/appStore';
import { NumericLegend } from './NumericLegend';
import { LegendList } from './LegendList';
import { ErrorBoundary } from '../../components/ErrorBoundary';

interface TabPanelProps {
    children?: React.ReactNode;
    index: number;
    value: number;
}

function TabPanel(props: TabPanelProps) {
    const { children, value, index, ...other } = props;
    return (
        <div role="tabpanel" hidden={value !== index} {...other}>
            {value === index && <Box sx={{ p: 2 }}>{children}</Box>}
        </div>
    );
}

export const AttributeManager: React.FC = () => {
    const {
        columns, data,
        colorBy, shapeBy, sizeBy,
        setColorBy, setShapeBy, setSizeBy,
        colorMap, shapeMap, visibilityMap,
        colorPalette, colorRange,
        updateColorMap, updateShapeMap, toggleVisibility,
        setColorPalette, setColorRange
    } = useAppStore();

    const [tabIndex, setTabIndex] = useState(0);

    const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
        setTabIndex(newValue);
    };

    // Helper to check if column is numeric
    const isNumeric = (colName: string) => {
        const col = columns.find(c => c.name === colName);
        return col?.type === 'numeric' || col?.type === 'float' || col?.type === 'integer';
    };

    // Helper to get unique values for the active attribute column

    // Helper to get unique values for the active attribute column

    // Helper to get unique values for the active attribute column
    const getUniqueValues = (columnName: string | null) => {
        if (!columnName || !data.length) return [];
        const values = data.map(d => d[columnName]);
        return [...new Set(values)].filter(v => v != null).map(String).sort();
    };

    const colorValues = getUniqueValues(colorBy);

    return (
        <ErrorBoundary>
            <Paper sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
                    <Tabs value={tabIndex} onChange={handleTabChange} variant="fullWidth">
                        <Tab label="Color" />
                        <Tab label="Shape" />
                        <Tab label="Size" />
                        <Tab label="Vis" />
                    </Tabs>
                </Box>

                {/* Color Tab */}
                <TabPanel value={tabIndex} index={0}>
                    <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                        <InputLabel>Color By</InputLabel>
                        <Select value={colorBy || 'none'} label="Color By" onChange={(e) => setColorBy(e.target.value === 'none' ? null : e.target.value)}>
                            <MenuItem value="none"><em>None</em></MenuItem>
                            {columns.map(col => (
                                <MenuItem key={col.name} value={col.name}>{col.alias || col.name}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    {colorBy && (
                        isNumeric(colorBy) ? (
                            <NumericLegend
                                columnName={colorBy}
                                data={data}
                                colorPalette={colorPalette}
                                colorRange={colorRange}
                                onPaletteChange={setColorPalette}
                                onRangeChange={setColorRange}
                            />
                        ) : (
                            <LegendList
                                values={colorValues}
                                colorMap={colorMap}
                                shapeMap={shapeMap}
                                visibilityMap={visibilityMap}
                                onColorChange={updateColorMap}
                                onShapeChange={updateShapeMap}
                                onVisibilityChange={toggleVisibility}
                            />
                        )
                    )}
                </TabPanel>

                {/* Shape Tab */}
                <TabPanel value={tabIndex} index={1}>
                    <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                        <InputLabel>Shape By</InputLabel>
                        <Select value={shapeBy || 'none'} label="Shape By" onChange={(e) => setShapeBy(e.target.value === 'none' ? null : e.target.value)}>
                            <MenuItem value="none"><em>None</em></MenuItem>
                            {columns.map(col => (
                                <MenuItem key={col.name} value={col.name}>{col.alias || col.name}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    {shapeBy && (
                        <Typography variant="body2" color="text.secondary">
                            Shape customization coming soon.
                        </Typography>
                    )}
                </TabPanel>

                {/* Size Tab */}
                <TabPanel value={tabIndex} index={2}>
                    <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                        <InputLabel>Size By</InputLabel>
                        <Select value={sizeBy || 'none'} label="Size By" onChange={(e) => setSizeBy(e.target.value === 'none' ? null : e.target.value)}>
                            <MenuItem value="none"><em>None</em></MenuItem>
                            {columns.filter(c => c.type === 'numeric').map(col => (
                                <MenuItem key={col.name} value={col.name}>{col.alias || col.name}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                </TabPanel>

                {/* Visibility Tab */}
                <TabPanel value={tabIndex} index={3}>
                    <Typography variant="body2" gutterBottom>
                        Global Visibility Control
                    </Typography>
                    {/* Reuse LegendList if colorBy is set, or allow selecting a column just for visibility */}
                    {colorBy ? (
                        <LegendList
                            values={colorValues}
                            colorMap={colorMap}
                            shapeMap={shapeMap}
                            visibilityMap={visibilityMap}
                            onColorChange={updateColorMap}
                            onShapeChange={updateShapeMap}
                            onVisibilityChange={toggleVisibility}
                        />
                    ) : (
                        <Typography variant="caption" color="text.secondary">
                            Select a "Color By" column to control visibility by group.
                        </Typography>
                    )}
                </TabPanel>
            </Paper>
        </ErrorBoundary>
    );
};
