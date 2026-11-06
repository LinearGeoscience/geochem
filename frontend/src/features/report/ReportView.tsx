/**
 * Report notebook (Phase 58): notes and figures in the order the user
 * arranges them, with the data processing steps (audit log) shown between
 * them at the point in time they happened.
 */
import React, { useMemo, useState } from 'react';
import {
    Box, Button, Chip, Divider, FormControlLabel, IconButton, Menu, MenuItem, Paper, Stack, Switch,
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import {
    NoteAdd, AddPhotoAlternate, ArrowUpward, ArrowDownward, Delete, FolderOpen, Timeline, OpenInNew,
    PictureAsPdf, Download, Print, ExpandMore,
} from '@mui/icons-material';
import { useShallow } from 'zustand/react/shallow';
import { useReportStore, figureNumbers, interleaveSteps, tableNumbers, ReportRow, ReportItem, ReportFigure, ReportNote, ReportTable } from '../../store/reportStore';
import { useAuditStore } from '../../store/auditStore';
import { useAppStore } from '../../store/appStore';
import { useProjectStore } from '../../store/projectStore';
import { AuditEntry } from '../../types/audit';
import { addPlotToReport } from '../../utils/reportCapture';
import { revealProjectFolder, ProjectSubfolder } from '../../services/projectFiles';
import { exportReportToProject, downloadReportHtml, printReport } from '../../utils/reportExport';
import { getWorkspaceApi } from '../workspace/workspaceApi';
import { notify } from '../../store/notificationStore';

const time = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Text field that writes to the store when it loses focus (not on every key) */
const CommitField: React.FC<{ value: string; onCommit: (v: string) => void } & Omit<React.ComponentProps<typeof TextField>, 'value' | 'onChange'>> = ({ value, onCommit, ...props }) => {
    const [draft, setDraft] = useState(value);
    const [focused, setFocused] = useState(false);
    return (
        <TextField
            {...props}
            value={focused ? draft : value}
            onFocus={() => { setDraft(value); setFocused(true); }}
            onChange={e => setDraft(e.target.value)}
            onBlur={() => { setFocused(false); if (draft !== value) onCommit(draft); }}
        />
    );
};

const ItemActions: React.FC<{ item: ReportItem; first: boolean; last: boolean; extra?: React.ReactNode }> = ({ item, first, last, extra }) => {
    const { moveItem, removeItem } = useReportStore.getState();
    const [confirm, setConfirm] = useState(false);
    return (
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ ml: 'auto' }}>
            {extra}
            <Tooltip title="Move up"><span><IconButton size="small" disabled={first} onClick={() => moveItem(item.id, -1)}><ArrowUpward fontSize="small" /></IconButton></span></Tooltip>
            <Tooltip title="Move down"><span><IconButton size="small" disabled={last} onClick={() => moveItem(item.id, 1)}><ArrowDownward fontSize="small" /></IconButton></span></Tooltip>
            {confirm ? (
                <Button size="small" color="error" variant="contained" onClick={() => removeItem(item.id)} onBlur={() => setConfirm(false)} autoFocus>
                    Remove
                </Button>
            ) : (
                <Tooltip title="Remove from report"><IconButton size="small" onClick={() => setConfirm(true)}><Delete fontSize="small" /></IconButton></Tooltip>
            )}
        </Stack>
    );
};

const NoteCard: React.FC<{ note: ReportNote; first: boolean; last: boolean }> = ({ note, first, last }) => {
    const update = useReportStore(s => s.updateItem);
    return (
        <Paper variant="outlined" sx={{ p: 2 }} data-testid="report-note">
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                <Typography variant="caption" color="text.secondary">Note · {time(note.created)}</Typography>
                <ItemActions item={note} first={first} last={last} />
            </Stack>
            <CommitField
                value={note.title} onCommit={title => update(note.id, { title })}
                placeholder="Heading (optional)" variant="standard" fullWidth
                InputProps={{ sx: { fontWeight: 600, fontSize: 17 } }}
            />
            <CommitField
                value={note.text} onCommit={text => update(note.id, { text })}
                placeholder="What was done, what it shows, decisions made…" multiline minRows={3} fullWidth sx={{ mt: 1 }}
            />
        </Paper>
    );
};

