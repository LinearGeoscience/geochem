/**
 * The other objects in the properties: a section set (looked along in the
 * view, spaced and widened), a set of model units (grouped in the units
 * dialog) and a mesh from a file. (A logging table: DrillholeEditors.)
 */
import React, { useMemo, useState } from 'react';
import { Box, Button, MenuItem, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { GridOn, ViewDay, Visibility } from '@mui/icons-material';
import { useAppStore } from '../../../store/appStore';
import { useModelStore } from '../../../store/modelStore';
import { MAX_MODEL_VIEWS } from '../../../store/modellingStore';
import { newModelView } from '../modellingApi';
import { openModelDialog } from '../../model/modelDialogs';
import { keys } from '../../model/objectKeys';
import { openEdges, openEdgesText } from '../../model/openEdges';
import { formatVolume } from '../../model/describe';
import { useGeoModelCache } from '../../model/geoModelCache';
import { agreementText } from '../../model/sectionFigure';
import { downloadSection, sectionChoices, sectionLogging, sectionToReport, setToReport } from '../../model/sectionReport';
import { describeSectionSet } from '../../model/sectionSets';
import { notClosed, solidSize } from '../../model/solidGround';
import type { SectionSet, UnitMap, WireframeObject } from '../../model/types';
import { useWireframeFiles } from '../../model/wireframeFiles';
import { Num } from '../../plots/viewer3d/SectionsMenu';
import { coordsFor, useTargetView } from '../targetView';
import { OpacityRow } from './CommitSlider';
import { GradeBlock } from './GradeBlock';
import { Caption, ColourField, Fact, LookRow, NameField, NoViewNote } from './parts';
import { smallButton } from './styles';

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export const SectionSetEditor: React.FC<{ set: SectionSet }> = ({ set }) => {
    const { updateSectionSet } = useModelStore.getState();
    const target = useTargetView();
    const viewing = target.status?.viewingSet === set.id;
    const full = useAppStore(s => s.modelViews.length >= MAX_MODEL_VIEWS);
    return (
        <Box data-testid="section-set-editor">
            <NameField objectKey={keys.sectionSet(set.id)} name={set.name} />
            <Fact>{describeSectionSet(set)}</Fact>
            <Stack direction="row" spacing={1} sx={{ mt: 1.25 }}>
                <Num label="Spacing (m)" value={set.spacing} onCommit={v => updateSectionSet(set.id, { spacing: v })} />
                <Num label="Width (m)" value={set.width} onCommit={v => updateSectionSet(set.id, { width: v })} />
            </Stack>
            <Tooltip title={target.status ? `Look along the set square-on in ${target.title}, and step from section to section` : 'Open a 3D view first.'}>
                <span>
                    <Button
                        size="small" variant={viewing ? 'contained' : 'outlined'} fullWidth startIcon={<Visibility fontSize="small" />} sx={{ textTransform: 'none', mt: 1.25 }}
                        disabled={!target.status?.ready} onClick={() => target.actions()?.lookAlong(set.id)}
                    >
                        {viewing ? `Looking along it in ${target.title}` : 'Look along it'}
                    </Button>
                </span>
            </Tooltip>
            <NoViewNote what="look along it" />
            <Tooltip title={full ? `At most ${MAX_MODEL_VIEWS} views can be open` : 'A view of its own, square-on to the set, beside the others: what is drawn there shows in them at once'}>
                <span>
                    <Button size="small" fullWidth startIcon={<ViewDay fontSize="small" />} sx={{ textTransform: 'none', mt: 0.5 }} disabled={full} onClick={() => newModelView('section')}>
                        Open a section view on it
                    </Button>
                </span>
            </Tooltip>
            <SectionDrawings set={set} />
        </Box>
    );
};

/** A geological model drawn on the sections of a set: into the report, or saved as a picture or as linework */
const SectionDrawings: React.FC<{ set: SectionSet }> = ({ set }) => {
    const models = useModelStore(s => s.scene.models) ?? [];
    const built = useGeoModelCache(s => s.byId);
    const ready = models.filter(m => built[m.id]?.out);
    const [chosen, setChosen] = useState('');
    const [at, setAt] = useState<number | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [said, setSaid] = useState<string | null>(null);
    if (models.length === 0) return null;
    const model = ready.find(m => m.id === chosen) ?? ready[0];
    // (Asked again when the set or the model's build changes)
    const choices = model ? sectionChoices(model.id, set.id) : [];
    const index = choices.some(c => c.index === at) ? at! : choices[Math.floor(choices.length / 2)]?.index ?? null;
    const one = async () => {
        if (!model || index === null) return;
        setBusy('Drawing it…');
        const ok = await sectionToReport(model.id, set.id, index);
        setBusy(null);
        setSaid(ok ? 'It is in the report, as its last figure.' : 'It could not be drawn.');
    };
    const all = async () => {
        if (!model) return;
        setBusy(`Drawing ${choices.length.toLocaleString()} sections…`);
        const made = await setToReport(model.id, set.id, (done, of) => setBusy(`Drawing the sections: ${done} of ${of}…`));
        setBusy(null);
        setSaid(made > 0 ? `${made.toLocaleString()} ${made === 1 ? 'section is' : 'sections are'} in the report, in order.` : 'None could be drawn.');
    };
    return (
        <Box data-testid="section-drawings" sx={{ mt: 1.5 }}>
            <Caption>A geological model drawn on it</Caption>
            {!model ? <Fact>No geological model is built yet.</Fact> : (
                <>
                    {ready.length > 1 && (
                        <TextField
                            select size="small" variant="standard" fullWidth value={model.id} onChange={e => { setChosen(e.target.value); setSaid(null); }}
                            SelectProps={{ SelectDisplayProps: { 'aria-label': 'The model to draw', style: { fontSize: 13 } } as React.HTMLAttributes<HTMLDivElement> }}
                        >
                            {ready.map(m => <MenuItem key={m.id} dense value={m.id}>{m.name}</MenuItem>)}
                        </TextField>
                    )}
                    {choices.length === 0 || index === null ? <Fact>None of its sections passes through {model.name}.</Fact> : (
                        <>
                            <TextField
                                select size="small" variant="standard" fullWidth value={index} sx={{ mt: 0.5 }} onChange={e => { setAt(Number(e.target.value)); setSaid(null); }}
                                SelectProps={{ SelectDisplayProps: { 'aria-label': 'The section to draw', style: { fontSize: 13 } } as React.HTMLAttributes<HTMLDivElement> }}
                                helperText={`Its units as filled outlines, its faults, the holes within ${set.width / 2} m either side with what is logged down them, a grid, a scale and a legend: true to scale`}
                                FormHelperTextProps={{ sx: { fontSize: 11, lineHeight: 1.3 } }}
                            >
                                {choices.map(c => <MenuItem key={c.index} dense value={c.index}>{c.label}</MenuItem>)}
                            </TextField>
                            <SectionLogged modelId={model.id} set={set} index={index} />
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.75 }}>
                                <Button size="small" variant="outlined" sx={smallButton} disabled={!!busy} onClick={() => { void one(); }}>To the report</Button>
                                <Tooltip title={`All ${choices.length.toLocaleString()} sections of the set that pass through ${model.name}, each as a figure, in order`}>
                                    <span><Button size="small" variant="outlined" sx={smallButton} disabled={!!busy} onClick={() => { void all(); }}>{`Every section to the report (${choices.length.toLocaleString()})`}</Button></span>
                                </Tooltip>
                                <Tooltip title="The picture as it goes into the report, to open in a drawing program">
                                    <Button size="small" sx={smallButton} onClick={() => downloadSection(model.id, set.id, index, 'svg')}>Picture (.svg)</Button>
                                </Tooltip>
                                <Tooltip title="The outlines of the units, the faults and the holes as lines where they are in the ground, a layer each, for a CAD or mining package">
                                    <Button size="small" sx={smallButton} onClick={() => downloadSection(model.id, set.id, index, 'dxf')}>Linework (.dxf)</Button>
                                </Tooltip>
                            </Box>
                            {(busy || said) && <Typography data-testid="section-said" variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>{busy ?? said}</Typography>}
                        </>
                    )}
                </>
            )}
        </Box>
    );
};

