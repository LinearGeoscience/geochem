/**
 * menu command finder (Ctrl+K): type a menu path or task and run the
 * matching GeoChem action.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Box, Dialog, InputAdornment, List, ListItemButton, ListItemText, TextField, Typography } from '@mui/material';
import { Search } from '@mui/icons-material';
import { useUIStore } from '../../store/uiStore';
import { useAppStore } from '../../store/appStore';
import { buildCommands, searchCommands } from './interopCommands';

export const CommandFinder: React.FC = () => {
    const open = useUIStore(s => s.commandFinderOpen);
    const setOpen = useUIStore(s => s.setCommandFinderOpen);
    const hasData = useAppStore(s => s.columnarData.rowCount > 0);
    const [query, setQuery] = useState('');
    const [active, setActive] = useState(0);

    // Ctrl/Cmd+K anywhere
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                useUIStore.getState().setCommandFinderOpen(true);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    // eslint-disable-next-line react-hooks/exhaustive-deps
    const commands = useMemo(() => (open ? buildCommands() : []), [open]);
    const matches = useMemo(
        () => searchCommands(query, commands).filter(c => hasData || !c.needsData).slice(0, 12),
        [query, commands, hasData],
    );
    useEffect(() => setActive(0), [query]);

    const close = () => { setOpen(false); setQuery(''); };
    const run = (k: number) => {
        const c = matches[k];
        if (!c) return;
        close();
        c.run();
    };

    return (
        <Dialog open={open} onClose={close} maxWidth="sm" fullWidth PaperProps={{ sx: { position: 'fixed', top: 64, m: 0 } }}>
            <Box sx={{ p: 1.5 }}>
                <TextField
                    autoFocus fullWidth size="small"
                    placeholder="menu path or task, e.g. Data/Data Doctor, PCA, From Shape, checkpoint"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, matches.length - 1)); }
                        else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
                        else if (e.key === 'Enter') { e.preventDefault(); run(active); }
                    }}
                    InputProps={{ startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> }}
                    inputProps={{ 'aria-label': 'Find command' }}
                />
            </Box>
            <List dense sx={{ pt: 0, maxHeight: 420, overflow: 'auto' }}>
                {matches.map((c, k) => (
                    <ListItemButton key={c.id} selected={k === active} onClick={() => run(k)} onMouseEnter={() => setActive(k)}>
                        <ListItemText
                            primary={<Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{c.interop}</Typography>}
                            secondary={c.title}
                        />
                    </ListItemButton>
                ))}
                {!matches.length && (
                    <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1.5 }}>
                        {hasData ? 'No matching command' : 'No match - load a dataset for data commands'}
                    </Typography>
                )}
            </List>
        </Dialog>
    );
};
