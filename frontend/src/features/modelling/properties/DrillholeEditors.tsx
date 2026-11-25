/**
 * The drillholes in the properties: how the view the pane acts on draws the
 * samples (shown or not, as points or as cylinders down the holes, their
 * size), the hole traces and the logging tables (shown or not, coloured by
 * what, how wide). The samples' colour, shape, size and filters are the
 * Attribute Manager's, the same in every plot and view (the Attributes pane).
 */
import React, { useMemo } from 'react';
import { Box, Button, FormControlLabel, Slider, Switch, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import { Palette, Search } from '@mui/icons-material';
import { usePlotSetting } from '../../../hooks/usePlotSetting';
import { useAppStore } from '../../../store/appStore';
import { useAttributeStore } from '../../../store/attributeStore';
import { useDrillholeStore } from '../../../store/drillholeStore';
import { useModelStore } from '../../../store/modelStore';
import { useModellingStore } from '../../../store/modellingStore';
import { getColumnDisplayName } from '../../../utils/attributeUtils';
import { tableCoverage, tableText, type HoleTable } from '../../model/drillholes';
import { pathsFor } from '../../model/logging';
import { openModelDialog } from '../../model/modelDialogs';
import { keys } from '../../model/objectKeys';
import type { SceneCoords, UnitMap } from '../../model/types';
import { codesOf, unitsOfRows } from '../../model/units';
import type { ViewStatus } from '../../model/viewRegistry';
import { PICKED_COLOR } from '../../plots/viewer3d/ThreeViewport';
import { NO_PATHS_HERE } from '../../plots/viewer3d/useLoggingLayers';
import { SampleColourSelect, SampleRampSettings, TableBesideSwitch, TableColourSelect, TableWidthSlider } from '../scene/ColouredBy';
import { useSampleColouring } from '../viewColouring';
import { MODEL_PANEL_IDS, showModelPane } from '../modellingApi';
import { coordsFor, useTargetView } from '../targetView';
import { Caption, Fact, NoViewNote, ShownBox } from './parts';
import { smallButton } from './styles';
import { t } from '../../model/terms';

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
/** The width slider runs this many powers of ten either side of the automatic width (as in the view's own settings) */
const WIDTH_DECADES = 1.3;
const formatWidth = (w: number) => (w >= 10 ? String(Math.round(w)) : String(Number(w.toPrecision(2))));
const NO_MAPS: UnitMap[] = [];

/** How the samples are coloured, shaped and sized, in a line each, and the way to the Attributes pane */
const Styling: React.FC<{ viewId: string | null }> = ({ viewId }) => {
    const columns = useAppStore(s => s.columns);
    const color = useAttributeStore(s => s.color.field);
    const shape = useAttributeStore(s => s.shape.field);
    const size = useAttributeStore(s => s.size.field);
    const name = (f: string | null, none: string) => (f ? getColumnDisplayName(columns, f) : none);
    return (
        <>
            <Caption>Colour, shape and size (the same in every plot and view)</Caption>
            <Fact>Colour: {name(color, 'one colour')}{viewId && <OwnColour viewId={viewId} />}</Fact>
            <Fact>Shape: {name(shape, 'one shape')}</Fact>
            <Fact>Size: {name(size, 'one size')}</Fact>
            <Button size="small" sx={{ ...smallButton, mt: 0.5 }} startIcon={<Palette fontSize="small" />} onClick={() => showModelPane(MODEL_PANEL_IDS.attributes)}>
                Colour, shape, size and filters…
            </Button>
        </>
    );
};

/** Said after the Attributes pane's colour when the view colours the samples itself */
const OwnColour: React.FC<{ viewId: string }> = ({ viewId }) => {
    const [own] = useSampleColouring(viewId);
    return own ? <> (not in this view: it colours them itself)</> : null;
};

/** How one view draws the samples */
const SamplesInView: React.FC<{ viewId: string; status: ViewStatus | null }> = ({ viewId, status }) => {
    const [cylinders, setCylinders] = usePlotSetting(viewId, 'cylinders3d', false);
    const [savedWidth, setWidth] = usePlotSetting<number | null>(viewId, 'cylinderWidth', null);
    const [bySize, setBySize] = usePlotSetting(viewId, 'cylinderSizeByAttribute', true);
    const [pointScale, setPointScale] = usePlotSetting(viewId, 'pointScale', 1);
    const canCylinder = !!status?.canCylinder;
    const auto = status?.cylinderAuto ?? 1;
    const width = savedWidth ?? auto;
    const asCylinders = cylinders && canCylinder;
    return (
        <>
            <Caption>Drawn as</Caption>
            <ToggleButtonGroup
                size="small" exclusive value={asCylinders ? 'cylinders' : 'points'} aria-label="Drawn as"
                onChange={(_, v) => { if (v) setCylinders(v === 'cylinders'); }}
            >
                <ToggleButton value="points" sx={{ textTransform: 'none', py: 0.25 }}>Points</ToggleButton>
                <ToggleButton value="cylinders" disabled={!canCylinder} sx={{ textTransform: 'none', py: 0.25 }}>Cylinders down the holes</ToggleButton>
            </ToggleButtonGroup>
            {status && !canCylinder && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    Cylinders need hole IDs and From and To depths.
                </Typography>
            )}
            <SampleColourSelect viewId={viewId} />
            <Box sx={{ mt: 1 }}><SampleRampSettings viewId={viewId} /></Box>
            {asCylinders ? (
                <Box sx={{ mt: 1 }}>
                    <Typography variant="caption" sx={{ display: 'flex' }}>
                        Width {formatWidth(width)} m{savedWidth === null ? ' (automatic)' : ''}
                        {savedWidth !== null && <Button size="small" sx={{ ...smallButton, ml: 'auto', minWidth: 0, py: 0 }} onClick={() => setWidth(null)}>Automatic</Button>}
                    </Typography>
                    <Slider
                        size="small" min={-WIDTH_DECADES} max={WIDTH_DECADES} step={0.02} value={Math.log10(width / auto)}
                        aria-label="Cylinder width" scale={v => auto * 10 ** v} valueLabelDisplay="auto" valueLabelFormat={v => `${formatWidth(v)} m`}
                        onChange={(_, v) => setWidth(Number((auto * 10 ** (v as number)).toPrecision(2)))}
                    />
                    <FormControlLabel
                        sx={{ ml: -0.5 }} control={<Switch size="small" checked={bySize} onChange={e => setBySize(e.target.checked)} />}
                        label={<Typography variant="caption">Width follows the Size attribute</Typography>}
                    />
                </Box>
            ) : (
                <Box sx={{ mt: 1 }}>
                    <Typography variant="caption">Point size ×{pointScale}</Typography>
                    <Slider
                        size="small" min={0.25} max={4} step={0.25} value={pointScale} aria-label="Point size"
                        valueLabelDisplay="auto" onChange={(_, v) => setPointScale(v as number)}
                    />
                </Box>
            )}
        </>
    );
};

