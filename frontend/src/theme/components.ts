/**
 * MUI component overrides (UI Refresh R1).
 *
 * Design language: compact controls, airy pages; flat bordered surfaces
 * (borders over shadows — floating layers get ONE sanctioned soft shadow);
 * teal-tinted selection states; no uppercase buttons.
 */
import type { Components, Theme } from '@mui/material/styles';
import type { ThemeMode } from '../store/uiStore';
import { slate } from './colors';

export function buildComponents(mode: ThemeMode): Components<Omit<Theme, 'components'>> {
    const light = mode === 'light';
    const floatShadow = light
        ? '0 4px 16px rgba(15, 23, 42, 0.12)'
        : '0 4px 16px rgba(0, 0, 0, 0.4)';
    const divider = light ? slate[200] : slate[700];

    return {
        MuiCssBaseline: {
            styleOverrides: {
                '*::-webkit-scrollbar': { width: 10, height: 10 },
                '*::-webkit-scrollbar-thumb': {
                    backgroundColor: light ? slate[300] : slate[600],
                    borderRadius: 5,
                    border: `2px solid ${light ? slate[50] : slate[900]}`,
                },
                '*::-webkit-scrollbar-track': { background: 'transparent' },
            },
        },

        // --- Density defaults: compact controls everywhere -------------------
        MuiButton: {
            defaultProps: { size: 'small', disableElevation: true },
            styleOverrides: {
                root: { fontWeight: 600 },
            },
        },
        MuiIconButton: { defaultProps: { size: 'small' } },
        MuiTextField: { defaultProps: { size: 'small' } },
        MuiFormControl: { defaultProps: { size: 'small' } },
        MuiSelect: { defaultProps: { size: 'small' } },
        MuiAutocomplete: { defaultProps: { size: 'small' } },
        MuiCheckbox: { defaultProps: { size: 'small' }, styleOverrides: { root: { padding: 5 } } },
        MuiRadio: { defaultProps: { size: 'small' }, styleOverrides: { root: { padding: 5 } } },
        // Dense tool UI: 13 px labels and ~33 px small inputs (MUI's small is 40 px)
        MuiFormControlLabel: { styleOverrides: { label: { fontSize: '0.8125rem' } } },
        MuiInputBase: { styleOverrides: { inputSizeSmall: { fontSize: '0.8125rem' } } },
        MuiOutlinedInput: { styleOverrides: { inputSizeSmall: { paddingTop: 6.5, paddingBottom: 6.5 } } },
        MuiInputLabel: {
            styleOverrides: {
                sizeSmall: { fontSize: '0.8125rem', '&:not(.MuiInputLabel-shrink)': { transform: 'translate(14px, 7px) scale(1)' } },
            },
        },
        MuiSwitch: { defaultProps: { size: 'small' } },
        MuiToggleButtonGroup: { defaultProps: { size: 'small' } },
        MuiToggleButton: {
            styleOverrides: {
                root: { textTransform: 'none', paddingTop: 4, paddingBottom: 4 },
            },
        },
        MuiChip: {
            defaultProps: { size: 'small' },
            styleOverrides: {
                root: { fontWeight: 500, borderRadius: 4 },
            },
        },
        MuiTable: { defaultProps: { size: 'small' } },
        MuiTableCell: {
            styleOverrides: {
                root: { padding: '6px 12px', borderColor: divider },
                head: {
                    fontWeight: 600,
                    backgroundColor: light ? slate[50] : slate[800],
                },
            },
        },
        MuiList: { defaultProps: { dense: true } },
        MuiMenuItem: { defaultProps: { dense: true } },

        // --- Flat bordered surfaces ------------------------------------------
        MuiPaper: {
            defaultProps: { variant: 'outlined' },
            styleOverrides: {
                root: { backgroundImage: 'none' },
            },
        },
        MuiMenu: {
            styleOverrides: {
                paper: {
                    border: `1px solid ${divider}`,
                    boxShadow: floatShadow,
                },
            },
        },
        MuiPopover: {
            styleOverrides: {
                paper: {
                    border: `1px solid ${divider}`,
                    boxShadow: floatShadow,
                },
            },
        },
        MuiDialog: {
            styleOverrides: {
                paper: {
                    borderRadius: 8,
                    border: `1px solid ${divider}`,
                    boxShadow: floatShadow,
                    backgroundImage: 'none',
                },
            },
        },
        MuiDialogTitle: {
            styleOverrides: {
                root: { fontSize: '0.9375rem', fontWeight: 600, paddingBottom: 8 },
            },
        },

        // --- Chrome ------------------------------------------------------------
        MuiAppBar: {
            defaultProps: { color: 'default', elevation: 0 },
            styleOverrides: {
                root: {
                    backgroundColor: light ? '#FFFFFF' : slate[950],
                    color: light ? slate[900] : slate[200],
                    borderBottom: `1px solid ${divider}`,
                    backgroundImage: 'none',
                },
            },
        },
        MuiDrawer: {
            styleOverrides: {
                paper: {
                    borderRight: `1px solid ${divider}`,
                    backgroundColor: light ? slate[50] : slate[900],
                    backgroundImage: 'none',
                },
            },
        },
        MuiListItemButton: {
            styleOverrides: {
                root: {
                    borderRadius: 6,
                    '&.Mui-selected': {
                        color: light ? '#0F766E' : '#2DD4BF',
                        '& .MuiListItemIcon-root': { color: 'inherit' },
                    },
                },
            },
        },
        MuiListItemIcon: {
            styleOverrides: {
                root: { minWidth: 36 },
            },
        },

        // --- Navigation & feedback ----------------------------------------------
        MuiTabs: {
            styleOverrides: {
                root: { minHeight: 40 },
                indicator: { height: 2 },
            },
        },
        MuiTab: {
            styleOverrides: {
                root: {
                    textTransform: 'none',
                    fontWeight: 500,
                    fontSize: '0.8125rem',
                    minHeight: 40,
                    paddingLeft: 12,
                    paddingRight: 12,
                },
            },
        },
        MuiTooltip: {
            defaultProps: { arrow: true },
            styleOverrides: {
                tooltip: {
                    fontSize: '0.75rem',
                    borderRadius: 4,
                    backgroundColor: light ? slate[700] : slate[200],
                    color: light ? '#FFFFFF' : slate[900],
                },
                arrow: {
                    color: light ? slate[700] : slate[200],
                },
            },
        },
        MuiAlert: {
            styleOverrides: {
                standard: { border: '1px solid' },
                standardSuccess: { borderColor: light ? '#BBE5C8' : 'rgba(52,211,153,0.4)' },
                standardWarning: { borderColor: light ? '#F5DFA8' : 'rgba(251,191,36,0.4)' },
                standardError: { borderColor: light ? '#F5C6C6' : 'rgba(248,113,113,0.4)' },
                standardInfo: { borderColor: light ? '#BAE0F5' : 'rgba(56,189,248,0.4)' },
            },
        },
    };
}
