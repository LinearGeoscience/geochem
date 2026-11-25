/**
 * Where a numeric model's shells are kept (Phase 233): a geological model,
 * one or several of its lithologies, and one of its fault blocks when it is
 * cut by faults. Set once here for every shell of the model. And the way to
 * a numeric model for each lithology of a geological model, in one step.
 */
import React, { useState } from 'react';
import { Box, Button, Checkbox, FormControlLabel, TextField, Typography } from '@mui/material';
import { useModelStore } from '../../../store/modelStore';
import { blockNames, modelUnits } from '../../model/geoModel';
import { useGeoModelCache } from '../../model/geoModelCache';
import { numericModelsByUnit } from '../../model/sceneActions';
import { blockOf, domainText, domainUnits, isSolids, makeDomain, makeSolids, sidesOfBlock, solidChoices, solidStateNote, solidsText, unitDomain } from '../../model/shellDomains';
import { solidStates, useModelCache } from '../../model/modelCache';
import { t } from '../../model/terms';
import type { Domain, NumericModel } from '../../model/types';
import { Fact } from './parts';
import { smallButton } from './styles';

const NONE = '', SOLIDS = '\u0000solids';
const select = { native: true, inputProps: { style: { fontSize: 13, paddingTop: 2, paddingBottom: 2 } } } as const;

