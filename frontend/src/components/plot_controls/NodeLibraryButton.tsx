/**
 * "Mineral and rock nodes" picker: tick minerals / average rocks to
 * draw as labelled reference points on the plot. The selection is a list of
 * node ids kept in the plot's settings. User nodes come from Summary
 * statistics (group medians) or a node CSV. Tie-lines join two ticked
 * nodes (e.g. muscovite - albite) and are kept in the same list as "tie:a|b".
 */
import React, { useMemo, useState } from 'react';
import {
    Badge, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel,
    IconButton, MenuItem, Tab, Tabs, TextField, Tooltip, Typography,
} from '@mui/material';
import { Diamond, Delete, Upload } from '@mui/icons-material';
import { NODE_LIBRARY, NODE_NO_LABELS, NODE_SOURCES, NodeDef, NodeKind, parseNodeCsv, tieId, tiePairs } from '../../utils/nodeLibrary';
import { useUserNodeStore } from '../../store/userNodeStore';
import { notify } from '../../store/notificationStore';

export const NodeLibraryButton: React.FC<{ value: string[]; onChange: (ids: string[]) => void }> = ({ value, onChange }) => {
    const [open, setOpen] = useState(false);
    const [kind, setKind] = useState<NodeKind>('mineral');
    const selected = useMemo(() => new Set(value), [value]);
    const userNodes = useUserNodeStore(s => s.nodes);
    const all = useMemo(() => [...NODE_LIBRARY, ...userNodes], [userNodes]);
    const groups = useMemo(() => {
        const g = new Map<string, NodeDef[]>();
        for (const n of all) if (n.kind === kind) g.set(n.group, [...(g.get(n.group) ?? []), n]);
        return [...g];
    }, [kind, all]);

    const ties = useMemo(() => tiePairs(value), [value]);
    const ticked = useMemo(() => all.filter(n => selected.has(n.id)), [all, selected]);
    const [tieA, setTieA] = useState('');
    const [tieB, setTieB] = useState('');

    const toggle = (ids: string[], on: boolean) => {
        const next = new Set(value);
        for (const id of ids) if (on) next.add(id); else next.delete(id);
        const nodes = all.filter(n => next.has(n.id)).map(n => n.id);
        const kept = new Set(nodes);
        onChange([...nodes, ...ties.filter(([a, b]) => kept.has(a) && kept.has(b)).map(([a, b]) => tieId(a, b)), ...value.filter(i => i.startsWith('opt:'))]);
    };
    const nameOf = (id: string) => all.find(n => n.id === id)?.name ?? id;
    const addTie = () => {
        if (!tieA || !tieB || tieA === tieB || value.includes(tieId(tieA, tieB))) return;
        onChange([...value, tieId(tieA, tieB)]);
    };
    const nodeCount = value.length - ties.length - value.filter(i => i.startsWith('opt:')).length;
    const labels = !value.includes(NODE_NO_LABELS);

    const importCsv = async (file: File) => {
        try {
            const nodes = parseNodeCsv(await file.text(), file.name.replace(/\.(csv|txt)$/i, ''));
            useUserNodeStore.getState().addNodes(nodes);
            notify(`Imported ${nodes.length} nodes from ${file.name}`, 'success');
        } catch (err) {
            notify(err instanceof Error ? err.message : 'Could not read the node file', 'error');
        }
    };

    return (
        <>
            <Tooltip title="Mineral and rock nodes">
                <IconButton size="small" onClick={() => setOpen(true)} color={value.length ? 'primary' : 'default'} aria-label="Mineral and rock nodes">
                    <Badge badgeContent={nodeCount} color="primary" max={99}><Diamond fontSize="small" /></Badge>
                </IconButton>
            </Tooltip>
            <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>Mineral and rock nodes</DialogTitle>
                <Tabs value={kind} onChange={(_, v) => setKind(v)} sx={{ px: 2 }}>
                    <Tab value="mineral" label="Minerals" />
                    <Tab value="rock" label="Rocks" />
                    <Tab value="user" label={`User (${userNodes.length})`} />
                </Tabs>
                <DialogContent dividers>
                    {groups.map(([group, nodes]) => {
                        const allOn = nodes.every(n => selected.has(n.id));
                        const some = nodes.some(n => selected.has(n.id));
                        return (
                            <Box key={group} sx={{ mb: 1.5 }}>
                                <FormControlLabel
                                    control={<Checkbox size="small" checked={allOn} indeterminate={some && !allOn} onChange={(e) => toggle(nodes.map(n => n.id), e.target.checked)} />}
                                    label={<Typography variant="subtitle2">{group}</Typography>}
                                />
                                {kind === 'user' && (
                                    <Tooltip title={`Delete the ${group} nodes`}>
                                        <IconButton size="small" aria-label={`Delete ${group}`} onClick={() => {
                                            toggle(nodes.map(n => n.id), false);
                                            useUserNodeStore.getState().removeGroup(group);
                                        }}><Delete fontSize="small" /></IconButton>
                                    </Tooltip>
                                )}
                                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', pl: 3 }}>
                                    {nodes.map(n => (
                                        <FormControlLabel
                                            key={n.id}
                                            control={<Checkbox size="small" checked={selected.has(n.id)} onChange={(e) => toggle([n.id], e.target.checked)} />}
                                            label={<Tooltip title={n.formula ?? ''} placement="right"><Typography variant="body2">{n.name}{n.formula ? ` (${n.label})` : ''}</Typography></Tooltip>}
                                        />
                                    ))}
                                </Box>
                            </Box>
                        );
                    })}
                    {kind === 'user' && !userNodes.length && (
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                            No user nodes yet. Save colour-group medians from Analysis › Summary statistics, or import a node CSV
                            (Name column, then element/oxide columns with units such as SiO2_pct, Cu_ppm).
                        </Typography>
                    )}
                    {kind === 'user' && (
                        <Button size="small" component="label" startIcon={<Upload />} sx={{ mb: 1 }}>
                            Import node CSV…
                            <input hidden type="file" accept=".csv,.txt" onChange={(e) => {
                                const f = e.target.files?.[0];
                                e.target.value = '';
                                if (f) void importCsv(f);
                            }} />
                        </Button>
                    )}
                    <Box sx={{ mt: 1, mb: 1.5 }} data-testid="tie-lines">
                        <Typography variant="subtitle2">Tie-lines</Typography>
                        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 0.5 }}>
                            <TextField select size="small" label="From" value={tieA} onChange={e => setTieA(e.target.value)} sx={{ minWidth: 150 }} disabled={ticked.length < 2}>
                                {ticked.map(n => <MenuItem key={n.id} value={n.id}>{n.name}</MenuItem>)}
                            </TextField>
                            <TextField select size="small" label="To" value={tieB} onChange={e => setTieB(e.target.value)} sx={{ minWidth: 150 }} disabled={ticked.length < 2}>
                                {ticked.map(n => <MenuItem key={n.id} value={n.id}>{n.name}</MenuItem>)}
                            </TextField>
                            <Button size="small" onClick={addTie} disabled={!tieA || !tieB || tieA === tieB}>Add tie-line</Button>
                        </Box>
                        {ties.map(([a, b]) => (
                            <Box key={`${a}|${b}`} sx={{ display: 'flex', alignItems: 'center', pl: 1 }}>
                                <Typography variant="body2">{nameOf(a)} – {nameOf(b)}</Typography>
                                <IconButton size="small" aria-label="Remove tie-line" onClick={() => onChange(value.filter(v => v !== tieId(a, b)))}><Delete fontSize="small" /></IconButton>
                            </Box>
                        ))}
                        {ticked.length < 2 && <Typography variant="caption" color="text.secondary">Tick two nodes to join them with a tie-line.</Typography>}
                    </Box>
                    <Typography variant="caption" color="text.secondary" component="div">{NODE_SOURCES[kind]}. Nodes without the plotted components are not drawn.</Typography>
                </DialogContent>
                <DialogActions>
                    <FormControlLabel sx={{ mr: 'auto', ml: 1 }} label={<Typography variant="body2">Show node names</Typography>}
                        control={<Checkbox size="small" checked={labels} onChange={e => onChange(e.target.checked ? value.filter(i => i !== NODE_NO_LABELS) : [...value, NODE_NO_LABELS])} />} />
                    <Button onClick={() => onChange(value.filter(i => i.startsWith('opt:')))} disabled={!nodeCount}>Clear all</Button>
                    <Button variant="contained" onClick={() => setOpen(false)}>Done</Button>
                </DialogActions>
            </Dialog>
        </>
    );
};