export const SamplesEditor: React.FC = () => {
    const rows = useAppStore(s => s.columnarData.rowCount);
    const target = useTargetView();
    return (
        <Box data-testid="samples-editor">
            <Typography variant="subtitle2">Samples</Typography>
            <Fact>{plural(rows, 'row')} of the dataset</Fact>
            <ShownBox visKeys={[keys.dataset]} />
            {target.id ? <SamplesInView key={target.id} viewId={target.id} status={target.status} /> : <NoViewNote what="draw the samples" />}
            <Styling viewId={target.id} />
        </Box>
    );
};

/** How one view draws a logging table: what it is coloured by, how wide, and how many of its holes it can be placed on */
const TableInView: React.FC<{ table: HoleTable; viewId: string; status: ViewStatus | null; coords: SceneCoords | null }> = ({ table, viewId, status, coords }) => {
    const db = useDrillholeStore(s => s.db);
    const coordsKey = JSON.stringify(coords);
    const coverage = useMemo(() => {
        const paths = pathsFor(coords);
        return { ...tableCoverage(table, paths), paths: paths.size };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the coordinates by value; the paths change with the tables
    }, [table, coordsKey, db]);
    return (
        <>
            {coverage.placed === 0 ? (
                <Typography variant="caption" color="warning.main" sx={{ display: 'block' }}>
                    {coverage.paths === 0 ? NO_PATHS_HERE : 'None of its holes has a collar and survey, to place it by.'}
                </Typography>
            ) : (
                <Fact>
                    Drawn on {coverage.placed === coverage.holes ? `all ${plural(coverage.holes, 'hole')}` : `${coverage.placed.toLocaleString()} of ${plural(coverage.holes, 'hole')} (the rest have no collar and survey here)`}
                </Fact>
            )}
            <TableColourSelect viewId={viewId} table={table} />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                A column the samples are coloured by takes their colours (the Attributes pane); a set of units, its own.
            </Typography>
            <Box sx={{ mt: 1 }}>
                <TableWidthSlider viewId={viewId} tableId={table.id} auto={status?.cylinderAuto ?? 1} />
                <TableBesideSwitch viewId={viewId} tableId={table.id} />
            </Box>
        </>
    );
};

