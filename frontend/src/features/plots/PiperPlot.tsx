/**
 * Piper (1944) diagram: cation and anion ternaries with the central diamond,
 * drawn in one Cartesian figure. Inputs are major-ion columns in mg/L or
 * meq/L; points take attribute colours/shapes/sizes and support linked
 * lasso selection in all three fields.
 */
import React, { useEffect, useMemo, useState } from 'react';
import Plot from '../../components/ThemedPlot';
import {
    Box, Paper, Typography, FormControl, InputLabel, Select, MenuItem, ToggleButtonGroup, ToggleButton,
    FormControlLabel, Switch, Button, Alert, Tooltip,
} from '@mui/material';
import { PlaylistAdd } from '@mui/icons-material';
import { useAppStore, useDisplayRows, getDatasetRows } from '../../store/appStore';
import { usePlotSetting } from '../../hooks/usePlotSetting';
import { useSelectionHandler } from '../../hooks/useSelectionHandler';
import { getStyleArraysColumnar, shapeToPlotlySymbol, applyOpacityToColor, getSortedIndices, sortColumnsByPriority } from '../../utils/attributeUtils';
import { buildCustomDataColumnar } from '../../utils/tooltipUtils';
import { getPlotConfig } from '../../utils/plotConfig';
import { SELECTION_COLOR } from '../../utils/selectionHelpers';
import { ExpandablePlotWrapper } from '../../components/ExpandablePlotWrapper';
import { PlotControlBar, ControlSection, SettingChip } from '../../components/plot_controls/PlotControlBar';
import {
    PIPER_IONS, PiperIon, WaterUnit, toMeq, piperSample, cationXY, anionXY, diamondXY, piperFrame, H, PIPER_GAP, guessIonColumns,
} from '../../utils/calculations/waterChem';
import { useDragMode } from '../../hooks/useDragMode';
import { useFillHeight } from '../../hooks/useFillHeight';
import { useStyleInputs } from '../../hooks/useStyleInputs';

const INK = '#1a1a1a';
const GRID = '#c8c8c8';
const FONT = 'Arial, Helvetica, sans-serif';

const ION_LABEL: Record<PiperIon, string> = {
    Ca: 'Ca²⁺', Mg: 'Mg²⁺', Na: 'Na⁺', K: 'K⁺ (optional)', Cl: 'Cl⁻', SO4: 'SO₄²⁻', HCO3: 'HCO₃⁻', CO3: 'CO₃²⁻ (optional)',
};
type XY = [number, number];
const line = (pts: XY[]) => ({ x: [...pts.map(p => p[0]), null], y: [...pts.map(p => p[1]), null] });

