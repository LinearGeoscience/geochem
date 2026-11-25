/**
 * QA/QC view (Phase 11b): lazy-loaded chunk. Tab state lives in App so it
 * survives navigating away and back.
 */
import React from 'react';
import { Box, Tabs, Tab } from '@mui/material';
import { AttributeManager } from '../components/AttributeManager';
import { RightSidebar, RightSidebarProps } from '../components/RightSidebar';
import { QAQCManager, ControlChart, DuplicateAnalysis, BlankAnalysis, QAQCDashboard } from '../features/qaqc';

type SidebarProps = Omit<RightSidebarProps, 'children'>;

interface QAQCViewProps {
    tab: number;
    onTabChange: (tab: number) => void;
    sidebar: SidebarProps;
}

const QAQCView: React.FC<QAQCViewProps> = ({ tab, onTabChange, sidebar }) => (
    <Box sx={{ display: 'flex', gap: 2 }}>
        {/* Main content area */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
            <Tabs value={tab} onChange={(_, newValue) => onTabChange(newValue)} sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }} variant="scrollable" scrollButtons="auto">
                <Tab label="Configuration" />
                <Tab label="Control Charts" />
                <Tab label="Duplicates" />
                <Tab label="Blanks" />
                <Tab label="Dashboard" />
            </Tabs>
            {/* Keep all tabs mounted for state persistence, hide inactive with display:none */}
            <Box sx={{ display: tab === 0 ? 'block' : 'none' }}>
                <QAQCManager onNavigate={(view) => {
                    switch (view) {
                        case 'control-chart': onTabChange(1); break;
                        case 'duplicates': onTabChange(2); break;
                        case 'blanks': onTabChange(3); break;
                        case 'dashboard': onTabChange(4); break;
                    }
                }} />
            </Box>
            <Box sx={{ display: tab === 1 ? 'block' : 'none' }}><ControlChart /></Box>
            <Box sx={{ display: tab === 2 ? 'block' : 'none' }}><DuplicateAnalysis /></Box>
            <Box sx={{ display: tab === 3 ? 'block' : 'none' }}><BlankAnalysis /></Box>
            <Box sx={{ display: tab === 4 ? 'block' : 'none' }}>
                <QAQCDashboard onNavigate={(view) => {
                    switch (view) {
                        case 'manager': onTabChange(0); break;
                        case 'control-chart': onTabChange(1); break;
                        case 'duplicates': onTabChange(2); break;
                        case 'blanks': onTabChange(3); break;
                    }
                }} />
            </Box>
        </Box>
        <RightSidebar {...sidebar}>
            <AttributeManager />
        </RightSidebar>
    </Box>
);

export default QAQCView;
