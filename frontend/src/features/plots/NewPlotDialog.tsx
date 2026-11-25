/**
 * New Plot dialog (Alt+N): plot-type cards with quick column configuration
 * pre-filled by suggestPlotSettings, or a diagram from the library. One
 * search box filters both. Enter creates.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
    Dialog, DialogTitle, DialogContent, DialogActions, Box, Tabs, Tab, TextField, InputAdornment, Typography,
    Button, ButtonBase, Stack, IconButton,
} from '@mui/material';
import {
    Search, Close, ScatterPlot as ScatterIcon, ChangeHistory, ShowChart, BarChart, GridOn, Map as MapIcon, Layers,
    ViewInAr, VerticalAlignBottom, Hub, TravelExplore, WaterDrop, Category, Timeline, Insights, ViewModule, Straighten,
} from '@mui/icons-material';
import { useAppStore, PLOT_TYPE_LABEL, PlotType } from '../../store/appStore';
import { useUIStore } from '../../store/uiStore';
import { createPlotFromDiagram } from './createPlotFromDiagram';
import { suggestPlotSettings } from '../../utils/plotDefaults';
import { ColumnPicker } from '../../components/ColumnPicker';
import { MultiColumnSelector } from '../../components/MultiColumnSelector';
import { DiagramGallery } from './classification/DiagramGallery';
import { PLOT_TYPE_META, matchesPlotType } from './plotTypeMeta';

const ICON: Record<PlotType, React.ReactElement> = {
    scatter: <ScatterIcon />, ternary: <ChangeHistory />, spider: <ShowChart />, histogram: <BarChart />, splom: <GridOn />,
    map: <MapIcon />, contour: <Layers />, map3d: <ViewInAr />, downhole: <VerticalAlignBottom />, clr: <Hub />,
    pathfinder: <TravelExplore />, piper: <WaterDrop />, classification: <Category />, probability: <Timeline />, pca: <Insights />, protocols: <ViewModule />, section: <Straighten />,
};

export const NewPlotDialog: React.FC = () => {
    const open = useUIStore(s => s.newPlotDialogOpen);
    const setOpen = useUIStore(s => s.setNewPlotDialogOpen);
    const columns = useAppStore(s => s.columns);
    const mappings = useAppStore(s => s.geochemMappings);
    const [tab, setTab] = useState<'types' | 'diagrams'>('types');
    const [query, setQuery] = useState('');
    const [type, setType] = useState<PlotType>('scatter');
    const [settings, setSettings] = useState<Record<string, any>>({});

    useEffect(() => { if (open) { setQuery(''); setTab('types'); } }, [open]);
    // Re-suggest whenever the type (or dataset) changes
    useEffect(() => { if (open) setSettings(suggestPlotSettings(type, columns, mappings)); }, [open, type, columns, mappings]);

    const cards = useMemo(() => PLOT_TYPE_META.filter(m => matchesPlotType(m, PLOT_TYPE_LABEL[m.type], query)), [query]);
    const meta = PLOT_TYPE_META.find(m => m.type === type)!;
    const close = () => setOpen(false);

    const create = () => {
        if (type === 'classification') { setTab('diagrams'); return; }
        useAppStore.getState().addPlot(type, { settings: { ...settings } });
        close();
    };

    const allColumns = useMemo(() => columns.filter(c => c.type === 'numeric' || c.type === 'float' || c.type === 'integer'), [columns]);

    return (
        <Dialog
            open={open} onClose={close} maxWidth="lg" fullWidth PaperProps={{ sx: { height: '80vh' } }}
            onKeyDown={(e) => {
                const inMenu = (e.target as HTMLElement).closest('[role="listbox"], [role="combobox"]');
                if (e.key === 'Enter' && tab === 'types' && !inMenu) { e.preventDefault(); create(); }
            }}
        >
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 1 }}>
                <Typography variant="h6" sx={{ flexShrink: 0 }}>New plot</Typography>
                <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ minHeight: 40, '& .MuiTab-root': { minHeight: 40 } }}>
                    <Tab value="types" label="Plot types" />
                    <Tab value="diagrams" label="Diagram library" />
                </Tabs>
                <TextField
                    size="small" autoFocus placeholder="Search plots and diagrams…" value={query}
                    onChange={(e) => setQuery(e.target.value)} sx={{ flex: 1, maxWidth: 420 }}
                    InputProps={{ startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> }}
                />
                <Box sx={{ flex: 1 }} />
                <IconButton onClick={close} size="small" aria-label="Close"><Close /></IconButton>
            </DialogTitle>
            <DialogContent dividers sx={{ p: 0, display: 'flex', minHeight: 0 }}>
                {tab === 'diagrams' ? (
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                        <DiagramGallery embedded open onClose={close} onSelect={(id) => createPlotFromDiagram(id)} query={query} />
                    </Box>
                ) : (
                    <>
                        <Box sx={{ flex: 1, overflow: 'auto', p: 2, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 1.5, alignContent: 'start' }}>
                            {cards.map(m => (
                                <ButtonBase
                                    key={m.type}
                                    onClick={() => setType(m.type)}
                                    onDoubleClick={() => { setType(m.type); if (m.type !== 'classification') { useAppStore.getState().addPlot(m.type); close(); } else setTab('diagrams'); }}
                                    aria-pressed={type === m.type}
                                    sx={{
                                        display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.5, p: 1.5, textAlign: 'left',
                                        border: 2, borderRadius: 2, borderColor: type === m.type ? 'primary.main' : 'divider',
                                        bgcolor: type === m.type ? 'action.selected' : 'background.paper',
                                        '&:hover': { borderColor: 'primary.light' },
                                    }}
                                >
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'primary.main' }}>
                                        {ICON[m.type]}
                                        <Typography variant="subtitle2" color="text.primary">{PLOT_TYPE_LABEL[m.type]}</Typography>
                                    </Box>
                                    <Typography variant="caption" color="text.secondary">{m.description}</Typography>
                                </ButtonBase>
                            ))}
                            {cards.length === 0 && (
                                <Typography color="text.secondary">No plot type matches; try the Diagram library tab.</Typography>
                            )}
                        </Box>
                        <Box sx={{ width: 340, flexShrink: 0, borderLeft: 1, borderColor: 'divider', p: 2, overflow: 'auto' }}>
                            <Typography variant="subtitle1" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                                {ICON[type]} {PLOT_TYPE_LABEL[type]}
                            </Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{meta.description}</Typography>
                            <Stack spacing={1.5}>
                                {type === 'classification' && (
                                    <Button variant="outlined" onClick={() => setTab('diagrams')}>Choose a diagram…</Button>
                                )}
                                {meta.fields.map(f => f.multi ? (
                                    <MultiColumnSelector
                                        key={f.key}
                                        label={f.label}
                                        columns={allColumns}
                                        selectedColumns={settings[f.key] ?? []}
                                        onChange={(v) => setSettings(prev => ({ ...prev, [f.key]: v }))}
                                    />
                                ) : (
                                    <ColumnPicker
                                        key={f.key}
                                        label={f.label}
                                        value={settings[f.key] ?? ''}
                                        onChange={(v) => setSettings(prev => ({ ...prev, [f.key]: v }))}
                                        fullWidth
                                        useColumnFilter={false}
                                    />
                                ))}
                                {meta.fields.length === 0 && type !== 'classification' && (
                                    <Typography variant="body2" color="text.secondary">Columns are chosen inside the plot.</Typography>
                                )}
                            </Stack>
                        </Box>
                    </>
                )}
            </DialogContent>
            {tab === 'types' && (
                <DialogActions>
                    <Typography variant="caption" color="text.secondary" sx={{ mr: 'auto', pl: 1 }}>Enter creates · double-click a card to create with defaults</Typography>
                    <Button onClick={close}>Cancel</Button>
                    <Button variant="contained" onClick={create}>Create {PLOT_TYPE_LABEL[type]}</Button>
                </DialogActions>
            )}
        </Dialog>
    );
};

export default NewPlotDialog;