function frameTraces(showGrid: boolean, showFacies: boolean): { traces: any[]; annotations: any[] } {
    const f = piperFrame();
    const g = PIPER_GAP;
    const grid: { x: (number | null)[]; y: (number | null)[] } = { x: [], y: [] };
    const push = (a: XY, b: XY) => { const l = line([a, b]); grid.x.push(...l.x); grid.y.push(...l.y); };
    if (showGrid) {
        for (const p of [20, 40, 60, 80]) {
            const q = 100 - p;
            push(cationXY([q, p, 0]), cationXY([0, p, q]));   // Mg = p
            push(cationXY([p, q, 0]), cationXY([p, 0, q]));   // Ca = p
            push(cationXY([q, 0, p]), cationXY([0, q, p]));   // Na+K = p
            push(anionXY([q, p, 0]), anionXY([0, p, q]));     // SO4 = p
            push(anionXY([p, q, 0]), anionXY([p, 0, q]));     // HCO3 = p
            push(anionXY([q, 0, p]), anionXY([0, q, p]));     // Cl = p
            // Diamond: constant Na+K, constant Cl+SO4
            const c = cationXY([q, 0, p]);
            push(diamondXY(c, anionXY([100, 0, 0])), diamondXY(c, anionXY([0, 0, 100])));
            const a = anionXY([q, 0, p]);
            push(diamondXY(cationXY([100, 0, 0]), a), diamondXY(cationXY([0, 0, 100]), a));
        }
    }
    const outline = { x: [] as (number | null)[], y: [] as (number | null)[] };
    for (const poly of [f.cation, f.anion, f.diamond]) { const l = line(poly); outline.x.push(...l.x); outline.y.push(...l.y); }

    const traces: any[] = [];
    if (showGrid) traces.push({ type: 'scatter', mode: 'lines', ...grid, line: { color: GRID, width: 0.7, dash: 'dot' }, hoverinfo: 'skip', showlegend: false });
    if (showFacies) {
        const mid: { x: (number | null)[]; y: (number | null)[] } = { x: [], y: [] };
        const c50 = cationXY([50, 0, 50]), a50 = anionXY([50, 0, 50]);
        for (const [p, q] of [[diamondXY(c50, anionXY([100, 0, 0])), diamondXY(c50, anionXY([0, 0, 100]))], [diamondXY(cationXY([100, 0, 0]), a50), diamondXY(cationXY([0, 0, 100]), a50)]] as [XY, XY][]) {
            const l = line([p, q]); mid.x.push(...l.x); mid.y.push(...l.y);
        }
        traces.push({ type: 'scatter', mode: 'lines', ...mid, line: { color: '#888', width: 1, dash: 'dash' }, hoverinfo: 'skip', showlegend: false });
    }
    traces.push({ type: 'scatter', mode: 'lines', ...outline, line: { color: INK, width: 1.4 }, hoverinfo: 'skip', showlegend: false });

    const txt = (x: number, y: number, text: string, extra: any = {}) => ({
        x, y, xref: 'x', yref: 'y', text, showarrow: false, font: { family: FONT, size: 13, color: INK }, ...extra,
    });
    const annotations: any[] = [
        // Outer corners beside the vertex; inner corners below, anchored away from the gap
        txt(-0.015, 0, 'Ca<sup>2+</sup>', { xanchor: 'right', yanchor: 'middle' }),
        txt(1.01, -0.065, 'Na<sup>+</sup> + K<sup>+</sup>', { xanchor: 'right', yanchor: 'top' }),
        txt(0.5, H + 0.02, 'Mg<sup>2+</sup>', { yanchor: 'bottom' }),
        txt(1 + g - 0.01, -0.065, 'HCO<sub>3</sub><sup>−</sup> + CO<sub>3</sub><sup>2−</sup>', { xanchor: 'left', yanchor: 'top' }),
        txt(2 + g + 0.015, 0, 'Cl<sup>−</sup>', { xanchor: 'left', yanchor: 'middle' }),
        txt(1.5 + g, H + 0.02, 'SO<sub>4</sub><sup>2−</sup>', { yanchor: 'bottom' }),
    ];
    // Edge titles on the diamond's upper edges
    const ul = [f.diamond[3], f.diamond[2]], ur = [f.diamond[2], f.diamond[1]];
    const midOf = (s: XY[]): XY => [(s[0][0] + s[1][0]) / 2, (s[0][1] + s[1][1]) / 2];
    const [ulx, uly] = midOf(ul), [urx, ury] = midOf(ur);
    annotations.push(txt(ulx - 0.06, uly + 0.035, 'SO<sub>4</sub><sup>2−</sup> + Cl<sup>−</sup>', { textangle: -60 }));
    annotations.push(txt(urx + 0.06, ury + 0.035, 'Ca<sup>2+</sup> + Mg<sup>2+</sup>', { textangle: 60 }));
    // Base ticks: Ca % under the cation base, Cl % under the anion base
    for (const p of [20, 40, 60, 80]) {
        annotations.push(txt(p / 100, -0.012, String(100 - p), { yanchor: 'top', font: { family: FONT, size: 10, color: '#555' } }));
        annotations.push(txt(1 + g + p / 100, -0.012, String(p), { yanchor: 'top', font: { family: FONT, size: 10, color: '#555' } }));
    }
    if (showFacies) {
        const lab = (nak: number, clso4: number, text: string) => {
            const [x, y] = diamondXY(cationXY([100 - nak, 0, nak]), anionXY([100 - clso4, 0, clso4]));
            return txt(x, y, text, { font: { family: FONT, size: 10, color: '#666' } });
        };
        annotations.push(lab(25, 75, 'Ca–Mg–Cl–SO<sub>4</sub>'), lab(25, 25, 'Ca–Mg–HCO<sub>3</sub>'), lab(75, 75, 'Na–Cl'), lab(75, 25, 'Na–HCO<sub>3</sub>'));
    }
    return { traces, annotations };
}

