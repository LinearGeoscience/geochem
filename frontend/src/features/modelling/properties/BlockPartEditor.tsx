/**
 * A contact's surface in one fault block, in the properties (Phase 234). It
 * is made and kept by its model (blockParts.ts): there is nothing to change
 * here. It says what it is a part of and where, how its fit stands, and
 * leads to the surface that is edited and to the model's faults.
 */
import React from 'react';
import { Box, Link, Typography } from '@mui/material';
import { useModelStore } from '../../../store/modelStore';
import { modelBlocks, partHome, sidesText } from '../../model/blockParts';
import { faultStops, stopProblem } from '../../model/geoModel';
import { fitIsAlongside, useModelCache } from '../../model/modelCache';
import { keys } from '../../model/objectKeys';
import { t } from '../../model/terms';
import type { SurfaceObject } from '../../model/types';
import { Fact, LookRow } from './parts';

export const BlockPartEditor: React.FC<{ surface: SurfaceObject; onGoTo: (key: string) => void }> = ({ surface, onGoTo }) => {
    const scene = useModelStore(s => s.scene);
    const fit = useModelCache(s => s.byId[surface.id]);
    const from = scene.surfaces.find(s => s.id === surface.blockOf);
    const home = partHome(scene, surface);
    const me = keys.surface(surface.id);
    const sides = surface.within?.sides ?? [];
    // (A part of a fault, on one side of the younger faults that offset it; else of a contact, in one fault block)
    const ofFault = !!home?.fault && !home.contact;
    const here = ofFault ? 'on this side' : 'in this block';
    const block = home && ofFault ? sidesText(scene, home.model, sides) : home ? modelBlocks(scene, home.model).find(b => b.sides.length === sides.length && b.sides.every(e => sides.some(o => o.fault === e.fault && o.side === e.side)))?.name ?? null : null;
    // The faults of its block that stop: beside those the model does not use the part as it is all the way
    const stopping = home ? sides.flatMap(e => {
        const x = home.model.faults?.find(y => y.id === e.fault);
        if (!x || !faultStops(home.model, x) || stopProblem(scene, home.model, x)) return [];
        return [scene.surfaces.find(s => s.id === x.surface)?.name ?? scene.wireframes.find(w => w.id === x.mesh)?.name ?? 'A fault'];
    }) : [];
    const state = !fit || fit.state === 'fitting' ? 'It is being fitted.'
        : fit.state === 'failed' ? `It could not be fitted${fit.error ? `: ${fit.error}` : '.'}`
            : fit.state === 'empty' || !fit.field ? `Nothing of ${from?.name ?? 'the surface'} is ${here}: the surface through all of its data is used here.`
                : fitIsAlongside(fit.key) && !surface.conform ? `It has too little of its own ${here} to say how it lies there (a few places, or one line of holes): it has the shape ${from?.name ?? 'the surface'} has where more is known of it, at the height its own places put it here.`
                    : `It is fitted to what is ${here}.`;
    return (
        <Box data-testid="block-part-editor">
            <Typography variant="body2" color="text.secondary">{ofFault ? 'A fault on one side of a younger fault' : 'A contact surface in one fault block'}</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.5 }}>
                <Box component="span" sx={{ width: 14, height: 14, flexShrink: 0, bgcolor: surface.color, border: 1, borderColor: 'divider', borderRadius: 0.5 }} />
                <Typography variant="subtitle2" noWrap>{surface.name}</Typography>
            </Box>
            <LookRow objectKeys={[me]} visKeys={[me]} />
            <Fact>
                {ofFault
                    ? `Made by ${home?.model.name ?? 'its model'}: ${from?.name ?? 'a fault'} fitted to what of its points and lines is ${block ?? 'on one side'} alone. A younger fault has moved it: on the other side it is somewhere else, and has a part of its own there.`
                    : `Made by ${home?.model.name ?? 'its model'}: ${from?.name ?? 'a contact'} fitted to what of its points, lines and logging is ${block ?? 'in one fault block'} alone, so that a layer the fault offsets is right on this side of it.`}
            </Fact>
            <Typography data-testid="block-part-state" variant="caption" sx={{ display: 'block', mt: 0.5 }}>{state}</Typography>
            {stopping.length > 0 && (
                <Typography data-testid="block-part-stops" variant="caption" sx={{ display: 'block', mt: 0.5 }}>
                    {`${stopping.join(' and ')} ${stopping.length === 1 ? 'stops' : 'stop'}: towards ${stopping.length === 1 ? 'its end' : 'their ends'} the model takes this part over into ${from?.name ?? 'the surface'} as it is with no fault there, so that it runs unbroken round the end. A view shows it as the model has it.`}
                </Typography>
            )}
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                It is kept like the surface it is a part of, and goes when the faults do. To change it, change
                {' '}
                {from ? <Link component="button" type="button" data-action="go-whole" onClick={() => onGoTo(keys.surface(from.id))}>{from.name}</Link> : 'that surface'}
                {home ? (
                    <>
                        {ofFault ? '; what offsets it is set in the ' : '; the blocks are set by the '}
                        <Link component="button" type="button" data-action="go-faults" onClick={() => onGoTo(keys.modelGroup(home.model.id, 'faults'))}>{t('faultSystem').toLowerCase()}</Link>
                        {` of ${home.model.name}.`}
                    </>
                ) : '.'}
            </Typography>
        </Box>
    );
};
