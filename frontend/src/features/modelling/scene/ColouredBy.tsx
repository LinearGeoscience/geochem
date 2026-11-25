/**
 * "Coloured by" for the samples and the logging tables, in the view the
 * Scene list (or the properties) speaks of: a drop-down of what they can be
 * coloured by and, behind a button, how (the samples' ramp, its range, a log
 * scale or classes; a table's width). The same view settings as the
 * properties' controls (features/modelling/viewColouring), so they agree.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Box, Button, FormControlLabel, IconButton, ListSubheader, MenuItem, Popover, Slider, Switch, TextField, Tooltip, Typography } from '@mui/material';
import { Tune } from '@mui/icons-material';
import { useAnalyticalStore } from '../../../store/appStore';
import { useDrillholeStore } from '../../../store/drillholeStore';
import { isNumericColumn } from '../../../types/columnarData';
import { generateColorsFromPalette } from '../../../utils/colorPalettes';
import type { HoleTable } from '../../model/drillholes';
import { keys, parseKey } from '../../model/objectKeys';
import { autoRange, DEFAULT_RAMP, formatLegendValue, isCodes, parseBreaks, SAMPLE_RAMPS, type SampleColouring } from '../../model/sampleColour';
import type { SceneRow } from '../../model/sceneList';
import { smallButton } from '../properties/styles';
import { useTargetView } from '../targetView';
import { useSampleColouring, useSampleColumnChoices, useTableBeside, useTableColouring, useTableWidth } from '../viewColouring';

/** The value of the samples' drop-down that leaves them as the Attributes pane colours them */
export const AS_ATTRIBUTES = '';
/** The width slider runs this many powers of ten either side of the automatic width */
const WIDTH_DECADES = 1.3;
const formatWidth = (w: number) => (w >= 10 ? String(Math.round(w)) : String(Number(w.toPrecision(2))));
/** The drop-down in a row of the Scene list */
const ROW_SELECT = { width: 168, flexShrink: 0, '& .MuiInputBase-input': { fontSize: 12, py: 0.25 } } as const;

const rampCss = (ramp: string) => `linear-gradient(to right, ${generateColorsFromPalette(ramp, 9).join(', ')})`;

/** The drop-down of what the samples are coloured by in a view */
export const SampleColourSelect: React.FC<{ viewId: string; row?: boolean }> = ({ viewId, row }) => {
    const [colouring, setColouring] = useSampleColouring(viewId);
    const choices = useSampleColumnChoices();
    const value = colouring && choices.some(c => c.value === colouring.column) ? colouring.column : AS_ATTRIBUTES;
    const items: React.ReactNode[] = [<MenuItem key="" value={AS_ATTRIBUTES} dense>As in the Attributes pane</MenuItem>];
    let group = '';
    for (const c of choices) {
        if (c.group !== group) { group = c.group; items.push(<ListSubheader key={`g:${group}`} sx={{ lineHeight: '28px', fontSize: 12 }}>{group}</ListSubheader>); }
        items.push(<MenuItem key={c.value} value={c.value} dense>{c.label}</MenuItem>);
    }
    return (
        <TextField
            select size="small" variant={row ? 'standard' : 'outlined'} fullWidth={!row} label={row ? undefined : 'Coloured by in this view'}
            value={value} sx={row ? ROW_SELECT : { mt: 1 }}
            inputProps={{ ...(row ? { 'aria-label': 'Samples coloured by' } : {}), 'data-testid': 'samples-coloured-by' }}
            SelectProps={{ displayEmpty: true, MenuProps: { slotProps: { paper: { sx: { maxHeight: 420 } } } } }}
            onChange={e => {
                const column = e.target.value;
                // A new column starts from its own range; the ramp chosen stays
                setColouring(column ? { column, ...(colouring?.ramp ? { ramp: colouring.ramp } : {}) } : null);
            }}
        >
            {items}
        </TextField>
    );
};

/** A number typed in, kept when it is left or Enter is pressed (empty: from the data) */
const NumberBox: React.FC<{ label: string; value: number | null | undefined; auto: number; onChange: (v: number | null) => void }> = ({ label, value, auto, onChange }) => {
    const [text, setText] = useState(value == null ? '' : String(value));
    useEffect(() => { setText(value == null ? '' : String(value)); }, [value]);
    const commit = () => {
        const t = text.trim();
        const v = t === '' ? null : Number(t);
        if (v === null || Number.isFinite(v)) onChange(v);
        else setText(value == null ? '' : String(value));
    };
    return (
        <TextField
            size="small" label={label} value={text} placeholder={formatLegendValue(auto)} sx={{ flex: 1 }}
            InputLabelProps={{ shrink: true }} inputProps={{ inputMode: 'decimal', 'aria-label': label }}
            onChange={e => setText(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); }}
        />
    );
};

