/**
 * What is the matter with the drillholes and their logging, in the
 * drillholes' properties (Phase 226): each thing found as a sentence, with
 * how it stands for a model and the first few places it is. Nothing is
 * changed but by the one button here: the ways one code is written put in
 * one unit, where that needs no choice.
 */
import React from 'react';
import { Alert, Box, Button, Typography } from '@mui/material';
import { useModelStore } from '../../../store/modelStore';
import { useHoleFindings } from '../../model/holeChecks';
import { findingCounts, joinWays, type Finding } from '../../model/validation';

const SEVERITY = { problem: 'error', warning: 'warning', note: 'info' } as const;

const Row: React.FC<{ finding: Finding }> = ({ finding }) => {
    const map = useModelStore(s => (finding.unitMap ? s.scene.unitMaps?.find(m => m.id === finding.unitMap) : undefined));
    const joined = map && finding.ways ? joinWays(map.units, finding.ways) : null;
    return (
        <Alert
            severity={SEVERITY[finding.severity]} data-finding={finding.kind} data-severity={finding.severity}
            sx={{ py: 0, px: 1, '& .MuiAlert-message': { py: 0.75, minWidth: 0 }, '& .MuiAlert-icon': { py: 0.75, mr: 1 } }}
        >
            <Typography variant="body2">{finding.text}</Typography>
            {finding.examples.length > 0 && (
                <Box component="ul" sx={{ m: 0, mt: 0.25, pl: 2, color: 'text.secondary' }}>
                    {finding.examples.map(e => <Typography key={e} component="li" variant="caption" sx={{ display: 'list-item', overflowWrap: 'anywhere' }}>{e}</Typography>)}
                    {finding.count > finding.examples.length && (
                        <Typography component="li" variant="caption" sx={{ display: 'list-item', listStyle: 'none' }}>and {(finding.count - finding.examples.length).toLocaleString()} more</Typography>
                    )}
                </Box>
            )}
            {map && joined && (
                <Button
                    size="small" variant="outlined" color="inherit" sx={{ textTransform: 'none', mt: 0.5 }} data-action="join-ways"
                    onClick={() => useModelStore.getState().regroupUnits(map.id, joined)}
                >
                    Put each code&apos;s ways in one unit
                </Button>
            )}
        </Alert>
    );
};

/** The checks of the drillholes and their logging: what was found, the problems first */
export const HoleFindings: React.FC = () => {
    const found = useHoleFindings();
    const { problems, warnings } = findingCounts(found);
    return (
        <Box data-testid="hole-findings" data-problems={problems} data-warnings={warnings} sx={{ mt: 1.5 }}>
            <Typography variant="subtitle2">Checks of the drillholes and logging</Typography>
            {found.length === 0 ? (
                <Typography variant="caption" color="text.secondary">
                    Nothing found the matter: no interval overlaps another or ends above where it starts, every hole logged has a collar and a survey, and no code is written two ways.
                </Typography>
            ) : (
                <>
                    <Typography variant="caption" color="text.secondary">
                        Looked for in the collars, the surveys, every logging table and the samples. Nothing here has been changed.
                    </Typography>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mt: 0.5 }}>
                        {found.map(f => <Row key={`${f.kind}|${f.table ?? ''}|${f.unitMap ?? ''}|${f.text}`} finding={f} />)}
                    </Box>
                </>
            )}
        </Box>
    );
};
