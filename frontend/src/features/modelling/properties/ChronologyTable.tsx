/**
 * A geological model's surfaces in age order, the youngest at the top: one
 * row a contact, with what it is (deposit, erosion, intrusion), the unit on
 * its younger side, which side that is, the fault block it is fitted in, and
 * whether it is in the model for now. A row is dragged by its handle to
 * another place in the order (or moved a step with its arrows).
 *
 * Narrow (a tab of the model's editor): a row takes three short lines. Wide
 * (a window of its own, opened from that tab): a table, a line to a row,
 * under headings.
 */
import React, { useRef, useState } from 'react';
import { Box, Checkbox, FormControlLabel, IconButton, Link, MenuItem, TextField, Tooltip, Typography } from '@mui/material';
import { ArrowDownward, ArrowUpward, Close, DragIndicator, SwapVert } from '@mui/icons-material';
import { useModelStore } from '../../../store/modelStore';
import { acrossByAge } from '../../model/blockParts';
import { moveContact } from '../../model/geoModelActions';
import { CONTACT_KINDS, contactProblem, describeContact, KIND_NAME, KIND_TIP, sideNames } from '../../model/geoModel';
import { keys } from '../../model/objectKeys';
import { plain, t } from '../../model/terms';
import type { ContactKind, GeoModel } from '../../model/types';
import { sidesText } from './ModelFaults';
import { Fact } from './parts';
import { UnitField } from './UnitField';

const select = { style: { fontSize: 13, paddingTop: 2, paddingBottom: 2 } } as const;
const small = { p: 0.25 } as const;
const DRAG_TYPE = 'application/x-geochem-contact';

interface Props {
    model: GeoModel;
    /** The contact picked in the tree (null: none) */
    picked: string | null;
    onGoTo: (key: string) => void;
    /** A table with room to read across (a window of its own) */
    wide?: boolean;
}

