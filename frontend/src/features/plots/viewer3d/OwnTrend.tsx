/**
 * A surface's own trend (Round 27, Phase 247): the structural data it
 * follows in place of the model's choice, and a direction, plunge and
 * strengths of its own in place of the model's global trend. Under the
 * Trend tab of a surface's settings.
 *
 * Nothing ticked: it follows what the model follows, as every surface did.
 */
import React, { useEffect, useState } from 'react';
import { Box, Checkbox, FormControlLabel, TextField, Tooltip, Typography } from '@mui/material';
import { useModelStore } from '../../../store/modelStore';
import { DEFAULT_LINE_STRENGTH, DEFAULT_STRENGTH, MAX_LINE_STRENGTH, MAX_STRENGTH, readStructure } from '../../model/structure';
import { plain, t, termProps } from '../../model/terms';
import { followedSets } from '../../model/trendField';
import type { GeoModel, OverallStructure, ReadingSet, SurfaceObject } from '../../model/types';

const NO_SETS: ReadingSet[] = [];
const NO_MODELS: GeoModel[] = [];
const shown = (v: number | null | undefined) => (v == null ? '' : String(v));
const typed = (text: string): number | null => {
    const v = Number(text);
    return text.trim() !== '' && Number.isFinite(v) ? v : null;
};

