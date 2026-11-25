/**
 * The tabs an editor in the properties is laid out under, and the parts they
 * show (Phases 209-210). A part that is not shown stays in the page: what is
 * typed or dragged in it is not lost by looking at another tab.
 */
import React from 'react';
import { Box, Tab, Tabs, Tooltip } from '@mui/material';

interface BarProps<T extends string> {
    tabs: readonly T[];
    /** What each is called, and what is found under it */
    names: Record<T, { label: string; tip: string }>;
    value: T;
    onChange: (tab: T) => void;
    /** What the tabs are of: their accessible name */
    label: string;
}

export function EditorTabBar<T extends string>({ tabs, names, value, onChange, label }: BarProps<T>): React.ReactElement {
    return (
        <Tabs
            value={value} onChange={(_, v: T) => onChange(v)} aria-label={label}
            // (Each tab as wide as its word, the room left over shared out: equal widths cut the longer words off)
            sx={{ minHeight: 32, mt: 0.75, mb: 0.5, borderBottom: 1, borderColor: 'divider', '& .MuiTab-root': { flex: '1 1 auto', maxWidth: 'none', minHeight: 32, minWidth: 0, px: 0.5, py: 0, textTransform: 'none', fontSize: 13, whiteSpace: 'nowrap' } }}
        >
            {tabs.map(k => (
                // (The tip describes the tab: its name stays the word on it)
                <Tab key={k} value={k} data-tab={k} label={<Tooltip describeChild title={names[k].tip} enterDelay={600} placement="top"><span>{names[k].label}</span></Tooltip>} />
            ))}
        </Tabs>
    );
}

/**
 * A part of an editor. Under tabs it is shown when its tab is open, and kept in the page when it is not; with no tabs
 * (`open` is 'all') every part is shown, one under the other.
 */
export const EditorPart: React.FC<{ tab: string; open: string; children: React.ReactNode }> = ({ tab, open, children }) => (
    <Box data-tab-panel={tab} role={open === 'all' ? undefined : 'tabpanel'} hidden={open !== 'all' && open !== tab}>{children}</Box>
);
