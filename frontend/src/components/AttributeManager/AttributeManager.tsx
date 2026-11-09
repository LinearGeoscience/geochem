/**
 * Attribute Manager pane (Attribute Manager): Colour / Shape / Size /
 * Filter tabs, each a classification of the data (classify bar) and its
 * classes (class list), plus painted groups. Laid out for a ~360 px pane:
 * the class list takes the height, everything else folds away.
 */
import React from 'react';
import { Box, Chip, IconButton, Paper, Tab, Tabs, Tooltip, Typography } from '@mui/material';
import { Palette, Category, FormatSize, FilterList, Brush, Add, Visibility, VisibilityOff } from '@mui/icons-material';
import { useShallow } from 'zustand/react/shallow';
import { AttributeType, TAB_NAMES, useAttributeStore } from '../../store/attributeStore';
import { useAppStore } from '../../store/appStore';
import { ClassifyBar } from './ClassifyBar';
import { ClassList } from './ClassList';
import { DisplaySettings } from './DisplaySettings';
import { AttributeMoreMenu } from './AttributeMoreMenu';

const TAB_ICON: Record<AttributeType, React.ReactElement> = {
    color: <Palette sx={{ fontSize: 15 }} />,
    shape: <Category sx={{ fontSize: 15 }} />,
    size: <FormatSize sx={{ fontSize: 15 }} />,
    filter: <FilterList sx={{ fontSize: 15 }} />,
};

const TabLabel: React.FC<{ type: AttributeType; field: string | null }> = ({ type, field }) => {
    const alias = useAppStore(s => (field ? s.columns.find(c => c.name === field)?.alias : null));
    const shown = field ? alias || field : TAB_NAMES[type];
    return (
        <Tooltip title={field ? `${TAB_NAMES[type]} by ${shown}` : `${TAB_NAMES[type]}: no field`} enterDelay={400}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4, overflow: 'hidden', maxWidth: '100%' }}>
                {TAB_ICON[type]}
                <Typography noWrap sx={{ fontSize: '0.7rem', fontWeight: field ? 600 : 400 }}>{shown}</Typography>
            </Box>
        </Tooltip>
    );
};

const Footer: React.FC<{ tab: AttributeType }> = ({ tab }) => {
    const { paintMode, anyHidden, ids } = useAttributeStore(useShallow(s => ({
        paintMode: s.paintMode,
        anyHidden: s[tab].entries.some(e => !e.visible) || s.customEntries.some(e => !e.visible),
        ids: [...s[tab].entries, ...s.customEntries].map(e => e.id).join('|'),
    })));
    const store = () => useAttributeStore.getState();
    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, px: 0.5, height: 32, borderTop: '1px solid', borderColor: 'divider' }}>
            <Tooltip title={paintMode ? 'Stop painting' : 'Paint: lasso / box-select points in a plot to put them in the highlighted group'}>
                <IconButton size="small" color={paintMode ? 'success' : 'default'} onClick={() => store().setPaintMode(!paintMode)} aria-label="Paint mode">
                    <Brush fontSize="small" />
                </IconButton>
            </Tooltip>
            <Tooltip title="New painted group (and paint into it)">
                <IconButton size="small" onClick={() => { store().createEntryAndSetActive(tab); store().setPaintMode(true); }} aria-label="New group">
                    <Add fontSize="small" />
                </IconButton>
            </Tooltip>
            <Tooltip title={anyHidden ? 'Show every class' : 'Hide every class'}>
                <IconButton
                    size="small"
                    onClick={() => store().batchToggleVisibility(tab, ids.split('|').filter(Boolean), anyHidden)}
                    aria-label={anyHidden ? 'Show all classes' : 'Hide all classes'}
                >
                    {anyHidden ? <Visibility fontSize="small" /> : <VisibilityOff fontSize="small" />}
                </IconButton>
            </Tooltip>
            {paintMode && (
                <Chip size="small" color="success" label="Painting" onDelete={() => store().setPaintMode(false)} sx={{ height: 20, fontSize: '0.65rem', ml: 0.5 }} />
            )}
            <Box sx={{ flex: 1 }} />
            <AttributeMoreMenu tab={tab} />
        </Box>
    );
};

export const AttributeManager: React.FC = () => {
    const { activeTab, setActiveTab, color, shape, size, filter } = useAttributeStore(useShallow(s => ({
        activeTab: s.activeTab,
        setActiveTab: s.setActiveTab,
        color: s.color,
        shape: s.shape,
        size: s.size,
        filter: s.filter,
    })));
    const config = { color, shape, size, filter }[activeTab];

    return (
        <Paper square elevation={0} sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            <Tabs
                value={activeTab}
                onChange={(_, v: AttributeType) => setActiveTab(v)}
                variant="fullWidth"
                sx={{
                    minHeight: 32,
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    '& .MuiTab-root': { minHeight: 32, py: 0.25, px: 0.5, minWidth: 0, textTransform: 'none' },
                }}
            >
                {(['color', 'shape', 'size', 'filter'] as AttributeType[]).map(t => (
                    <Tab key={t} value={t} label={<TabLabel type={t} field={{ color, shape, size, filter }[t].field} />} aria-label={TAB_NAMES[t]} />
                ))}
            </Tabs>
            <ClassifyBar tab={activeTab} config={config} />
            <ClassList tab={activeTab} config={config} />
            <Footer tab={activeTab} />
            <DisplaySettings />
        </Paper>
    );
};
