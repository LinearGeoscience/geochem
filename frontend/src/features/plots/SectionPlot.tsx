/**
 * Drillhole cross-section: samples projected onto a vertical section through
 * any origin and azimuth, within a slab either side of it. Distance along the
 * section vs elevation at a chosen vertical exaggeration (1 = true scale), so
 * oblique holes keep their real dip, unlike an X-Z or Y-Z scatter. Coloured,
 * shaped and filtered by the Attribute Manager like every other plot;
 * selection is linked. Optional hole traces and a plan inset showing the line.
 */
import React, { useCallback, useEffect, useMemo } from 'react';
import { Box, Button, Checkbox, FormControlLabel, Paper, TextField, Tooltip, Typography } from '@mui/material';
import { useShallow } from 'zustand/react/shallow';
import Plot from '../../components/ThemedPlot';
import { useAppStore } from '../../store/appStore';
import { usePlotSetting } from '../../hooks/usePlotSetting';
import { useSelectionHandler } from '../../hooks/useSelectionHandler';
import { useHoveredClassRows, HOVER_RING_COLOR } from '../../hooks/useHoveredClassRows';
import { useDragMode } from '../../hooks/useDragMode';
import { useFillHeight } from '../../hooks/useFillHeight';
import { useStyleInputs } from '../../hooks/useStyleInputs';
import { getStyleArraysColumnar, shapeToPlotlySymbol, applyOpacityToColor, getSortedIndices, getColumnDisplayName } from '../../utils/attributeUtils';
import { getPlotConfig, EXPORT_FONT_SIZES } from '../../utils/plotConfig';
import { SELECTION_COLOR } from '../../utils/selectionHelpers';
import { ExpandablePlotWrapper } from '../../components/ExpandablePlotWrapper';
import { PlotControlBar, ControlSection, SettingChip } from '../../components/plot_controls/PlotControlBar';
import { ColumnPicker } from '../../components/ColumnPicker';
import { guessAxisColumn, guessDepthColumn, guessHoleColumn } from './viewer3d/coordinateColumns';
import { bearing, fitSectionLine, holeTraces, projectSection, type SectionLine } from '../../utils/sectionProjection';

/** SVG markers below this many points (keeps WebGL contexts free), WebGL above */
const SVG_MAX_POINTS = 4000;

const numField = (label: string, value: number | null, onChange: (v: number | null) => void, width = 110, helper?: string) => (
    <TextField size="small" label={label} type="number" value={value ?? ''} sx={{ width }} helperText={helper}
        onChange={(e) => { const v = e.target.value === '' ? null : Number(e.target.value); onChange(v !== null && Number.isFinite(v) ? v : null); }} />
);

