import React, { useRef, useMemo, useState } from 'react';
import { Autocomplete, TextField, Checkbox, Button, Box, Chip, Typography, Menu, MenuItem, ListItemText } from '@mui/material';
import History from '@mui/icons-material/History';
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import { useAppStore } from '../store/appStore';
import { buildColumnOptions, filterColumnOptions, ColumnOption as GroupedOption } from '../utils/columnGroups';
import { selectionLabel, useVariableSelectionStore } from '../store/variableSelectionStore';

const icon = <CheckBoxOutlineBlankIcon fontSize="small" />;
const checkedIcon = <CheckBoxIcon fontSize="small" />;

interface ColumnOption {
    name: string;
    alias: string | null;
    priority?: number;
}

interface MultiColumnSelectorProps {
    columns: ColumnOption[];
    selectedColumns: string[];
    onChange: (selected: string[]) => void;
    label?: string;
    allColumns?: ColumnOption[];
}

export const MultiColumnSelector: React.FC<MultiColumnSelectorProps> = ({
    columns,
    selectedColumns,
    onChange,
    label = "Select Columns",
    allColumns,
}) => {
    const lastClickedIndexRef = useRef<number | null>(null);

    // Merge filtered columns with any selected columns from allColumns that aren't in the current filter
    const mergedColumns = useMemo(() => {
        if (!allColumns || allColumns.length === 0) return columns;
        const filteredNames = new Set(columns.map(c => c.name));
        const extras = allColumns.filter(c => selectedColumns.includes(c.name) && !filteredNames.has(c.name));
        return extras.length > 0 ? [...columns, ...extras] : columns;
    }, [columns, allColumns, selectedColumns]);

    // Group (Major oxides / Trace elements / REE / …) then priority, name
    const storeColumns = useAppStore(s => s.columns);
    const mappings = useAppStore(s => s.geochemMappings);
    const { sortedColumns, meta } = useMemo(() => {
        const info = new Map(storeColumns.map(c => [c.name, c]));
        const pool = mergedColumns.map(c => ({ type: 'numeric', role: null, ...info.get(c.name), name: c.name, alias: c.alias, priority: c.priority }));
        const grouped = buildColumnOptions(pool, mappings, 'all');
        const byName = new Map(mergedColumns.map(c => [c.name, c]));
        return {
            sortedColumns: grouped.map(g => byName.get(g.name)!).filter(Boolean),
            meta: new Map<string, GroupedOption>(grouped.map(g => [g.name, g])),
        };
    }, [mergedColumns, storeColumns, mappings]);

    // Selected chips keep the order they were picked in (keeps variable order)
    const selectedOptions = useMemo(() => {
        const byName = new Map(sortedColumns.map(c => [c.name, c]));
        return selectedColumns.map(n => byName.get(n)).filter((c): c is ColumnOption => !!c);
    }, [sortedColumns, selectedColumns]);

    // History: selections of 2+ columns are recorded when the list closes
    const history = useVariableSelectionStore(s => s.history);
    const pushHistory = useVariableSelectionStore(s => s.push);
    const [historyAnchor, setHistoryAnchor] = useState<HTMLElement | null>(null);
    const available = useMemo(() => new Set(mergedColumns.map(c => c.name)), [mergedColumns]);
    const usableHistory = useMemo(
        () => history.map((h, i) => ({ h, i, cols: h.columns.filter(c => available.has(c)) })).filter(x => x.cols.length >= 2),
        [history, available],
    );

    const handleSelectAll = () => {
        onChange(columns.map(c => c.name));
    };

    const handleClearAll = () => {
        onChange([]);
        lastClickedIndexRef.current = null;
    };

    const handleOptionClick = (event: React.MouseEvent, option: ColumnOption, optionIndex: number) => {
        const isSelected = selectedColumns.includes(option.name);

        if (event.shiftKey && lastClickedIndexRef.current !== null) {
            // Shift+Click: Select range (using sortedColumns for visual order)
            const start = Math.min(lastClickedIndexRef.current, optionIndex);
            const end = Math.max(lastClickedIndexRef.current, optionIndex);
            const rangeColumns = sortedColumns.slice(start, end + 1).map(c => c.name);

            // Add range to selection (union)
            const newSelection = Array.from(new Set([...selectedColumns, ...rangeColumns]));
            onChange(newSelection);
        } else {
            // Normal click: Toggle single item
            if (isSelected) {
                onChange(selectedColumns.filter(c => c !== option.name));
            } else {
                onChange([...selectedColumns, option.name]);
            }
        }

        lastClickedIndexRef.current = optionIndex;
    };

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Autocomplete
                multiple
                options={sortedColumns}
                disableCloseOnSelect
                // Long selections collapse to "+N" until the field is focused
                limitTags={8}
                ChipProps={{ size: 'small' }}
                getOptionLabel={(option) => option.alias || option.name}
                groupBy={(option) => meta.get(option.name)?.group ?? 'Other'}
                filterOptions={(opts, { inputValue }) => {
                    const hits = new Set(filterColumnOptions(opts.map(o => meta.get(o.name)!).filter(Boolean), inputValue).map(o => o.name));
                    return opts.filter(o => hits.has(o.name));
                }}
                value={selectedOptions}
                onClose={() => pushHistory(selectedColumns)}
                onChange={(_, newValue) => {
                    onChange(newValue.map(v => v.name));
                }}
                renderOption={(props, option, { selected }) => {
                    const optionIndex = sortedColumns.findIndex(c => c.name === option.name);
                    return (
                        <li
                            {...props}
                            onClick={(event) => {
                                // Prevent default Autocomplete behavior
                                event.preventDefault();
                                handleOptionClick(event, option, optionIndex);
                            }}
                        >
                            <Checkbox
                                icon={icon}
                                checkedIcon={checkedIcon}
                                style={{ marginRight: 8 }}
                                checked={selected}
                            />
                            <Typography variant="body2" noWrap sx={{ flex: 1 }}>{option.alias || option.name}</Typography>
                            {meta.get(option.name)?.unit && <Chip label={meta.get(option.name)!.unit} size="small" variant="outlined" sx={{ height: 18, fontSize: 11, ml: 0.5 }} />}
                        </li>
                    );
                }}
                renderInput={(params) => (
                    <TextField {...params} label={label} placeholder="Search columns..." />
                )}
                sx={{ minWidth: 300, maxWidth: 600, flexGrow: 1 }}
            />
            <Box sx={{ display: 'flex', gap: 1 }}>
                <Button size="small" variant="outlined" onClick={handleSelectAll}>
                    Select All
                </Button>
                <Button size="small" variant="outlined" onClick={handleClearAll}>
                    Clear All
                </Button>
                <Button size="small" variant="outlined" startIcon={<History fontSize="small" />}
                    disabled={usableHistory.length === 0} onClick={e => setHistoryAnchor(e.currentTarget)}>
                    History
                </Button>
                <Menu anchorEl={historyAnchor} open={!!historyAnchor} onClose={() => setHistoryAnchor(null)}>
                    {usableHistory.map(({ h, i, cols }) => (
                        <MenuItem key={i} dense onClick={() => { onChange(cols); pushHistory(h.columns); setHistoryAnchor(null); }}>
                            <ListItemText
                                primary={selectionLabel(h)}
                                secondary={cols.length < h.columns.length ? `${h.columns.length - cols.length} not in this dataset` : undefined}
                                primaryTypographyProps={{ variant: 'body2', noWrap: true, sx: { maxWidth: 480 } }}
                            />
                        </MenuItem>
                    ))}
                </Menu>
            </Box>
        </Box>
    );
};
