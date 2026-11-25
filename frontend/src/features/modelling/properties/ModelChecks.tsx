/**
 * A built geological model against the data, in its properties: a column of
 * the dataset that says which unit each sample is in, and how much of the
 * logging lies in the unit it was logged as.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, ButtonBase, Tooltip, Typography } from '@mui/material';
import { useGeoModelCache } from '../../model/geoModelCache';
import { modelAgreement, releaseModelColumn, writeModelColumn } from '../../model/geoModelColumns';
import { agreementText, metresText, sharePercent, type Agreement, type Mismatch } from '../../model/geoModelFlag';
import { modelCheckText, noteCompared, runModelCheck, useModelChecks } from '../../model/modelCheck';
import type { GeoModel } from '../../model/types';
import { GradeBlock } from './GradeBlock';
import { Caption } from './parts';
import { smallButton } from './styles';
import { t } from '../../model/terms';
import { useTargetView } from '../targetView';

const WHY = {
    'no-model': 'The model is no longer in the project.',
    'not-built': 'The model is not built yet.',
    'no-coordinates': 'The data has no East, North and Elevation columns to place its samples by.',
} as const;
/** How many holes are listed */
const HOLES = 6;
/** How many stretches are listed to begin with, and how many more each time more are asked for */
const STRETCHES = 8, MORE = 20;

/** What the list of stretches is narrowed to: one hole, or what is logged as one unit (and, with `modelled`, in one other) */
type Narrow = { hole: string } | { logged: string; modelled?: string } | null;

const depth = (v: number) => (Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1));

/**
 * The figure against what the plan can match: a bad number is the model's
 * own doing only as far as it is under this.
 */
function ceilingText(a: Agreement, ceiling: { metres: number; of: number }): string {
    const top = sharePercent(ceiling.metres, ceiling.of), got = sharePercent(a.agreed, a.metres);
    const under = top - got;
    const head = `Its layers, each met once down a hole in this order, can match at most ${top}% of the logging, whatever the surfaces (${t('chronology')} says why)`;
    if (under <= 0) return `${head}: the model matches as much as that.`;
    if (under <= 5) return `${head}: the model is ${under} point${under === 1 ? '' : 's'} under that, which is close.`;
    return `${head}: the model is ${under} points under that. That much is lost in how the surfaces are fitted; the rest is in the logging and the order.`;
}

/** Metres logged as each unit (down the side) by the unit the model has them as (along the top) */
const AgreementTable: React.FC<{ a: Agreement; narrow: Narrow; onPick: (n: Narrow) => void }> = ({ a, narrow, onPick }) => {
    // The units logged, then any the model has in their place that are logged nowhere
    const names = a.units.map(u => u.unit);
    for (const u of a.units) for (const x of u.as) if (!names.includes(x.unit)) names.push(x.unit);
    const cell = { fontSize: 11, lineHeight: 1.3, px: 0.5, py: 0.125, textAlign: 'right' as const, whiteSpace: 'nowrap' as const };
    const picked = (logged: string, modelled: string) => !!narrow && 'logged' in narrow && narrow.logged === logged && narrow.modelled === modelled;
    return (
        <Box data-testid="agreement-table" sx={{ mt: 0.5, overflowX: 'auto' }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.3 }}>
                Metres logged as each unit (down the side), by the unit the model has them in (along the top). A figure off the diagonal lists its stretches below.
            </Typography>
            <Box component="table" sx={{ borderCollapse: 'collapse', mt: 0.25 }}>
                <thead>
                    <tr>
                        <Box component="th" sx={{ ...cell, textAlign: 'left' }} />
                        {names.map(n => <Box component="th" key={n} scope="col" sx={{ ...cell, fontWeight: 500, color: 'text.secondary', maxWidth: 64, overflow: 'hidden', textOverflow: 'ellipsis' }} title={n}>{n}</Box>)}
                    </tr>
                </thead>
                <tbody>
                    {a.units.map(u => (
                        <tr key={u.unit} data-logged={u.unit}>
                            <Box component="th" scope="row" sx={{ ...cell, textAlign: 'left', fontWeight: 500, maxWidth: 96, overflow: 'hidden', textOverflow: 'ellipsis' }} title={u.unit}>{u.unit}</Box>
                            {names.map(n => {
                                const m = n === u.unit ? u.agreed : u.as.find(x => x.unit === n)?.metres ?? 0;
                                if (n === u.unit) return <Box component="td" key={n} sx={{ ...cell, fontWeight: 700, bgcolor: 'action.hover' }}>{Math.round(m).toLocaleString('en-US')}</Box>;
                                if (!(m >= 0.5)) return <Box component="td" key={n} sx={{ ...cell, color: 'text.disabled' }}>·</Box>;
                                return (
                                    <Box component="td" key={n} sx={{ ...cell, p: 0 }}>
                                        <ButtonBase
                                            data-pair={`${u.unit}>${n}`} aria-pressed={picked(u.unit, n)}
                                            aria-label={`${Math.round(m).toLocaleString('en-US')} m logged as ${u.unit} are in ${n}: list those stretches`}
                                            onClick={() => onPick(picked(u.unit, n) ? null : { logged: u.unit, modelled: n })}
                                            sx={{ ...cell, display: 'block', width: '100%', color: 'warning.main', borderRadius: 0.5, outline: picked(u.unit, n) ? '1px solid' : 'none', '&:hover': { bgcolor: 'action.hover' } }}
                                        >
                                            {Math.round(m).toLocaleString('en-US')}
                                        </ButtonBase>
                                    </Box>
                                );
                            })}
                        </tr>
                    ))}
                </tbody>
            </Box>
        </Box>
    );
};

