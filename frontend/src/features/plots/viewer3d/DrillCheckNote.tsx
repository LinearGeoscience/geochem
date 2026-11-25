/**
 * A surface built from logged units, a vein system or a proportion checked
 * against holes left out of it (drillCheck.ts): the button that asks for
 * it, how far it has got, what it found in words and as two small rows of
 * bars by length of hole; and, when the same units are modelled in other
 * forms too, those side by side (unitForms.ts), each with its own check.
 */
import React from 'react';
import { Box, Button, LinearProgress, Link, Tooltip, Typography } from '@mui/material';
import { useModelStore } from '../../../store/modelStore';
import { checkFitKey, checkKey, drillCheckText, runDrillCheck, useDrillChecks, type CheckTarget } from '../../model/drillCheck';
import { useModelCache } from '../../model/modelCache';
import { HELD_SKILL, type ShareScore } from '../../model/loggedScore';
import { checkCells, formKindName, formRows, formsOf, formsToReport } from '../../model/unitForms';
import { t } from '../../model/terms';

export interface DrillCheckNoteProps {
    target: CheckTarget;
    /** A surface of it (itself; a vein of the system; a shell of the proportion): its units name the other forms */
    surfaceId: string;
    onGoTo?: (key: string) => void;
}

const EXPLAIN = 'A surface always holds the logging it was fitted to. What tells a good one from a poor one is the ground between the holes: '
    + 'so some holes are left out, it is fitted again without them, and their logging is read against it. Holes that lie together (a line of holes on one level, '
    + 'a fan from one collar) are left out together, since one of them left out alone is read from its neighbours a few metres away. '
    + 'It is a hard test: use it to compare one way of building it with another, not as a score. It takes several fits.';

const small = { textTransform: 'none', py: 0, fontSize: 12 } as const;

/** Two rows of bars by length of hole: does it say how much, and does it say where. 0 to 1 both; under 0 is drawn as none. */
export const CheckScales: React.FC<{ scale: ShareScore; unit: string }> = ({ scale, unit }) => {
    const shown = scale.scales.filter(s => s.skill !== null || s.where !== null);
    if (shown.length === 0) return null;
    const W = 250, left = 62, gap = 3, rowH = 30, top = 4, labelH = 12;
    const bar = (W - left - 4) / shown.length;
    const rows: { key: 'skill' | 'where'; label: string; mark: number | null }[] = [
        { key: 'skill', label: 'How much', mark: HELD_SKILL },
        { key: 'where', label: 'Where', mark: null },
    ];
    return (
        <Box sx={{ mt: 0.75, color: 'text.secondary' }} data-testid="check-scales">
            <svg viewBox={`0 0 ${W} ${top + rows.length * (rowH + gap) + labelH + 2}`} width="100%" role="img" aria-label={`By length of hole: whether it says how much ${unit} there is, and where there is more`}>
                {rows.map((row, r) => {
                    const y0 = top + r * (rowH + gap);
                    return (
                        <g key={row.key} data-row={row.key}>
                            <text x={0} y={y0 + rowH / 2 + 3} fontSize={9} fill="currentColor">{row.label}</text>
                            <line x1={left} x2={W - 4} y1={y0 + rowH} y2={y0 + rowH} stroke="currentColor" strokeOpacity={0.4} strokeWidth={0.5} />
                            {row.mark !== null && (
                                <line x1={left} x2={W - 4} y1={y0 + rowH * (1 - row.mark)} y2={y0 + rowH * (1 - row.mark)} stroke="currentColor" strokeOpacity={0.5} strokeWidth={0.5} strokeDasharray="2 2">
                                    <title>{`Above this line it says how much better than quoting the overall share everywhere (${row.mark})`}</title>
                                </line>
                            )}
                            {shown.map((s, i) => {
                                const v = s[row.key];
                                const h = v === null ? 0 : Math.max(0, Math.min(1, v)) * rowH;
                                const x = left + i * bar + 2;
                                const said = v === null ? 'too few stretches to say' : row.key === 'skill'
                                    ? `${v.toFixed(2)}: ${v <= 0 ? 'no better than quoting the overall share everywhere' : v < HELD_SKILL ? 'little better than quoting the overall share' : 'it says how much'}`
                                    : `${v.toFixed(2)} (1: exactly where it is logged; 0: not at all)`;
                                return (
                                    <g key={s.window} data-window={s.window}>
                                        {/* (The whole column answers the pointer, not only the bar) */}
                                        <rect x={x - 2} y={y0} width={bar} height={rowH} fill="transparent"><title>{`Over ${s.window} m of hole: ${said}`}</title></rect>
                                        {h > 0.4
                                            ? <rect x={x} y={y0 + rowH - h} width={bar - 4} height={h} rx={1.5} fill="var(--mui-palette-primary-main, #1976d2)" pointerEvents="none" />
                                            : <line x1={x} x2={x + bar - 4} y1={y0 + rowH - 1.5} y2={y0 + rowH - 1.5} stroke="currentColor" strokeWidth={1} strokeOpacity={v === null ? 0.25 : 0.8} pointerEvents="none" />}
                                    </g>
                                );
                            })}
                        </g>
                    );
                })}
                {shown.map((s, i) => (
                    <text key={s.window} x={left + i * bar + bar / 2} y={top + rows.length * (rowH + gap) + labelH - 2} fontSize={8} textAnchor="middle" fill="currentColor">{s.window} m</text>
                ))}
            </svg>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: 11 }}>
                By length of hole. A full bar: as logged. No bar: no better than quoting the overall share everywhere (how much), or no relation (where).
            </Typography>
        </Box>
    );
};