const depth = (v: number | undefined) => (v !== undefined && Number.isFinite(v) ? `${Number(v.toFixed(2))}` : '?');

/** The interval of the table clicked in a view: its hole and depths, what was logged in it, and its unit in each set of units made from the table */
const PickedInterval: React.FC<{ table: HoleTable }> = ({ table }) => {
    const pick = useModellingStore(s => s.loggedPick);
    const maps = useModelStore(s => s.scene.unitMaps) ?? NO_MAPS;
    const row = pick && pick.table === table.id && pick.row < table.hole.length ? pick.row : -1;
    const units = useMemo(() => {
        if (row < 0) return [];
        return maps.filter(m => m.table === table.id).flatMap(m => {
            const columns = m.columns.map(c => tableText(table, c));
            if (columns.some(c => !c)) return [];
            const log = { hole: table.hole, from: table.from, to: table.to, code: codesOf(columns as string[][]) };
            const unit = unitsOfRows(log, m)[row], logged = unitsOfRows(log, m, true)[row];
            // (A short stretch of a cleaned unit: read as the unit round it, or left out)
            const cleaned = unit !== logged ? `${unit || 'left out'} (a short stretch of ${logged})` : null;
            return [{ map: m.name, unit: cleaned ?? (unit || 'in no unit'), color: m.units.find(u => u.name === unit)?.color ?? null }];
        });
    }, [maps, table, row]);
    if (row < 0) return null;
    return (
        <Box data-testid="picked-interval" sx={{ mt: 1, px: 1, py: 0.75, border: 1, borderColor: PICKED_COLOR, borderRadius: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <Typography variant="caption" sx={{ fontWeight: 600, flex: 1 }}>
                    {table.hole[row]}, {depth(table.from[row])} to {depth(table.to?.[row])} m
                </Typography>
                <Button size="small" sx={{ ...smallButton, minWidth: 0, py: 0 }} onClick={() => useModellingStore.getState().setLoggedPick(null)}>Clear</Button>
            </Box>
            {table.columns.map(c => {
                const v = c.values[row];
                const text = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : v;
                return (
                    <Box key={c.name} sx={{ display: 'flex', gap: 1 }}>
                        <Typography variant="caption" color="text.secondary" noWrap sx={{ flex: 1, minWidth: 0 }}>{c.name}</Typography>
                        <Typography variant="caption" noWrap>{text || 'not logged'}</Typography>
                    </Box>
                );
            })}
            {units.map(u => (
                <Box key={u.map} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ flex: 1, minWidth: 0 }}>{u.map}</Typography>
                    {u.color && <Box component="span" sx={{ width: 10, height: 10, bgcolor: u.color, border: 1, borderColor: 'divider', borderRadius: 0.25 }} />}
                    <Typography variant="caption" noWrap>{u.unit}</Typography>
                </Box>
            ))}
        </Box>
    );
};

