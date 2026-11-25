/**
 * Sectioned analysis navigation (UI Refresh R3) — replaces the 12 flat
 * scrolling tabs with grouped vertical navigation. Purely presentational:
 * the numeric tab index, App-held state, and the keep-mounted content boxes
 * in AnalysisView are untouched.
 */
import React from 'react';
import { Box, List, ListItemButton, ListItemText, Typography } from '@mui/material';
import { APPBAR_HEIGHT } from '../../theme';

interface NavItem {
    index: number;
    label: string;
}

interface NavSection {
    label: string;
    items: NavItem[];
}

const ANALYSIS_SECTIONS: NavSection[] = [
    {
        label: 'Exploratory',
        items: [
            { index: 0, label: 'Summary Statistics' },
            { index: 1, label: 'Box Plots' },
            { index: 2, label: 'Correlation Matrix' },
            { index: 3, label: 'Probability Plot' },
        ],
    },
    {
        label: 'Advanced Statistics',
        items: [
            { index: 4, label: 'Outlier Detection' },
            { index: 5, label: 'Population Separation' },
            { index: 6, label: 'Robust Regression' },
            { index: 7, label: 'Clustering' },
            { index: 13, label: 'Anomaly Ranking' },
        ],
    },
    {
        label: 'Processing',
        items: [
            { index: 8, label: 'Transformations' },
            { index: 9, label: 'PCA Analysis' },
            { index: 10, label: 'Deposit Vectoring' },
            { index: 11, label: 'Recalculation' },
        ],
    },
];

interface AnalysisNavProps {
    tab: number;
    onTabChange: (tab: number) => void;
}

export const AnalysisNav: React.FC<AnalysisNavProps> = ({ tab, onTabChange }) => (
    <Box
        sx={{
            width: 200,
            flexShrink: 0,
            position: 'sticky',
            top: APPBAR_HEIGHT + 16,
            alignSelf: 'flex-start',
            maxHeight: `calc(100vh - ${APPBAR_HEIGHT + 60}px)`,
            overflowY: 'auto',
        }}
    >
        {ANALYSIS_SECTIONS.map((section) => (
            <Box key={section.label} sx={{ mb: 2 }}>
                <Typography variant="overline" color="text.secondary" sx={{ px: 1.5, display: 'block' }}>
                    {section.label}
                </Typography>
                <List dense disablePadding>
                    {section.items.map((item) => (
                        <ListItemButton
                            key={item.index}
                            selected={tab === item.index}
                            onClick={() => onTabChange(item.index)}
                            sx={{ py: 0.5, px: 1.5 }}
                        >
                            <ListItemText
                                primary={item.label}
                                primaryTypographyProps={{
                                    variant: 'body2',
                                    fontWeight: tab === item.index ? 600 : 400,
                                }}
                            />
                        </ListItemButton>
                    ))}
                </List>
            </Box>
        ))}
    </Box>
);
