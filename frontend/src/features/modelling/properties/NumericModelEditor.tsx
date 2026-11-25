/**
 * A numeric model in the properties (Phase 232): the column and how its
 * shells are found (changed in the grade shell's dialog, once for all of
 * them), its cut-offs (one is added or taken away here, and its shell with
 * it), and for each shell how much ground it holds and whether it lies
 * inside the shell of the cut-off below it. Where its shells are kept (a
 * geological model's lithologies, a fault block) is NumericDomain.
 */
import React, { useMemo, useState } from 'react';
import { Box, Button, Chip, Link, TextField, Typography } from '@mui/material';
import { DonutLarge } from '@mui/icons-material';
import { formatVolume, SHARE_CAVEAT } from '../../model/describe';
import { useModelCache } from '../../model/modelCache';
import { openModelDialog } from '../../model/modelDialogs';
import { cutoffText, foundText, MAX_CUTOFFS, parseCutoffs, shareOutside } from '../../model/numericModels';
import { parseShares, sharePercent } from '../../model/proportion';
import { listText } from '../../model/shellDomains';
import { writeShareColumn } from '../../model/surfaceColumns';
import { keys } from '../../model/objectKeys';
import { t } from '../../model/terms';
import type { NumericModel } from '../../model/types';
import { useModelStore } from '../../../store/modelStore';
import { DrillCheckNote } from '../../plots/viewer3d/DrillCheckNote';
import { EditorHeader } from './EditorHeader';
import { NumericDomain } from './NumericDomain';
import { NumericPlane } from './NumericPlane';
import { NumericPlunge } from './NumericPlunge';
import { GradeBlock } from './GradeBlock';
import { Fact } from './parts';
import { smallButton } from './styles';

