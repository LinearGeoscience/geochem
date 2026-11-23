/**
 * The plunge of a numeric model's highs (Phase 272): the plunge finder run
 * on the samples the model's shells use (those its domain gives it), and its
 * answer set as the model's own in one step: every shell of it then carries
 * further down that line, and only its shells are fitted again. Offered only
 * where the scan is sure; what was set, and within which plane, is said.
 */
import React, { useState } from 'react';
import { Box, Button, LinearProgress, Typography } from '@mui/material';
import { useModelStore } from '../../../store/modelStore';
import { shellPlungeSamples } from '../../model/modelCache';
import { planeFromText, plungeStructure, withoutPlunge } from '../../model/numericPlunge';
import { usePlungeScan } from '../../model/plungeClient';
import { planeOf } from '../../model/plungeScan';
import { groundText } from '../../model/shellDomains';
import { structureText } from '../../model/structure';
import type { NumericModel } from '../../model/types';
import { smallButton } from './styles';

const bearing = (v: number) => String(Math.round(v) % 360).padStart(3, '0');
/** A line found further than this out of the plane it is put in is said to be */
const SAID_OFF = 10;

export const NumericPlunge: React.FC<{ model: NumericModel }> = ({ model }) => {
    const scene = useModelStore(s => s.scene);
    const { running, progress, result, about, error, run, stop } = usePlungeScan();
    const [problem, setProblem] = useState('');
    const [said, setSaid] = useState('');
    const shells = model.shells.map(s => scene.surfaces.find(x => x.id === s.surface)).filter((s): s is NonNullable<typeof s> => !!s);
    const first = shells[0];
    // (A proportion is carried along its sheets by its own rule: no plunge of highs to find)
    if (!first || model.rule.of) return null;

    const mine = about?.model === model.id;
    const own = first.params.trendOwn ?? null;
    const shared = shells.every(s => JSON.stringify(s.params.trendOwn ?? null) === JSON.stringify(own));
    const net = mine && result?.ok && result.chosen >= 0 ? result.nets[result.chosen] : null;
    const line = net && net.plunge !== null && net.trend !== null ? { plunge: net.plunge, trend: net.trend } : null;

    const find = () => {
        setProblem(''); setSaid('');
        const samples = shellPlungeSamples(first);
        if (samples === 'wait') { setProblem('The ground it is kept inside is still being made: try again when it is done.'); return; }
        if (!samples) { setProblem('It needs a hole column and heights (Z) to scan, and values in this column.'); return; }
        run(samples, { column: model.rule.column, selected: null, model: model.id }, null);
    };
    const set = () => {
        if (!line || !net) return;
        const band = net.band >= 0.5 && net.pole ? planeOf(net.pole) : null;
        const got = plungeStructure(line, shared ? own : null, scene.structure?.overall ?? null, band);
        useModelStore.getState().updateNumericModel(model.id, { trend: got.structure });
        setSaid(`Set for ${shells.length === 1 ? 'its shell' : `its ${shells.length} shells`}: ${structureText(got.structure)}, ${planeFromText(got.planeFrom)}.`
            + (got.off >= SAID_OFF ? ` The line found lies ${Math.round(got.off)}° out of that plane: the line in the plane nearest it is what is set.` : '')
            + ' Only these shells are fitted again. It can be changed for any one of them under Trend.');
    };
    const takeAway = () => {
        if (!own) return;
        useModelStore.getState().updateNumericModel(model.id, { trend: withoutPlunge(own) });
        setSaid('The plunge is taken away from its shells.');
    };

    return (
        <Box data-testid="numeric-plunge">
            <Typography variant="subtitle2" sx={{ mt: 1.5 }}>Plunge of its highs</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                {`The line the highs of ${model.rule.column} line up along, found from the samples its shells use${model.domain ? ` (those in ${groundText(model.domain, scene)})` : ''}, and set as the direction every shell of this model carries furthest in.`}
            </Typography>
            {shared && own && own.lineTrend !== null && (
                <Typography data-testid="numeric-plunge-now" variant="body2" sx={{ mt: 0.5 }}>{`Now: ${structureText(own)}.`}</Typography>
            )}
            <Box sx={{ display: 'flex', gap: 0.75, mt: 0.5, flexWrap: 'wrap' }}>
                {running && mine
                    ? <Button size="small" variant="outlined" sx={smallButton} onClick={stop}>Stop</Button>
                    : <Button size="small" variant="outlined" data-action="numeric-plunge-find" sx={smallButton} disabled={running} onClick={find}>Find the plunge</Button>}
                {line && net?.sure && <Button size="small" variant="contained" data-action="numeric-plunge-set" sx={smallButton} onClick={set}>{'Set as this model’s plunge'}</Button>}
                {shared && own && own.lineTrend !== null && <Button size="small" variant="text" data-action="numeric-plunge-clear" sx={smallButton} onClick={takeAway}>Take the plunge away</Button>}
            </Box>
            {running && mine && <LinearProgress variant="determinate" value={progress * 100} sx={{ mt: 0.75 }} />}
            {problem && <Typography data-testid="numeric-plunge-problem" variant="caption" color="warning.main" sx={{ display: 'block', mt: 0.5 }}>{problem}</Typography>}
            {mine && error && <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5 }}>{error}</Typography>}
            {mine && !running && result && !result.ok && (
                <Typography data-testid="numeric-plunge-answer" variant="caption" color="warning.main" sx={{ display: 'block', mt: 0.5 }}>
                    {result.reason === 'holes' ? 'It needs at least three holes with values among these samples.' : 'It could not tell how far apart the holes are.'}
                </Typography>
            )}
            {mine && !running && result?.ok && (
                <Typography data-testid="numeric-plunge-answer" variant="caption" color={net?.sure ? 'success.main' : 'warning.main'} sx={{ display: 'block', mt: 0.5 }}>
                    {!line || !net ? `No cut-off had enough highs in different holes to tell (${result.samples.toLocaleString()} samples in ${result.holes.toLocaleString()} holes).`
                        : net.sure ? `The highs line up plunging ${Math.round(line.plunge)}° towards ${bearing(line.trend)}° (${result.samples.toLocaleString()} samples in ${result.holes.toLocaleString()} holes; two halves of the holes, scanned apart, agree within ${Math.round(net.halves)}°).`
                        : `Not sure. The best guess is plunging ${Math.round(line.plunge)}° towards ${bearing(line.trend)}°, but two halves of the holes, scanned apart, give answers ${Math.round(net.halves)}° apart (${result.samples.toLocaleString()} samples in ${result.holes.toLocaleString()} holes). It is not offered as the model’s plunge; a direction can still be typed for each shell, under Trend.`}
                </Typography>
            )}
            {said && <Typography data-testid="numeric-plunge-said" variant="caption" sx={{ display: 'block', mt: 0.5 }}>{said}</Typography>}
        </Box>
    );
};
