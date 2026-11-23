/**
 * How a geological model is built, in its properties, in three pieces: the
 * state of the build (over the editor's tabs), what was built (each unit's
 * volume, under Outputs), and the ground it covers (a box, with a top surface
 * and an outline, the size of its cells and whether it is rebuilt by itself,
 * under Boundary).
 */
import React, { useMemo, useState } from 'react';
import { Alert, Box, Button, Checkbox, FormControlLabel, MenuItem, TextField, Tooltip, Typography } from '@mui/material';
import { useModelStore } from '../../../store/modelStore';
import { modelBox, modelCell } from '../../model/boundary';
import { BoxField } from './BoxField';
import { formatMetres, formatVolume } from '../../model/describe';
import { blockNames, insideOf, modelUnits } from '../../model/geoModel';
import { volumesCsv } from '../../model/geoModelActions';
import { cancelModelBuild, rebuildModel, useGeoModelCache, type ModelResult } from '../../model/geoModelCache';
import { downloadText } from '../../../utils/gisExport';
import { sceneDataBox } from '../../model/modelCache';
import { modelDataBox, modelDrilling } from '../../model/modelDrilling';
import { shareNear } from '../../model/modelGround';
import { keys } from '../../model/objectKeys';
import type { Box3, GeoModel } from '../../model/types';
import { addTopographyFile, topoNote, type TopoNote } from '../../model/topoImport';
import { modelThinnest } from '../../model/unitActions';
import { pickTopographyFile } from '../../plots/viewer3d/wireframeLoad';
import { useShownObjects } from '../../../hooks/useViewVisibility';
import { Caption, Fact } from './parts';
import { smallButton } from './styles';
import { t, termProps } from '../../model/terms';
import { Term } from '../Term';

const NONE = '\u0000none', FROM_FILE = '\u0000file';
const AXES = ['East', 'North', 'Height'] as const;

/** What the build is doing, in a line */
function buildNote(result: ModelResult | undefined, asked: number | null, inside = false, thin: { unit: string; usual: number } | null = null): { text: string; severity: 'info' | 'warning' | 'success' } {
    if (!result) return { text: 'Not built yet.', severity: 'info' };
    switch (result.state) {
        case 'building': return { text: 'Building…', severity: 'info' };
        case 'waiting': return { text: inside ? 'Waiting for its surfaces to be fitted, and for the model it is inside to be built.' : 'Waiting for its surfaces to be fitted.', severity: 'info' };
        case 'empty': return { text: inside ? 'It has no ground to be built in: the model it is inside is not built, or has not that unit.' : 'It has no box to be built in: load data, or set its box.', severity: 'warning' };
        case 'stale': return result.stopped
            ? { text: result.out ? 'Its build was stopped: what is shown is as it was built before.' : 'Its build was stopped: it is not built yet.', severity: 'warning' }
            : { text: 'Something it is built from has changed since it was built.', severity: 'warning' };
        case 'failed': return { text: `It could not be built: ${result.error ?? 'unknown error'}`, severity: 'warning' };
        default: {
            const g = result.out!.grid;
            // Cells made finer than the box alone gives, for a thin unit: said, with the unit
            const finer = !asked && thin && result.box && g.cell < modelCell(result.box, null) * 0.99
                ? ` Finer than its size alone gives: ${thin.unit} usually runs only ${formatMetres(thin.usual)} down a hole.` : '';
            return { text: `Built in ${(result.out!.ms / 1000).toFixed(1)} s: ${g.n.map(v => v - 2).join(' × ')} cells of ${formatMetres(g.cell)}.${finer}${asked && g.cell > asked * 1.01 ? ` Cells of ${formatMetres(asked)} would be too many: it is built with the smallest it can be.` : ''}`, severity: 'success' };
        }
    }
}