export const DrillCheckNote: React.FC<DrillCheckNoteProps> = ({ target, surfaceId, onGoTo }) => {
    const scene = useModelStore(s => s.scene);
    const fits = useModelCache(s => s.byId);
    const checks = useDrillChecks(s => s.byKey);
    /* eslint-disable-next-line react-hooks/exhaustive-deps -- `fits`: the key is of the fits as they are now */
    const key = React.useMemo(() => checkFitKey(target), [target.kind, target.id, fits, scene]);
    const mine = checks[checkKey(target)];
    // A check of it as it was before it changed says nothing of it now
    const check = mine && mine.key === key ? mine : null;
    const running = check?.state === 'running';
    const forms = React.useMemo(() => formsOf(scene, surfaceId), [scene, surfaceId]);
    const rows = React.useMemo(() => (forms.length > 1 ? formRows(forms, fits, checks) : []), [forms, fits, checks]);
    const others = rows.filter(r => !(r.form.target.kind === target.kind && r.form.target.id === target.id));
    const unchecked = rows.filter(r => r.check?.state !== 'done' && r.volume !== null);
    const anyRunning = rows.some(r => r.check?.state === 'running') || running;
    const [added, setAdded] = React.useState(false);
    const checkAll = async () => { for (const r of unchecked) await runDrillCheck(r.form.target); };
    return (
        <Box sx={{ mt: 0.75 }} data-testid="drill-check">
            <Tooltip title={EXPLAIN}>
                <span>
                    <Button size="small" fullWidth variant="outlined" disabled={!key || running} data-action="cross-validate" onClick={() => { void runDrillCheck(target); }} sx={small}>
                        {check?.state === 'done' ? 'Check it again' : t('crossValidation')}
                    </Button>
                </span>
            </Tooltip>
            {running && (
                <Box sx={{ mt: 0.5 }}>
                    <LinearProgress variant={check.of > 0 ? 'determinate' : 'indeterminate'} value={check.of > 0 ? 100 * check.done / check.of : 0} sx={{ height: 3 }} />
                    <Typography variant="caption" color="text.secondary">
                        {check.of > 0 ? `Fitting it again without some of its holes: ${check.done} of ${check.of} done…` : 'Fitting it again without some of its holes…'}
                    </Typography>
                </Box>
            )}
            {check?.state === 'done' && check.check && drillCheckText(check.check).map(line => (
                <Typography key={line} variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }} data-testid="drill-check-note">{line}</Typography>
            ))}
            {check?.state === 'done' && check.check && <CheckScales scale={check.check.scale} unit={check.check.unit} />}
            {check?.state === 'done' && check.check && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, fontStyle: 'italic' }}>
                    A hard test: with holes left out the gaps there are wider. Compare ways of building it by it; it is not a score.
                </Typography>
            )}
            {check && check.state !== 'running' && !check.check && (
                <Typography variant="caption" color={check.state === 'failed' ? 'error' : 'text.secondary'} sx={{ display: 'block', mt: 0.5 }} data-testid="drill-check-note">{check.reason ?? 'The check could not be made.'}</Typography>
            )}
            {others.length > 0 && (
                <Box sx={{ mt: 1 }} data-testid="unit-forms">
                    <Typography variant="caption" sx={{ display: 'block', fontWeight: 600 }}>The same units, modelled {rows.length} ways</Typography>
                    <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, mt: 0.25, '& td, & th': { py: 0.25, pr: 0.5, textAlign: 'left', verticalAlign: 'top', fontWeight: 400 }, '& th': { color: 'text.secondary' } }}>
                        <thead>
                            <tr>
                                <th>Form</th>
                                <Tooltip title="Of the unit logged in holes left out, the share it took in"><th>Found</th></Tooltip>
                                <Tooltip title="Of what it took in in those holes, the share that is the unit"><th>Unit</th></Tooltip>
                                <Tooltip title="The shortest stretch of hole over which it says how much of the unit there is"><th>How much</th></Tooltip>
                                <Tooltip title="How well it follows where there is more and where less over 5 m of hole: 0 not at all, 1 exactly"><th>Where</th></Tooltip>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(r => {
                                const c = checkCells(r);
                                const own = r.form.target.kind === target.kind && r.form.target.id === target.id;
                                return (
                                    <tr key={checkKey(r.form.target)} data-form={checkKey(r.form.target)}>
                                        <td>
                                            {own || !onGoTo ? <span style={{ fontWeight: own ? 600 : 400 }}>{r.form.name}</span>
                                                : <Link component="button" type="button" onClick={() => onGoTo(r.form.object)} sx={{ fontSize: 11, textAlign: 'left' }}>{r.form.name}</Link>}
                                            <Box component="span" sx={{ display: 'block', color: 'text.secondary' }}>{formKindName(r.form.kind)}</Box>
                                        </td>
                                        {r.check?.state === 'running' ? <td colSpan={4}>being checked…</td> : r.check?.state === 'done' && r.check.check
                                            ? <><td>{c.found}</td><td>{c.sure}</td><td>{c.holds}</td><td>{c.where}</td></>
                                            : <td colSpan={4} style={{ opacity: 0.7 }}>{r.volume === null ? 'not fitted' : 'not checked'}</td>}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, flexWrap: 'wrap' }}>
                        {unchecked.length > 0 && (
                            <Button size="small" variant="outlined" data-action="check-forms" disabled={anyRunning} sx={small} onClick={() => { void checkAll(); }}>
                                Check {unchecked.length === rows.length ? 'them all' : `the ${unchecked.length === 1 ? 'one' : unchecked.length} not checked`}
                            </Button>
                        )}
                        <Button size="small" variant="outlined" data-action="forms-to-report" sx={small} onClick={() => setAdded(formsToReport(surfaceId))}>Table → report</Button>
                    </Box>
                    {added && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>Added to the report, as they stand now.</Typography>}
                </Box>
            )}
        </Box>
    );
};
