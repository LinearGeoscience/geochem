/** "Group by" + optional "and" column (e.g. sample medium x lab method), shared by the Combine surveys tabs. */
import React from 'react';
import { ListSubheader, MenuItem, Stack, TextField } from '@mui/material';
import { KIND_LABEL, type GroupOption } from './surveyColumns';

const menu = (options: GroupOption[], exclude: string) => {
    const items: React.ReactNode[] = [];
    let kind: GroupOption['kind'] | null = null;
    for (const o of options) {
        if (o.name === exclude) continue;
        if (o.kind !== kind) {
            kind = o.kind;
            items.push(<ListSubheader key={`h-${kind}`}>{KIND_LABEL[kind]}</ListSubheader>);
        }
        items.push(<MenuItem key={o.name} value={o.name}>{o.name} ({o.values.toLocaleString()} values)</MenuItem>);
    }
    return items;
};

export const GroupByFields: React.FC<{
    options: GroupOption[];
    value: string[];
    onChange: (cols: string[]) => void;
    help?: string;
}> = ({ options, value, onChange, help }) => {
    const [first = '', second = ''] = value;
    const set = (a: string, b: string) => onChange([a, b].filter(Boolean));
    return (
        <Stack direction="row" spacing={1.5} alignItems="flex-start" flexWrap="wrap" useFlexGap>
            <TextField select size="small" label="Group by" value={first} onChange={e => set(e.target.value, second === e.target.value ? '' : second)}
                sx={{ minWidth: 260 }} helperText={help}>
                {menu(options, '')}
            </TextField>
            <TextField select size="small" label="and (optional)" value={second} onChange={e => set(first, e.target.value)}
                sx={{ minWidth: 220 }} disabled={!first}>
                <MenuItem value="">(none)</MenuItem>
                {menu(options, first)}
            </TextField>
        </Stack>
    );
};
