/** dockview theme objects for the app (styled by DockThemeStyles). */
import { themeLight, themeDark, DockviewTheme } from 'dockview-react';

export const DOCK_EXTRA_CLASS = 'geochem-dock';

export function dockTheme(mode: 'light' | 'dark'): DockviewTheme {
    const base = mode === 'dark' ? themeDark : themeLight;
    return { ...base, name: `geochem-${mode}`, className: `${base.className} ${DOCK_EXTRA_CLASS}`, gap: 0 };
}