/** How much of the logging on the chosen section the model has as logged: said before the section is drawn */
const SectionLogged: React.FC<{ modelId: string; set: SectionSet; index: number }> = ({ modelId, set, index }) => {
    const out = useGeoModelCache(s => s.byId[modelId]?.out);
    const data = useAppStore(s => s.columnarData);
    const maps = useModelStore(s => s.scene.unitMaps);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read again when the build, the data, the lithologies or the set change
    const told = useMemo(() => sectionLogging(modelId, set.id, index), [modelId, set, index, out, data, maps]);
    if (!told) return null;
    return <Typography data-testid="section-logged" variant="caption" sx={{ display: 'block', mt: 0.5 }}>{agreementText(told).join(' ')}</Typography>;
};

export const UnitMapEditor: React.FC<{ map: UnitMap; tableName: string | null }> = ({ map, tableName }) => {
    const surfaces = useModelStore(s => s.scene.surfaces);
    const target = useTargetView();
    const coords = () => coordsFor(target);
    const readers = surfaces.filter(s => !s.blockOf && (s.rule.kind === 'contact' || s.rule.kind === 'body') && s.rule.units === map.id);
    return (
        <Box data-testid="unit-map-editor">
            <NameField objectKey={keys.unitMap(map.id)} name={map.name} />
            <Fact>From {map.columns.join(' + ')} {tableName ? `of ${tableName}` : map.table ? 'of a logging table no longer in the project' : 'of the samples'}</Fact>
            {map.reassigned.length > 0 && <Fact>{plural(map.reassigned.length, 'stretch', 'stretches')} of hole given to a unit by hand</Fact>}
            <Caption>Units, in order down the holes</Caption>
            {map.units.map(u => (
                <Box key={u.name} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, py: 0.125 }}>
                    <Box sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: u.color, flexShrink: 0 }} />
                    <Typography variant="caption" noWrap sx={{ flex: 1, minWidth: 0 }}>{u.name}</Typography>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: '50%' }}>{u.codes.length === 1 && u.codes[0] === u.name ? '' : u.codes.join(', ')}</Typography>
                </Box>
            ))}
            <Button size="small" variant="outlined" fullWidth sx={{ textTransform: 'none', mt: 1 }} onClick={() => openModelDialog('units', coords(), map.id)}>
                Group, split and colour the units…
            </Button>
            <Caption>Read by</Caption>
            <Typography variant="caption" color={readers.length ? 'text.primary' : 'text.secondary'}>
                {readers.length ? readers.map(s => s.name).join(', ') : 'No surface reads these units yet.'}
            </Typography>
        </Box>
    );
};