export const NumericModelEditor: React.FC<{ model: NumericModel; onGoTo: (key: string) => void }> = ({ model, onGoTo }) => {
    const surfaces = useModelStore(s => s.scene.surfaces);
    const fits = useModelCache(s => s.byId);
    const [adding, setAdding] = useState('');
    const [written, setWritten] = useState<string | null>(null);
    /** A proportion: its shells are at shares of the ground that is its units, not at cut-offs of a column */
    const of = model.rule.of ?? null;
    const units = of ? listText(of.inside) : '';
    const said = (cutoff: number) => cutoffText(model.rule, cutoff);
    const store = useModelStore.getState();
    const shells = model.shells.map(x => ({ ...x, object: surfaces.find(s => s.id === x.surface) ?? null, fit: fits[x.surface] ?? null }));
    const cutoffs = model.shells.map(s => s.cutoff);

    // Each shell against the one at the cut-off below it: the share of its skin that is outside that one
    const parts = shells.map(s => (s.fit?.state === 'ready' ? s.fit.part : null));
    const cells = shells.map(s => s.fit?.stats?.body?.cell ?? 0);
    /** Which fits these are: it is worked out again when one of them is another */
    const fitted = shells.map(s => `${s.surface}:${s.fit?.state === 'ready' ? s.fit.key : ''}`).join('|');
    /* eslint-disable-next-line react-hooks/exhaustive-deps -- `fitted` names the meshes it is worked out from */
    const outside = useMemo(() => parts.map((p, i) => (i === 0 || !p || !parts[i - 1] ? null : shareOutside(p, parts[i - 1]!, 1.5 * Math.max(cells[i], cells[i - 1])))), [fitted]);
    const busy = shells.some(s => s.fit?.state === 'fitting');
    const poking = shells.filter((_, i) => (outside[i] ?? 0) > 0.02);
    const known = outside.filter((v, i) => i > 0 && v !== null).length;

    const typed = of ? parseShares(adding) : parseCutoffs(adding);
    const fresh = typed?.filter(c => !cutoffs.includes(c)) ?? [];
    const full = cutoffs.length >= MAX_CUTOFFS;
    const add = () => {
        if (fresh.length === 0 || full) return;
        store.updateNumericModel(model.id, { cutoffs: [...cutoffs, ...fresh] });
        setAdding('');
    };

    return (
        <Box data-testid="numeric-editor">
            <EditorHeader
                objectKey={keys.numericModel(model.id)} name={model.name} what="Numeric model" icon={<DonutLarge sx={{ fontSize: 18, color: 'text.secondary' }} />}
                visKeys={model.shells.map(s => keys.surface(s.surface))}
            />
            <Fact>{of
                ? `${t('proportion')}: shells round the ground where ${units} is a share of it or more, one for each share. ${foundText(model.rule)}`
                : `${t('typeShell')}s of ${model.rule.column}, one for each cut-off. ${foundText(model.rule)}`}</Fact>
            <Button size="small" variant="outlined" data-action="change-numeric" sx={{ ...smallButton, mt: 0.5 }} onClick={() => openModelDialog(of ? 'proportion' : 'numeric', store.scene.coords, model.id)}>
                Change how they are found…
            </Button>

            <Typography variant="subtitle2" sx={{ mt: 1.5 }}>{of ? 'Shares' : 'Cut-offs'}</Typography>
            <Box data-testid="numeric-cutoffs" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                {shells.map(s => (
                    <Chip
                        key={s.surface} size="small" data-cutoff={s.cutoff} label={`≥ ${said(s.cutoff)}`}
                        icon={<Box component="span" sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: s.object?.color ?? '#9e9e9e', ml: '6px !important' }} />}
                        // (The last one stays: a model with no cut-off has nothing; a locked shell is unlocked first)
                        onDelete={shells.length > 1 && !s.object?.locked ? () => store.updateNumericModel(model.id, { cutoffs: cutoffs.filter(c => c !== s.cutoff) }) : undefined}
                    />
                ))}
            </Box>
            <Box sx={{ display: 'flex', gap: 0.75, mt: 0.75, alignItems: 'flex-start' }}>
                <TextField
                    size="small" value={adding} onChange={e => setAdding(e.target.value)} placeholder={of ? 'Another share (%)' : 'Another cut-off'} disabled={full}
                    onKeyDown={e => { if (e.key === 'Enter') add(); }} inputProps={{ 'aria-label': of ? 'Another share (%)' : 'Another cut-off', inputMode: 'decimal', style: { fontSize: 13, paddingTop: 4, paddingBottom: 4 } }}
                    error={adding.trim() !== '' && typed === null} sx={{ width: 150 }}
                    helperText={full ? `A model has at most ${MAX_CUTOFFS}.` : adding.trim() !== '' && typed === null ? 'A number, or several with commas between.' : undefined}
                />
                <Button size="small" variant="outlined" data-action="add-cutoff" disabled={fresh.length === 0 || full} sx={smallButton} onClick={add}>Add</Button>
            </Box>

            <NumericDomain model={model} />
            <NumericPlane model={model} />
            <NumericPlunge model={model} />

            <Typography variant="subtitle2" sx={{ mt: 1.5 }}>Its shells</Typography>
            <Box data-testid="numeric-shells" sx={{ mt: 0.25 }}>
                {shells.map((s, i) => {
                    const volume = s.fit?.stats?.body?.volume ?? null;
                    const state = !s.object ? 'It is no longer in the project.'
                        : s.fit?.state === 'fitting' ? 'Being fitted…'
                            : s.fit?.state === 'failed' ? 'It could not be fitted.'
                                : s.fit?.state === 'empty' ? 'Nothing reaches this cut-off.'
                                    : volume !== null && volume > 0 ? formatVolume(volume) : s.fit ? 'No ground' : 'Not fitted yet';
                    const out = outside[i];
                    // A proportion: the mean share of its units in the ground inside the shell, and how much of them that is
                    const inside = volume !== null && volume > 0 ? s.fit?.stats?.body?.share?.inside ?? null : null;
                    const held = inside !== null && volume !== null ? volume * inside : null;
                    return (
                        <Box key={s.surface} data-shell={s.surface} sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, py: 0.25 }}>
                            <Box component="span" sx={{ width: 10, height: 10, flexShrink: 0, borderRadius: '50%', bgcolor: s.object?.color ?? '#9e9e9e', alignSelf: 'center' }} />
                            <Link component="button" type="button" variant="body2" data-action="go-shell" onClick={() => onGoTo(keys.surface(s.surface))} sx={{ textAlign: 'left' }}>
                                {s.object?.name ?? `≥ ${said(s.cutoff)}`}
                            </Link>
                            <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                                {state}
                                {of && held !== null && inside !== null && ` of ground · ${sharePercent(inside, true)} of it ${units}: about ${formatVolume(held)}`}
                                {i > 0 && out !== null && out !== undefined && (out > 0.02
                                    ? ` · ${Math.max(1, Math.round(100 * out))}% of it is outside ≥ ${said(shells[i - 1].cutoff)}`
                                    : ` · inside ≥ ${said(shells[i - 1].cutoff)}`)}
                            </Typography>
                        </Box>
                    );
                })}
            </Box>
            {shells.length > 1 && (
                <Typography data-testid="numeric-nested" variant="caption" color={poking.length > 0 ? 'warning.main' : 'text.secondary'} sx={{ display: 'block', mt: 0.5 }}>
                    {busy ? 'Being fitted: whether each shell is inside the one below it is said when they are done.'
                        : known < shells.length - 1 ? 'Whether each shell is inside the one below it is said once all of them are fitted.'
                            : poking.length === 0 ? 'Each shell is inside the shell of the cut-off below it.'
                                : `${poking.map(s => s.object?.name ?? `≥ ${s.cutoff}`).join(' and ')} ${poking.length === 1 ? 'is' : 'are'} partly outside the shell of the cut-off below. Each shell is fitted on its own, so this can happen where samples are few: look there before trusting either.`}
                </Typography>
            )}
            {!of && <GradeBlock of={{ kind: 'numeric', id: model.id }} />}
            {of && (() => {
                const lowest = shells[0];
                const body = lowest?.fit?.state === 'ready' ? lowest.fit.stats?.body ?? null : null;
                const all = body && body.volume && body.share && body.share.inside !== null && body.share.allOverInside !== null ? body.volume * body.share.inside * body.share.allOverInside : null;
                return (
                    <Box data-testid="numeric-share" sx={{ mt: 1 }}>
                        {all !== null && (
                            <Typography variant="body2" data-testid="numeric-share-all">
                                {`In all, about ${formatVolume(all)} of ${units}: what is inside the lowest shell, and the ground outside it as far as the logging reaches.`}
                            </Typography>
                        )}
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>{SHARE_CAVEAT}</Typography>
                        <Button
                            size="small" variant="outlined" data-action="share-column" sx={{ ...smallButton, mt: 0.75 }} disabled={lowest?.fit?.state !== 'ready'}
                            onClick={() => setWritten(lowest ? writeShareColumn(lowest.surface) : null)}
                        >
                            Its share at every sample → new column
                        </Button>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                            {written ? `Written to the column “${written}”: a number from 0 to 1. Plot a grade against it. Make it again after the model changes.`
                                : `A number from 0 to 1 at every sample, read from the lowest shell’s fit: plot a grade against it, or colour the samples by it.`}
                        </Typography>
                        {lowest && (
                            <Box sx={{ mt: 1.25 }}>
                                <Typography variant="subtitle2">Against the drilling</Typography>
                                <DrillCheckNote target={{ kind: 'surface', id: lowest.surface }} surfaceId={lowest.surface} onGoTo={onGoTo} />
                            </Box>
                        )}
                    </Box>
                );
            })()}
        </Box>
    );
};