/** The stretches of hole in another unit than they were logged as: the longest first, each brought into the view by a click */
const Stretches: React.FC<{ all: readonly Mismatch[]; narrow: Narrow; onPick: (n: Narrow) => void }> = ({ all, narrow, onPick }) => {
    const target = useTargetView();
    const [shown, setShown] = useState(STRETCHES);
    useEffect(() => { setShown(STRETCHES); }, [narrow]);
    const list = useMemo(() => all.filter(m => !narrow
        || ('hole' in narrow ? m.hole === narrow.hole : m.logged === narrow.logged && (narrow.modelled === undefined || m.modelled === narrow.modelled))), [all, narrow]);
    if (all.length === 0) return null;
    const st = target.status;
    const can = !!st?.ready && st.here;
    const zoom = (m: Mismatch) => {
        // Its own length round it, and never so close that the holes beside it are out of sight
        const r = Math.max(10, m.to - m.from);
        target.actions()?.zoomToWorld({ min: [0, 1, 2].map(k => Math.min(m.a[k], m.b[k]) - r), max: [0, 1, 2].map(k => Math.max(m.a[k], m.b[k]) + r) });
    };
    const metres = list.reduce((sum, m) => sum + m.metres, 0);
    const what = !narrow ? 'in another unit than they were logged as'
        : 'hole' in narrow ? `of ${narrow.hole || '(no hole)'} in another unit than they were logged as`
            : narrow.modelled !== undefined ? `logged as ${narrow.logged} that the model has in ${narrow.modelled}` : `logged as ${narrow.logged} that the model has in another unit`;
    return (
        <Box data-testid="agreement-stretches" sx={{ mt: 0.75 }}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
                <Typography data-testid="stretches-head" variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 0, lineHeight: 1.3 }}>
                    {list.length === 0 ? `No stretch ${what}.` : `The ${list.length === 1 ? 'one stretch' : `${list.length.toLocaleString('en-US')} stretches`} ${what} (${metresText(metres)}), the longest first${can ? ': click one to look at it' : ''}.`}
                </Typography>
                {narrow && <Button size="small" sx={smallButton} data-action="stretches-all" onClick={() => onPick(null)}>Show all</Button>}
            </Box>
            {!can && list.length > 0 && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.3 }}>With a 3D view open on the model, a click on one brings it into view.</Typography>}
            {list.slice(0, shown).map(m => (
                <ButtonBase
                    key={`${m.hole} ${m.from} ${m.logged} ${m.modelled}`} data-testid="stretch" disabled={!can} onClick={() => zoom(m)}
                    sx={{ display: 'flex', width: '100%', justifyContent: 'flex-start', alignItems: 'baseline', gap: 0.75, textAlign: 'left', borderRadius: 0.5, px: 0.25, '&:hover': { bgcolor: 'action.hover' } }}
                >
                    <Typography variant="caption" noWrap sx={{ flexShrink: 0, fontWeight: 500 }}>{m.hole || '(no hole)'}</Typography>
                    <Typography variant="caption" noWrap sx={{ flexShrink: 0 }}>{depth(m.from)} to {depth(m.to)} m</Typography>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ flex: 1, minWidth: 0 }}>logged {m.logged}, in {m.modelled}</Typography>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ flexShrink: 0 }}>{metresText(m.metres)}</Typography>
                </ButtonBase>
            ))}
            {list.length > shown && (
                <Button size="small" sx={smallButton} data-action="stretches-more" onClick={() => setShown(n => n + MORE)}>
                    Show {Math.min(MORE, list.length - shown)} more of the {(list.length - shown).toLocaleString('en-US')} left
                </Button>
            )}
        </Box>
    );
};