export const ChronologyTable: React.FC<Props> = ({ model, picked, onGoTo, wide = false }) => {
    const scene = useModelStore(s => s.scene);
    const { updateModelContact, removeModelContact } = useModelStore.getState();
    // (Moved, a contact made from the lithologies reads its holes by the new order)
    const moveModelContact = moveContact;
    // The row being dragged, and the row it is over (how the rows are drawn meanwhile)
    const [drag, setDrag] = useState<{ id: string; over: number | null } | null>(null);
    // The row being dragged, known at once: the first drag-over can come before the state has landed
    const dragged = useRef<string | null>(null);
    const from = drag ? model.contacts.findIndex(c => c.id === drag.id) : -1;
    // Cut by faults: a contact can be one fitted in a single fault block
    const faulted = (model.faults ?? []).length > 0 || model.contacts.some(c => c.within?.length);
    const columns = `18px minmax(140px, 2.4fr) 96px minmax(80px, 1fr) minmax(100px, 1.2fr)${faulted ? ' minmax(100px, 1fr)' : ''} 48px 66px`;

    if (model.contacts.length === 0) return <Fact>No surfaces yet. Add the surfaces between its units, the youngest first.</Fact>;

    const heading = (text: string, tip: string) => (
        <Tooltip title={tip}><Typography variant="caption" color="text.secondary" noWrap role="columnheader">{text}</Typography></Tooltip>
    );
    return (
        <Box data-testid="chronology-table" data-wide={wide || undefined} role={wide ? 'table' : undefined} aria-label={wide ? `${t('chronology')} of ${model.name}` : undefined}>
            {wide && (
                <Box role="row" sx={{ display: 'grid', gridTemplateColumns: columns, columnGap: 1, alignItems: 'baseline', px: 0.5, pb: 0.25, borderBottom: 1, borderColor: 'divider' }}>
                    <span />
                    {heading('Surface', 'The youngest at the top. Click a name to open its unit in the properties: how it is built, and the settings of its surface')}
                    {heading('Type', 'Deposit: laid on what was there. Erosion: cuts what was there away. Intrusion: a body that cuts through everything older')}
                    {heading('Lithology', `The unit on its ${t('youngerSide')}`)}
                    {heading(t('youngerSide').replace(/^./, x => x.toUpperCase()), 'Which side of the surface the younger ground is on')}
                    {faulted && heading('Fault block', 'The fault block it is fitted in: a contact split by fault block is one surface for each')}
                    {heading(t('active'), plain('active'))}
                    <span />
                </Box>
            )}
            {model.contacts.map((c, i) => {
                const surface = scene.surfaces.find(s => s.id === c.surface);
                const wire = scene.wireframes.find(w => w.id === c.mesh);
                const sides = sideNames(surface, !!c.mesh);
                const bad = contactProblem(scene, c);
                // (Younger than a contact that runs through the faults, and offset by them all the same)
                const late = acrossByAge(model).find(x => x.contact.id === c.id);
                const name = surface?.name ?? wire?.name ?? 'Not in the project';
                // Its name opens the unit here, in the model: what it is built as and the settings of its surface (a mesh from a file: the mesh)
                const goTo = surface ? keys.modelContact(model.id, c.id) : wire ? keys.wireframe(wire.id) : null;
                const isPicked = picked === c.id;
                // Where the dragged row would land: above a row further up, below one further down
                const lands = drag && drag.over === i && from >= 0 && from !== i ? (i < from ? 'above' : 'below') : null;

                const handle = (
                    <Tooltip title="Drag it up the order (younger) or down (older)" enterDelay={600}>
                        <Box
                            draggable data-testid="contact-handle" aria-hidden
                            onDragStart={e => { e.dataTransfer.setData(DRAG_TYPE, c.id); e.dataTransfer.effectAllowed = 'move'; dragged.current = c.id; setDrag({ id: c.id, over: null }); }}
                            onDragEnd={() => { dragged.current = null; setDrag(null); }}
                            sx={{ display: 'flex', color: 'text.disabled', cursor: 'grab', flexShrink: 0, '&:hover': { color: 'text.secondary' } }}
                        >
                            <DragIndicator sx={{ fontSize: 16 }} />
                        </Box>
                    </Tooltip>
                );
                const title = (
                    <>
                        <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: surface?.color ?? wire?.color ?? 'text.disabled', flexShrink: 0 }} />
                        <Tooltip title={bad ?? (wire ? `${name}: go to the mesh` : `${name}: how its unit is built, and its settings, here in the model`)}>
                            <Typography
                                variant="caption" noWrap onClick={() => goTo && onGoTo(goTo)}
                                sx={{ flex: 1, minWidth: 0, fontWeight: 600, cursor: goTo ? 'pointer' : 'default', color: bad ? 'warning.main' : 'text.primary' }}
                            >
                                {name}
                            </Typography>
                        </Tooltip>
                    </>
                );
                const moves = (
                    <>
                        <Tooltip title="Younger: up the chronology"><span>
                            <IconButton size="small" sx={small} aria-label={`Make ${name} younger`} disabled={i === 0} onClick={() => moveModelContact(model.id, c.id, i - 1)}><ArrowUpward sx={{ fontSize: 14 }} /></IconButton>
                        </span></Tooltip>
                        <Tooltip title="Older: down the chronology"><span>
                            <IconButton size="small" sx={small} aria-label={`Make ${name} older`} disabled={i === model.contacts.length - 1} onClick={() => moveModelContact(model.id, c.id, i + 1)}><ArrowDownward sx={{ fontSize: 14 }} /></IconButton>
                        </span></Tooltip>
                        <Tooltip title="Take it out of the model (the surface stays)">
                            <IconButton size="small" sx={small} aria-label={`Take ${name} out of the model`} onClick={() => removeModelContact(model.id, c.id)}><Close sx={{ fontSize: 14 }} /></IconButton>
                        </Tooltip>
                    </>
                );
                const kind = (
                    <Tooltip placement="left" title={KIND_TIP[c.kind]}>
                        <TextField
                            select size="small" variant="standard" value={c.kind} sx={{ width: wide ? '100%' : 92, flexShrink: 0 }}
                            onChange={e => updateModelContact(model.id, c.id, { kind: e.target.value as ContactKind })}
                            SelectProps={{ SelectDisplayProps: { ...select, 'aria-label': `Type of ${name}` } as React.HTMLAttributes<HTMLDivElement> }}
                        >
                            {CONTACT_KINDS.map(k => <MenuItem key={k} dense value={k}>{KIND_NAME[k]}</MenuItem>)}
                        </TextField>
                    </Tooltip>
                );
                const unit = <UnitField model={model} label={`Unit on the ${t('youngerSide')} of ${name}`} value={c.unit} onChange={u => updateModelContact(model.id, c.id, { unit: u })} />;
                const side = (
                    <>
                        <Typography variant="caption" color={wide ? 'text.primary' : 'text.secondary'} noWrap sx={{ flex: 1, minWidth: 0 }} title={describeContact(c, sides)} data-term-label="youngerSide">
                            {wide ? sides[c.young > 0 ? 0 : 1] : `${t('youngerSide')}: ${sides[c.young > 0 ? 0 : 1]}`}
                        </Typography>
                        <Tooltip title={`The younger ground is on the other side: ${sides[c.young > 0 ? 1 : 0]}`}>
                            <IconButton size="small" sx={small} aria-label={`Swap the ${t('youngerSide')} of ${name}`} data-action="swap-younger-side" onClick={() => updateModelContact(model.id, c.id, { young: c.young > 0 ? -1 : 1 })}><SwapVert sx={{ fontSize: 14 }} /></IconButton>
                        </Tooltip>
                    </>
                );
                // In a model that fits by block, a contact in every block is fitted in each apart, or is said to run through the faults
                const choose = !!model.byBlock && !c.within?.length && !!c.surface && (model.faults ?? []).length > 0;
                const block = !faulted ? null : choose ? (
                    <Tooltip title={c.across ? 'One surface through every fault block: the faults do not offset it. Click to fit it in each block apart' : 'Fitted in each fault block apart: the faults offset it. Click when they do not (ground laid down after them)'}>
                        <Link
                            component="button" type="button" variant="caption" underline="hover" noWrap data-testid="contact-block" data-action="contact-across"
                            sx={{ minWidth: 0, textAlign: 'left' }} onClick={() => updateModelContact(model.id, c.id, { across: !c.across })}
                        >
                            {c.across ? 'Through the faults' : 'Each block apart'}
                        </Link>
                    </Tooltip>
                ) : (
                    <Tooltip title={c.within?.length ? 'It is fitted in this fault block alone' : 'It is fitted through every fault block'}>
                        <Typography variant="caption" color="text.secondary" noWrap data-testid="contact-block" sx={{ minWidth: 0 }}>
                            {c.within?.length ? sidesText(scene, model, c.within) : 'Every block'}
                        </Typography>
                    </Tooltip>
                );
                const tick = (
                    <Checkbox
                        size="small" sx={{ p: 0.25 }} checked={!c.off} onChange={() => updateModelContact(model.id, c.id, { off: !c.off })}
                        inputProps={{ 'aria-label': `${t('active')}: ${name}`, 'data-action': 'toggle-active' } as React.InputHTMLAttributes<HTMLInputElement>}
                    />
                );
                // (In the table its column is headed; in the list it carries its own word)
                const active = (
                    <Tooltip title={plain('active')}>
                        {wide ? <span>{tick}</span> : <FormControlLabel sx={{ m: 0, flexShrink: 0 }} control={tick} label={<Typography variant="caption">{t('active')}</Typography>} />}
                    </Tooltip>
                );
                const problem = bad || late ? (
                    <>
                        {bad && <Typography variant="caption" color="warning.main" sx={{ display: 'block', gridColumn: '2 / -1' }}>{bad}</Typography>}
                        {late && (
                            <Typography data-testid="across-by-age" variant="caption" color="warning.main" sx={{ display: 'block', gridColumn: '2 / -1', lineHeight: 1.3 }}>
                                {late.older.unit}, older than it, runs through the faults: what came after the faults moved is not offset by them.{' '}
                                <Link component="button" type="button" variant="caption" underline="hover" data-action="across-by-age" onClick={() => updateModelContact(model.id, c.id, { across: true })}>
                                    Run it through the faults too
                                </Link>
                            </Typography>
                        )}
                    </>
                ) : null;
                const dropHere = {
                    // (Only a row of this table: anything else dragged over it is not for it)
                    onDragOver: (e: React.DragEvent) => {
                        const id = dragged.current;
                        if (!id) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        setDrag(d => (d?.id === id && d.over === i ? d : { id, over: i }));
                    },
                    onDrop: (e: React.DragEvent) => {
                        const id = dragged.current;
                        if (!id) return;
                        e.preventDefault();
                        moveModelContact(model.id, id, i);
                        dragged.current = null;
                        setDrag(null);
                    },
                };
                const landing = lands ? { boxShadow: (th: { palette: { primary: { main: string } } }) => `inset 0 ${lands === 'above' ? 2 : -2}px 0 ${th.palette.primary.main}` } : {};

                return wide ? (
                    <Box
                        key={c.id} role="row" data-testid="model-contact" data-lands={lands ?? undefined} aria-current={isPicked || undefined} {...dropHere}
                        sx={{
                            display: 'grid', gridTemplateColumns: columns, columnGap: 1, alignItems: 'center', px: 0.5, py: 0.25, borderBottom: 1, borderColor: 'divider',
                            bgcolor: isPicked ? 'action.selected' : undefined, opacity: c.off || drag?.id === c.id ? 0.6 : 1, ...landing,
                        }}
                    >
                        {handle}
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>{title}</Box>
                        {kind}
                        {unit}
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, minWidth: 0 }}>{side}</Box>
                        {block}
                        {active}
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>{moves}</Box>
                        {problem}
                    </Box>
                ) : (
                    <Box
                        key={c.id} data-testid="model-contact" data-lands={lands ?? undefined} aria-current={isPicked || undefined} {...dropHere}
                        sx={{ mt: 0.5, p: 0.5, borderRadius: 1, border: 1, borderColor: isPicked ? 'primary.main' : 'divider', opacity: c.off || drag?.id === c.id ? 0.6 : 1, ...landing }}
                    >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>{handle}{title}{moves}</Box>
                        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, mt: 0.25 }}>{kind}{unit}</Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>{side}{active}</Box>
                        {block && <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}><Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>Fault block:</Typography>{block}</Box>}
                        {problem}
                    </Box>
                );
            })}
        </Box>
    );
};