export const NumericDomain: React.FC<{ model: NumericModel }> = ({ model }) => {
    const scene = useModelStore(s => s.scene);
    const geoModels = scene.models ?? [];
    // (Ground of a geological model, or the inside of solids of the scene)
    const domain = unitDomain(model.domain), solid = isSolids(model.domain) ? model.domain : null;
    const geo = geoModels.find(g => g.id === domain?.model) ?? null;
    const built = useGeoModelCache(s => (domain ? s.byId[domain.model] : undefined));
    const [note, setNote] = useState('');
    const set = (next: Domain | null) => { setNote(''); useModelStore.getState().updateNumericModel(model.id, { domain: next }); };
    const choices = solidChoices(scene, model.shells.map(s => s.surface));
    // (The fits: a solid that is fitted again is looked at again)
    useModelCache(s => s.byId);
    const first = scene.surfaces.find(s => s.id === model.shells[0]?.surface);
    const states = solid && first ? solidStates(first) : [];
    const has = (c: (typeof choices)[number]) => !!solid?.solids.some(x => x.kind === c.ref.kind && x.id === c.ref.id);

    const units = geo ? modelUnits(scene, geo) : [];
    const picked = domain ? domainUnits(domain) : [];
    const faults = built?.faults ?? [], blocks = built?.out?.blocks ?? [];
    const names = geo && blocks.length > 1 ? blockNames(scene, geo, faults, blocks) : [];
    const block = domain ? blockOf(domain.sides, faults, blocks) : -1;
    /** The model a numeric model is made for each lithology of: the one these shells are kept in, else the first there is */
    const target = geo ?? geoModels[0] ?? null;

    if (geoModels.length === 0 && choices.length === 0 && !model.domain) return null;
    return (
        <Box data-testid="numeric-domain">
            <Typography variant="subtitle2" sx={{ mt: 1.5 }}>{t('domain')}</Typography>
            <TextField
                select size="small" variant="standard" fullWidth SelectProps={select} value={geo ? geo.id : solid ? SOLIDS : NONE} inputProps={{ 'aria-label': 'What the shells are kept inside', 'data-field': 'domain-model' }}
                onChange={e => {
                    if (e.target.value === SOLIDS) { set(makeSolids(choices.slice(0, 1).map(c => c.ref))); return; }
                    const next = geoModels.find(g => g.id === e.target.value);
                    set(next ? makeDomain(next.id, modelUnits(scene, next).slice(0, 1)) : null);
                }}
            >
                <option value={NONE}>Nothing: the shells go where their samples take them</option>
                {geoModels.map(g => <option key={g.id} value={g.id}>{`Lithologies of ${g.name}`}</option>)}
                {(choices.length > 0 || solid) && <option value={SOLIDS}>Solids: veins, intrusions, shells, closed meshes</option>}
            </TextField>
            {solid && (
                <>
                    <Box data-testid="domain-solids" sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 1.5, mt: 0.5 }}>
                        {choices.map(c => (
                            <FormControlLabel
                                key={`${c.ref.kind}:${c.ref.id}`} sx={{ mr: 0 }} label={<Typography variant="body2">{`${c.name} (${c.what})`}</Typography>}
                                control={(
                                    <Checkbox
                                        size="small" sx={{ p: 0.25, mr: 0.5 }} checked={has(c)} inputProps={{ 'data-solid': `${c.ref.kind}:${c.ref.id}` } as React.InputHTMLAttributes<HTMLInputElement>}
                                        // (The last one stays ticked: ground of no solid is no ground; "Nothing" above is that)
                                        disabled={solid.solids.length === 1 && has(c)}
                                        onChange={e => set(makeSolids(e.target.checked ? [...solid.solids, c.ref] : solid.solids.filter(x => !(x.kind === c.ref.kind && x.id === c.ref.id))))}
                                    />
                                )}
                            />
                        ))}
                    </Box>
                    <Typography data-testid="domain-said" variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                        {`Only the samples inside ${solidsText(solid, scene) || 'solids that are no longer in the project'} are used, and each shell stops at the faces of that ground: values do not carry out of it. The shells are made again when those solids change.`}
                    </Typography>
                    {states.flatMap(s => { const said = solidStateNote(s.name, s.state); return said ? [said] : []; }).map(said => (
                        <Typography key={said} data-testid="domain-solid-note" variant="caption" color="warning.main" sx={{ display: 'block', mt: 0.25 }}>{said}</Typography>
                    ))}
                </>
            )}
            {domain && !solid && !geo && <Fact>The geological model it was kept inside is no longer in the project: the shells go where their samples take them.</Fact>}
            {domain && geo && (
                <>
                    <Box data-testid="domain-units" sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 1.5, mt: 0.5 }}>
                        {units.map(u => (
                            <FormControlLabel
                                key={u} sx={{ mr: 0 }} label={<Typography variant="body2">{u}</Typography>}
                                control={(
                                    <Checkbox
                                        size="small" sx={{ p: 0.25, mr: 0.5 }} checked={picked.includes(u)} inputProps={{ 'data-unit': u } as React.InputHTMLAttributes<HTMLInputElement>}
                                        // (The last one stays ticked: a domain of no lithology is no domain; "Nothing" above is that)
                                        disabled={picked.length === 1 && picked[0] === u}
                                        onChange={e => set(makeDomain(geo.id, e.target.checked ? units.filter(x => x === u || picked.includes(x)) : picked.filter(x => x !== u), domain.sides))}
                                    />
                                )}
                            />
                        ))}
                    </Box>
                    {(names.length > 1 || (domain.sides?.length ?? 0) > 0) && (
                        <TextField
                            select size="small" variant="standard" fullWidth SelectProps={select} sx={{ mt: 0.5 }} value={block >= 0 ? String(block) : NONE}
                            inputProps={{ 'aria-label': 'The fault block the shells are kept inside', 'data-field': 'domain-block' }}
                            onChange={e => set(makeDomain(geo.id, picked, e.target.value === NONE ? undefined : sidesOfBlock(faults, blocks[Number(e.target.value)] ?? [])))}
                        >
                            <option value={NONE}>Every fault block</option>
                            {names.map((name, i) => <option key={name + i} value={String(i)}>{`Only ${name}`}</option>)}
                        </TextField>
                    )}
                    <Typography data-testid="domain-said" variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                        {`Only the samples in ${domainText(domain, geo.name, block >= 0 ? names[block] : null)} are used, and each shell stops at the faces of that ground: values do not carry across a contact${names.length > 1 ? ' or a fault' : ''}. The shells are made again when that model changes.`}
                    </Typography>
                </>
            )}
            {target && (
                <Button
                    size="small" variant="outlined" data-action="numeric-by-unit" sx={{ ...smallButton, mt: 0.75 }}
                    onClick={() => {
                        const made = numericModelsByUnit(model.id, target.id);
                        setNote(made.length === 0 ? `There is one for each lithology of ${target.name} already.`
                            : `${made.length} numeric model${made.length === 1 ? '' : 's'} made, one for each lithology of ${target.name}: the same column, cut-offs and settings, each kept inside its own lithology.`);
                    }}
                >
                    {`A model for each lithology of ${target.name}`}
                </Button>
            )}
            {note && <Typography data-testid="domain-note" variant="caption" sx={{ display: 'block', mt: 0.5 }}>{note}</Typography>}
        </Box>
    );
};
