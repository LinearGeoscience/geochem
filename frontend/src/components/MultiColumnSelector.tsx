import React, { useRef, useMemo } from 'react';
import { Autocomplete, TextField, Checkbox, Button, Box } from '@mui/material';
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank';
import CheckBoxIcon from '@mui/icons-material/CheckBox';

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
}

export const MultiColumnSelector: React.FC<MultiColumnSelectorProps> = ({
    columns,
    selectedColumns,
    onChange,
    label = "Select Columns"
}) => {
    const lastClickedIndexRef = useRef<number | null>(null);

    // Sort columns by priority (lower = higher priority, undefined = middle)
    const sortedColumns = useMemo(() => {
        return [...columns].sort((a, b) => {
            const prioA = a.priority ?? 10;
            const prioB = b.priority ?? 10;
            if (prioA !== prioB) return prioA - prioB;
            // Secondary sort by name
            return a.name.localeCompare(b.name);
        });
    }, [columns]);

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
                getOptionLabel={(option) => option.alias || option.name}
                value={sortedColumns.filter(c => selectedColumns.includes(c.name))}
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
                            {option.alias || option.name}
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
            </Box>
        </Box>
    );
};