/** The state of its build, with stopping it and building it again */
export const ModelStatus: React.FC<{ model: GeoModel }> = ({ model }) => {
    const result = useGeoModelCache(s => s.byId[model.id]);
    const models = useModelStore(s => s.scene.models);
    const thin = model.cell === null && result?.state === 'ready' && result.contacts.length > 0 ? modelThinnest(model, result.units) : null;
    const note = buildNote(result, model.cell, !!insideOf(models, model), thin);
    return (
        <Box data-testid="model-build">
            <Alert severity={note.severity} sx={{ py: 0, mt: 0.75, fontSize: 12 }} action={result?.state === 'building' ? (
                // (What was built before stays up; the model then waits to be asked, or for something it is built from to change)
                <Button size="small" color="inherit" data-action="stop-build" sx={{ textTransform: 'none', fontSize: 12 }} onClick={() => cancelModelBuild(model.id)}>Stop</Button>
            ) : (result?.state === 'stale' || result?.state === 'failed' || model.auto === false) ? (
                <Button size="small" color="inherit" data-action="rebuild" sx={{ textTransform: 'none', fontSize: 12 }} onClick={() => rebuildModel(model.id)}>{result?.stopped && !result.out ? 'Build now' : 'Rebuild now'}</Button>
            ) : undefined}>
                {note.text}
            </Alert>
        </Box>
    );
};

