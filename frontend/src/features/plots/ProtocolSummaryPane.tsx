/**
 * "Assay protocols" plot pane: how the samples were split into protocol
 * groups — the detection-limit matrix (groups x elements) and what each
 * group is made of (stacked by any text column). Drawn from the summary
 * stored with the protocol column, so it comes back with the project and is
 * captured by Add to report like any other plot.
 */
import React, { useMemo } from 'react';
import { Alert, Box, MenuItem, Stack, TextField, Typography } from '@mui/material';
import Plot from '../../components/ThemedPlot';
import { useAppStore } from '../../store/appStore';
import { usePlotSetting } from '../../hooks/usePlotSetting';
import { isNumericColumn } from '../../types/columnarData';
import { compositionCounts, protocolComposition, protocolMatrix } from '../../utils/protocolFigures';
import { protocolColumns, protocolSummaryOf } from '../../utils/protocolSplit';

const CONFIG = { displaylogo: false, responsive: true } as const;
// The matrix keeps its own width (readable cells; scrolls in a narrow pane)
const FIXED = { displaylogo: false } as const;

export const ProtocolSummaryPane: React.FC<{ plotId: string }> = ({ plotId }) => {
    const columns = useAppStore(s => s.columns);
    const columnarData = useAppStore(s => s.columnarData);
    const available = useMemo(() => protocolColumns(columns), [columns]);
    const [chosen, setColumn] = usePlotSetting<string>(plotId, 'column', '');
    const column = chosen && available.includes(chosen) ? chosen : available[available.length - 1] ?? '';
    const summary = useMemo(() => (column ? protocolSummaryOf(columns, column) : null), [columns, column]);
    const [compareWith, setCompareWith] = usePlotSetting<string>(plotId, 'compareWith', '');
    const by = compareWith || summary?.batchColumn || '';

    // Text columns to break the groups down by (method, batch, sample type, …)
    const textColumns = useMemo(() => columns.filter(c => {
        const col = columnarData.columns.get(c.name);
        return !!col && !isNumericColumn(col) && c.name !== column;
    }).map(c => c.name), [columns, columnarData, column]);

    const matrix = useMemo(() => (summary ? protocolMatrix(summary) : null), [summary]);
    const composition = useMemo(() => {
        if (!summary) return null;
        const labels = columnarData.columns.get(summary.column);
        if (!labels) return null;
        const byValues = by ? columnarData.columns.get(by) ?? null : null;
        return protocolComposition(summary, compositionCounts(labels, byValues), by || null);
    }, [summary, columnarData, by]);

    if (!summary || !matrix) {
        return (
            <Box sx={{ p: 3 }}>
                <Alert severity="info">
                    No assay protocol column yet. Open Data › Assay protocols, then Add column: this pane then shows how the samples were split.
                </Alert>
            </Box>
        );
    }
    return (
        <Box sx={{ height: '100%', overflow: 'auto', p: 1.5 }}>
            <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 1 }} flexWrap="wrap" useFlexGap>
                {available.length > 1 && (
                    <TextField select size="small" label="Protocol column" value={column} onChange={e => setColumn(e.target.value)} sx={{ minWidth: 180 }}>
                        {available.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                    </TextField>
                )}
                <TextField select size="small" label="Break groups down by" value={by} onChange={e => setCompareWith(e.target.value)} sx={{ minWidth: 220 }}>
                    <MenuItem value="">(samples only)</MenuItem>
                    {textColumns.map(c => <MenuItem key={c} value={c}>{c}{c === summary.batchColumn ? ' · used for the split' : ''}</MenuItem>)}
                </TextField>
                <Typography variant="caption" color="text.secondary">
                    {summary.rowCount.toLocaleString()} samples · {summary.groups.length} groups · {summary.columns.length} assay columns
                    {summary.batchColumn ? ` · limits judged per ${summary.batchColumn}` : ''}
                </Typography>
            </Stack>
            <Plot data={matrix.data} layout={matrix.layout} config={FIXED} />
            {composition && (
                <Plot data={composition.data} layout={{ ...composition.layout, autosize: true }} config={CONFIG} style={{ width: '100%' }} useResizeHandler />
            )}
        </Box>
    );
};

export default ProtocolSummaryPane;
