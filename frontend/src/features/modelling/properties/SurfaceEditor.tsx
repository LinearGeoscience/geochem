/**
 * A surface in the properties. Its head (EditorHeader) is always the same:
 * what it is, its name and colour, shown or not, its lock, how it stands,
 * deleting it. Picked, it says no more than that; opened for editing (Edit,
 * or a double-click in the tree), its settings are under four tabs (Inputs,
 * Surfacing, Trend, Outputs), and points and lines are placed and drawn for
 * it in the model view the pane acts on.
 */
import React from 'react';
import { Box, Button, Typography } from '@mui/material';
import { Edit, GridOn } from '@mui/icons-material';
import { useModelStore } from '../../../store/modelStore';
import { contactInputsFor, shellInputsFor, useModelCache } from '../../model/modelCache';
import { lockNote, surfaceStatus } from '../../model/describe';
import { StoppedFit } from '../../plots/viewer3d/StoppedFit';
import { openModelDialog } from '../../model/modelDialogs';
import { keys } from '../../model/objectKeys';
import type { SurfaceObject } from '../../model/types';
import { SurfaceDetails } from '../../plots/viewer3d/SurfacePanel';
import { coordsFor, useTargetView } from '../targetView';
import { pickFromView } from '../../model/treePicks';
import { OpacityRow } from './CommitSlider';
import { EditorHeader } from './EditorHeader';
import { NoViewNote } from './parts';
import { smallButton } from './styles';
import { madeType } from '../../model/objectTypes';
import { partHome } from '../../model/blockParts';

/** A surface a model fits in each fault block apart: what is shown and listed here is of the surface through every block */
const ByBlockNote: React.FC<{ surface: SurfaceObject }> = ({ surface }) => {
    const scene = useModelStore(s => s.scene);
    const parts = scene.surfaces.filter(s => s.blockOf === surface.id);
    if (parts.length === 0) return null;
    const names = [...new Set(parts.map(p => partHome(scene, p)?.model.name).filter((n): n is string => !!n))];
    return (
        <Typography data-testid="surface-by-block" variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            {`${names.join(' and ') || 'Its model'} fits it ${parts.some(p => partHome(scene, p)?.contact) ? 'in each fault block' : 'on each side of the faults that offset it'} apart (${parts.length} parts, listed under it in the tree): a view shows those. Its points, lines and settings are changed here, and the parts follow; the fit and the misfits said here are of the one surface through all of it.`}
        </Typography>
    );
};

export const SurfaceEditor: React.FC<{ surface: SurfaceObject }> = ({ surface }) => {
    const editing = useModelStore(s => s.editingId === surface.id);
    const { updateSurface, setEditing } = useModelStore.getState();
    const result = useModelCache(s => s.byId[surface.id]);
    // (The direction it follows: its own when it has one, else the model's)
    const structure = useModelStore(s => surface.params.trendOwn ?? s.scene.structure?.overall ?? null);
    const target = useTargetView();
    const st = target.status;
    const key = keys.surface(surface.id);
    const coords = () => coordsFor(target);
    // (Open, how it stands is said over its tabs, with what a lock or a held direction adds)
    const status = editing ? null : surfaceStatus(surface, result, contactInputsFor(surface), shellInputsFor(surface), structure);

    return (
        <Box data-testid="surface-editor">
            <EditorHeader
                objectKey={key} name={surface.name} type={madeType(surface)}
                color={surface.color} onColor={color => updateSurface(surface.id, { color })}
                locked={!!surface.locked} onLock={locked => updateSurface(surface.id, { locked: locked || undefined })}
                status={status ? { text: status.headline, problem: status.problem, notes: status.notes } : null}
                look={(
                    <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1 }}>
                        <Box sx={{ flex: 1, minWidth: 0 }}><OpacityRow value={surface.opacity} onCommit={opacity => updateSurface(surface.id, { opacity })} /></Box>
                        <Button
                            size="small" sx={smallButton} startIcon={<GridOn fontSize="small" />} color={surface.showEdges ? 'primary' : 'inherit'}
                            aria-pressed={surface.showEdges} onClick={() => updateSurface(surface.id, { showEdges: !surface.showEdges })}
                        >
                            Triangle edges
                        </Button>
                    </Box>
                )}
            >
                {editing && <Button size="small" variant="outlined" sx={smallButton} data-action="done-editing" onClick={() => setEditing(null)}>Done</Button>}
            </EditorHeader>
            <ByBlockNote surface={surface} />
            {editing ? (
                <>
                    <NoViewNote what="place and draw its points and lines" />
                    {/* (Normal sizes: the settings were written for a narrow panel beside a view) */}
                    <Box sx={{ mx: -1, '& .MuiTypography-caption': { fontSize: '0.8125rem', lineHeight: 1.45 } }}>
                        <SurfaceDetails
                            tabs
                            surface={surface} here={!!st?.here} canSlice={!!st?.canSlice} outlining={!!st?.outlining} vex={st?.vex ?? 1}
                            viewport={st?.ready && st.here ? target.actions()?.viewport() ?? null : null}
                            onDraw={() => { target.actions()?.drawOnSlice(); }}
                            onOutline={() => { target.actions()?.startOutline(); }}
                            onContact={id => openModelDialog('contact', coords(), id ?? null)}
                            onShell={id => openModelDialog('shell', coords(), id ?? null)}
                            onCopied={id => { setEditing(null); pickFromView(keys.surface(id)); }}
                            onZoomTo={st?.ready && st.here ? p => {
                                // A place has no size: a share of the data round it
                                const box = target.actions()?.dataBounds();
                                const r = box ? Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2], 1) / 12 : 25;
                                target.actions()?.zoomToWorld({ min: [p[0] - r, p[1] - r, p[2] - r], max: [p[0] + r, p[1] + r, p[2] + r] });
                            } : undefined}
                        />
                    </Box>
                </>
            ) : (
                <>
                    {lockNote(surface, result) && <Typography variant="body2" color="warning.main" data-testid="locked-note" sx={{ mt: 0.5 }}>{lockNote(surface, result)}</Typography>}
                    <StoppedFit surfaceId={surface.id} />
                    <Button
                        size="small" variant="contained" fullWidth startIcon={<Edit fontSize="small" />} sx={{ textTransform: 'none', mt: 1.25 }}
                        onClick={() => setEditing(surface.id)}
                    >
                        Edit
                    </Button>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                        Its inputs, how it is fitted, its trend, and its outputs and checks. Or double-click it in the tree.
                    </Typography>
                </>
            )}
        </Box>
    );
};
