/**
 * Dock theme: dockview's light/dark theme with its CSS variables taken from
 * the MUI palette, so the dock follows the app theme (no raw colours here).
 */
import React from 'react';
import { GlobalStyles, alpha, useTheme } from '@mui/material';
import { themeLight, themeDark } from 'dockview-react';
import { DOCK_EXTRA_CLASS as EXTRA_CLASS } from './dockThemeConfig';

export const DockThemeStyles: React.FC = () => {
    const t = useTheme();
    const p = t.palette;
    // Two classes beat the base theme's single-class variable declarations
    const sel = `.${(p.mode === 'dark' ? themeDark : themeLight).className.split(' ')[0]}.${EXTRA_CLASS}`;
    return (
        <GlobalStyles
            styles={{
                [sel]: {
                    '--dv-group-view-background-color': p.background.default,
                    '--dv-tabs-and-actions-container-background-color': p.mode === 'dark' ? p.background.paper : alpha(p.text.primary, 0.035),
                    '--dv-tabs-and-actions-container-height': '34px',
                    '--dv-tabs-and-actions-container-font-size': '13px',
                    '--dv-activegroup-visiblepanel-tab-background-color': p.background.paper,
                    '--dv-activegroup-visiblepanel-tab-color': p.text.primary,
                    '--dv-activegroup-hiddenpanel-tab-background-color': 'transparent',
                    '--dv-activegroup-hiddenpanel-tab-color': p.text.secondary,
                    '--dv-inactivegroup-visiblepanel-tab-background-color': p.background.paper,
                    '--dv-inactivegroup-visiblepanel-tab-color': p.text.secondary,
                    '--dv-inactivegroup-hiddenpanel-tab-background-color': 'transparent',
                    '--dv-inactivegroup-hiddenpanel-tab-color': p.text.disabled,
                    '--dv-tab-divider-color': p.divider,
                    '--dv-separator-border': p.divider,
                    '--dv-sash-color': 'transparent',
                    '--dv-active-sash-color': p.primary.main,
                    '--dv-drag-over-background-color': alpha(p.primary.main, 0.14),
                    '--dv-drag-over-border-color': p.primary.main,
                    '--dv-paneview-active-outline-color': p.primary.main,
                    '--dv-icon-hover-background-color': p.action.hover,
                    '--dv-scrollbar-background-color': alpha(p.text.primary, 0.25),
                    fontFamily: t.typography.fontFamily,
                },
                // Active tab of the focused group gets the brand underline
                [`${sel} .dv-groupview.dv-active-group > .dv-tabs-and-actions-container .dv-tab.dv-active-tab`]: {
                    boxShadow: `inset 0 -2px 0 ${p.primary.main}`,
                },
            }}
        />
    );
};