export const PiperPlot: React.FC<{ plotId: string }> = ({ plotId }) => {
    // Fill the dock pane below the controls (fixed height outside the workspace)
    const { ref: fillRef, height: fillHeight } = useFillHeight<HTMLDivElement>(680, 360, 32);
    const dragMode = useDragMode();
    const columns = useAppStore(s => s.columns);
    const getDisplayColumn = useAppStore(s => s.getDisplayColumn);
    const tooltipMode = useAppStore(s => s.tooltipMode);
    const displayData = useDisplayRows();
    const displayIndices = useAppStore(s => s._sampleIndicesArray);
    const { handleSelected, handleDeselect, selectedIndices } = useSelectionHandler();
    const attributeStyleState = useStyleInputs();

    const [ionColumns, setIonColumns] = usePlotSetting<Partial<Record<PiperIon, string>>>(plotId, 'ionColumns', {});
    const [unit, setUnit] = usePlotSetting<WaterUnit>(plotId, 'waterUnit', 'mg/L');
    const [showGrid, setShowGrid] = usePlotSetting<boolean>(plotId, 'showGrid', true);
    const [showFacies, setShowFacies] = usePlotSetting<boolean>(plotId, 'showFacies', true);
    const [message, setMessage] = useState<string | null>(null);

    const numericColumns = useMemo(() => sortColumnsByPriority(columns.filter(c => c.type === 'numeric' || c.type === 'float' || c.type === 'integer')), [columns]);

    // First visit: guess the ion columns from their names
    useEffect(() => {
        if (Object.keys(ionColumns).length || !numericColumns.length) return;
        const guess = guessIonColumns(numericColumns.map(c => c.name));
        if (Object.keys(guess).length) setIonColumns(guess);
    }, [numericColumns, ionColumns, setIonColumns]);

    const required: PiperIon[] = ['Ca', 'Mg', 'Na', 'Cl', 'SO4', 'HCO3'];
    const ready = required.every(k => ionColumns[k]);

    const frame = useMemo(() => frameTraces(showGrid, showFacies), [showGrid, showFacies]);

    const samplesFor = (n: number, value: (ion: PiperIon, i: number) => number | null) => {
        const out: (ReturnType<typeof piperSample>)[] = new Array(n);
        for (let i = 0; i < n; i++) {
            const meq: Partial<Record<PiperIon, number | null>> = {};
            for (const ion of PIPER_IONS) {
                const v = value(ion, i);
                meq[ion] = v == null ? null : toMeq(v, ion, unit);
            }
            out[i] = piperSample(meq);
        }
        return out;
    };

    const plot = useMemo(() => {
        if (!ready || !displayData.length) return null;
        void attributeStyleState; void tooltipMode;
        const cols = Object.fromEntries(PIPER_IONS.map(ion => [ion, ionColumns[ion] ? getDisplayColumn(ionColumns[ion]!) : undefined]));
        const samples = samplesFor(displayData.length, (ion, i) => {
            const c = cols[ion];
            if (!c) return null;
            const v = Number(c[i]);
            return Number.isFinite(v) ? v : null;
        });
        const style = getStyleArraysColumnar(displayData.length, (name) => getDisplayColumn(name), displayIndices ?? undefined);
        const order = getSortedIndices(style).filter(i => samples[i]);
        const customData = buildCustomDataColumnar((name) => getDisplayColumn(name), order, displayIndices ?? undefined);
        const cat = order.map(i => cationXY(samples[i]!.cations));
        const an = order.map(i => anionXY(samples[i]!.anions));
        const dia = order.map((_, k) => diamondXY(cat[k], an[k]));
        const text = order.map(i => {
            const s = samples[i]!;
            return `<b>Facies:</b> ${s.facies}<br>Ca ${s.cations[0].toFixed(0)} · Mg ${s.cations[1].toFixed(0)} · Na+K ${s.cations[2].toFixed(0)} %<br>`
                + `HCO3+CO3 ${s.anions[0].toFixed(0)} · SO4 ${s.anions[1].toFixed(0)} · Cl ${s.anions[2].toFixed(0)} %<br>Ion balance ${s.balance.toFixed(1)} %`;
        });
        const marker = {
            size: order.map(i => style.sizes[i]),
            symbol: order.map(i => shapeToPlotlySymbol(style.shapes[i])),
            color: order.map(i => applyOpacityToColor(style.colors[i], style.opacity[i])),
            line: { width: 0.5, color: 'white' },
        };
        const pts = (xy: XY[], name: string) => ({
            type: 'scatter', mode: 'markers', name, x: xy.map(p => p[0]), y: xy.map(p => p[1]), customdata: customData, text,
            hovertemplate: '<b>%{customdata.sampleId}</b><br>%{text}<extra></extra>', marker, showlegend: false, cliponaxis: false,
        });
        const traces: any[] = [...frame.traces, pts(cat, 'Cations'), pts(an, 'Anions'), pts(dia, 'Diamond')];

        if (selectedIndices.length) {
            const sel = new Set(selectedIndices);
            const keep = order.map((i, k) => (sel.has(displayIndices ? displayIndices[i] : i) ? k : -1)).filter(k => k >= 0);
            if (keep.length) {
                const ring = (xy: XY[]) => ({
                    type: 'scatter', mode: 'markers', x: keep.map(k => xy[k][0]), y: keep.map(k => xy[k][1]), hoverinfo: 'skip', showlegend: false,
                    marker: { color: 'rgba(0,0,0,0)', size: keep.map(k => style.sizes[order[k]] + 4), line: { width: 2, color: SELECTION_COLOR } },
                });
                traces.push(ring(cat), ring(an), ring(dia));
            }
        }
        const plotted = order.length;
        return { traces, plotted };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ready, displayData, displayIndices, ionColumns, unit, frame, getDisplayColumn, attributeStyleState, tooltipMode, selectedIndices]);

    const addFaciesColumn = () => {
        const rows = getDatasetRows();
        const samples = samplesFor(rows.length, (ion, i) => {
            const col = ionColumns[ion];
            if (!col) return null;
            const v = Number(rows[i][col]);
            return Number.isFinite(v) ? v : null;
        });
        const names = new Set(useAppStore.getState().columns.map(c => c.name));
        let name = 'Piper_facies';
        for (let k = 2; names.has(name); k++) name = `Piper_facies_${k}`;
        useAppStore.getState().addColumn(name, samples.map(s => s?.facies ?? 'Unclassified'), 'categorical', 'Classification');
        setMessage(`Added column "${name}".`);
    };

    const ionSelect = (ion: PiperIon) => (
        <FormControl key={ion} size="small" sx={{ minWidth: 120 }}>
            <InputLabel>{ION_LABEL[ion]}</InputLabel>
            <Select
                label={ION_LABEL[ion]}
                value={ionColumns[ion] ?? ''}
                onChange={(e) => setIonColumns(prev => {
                    const next = { ...prev };
                    if (e.target.value) next[ion] = e.target.value as string; else delete next[ion];
                    return next;
                })}
            >
                <MenuItem value=""><em>None</em></MenuItem>
                {numericColumns.map(c => <MenuItem key={c.name} value={c.name}>{c.alias || c.name}</MenuItem>)}
            </Select>
        </FormControl>
    );

    const g = PIPER_GAP;
    return (
        <Box sx={{ p: 1 }}>
            <PlotControlBar
                primary={<>
                    {PIPER_IONS.map(ionSelect)}
                    <ToggleButtonGroup size="small" exclusive value={unit} onChange={(_, v) => v && setUnit(v)}>
                        <ToggleButton value="mg/L">mg/L</ToggleButton>
                        <ToggleButton value="meq/L">meq/L</ToggleButton>
                    </ToggleButtonGroup>
                </>}
                settingsActive={!showGrid || !showFacies}
                summary={<>
                    {!showGrid && <SettingChip label="No grid" onDelete={() => setShowGrid(true)} />}
                    {!showFacies && <SettingChip label="No facies" onDelete={() => setShowFacies(true)} />}
                </>}
                settings={<>
                    <ControlSection label="Display">
                        <FormControlLabel control={<Switch size="small" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />} label={<Typography variant="body2">Grid</Typography>} />
                        <FormControlLabel control={<Switch size="small" checked={showFacies} onChange={(e) => setShowFacies(e.target.checked)} />} label={<Typography variant="body2">Facies fields</Typography>} />
                    </ControlSection>
                    <ControlSection label="Classify">
                        <Tooltip title="Hydrochemical facies per row (Back 1966): dominant cation–anion, >50 % of its group">
                            <span><Button size="small" startIcon={<PlaylistAdd />} disabled={!ready} onClick={addFaciesColumn}>Add facies column</Button></span>
                        </Tooltip>
                    </ControlSection>
                </>}
            />
            {message && <Alert severity="success" onClose={() => setMessage(null)} sx={{ mb: 1 }}>{message}</Alert>}
            {plot ? (
                <Paper ref={fillRef} sx={{ p: 1 }}>
                    <ExpandablePlotWrapper>
                        <Plot
                            data={plot.traces}
                            layout={{
                                title: { text: `Piper diagram (${plot.plotted.toLocaleString()} samples)`, font: { family: FONT, size: 16, color: INK } },
                                autosize: true,
                                height: fillHeight,
                                paper_bgcolor: '#ffffff',
                                plot_bgcolor: '#ffffff',
                                font: { family: FONT, color: INK },
                                xaxis: { visible: false, range: [-0.14, 2 + g + 0.14], fixedrange: false },
                                yaxis: { visible: false, range: [-0.16, H * (2 + g) + 0.06], scaleanchor: 'x', scaleratio: 1 },
                                margin: { l: 20, r: 20, t: 50, b: 20 },
                                annotations: frame.annotations,
                                dragmode: dragMode,
                                hovermode: 'closest',
                                uirevision: plotId,
                            }}
                            config={getPlotConfig({ filename: 'piper_diagram' })}
                            style={{ width: '100%' }}
                            useResizeHandler
                            onSelected={handleSelected}
                            onDeselect={handleDeselect}
                        />
                    </ExpandablePlotWrapper>
                </Paper>
            ) : (
                <Paper sx={{ p: 4, textAlign: 'center' }}>
                    <Typography color="text.secondary">
                        Choose columns for Ca, Mg, Na, Cl, SO₄ and HCO₃ (K and CO₃ are optional).
                    </Typography>
                </Paper>
            )}
        </Box>
    );
};

export default PiperPlot;
