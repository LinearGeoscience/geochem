/**
 * Combine surveys: tools for treating data from several sample media, lab
 * methods and batches together without false populations.
 *  - Overlap check: do groups that sampled the same ground agree?
 *  - Levelling: each value scored within its own group, for whole-area maps.
 *  - Common detection limit: one censoring level across chosen groups.
 */
import React from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Tab, Tabs } from '@mui/material';
import { useUIStore, type CombineSurveysTab } from '../../../store/uiStore';
import { CommonDlTab } from './CommonDlTab';
import { LevellingTab } from './LevellingTab';
import { OverlapTab } from './OverlapTab';

const TABS: { value: CombineSurveysTab; label: string }[] = [
    { value: 'overlap', label: 'Overlap check' },
    { value: 'levelling', label: 'Levelling' },
    { value: 'commonDl', label: 'Common detection limit' },
];

export const CombineSurveysDialog: React.FC = () => {
    const tab = useUIStore(s => s.combineSurveys);
    const set = useUIStore(s => s.setCombineSurveys);
    if (!tab) return null;
    return (
        <Dialog open onClose={() => set(null)} maxWidth="lg" fullWidth>
            <DialogTitle>Combine surveys</DialogTitle>
            <DialogContent dividers>
                <Tabs value={tab} onChange={(_, v) => set(v)} sx={{ mb: 2, minHeight: 36, '& .MuiTab-root': { minHeight: 36 } }}>
                    {TABS.map(t => <Tab key={t.value} value={t.value} label={t.label} />)}
                </Tabs>
                {tab === 'overlap' && <OverlapTab />}
                {tab === 'levelling' && <LevellingTab />}
                {tab === 'commonDl' && <CommonDlTab />}
            </DialogContent>
            <DialogActions><Button onClick={() => set(null)}>Close</Button></DialogActions>
        </Dialog>
    );
};

export default CombineSurveysDialog;