export const ModelChecks: React.FC<{ model: GeoModel }> = ({ model }) => {
    const result = useGeoModelCache(s => s.byId[model.id]);
    const [note, setNote] = useState<string | null>(null);
    const [comparing, setComparing] = useState(false);
    const [narrow, setNarrow] = useState<Narrow>(null);
    const checked = useModelChecks(s => s.byId[model.id]);
    // (A check of an older build is no longer this model's)
    const check = checked && result && checked.key === result.key ? checked : null;
    const out = result?.out ?? null;
    // Worked out when asked for, and again when the model is built again
    const compared = useMemo(() => (comparing && out ? modelAgreement(model.id) : null), [comparing, out, model.id, model.unitMap]);
    // (Looked at for this build: the setup steps take the comparison as made)
    useEffect(() => {
        if (compared?.ok && result) noteCompared(model.id, result.key, { agreed: compared.agreement.agreed, metres: compared.agreement.metres });
    }, [compared, result, model.id]);
    // (What the list was narrowed to may not be there in another build)
    useEffect(() => { setNarrow(null); }, [out]);
    const write = () => {
        const done = writeModelColumn(model.id);
        setNote(done.ok ? null : WHY[done.reason]);
    };
    const a = compared?.ok ? compared.agreement : null;
    const worst = a ? a.holes.filter(h => h.metres - h.agreed > 0.05).slice(0, HOLES) : [];

    return (
        <Box data-testid="model-checks">
            <Caption>Against the data</Caption>
            {model.column ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="caption" sx={{ flex: 1, minWidth: 0 }}>
                        Each sample's unit is in the column <b>{model.column}</b>, redone whenever the model is built.
                    </Typography>
                    <Tooltip title="The column stays in the data as it is now, and is no longer redone">
                        <span><Button size="small" sx={smallButton} onClick={() => releaseModelColumn(model.id)}>Stop redoing it</Button></span>
                    </Tooltip>
                </Box>
            ) : (
                <Tooltip title="A new column of the data: the unit of the model each sample is in (empty outside the model). It is redone whenever the model is built.">
                    <span><Button size="small" sx={smallButton} disabled={!out} onClick={write}>Write each sample's unit to a column</Button></span>
                </Tooltip>
            )}
            {note && <Alert severity="warning" sx={{ py: 0, mt: 0.5, fontSize: 12 }}>{note}</Alert>}

            <Tooltip title="How much of the logging lies in the unit it was logged as, by metres of hole, unit by unit and hole by hole">
                <span><Button size="small" sx={{ ...smallButton, mt: 0.5 }} disabled={!out} aria-expanded={comparing} data-action="check-drilling" onClick={() => setComparing(c => !c)}>
                    {comparing ? 'Hide the check against drilling' : t('checkAgainstDrilling')}
                </Button></span>
            </Tooltip>
            {compared && !compared.ok && <Alert severity="info" sx={{ py: 0, mt: 0.5, fontSize: 12 }}>{compared.reason}</Alert>}
            {a && (
                <Box data-testid="model-agreement" sx={{ mt: 0.5 }}>
                    <Typography variant="caption" sx={{ display: 'block' }}>{agreementText(a)}</Typography>
                    {compared?.ok && compared.ceiling && a.metres > 0 && (
                        <Typography data-testid="model-agreement-ceiling" variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.3, mb: 0.25 }}>
                            {ceilingText(a, compared.ceiling)}
                        </Typography>
                    )}
                    {compared?.ok && compared.cleaned && compared.cleaned.agreement.metres > 0 && (
                        <Typography data-testid="model-agreement-cleaned" variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            That is against the logging as logged. Against the logging as the model reads it ({metresText(compared.cleaned.metres)} of short stretches
                            cleaned in Lithologies): {sharePercent(compared.cleaned.agreement.agreed, compared.cleaned.agreement.metres)}% of {metresText(compared.cleaned.agreement.metres)}.
                        </Typography>
                    )}
                    {a.units.map(u => (
                        <Box key={u.unit} data-testid="unit-agreement" sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
                            <Typography variant="caption" noWrap sx={{ flex: 1, minWidth: 0 }}>{u.unit}</Typography>
                            <Typography variant="caption" color="text.secondary" noWrap>
                                {sharePercent(u.agreed, u.logged)}% of {metresText(u.logged)}{u.as.length ? `; the rest mostly ${u.as[0].unit}` : ''}
                            </Typography>
                        </Box>
                    ))}
                    {a.units.some(u => u.as.length > 0) && <AgreementTable a={a} narrow={narrow} onPick={setNarrow} />}
                    {compared?.ok && compared.blocks && compared.blocks.length > 1 && (
                        <>
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>Fault block by fault block:</Typography>
                            {compared.blocks.map(b => (
                                <Box key={b.name} data-testid="block-agreement" sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
                                    <Typography variant="caption" noWrap sx={{ flex: 1, minWidth: 0 }} title={b.name}>{b.name}</Typography>
                                    <Typography variant="caption" color="text.secondary" noWrap>{sharePercent(b.agreement.agreed, b.agreement.metres)}% of {metresText(b.agreement.metres)}</Typography>
                                </Box>
                            ))}
                        </>
                    )}
                    {worst.length > 0 && (
                        <>
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>The holes that agree least (click one to list its stretches):</Typography>
                            {worst.map(h => (
                                <ButtonBase
                                    key={h.hole} data-testid="hole-agreement" aria-pressed={!!narrow && 'hole' in narrow && narrow.hole === h.hole}
                                    onClick={() => setNarrow(n => (n && 'hole' in n && n.hole === h.hole ? null : { hole: h.hole }))}
                                    sx={{ display: 'block', width: '100%', textAlign: 'left', borderRadius: 0.5, px: 0.25, '&:hover': { bgcolor: 'action.hover' }, '&[aria-pressed="true"]': { bgcolor: 'action.selected' } }}
                                >
                                    <Typography variant="caption" sx={{ display: 'block' }}>
                                        {h.hole || '(no hole)'}: {metresText(h.metres - h.agreed)} of {metresText(h.metres)} in another unit
                                    </Typography>
                                </ButtonBase>
                            ))}
                        </>
                    )}
                    {compared?.ok && <Stretches all={compared.mismatches} narrow={narrow} onPick={setNarrow} />}
                    {(a.outside > 0 || a.other > 0) && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                            Not compared: {[a.outside > 0 ? `${metresText(a.outside)} outside the model` : '', a.other > 0 ? `${metresText(a.other)} logged as units the model does not have` : ''].filter(Boolean).join(', ')}.
                        </Typography>
                    )}
                </Box>
            )}

            <Tooltip title="Some holes at a time are taken away, the surfaces built from logging are fitted again from the rest, and the model is asked what it has down the holes left out: how well it carries from hole to hole">
                <span><Button size="small" sx={{ ...smallButton, mt: 0.5 }} disabled={!out || check?.state === 'running'} data-action="cross-validate" onClick={() => { void runModelCheck(model.id); }}>
                    {check?.state === 'done' ? 'Check it again' : t('crossValidation')}
                </Button></span>
            </Tooltip>
            {check?.state === 'running' && (
                <Typography data-testid="model-check-running" variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    {check.of > 0 ? `Building it again without some of its holes: ${check.done} of ${check.of} done…` : 'Building it again without some of its holes…'}
                </Typography>
            )}
            {check?.state === 'done' && check.result && !check.result.ok && <Alert severity="info" sx={{ py: 0, mt: 0.5, fontSize: 12 }}>{check.result.reason}</Alert>}
            {check?.state === 'done' && check.result?.ok && (
                <Box data-testid="model-check" sx={{ mt: 0.5 }}>
                    {modelCheckText(check.result.check).map((line, i, all) => (
                        <Typography key={line} variant="caption" color={i === all.length - 1 ? 'text.secondary' : undefined} sx={{ display: 'block', lineHeight: 1.35, mb: 0.25 }}>{line}</Typography>
                    ))}
                </Box>
            )}
            {out && <GradeBlock of={{ kind: 'model', id: model.id, logged: !!model.unitMap }} />}
        </Box>
    );
};
