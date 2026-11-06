/**
 * "Update available" button in the app bar, the What's new dialog, and the
 * start-up update check (Phase 81).
 */
import React, { useEffect } from 'react';
import {
    Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Link, Tooltip, Typography,
} from '@mui/material';
import { SystemUpdateAlt } from '@mui/icons-material';
import { useUpdateStore, type ReleaseEntry } from '../store/updateStore';
import { useUIStore } from '../store/uiStore';
import { useProjectStore } from '../store/projectStore';

/** Wait a little after start-up so the check never competes with loading data. */
const STARTUP_CHECK_DELAY_MS = 4000;

/** Inline `code` spans in a notes line. */
const InlineText: React.FC<{ text: string }> = ({ text }) => (
    <>
        {text.split(/(`[^`]+`)/).map((part, i) => part.startsWith('`') && part.endsWith('`') && part.length > 1
            ? <Box key={i} component="code" sx={{ fontFamily: 'monospace', fontSize: '0.85em', px: 0.5, borderRadius: 0.5, bgcolor: 'action.hover' }}>{part.slice(1, -1)}</Box>
            : <React.Fragment key={i}>{part}</React.Fragment>)}
    </>
);

/** The small Markdown subset CHANGELOG.md uses: ### headings, - bullets, paragraphs. */
export const ReleaseNotes: React.FC<{ notes: string }> = ({ notes }) => {
    const blocks: { kind: 'h' | 'li' | 'p'; text: string }[] = [];
    for (const raw of notes.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) { blocks.push({ kind: 'p', text: '' }); continue; }
        if (line.startsWith('#')) blocks.push({ kind: 'h', text: line.replace(/^#+\s*/, '') });
        else if (/^[-*]\s+/.test(line)) blocks.push({ kind: 'li', text: line.replace(/^[-*]\s+/, '') });
        else {
            const last = blocks[blocks.length - 1];
            if (last && last.text && (last.kind === 'li' || last.kind === 'p')) last.text += ' ' + line;   // wrapped line
            else blocks.push({ kind: 'p', text: line });
        }
    }
    const out: React.ReactNode[] = [];
    let items: string[] = [];
    const flush = () => {
        if (items.length) {
            out.push(
                <Box key={`ul${out.length}`} component="ul" sx={{ m: 0, mb: 1, pl: 2.5 }}>
                    {items.map((t, i) => <Typography key={i} component="li" variant="body2" sx={{ mb: 0.25 }}><InlineText text={t} /></Typography>)}
                </Box>,
            );
            items = [];
        }
    };
    for (const b of blocks) {
        if (b.kind === 'li') { items.push(b.text); continue; }
        flush();
        if (b.kind === 'h') out.push(<Typography key={out.length} variant="subtitle2" sx={{ mt: 1, mb: 0.5 }}>{b.text}</Typography>);
        else if (b.text) out.push(<Typography key={out.length} variant="body2" sx={{ mb: 1 }}><InlineText text={b.text} /></Typography>);
    }
    flush();
    return <Box>{out}</Box>;
};

const EntryList: React.FC<{ entries: ReleaseEntry[] }> = ({ entries }) => (
    <>
        {entries.map(e => (
            <Box key={e.version} sx={{ mb: 2 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    {e.version}{e.date && <Typography component="span" variant="body2" color="text.secondary"> · {e.date}</Typography>}
                </Typography>
                {e.notes ? <ReleaseNotes notes={e.notes} /> : <Typography variant="body2" color="text.secondary">No notes for this version.</Typography>}
            </Box>
        ))}
    </>
);

const UpdateDialog: React.FC = () => {
    const dialog = useUpdateStore(s => s.dialog);
    const setDialog = useUpdateStore(s => s.setDialog);
    const check = useUpdateStore(s => s.check);
    const info = useUpdateStore(s => s.info);
    const applying = useUpdateStore(s => s.applying);
    const applyError = useUpdateStore(s => s.applyError);
    const applyUpdate = useUpdateStore(s => s.applyUpdate);
    const isDirty = useProjectStore(s => s.isDirty);
    const close = () => { if (!applying) setDialog(null); };

    if (dialog === 'current') {
        const entries = info?.changelog ?? [];
        return (
            <Dialog open onClose={close} maxWidth="sm" fullWidth>
                <DialogTitle>What's new in GeoChem {info?.version}</DialogTitle>
                <DialogContent dividers>
                    {entries.length ? <EntryList entries={entries} /> : <Typography variant="body2">No release notes found.</Typography>}
                </DialogContent>
                <DialogActions><Button onClick={close}>Close</Button></DialogActions>
            </Dialog>
        );
    }
    if (dialog !== 'update' || !check?.updateAvailable) return null;
    return (
        <Dialog open onClose={close} maxWidth="sm" fullWidth>
            <DialogTitle>GeoChem {check.latest} is available</DialogTitle>
            <DialogContent dividers>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    You have version {check.current}. What changed since then:
                </Typography>
                {check.entries.length
                    ? <EntryList entries={check.entries} />
                    : <Typography variant="body2" sx={{ mb: 2 }}>No release notes were published with this version.</Typography>}
                {check.canApply ? (
                    <Alert severity={isDirty ? 'warning' : 'info'} sx={{ mt: 1 }}>
                        {isDirty && <strong>Your project has unsaved changes. Save it first. </strong>}
                        Update now closes GeoChem, installs the new version and opens it again. This takes a minute or
                        two. Your data files and projects are not changed.
                    </Alert>
                ) : (
                    <Alert severity="info" sx={{ mt: 1 }}>
                        {check.applyBlocker ?? 'One-click update is not available here.'}{' '}
                        Or close GeoChem and double-click <code>update-geochem.bat</code> in the GeoChem folder.
                    </Alert>
                )}
                {applyError && <Alert severity="error" sx={{ mt: 1 }}>{applyError}</Alert>}
                {applying && <Alert severity="success" sx={{ mt: 1 }}>Updating… GeoChem will close and reopen by itself.</Alert>}
            </DialogContent>
            <DialogActions>
                <Link href={check.releasesUrl} target="_blank" rel="noopener" variant="body2" sx={{ mr: 'auto', ml: 1 }}>
                    All releases on GitHub
                </Link>
                <Button onClick={close} disabled={applying}>Later</Button>
                {check.canApply && (
                    <Button variant="contained" onClick={() => void applyUpdate()} disabled={applying}>
                        Update now
                    </Button>
                )}
            </DialogActions>
        </Dialog>
    );
};

/** App-bar button (only when an update is available) + dialog + start-up check. */
export const UpdateNotice: React.FC = () => {
    const check = useUpdateStore(s => s.check);
    const setDialog = useUpdateStore(s => s.setDialog);
    const enabled = useUIStore(s => s.updateCheckEnabled);

    useEffect(() => {
        void useUpdateStore.getState().loadVersion();
    }, []);
    useEffect(() => {
        if (!enabled) return;
        const t = window.setTimeout(() => { void useUpdateStore.getState().checkForUpdate(); }, STARTUP_CHECK_DELAY_MS);
        return () => window.clearTimeout(t);
    }, [enabled]);

    return (
        <>
            {check?.updateAvailable && (
                <Tooltip title={`GeoChem ${check.latest} is available (you have ${check.current}). Click to see what's new.`}>
                    <Button
                        color="inherit"
                        startIcon={<SystemUpdateAlt />}
                        onClick={() => setDialog('update')}
                        sx={{ mr: 1, border: 1, borderColor: 'warning.main', color: 'warning.main' }}
                        size="small"
                    >
                        Update available
                    </Button>
                </Tooltip>
            )}
            <UpdateDialog />
        </>
    );
};
