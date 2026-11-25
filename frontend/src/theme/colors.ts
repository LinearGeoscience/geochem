/**
 * GeoChem design tokens — slate + teal (UI Refresh R1).
 *
 * The ONLY sanctioned source for colors outside MUI palette tokens.
 * Prefer theme tokens in sx ('divider', 'text.secondary', 'primary.main');
 * import from here only where a literal is unavoidable (style objects,
 * Plotly templates, canvas).
 */

// Cool slate neutral ramp
export const slate = {
    50: '#F8FAFC',
    100: '#F1F5F9',
    200: '#E2E8F0',
    300: '#CBD5E1',
    400: '#94A3B8',
    500: '#64748B',
    600: '#475569',
    700: '#334155',
    800: '#1E293B',
    900: '#0F172A',
    950: '#0B1120',
} as const;

// Teal accent ramp
export const teal = {
    300: '#5EEAD4',
    400: '#2DD4BF',
    500: '#14B8A6',
    600: '#0D9488',
    700: '#0F766E',
    800: '#115E59',
    900: '#134E4A',
} as const;

// Semantic (light mode mains; dark variants live in the palette builder)
export const semantic = {
    successLight: '#15803D',
    successDark: '#34D399',
    warningLight: '#B45309',
    warningDark: '#FBBF24',
    errorLight: '#B91C1C',
    errorDark: '#F87171',
    infoLight: '#0369A1',
    infoDark: '#38BDF8',
} as const;

// RESERVED: a categorical chart palette (layout.colorway) is deliberately NOT
// defined yet — trace colors are data encoding across 30 chart components.
// When adding one, it MUST pass the dataviz palette validator
// (scripts/validate_palette.js: lightness band, chroma floor, CVD separation,
// contrast against BOTH chart surfaces) before shipping.
// export const chartCategorical: string[] = [];
