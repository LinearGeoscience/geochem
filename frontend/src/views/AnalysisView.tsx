/**
 * Analysis view (Phase 11b): lazy-loaded chunk. Tab state lives in App so it
 * survives navigating away and back.
 */
import React from 'react';
import { Box } from '@mui/material';
import { AttributeManager } from '../components/AttributeManager';
import { RightSidebar, RightSidebarProps } from '../components/RightSidebar';
import { AnalysisNav } from '../features/analysis/AnalysisNav';
import { SummaryStats } from '../features/analysis/SummaryStats';
import { CorrelationMatrix } from '../features/analysis/CorrelationMatrix';
import { ProbabilityPlot } from '../features/analysis/ProbabilityPlot';
import { BoxPlot } from '../features/analysis/BoxPlot';
import { TransformationManager } from '../features/analysis/TransformationManager';
import { PCAWorkflow } from '../features/analysis/PCAWorkflow';
import { VectoringManager } from '../features/vectoring/VectoringManager';
import { RecalculationWizard } from '../features/analysis/RecalculationWizard';
import { OutlierDetection } from '../features/analysis/OutlierDetection';
import { PopulationSeparation } from '../features/analysis/PopulationSeparation';
import { RobustRegressionView } from '../features/analysis/RobustRegression';
import { ClusteringAnalysis } from '../features/analysis/ClusteringAnalysis';
import { AnomalyRanking } from '../features/analysis/AnomalyRanking';

type SidebarProps = Omit<RightSidebarProps, 'children'>;

interface AnalysisViewProps {
    tab: number;
    onTabChange: (tab: number) => void;
    sidebar: SidebarProps;
}

const AnalysisView: React.FC<AnalysisViewProps> = ({ tab, onTabChange, sidebar }) => (
    <Box sx={{ display: 'flex', gap: 2.5 }}>
        {/* Sectioned navigation (replaces the 12 flat tabs) */}
        <AnalysisNav tab={tab} onTabChange={onTabChange} />

        {/* Main content area */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
            {/* Keep all tabs mounted for state persistence, hide inactive with display:none */}
            {/* Exploratory */}
            <Box sx={{ display: tab === 0 ? 'block' : 'none' }}><SummaryStats /></Box>
            <Box sx={{ display: tab === 1 ? 'block' : 'none' }}><BoxPlot /></Box>
            <Box sx={{ display: tab === 2 ? 'block' : 'none' }}><CorrelationMatrix /></Box>
            <Box sx={{ display: tab === 3 ? 'block' : 'none' }}><ProbabilityPlot /></Box>
            {/* Advanced Statistics */}
            <Box sx={{ display: tab === 4 ? 'block' : 'none' }}><OutlierDetection /></Box>
            <Box sx={{ display: tab === 5 ? 'block' : 'none' }}><PopulationSeparation /></Box>
            <Box sx={{ display: tab === 6 ? 'block' : 'none' }}><RobustRegressionView /></Box>
            <Box sx={{ display: tab === 7 ? 'block' : 'none' }}><ClusteringAnalysis /></Box>
            <Box sx={{ display: tab === 13 ? 'block' : 'none' }}><AnomalyRanking /></Box>
            {/* Processing */}
            <Box sx={{ display: tab === 8 ? 'block' : 'none' }}><TransformationManager /></Box>
            <Box sx={{ display: tab === 9 ? 'block' : 'none' }}><PCAWorkflow /></Box>
            <Box sx={{ display: tab === 10 ? 'block' : 'none' }}><VectoringManager /></Box>
            <Box sx={{ display: tab === 11 ? 'block' : 'none' }}><RecalculationWizard /></Box>
        </Box>
        <RightSidebar {...sidebar}>
            <AttributeManager />
        </RightSidebar>
    </Box>
);

export default AnalysisView;
