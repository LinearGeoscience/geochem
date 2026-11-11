/**
 * Wireframes button + popover for the 3D viewer: load Leapfrog .msh, DXF,
 * OBJ, STL or GOCAD .ts files and set each one's colour, opacity, edges and
 * visibility. The layers live in wireframeStore (per plot, session only).
 */
import React, { useRef, useState } from 'react';
import {
    Alert, Badge, Box, Button, Checkbox, CircularProgress, IconButton, Popover, Slider, Stack, Tooltip, Typography,
} from '@mui/material';
import { ViewInAr, FileOpen, CenterFocusStrong, GridOn, DeleteOutline } from '@mui/icons-material';
import { useWireframeStore, parseWireframeFile, planGap, unionBounds, WireframeLayer, NO_WIREFRAMES } from './wireframeStore';
import { WIREFRAME_EXTENSIONS } from './wireframeParsers';

interface Props {
    plotId: string;
    /** World bounds of the plotted points (to flag wireframes in another coordinate system) */
    dataBounds: { min: number[]; max: number[] } | null;
    /** Frame these world bounds in the viewer */
    onZoomTo: (bounds: { min: number[]; max: number[] }) => void;
}

const fmtCount = (n: number) => n.toLocaleString();

function describe(layer: WireframeLayer): string {
    const p = layer.part;
    const bits: string[] = [layer.format.toUpperCase()];
    if (p.triangles.length) bits.push(`${fmtCount(p.triangles.length / 3)} triangles`);
    if (p.lines.length) bits.push(`${fmtCount(p.lines.length / 2)} line segments`);
    return bits.join(' · ');
}

