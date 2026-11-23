/**
 * A geological model in the properties, under five tabs. Units: the grouping
 * of logged codes it reads, and its base unit. Ground: the box it is built
 * in, its top, the size of its cells. Age order: its contacts, the youngest
 * at the top, each with its type, the side its younger ground is on and the
 * unit that is there; and making them from its units. Faults: what cuts it
 * into blocks. Outputs: the volume of each unit, the checks against the
 * logging, its export. (Its name, whether it is shown and deleting it are in
 * the head of its editor; how its build stands is said over the tabs.)
 */
import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, Checkbox, FormControlLabel, MenuItem, TextField, Tooltip, Typography } from '@mui/material';
import { AccountTree, OpenInNew } from '@mui/icons-material';
import { useModelStore } from '../../../store/modelStore';
import { sequenceState, setModelSequence } from '../../model/geoModelActions';
import { guessContact, MAX_CONTACTS, modelProblemList, modelUnits, unitColor } from '../../model/geoModel';
import { keys, type ModelGroupPart } from '../../model/objectKeys';
import type { GeoModel } from '../../model/types';
import { exportModelKit } from '../../model/modelKitActions';
import { MODEL_TAB_NAME, MODEL_TAB_OF, MODEL_TABS, useEditorTabs, type ModelTab } from '../editorTabs';
import { MODEL_PANEL_IDS, showModelPane } from '../modellingApi';
import { BuildChronology } from './BuildChronology';
import { ChronologyTable } from './ChronologyTable';
import { EditorHeader } from './EditorHeader';
import { EditorPart as Part, EditorTabBar } from './EditorTabs';
import { ModelGround, ModelStatus, ModelVolumes } from './ModelBuild';
import { ModelChecks } from './ModelChecks';
import { ModelFaults } from './ModelFaults';
import { Caption } from './parts';
import { smallButton } from './styles';
import { UnitField } from './UnitField';
import { UnitPanel } from './UnitPanel';
import { t } from '../../model/terms';
import { Term } from '../Term';

const select = { SelectDisplayProps: { style: { fontSize: 13, paddingTop: 2, paddingBottom: 2 } } } as const;
const NONE = '\u0000none';

interface Props {
    model: GeoModel;
    /** The contact or the fault of it picked in the tree (null: the model itself) */
    contact: string | null;
    /** The part of the model picked in the tree: the editor opens on it */
    section?: ModelGroupPart;
    onGoTo: (key: string) => void;
    /** Its parts under tabs (Units, Ground, Age order, Faults, Outputs), one shown at a time. Left out: every part, one under the other */
    tabs?: boolean;
}