/** How the samples' numbers are coloured: the ramp, its range, a log scale, or classes */
export const SampleRampSettings: React.FC<{ viewId: string }> = ({ viewId }) => {
    const [colouring, setColouring] = useSampleColouring(viewId);
    const store = useAnalyticalStore();
    const column = colouring ? store.columns.get(colouring.column) : undefined;
    const numbers = column && isNumericColumn(column) && !isCodes(column) ? column : null;
    const auto = useMemo(() => (numbers ? autoRange(numbers, colouring?.log) : null), [numbers, colouring?.log]);
    const [breaksText, setBreaksText] = useState((colouring?.breaks ?? []).join(', '));
    useEffect(() => { setBreaksText((colouring?.breaks ?? []).join(', ')); }, [colouring?.breaks]);
    if (!colouring) return <Typography variant="caption" color="text.secondary">The samples take the Attributes pane&apos;s colours, as in every plot.</Typography>;
    if (!numbers || !auto) return <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Coloured by its values, the commonest first.</Typography>;
    const change = (part: Partial<SampleColouring>) => {
        const next: SampleColouring = { ...colouring, ...part };
        for (const k of Object.keys(part) as (keyof SampleColouring)[]) if (part[k] === null || part[k] === undefined) delete next[k];
        setColouring(next);
    };
    const ramp = colouring.ramp ?? DEFAULT_RAMP;
    const classes = !!colouring.breaks?.length;
    return (
        <Box data-testid="sample-ramp-settings" sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <TextField
                select size="small" label="Ramp" value={ramp} onChange={e => change({ ramp: e.target.value === DEFAULT_RAMP ? undefined : e.target.value })}
                inputProps={{ 'aria-label': 'Ramp' }}
            >
                {SAMPLE_RAMPS.map(r => (
                    <MenuItem key={r} value={r} dense sx={{ gap: 1 }}>
                        <Box component="span" sx={{ width: 64, height: 10, borderRadius: 0.5, background: rampCss(r), flexShrink: 0 }} />
                        {r}
                    </MenuItem>
                ))}
            </TextField>
            {!classes && (
                <>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                        <NumberBox label="Low" value={colouring.min} auto={auto.min} onChange={v => change({ min: v })} />
                        <NumberBox label="High" value={colouring.max} auto={auto.max} onChange={v => change({ max: v })} />
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        <FormControlLabel
                            sx={{ ml: -0.5, flex: 1 }} control={<Switch size="small" checked={auto.log} onChange={e => change({ log: e.target.checked })} />}
                            label={<Typography variant="caption">Log scale</Typography>}
                        />
                        <Tooltip title={`The 2nd to the 98th percentile of its values${colouring.log === undefined ? ', on a log scale where they spread over more than a power of ten' : ''}`}>
                            <span>
                                <Button size="small" sx={{ ...smallButton, py: 0 }} disabled={colouring.min == null && colouring.max == null && colouring.log === undefined} onClick={() => change({ min: null, max: null, log: undefined })}>
                                    From the data
                                </Button>
                            </span>
                        </Tooltip>
                    </Box>
                </>
            )}
            <TextField
                size="small" label="Classes at" value={breaksText} placeholder="e.g. 0.1, 0.5, 1, 5" InputLabelProps={{ shrink: true }}
                helperText={classes ? 'Coloured in steps between these values' : 'Empty: along the ramp'}
                inputProps={{ 'aria-label': 'Classes at' }}
                onChange={e => setBreaksText(e.target.value)}
                onBlur={() => change({ breaks: parseBreaks(breaksText).length ? parseBreaks(breaksText) : undefined })}
                onKeyDown={e => { if (e.key === 'Enter') change({ breaks: parseBreaks(breaksText).length ? parseBreaks(breaksText) : undefined }); }}
            />
        </Box>
    );
};

/** The drop-down of what a table is coloured by in a view */
export const TableColourSelect: React.FC<{ viewId: string; table: HoleTable; row?: boolean }> = ({ viewId, table, row }) => {
    const { value, choices, set } = useTableColouring(viewId, table);
    return (
        <TextField
            select size="small" variant={row ? 'standard' : 'outlined'} fullWidth={!row} label={row ? undefined : 'Coloured by'} value={value}
            sx={row ? ROW_SELECT : { mt: 1.25 }} onChange={e => set(e.target.value)}
            inputProps={{ ...(row ? { 'aria-label': `${table.name} coloured by` } : {}), 'data-testid': 'table-coloured-by' }}
        >
            {choices.map(c => (
                <MenuItem key={c.value} value={c.value} dense>
                    {c.label}
                    <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>{c.kind === 'units' ? '' : c.kind}</Typography>
                </MenuItem>
            ))}
        </TextField>
    );
};