export const TableEditor: React.FC<{ table: HoleTable }> = ({ table }) => {
    const target = useTargetView();
    const coords = () => coordsFor(target);
    const holes = new Set(table.hole).size;
    return (
        <Box data-testid="table-editor">
            <Typography variant="subtitle2" noWrap>{table.name}</Typography>
            <Fact>{table.to ? 'Intervals logged down the holes' : 'Depths down the holes (structural measurements)'}</Fact>
            <Fact>{table.to ? plural(table.hole.length, 'interval') : plural(table.hole.length, 'depth')} in {plural(holes, 'hole')}</Fact>
            {table.to && (
                <>
                    <PickedInterval table={table} />
                    <ShownBox visKeys={[keys.table(table.id)]} />
                    {target.id && target.status
                        ? <TableInView key={target.id} table={table} viewId={target.id} status={target.status} coords={coords()} />
                        : <NoViewNote what="draw the logging down the holes" />}
                </>
            )}
            <Caption>Columns</Caption>
            {table.columns.map(c => (
                <Box key={c.name} sx={{ display: 'flex', gap: 1 }}>
                    <Typography variant="caption" noWrap sx={{ flex: 1, minWidth: 0 }}>{c.name}</Typography>
                    <Typography variant="caption" color="text.secondary">{c.values instanceof Float64Array ? 'numbers' : 'codes'}</Typography>
                </Box>
            ))}
            {table.to && (
                <Button size="small" variant="outlined" fullWidth sx={{ textTransform: 'none', mt: 1 }} onClick={() => openModelDialog('units', coords(), 'new')}>
                    {t('lithologies')} from its logging…
                </Button>
            )}
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                A logging table is kept as it was read. To change it, delete it and add it again (Drillholes, Add a logging table).
            </Typography>
        </Box>
    );
};

export const CollarsEditor: React.FC<{ name: string }> = ({ name }) => {
    const db = useDrillholeStore(s => s.db);
    const target = useTargetView();
    const holes = db ? new Set(db.collar.hole).size : 0;
    const tracesHere = !!target.status?.hasTraces;
    return (
        <Box data-testid="collars-editor">
            <Typography variant="subtitle2">{name}</Typography>
            {db && holes > 0 ? (
                <>
                    <Fact>{plural(holes, 'hole')}, {plural(db.survey.hole.length, 'survey reading')}</Fact>
                    <Fact>Holes follow their surveys (minimum curvature)</Fact>
                    {db.tables.length > 0 && <Fact>{plural(db.tables.length, 'logging table')}</Fact>}
                </>
            ) : (
                <Fact>Drawn through each hole&apos;s samples, in depth order</Fact>
            )}
            <ShownBox visKeys={[keys.collars]} what="Traces" />
            {target.id && !tracesHere && target.status && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    {target.title} has no hole column to draw traces by.
                </Typography>
            )}
            <Tooltip title={tracesHere ? `List the holes in ${target.title}, to find one, zoom to it or look along it` : 'Open a 3D view of holes first.'}>
                <span>
                    <Button
                        size="small" sx={{ ...smallButton, mt: 0.5 }} startIcon={<Search fontSize="small" />} disabled={!tracesHere}
                        onClick={() => { if (target.id) useAppStore.getState().updatePlotSettings(target.id, { holePanel3d: true }); }}
                    >
                        Find a hole…
                    </Button>
                </span>
            </Tooltip>
            <NoViewNote what="show the hole traces" />
        </Box>
    );
};