/** What was built: the units with none or next to none of them in it, each unit's volume, and the fault blocks */
export const ModelVolumes: React.FC<{ model: GeoModel }> = ({ model }) => {
    const surfaces = useModelStore(s => s.scene.surfaces);
    const wireframes = useModelStore(s => s.scene.wireframes);
    const result = useGeoModelCache(s => s.byId[model.id]);
    const visibility = useShownObjects();
    const models = useModelStore(s => s.scene.models);
    const parent = insideOf(models, model);
    const volumes = result?.out ? result.units.map((u, i) => ({ unit: u, color: result.colors[i], volume: result.out!.volumes[i] })).filter(v => v.volume > 0) : [];
    const total = volumes.reduce((n, v) => n + v.volume, 0);
    // Units the build has, with no ground in it (a thin one is measured from its own surface: not these)
    const none = result?.state === 'ready' && result.out
        ? result.units.filter((_, i) => !(result.out!.volumes[i] > 0) && !result.out!.thin?.some(x => x.unit === i))
        : [];
    // Units with next to none: under a thousandth of the model (a thin one, measured from its own surface, is meant to be small)
    const little = result?.state === 'ready' && result.out && total > 0
        ? result.units.filter((_, i) => result.out!.volumes[i] > 0 && result.out!.volumes[i] < total / 1000 && !result.out!.thin?.some(x => x.unit === i))
        : [];
    // Units whose solid shows well under what they hold: thinner than the cells in places (the solids have one corner to a cell)
    const broken = result?.state === 'ready' && result.out?.solids
        ? result.units.flatMap((unit, i) => {
            const all = result.out!.volumes[i], solid = result.out!.solids[i];
            return all > 0 && solid < 0.95 * all ? [{ unit, share: Math.round(100 * Math.max(solid, 0) / all) }] : [];
        })
        : [];
    const solids = result?.units.map(u => keys.volume(model.id, u)) ?? [];
    // Cut by faults: the blocks with ground in them, and how much
    const blocks = result?.out && result.out.blocks.length > 1
        ? blockNames({ surfaces, wireframes }, model, result.faults, result.out.blocks).map((name, slot) => ({ name, volume: result.out!.blockVolumes[slot].reduce((a, b) => a + b, 0) })).filter(b => b.volume > 0)
        : [];

    return (
        <Box data-testid="model-volumes">
            {none.length > 0 && (
                <Alert data-testid="no-ground" severity="warning" sx={{ py: 0, mt: 0.5, fontSize: 12 }}>
                    {total <= 0 && parent
                        ? `It has no ground: ${parent.model.name} has none of ${parent.unit} to be inside.`
                        : `${none.join(', ')}: none of ${none.length === 1 ? 'it' : 'them'} in the model. Look at ${none.length === 1 ? 'its contact' : 'their contacts'} in the chronology: which side is the younger, what kind it is (a body that cuts the others is an intrusion), and whether its surface is where the logging puts it. Units that come back again and again down the holes cannot all be layers: "Check against drilling" says how much of each the model has right.`}
                </Alert>
            )}
            {little.length > 0 && (
                <Alert data-testid="little-ground" severity="warning" sx={{ py: 0, mt: 0.5, fontSize: 12 }}>
                    {`${little.join(', ')}: next to none of ${little.length === 1 ? 'it' : 'them'} in the model (under a thousandth of it). If ${little.length === 1 ? 'it is' : 'they are'} logged more than that, the chronology or the kind of a contact is not what the logging says: "Check against drilling" shows which units the model has wrong.`}
                </Alert>
            )}

            {volumes.length > 0 && (
                <>
                    <Caption><Term k="outputVolumes" after=", the oldest unit first" /></Caption>
                    {volumes.map(v => (
                        <Box key={v.unit} data-testid="unit-volume" sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                            <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: v.color, flexShrink: 0 }} />
                            <Typography variant="caption" noWrap sx={{ flex: 1, minWidth: 0 }}>{v.unit}</Typography>
                            <Typography variant="caption" color="text.secondary">{formatVolume(v.volume)} · {Math.round(100 * v.volume / total)}%</Typography>
                        </Box>
                    ))}
                    {broken.length > 0 && (
                        <Typography data-testid="broken-solids" variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.3, my: 0.25 }}>
                            {`${broken.map(b => `${b.unit} (its solid shows ${b.share}% of it)`).join(', ')}: thinner than the model's cells in places, where ${broken.length === 1 ? 'its solid has' : 'their solids have'} gaps. ${broken.length === 1 ? 'Its volume here is' : 'Their volumes here are'} counted from the surfaces and sections are drawn from them, so both are right. A smaller resolution closes the gaps.`}
                        </Typography>
                    )}
                    {(result?.out?.thin?.length ?? 0) > 0 && (
                        <Typography data-testid="thin-units" variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.3, my: 0.25 }}>
                            {`${[...new Set(result!.out!.thin!.map(x => result!.units[x.unit]))].join(', ')}: thinner than two of the model's cells, so drawn and measured from ${result!.out!.thin!.length === 1 ? 'its' : 'their'} own surface${result!.out!.thin!.length === 1 ? '' : 's'}. What ${result!.out!.thin!.length === 1 ? 'it holds' : 'they hold'} is taken out of the units ${result!.out!.thin!.length === 1 ? 'it is' : 'they are'} in, and ${result!.out!.thin!.length === 1 ? 'it stops' : 'they stop'} at the model's faults, its boundary and its younger units.`}
                        </Typography>
                    )}
                    {blocks.length > 0 && <Caption>{`Its ${blocks.length} fault blocks`}</Caption>}
                    {blocks.map(b => (
                        <Box key={b.name} data-testid="block-volume" sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
                            <Typography variant="caption" data-testid="block-name" sx={{ flex: 1, minWidth: 0, lineHeight: 1.3 }}>{b.name}</Typography>
                            <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>{formatVolume(b.volume)} · {Math.round(100 * b.volume / total)}%</Typography>
                        </Box>
                    ))}
                    <Tooltip title="Hide everything else in the view: only the units' solids and the model's box stay">
                        <span><Button size="small" sx={{ ...smallButton, mt: 0.5 }} disabled={!visibility.plotId} onClick={() => visibility.showOnly([keys.model(model.id), ...solids])}>Show only its solids</Button></span>
                    </Tooltip>
                    <Tooltip title="The volumes as a table (.csv): unit, cubic metres, share">
                        <Button size="small" sx={{ ...smallButton, mt: 0.5, ml: 0.5 }} onClick={() => { const csv = volumesCsv(model.id); if (csv) downloadText(csv, `${model.name} volumes.csv`, 'text/csv'); }}>Volumes (.csv)</Button>
                    </Tooltip>
                </>
            )}
            {volumes.length === 0 && none.length === 0 && <Fact>Each unit's volume is listed here once the model is built.</Fact>}
        </Box>
    );
};

