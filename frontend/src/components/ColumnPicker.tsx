/**
 * Searchable, grouped column picker (Recent / Major oxides / Trace elements /
 * REE / Ratios / Coordinates / Transformed / Identifiers / Other) with unit
 * and role chips. Typing an element symbol finds its column ("Cu" finds
 * COPPER_PPM). Drop-in for the old plain <Select> column pickers.
 */
import React, { useMemo } from 'react';
import { Autocomplete, TextField, Box, Chip, Typography } from '@mui/material';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../store/appStore';
import { useUIStore } from '../store/uiStore';
import { buildColumnOptions, filterColumnOptions, ColumnFilter, ColumnOption } from '../utils/columnGroups';

export interface ColumnPickerProps {
    label: string;
    value: string;
    onChange: (name: string) => void;
    filter?: ColumnFilter;
    /** Offer an empty choice ("None"). */
    allowNone?: boolean;
    noneLabel?: string;
    /** Restrict to the app-wide column filter (selected value always kept). */
    useColumnFilter?: boolean;
    /** Explicit column list (names) instead of the dataset's columns. */
    include?: string[];
    size?: 'small' | 'medium';
    minWidth?: number;
    fullWidth?: boolean;
    disabled?: boolean;
}

const NONE: ColumnOption = { name: '', label: 'None', group: 'Other', unit: null, role: null, element: null, oxide: null, numeric: true };

export const ColumnPicker: React.FC<ColumnPickerProps> = ({
    label, value, onChange, filter = 'numeric', allowNone = false, noneLabel = 'None',
    useColumnFilter = true, include, size = 'small', minWidth = 180, fullWidth, disabled,
}) => {
    const columns = useAppStore(s => s.columns);
    const filtered = useAppStore(useShallow(s => (useColumnFilter ? s.getFilteredColumns() : s.columns)));
    const mappings = useAppStore(s => s.geochemMappings);
    const recent = useUIStore(s => s.recentColumns);
    const pushRecent = useUIStore(s => s.pushRecentColumn);

    const options = useMemo(() => {
        let pool = filtered;
        if (include) { const set = new Set(include); pool = columns.filter(c => set.has(c.name)); }
        // Keep the current value visible even when the column filter hides it
        if (value && !pool.some(c => c.name === value)) {
            const cur = columns.find(c => c.name === value);
            if (cur) pool = [...pool, cur];
        }
        const live = new Set(pool.map(c => c.name));
        const opts = buildColumnOptions(pool, mappings, filter, recent.filter(n => live.has(n)));
        return allowNone ? [{ ...NONE, label: noneLabel }, ...opts] : opts;
    }, [filtered, columns, include, value, mappings, filter, recent, allowNone, noneLabel]);

    const selected = options.find(o => o.name === value) ?? null;

    return (
        <Autocomplete<ColumnOption, false, boolean>
            size={size}
            options={options}
            value={selected}
            disabled={disabled}
            disableClearable={!allowNone}
            fullWidth={fullWidth}
            sx={{ minWidth, ...(fullWidth ? {} : { maxWidth: 320 }) }}
            groupBy={o => (o.name === '' ? ' ' : o.group)}
            getOptionLabel={o => o.label}
            isOptionEqualToValue={(a, b) => a.name === b.name}
            filterOptions={(opts, { inputValue }) => {
                const none = opts.filter(o => o.name === '');
                return [...none, ...filterColumnOptions(opts.filter(o => o.name !== ''), inputValue)];
            }}
            onChange={(_, o) => {
                const name = o?.name ?? '';
                if (name) pushRecent(name);
                onChange(name);
            }}
            renderOption={(props, o) => {
                const { key, ...rest } = props as React.HTMLAttributes<HTMLLIElement> & { key: string };
                return (
                    <Box component="li" key={key} {...rest} sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}>
                        <Typography variant="body2" noWrap sx={{ flex: 1, fontStyle: o.name === '' ? 'italic' : undefined }}>{o.label}</Typography>
                        {o.label !== o.name && o.name !== '' && <Typography variant="caption" color="text.secondary" noWrap>{o.name}</Typography>}
                        {o.unit && <Chip label={o.unit} size="small" variant="outlined" sx={{ height: 18, fontSize: 11 }} />}
                        {o.role && <Chip label={o.role} size="small" color="info" variant="outlined" sx={{ height: 18, fontSize: 11 }} />}
                    </Box>
                );
            }}
            renderInput={params => <TextField {...params} label={label} placeholder="Search…" />}
        />
    );
};

export default ColumnPicker;
