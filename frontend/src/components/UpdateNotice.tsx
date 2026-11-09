/**
 * App-bar version menu (always shown: installed version, Check for updates,
 * What's new), the "Update available" button, the What's new / update
 * dialog, and the start-up update check (Phase 81).
 */
import React, { useEffect, useState } from 'react';
import {
    Alert, Badge, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Link, ListItemIcon, ListItemText,
    Menu, MenuItem, Tooltip, Typography,
} from '@mui/material';
import { SystemUpdateAlt, Refresh, NewReleases, Settings as SettingsIcon, OpenInNew } from '@mui/icons-material';
import { useUpdateStore, BUILD_VERSION, checkStatusText, type ReleaseEntry } from '../store/updateStore';
import { useUIStore } from '../store/uiStore';
import { useProjectStore } from '../store/projectStore';
import { useAppStore } from '../store/appStore';

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

/** Installed version in the app bar; its menu checks for updates and shows what's new. */
const VersionMenu: React.FC = () => {
    const info = useUpdateStore(s => s.info);
    const check = useUpdateStore(s => s.check);
    const checking = useUpdateStore(s => s.checking);
    const setDialog = useUpdateStore(s => s.setDialog);
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const version = info?.version || BUILD_VERSION;
    const close = () => setAnchor(null);
    if (!version) return null;
    const note = info?.install === 'dev'
        ? 'Development copy: one-click update is off here; update it with git.'
        : info?.updateBlocker ?? null;
    const releases = check?.releasesUrl ?? info?.releasesUrl ?? 'https://github.com/LinearGeoscience/geochem/releases';
    return (
        <>
            <Tooltip title={`GeoChem ${version}${check?.updateAvailable ? ` (${check.latest} available)` : ''}: check for updates, what's new`}>
                <Button color="inherit" size="small" onClick={(e) => setAnchor(e.currentTarget)} data-testid="app-version"
                    sx={{ mr: 1, minWidth: 0, textTransform: 'none', opacity: 0.85, fontVariantNumeric: 'tabular-nums' }}>
                    <Badge color="warning" variant="dot" invisible={!check?.updateAvailable}>v{version}</Badge>
                </Button>
            </Tooltip>
            <Menu anchorEl={anchor} open={!!anchor} onClose={close}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
                <Box sx={{ px: 2, py: 1, maxWidth: 320 }}>
                    <Typography variant="subtitle2">GeoChem {version}</Typography>
                    <Typography variant="caption" color={check?.error ? 'warning.main' : 'text.secondary'} component="div">
                        {checkStatusText(check, checking)}
                    </Typography>
                    {note && <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>{note}</Typography>}
                </Box>
                <Divider />
                {check?.updateAvailable && (
                    <MenuItem onClick={() => { close(); setDialog('update'); }}>
                        <ListItemIcon><SystemUpdateAlt fontSize="small" color="warning" /></ListItemIcon>
                        <ListItemText primary={`Update to ${check.latest}…`} />
                    </MenuItem>
                )}
                <MenuItem disabled={checking} onClick={() => { void useUpdateStore.getState().checkAndReport(); }}>
                    <ListItemIcon><Refresh fontSize="small" /></ListItemIcon>
                    <ListItemText primary="Check for updates" />
                </MenuItem>
                <MenuItem disabled={!info} onClick={() => { close(); setDialog('current'); }}>
                    <ListItemIcon><NewReleases fontSize="small" /></ListItemIcon>
                    <ListItemText primary="What's new" />
                </MenuItem>
                <MenuItem component="a" href={releases} target="_blank" rel="noopener" onClick={close}>
                    <ListItemIcon><OpenInNew fontSize="small" /></ListItemIcon>
                    <ListItemText primary="All releases on GitHub" />
                </MenuItem>
                <MenuItem onClick={() => { close(); useAppStore.getState().setCurrentView('settings'); }}>
                    <ListItemIcon><SettingsIcon fontSize="small" /></ListItemIcon>
                    <ListItemText primary="Update settings…" />
                </MenuItem>
            </Menu>
        </>
    );
};

/** App-bar version menu + "Update available" button + dialog + start-up check. */
export const UpdateNotice: React.FC = () => {
    const check = useUpdateStore(s => s.check);
    const setDialog = useUpdateStore(s => s.setDialog);
    const enabled = useUIStore(s => s.updateCheckEnabled);
    const version = useUpdateStore(s => s.info?.version) || BUILD_VERSION;

    useEffect(() => {
        void useUpdateStore.getState().loadVersion();
    }, []);
    // The window / taskbar title carries the version
    useEffect(() => {
        if (version) document.title = `GeoChem ${version}`;
    }, [version]);
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
            <VersionMenu />
            <UpdateDialog />
        </>
    );
};