export const WireframeButton: React.FC<Props> = ({ plotId, dataBounds, onZoomTo }) => {
    const layers = useWireframeStore(s => s.byPlot[plotId] ?? NO_WIREFRAMES);
    const { add, update, remove, clear } = useWireframeStore.getState();
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const [busy, setBusy] = useState(false);
    const [messages, setMessages] = useState<{ severity: 'error' | 'warning'; text: string }[]>([]);
    const inputRef = useRef<HTMLInputElement>(null);

    const loadFiles = async (files: File[]) => {
        if (files.length === 0) return;
        setBusy(true);
        const notes: { severity: 'error' | 'warning'; text: string }[] = [];
        for (const file of files) {
            try {
                const parsed = await parseWireframeFile(file);
                const multi = parsed.parts.length > 1;
                add(plotId, parsed.parts.map(part => ({
                    name: multi && part.name ? `${file.name} · ${part.name}` : file.name,
                    fileName: file.name,
                    format: parsed.format,
                    part,
                })));
                for (const w of parsed.warnings) notes.push({ severity: 'warning', text: `${file.name}: ${w}` });
                const b = unionBounds(parsed.parts.map(p => p.bounds));
                if (b && dataBounds) {
                    const gap = planGap(b, dataBounds);
                    if (gap > 0) {
                        const dist = gap >= 1000 ? `${(gap / 1000).toFixed(1)} km` : `${Math.round(gap)} m`;
                        notes.push({
                            severity: 'warning',
                            text: `${file.name} is ${dist} from the data in plan — check it uses the same coordinate system (e.g. MGA zone / local mine grid).`,
                        });
                    }
                }
            } catch (e) {
                notes.push({ severity: 'error', text: `${file.name}: ${e instanceof Error ? e.message : String(e)}` });
            }
        }
        setMessages(notes);
        setBusy(false);
    };

    const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files ?? []);
        e.target.value = ''; // allow re-loading the same file
        void loadFiles(files);
    };

    const onDrop = (e: React.DragEvent) => {
        e.preventDefault();
        void loadFiles(Array.from(e.dataTransfer.files));
    };

    return (
        <>
            <Tooltip title="Wireframes (Leapfrog .msh, DXF, OBJ, STL, GOCAD .ts)">
                <Button size="small" onClick={e => setAnchor(e.currentTarget)}>
                    <Badge badgeContent={layers.length} color="primary" max={99} invisible={layers.length === 0}>
                        <ViewInAr fontSize="small" />
                    </Badge>
                </Button>
            </Tooltip>
            <input
                ref={inputRef} type="file" hidden multiple
                accept={WIREFRAME_EXTENSIONS.join(',')}
                onChange={onPick}
            />
            <Popover
                open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            >
                <Box sx={{ p: 1.5, width: 360 }} onDragOver={e => e.preventDefault()} onDrop={onDrop}>
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                        <Typography variant="subtitle2" sx={{ flex: 1 }}>Wireframes</Typography>
                        {busy && <CircularProgress size={16} />}
                        {layers.length > 0 && <Button size="small" color="inherit" onClick={() => clear(plotId)}>Remove all</Button>}
                        <Button size="small" variant="contained" startIcon={<FileOpen fontSize="small" />} disabled={busy} onClick={() => inputRef.current?.click()}>
                            Load…
                        </Button>
                    </Stack>

                    {messages.map((m, k) => (
                        <Alert key={k} severity={m.severity} sx={{ mb: 1, py: 0, '& .MuiAlert-message': { fontSize: 12 } }} onClose={() => setMessages(ms => ms.filter((_, j) => j !== k))}>
                            {m.text}
                        </Alert>
                    ))}

                    {layers.length === 0 ? (
                        <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                            Load or drop wireframe files here.
                        </Typography>
                    ) : (
                        <Stack spacing={0.5} sx={{ maxHeight: 360, overflowY: 'auto' }}>
                            {layers.map(layer => (
                                <Box key={layer.id} sx={{ borderBottom: 1, borderColor: 'divider', pb: 0.5 }}>
                                    <Stack direction="row" alignItems="center" spacing={0.5}>
                                        <Checkbox size="small" checked={layer.visible} sx={{ p: 0.5 }} onChange={e => update(plotId, layer.id, { visible: e.target.checked })} />
                                        <Tooltip title="Colour">
                                            <input
                                                type="color" value={layer.color}
                                                onChange={e => update(plotId, layer.id, { color: e.target.value })}
                                                style={{ width: 22, height: 22, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer', flexShrink: 0 }}
                                            />
                                        </Tooltip>
                                        <Tooltip title={`${layer.name} — ${describe(layer)}`}>
                                            <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>{layer.name}</Typography>
                                        </Tooltip>
                                        {layer.part.triangles.length > 0 && (
                                            <Tooltip title="Show triangle edges">
                                                <IconButton size="small" color={layer.showEdges ? 'primary' : 'default'} onClick={() => update(plotId, layer.id, { showEdges: !layer.showEdges })}>
                                                    <GridOn fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                        )}
                                        <Tooltip title="Zoom to">
                                            <IconButton size="small" onClick={() => onZoomTo(layer.part.bounds)}><CenterFocusStrong fontSize="small" /></IconButton>
                                        </Tooltip>
                                        <Tooltip title="Remove">
                                            <IconButton size="small" onClick={() => remove(plotId, layer.id)}><DeleteOutline fontSize="small" /></IconButton>
                                        </Tooltip>
                                    </Stack>
                                    {layer.part.triangles.length > 0 && (
                                        <Stack direction="row" alignItems="center" spacing={1} sx={{ pl: 4.5, pr: 1 }}>
                                            <Typography variant="caption" color="text.secondary" sx={{ width: 84, flexShrink: 0 }}>
                                                {layer.opacity === 0 ? 'No surface' : `Opacity ${Math.round(layer.opacity * 100)}%`}
                                            </Typography>
                                            <Slider
                                                size="small" min={0} max={1} step={0.05} value={layer.opacity}
                                                onChange={(_, v) => update(plotId, layer.id, { opacity: v as number })}
                                            />
                                        </Stack>
                                    )}
                                </Box>
                            ))}
                        </Stack>
                    )}

                    <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
                        Leapfrog .msh · DXF (3DFACE, polyface/MESH, polylines — one entry per layer) · OBJ · STL · GOCAD .ts.
                        Files are read in your browser and kept for this session.
                    </Typography>
                </Box>
            </Popover>
        </>
    );
};
