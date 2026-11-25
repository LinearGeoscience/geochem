/**
 * A numeric model laid along the sheets of a body or a vein (Phase 283):
 * the plane a thin-sheets intrusion, a vein or a vein system says its
 * sheets lie in, set as the model's own in one step. Every shell of it then
 * carries further along that plane than across it, and only its shells are
 * fitted again. What is set, and whose sheets lie that way now, is said.
 */
import React, { useMemo, useState } from 'react';
import { Box, Button, TextField, Typography } from '@mui/material';
import { useAppStore } from '../../../store/appStore';
import { useModelStore } from '../../../store/modelStore';
import { lieText, liesApart, PLANE_STRENGTH, planeTrend, SAME_LIE } from '../../model/numericPlane';
import { sheetsSources, sourceText } from '../../model/sheetsSources';
import { structureText } from '../../model/structure';
import type { NumericModel } from '../../model/types';
import { BoxField } from './BoxField';
import { smallButton } from './styles';

const select = { native: true } as const;
const times = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

export const NumericPlane: React.FC<{ model: NumericModel }> = ({ model }) => {
    const scene = useModelStore(s => s.scene);
    const data = useAppStore(s => s.columnarData);
    const [picked, setPicked] = useState('');
    const [strength, setStrength] = useState<number | null>(null);
    const [said, setSaid] = useState('');
    const shells = model.shells.map(s => scene.surfaces.find(x => x.id === s.surface)).filter((s): s is NonNullable<typeof s> => !!s);
    const sources = useMemo(
        () => sheetsSources(scene, new Set(model.shells.map(s => s.surface))),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the surfaces, the logging and the lithologies they read
        [scene.surfaces, scene.veinSystems, scene.unitMaps, scene.coords, data, model.shells],
    );
    const first = shells[0];
    // (A proportion is carried along its sheets by its own rule)
    if (!first || model.rule.of) return null;
    const own = first.params.trendOwn ?? null;
    const shared = shells.every(s => JSON.stringify(s.params.trendOwn ?? null) === JSON.stringify(own));
    const now = shared ? own : null;
    if (sources.length === 0 && !now) return null;

    const like = now ? sources.filter(s => liesApart(s.lie, now) <= SAME_LIE) : [];
    // Unless another is picked, the one it lies along now (Phase 305: a new model is laid along one as it is made)
    const closest = now ? like.reduce<typeof like[number] | null>((b, s) => (!b || liesApart(s.lie, now) < liesApart(b.lie, now) ? s : b), null) : null;
    const source = sources.find(s => s.id === picked) ?? closest ?? sources[0] ?? null;
    const want = strength ?? (now && now.strength > 1 ? now.strength : PLANE_STRENGTH);
    const same = !!now && !!source && liesApart(source.lie, now) < 0.05 && now.strength === want;

    const set = () => {
        if (!source) return;
        const got = planeTrend(source.lie, now, want);
        useModelStore.getState().updateNumericModel(model.id, { trend: got });
        setSaid(`Set for ${shells.length === 1 ? 'its shell' : `its ${shells.length} shells`}: ${lieText(source.lie)}, as the sheets of ${source.name} lie (${sourceText(source.from)}), ${times(got.strength)} times further along that plane than across it.`
            + ' Only these shells are fitted again. It can be changed for any one of them under Trend.');
    };
    const takeAway = () => {
        if (!now) return;
        useModelStore.getState().updateNumericModel(model.id, { trend: null });
        setSaid(`The plane is taken away from its shells${now.lineTrend !== null ? ', and the plunge that was set in it' : ''}: they follow the project's global trend, if it has one.`);
    };

    return (
        <Box data-testid="numeric-plane">
            <Typography variant="subtitle2" sx={{ mt: 1.5 }}>Along the sheets of a body or a vein</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                {`Highs that sit in thin sheets (dykes, veins) carry further along the plane of the sheets than across it. With no plane, a shell is drawn round each run of high ${model.rule.column} as it comes. The plane is taken from a body or a vein fitted to the sheets, and set for every shell of this model.`}
            </Typography>
            {now && (
                <Typography data-testid="numeric-plane-now" variant="body2" sx={{ mt: 0.5 }}>
                    {`Now: ${structureText(now)}, ${times(now.strength)} times further along that plane than across it`
                        + (like.length > 0 ? `: as the sheets of ${like.map(s => s.name).join(', ')} lie.` : sources.length > 0 ? '. No body or vein here has its sheets in that plane now.' : '.')}
                </Typography>
            )}
            {sources.length > 0 && (
                <Box sx={{ display: 'flex', gap: 0.75, mt: 0.5, alignItems: 'baseline' }}>
                    <TextField
                        select size="small" variant="standard" SelectProps={select} sx={{ flex: 1, minWidth: 0 }} value={source?.id ?? ''}
                        inputProps={{ 'aria-label': 'The body or vein whose sheets it lies along', 'data-field': 'plane-source', style: { fontSize: 13 } }}
                        onChange={e => setPicked(e.target.value)}
                    >
                        {sources.map(s => <option key={s.id} value={s.id}>{`${s.name}: ${lieText(s.lie)}`}</option>)}
                    </TextField>
                    <Box sx={{ width: 56, display: 'flex' }}>
                        <BoxField label="Times further along the plane than across it" value={strength} hint={now && now.strength > 1 ? now.strength : PLANE_STRENGTH} exact onCommit={v => setStrength(v !== null && v > 1 ? v : null)} />
                    </Box>
                </Box>
            )}
            <Box sx={{ display: 'flex', gap: 0.75, mt: 0.5, flexWrap: 'wrap' }}>
                {source && <Button size="small" variant="outlined" data-action="numeric-plane-set" sx={smallButton} disabled={same} onClick={set}>Lie along its sheets</Button>}
                {now && <Button size="small" variant="text" data-action="numeric-plane-clear" sx={smallButton} onClick={takeAway}>Take the plane away</Button>}
            </Box>
            {source && !same && (
                <Typography data-testid="numeric-plane-source" variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                    {`${source.name}: ${lieText(source.lie)} (${sourceText(source.from)}).`}
                </Typography>
            )}
            {said && <Typography data-testid="numeric-plane-said" variant="caption" sx={{ display: 'block', mt: 0.5 }}>{said}</Typography>}
        </Box>
    );
};
