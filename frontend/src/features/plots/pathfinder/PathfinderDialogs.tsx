/**
 * Pathfinder map dialogs: anomaly threshold reference table and element
 * column mapping configuration.
 */
import React from 'react';
import {
    Box, Typography, Button, Chip, Dialog, DialogTitle, DialogContent, DialogActions,
    Table, TableBody, TableCell, TableHead, TableRow, Grid, Divider,
} from '@mui/material';
import {
    PATHFINDER_ELEMENTS, ANOMALY_COLORS, ANOMALY_THRESHOLDS, CRUSTAL_ABUNDANCE,
    SC_NORMALIZABLE_ELEMENTS, K_NORMALIZABLE_ELEMENTS, HOST_ROCK_DEPENDENT_ELEMENTS, type PathfinderElement,
} from '../../../utils/calculations/pathfinderConstants';
import {
    BACKGROUND_STANDARDS, getBackgroundValue, generateAnomalyThresholds, type ReferenceStandardId,
} from '../../../utils/calculations/elementBackgroundConstants';
import type { ElementColumnMapping, MapMode } from './types';
import { ColumnPicker } from '../../../components/ColumnPicker';

interface ColumnOption { name: string; alias?: string | null }

export const PathfinderThresholdDialog: React.FC<{
    open: boolean;
    onClose: () => void;
    mapMode: MapMode;
    referenceStandard: ReferenceStandardId;
    selectedExtendedElements: string[];
    getExtendedBackground: (element: string) => number | null;
}> = ({ open, onClose, mapMode, referenceStandard, selectedExtendedElements, getExtendedBackground }) => (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
        <DialogTitle>
            {mapMode === 'pathfinder' ? 'Pathfinder Element Thresholds' : 'Element Anomaly Thresholds'}
            <Typography variant="subtitle2" color="text.secondary">
                {mapMode === 'pathfinder'
                    ? "Based on Dr. Scott Halley's pathfinder chemistry methodology"
                    : `Reference: ${BACKGROUND_STANDARDS.find(s => s.id === referenceStandard)?.reference || 'Custom values'}`
                }
            </Typography>
        </DialogTitle>
        <DialogContent dividers>
            <Typography variant="body2" paragraph>
                {mapMode === 'pathfinder'
                    ? 'Points are classified as multiples of average crustal abundance. A coherent footprint (multi-point anomaly) of ≥10x crustal abundance is a significant anomaly.'
                    : 'Points are classified as strict multiples of the selected reference background value: 1x (background), 2x, 3x, 5x, and ≥10x.'
                }
            </Typography>
            <Table size="small">
                <TableHead>
                    <TableRow>
                        <TableCell><strong>Element</strong></TableCell>
                        <TableCell align="right"><strong>{mapMode === 'pathfinder' ? 'Crustal (ppm)' : 'Background'}</strong></TableCell>
                        <TableCell align="right" sx={{ bgcolor: ANOMALY_COLORS.background, color: 'white' }}>Background</TableCell>
                        <TableCell align="right" sx={{ bgcolor: ANOMALY_COLORS['2x'], color: 'white' }}>2x</TableCell>
                        <TableCell align="right" sx={{ bgcolor: ANOMALY_COLORS['3x'], color: 'black' }}>3x</TableCell>
                        <TableCell align="right" sx={{ bgcolor: ANOMALY_COLORS['5x'], color: 'black' }}>5x</TableCell>
                        <TableCell align="right" sx={{ bgcolor: ANOMALY_COLORS['10x'], color: 'white' }}>10x</TableCell>
                        {mapMode === 'pathfinder' && <TableCell><strong>Notes</strong></TableCell>}
                    </TableRow>
                </TableHead>
                <TableBody>
                    {mapMode === 'pathfinder' ? (
                        PATHFINDER_ELEMENTS.map(element => {
                            const thresh = ANOMALY_THRESHOLDS[element];
                            return (
                                <TableRow key={element}>
                                    <TableCell><strong>{element}</strong></TableCell>
                                    <TableCell align="right">{CRUSTAL_ABUNDANCE[element]}</TableCell>
                                    <TableCell align="right">0-{thresh.background}</TableCell>
                                    <TableCell align="right">{thresh.background}-{thresh.x2}</TableCell>
                                    <TableCell align="right">{thresh.x2}-{thresh.x3}</TableCell>
                                    <TableCell align="right">{thresh.x3}-{thresh.x5}</TableCell>
                                    <TableCell align="right">&gt;{thresh.x5}</TableCell>
                                    <TableCell>
                                        {HOST_ROCK_DEPENDENT_ELEMENTS.includes(element) && <Chip label="Host-rock dependent" size="small" sx={{ mr: 0.5 }} />}
                                        {SC_NORMALIZABLE_ELEMENTS.includes(element) && <Chip label="Sc norm" size="small" color="info" sx={{ mr: 0.5 }} />}
                                        {K_NORMALIZABLE_ELEMENTS.includes(element) && <Chip label="K norm" size="small" color="secondary" />}
                                    </TableCell>
                                </TableRow>
                            );
                        })
                    ) : (
                        selectedExtendedElements.map(element => {
                            const bg = getExtendedBackground(element);
                            if (bg === null) return null;
                            const t = generateAnomalyThresholds(bg);
                            const entry = getBackgroundValue(referenceStandard === 'custom' ? 'ucc-rudnick-gao-2003' : referenceStandard, element);
                            const unit = entry?.unit || 'ppm';
                            return (
                                <TableRow key={element}>
                                    <TableCell><strong>{element}</strong></TableCell>
                                    <TableCell align="right">{bg} {unit}</TableCell>
                                    <TableCell align="right">0-{t.background}</TableCell>
                                    <TableCell align="right">{t.background}-{t.x2}</TableCell>
                                    <TableCell align="right">{t.x2}-{t.x3}</TableCell>
                                    <TableCell align="right">{t.x3}-{t.x5}</TableCell>
                                    <TableCell align="right">&gt;{t.x5}</TableCell>
                                </TableRow>
                            );
                        })
                    )}
                </TableBody>
            </Table>
            {mapMode === 'pathfinder' && (
                <Box sx={{ mt: 2 }}>
                    <Typography variant="subtitle2" gutterBottom>Normalization Notes:</Typography>
                    <Typography variant="body2" color="text.secondary">
                        • <strong>Sc normalization:</strong> Zn, Cu, In can be normalized to Sc for variable host-rock compositions (mafic influence)<br/>
                        • <strong>K normalization:</strong> Cs, Tl can be normalized to K for variable host-rock compositions (felsic/alkali influence)<br/>
                        • <strong>Host-rock dependent:</strong> Pb, Zn, Cu, In, Li, Cs, Tl ranges vary strongly with lithology
                    </Typography>
                </Box>
            )}
            {mapMode === 'extended' && (
                <Box sx={{ mt: 2 }}>
                    <Typography variant="body2" color="text.secondary">
                        Thresholds are strict multiples of the background value.
                        {referenceStandard !== 'custom' && ` Source: ${BACKGROUND_STANDARDS.find(s => s.id === referenceStandard)?.description}`}
                    </Typography>
                </Box>
            )}
        </DialogContent>
        <DialogActions>
            <Button onClick={onClose}>Close</Button>
        </DialogActions>
    </Dialog>
);