/** The ground it covers: inside a unit of another model or not, its box, its top, its outline, the size of its cells */
export const ModelGround: React.FC<{ model: GeoModel }> = ({ model }) => {
    const { updateModel } = useModelStore.getState();
    const surfaces = useModelStore(s => s.scene.surfaces);
    const wireframes = useModelStore(s => s.scene.wireframes);
    const result = useGeoModelCache(s => s.byId[model.id]);
    const models = useModelStore(s => s.scene.models);
    const parent = insideOf(models, model);
    // Every unit of every other model that is not, in turn, inside this one
    const homes = (models ?? []).filter(m => m.id !== model.id && insideOf(models, { ...model, boundary: { ...model.boundary, inside: { model: m.id, unit: '' } } }) !== null)
        .flatMap(m => modelUnits({ surfaces, wireframes }, m).map(unit => ({ value: `${m.id}\u0000${unit}`, text: `${unit}, in ${m.name}` })));
    const home = model.boundary.inside ? `${model.boundary.inside.model}\u0000${model.boundary.inside.unit}` : NONE;
    const own = model.boundary.box;
    // What the box is when none is set: that of the holes its lithologies are logged in (of all the data when it reads none), with a margin
    const drilling = modelDrilling(model);
    const auto = modelBox(null, modelDataBox(model));
    // Kept near its drilling: how far, and how much of its box that is
    const near = model.boundary.near ?? null;
    const reach = near?.reach ?? drilling?.reach ?? null;
    const shown = own ?? auto;
    const within = useMemo(
        () => (drilling && reach && shown ? shareNear({ places: drilling.places, reach }, shown) : null),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the box by its numbers
        [drilling, reach, shown?.min.join(), shown?.max.join()],
    );
    // A fitted sheet, or a mesh from a file (a topography) as it is
    const tops = [...surfaces.filter(s => !s.blockOf && (s.rule.kind === 'sheet' || s.rule.kind === 'contact')), ...wireframes.map(w => ({ id: w.id, name: `${w.name} (a mesh)` }))];
    const outlined = surfaces.filter(s => s.params.outline);
    // A file of heights read for its top: what was read, and anything to look at
    const [topoSaid, setTopoSaid] = useState<TopoNote | null>(null);
    const topFromFile = () => {
        void pickTopographyFile().then(async file => {
            if (!file) return;
            const made = await addTopographyFile(file, sceneDataBox());
            setTopoSaid(topoNote(made.notes));
            if (made.id) updateModel(model.id, { boundary: { top: made.id } });
        });
    };

    const setSide = (side: 'min' | 'max', k: number, v: number | null) => {
        const from: Box3 | null = own ?? auto;
        if (!from) return;
        const next: Box3 = { min: [...from.min], max: [...from.max] };
        next[side][k] = v ?? (auto ?? from)[side][k];
        updateModel(model.id, { boundary: { box: next } });
    };

    return (
        <Box data-testid="model-ground">
            {(homes.length > 0 || model.boundary.inside) && (
                <TextField
                    select size="small" variant="standard" fullWidth value={home !== NONE && !homes.some(h => h.value === home) ? NONE : home} sx={{ mb: 0.5 }}
                    onChange={e => {
                        const [id, unit] = e.target.value.split('\u0000');
                        updateModel(model.id, { boundary: { inside: e.target.value === NONE ? null : { model: id, unit } } });
                    }}
                    SelectProps={{ SelectDisplayProps: { ...termProps('refinedModelOf'), style: { fontSize: 13 } } as React.HTMLAttributes<HTMLDivElement> }}
                    helperText={parent
                        ? `It has ground only where ${parent.model.name} has ${parent.unit}: its units split that one up (alteration, weathering or mineralisation inside a rock type). It is built again when ${parent.model.name} is.`
                        : `${t('refinedModelOf')}: a unit of another model that this one splits up further`}
                    FormHelperTextProps={{ sx: { fontSize: 11, lineHeight: 1.3 } }}
                >
                    <MenuItem dense value={NONE}><em>Nothing: it fills its own box</em></MenuItem>
                    {homes.map(h => <MenuItem key={h.value} dense value={h.value}>{h.text}</MenuItem>)}
                </TextField>
            )}
            {AXES.map((axis, k) => (
                <Box key={axis} sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ width: 44, flexShrink: 0 }}>{axis}</Typography>
                    <BoxField label={`${axis} from`} value={own ? own.min[k] : null} hint={auto?.min[k] ?? null} onCommit={v => setSide('min', k, v)} />
                    <Typography variant="caption" color="text.secondary">to</Typography>
                    <BoxField label={`${axis} to`} value={own ? own.max[k] : null} hint={auto?.max[k] ?? null} onCommit={v => setSide('max', k, v)} />
                </Box>
            ))}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }} data-testid="model-box-from">{own ? 'A box set here' : parent ? `The box of ${parent.model.name}` : drilling?.box ? `The box of its drilling (${drilling.holes.toLocaleString()} logged hole${drilling.holes === 1 ? '' : 's'}), with a margin` : auto ? 'The box of the data, with a margin' : 'No data to take a box from'}</Typography>
                {own && <Button size="small" sx={smallButton} onClick={() => updateModel(model.id, { boundary: { box: null } })}>{drilling?.box ? 'From its drilling' : 'From the data'}</Button>}
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: 11, lineHeight: 1.3 }}>
                In a 3D view, with the model picked, each face of its box has a handle: drag one to move that face.
            </Typography>
            {drilling && drilling.reach !== null && (
                <Box data-testid="model-near" sx={{ mt: 0.25 }}>
                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
                        <Tooltip title="Ground further than this from every hole the model reads is left out of it: its units are not carried into ground no hole is near. Gaps between holes narrower than the distance are filled, so that the ground is whole where it is drilled. The distance, when none is typed, is how far apart its holes are: the gap at which nearly all of its drilling is linked, hole to hole, into one piece.">
                            <FormControlLabel
                                sx={{ mr: 0, flex: 1, '& .MuiFormControlLabel-label': { fontSize: 12 } }}
                                control={<Checkbox size="small" sx={{ py: 0.25 }} checked={!!near} inputProps={{ 'aria-label': 'Only near its drilling' }} onChange={e => updateModel(model.id, { boundary: { near: e.target.checked ? { reach: null } : null } })} />}
                                label="Only near its drilling, within (m)"
                            />
                        </Tooltip>
                        <Box sx={{ width: 64, display: 'flex' }}>
                            <BoxField label="How far from its drilling (m)" value={near?.reach ?? null} hint={drilling.reach} onCommit={v => updateModel(model.id, { boundary: { near: { reach: v && v > 0 ? v : null } } })} />
                        </Box>
                    </Box>
                    {within !== null && reach !== null && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: 11, lineHeight: 1.3 }}>
                            {near
                                ? `Ground further than ${Math.round(reach)} m from every hole it reads is left out: ${Math.round(100 * within)}% of its box is nearer than that. Gaps between holes narrower than that are filled.`
                                : within < 0.5
                                    ? `It fills its box, and ${Math.round(100 * (1 - within))}% of the box is further than ${Math.round(reach)} m from every hole it reads: its units are carried there with nothing to say they are right.`
                                    : `It fills its box; ${Math.round(100 * within)}% of the box is within ${Math.round(reach)} m of a hole it reads.`}
                        </Typography>
                    )}
                </Box>
            )}
            <TextField
                select size="small" variant="standard" fullWidth value={model.boundary.top && tops.some(s => s.id === model.boundary.top) ? model.boundary.top : NONE} sx={{ mt: 0.75 }}
                onChange={e => { if (e.target.value === FROM_FILE) topFromFile(); else updateModel(model.id, { boundary: { top: e.target.value === NONE ? null : e.target.value } }); }}
                SelectProps={{ SelectDisplayProps: { ...termProps('topography'), style: { fontSize: 13 } } as React.HTMLAttributes<HTMLDivElement> }}
                helperText={model.boundary.top ? `${t('topography')}: the ground surface, above which there is nothing` : `No ${t('topography').toLowerCase()}: the model fills its box to the top, above the ground too`} FormHelperTextProps={{ sx: { fontSize: 11, lineHeight: 1.3 } }}
            >
                <MenuItem dense value={NONE}><em>The top of its box</em></MenuItem>
                {tops.map(s => <MenuItem key={s.id} dense value={s.id}>{s.name}</MenuItem>)}
                <MenuItem dense value={FROM_FILE} data-action="topography-file">From a file: a grid of heights or points…</MenuItem>
            </TextField>
            {topoSaid && <Alert severity={topoSaid.severity} data-testid="topography-said" sx={{ py: 0, mt: 0.5, '& .MuiAlert-message': { fontSize: 12 } }}>{topoSaid.text}</Alert>}
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, mt: 0.5 }}>
                <TextField
                    select size="small" variant="standard" value={NONE} sx={{ flex: 1, minWidth: 0 }} disabled={outlined.length === 0}
                    onChange={e => { const s = surfaces.find(x => x.id === e.target.value); if (s?.params.outline) updateModel(model.id, { boundary: { outline: s.params.outline } }); }}
                    SelectProps={{ SelectDisplayProps: { 'aria-label': 'Its outline', style: { fontSize: 13 } } as React.HTMLAttributes<HTMLDivElement> }}
                    helperText={model.boundary.outline ? `Kept inside an outline of ${model.boundary.outline.points.length} corners` : outlined.length ? 'An outline to be kept inside: take one drawn for a surface' : 'No surface has an outline drawn to take'}
                    FormHelperTextProps={{ sx: { fontSize: 11, lineHeight: 1.3 } }}
                >
                    <MenuItem dense value={NONE}><em>{model.boundary.outline ? 'Take another…' : 'No outline'}</em></MenuItem>
                    {outlined.map(s => <MenuItem key={s.id} dense value={s.id}>The outline of {s.name}</MenuItem>)}
                </TextField>
                {model.boundary.outline && <Button size="small" sx={smallButton} onClick={() => updateModel(model.id, { boundary: { outline: null } })}>Remove</Button>}
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1, mt: 0.75 }}>
                <Tooltip title="The size of the cells the model is built with, in metres. Smaller: finer solids, slower to build. Empty: worked out from the size of its box, and made finer where the thinnest lithology logged is thinner than two such cells. Sections are drawn from the surfaces themselves, whatever this is.">
                    <Box sx={{ flex: 1, display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
                        <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}><Term k="resolution" after=" (m)" /></Typography>
                        <BoxField label={`${t('modelResolution')} (m)`} term="modelResolution" value={model.cell} hint={result?.out?.grid.cell ?? null} onCommit={v => updateModel(model.id, { cell: v && v > 0 ? v : null })} />
                    </Box>
                </Tooltip>
            </Box>
            <Tooltip title="Off for a large model: it is then rebuilt only when Rebuild now is pressed, and says when it is out of date.">
                <FormControlLabel
                    sx={{ ml: -0.75 }}
                    control={<Checkbox size="small" sx={{ p: 0.5 }} checked={model.auto !== false} onChange={e => updateModel(model.id, { auto: e.target.checked })} inputProps={{ 'aria-label': 'Rebuild it whenever something changes' }} />}
                    label={<Typography variant="caption">Rebuild it whenever something changes</Typography>}
                />
            </Tooltip>
        </Box>
    );
};