export const ModelEditor: React.FC<Props> = ({ model, contact, section, onGoTo, tabs = false }) => {
    const scene = useModelStore(s => s.scene);
    const { updateModel, addModelContact } = useModelStore.getState();
    const tab = useEditorTabs(s => s.model);
    const open: ModelTab | 'all' = tabs ? tab : 'all';
    // Picked in the tree, a part of the model, one of its contacts or one of its faults opens the tab it is under
    const wanted: ModelTab | null = section ? MODEL_TAB_OF[section]
        : !contact ? null
            : model.contacts.some(c => c.id === contact) ? 'chronology'
                : (model.faults ?? []).some(f => f.id === contact) ? 'faults' : null;
    useEffect(() => { if (wanted) useEditorTabs.getState().setModelTab(wanted); }, [wanted, model.id, contact]);
    const [adding, setAdding] = useState('');
    const picked = contact ? model.contacts.find(c => c.id === contact) ?? null : null;
    // (Read from the scene as it is now: the model and its surfaces are both props of this render)
    const sequence = sequenceState(model.id);
    const maps = scene.unitMaps ?? [];
    const map = maps.find(m => m.id === model.unitMap);
    const free = scene.surfaces.filter(s => s.rule.kind !== 'shell' && !s.blockOf && !model.contacts.some(c => c.surface === s.id));
    // Meshes from files can stand as contacts as they are
    const meshes = scene.wireframes.filter(w => !model.contacts.some(c => c.mesh === w.id));
    const problems = modelProblemList(scene, model);
    const units = modelUnits(scene, model).filter(Boolean);

    const add = (id: string) => {
        const surface = scene.surfaces.find(s => s.id === id);
        if (surface) addModelContact(model.id, { surface: id, ...guessContact(model, surface, map?.units.map(u => u.name) ?? []) });
        else if (scene.wireframes.some(w => w.id === id)) addModelContact(model.id, { mesh: id, kind: 'deposit', young: 1, unit: '' });
        setAdding('');
    };

    return (
        <Box data-testid="model-editor" sx={tabs ? { '& .MuiTypography-caption': { fontSize: '0.8125rem', lineHeight: 1.45 }, '& .MuiFormHelperText-root': { fontSize: '0.75rem', lineHeight: 1.4 } } : undefined}>
            <EditorHeader objectKey={keys.model(model.id)} name={model.name} what={t('typeModel')} icon={<AccountTree sx={{ fontSize: 18, color: 'text.secondary' }} />} />
            {problems.map(p => (
                <Alert
                    key={p.text} severity="warning" sx={{ py: 0, mt: 0.5, fontSize: 12, alignItems: 'center', '& .MuiAlert-action': { pt: 0 } }}
                    // Where it is put right: the tab is opened from here when it is another
                    action={tabs && tab !== p.part ? <Button size="small" color="inherit" data-action="go-problem" onClick={() => useEditorTabs.getState().setModelTab(p.part)} sx={{ whiteSpace: 'nowrap' }}>{MODEL_TAB_NAME[p.part].label}</Button> : undefined}
                >
                    {p.text}
                </Alert>
            ))}
            <ModelStatus model={model} />
            {tabs && <EditorTabBar tabs={MODEL_TABS} names={MODEL_TAB_NAME} value={tab} onChange={useEditorTabs.getState().setModelTab} label="The parts of the model" />}

            <Part tab="lithologies" open={open}>
                <Caption>The units it is made of</Caption>
                <TextField
                    select size="small" variant="standard" fullWidth value={map ? map.id : NONE}
                    onChange={e => updateModel(model.id, { unitMap: e.target.value === NONE ? undefined : e.target.value })}
                    SelectProps={{ SelectDisplayProps: { ...select.SelectDisplayProps, 'aria-label': 'The lithologies it reads' } as React.HTMLAttributes<HTMLDivElement> }}
                    helperText={map ? undefined : maps.length ? 'Lithologies give it its unit names and colours' : 'No lithologies yet (Drillholes: Lithologies from logging): unit names are typed'}
                    FormHelperTextProps={{ sx: { fontSize: 11, lineHeight: 1.3 } }}
                >
                    <MenuItem dense value={NONE}><em>Named here</em></MenuItem>
                    {maps.map(m => <MenuItem key={m.id} dense value={m.id}>{m.name}</MenuItem>)}
                </TextField>
                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mt: 0.75 }}>
                    <Tooltip title="The oldest unit: the ground every other unit is laid on, cut into or intruded into">
                        <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}><Term k="backgroundLithology" /></Typography>
                    </Tooltip>
                    <UnitField model={model} label={t('backgroundLithology')} value={model.base} onChange={base => updateModel(model.id, { base })} term="backgroundLithology" />
                </Box>
                {units.length > 0 && (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.75 }} aria-label="Units of the model, oldest first">
                        {units.map(u => (
                            <Box key={u} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: unitColor(scene, model, u) }} />
                                <Typography variant="caption">{u}</Typography>
                            </Box>
                        ))}
                    </Box>
                )}
            </Part>

            <Part tab="boundary" open={open}>
                <Caption><Term k="boundary" /></Caption>
                <ModelGround model={model} />
            </Part>

            <Part tab="chronology" open={open}>
                <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1 }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}><Caption><Term k="chronology" after=": the youngest at the top" /></Caption></Box>
                    {model.contacts.length > 0 && (
                        <Tooltip title="The same list in a window of its own over the views: a line to a surface, with room to read across">
                            <Button size="small" sx={smallButton} startIcon={<OpenInNew sx={{ fontSize: '14px !important' }} />} data-action="open-chronology" onClick={() => showModelPane(MODEL_PANEL_IDS.chronology)}>
                                Open as a table
                            </Button>
                        </Tooltip>
                    )}
                </Box>
                <ChronologyTable model={model} picked={contact} onGoTo={onGoTo} />
                {/* The unit of the row picked, opened here: what it is built as, its check, the settings of its surface */}
                {picked && <UnitPanel key={picked.id} model={model} contact={picked} onGoTo={onGoTo} />}
                {sequence !== 'none' && (
                    <Box data-testid="model-sequence">
                        <Tooltip describeChild placement="left" title="Its layers laid down one on another are fitted together: the contact with the most holes through it first, each of the others alongside its neighbour. They cannot cross, and a layer missing in some holes pinches out. Unticked, each contact is fitted on its own.">
                            <FormControlLabel
                                sx={{ mt: 0.5, ml: -0.75 }}
                                control={<Checkbox size="small" sx={{ p: 0.5 }} checked={sequence === 'on'} onChange={e => setModelSequence(model.id, e.target.checked)} />}
                                label={<Typography variant="caption">Its layers are one sequence: they cannot cross</Typography>}
                            />
                        </Tooltip>
                    </Box>
                )}
                {map && <BuildChronology model={model} map={map} />}
                <TextField
                    select size="small" variant="standard" fullWidth value={adding} sx={{ mt: 1 }} disabled={free.length + meshes.length === 0 || model.contacts.length >= MAX_CONTACTS}
                    onChange={e => add(e.target.value)}
                    SelectProps={{
                        displayEmpty: true,
                        renderValue: () => <em>{free.length + meshes.length ? 'Add a surface…' : scene.surfaces.length ? 'Every surface is in it' : 'No surfaces in the project yet'}</em>,
                        SelectDisplayProps: { ...select.SelectDisplayProps, 'aria-label': 'Add a surface to the chronology' } as React.HTMLAttributes<HTMLDivElement>,
                    }}
                >
                    {free.map(s => <MenuItem key={s.id} dense value={s.id}>{s.name}</MenuItem>)}
                    {meshes.map(w => <MenuItem key={w.id} dense value={w.id}>{w.name} (a mesh, used as it is)</MenuItem>)}
                </TextField>
            </Part>

            <Part tab="faults" open={open}>
                <ModelFaults model={model} picked={contact} onGoTo={onGoTo} />
            </Part>

            <Part tab="outputs" open={open}>
                <ModelVolumes model={model} />
                <ModelChecks model={model} />
                <Caption>To build it again elsewhere</Caption>
                <Tooltip title="One zip: a note, its chronology, faults and units as tables, the Leapfrog export of every surface in it, its unit solids as meshes, and the model itself to open again here (Properties with nothing picked: Versions of the scene)">
                    <span><Button size="small" sx={{ textTransform: 'none', fontSize: 12 }} data-action="export-kit" onClick={() => exportModelKit(model.id)}>{t('leapfrogExport')} (.zip)</Button></span>
                </Tooltip>
            </Part>
        </Box>
    );
};