const ColumnSelect: React.FC<{
    label: string;
    value: string;
    autoValue: string | null | undefined;
    emptyLabel: string;
    columns: ColumnOption[];
    onChange: (value: string) => void;
}> = ({ label, value, autoValue, emptyLabel, columns, onChange }) => (
    <ColumnPicker label={label} value={value} onChange={onChange} include={columns.map(col => col.name)} useColumnFilter={false} allowNone noneLabel={autoValue ? `Auto: ${autoValue}` : emptyLabel} fullWidth />
);

export const PathfinderColumnMappingDialog: React.FC<{
    open: boolean;
    onClose: () => void;
    numericColumns: ColumnOption[];
    autoDetectedColumns: Map<PathfinderElement, string>;
    autoDetectedNormColumns: { sc: string | null; k: string | null };
    elementColumnMapping: ElementColumnMapping;
    setElementColumnMapping: (mapping: ElementColumnMapping) => void;
    scColumn: string;
    setScColumn: (col: string) => void;
    kColumn: string;
    setKColumn: (col: string) => void;
}> = ({
    open, onClose, numericColumns, autoDetectedColumns, autoDetectedNormColumns,
    elementColumnMapping, setElementColumnMapping, scColumn, setScColumn, kColumn, setKColumn,
}) => {
    const updateElementColumn = (element: PathfinderElement, column: string) => {
        const newMapping = { ...elementColumnMapping };
        if (column === '') delete newMapping[element];
        else newMapping[element] = column;
        setElementColumnMapping(newMapping);
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
            <DialogTitle>Configure Element Column Mappings</DialogTitle>
            <DialogContent dividers>
                <Typography variant="body2" color="text.secondary" paragraph>
                    Select which data column corresponds to each pathfinder element.
                    Auto-detected columns are shown in italics - select a different column to override.
                </Typography>
                <Grid container spacing={2}>
                    {PATHFINDER_ELEMENTS.map(element => (
                        <Grid item xs={6} sm={4} md={3} key={element}>
                            <ColumnSelect
                                label={element}
                                value={elementColumnMapping[element] || ''}
                                autoValue={autoDetectedColumns.get(element)}
                                emptyLabel="Not mapped"
                                columns={numericColumns}
                                onChange={(v) => updateElementColumn(element, v)}
                            />
                        </Grid>
                    ))}
                </Grid>
                <Divider sx={{ my: 2 }} />
                <Typography variant="subtitle2" gutterBottom>Normalization Columns</Typography>
                <Grid container spacing={2}>
                    <Grid item xs={6}>
                        <ColumnSelect label="Scandium (Sc)" value={scColumn} autoValue={autoDetectedNormColumns.sc}
                            emptyLabel="Not mapped" columns={numericColumns} onChange={setScColumn} />
                    </Grid>
                    <Grid item xs={6}>
                        <ColumnSelect label="Potassium (K)" value={kColumn} autoValue={autoDetectedNormColumns.k}
                            emptyLabel="Not mapped" columns={numericColumns} onChange={setKColumn} />
                    </Grid>
                </Grid>
            </DialogContent>
            <DialogActions>
                <Button onClick={() => {
                    setElementColumnMapping({});
                    setScColumn('');
                    setKColumn('');
                }}>
                    Reset to Auto-Detect
                </Button>
                <Button onClick={onClose} variant="contained">
                    Done
                </Button>
            </DialogActions>
        </Dialog>
    );
};
