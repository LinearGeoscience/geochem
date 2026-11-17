/**
 * How the active tab is classified: one summary line ("Au_ppm · Jenks · 6
 * classes") that expands to the field / method / classes / palette controls
 * and, for numeric classes, the value histogram with draggable breaks.
 */
import React from 'react';
import { Box, Collapse, IconButton, Typography } from '@mui/material';
import { ExpandMore, ExpandLess } from '@mui/icons-material';
import { AttributeConfig as Cfg, AttributeType, TAB_NAMES } from '../../store/attributeStore';
import { useAppStore, useAnalyticalStore } from '../../store/appStore';
import { useUIStore } from '../../store/uiStore';
import { METHOD_LABELS } from '../../utils/attributeClassify';
import { AttributeConfig } from './AttributeConfig';
import { BreakHistogram } from './BreakHistogram';

export const ClassifyBar: React.FC<{ tab: AttributeType; config: Cfg }> = ({ tab, config }) => {
    const open = useUIStore(s => s.classifyOpen);
    const setOpen = useUIStore(s => s.setClassifyOpen);
    const columns = useAppStore(s => s.columns);
    const analytical = useAnalyticalStore();

    const alias = (n: string) => columns.find(c => c.name === n)?.alias || n;
    const fields = config.field ? [config.field, ...(config.additionalFields ?? [])].map(alias).join(' + ') : null;
    const classes = config.entries.filter(e => !e.isDefault).length;
    const method = config.breaksEdited ? 'Custom breaks' : METHOD_LABELS[config.method];
    const summary = fields
        ? `${fields} · ${method} · ${classes} ${classes === 1 ? 'class' : 'classes'}`
        : `No ${TAB_NAMES[tab].toLowerCase()} field`;
    const hasRanges = config.entries.some(e => e.type === 'range');

    return (
        <Box sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
            <Box
                onClick={() => setOpen(!open)}
                sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, height: 26, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
            >
                <Typography variant="caption" noWrap title={summary} sx={{ flex: 1, minWidth: 0, color: fields ? 'text.primary' : 'text.secondary' }}>
                    {summary}
                </Typography>
                <IconButton size="small" sx={{ p: 0 }} aria-label={open ? 'Hide classification settings' : 'Show classification settings'}>
                    {open ? <ExpandLess sx={{ fontSize: 18 }} /> : <ExpandMore sx={{ fontSize: 18 }} />}
                </IconButton>
            </Box>
            <Collapse in={open} unmountOnExit>
                <AttributeConfig tab={tab} config={config} />
                {hasRanges && config.field && (
                    <Box sx={{ px: 1, pb: 0.75 }}>
                        <BreakHistogram tab={tab} config={config} column={analytical.columns.get(config.field)} />
                    </Box>
                )}
            </Collapse>
        </Box>
    );
};