const FILE_STATE: Record<string, string> = {
    loading: 'Its file is being read.',
    missing: 'Its file is not in the project folder.',
};

export const MeshEditor: React.FC<{ mesh: WireframeObject }> = ({ mesh }) => {
    const { updateWireframe } = useModelStore.getState();
    const file = useWireframeFiles(s => s.byFile[mesh.file]);
    const part = file?.parts[mesh.part];
    const key = keys.wireframe(mesh.id);
    // Whether it is closed (it then has an inside: ground a shell can be kept in, samples that can be counted) and what it holds
    const solid = useMemo(() => {
        if (!part || part.triangles.length === 0) return null;
        const field = { vertices: part.vertices, triangles: part.triangles };
        return notClosed([field]).length > 0 ? { closed: false as const, where: openEdgesText(openEdges(field)) } : { closed: true as const, volume: solidSize(field).volume };
    }, [part]);
    return (
        <Box data-testid="mesh-editor">
            <NameField objectKey={key} name={mesh.name} />
            <LookRow objectKeys={[key]}>
                <ColourField value={mesh.color} name={mesh.name} onChange={color => updateWireframe(mesh.id, { color })} />
            </LookRow>
            <Fact>From {mesh.file}</Fact>
            {part ? <Fact>{plural(part.triangles.length / 3, 'triangle')}{part.lines.length ? `, ${plural(part.lines.length / 2, 'line segment')}` : ''}</Fact>
                : <Typography variant="caption" color="warning.main" sx={{ display: 'block' }}>{file?.state === 'error' ? `Its file could not be read: ${file.error}` : FILE_STATE[file?.state ?? 'missing'] ?? FILE_STATE.missing}</Typography>}
            {solid && (
                <Typography data-testid="mesh-closed" variant="caption" color={solid.closed ? 'text.secondary' : 'warning.main'} sx={{ display: 'block' }}>
                    {solid.closed ? `Closed: it holds ${formatVolume(solid.volume)}.`
                        : solid.where ? `Not closed: ${solid.where} It has no inside, so nothing can be kept inside it or counted in it.`
                            : 'Not closed (an edge of it is open): it has no inside, so nothing can be kept inside it or counted in it.'}
                </Typography>
            )}
            <OpacityRow value={mesh.opacity} onCommit={opacity => updateWireframe(mesh.id, { opacity })} />
            <Button
                size="small" sx={smallButton} startIcon={<GridOn fontSize="small" />} color={mesh.showEdges ? 'primary' : 'inherit'}
                aria-pressed={mesh.showEdges} onClick={() => updateWireframe(mesh.id, { showEdges: !mesh.showEdges })}
            >
                Triangle edges
            </Button>
            {solid?.closed && <GradeBlock of={{ kind: 'mesh', id: mesh.id }} />}
        </Box>
    );
};