/** How wide a view draws a table (its own width; automatic until set) */
export const TableWidthSlider: React.FC<{ viewId: string; tableId: string; auto: number }> = ({ viewId, tableId, auto }) => {
    const [saved, setWidth] = useTableWidth(viewId, tableId);
    const width = saved ?? auto;
    return (
        <Box>
            <Typography variant="caption" sx={{ display: 'flex' }}>
                {saved === null ? 'Width: automatic' : `Width ${formatWidth(width)} m`} (this table)
                {saved !== null && <Button size="small" sx={{ ...smallButton, ml: 'auto', minWidth: 0, py: 0 }} onClick={() => setWidth(null)}>Automatic</Button>}
            </Typography>
            <Slider
                size="small" min={-WIDTH_DECADES} max={WIDTH_DECADES} step={0.02} value={Math.min(WIDTH_DECADES, Math.max(-WIDTH_DECADES, Math.log10(width / auto)))}
                aria-label="Logging width" scale={v => auto * 10 ** v} valueLabelDisplay="auto" valueLabelFormat={v => `${formatWidth(v)} m`}
                onChange={(_, v) => setWidth(Number((auto * 10 ** (v as number)).toPrecision(2)))}
            />
        </Box>
    );
};

/** Whether a view draws a table beside the holes, clear of the samples, or round them */
export const TableBesideSwitch: React.FC<{ viewId: string; tableId: string }> = ({ viewId, tableId }) => {
    const [beside, setBeside] = useTableBeside(viewId, tableId);
    return (
        <Tooltip title="Round the holes, a table and the samples drawn as cylinders hide each other: beside them, both are seen at once (the logging to the right of each hole, going down it)" enterDelay={600}>
            <FormControlLabel
                sx={{ ml: -0.5 }} control={<Switch size="small" checked={beside} onChange={e => setBeside(e.target.checked)} inputProps={{ 'aria-label': 'Beside the samples' }} />}
                label={<Typography variant="caption">Beside the samples, not round them</Typography>}
            />
        </Tooltip>
    );
};

/** A button that opens how, beside a row's drop-down */
const HowButton: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => {
    const [at, setAt] = useState<HTMLElement | null>(null);
    return (
        <>
            <Tooltip title={label} enterDelay={600}>
                <IconButton size="small" aria-label={label} data-action="coloured-how" onClick={e => setAt(e.currentTarget)} sx={{ p: 0.5 }}>
                    <Tune sx={{ fontSize: 20 }} />
                </IconButton>
            </Tooltip>
            <Popover open={!!at} anchorEl={at} onClose={() => setAt(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
                <Box sx={{ p: 1.5, width: 260 }} data-testid="coloured-how">
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>{label}</Typography>
                    {children}
                </Box>
            </Popover>
        </>
    );
};

const Samples: React.FC<{ viewId: string }> = ({ viewId }) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, flexShrink: 0 }} data-coloured-by="samples">
        <SampleColourSelect viewId={viewId} row />
        <HowButton label="How the samples are coloured"><SampleRampSettings viewId={viewId} /></HowButton>
    </Box>
);

const Table: React.FC<{ viewId: string; table: HoleTable; auto: number }> = ({ viewId, table, auto }) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, flexShrink: 0 }} data-coloured-by="table">
        <TableColourSelect viewId={viewId} table={table} row />
        <HowButton label={`How ${table.name} is drawn`}>
            <TableWidthSlider viewId={viewId} tableId={table.id} auto={auto} />
            <TableBesideSwitch viewId={viewId} tableId={table.id} />
        </HowButton>
    </Box>
);

/** A row's "Coloured by" in the Scene list: the samples' and each logging table's (nothing for any other row) */
export const RowColouredBy: React.FC<{ row: SceneRow }> = ({ row }) => {
    const target = useTargetView();
    const db = useDrillholeStore(s => s.db);
    const parsed = parseKey(row.visKey);
    if (!target.id) return null;
    if (row.visKey === keys.dataset) return <Samples viewId={target.id} />;
    if (parsed?.kind !== 'table') return null;
    const table = db?.tables.find(t => t.id === parsed.id);
    if (!table?.to) return null;
    return <Table viewId={target.id} table={table} auto={target.status?.cylinderAuto ?? 1} />;
};