export const SectionPlot: React.FC<{ plotId: string }> = ({ plotId }) => {
    const { ref: fillRef, height: fillHeight } = useFillHeight<HTMLDivElement>(600, 320, 48);
    const dragMode = useDragMode();
    const columns = useAppStore(useShallow(s => s.columns));
    const columnarData = useAppStore(s => s.columnarData);
    const getDisplayColumn = useAppStore(s => s.getDisplayColumn);
    const displayIndices = useAppStore(s => s._sampleIndicesArray);
    const d = useCallback((name: string) => getColumnDisplayName(columns, name), [columns]);
    const attributeStyleState = useStyleInputs();
    const { handleSelected, handleClick, handleDeselect, selectedIndices } = useSelectionHandler();
    const hoveredRows = useHoveredClassRows();

    const [eastCol, setEastCol] = usePlotSetting<string>(plotId, 'eastCol', '');
    const [northCol, setNorthCol] = usePlotSetting<string>(plotId, 'northCol', '');
    const [elevCol, setElevCol] = usePlotSetting<string>(plotId, 'elevCol', '');
    const [holeCol, setHoleCol] = usePlotSetting<string>(plotId, 'holeCol', '');
    const [depthCol, setDepthCol] = usePlotSetting<string>(plotId, 'depthCol', '');
    const [originE, setOriginE] = usePlotSetting<number | null>(plotId, 'originE', null);
    const [originN, setOriginN] = usePlotSetting<number | null>(plotId, 'originN', null);
    const [azimuth, setAzimuth] = usePlotSetting<number | null>(plotId, 'azimuth', null);
    const [halfWidth, setHalfWidth] = usePlotSetting<number | null>(plotId, 'halfWidth', null);
    const [ve, setVe] = usePlotSetting<number>(plotId, 've', 1);
    const [showTraces, setShowTraces] = usePlotSetting<boolean>(plotId, 'showTraces', true);
    const [showPlan, setShowPlan] = usePlotSetting<boolean>(plotId, 'showPlan', true);

    // Default columns from roles / names (the 3D viewer's rules)
    useEffect(() => {
        if (!columns.length) return;
        if (!eastCol) { const c = guessAxisColumn(columns, 'x'); if (c) setEastCol(c); }
        if (!northCol) { const c = guessAxisColumn(columns, 'y'); if (c) setNorthCol(c); }
        if (!elevCol) { const c = guessAxisColumn(columns, 'z'); if (c) setElevCol(c); }
        if (!holeCol) { const c = guessHoleColumn(columns); if (c) setHoleCol(c); }
        if (!depthCol) { const c = guessDepthColumn(columns); if (c) setDepthCol(c); }
    }, [columns]); // eslint-disable-line react-hooks/exhaustive-deps

    const ready = !!eastCol && !!northCol && !!elevCol && columnarData.rowCount > 0;

    const { styleArrays, sortedIndices } = useMemo(() => {
        void attributeStyleState;
        if (!ready) return { styleArrays: null, sortedIndices: [] as number[] };
        const n = getDisplayColumn(eastCol)?.length ?? 0;
        const styleArrays = getStyleArraysColumnar(n, (name) => getDisplayColumn(name), displayIndices ?? undefined);
        return { styleArrays, sortedIndices: getSortedIndices(styleArrays) };
    }, [ready, eastCol, getDisplayColumn, displayIndices, attributeStyleState]);

    // Section line through the visible samples, fitted once when none is set
    const fitted = useMemo(() => {
        if (!ready) return null;
        const e = getDisplayColumn(eastCol), n = getDisplayColumn(northCol);
        return e && n ? fitSectionLine(e, n, sortedIndices) : null;
    }, [ready, eastCol, northCol, getDisplayColumn, sortedIndices]);
    const applyFit = () => {
        if (!fitted) return;
        setOriginE(Math.round(fitted.originE)); setOriginN(Math.round(fitted.originN));
        setAzimuth(fitted.azimuth); setHalfWidth(fitted.halfWidth);
    };
    useEffect(() => {
        if (fitted && originE === null && originN === null && azimuth === null) applyFit();
    }, [fitted]); // eslint-disable-line react-hooks/exhaustive-deps

    const line: SectionLine | null = originE !== null && originN !== null && azimuth !== null && halfWidth !== null && halfWidth > 0
        ? { originE, originN, azimuth, halfWidth } : null;

    const proj = useMemo(() => {
        if (!ready || !line) return null;
        const e = getDisplayColumn(eastCol), n = getDisplayColumn(northCol), z = getDisplayColumn(elevCol);
        if (!e || !n || !z) return null;
        return projectSection(e, n, z, line, sortedIndices);
    }, [ready, eastCol, northCol, elevCol, getDisplayColumn, sortedIndices, line?.originE, line?.originN, line?.azimuth, line?.halfWidth]); // eslint-disable-line react-hooks/exhaustive-deps

    const orig = useCallback((i: number) => (displayIndices ? displayIndices[i] : i), [displayIndices]);

    const traces = useMemo(() => {
        if (!proj || !styleArrays || !line) return [];
        const hole = holeCol ? getDisplayColumn(holeCol) : undefined;
        const depth = depthCol ? getDisplayColumn(depthCol) : undefined;
        const out: any[] = [];
        if (showTraces && hole) {
            const xs: (number | null)[] = [], ys: (number | null)[] = [];
            for (const t of holeTraces(proj, hole, depth)) { xs.push(...t.x, null); ys.push(...t.y, null); }
            if (xs.length) out.push({ type: 'scatter', mode: 'lines', x: xs, y: ys, line: { color: 'rgba(110,110,110,0.55)', width: 1 }, hoverinfo: 'skip', showlegend: false, connectgaps: false });
        }
        const r = proj.rows;
        const gl = r.length > SVG_MAX_POINTS;
        const hover = r.map((i, k) => {
            const parts = [hole ? `${d(holeCol)}: ${hole[i]}` : '', depth ? `${d(depthCol)}: ${depth[i]}` : '',
                `Along: ${proj.along[k].toFixed(1)} m`, `${d(elevCol)}: ${proj.elev[k].toFixed(1)}`, `Off section: ${proj.offset[k].toFixed(1)} m`];
            return parts.filter(Boolean).join('<br>');
        });
        out.push({
            type: gl ? 'scattergl' : 'scatter', mode: 'markers', x: proj.along, y: proj.elev,
            customdata: r.map(orig), hovertext: hover, hoverinfo: 'text', showlegend: false,
            marker: {
                size: r.map(i => styleArrays.sizes[i]),
                color: r.map(i => applyOpacityToColor(styleArrays.colors[i], styleArrays.opacity[i])),
                symbol: r.map(i => shapeToPlotlySymbol(styleArrays.shapes[i])),
                line: { width: 0 },
            },
        });
        const ring = (set: Set<number>, color: string, grow: number, width: number) => {
            const ks = r.map((i, k) => (set.has(orig(i)) ? k : -1)).filter(k => k >= 0);
            if (ks.length) out.push({
                type: 'scatter', mode: 'markers', x: ks.map(k => proj.along[k]), y: ks.map(k => proj.elev[k]), hoverinfo: 'skip', showlegend: false,
                marker: { color: 'rgba(0,0,0,0)', size: ks.map(k => styleArrays.sizes[r[k]] + grow), line: { width, color } },
            });
        };
        if (hoveredRows) ring(hoveredRows, HOVER_RING_COLOR, 3, 2.5);
        if (selectedIndices.length) ring(new Set(selectedIndices), SELECTION_COLOR, 4, 2);

        // Plan inset: every visible sample grey, the slab's samples dark, the section line red
        if (showPlan) {
            const e = getDisplayColumn(eastCol)!, n = getDisplayColumn(northCol)!;
            const step = Math.max(1, Math.ceil(sortedIndices.length / 3000));
            const pe: number[] = [], pn: number[] = [];
            for (let k = 0; k < sortedIndices.length; k += step) { pe.push(Number(e[sortedIndices[k]])); pn.push(Number(n[sortedIndices[k]])); }
            out.push({ type: 'scatter', mode: 'markers', x: pe, y: pn, xaxis: 'x2', yaxis: 'y2', marker: { size: 3, color: 'rgba(150,150,150,0.5)' }, hoverinfo: 'skip', showlegend: false });
            const se = r.map(i => Number(e[i])), sn = r.map(i => Number(n[i]));
            out.push({ type: 'scatter', mode: 'markers', x: se, y: sn, xaxis: 'x2', yaxis: 'y2', marker: { size: 3, color: 'rgba(40,40,40,0.9)' }, hoverinfo: 'skip', showlegend: false });
            const ext = proj.along.length ? [Math.min(...proj.along), Math.max(...proj.along)] : [-100, 100];
            const pad = Math.max(10, (ext[1] - ext[0]) * 0.1);
            const a = (line.azimuth * Math.PI) / 180;
            const at = (s: number) => [line.originE + s * Math.sin(a), line.originN + s * Math.cos(a)];
            const p0 = at(ext[0] - pad), p1 = at(ext[1] + pad);
            out.push({ type: 'scatter', mode: 'lines+text', x: [p0[0], p1[0]], y: [p0[1], p1[1]], xaxis: 'x2', yaxis: 'y2',
                line: { color: '#d32f2f', width: 2 }, text: ['A', 'B'], textposition: 'top center', textfont: { color: '#d32f2f' }, hoverinfo: 'skip', showlegend: false });
        }
        return out;
    }, [proj, styleArrays, line?.azimuth, showTraces, showPlan, holeCol, depthCol, eastCol, northCol, elevCol, getDisplayColumn, d, orig, hoveredRows, selectedIndices, sortedIndices]); // eslint-disable-line react-hooks/exhaustive-deps

    const az = azimuth ?? 0;
    const title = line && proj
        ? `Section ${bearing(az)} · ±${halfWidth} m · ${proj.rows.length.toLocaleString()} samples`
          + (proj.outside ? `<span style="font-size:0.8em;color:#888"> · ${proj.outside.toLocaleString()} outside the slab</span>` : '')
        : 'Section';

    const controlBar = (
        <PlotControlBar
            primary={<>
                {numField('Origin E', originE, setOriginE, 130)}
                {numField('Origin N', originN, setOriginN, 130)}
                {numField('Azimuth °', azimuth, v => setAzimuth(v === null ? null : ((v % 360) + 360) % 360), 100)}
                {numField('Half width m', halfWidth, v => setHalfWidth(v === null ? null : Math.max(0, v)), 110)}
                {numField('V.E.', ve, v => setVe(v && v > 0 ? v : 1), 80)}
                <Tooltip title="Fit the line to the visible samples: through their centre, along their longest direction">
                    <span><Button size="small" variant="outlined" disabled={!fitted} onClick={applyFit}>Fit to data</Button></span>
                </Tooltip>
                <Tooltip title="Turn the section through 90° about its origin">
                    <span><Button size="small" disabled={azimuth === null} onClick={() => setAzimuth(((az + 90) % 360))}>+90°</Button></span>
                </Tooltip>
            </>}
            settingsActive={!showTraces || !showPlan}
            summary={<>
                {ve !== 1 && <SettingChip label={`V.E. ×${ve}`} onDelete={() => setVe(1)} />}
            </>}
            settings={<>
                <ControlSection label="Columns">
                    <ColumnPicker label="East" value={eastCol} onChange={setEastCol} filter="numeric" minWidth={150} />
                    <ColumnPicker label="North" value={northCol} onChange={setNorthCol} filter="numeric" minWidth={150} />
                    <ColumnPicker label="Elevation" value={elevCol} onChange={setElevCol} filter="numeric" minWidth={150} />
                    <ColumnPicker label="Hole" value={holeCol} onChange={setHoleCol} allowNone minWidth={150} />
                    <ColumnPicker label="Depth (order)" value={depthCol} onChange={setDepthCol} filter="numeric" allowNone minWidth={150} />
                </ControlSection>
                <ControlSection label="Display">
                    <FormControlLabel control={<Checkbox size="small" checked={showTraces} onChange={(e) => setShowTraces(e.target.checked)} />} label={<Typography variant="body2">Hole traces</Typography>} />
                    <FormControlLabel control={<Checkbox size="small" checked={showPlan} onChange={(e) => setShowPlan(e.target.checked)} />} label={<Typography variant="body2">Plan inset</Typography>} />
                </ControlSection>
            </>}
        />
    );

    if (!ready) {
        return (
            <Box sx={{ p: 2 }}>
                {controlBar}
                <Typography color="text.secondary">Choose the East, North and Elevation columns (desurveyed sample positions) in the plot settings.</Typography>
            </Box>
        );
    }

    const planDomain: [number, number] = [0.78, 1];
    const layout: any = {
        title: { text: title, font: { size: EXPORT_FONT_SIZES.title }, x: 0, xanchor: 'left' },
        autosize: true, height: fillHeight, dragmode: dragMode, hovermode: 'closest', showlegend: false,
        font: { size: EXPORT_FONT_SIZES.tickLabels },
        margin: { l: 70, r: 30, t: 60, b: 60 },
        xaxis: {
            title: { text: `Distance along section (m), A ${bearing(az + 180)} → B ${bearing(az)}`, font: { size: EXPORT_FONT_SIZES.axisTitle } },
            domain: showPlan ? [0, 0.74] : [0, 1], zeroline: true, zerolinecolor: 'rgba(211,47,47,0.35)',
        },
        yaxis: {
            title: { text: `${d(elevCol)} (m)${ve !== 1 ? ` · V.E. ×${ve}` : ''}`, font: { size: EXPORT_FONT_SIZES.axisTitle } },
            scaleanchor: 'x', scaleratio: ve,
        },
        ...(showPlan ? {
            xaxis2: { domain: planDomain, anchor: 'y2', showticklabels: false, title: { text: 'Plan', font: { size: 11 } }, zeroline: false },
            yaxis2: { domain: [0.55, 1], anchor: 'x2', showticklabels: false, scaleanchor: 'x2', scaleratio: 1, zeroline: false },
        } : {}),
        uirevision: `${originE}|${originN}|${azimuth}|${halfWidth}|${ve}|${showPlan}`,
    };

    return (
        <Box sx={{ p: 1 }}>
            {controlBar}
            <Paper ref={fillRef} sx={{ p: 2 }}>
                {!line && <Typography color="text.secondary">Set the section origin, azimuth and half width, or press Fit to data.</Typography>}
                {line && proj && proj.rows.length === 0 && (
                    <Typography color="text.secondary" sx={{ mb: 1 }}>
                        No visible samples within ±{halfWidth} m of this section. Widen the slab or press Fit to data.
                    </Typography>
                )}
                {line && (
                    <ExpandablePlotWrapper>
                        <Plot
                            data={traces}
                            layout={layout}
                            config={getPlotConfig({ filename: `section_${bearing(az).replace('°', '')}` })}
                            style={{ width: '100%' }}
                            useResizeHandler
                            onSelected={handleSelected}
                            onClick={handleClick}
                            onDeselect={handleDeselect}
                        />
                    </ExpandablePlotWrapper>
                )}
                {line && proj && proj.missing > 0 && (
                    <Typography variant="caption" color="text.secondary">
                        {proj.missing.toLocaleString()} visible samples have no {d(eastCol)} / {d(northCol)} / {d(elevCol)} and are not shown.
                    </Typography>
                )}
            </Paper>
        </Box>
    );
};

export default SectionPlot;
