/**
 * GeoChem theme (UI Refresh R1) — slate + teal, Inter, flat bordered surfaces.
 *
 * Spacing conventions (8px base):
 *   page container p:3 · section rhythm mb:3 · control clusters gap:1 ·
 *   toolbars px:2 py:1. Compact controls, airy pages.
 */
import { createTheme, Theme } from '@mui/material/styles';
import type { ThemeMode } from '../store/uiStore';
import { slate, teal, semantic } from './colors';
import { typography } from './typography';
import { buildComponents } from './components';

/** AppBar height — shared by Layout spacers and sticky-offset consumers. */
export const APPBAR_HEIGHT = 64;

function buildPalette(mode: ThemeMode) {
    if (mode === 'light') {
        return {
            mode,
            primary: { main: teal[700], dark: teal[800], light: teal[500], contrastText: '#FFFFFF' },
            secondary: { main: slate[600], dark: slate[700], light: slate[500], contrastText: '#FFFFFF' },
            background: { default: slate[50], paper: '#FFFFFF' },
            divider: slate[200],
            text: { primary: slate[900], secondary: slate[600], disabled: slate[400] },
            action: {
                hover: 'rgba(15, 23, 42, 0.04)',
                selected: 'rgba(15, 118, 110, 0.08)',
                focus: 'rgba(15, 118, 110, 0.12)',
            },
            success: { main: semantic.successLight, dark: '#166534', light: '#DCFCE7', contrastText: '#FFFFFF' },
            warning: { main: semantic.warningLight, light: '#FEF3C7', contrastText: '#FFFFFF' },
            error: { main: semantic.errorLight, light: '#FEE2E2', contrastText: '#FFFFFF' },
            info: { main: semantic.infoLight, light: '#E0F2FE', contrastText: '#FFFFFF' },
        } as const;
    }
    return {
        mode,
        primary: { main: teal[500], dark: teal[700], light: teal[400], contrastText: slate[900] },
        secondary: { main: slate[400], contrastText: slate[900] },
        background: { default: slate[900], paper: slate[800] },
        divider: slate[700],
        text: { primary: slate[200], secondary: slate[400], disabled: slate[500] },
        action: {
            hover: 'rgba(226, 232, 240, 0.06)',
            selected: 'rgba(20, 184, 166, 0.16)',
            focus: 'rgba(20, 184, 166, 0.24)',
        },
        success: { main: semantic.successDark, contrastText: slate[900] },
        warning: { main: semantic.warningDark, contrastText: slate[900] },
        error: { main: semantic.errorDark, contrastText: slate[900] },
        info: { main: semantic.infoDark, contrastText: slate[900] },
    } as const;
}

export function buildTheme(mode: ThemeMode): Theme {
    return createTheme({
        palette: buildPalette(mode),
        typography,
        shape: { borderRadius: 6 },
        components: buildComponents(mode),
    });
}