export const OwnTrend: React.FC<{ surface: SurfaceObject }> = ({ surface }) => {
    const sets = useModelStore(s => s.scene.structure?.sets) ?? NO_SETS;
    const overall = useModelStore(s => s.scene.structure?.overall ?? null);
    const { updateSurface } = useModelStore.getState();
    const chosen = surface.params.trendSets ?? null, own = surface.params.trendOwn ?? null;
    const usable = sets.filter(s => s.readings.length > 0);
    // The geological models whose layers it can follow (a shell, a body or a vein): those with a contact between layers
    // that is a surface other than this one. The model it is a contact of comes first
    const models = useModelStore(s => s.scene.models) ?? NO_MODELS;
    const following = surface.params.trendLayers ?? null;
    const layered = surface.rule.kind === 'body' || surface.rule.kind === 'shell'
        ? models.filter(m => m.id === following || m.contacts.some(c => c.kind !== 'intrusion' && !!c.surface && c.surface !== surface.id))
            .sort((a, b) => Number(b.contacts.some(c => c.surface === surface.id)) - Number(a.contacts.some(c => c.surface === surface.id)))
        : [];

    const [dip, setDip] = useState(shown(own?.dip));
    const [direction, setDirection] = useState(shown(own?.dipDirection));
    const [plunge, setPlunge] = useState(shown(own?.lineTrend));
    const [strength, setStrength] = useState(shown(own?.strength));
    const [lineStrength, setLineStrength] = useState(shown(own?.lineStrength));
    // What is typed follows the scene when that changes from elsewhere (undo, another surface opened)
    useEffect(() => {
        setDip(shown(own?.dip));
        setDirection(shown(own?.dipDirection));
        setPlunge(shown(own?.lineTrend));
        setStrength(shown(own?.strength));
        setLineStrength(shown(own?.lineStrength));
    }, [own, surface.id]);

    const d = typed(dip), a = typed(direction);
    const valid = d !== null && a !== null && d >= 0 && d <= 90;
    const commit = () => {
        if (!own || !valid) return;
        const next = readStructure({ dip: d, dipDirection: a, lineTrend: typed(plunge), strength: typed(strength) ?? own.strength, lineStrength: typed(lineStrength) ?? own.lineStrength });
        if (next && JSON.stringify(next) !== JSON.stringify(own)) updateSurface(surface.id, { params: { trendOwn: next } });
    };
    const onKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter') (e.target as HTMLElement).blur(); };
    const field = { size: 'small', variant: 'standard', onBlur: commit, onKeyDown: onKey, inputProps: { inputMode: 'decimal', spellCheck: false, autoComplete: 'off' }, InputLabelProps: { shrink: true } } as const;
    /** Its own direction to begin with: the model's, or level with the usual strengths */
    const first = (): OverallStructure => overall ?? { dip: 0, dipDirection: 0, lineTrend: null, strength: DEFAULT_STRENGTH, lineStrength: DEFAULT_LINE_STRENGTH };

    return (
        <Box data-testid="own-trend" sx={{ mt: 1 }}>
            {layered.map(m => (
                <Tooltip key={m.id} title={plain('ownTrendLayers')}>
                    <FormControlLabel
                        sx={{ ml: -0.75, display: 'flex' }}
                        control={(
                            <Checkbox
                                size="small" checked={following === m.id} sx={{ p: 0.5 }}
                                onChange={e => updateSurface(surface.id, { params: { trendLayers: e.target.checked ? m.id : undefined } })}
                                inputProps={{ ...termProps('ownTrendLayers'), 'aria-label': `Follow the layers of ${m.name}` } as React.InputHTMLAttributes<HTMLInputElement>}
                            />
                        )}
                        label={<Typography variant="caption">{layered.length === 1 && m.contacts.some(c => c.surface === surface.id) ? t('ownTrendLayers') : `The layers of ${m.name}`}</Typography>}
                    />
                </Tooltip>
            ))}
            {following && layered.some(m => m.id === following) && (
                <Typography data-testid="own-trend-layers" variant="caption" color="text.secondary" sx={{ display: 'block', ml: 3.5, lineHeight: 1.3 }}>
                    It follows how the contacts between that model&apos;s layers lie, in place of structural data, and is fitted again when one of them changes.
                </Typography>
            )}
            {usable.length > 0 && !following && (
                <>
                    <Tooltip title={plain('ownTrendSets')}>
                        <FormControlLabel
                            sx={{ ml: -0.75, display: 'flex' }}
                            control={(
                                <Checkbox
                                    size="small" checked={chosen !== null} sx={{ p: 0.5 }}
                                    // (To begin with, the sets the model follows: nothing changes until one is ticked or unticked)
                                    onChange={e => updateSurface(surface.id, { params: { trendSets: e.target.checked ? followedSets(sets).map(s => s.id) : undefined } })}
                                    inputProps={termProps('ownTrendSets') as React.InputHTMLAttributes<HTMLInputElement>}
                                />
                            )}
                            label={<Typography variant="caption">{t('ownTrendSets')}</Typography>}
                        />
                    </Tooltip>
                    {chosen && usable.map(s => (
                        <FormControlLabel
                            key={s.id} sx={{ ml: 1.25, display: 'flex' }}
                            control={(
                                <Checkbox
                                    size="small" checked={chosen.includes(s.id)} sx={{ p: 0.5 }}
                                    onChange={e => updateSurface(surface.id, { params: { trendSets: e.target.checked ? [...chosen, s.id] : chosen.filter(x => x !== s.id) } })}
                                    inputProps={{ 'aria-label': `Follow ${s.name}` }}
                                />
                            )}
                            label={(
                                <Typography variant="caption">
                                    {s.name}
                                    <Typography component="span" variant="caption" color="text.secondary">{` · ${s.readings.length.toLocaleString()} ${s.kind === 'plane' ? 'planes' : 'lines'}${s.follow === false ? ' · not followed by the model' : ''}`}</Typography>
                                </Typography>
                            )}
                        />
                    ))}
                    {chosen && chosen.filter(id => usable.some(s => s.id === id)).length === 0 && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 3.5 }}>None ticked: it follows no structural data, only a global trend if there is one.</Typography>
                    )}
                </>
            )}
            <Tooltip title={plain('ownTrendDirection')}>
                <FormControlLabel
                    sx={{ ml: -0.75, display: 'flex' }}
                    control={(
                        <Checkbox
                            size="small" checked={own !== null} sx={{ p: 0.5 }}
                            onChange={e => updateSurface(surface.id, { params: { trendOwn: e.target.checked ? first() : undefined } })}
                            inputProps={termProps('ownTrendDirection') as React.InputHTMLAttributes<HTMLInputElement>}
                        />
                    )}
                    label={<Typography variant="caption">{t('ownTrendDirection')}</Typography>}
                />
            </Tooltip>
            {own && (
                <Box sx={{ ml: 3, mt: 0.5 }}>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                        <TextField {...field} label="Dip (°)" value={dip} onChange={e => setDip(e.target.value)} error={dip.trim() !== '' && (d === null || d < 0 || d > 90)} placeholder="0 to 90" />
                        <TextField {...field} label="Dips towards (°)" value={direction} onChange={e => setDirection(e.target.value)} error={direction.trim() !== '' && a === null} placeholder="0 to 360" />
                    </Box>
                    <TextField {...field} fullWidth sx={{ mt: 1 }} label="Plunges towards (°)" value={plunge} onChange={e => setPlunge(e.target.value)} placeholder="Blank: no plunge" />
                    <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                        <Tooltip title={`How many times further it carries along this direction than across it (1 to ${MAX_STRENGTH}).`}>
                            <TextField {...field} label="Along : across" value={strength} onChange={e => setStrength(e.target.value)} />
                        </Tooltip>
                        <Tooltip title={`How many times further it carries down the plunge than across it, within the plane (1 to ${MAX_LINE_STRENGTH}; 1: no further).`}>
                            <TextField {...field} label="Down plunge : across" value={lineStrength} onChange={e => setLineStrength(e.target.value)} />
                        </Tooltip>
                    </Box>
                </Box>
            )}
        </Box>
    );
};
