/**
 * What is being worked out, from the Modelling page's toolbar (Phase 222):
 * a button that says how many surfaces, models and checks are under way,
 * and opens the list of them and of those that have just ended, with how
 * long each took and, for one that failed, why. A click on a row picks its
 * object in the project tree. One that is waiting or under way can be
 * stopped, and so can all of them at once (Phase 223): what was being
 * worked out stays as it was, and waits to be asked for.
 */
import React, { useEffect, useState } from 'react';
import { Box, Button, CircularProgress, IconButton, LinearProgress, Popover, Tooltip, Typography } from '@mui/material';
import { CheckCircleOutline, ErrorOutline, HourglassEmpty, PauseCircleOutline, PlaylistPlay, StopCircleOutlined } from '@mui/icons-material';
import { activeJobs, clearEndedJobs, endedJobs, jobLine, stopAllJobs, stopJob, useJobs, type Job } from '../model/jobs';
import { useModelCache } from '../model/modelCache';
import { useModellingStore } from '../../store/modellingStore';

const KIND: Record<Job['kind'], string> = { surface: 'Surface', model: 'Geological model', check: 'Check' };

const JobRow: React.FC<{ job: Job; now: number; onPick: () => void }> = ({ job, now, onPick }) => {
    const icon = job.state === 'running' ? <CircularProgress size={14} thickness={5} />
        : job.state === 'waiting' ? <HourglassEmpty sx={{ fontSize: 16, color: 'text.disabled' }} />
            : job.state === 'done' ? <CheckCircleOutline sx={{ fontSize: 16, color: 'success.main' }} />
                : job.state === 'stopped' ? <PauseCircleOutline sx={{ fontSize: 16, color: 'text.secondary' }} />
                    : <ErrorOutline sx={{ fontSize: 16, color: 'error.main' }} />;
    const share = job.state === 'running' && job.progress && job.progress[1] > 0 ? 100 * job.progress[0] / job.progress[1] : null;
    return (
        <Box data-testid="job-row" data-state={job.state} data-kind={job.kind} sx={{ display: 'flex', alignItems: 'center', borderRadius: 1, '&:hover': { bgcolor: 'action.hover' } }}>
        <Box
            component="button" type="button" onClick={onPick} data-action="pick-job"
            sx={{
                display: 'flex', gap: 1, alignItems: 'flex-start', flex: 1, minWidth: 0, textAlign: 'left', font: 'inherit', color: 'inherit', background: 'none', border: 0,
                borderRadius: 1, px: 0.75, py: 0.5, cursor: 'pointer',
            }}
        >
            <Box sx={{ width: 18, pt: '3px', flexShrink: 0, display: 'flex', justifyContent: 'center' }}>{icon}</Box>
            <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography sx={{ fontSize: 13, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {job.name} <Box component="span" sx={{ color: 'text.secondary' }}>· {job.what}</Box>
                </Typography>
                <Typography sx={{ fontSize: 12, lineHeight: 1.35, color: job.state === 'failed' ? 'error.main' : 'text.secondary' }}>
                    {KIND[job.kind]}. {jobLine(job, now)}
                </Typography>
                {share !== null && <LinearProgress variant="determinate" value={Math.min(100, share)} sx={{ mt: 0.5, height: 3, borderRadius: 1 }} />}
            </Box>
        </Box>
            {job.canStop && (
                <Tooltip title={`Stop it. ${job.kind === 'check' ? 'Nothing is checked' : `${job.name} stays as it was`}, until asked for again.`}>
                    <IconButton size="small" data-action="stop-job" aria-label={`Stop: ${job.name}, ${job.what}`} onClick={() => stopJob(job.id)} sx={{ mr: 0.25 }}>
                        <StopCircleOutlined sx={{ fontSize: 18 }} />
                    </IconButton>
                </Tooltip>
            )}
        </Box>
    );
};

export const JobsMenu: React.FC = () => {
    const jobs = useJobs(s => s.jobs);
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const [now, setNow] = useState(() => Date.now());
    const active = activeJobs(jobs), ended = endedJobs(jobs);
    const failed = ended.filter(j => j.state === 'failed').length;
    const canStop = active.some(j => j.canStop);
    // Surfaces whose fit was stopped: they wait to be asked
    const waitingToBeAsked = useModelCache(s => Object.values(s.byId).filter(r => r.stopped).length);
    // The times of those under way move on while the list is open
    useEffect(() => {
        if (!anchor || active.length === 0) return;
        const timer = setInterval(() => setNow(Date.now()), 500);
        return () => clearInterval(timer);
    }, [anchor, active.length]);
    const pick = (job: Job) => { useModellingStore.getState().setSelected([job.object]); setAnchor(null); };
    const label = active.length > 0 ? `Working: ${active.length}` : failed > 0 ? `Activity (${failed} failed)` : 'Activity';
    const tip = active.length > 0
        ? `${active[0].name} (${active[0].what})${active.length > 1 ? ` and ${active.length - 1} more` : ''}: being worked out now`
        : 'What has been worked out: each surface fitted, model built and check made, how long it took, and why one failed';
    return (
        <>
            <Tooltip describeChild title={anchor ? '' : tip}>
                <Button
                    size="small" data-action="jobs" data-active={active.length} aria-haspopup="dialog" aria-expanded={!!anchor}
                    color={active.length === 0 && failed > 0 ? 'error' : 'primary'}
                    startIcon={active.length > 0 ? <CircularProgress size={14} thickness={5} /> : <PlaylistPlay />}
                    onClick={e => { setNow(Date.now()); setAnchor(e.currentTarget); }}
                >
                    {label}
                </Button>
            </Tooltip>
            <Popover
                open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }} transformOrigin={{ vertical: 'top', horizontal: 'left' }}
                slotProps={{ paper: { 'aria-label': 'What is being worked out', role: 'dialog' } as object }}
            >
                <Box data-testid="jobs-list" sx={{ width: 380, maxWidth: '90vw', maxHeight: '70vh', overflow: 'auto', p: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', px: 0.75, pb: 0.5 }}>
                        <Typography sx={{ fontSize: 12, color: 'text.secondary', flex: 1 }}>
                            {active.length > 0 ? 'Being worked out now'
                                : waitingToBeAsked > 0 ? 'Nothing is being worked out.'
                                    : 'Nothing is being worked out: everything is up to date.'}
                        </Typography>
                        {canStop && <Button size="small" data-action="stop-all" sx={{ fontSize: 11, minWidth: 0, py: 0 }} onClick={() => { stopAllJobs(); }}>Stop all</Button>}
                    </Box>
                    {waitingToBeAsked > 0 && (
                        <Typography data-testid="jobs-stopped" sx={{ fontSize: 12, color: 'warning.main', px: 0.75, pb: 0.5 }}>
                            {waitingToBeAsked === 1 ? 'One surface whose fit was stopped is' : `${waitingToBeAsked} surfaces whose fit was stopped are`} not as set now:
                            {' '}the mark in the project tree says which. Open one and press Fit now.
                        </Typography>
                    )}
                    {active.map(job => <JobRow key={job.id} job={job} now={now} onPick={() => pick(job)} />)}
                    {ended.length > 0 && (
                        <>
                            <Box sx={{ display: 'flex', alignItems: 'center', px: 0.75, pt: 1, pb: 0.5 }}>
                                <Typography sx={{ fontSize: 12, color: 'text.secondary', flex: 1 }}>Just ended, the latest first</Typography>
                                <Button size="small" sx={{ fontSize: 11, minWidth: 0, py: 0 }} onClick={clearEndedJobs}>Clear</Button>
                            </Box>
                            {ended.map(job => <JobRow key={job.id} job={job} now={now} onPick={() => pick(job)} />)}
                        </>
                    )}
                </Box>
            </Popover>
        </>
    );
};
