/**
 * The wireframes of the project's scene, as a section of the 3D view's side
 * panel: load Leapfrog .msh, DXF, OBJ, STL or GOCAD .ts files and set each
 * object's colour, opacity, edges and visibility. The list is part of the
 * scene (store/modelStore: saved, undone, shown in every 3D view); the files
 * are kept in the project folder (features/model/wireframeFiles).
 */
import React, { useRef, useState } from 'react';
import { Alert, Box, Button, Checkbox, CircularProgress, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { FileOpen, CenterFocusStrong, GridOn, DeleteOutline } from '@mui/icons-material';
import { useModelStore } from '../../../store/modelStore';
import { useProjectStore } from '../../../store/projectStore';
import { useShownObjects } from '../../../hooks/useViewVisibility';
import { OpacityRow } from '../../modelling/properties/CommitSlider';
import { requestDelete } from '../../model/deleteObjects';
import { keys } from '../../model/objectKeys';
import { useWireframeFiles, type WireframeFile } from '../../model/wireframeFiles';
import type { WireframeObject } from '../../model/types';
import { loadWireframeFiles, type WireframeNote } from './wireframeLoad';
import { WIREFRAME_EXTENSIONS } from './wireframeParsers';
import { Term } from '../../modelling/Term';

interface Props {
    /** World bounds of the plotted points (to flag wireframes in another coordinate system) */
    dataBounds: { min: number[]; max: number[] } | null;
    /** Frame these world bounds in the viewer */
    onZoomTo: (bounds: { min: number[]; max: number[] }) => void;
}

type Note = WireframeNote;

const fmtCount = (n: number) => n.toLocaleString();

function describe(w: WireframeObject, file: WireframeFile | undefined): string {
    const p = file?.parts[w.part];
    if (!p) return w.name;
    const bits: string[] = [w.name];
    if (file!.format) bits.push(file!.format.toUpperCase());
    if (p.triangles.length) bits.push(`${fmtCount(p.triangles.length / 3)} triangles`);
    if (p.lines.length) bits.push(`${fmtCount(p.lines.length / 2)} line segments`);
    return bits.join(' · ');
}

export const WireframeSection: React.FC<Props> = ({ dataBounds, onZoomTo }) => {
    const wireframes = useModelStore(s => s.scene.wireframes);
    const files = useWireframeFiles(s => s.byFile);
    const notKept = useWireframeFiles(s => s.notKept);
    const projectPath = useProjectStore(s => s.projectPath);
    const { updateWireframe } = useModelStore.getState();
    /** Asked about first: the dialog names what is built on them */
    const remove = (ids: string[]) => { requestDelete(ids.map(keys.wireframe)); };
    // Shown or hidden in the view this panel sits in
    const view = useShownObjects();
    const [busy, setBusy] = useState(false);
    const [messages, setMessages] = useState<Note[]>([]);
    const inputRef = useRef<HTMLInputElement>(null);
    /** The scene's name of the missing file the next picked file stands in for */
    const locating = useRef<string | null>(null);

    const loadFiles = async (picked: File[], as?: string) => {
        if (picked.length === 0) return;
        setBusy(true);
        setMessages(await loadWireframeFiles(picked, dataBounds, as));
        setBusy(false);
    };

    const pick = (as: string | null) => {
        locating.current = as;
        if (inputRef.current) {
            inputRef.current.multiple = as === null;
            inputRef.current.click();
        }
    };

    const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
        const picked = Array.from(e.target.files ?? []);
        e.target.value = ''; // allow re-loading the same file
        void loadFiles(picked, locating.current ?? undefined);
    };

    const onDrop = (e: React.DragEvent) => {
        e.preventDefault();
        void loadFiles(Array.from(e.dataTransfer.files));
    };

    // Objects of a file that is not there are listed once, by the file
    const absent = Array.from(new Set(wireframes.filter(w => files[w.file] && files[w.file].state !== 'ready').map(w => w.file)));
    const shown = wireframes.filter(w => !files[w.file] || files[w.file].state === 'ready');

    return (
        <Box data-testid="wireframe-section" sx={{ p: 1 }} onDragOver={e => e.preventDefault()} onDrop={onDrop}>
            <input ref={inputRef} type="file" hidden multiple accept={WIREFRAME_EXTENSIONS.join(',')} onChange={onPick} data-testid="wireframe-input" />
            <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 0.5 }}>
                <Typography variant="subtitle2" sx={{ flex: 1 }}><Term k="meshesPanel" /></Typography>
                {busy && <CircularProgress size={14} />}
                {wireframes.length > 1 && (
                    <Button size="small" color="inherit" sx={{ textTransform: 'none', minWidth: 0, py: 0 }} onClick={() => remove(wireframes.map(w => w.id))}>Remove all</Button>
                )}
                <Tooltip title="Leapfrog .msh, DXF (one object per layer), OBJ, STL or GOCAD .ts. Or drop the files here.">
                    <span>
                        <Button size="small" variant="outlined" startIcon={<FileOpen fontSize="small" />} disabled={busy} sx={{ textTransform: 'none', py: 0 }} onClick={() => pick(null)}>
                            Load
                        </Button>
                    </span>
                </Tooltip>
            </Stack>

            {messages.map((m, k) => (
                <Alert key={k} severity={m.severity} sx={{ mb: 0.5, py: 0, '& .MuiAlert-message': { fontSize: 12 } }} onClose={() => setMessages(ms => ms.filter((_, j) => j !== k))}>
                    {m.text}
                </Alert>
            ))}

            {wireframes.length === 0 && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    Load or drop mesh files here: pit shells, faults, geology from other software.
                    They are saved with the project and shown in every 3D view.
                </Typography>
            )}

            {absent.map(file => {
                const entry = files[file];
                const ids = wireframes.filter(w => w.file === file).map(w => w.id);
                return (
                    <Box key={file} data-wireframe-file={file} sx={{ borderBottom: 1, borderColor: 'divider', py: 0.25 }}>
                        <Stack direction="row" alignItems="center" spacing={0.5}>
                            {entry.state === 'loading' && <CircularProgress size={12} sx={{ mx: 0.5, flexShrink: 0 }} />}
                            <Tooltip title={file}>
                                <Typography variant="body2" noWrap color="text.secondary" sx={{ flex: 1, minWidth: 0, fontSize: 13, pl: entry.state === 'loading' ? 0 : 0.5 }}>{file}</Typography>
                            </Tooltip>
                            {entry.state !== 'loading' && (
                                <Tooltip title="Point to the file again; a copy is then kept with the project">
                                    <Button size="small" sx={{ textTransform: 'none', minWidth: 0, py: 0 }} aria-label={`Find ${file}`} onClick={() => pick(file)}>Find the file</Button>
                                </Tooltip>
                            )}
                            <Tooltip title="Remove">
                                <IconButton size="small" sx={{ p: 0.25 }} aria-label={`Remove ${file}`} onClick={() => remove(ids)}><DeleteOutline fontSize="small" /></IconButton>
                            </Tooltip>
                        </Stack>
                        <Typography variant="caption" color={entry.state === 'loading' ? 'text.secondary' : 'warning.main'} sx={{ display: 'block', pl: 0.5 }}>
                            {entry.state === 'loading' ? 'Reading the file'
                                : entry.state === 'missing' ? 'Its file is not in the project folder.'
                                    : `Its file could not be read: ${entry.error}`}
                        </Typography>
                    </Box>
                );
            })}

            {shown.map(w => {
                const part = files[w.file]?.parts[w.part];
                const solid = !part || part.triangles.length > 0;
                return (
                    <Box key={w.id} data-wireframe={w.id} sx={{ borderBottom: 1, borderColor: 'divider', pb: 0.25 }}>
                        <Stack direction="row" alignItems="center" spacing={0.25}>
                            <Checkbox size="small" checked={view.isShown(keys.wireframe(w.id))} sx={{ p: 0.5 }} inputProps={{ 'aria-label': `Show ${w.name}` }} onChange={e => view.setShown([keys.wireframe(w.id)], e.target.checked)} />
                            <Tooltip title="Colour">
                                <input
                                    type="color" value={w.color} aria-label={`Colour of ${w.name}`}
                                    onChange={e => updateWireframe(w.id, { color: e.target.value })}
                                    style={{ width: 22, height: 22, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer', flexShrink: 0 }}
                                />
                            </Tooltip>
                            <Tooltip title={describe(w, files[w.file])}>
                                <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0, fontSize: 13 }}>{w.name}</Typography>
                            </Tooltip>
                            {solid && (
                                <Tooltip title="Show the triangle edges">
                                    <IconButton size="small" sx={{ p: 0.25 }} color={w.showEdges ? 'primary' : 'default'} onClick={() => updateWireframe(w.id, { showEdges: !w.showEdges })}>
                                        <GridOn fontSize="small" />
                                    </IconButton>
                                </Tooltip>
                            )}
                            <Tooltip title="Zoom to">
                                <span><IconButton size="small" sx={{ p: 0.25 }} disabled={!part} aria-label={`Zoom to ${w.name}`} onClick={() => part && onZoomTo(part.bounds)}><CenterFocusStrong fontSize="small" /></IconButton></span>
                            </Tooltip>
                            <Tooltip title="Remove">
                                <IconButton size="small" sx={{ p: 0.25 }} aria-label={`Remove ${w.name}`} onClick={() => remove([w.id])}><DeleteOutline fontSize="small" /></IconButton>
                            </Tooltip>
                        </Stack>
                        {solid && (
                            <Box sx={{ pl: 4, pr: 1, mt: -1 }}>
                                <OpacityRow value={w.opacity} label={`Opacity of ${w.name}`} none="No surface" onCommit={opacity => updateWireframe(w.id, { opacity })} />
                            </Box>
                        )}
                    </Box>
                );
            })}

            {notKept.length > 0 && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                    {projectPath
                        ? 'A copy could not be put in the project folder yet. It is tried again at the next Save.'
                        : 'Copies of the files are kept with the project once it is saved to a folder (File, Save).'}
                </Typography>
            )}
        </Box>
    );
};
