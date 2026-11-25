/**
 * The volumes of the scene's numeric models side by side (Phase 233): a row
 * for each model with the ground it is kept inside, a column for each
 * cut-off. Shown in the properties of the Numeric models group, and put in
 * the report from there.
 */
import React, { useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { useModelStore } from '../../../store/modelStore';
import { formatVolume } from '../../model/describe';
import { useModelCache } from '../../model/modelCache';
import { numericVolumes, numericVolumesToReport } from '../../model/numericReport';
import { smallButton } from './styles';

const cell = { padding: '2px 8px 2px 0', textAlign: 'left', fontWeight: 'inherit', verticalAlign: 'top' } as const;

export const NumericVolumes: React.FC = () => {
    // (Drawn again when a model, a geological model's name or a fit changes: the table reads all three)
    useModelStore(s => s.scene.numericModels);
    useModelStore(s => s.scene.models);
    useModelCache(s => s.byId);
    const [said, setSaid] = useState('');
    const table = numericVolumes();
    if (table.rows.length === 0) return null;
    return (
        <Box sx={{ mt: 1.5 }}>
            <Typography variant="subtitle2">Volume by cut-off</Typography>
            <Box sx={{ overflowX: 'auto' }}>
                <Box component="table" data-testid="numeric-volumes" sx={{ borderCollapse: 'collapse', fontSize: 12, mt: 0.25, whiteSpace: 'nowrap' }}>
                    <thead>
                        <tr>
                            <Box component="th" sx={{ ...cell, color: 'text.secondary' }}>Model</Box>
                            <Box component="th" sx={{ ...cell, color: 'text.secondary' }}>Kept inside</Box>
                            {table.cutoffs.map(c => <Box component="th" key={c} sx={{ ...cell, color: 'text.secondary' }}>{`≥ ${c}`}</Box>)}
                        </tr>
                    </thead>
                    <tbody>
                        {table.rows.map(r => (
                            <React.Fragment key={r.id}>
                                <tr data-model={r.id}>
                                    <Box component="td" sx={cell}>{r.name}</Box>
                                    <Box component="td" sx={cell}>{r.where}</Box>
                                    {r.volumes.map((v, i) => <Box component="td" key={table.cutoffs[i]} sx={cell}>{v === null ? '' : v > 0 ? formatVolume(v) : 'none'}</Box>)}
                                </tr>
                                {/* (A proportion: how much of its units the ground of each shell holds, and how much there is in all) */}
                                {r.share && (
                                    <tr data-share-of={r.id}>
                                        <Box component="td" sx={{ ...cell, color: 'text.secondary', pl: 1.5 }}>{`${r.share.units} in that ground`}</Box>
                                        <Box component="td" sx={{ ...cell, color: 'text.secondary' }}>{r.share.all !== null ? `in all, about ${formatVolume(r.share.all)}` : ''}</Box>
                                        {r.share.inside.map((v, i) => <Box component="td" key={table.cutoffs[i]} sx={{ ...cell, color: 'text.secondary' }}>{v === null ? '' : v > 0 ? formatVolume(v) : 'none'}</Box>)}
                                    </tr>
                                )}
                            </React.Fragment>
                        ))}
                    </tbody>
                </Box>
            </Box>
            <Button size="small" variant="outlined" data-action="numeric-volumes-report" sx={{ ...smallButton, mt: 0.5 }} onClick={() => setSaid(numericVolumesToReport() ? 'The table is in the report.' : '')}>
                Add the table to the report
            </Button>
            {said && <Typography data-testid="numeric-volumes-said" variant="caption" sx={{ display: 'block', mt: 0.25 }}>{said}</Typography>}
        </Box>
    );
};
