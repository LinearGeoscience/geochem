/**
 * Factor analysis (principal-axis factoring + varimax) on the elements chosen
 * in the PCA workflow. Runs in the analysis worker; rotated loadings are
 * shown as a heat-coloured table and scores can be added as columns.
 */
import React, { useState } from 'react';
import {
    Alert, Box, Button, CircularProgress, FormControlLabel, Paper, Stack, Switch, Table, TableBody,
    TableCell, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import { useAppStore } from '../../store/appStore';
import { analysisInWorker, pickColumns } from '../../utils/analysisWorker';
import type { FactorAnalysisResult } from '../../utils/statistics/factorAnalysis';
import { getColumnDisplayName } from '../../utils/attributeUtils';

interface Props {
    /** Variables (column names) chosen in the PCA element selection */
    elements: string[];
    /** Rows analysed (sampled display rows) */
    rows: Record<string, any>[];
    /** Original dataset index for each analysed row, or null when not sampling */
    rowIndices: number[] | null;
}

/** Diverging background for a loading in [-1, 1]. */
function loadingColor(v: number): string {
    const a = Math.min(1, Math.abs(v));
    return v >= 0 ? `rgba(211, 47, 47, ${a * 0.55})` : `rgba(25, 118, 210, ${a * 0.55})`;
}

export const FactorAnalysisPanel: React.FC<Props> = ({ elements, rows, rowIndices }) => {
    const columns = useAppStore(s => s.columns);
    const rowCount = useAppStore(s => s.columnarData.rowCount);
    const addColumn = useAppStore(s => s.addColumn);
    const [nFactors, setNFactors] = useState<number | ''>('');
    const [useClr, setUseClr] = useState(true);
    const [running, setRunning] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<FactorAnalysisResult | null>(null);
    const [added, setAdded] = useState<string | null>(null);

    const d = (name: string) => getColumnDisplayName(columns, name);

    const run = async () => {
        setRunning(true);
        setError(null);
        setAdded(null);
        try {
            const res = await analysisInWorker<FactorAnalysisResult>('factorAnalysis', {
                data: pickColumns(rows, elements),
                columns: elements,
                options: { useClr, nFactors: nFactors === '' ? undefined : nFactors },
            });
            setResult(res);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            setResult(null);
        } finally {
            setRunning(false);
        }
    };

    const addScores = () => {
        if (!result) return;
        const names: string[] = [];
        for (let f = 0; f < result.nFactors; f++) {
            const values = new Array(rowCount).fill(NaN);
            result.keptIndices.forEach((k, j) => {
                const original = rowIndices ? rowIndices[k] : k;
                if (original >= 0 && original < rowCount) values[original] = result.scores[j][f];
            });
            const name = `F${f + 1}_varimax`;
            const top = result.columns
                .map((c, i) => [c, result.rotatedLoadings[i][f]] as const)
                .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
                .slice(0, 4)
                .map(([c, v]) => `${d(c)} ${v > 0 ? '+' : '−'}`)
                .join(', ');
            addColumn(name, values, 'numeric', 'Factor', 'pca' as any, undefined, {
                kind: 'pca',
                description: `Factor ${f + 1} (varimax, PAF${useClr ? ' on CLR' : ''}): ${top}`,
                params: {
                    method: 'principal-axis factoring + varimax',
                    factor: f + 1,
                    nFactors: result.nFactors,
                    elements: result.columns,
                    clr: useClr,
                    varianceExplained: result.varianceExplained[f],
                },
                created: new Date().toISOString(),
            });
            names.push(name);
        }
        setAdded(names.join(', '));
    };

    const kaiser = result ? result.eigenvalues.filter(v => v > 1).length : null;

    return (
        <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Principal-axis factoring with varimax rotation on the {elements.length} selected elements.
                Factors model the shared variance between elements (unlike PCA, which also includes each element's unique variance),
                so rotated loadings are usually easier to interpret as geochemical associations.
            </Typography>
            <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2, flexWrap: 'wrap' }}>
                <Tooltip title="Leave empty to use the eigenvalue > 1 (Kaiser) rule">
                    <TextField
                        size="small" type="number" label="Factors" value={nFactors}
                        onChange={e => setNFactors(e.target.value === '' ? '' : Math.max(1, Math.min(elements.length - 1, Number(e.target.value))))}
                        sx={{ width: 110 }} placeholder="auto"
                    />
                </Tooltip>
                <FormControlLabel control={<Switch checked={useClr} onChange={e => setUseClr(e.target.checked)} />} label="CLR transform first" />
                <Button variant="contained" onClick={run} disabled={running || elements.length < 3}>
                    {running ? <CircularProgress size={18} /> : 'Run factor analysis'}
                </Button>
                {result && <Button variant="outlined" onClick={addScores}>Add factor scores to data</Button>}
            </Stack>

            {elements.length < 3 && <Alert severity="info">Select at least 3 elements.</Alert>}
            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
            {added && <Alert severity="success" sx={{ mb: 2 }}>Added columns: {added}</Alert>}

            {result && (
                <>
                    {!result.converged && <Alert severity="warning" sx={{ mb: 1 }}>Communalities did not fully converge ({result.iterations} iterations).</Alert>}
                    {result.heywoodCase && <Alert severity="warning" sx={{ mb: 1 }}>Heywood case: a communality reached 1 — try fewer factors.</Alert>}
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                        {result.nFactors} factor{result.nFactors === 1 ? '' : 's'} · {result.keptIndices.length.toLocaleString()} complete samples ·
                        Kaiser rule suggests {kaiser} · total variance explained {(100 * (result.cumulativeVariance.at(-1) ?? 0)).toFixed(1)}%
                    </Typography>
                    <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
                        <Table size="small">
                            <TableHead>
                                <TableRow>
                                    <TableCell>Element</TableCell>
                                    {result.varianceExplained.map((v, f) => (
                                        <TableCell key={f} align="right">F{f + 1}<br /><Typography variant="caption" color="text.secondary">{(100 * v).toFixed(1)}%</Typography></TableCell>
                                    ))}
                                    <TableCell align="right">Communality</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {result.columns.map((c, i) => (
                                    <TableRow key={c}>
                                        <TableCell>{d(c)}</TableCell>
                                        {result.rotatedLoadings[i].map((v, f) => (
                                            <TableCell key={f} align="right" sx={{ bgcolor: loadingColor(v), fontWeight: Math.abs(v) >= 0.5 ? 600 : 400 }}>
                                                {v.toFixed(2)}
                                            </TableCell>
                                        ))}
                                        <TableCell align="right">{result.communalities[i].toFixed(2)}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </Paper>
                </>
            )}
        </Box>
    );
};
