/**
 * GIS dialog: WGS84 Longitude/Latitude columns from the projected East/North
 * columns (dataset projection), and visible points to Google Earth (KML) or
 * GeoJSON, styled by the attribute colours and sizes.
 */
import React, { useMemo, useState } from 'react';
import {
    Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel, MenuItem,
    Select, Stack, Typography,
} from '@mui/material';
import { Public, TableRows, Download } from '@mui/icons-material';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../store/appStore';
import { ProjectionPicker } from '../../components/ProjectionPicker';
import { ensureProjectionRegistered } from '../../utils/coordinateUtils';
import { downloadText, GisPoint, lonLatColumns, toGeoJson, toKml } from '../../utils/gisExport';
import { attributeColumnValues, getStyleArraysColumnar } from '../../utils/attributeUtils';
import { isNumericColumn } from '../../types/columnarData';
import { notify } from '../../store/notificationStore';

const uniqueName = (base: string, taken: string[]) => {
    let name = base, k = 2;
    while (taken.includes(name)) name = `${base}_${k++}`;
    return name;
};

export const GisDialog: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
    const { columns, datasetEpsg } = useAppStore(useShallow(s => ({ columns: s.columns, datasetEpsg: s.datasetEpsg })));
    const numeric = useMemo(() => columns.filter(c => ['numeric', 'float', 'integer'].includes(c.type as string)), [columns]);
    const [xCol, setXCol] = useState('');
    const [yCol, setYCol] = useState('');
    const [busy, setBusy] = useState(false);
    const x = xCol || columns.find(c => c.role === 'East')?.name || '';
    const y = yCol || columns.find(c => c.role === 'North')?.name || '';
    const ready = !!(x && y && datasetEpsg);

    const lonLat = async () => {
        if (!ready) return null;
        await ensureProjectionRegistered(datasetEpsg!);
        const app = useAppStore.getState();
        const xc = app.getRawColumn(x), yc = app.getRawColumn(y);
        if (!xc || !yc || !isNumericColumn(xc) || !isNumericColumn(yc)) throw new Error('East/North must be numeric columns');
        return lonLatColumns(xc, yc, datasetEpsg!);
    };

    const run = async (fn: () => Promise<void>) => {
        setBusy(true);
        try { await fn(); } catch (e) { notify((e as Error).message, 'error'); } finally { setBusy(false); }
    };

    const addColumns = () => run(async () => {
        const ll = await lonLat();
        if (!ll) return;
        const app = useAppStore.getState();
        const names = app.columns.map(c => c.name);
        const lonName = uniqueName('Longitude', names);
        const latName = uniqueName('Latitude', [...names, lonName]);
        app.applyColumnEdits({ add: [{ name: lonName, values: ll.lons }, { name: latName, values: ll.lats }] });
        const ok = ll.lats.filter(Number.isFinite).length;
        notify(`Added ${lonName} / ${latName} (WGS84) for ${ok.toLocaleString()} rows`, 'success');
    });

    const exportPoints = (format: 'kml' | 'geojson') => run(async () => {
        const ll = await lonLat();
        if (!ll) return;
        const app = useAppStore.getState();
        const n = app.columnarData.rowCount;
        const get = (name: string) => app.getRawColumn(name);
        const style = getStyleArraysColumnar(n, get);
        const colourGroup = attributeColumnValues('color', n, get);
        const shapeGroup = attributeColumnValues('shape', n, get);
        const idName = columns.find(c => c.role === 'ID' || c.role === 'HoleID')?.name;
        const idCol = idName ? get(idName) : undefined;
        const xc = get(x)!, yc = get(y)!;
        const points: GisPoint[] = [];
        for (let i = 0; i < n; i++) {
            if (!style.visible[i] || !Number.isFinite(ll.lons[i])) continue;
            const id = idCol ? String(idCol[i] ?? '') : '';
            points.push({
                lon: ll.lons[i], lat: ll.lats[i], name: id || `Row ${i + 1}`,
                color: style.colors[i], size: style.sizes[i],
                properties: { [idName ?? 'Row']: id || i + 1, [x]: xc[i] as number, [y]: yc[i] as number, Colour: colourGroup[i] || null, Shape: shapeGroup[i] || null },
            });
        }
        const stamp = new Date().toISOString().slice(0, 10);
        if (format === 'kml') downloadText(toKml(points, `GeoChem ${stamp}`), `geochem_points_${stamp}.kml`, 'application/vnd.google-earth.kml+xml');
        else downloadText(toGeoJson(points), `geochem_points_${stamp}.geojson`, 'application/geo+json');
        notify(`Exported ${points.length.toLocaleString()} visible points`, 'success');
    });

    const colSelect = (label: string, value: string, set: (v: string) => void) => (
        <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel>{label}</InputLabel>
            <Select label={label} value={value} onChange={(e) => set(e.target.value)}>
                {numeric.map(c => <MenuItem key={c.name} value={c.name}>{c.alias || c.name}</MenuItem>)}
            </Select>
        </FormControl>
    );

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>GIS: WGS84 coordinates and export</DialogTitle>
            <DialogContent dividers>
                <Stack spacing={2}>
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                        {colSelect('East (X)', x, setXCol)}
                        {colSelect('North (Y)', y, setYCol)}
                    </Box>
                    <ProjectionPicker minWidth={300} />
                    {!datasetEpsg && <Alert severity="info">Set the dataset projection (e.g. GDA94 / MGA zone 50) first.</Alert>}
                    <Typography variant="body2" color="text.secondary">
                        Export writes the points visible under the current attributes, coloured and sized as in the plots, with their colour and shape groups.
                    </Typography>
                </Stack>
            </DialogContent>
            <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
                <Button startIcon={<TableRows />} disabled={!ready || busy} onClick={addColumns}>Add Long/Lat columns</Button>
                <Button startIcon={<Public />} disabled={!ready || busy} onClick={() => exportPoints('kml')}>Google Earth (KML)</Button>
                <Button startIcon={<Download />} disabled={!ready || busy} onClick={() => exportPoints('geojson')}>GeoJSON</Button>
                <Button variant="contained" onClick={onClose}>Close</Button>
            </DialogActions>
        </Dialog>
    );
};
