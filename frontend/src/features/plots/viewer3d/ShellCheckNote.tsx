/**
 * A shell checked against holes left out of its fit: the button that asks
 * for it, how far it has got, and what it found. What it found stands for
 * as long as the shell is as it was when it was checked.
 */
import React from 'react';
import { Box, Button, LinearProgress, Tooltip, Typography } from '@mui/material';
import { formatMetres } from '../../model/describe';
import { runShellCheck, shellCheckText, useShellChecks } from '../../model/shellCheck';
import type { ShellRule } from '../../model/types';
import { t } from '../../model/terms';

export interface ShellCheckNoteProps {
    surfaceId: string;
    rule: ShellRule;
    /** The fit on show (modelCache's key), undefined while there is none */
    fitKey: string | undefined;
    /** The shell is fitted and drawn: there is something to check */
    ready: boolean;
    /** The samples are averaged down the hole before they are counted */
    averaged: boolean;
}

const EXPLAIN = 'A shell always takes in the samples it was fitted to. What tells a good one from a poor one is the ground between the holes: '
    + 'so a few holes with high values are left out, the shell is fitted again without them, and their samples are counted against it. '
    + 'It is a hard test, as leaving a hole out makes the gap there twice as wide: use it to compare one cut-off, averaging length, reach or structure '
    + 'with another, not as a score. It takes several fits.';

export const ShellCheckNote: React.FC<ShellCheckNoteProps> = ({ surfaceId, rule, fitKey, ready, averaged }) => {
    const mine = useShellChecks(s => s.byId[surfaceId]);
    // A check of the shell as it was before it changed says nothing of it now
    const check = mine && mine.key === fitKey ? mine : null;
    const running = check?.state === 'running';
    const one = averaged && rule.composite !== null ? `averages over ${formatMetres(rule.composite)}` : 'samples';
    return (
        <Box sx={{ mt: 0.75 }} data-testid="shell-check">
            <Tooltip title={EXPLAIN}>
                <span>
                    <Button
                        size="small" fullWidth variant="outlined" disabled={!ready || running} data-action="cross-validate" onClick={() => { void runShellCheck(surfaceId); }}
                        sx={{ textTransform: 'none', py: 0, fontSize: 12 }}
                    >
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
            {check?.state === 'done' && shellCheckText(check.check, rule.cutoff, one, rule.method === 'intercepts').map(line => (
                <Typography key={line} variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }} data-testid="shell-check-note">{line}</Typography>
            ))}
            {check?.state === 'done' && check.check && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, fontStyle: 'italic' }}>
                    A hard test: with a hole left out the gap there is twice as wide. Compare settings by it; it is not a score.
                </Typography>
            )}
            {check?.state === 'failed' && (
                <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5 }}>The check could not be made.</Typography>
            )}
        </Box>
    );
};