const TableCard: React.FC<{ table: ReportTable; number: number; first: boolean; last: boolean }> = ({ table, number, first, last }) => {
    const update = useReportStore(s => s.updateItem);
    return (
        <Paper variant="outlined" sx={{ p: 2 }} data-testid="report-table">
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                <Typography variant="caption" color="text.secondary">Table {number} · {time(table.created)}</Typography>
                <ItemActions item={table} first={first} last={last} />
            </Stack>
            <CommitField value={table.title} onCommit={title => update(table.id, { title })} placeholder="Title" variant="standard" fullWidth
                InputProps={{ sx: { fontWeight: 600 } }} />
            <TableContainer sx={{ my: 1, maxHeight: 360, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                <Table size="small" stickyHeader>
                    <TableHead><TableRow>{table.columns.map((c, i) => <TableCell key={i}>{c}</TableCell>)}</TableRow></TableHead>
                    <TableBody>
                        {table.rows.map((r, i) => <TableRow key={i}>{r.map((c, j) => <TableCell key={j}>{c}</TableCell>)}</TableRow>)}
                    </TableBody>
                </Table>
            </TableContainer>
            <CommitField value={table.caption} onCommit={caption => update(table.id, { caption })} placeholder="Caption" multiline fullWidth size="small" />
        </Paper>
    );
};

const FigureCard: React.FC<{ figure: ReportFigure; number: number; first: boolean; last: boolean }> = ({ figure, number, first, last }) => {
    const update = useReportStore(s => s.updateItem);
    const plotOpen = useAppStore(s => !!figure.plotId && s.plots.some(p => p.id === figure.plotId));
    const goToPlot = () => {
        useAppStore.getState().setCurrentView('plots');
        setTimeout(() => getWorkspaceApi()?.getPanel(figure.plotId!)?.api.setActive(), 50);
    };
    return (
        <Paper variant="outlined" sx={{ p: 2 }} data-testid="report-figure">
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                <Typography variant="subtitle2" sx={{ whiteSpace: 'nowrap' }}>Figure {number}</Typography>
                <CommitField
                    value={figure.title} onCommit={title => update(figure.id, { title })}
                    variant="standard" fullWidth InputProps={{ sx: { fontWeight: 600 } }}
                />
                <ItemActions
                    item={figure} first={first} last={last}
                    extra={plotOpen && <Tooltip title="Go to the plot"><IconButton size="small" onClick={goToPlot}><OpenInNew fontSize="small" /></IconButton></Tooltip>}
                />
            </Stack>
            <Stack spacing={1} alignItems="center">
                {figure.images.map((src, i) => (
                    <Box key={i} component="img" src={src} alt={`Figure ${number}${figure.images.length > 1 ? ` (${i + 1})` : ''}`}
                        sx={{ maxWidth: '100%', maxHeight: 560, border: 1, borderColor: 'divider', bgcolor: '#fff' }} />
                ))}
            </Stack>
            <CommitField
                value={figure.caption} onCommit={caption => update(figure.id, { caption })}
                placeholder="Caption: what the figure shows and what you conclude from it" multiline minRows={2} fullWidth sx={{ mt: 1.5 }}
            />
            <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {figure.plotType && <Chip size="small" label={figure.plotType} />}
                {figure.context.map(c => <Chip key={c} size="small" variant="outlined" label={c} />)}
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
                Captured {time(figure.created)}
                {figure.files?.length ? ` · saved to figures/ as ${figure.files.map(f => f.split(/[\\/]/).pop()).join(', ')}` : ''}
            </Typography>
        </Paper>
    );
};

const StepsBlock: React.FC<{ steps: AuditEntry[] }> = ({ steps }) => (
    <Box sx={{ pl: 2, borderLeft: 3, borderColor: 'divider' }} data-testid="report-steps">
        {steps.map(s => (
            <Box key={s.id} sx={{ py: 0.25 }}>
                <Typography variant="body2" component="span" sx={{ fontWeight: 600 }}>{s.operation}</Typography>
                <Typography variant="body2" component="span" color="text.secondary"> · {s.description}</Typography>
                <Typography variant="caption" color="text.disabled" sx={{ ml: 1 }}>{time(s.timestamp)}</Typography>
            </Box>
        ))}
    </Box>
);

export const ReportView: React.FC = () => {
    const { title, author, items, setMeta, addNote } = useReportStore(useShallow(s => ({
        title: s.title, author: s.author, items: s.items, setMeta: s.setMeta, addNote: s.addNote,
    })));
    const audit = useAuditStore(s => s.entries);
    const plots = useAppStore(s => s.plots);
    const { projectName, projectPath } = useProjectStore(useShallow(s => ({ projectName: s.currentProject?.name, projectPath: s.projectPath })));
    const [showSteps, setShowSteps] = useState(true);
    const [plotMenu, setPlotMenu] = useState<HTMLElement | null>(null);
    const [busy, setBusy] = useState(false);
    const [exportMenu, setExportMenu] = useState<HTMLElement | null>(null);
    const [exporting, setExporting] = useState(false);

    const numbers = useMemo(() => figureNumbers(items), [items]);
    const tableNums = useMemo(() => tableNumbers(items), [items]);
    const rows = useMemo<ReportRow[]>(
        () => (showSteps ? interleaveSteps(items, audit) : items.map(item => ({ kind: 'item', item }))),
        [items, audit, showSteps],
    );

    const capture = async (ids: string[]) => {
        setPlotMenu(null);
        setBusy(true);
        // Plot panes only render in the Plots view
        const view = useAppStore.getState().currentView;
        useAppStore.getState().setCurrentView('plots');
        try {
            for (const id of ids) await addPlotToReport(id);
        } finally {
            useAppStore.getState().setCurrentView(view);
            setBusy(false);
        }
    };

    const reveal = (sub: ProjectSubfolder) => {
        if (projectPath) revealProjectFolder(projectPath, sub).catch(err => notify(`Could not open the folder: ${err.message}`, 'error'));
    };

    const exportToFolder = async () => {
        setExportMenu(null);
        setExporting(true);
        try {
            const r = await exportReportToProject(true);
            if (!r) notify('Save the project to a folder first (File › Save As)', 'warning');
            else if (r.pdfError) notify(`Wrote ${r.html.split(/[\\/]/).pop()}; the PDF could not be made: ${r.pdfError}. Use Print › Save as PDF instead.`, 'warning');
            else notify(`Report written to the report folder: ${r.html.split(/[\\/]/).pop()} and ${r.pdf!.split(/[\\/]/).pop()}`, 'success');
        } catch (err) {
            notify(`Report export failed: ${err instanceof Error ? err.message : err}`, 'error');
        } finally {
            setExporting(false);
        }
    };

    return (
        <Box sx={{ height: '100%', overflow: 'auto', bgcolor: 'background.default' }}>
            <Box sx={{ maxWidth: 980, mx: 'auto', p: 3 }}>
                <Stack direction="row" spacing={2} alignItems="flex-end" sx={{ mb: 2 }}>
                    <CommitField
                        value={title} onCommit={v => setMeta({ title: v })} label="Report title"
                        placeholder={projectName || 'Untitled project'} variant="standard" sx={{ flex: 2 }}
                    />
                    <CommitField value={author} onCommit={v => setMeta({ author: v })} label="Author" variant="standard" sx={{ flex: 1 }} />
                </Stack>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2, flexWrap: 'wrap', rowGap: 1 }}>
                    <Button variant="contained" size="small" startIcon={<NoteAdd />} onClick={() => addNote()}>Add note</Button>
                    <Button size="small" variant="outlined" startIcon={<AddPhotoAlternate />} disabled={!plots.length || busy}
                        onClick={e => setPlotMenu(e.currentTarget)}>
                        {busy ? 'Capturing…' : 'Add plot'}
                    </Button>
                    <Menu anchorEl={plotMenu} open={!!plotMenu} onClose={() => setPlotMenu(null)}>
                        {plots.map(p => <MenuItem key={p.id} onClick={() => capture([p.id])}>{p.title}</MenuItem>)}
                        {plots.length > 1 && <Divider />}
                        {plots.length > 1 && <MenuItem onClick={() => capture(plots.map(p => p.id))}>All open plots ({plots.length})</MenuItem>}
                    </Menu>
                    <Button size="small" variant="outlined" startIcon={<PictureAsPdf />} endIcon={<ExpandMore />} disabled={exporting}
                        onClick={e => setExportMenu(e.currentTarget)} data-testid="report-export">
                        {exporting ? 'Exporting…' : 'Export'}
                    </Button>
                    <Menu anchorEl={exportMenu} open={!!exportMenu} onClose={() => setExportMenu(null)}>
                        <MenuItem disabled={!projectPath} onClick={exportToFolder}>
                            <PictureAsPdf fontSize="small" sx={{ mr: 1 }} />
                            {projectPath ? 'HTML + PDF to the project\'s report folder' : 'HTML + PDF to the report folder (save the project first)'}
                        </MenuItem>
                        <MenuItem onClick={() => { setExportMenu(null); downloadReportHtml(); }}><Download fontSize="small" sx={{ mr: 1 }} />Download HTML</MenuItem>
                        <MenuItem onClick={() => { setExportMenu(null); printReport(); }}><Print fontSize="small" sx={{ mr: 1 }} />Print / Save as PDF…</MenuItem>
                    </Menu>
                    {projectPath && <Button size="small" startIcon={<FolderOpen />} onClick={() => reveal('figures')}>Figures</Button>}
                    {projectPath && <Button size="small" startIcon={<FolderOpen />} onClick={() => reveal('report')}>Report folder</Button>}
                    <Box sx={{ flex: 1 }} />
                    <FormControlLabel
                        control={<Switch size="small" checked={showSteps} onChange={e => setShowSteps(e.target.checked)} />}
                        label={<Stack direction="row" spacing={0.5} alignItems="center"><Timeline fontSize="small" /><span>Data processing steps</span></Stack>}
                    />
                </Stack>

                {!projectPath && (
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        Save the project to a folder (File › Save As) and figures are also written to its figures/ folder as PNG and SVG.
                    </Typography>
                )}

                {items.length === 0 && (
                    <Paper variant="outlined" sx={{ p: 3, mb: 2, textAlign: 'center' }}>
                        <Typography variant="subtitle1" gutterBottom>Document the interpretation as you go</Typography>
                        <Typography variant="body2" color="text.secondary">
                            Add notes on what you did and why, and add plots as figures: right-click a plot tab › Add to report,
                            the report button in the plot toolbar (Alt+R), or Add plot above. Each figure records the variables,
                            colour/shape/size attributes and rows shown. Data changes (imports, transforms, calculated columns,
                            edits) are listed automatically between the entries.
                        </Typography>
                    </Paper>
                )}

                <Stack spacing={2}>
                    {rows.map(row => {
                        if (row.kind === 'steps') return <StepsBlock key={row.key} steps={row.steps} />;
                        const it = row.item;
                        const idx = items.indexOf(it);
                        const first = idx === 0;
                        const last = idx === items.length - 1;
                        if (it.kind === 'note') return <NoteCard key={it.id} note={it} first={first} last={last} />;
                        if (it.kind === 'table') return <TableCard key={it.id} table={it} number={tableNums.get(it.id)!} first={first} last={last} />;
                        return <FigureCard key={it.id} figure={it} number={numbers.get(it.id)!} first={first} last={last} />;
                    })}
                </Stack>
            </Box>
        </Box>
    );
};

export default ReportView;
