/**
 * Typography scale — Inter (UI Refresh R1).
 *
 * Conventions (enforced socially, applied via variants):
 *   h4        = THE page-title variant (<Typography variant="h4" component="h1">)
 *   h5        = card/panel titles
 *   h6        = dialog titles
 *   subtitle2 = table headers, field-group labels
 *   overline  = section-group labels (analysis nav, popover sections)
 *   body1 at 14px is the app-wide densifier — the whole UI reads "compact pro tool".
 */
import type { ThemeOptions } from '@mui/material/styles';

export const FONT_FAMILY =
    "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export const typography: ThemeOptions['typography'] = {
    fontFamily: FONT_FAMILY,
    h1: { fontSize: '2rem', lineHeight: 1.25, fontWeight: 700, letterSpacing: '-0.02em' },
    h2: { fontSize: '1.5rem', lineHeight: 1.3, fontWeight: 600, letterSpacing: '-0.01em' },
    h3: { fontSize: '1.25rem', lineHeight: 1.35, fontWeight: 600 },
    h4: { fontSize: '1.125rem', lineHeight: 1.4, fontWeight: 600 },
    h5: { fontSize: '1rem', lineHeight: 1.5, fontWeight: 600 },
    h6: { fontSize: '0.9375rem', lineHeight: 1.5, fontWeight: 600 },
    subtitle1: { fontSize: '0.9375rem', lineHeight: 1.5, fontWeight: 500 },
    subtitle2: { fontSize: '0.8125rem', lineHeight: 1.5, fontWeight: 600 },
    body1: { fontSize: '0.875rem', lineHeight: 1.55 },
    body2: { fontSize: '0.8125rem', lineHeight: 1.5 },
    button: { fontSize: '0.8125rem', fontWeight: 600, textTransform: 'none' },
    caption: { fontSize: '0.75rem', lineHeight: 1.4 },
    overline: { fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' },
};
