/**
 * Named versions of the modelling scene, shown when nothing is picked in
 * the tree: keep the scene as it is under a name, go back to a version,
 * and open a model's rebuild kit (which arrives as a version).
 */
import React, { useRef, useState } from 'react';
import { Alert, Box, Button, IconButton, TextField, Tooltip, Typography } from '@mui/material';
import { DeleteOutline } from '@mui/icons-material';
import { openModelKit } from '../../model/modelKitActions';
import { MAX_VERSIONS, useSceneVersions, versionSummary } from '../../../store/sceneVersionsStore';
import { Caption } from './parts';
import { smallButton } from './styles';

export const SceneVersions: React.FC = () => {
    const versions = useSceneVersions(s => s.versions);
    const [name, setName] = useState('');
    const [note, setNote] = useState<{ text: string; severity: 'info' | 'warning' | 'success' } | null>(null);
    const file = useRef<HTMLInputElement>(null);
    const full = versions.length >= MAX_VERSIONS;
    const keep = () => {
        const id = useSceneVersions.getState().keep(name.trim() || undefined);
        setName('');
        setNote(id ? null : { text: `At most ${MAX_VERSIONS} versions are kept: delete one first.`, severity: 'warning' });
    };
    const open = async (picked: File | undefined) => {
        if (!picked) return;
        const done = await openModelKit(new Uint8Array(await picked.arrayBuffer()));
        setNote(done.ok
            ? { text: `${done.name} is kept as the version "${done.version}". Nothing has changed in the scene. Going back to that version puts the scene as the kit has it: that model and what it is built from, and nothing else. Keep the scene as it is now first if there is more in it.`, severity: 'success' }
            : { text: done.reason, severity: 'warning' });
        if (file.current) file.current.value = '';
    };
    return (
        <Box data-testid="scene-versions" sx={{ mt: 2 }}>
            <Caption>Versions of the scene</Caption>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.35 }}>
                The whole scene as it is now (surfaces, what they are built from, models, sections), kept under a name to go back to. Saved with the project.
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.75, mt: 0.5 }}>
                <TextField
                    size="small" variant="standard" value={name} placeholder={`Version ${versions.length + 1}`} sx={{ flex: 1, minWidth: 0 }}
                    onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !full) keep(); }}
                    inputProps={{ 'aria-label': 'A name for the version', style: { fontSize: 13 } }}
                />
                <Button size="small" variant="outlined" sx={smallButton} disabled={full} onClick={keep}>Keep it as it is now</Button>
            </Box>
            {versions.length === 0 && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>None kept yet.</Typography>}
            {[...versions].reverse().map(v => (
                <Box key={v.id} data-testid="scene-version" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="caption" noWrap sx={{ display: 'block', fontWeight: 600 }}>{v.name}</Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.3 }}>{v.from ? `${v.from} · ` : ''}{versionSummary(v)}</Typography>
                    </Box>
                    <Tooltip describeChild title="The scene becomes this version. What the scene is now is lost unless it is kept as a version first; Undo (Ctrl+Z) puts it back for now.">
                        <Button size="small" sx={smallButton} onClick={() => { useSceneVersions.getState().goBack(v.id); setNote({ text: `The scene is now "${v.name}". Undo (Ctrl+Z) puts back what it was.`, severity: 'info' }); }}>Go back to it</Button>
                    </Tooltip>
                    <Tooltip title="Delete this version (the scene itself is not touched)">
                        <IconButton size="small" aria-label={`Delete the version ${v.name}`} onClick={() => useSceneVersions.getState().remove(v.id)}><DeleteOutline fontSize="small" /></IconButton>
                    </Tooltip>
                </Box>
            ))}
            <input ref={file} type="file" accept=".zip" hidden aria-label="A model's Leapfrog export" onChange={e => { void open(e.target.files?.[0]); }} />
            <Tooltip title="A kit saved from a geological model (its Leapfrog export): the model as it was written, with all it is built from, arrives as a version to go back to">
                <span><Button size="small" sx={{ ...smallButton, mt: 0.75 }} disabled={full} onClick={() => file.current?.click()}>Open a model's Leapfrog export (.zip)…</Button></span>
            </Tooltip>
            {note && <Alert data-testid="versions-note" severity={note.severity} sx={{ py: 0, mt: 0.5, fontSize: 12 }}>{note.text}</Alert>}
        </Box>
    );
};
