import React, { useMemo, useState, useCallback } from 'react';
import {
  Box, Button, Checkbox, Chip, Collapse, IconButton, InputAdornment, MenuItem,
  Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import ExpandMore from '@mui/icons-material/ExpandMore';
import Search from '@mui/icons-material/Search';
import { ColumnGeochemMapping, CustomAssociation } from '../types/associations';
import { categorizeColumns } from '../utils/categorizeColumnsForSelection';
import { lowCoverageThreshold } from '../utils/compositionCoverage';

interface GroupedElementSelectorProps {
  numericColumns: string[];
  geochemMappings: ColumnGeochemMapping[];
  selectedColumns: string[];
  onSelectionChange: (columns: string[]) => void;
  customAssociations?: CustomAssociation[];
  /** Max height of the scrolling group list (CSS length) */
  maxHeight?: string;
  label?: string;
  /** Fraction of rows with a value, per column: shown on each chip */
  coverage?: Map<string, number>;
  /** Column -> the column holding the same assay (si_pct -> sio2_pct): flagged, left out of "All elements" */
  duplicateOf?: Map<string, string>;
  /** Shown under the list (e.g. complete-row count) */
  summary?: React.ReactNode;
}

type SectionKey = 'majorOxides' | 'traceElements' | 'ree' | 'otherNumeric';
const SECTIONS: { key: SectionKey; title: string; short: string }[] = [
  { key: 'majorOxides', title: 'Major oxides', short: 'Majors' },
  { key: 'traceElements', title: 'Trace elements', short: 'Traces' },
  { key: 'ree', title: 'Rare earth elements', short: 'REE' },
  { key: 'otherNumeric', title: 'Other numeric (not elements: depths, LOI, scores...)', short: 'Other' },
];

/**
 * Element picker for compositional tools: columns grouped as major oxides /
 * trace elements / REE (atomic-number order) / other, shown as toggle chips
 * with a tick-all per group, a search box and quick group buttons. "Other
 * numeric" (From/To, coordinates, scores) starts collapsed and is not part
 * of "All elements".
 */
export const GroupedElementSelector: React.FC<GroupedElementSelectorProps> = ({
  numericColumns,
  geochemMappings,
  selectedColumns,
  onSelectionChange,
  customAssociations,
  maxHeight = '360px',
  label = 'Elements',
  coverage,
  duplicateOf,
  summary,
}) => {
  const [collapsed, setCollapsed] = useState<Set<SectionKey>>(new Set(['otherNumeric']));
  const [query, setQuery] = useState('');

  const categorized = useMemo(
    () => categorizeColumns(numericColumns, geochemMappings),
    [numericColumns, geochemMappings],
  );
  const selected = useMemo(() => new Set(selectedColumns), [selectedColumns]);

  const allElementColumns = useMemo(
    () => [...categorized.majorOxides, ...categorized.traceElements, ...categorized.ree],
    [categorized],
  );
  // One column per element: the duplicate forms are left out of the quick picks
  const notDuplicate = useCallback((cols: string[]) => cols.filter(c => !duplicateOf?.has(c)), [duplicateOf]);
  const allElementsOnce = useMemo(() => notDuplicate(allElementColumns), [notDuplicate, allElementColumns]);
  const lowCoverage = useMemo(
    () => (coverage ? lowCoverageThreshold(allElementsOnce.map(c => coverage.get(c) ?? 0)) : 0),
    [coverage, allElementsOnce],
  );

  const q = query.trim().toLowerCase();
  const visible = useCallback(
    (cols: string[]) => (q ? cols.filter(c => c.toLowerCase().includes(q)) : cols),
    [q],
  );

  // Keep the order of the groups when adding, so downstream tools see
  // majors -> traces -> REE rather than click order.
  const order = useMemo(
    () => new Map([...allElementColumns, ...categorized.otherNumeric].map((c, i) => [c, i])),
    [allElementColumns, categorized.otherNumeric],
  );
  const commit = useCallback((next: Set<string>) => {
    onSelectionChange([...next].sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9)));
  }, [onSelectionChange, order]);

  const toggleColumn = (col: string) => {
    const next = new Set(selected);
    if (next.has(col)) next.delete(col); else next.add(col);
    commit(next);
  };

  const setGroup = (cols: string[], on: boolean) => {
    const next = new Set(selected);
    cols.forEach(c => (on ? next.add(c) : next.delete(c)));
    commit(next);
  };

  const toggleCollapsed = (key: SectionKey) => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const loadAssociation = (id: string) => {
    const assoc = customAssociations?.find(a => a.id === id);
    if (assoc) onSelectionChange(assoc.elements.filter(el => numericColumns.includes(el)));
  };

  const total = numericColumns.length;

  return (
    <Box sx={{ mb: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1, flexWrap: 'wrap', rowGap: 1 }}>
        <Typography variant="subtitle2" sx={{ mr: 1 }}>
          {label}: {selectedColumns.length} of {total} selected
        </Typography>
        <Box sx={{ flex: 1 }} />
        <TextField
          size="small"
          placeholder="Filter columns"
          value={query}
          onChange={e => setQuery(e.target.value)}
          sx={{ width: 200 }}
          InputProps={{ startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> }}
        />
      </Stack>

      <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: 'wrap', rowGap: 1 }} alignItems="center">
        <Tooltip title={duplicateOf?.size ? `Each element once: ${allElementColumns.length - allElementsOnce.length} columns that repeat another column's assay in a different unit or form are left out` : ''}>
          <span>
            <Button size="small" variant="outlined" onClick={() => onSelectionChange(allElementsOnce)}
              disabled={allElementsOnce.length === 0}>
              All elements ({allElementsOnce.length})
            </Button>
          </span>
        </Tooltip>
        {SECTIONS.slice(0, 3).map(s => categorized[s.key].length > 0 && (
          <Button key={s.key} size="small" variant="text" onClick={() => onSelectionChange(notDuplicate(categorized[s.key]))}>
            Only {s.short}
          </Button>
        ))}
        <Button size="small" variant="text" color="inherit" onClick={() => onSelectionChange([])}
          disabled={selectedColumns.length === 0}>
          Clear
        </Button>
        {customAssociations && customAssociations.length > 0 && (
          <TextField
            select size="small" value="" label="Load PCA association"
            onChange={e => loadAssociation(e.target.value)}
            sx={{ minWidth: 220 }}
          >
            {customAssociations.map(a => (
              <MenuItem key={a.id} value={a.id}>
                {a.name} ({a.elementSymbols.join(', ')}) – PC{a.pcNumber} {a.side}
              </MenuItem>
            ))}
          </TextField>
        )}
      </Stack>

      <Box sx={{ maxHeight, overflow: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}>
        {SECTIONS.map(({ key, title }) => {
          const cols = categorized[key];
          if (cols.length === 0) return null;
          const shown = visible(cols);
          if (q && shown.length === 0) return null;
          const nSel = cols.filter(c => selected.has(c)).length;
          const isOpen = !collapsed.has(key) || !!q;
          return (
            <Box key={key} sx={{ '&:not(:last-of-type)': { borderBottom: 1, borderColor: 'divider' } }}>
              <Stack
                direction="row" alignItems="center"
                sx={{ px: 0.5, bgcolor: 'action.hover', cursor: 'pointer', userSelect: 'none' }}
                onClick={() => toggleCollapsed(key)}
              >
                <IconButton size="small" aria-label={isOpen ? `Collapse ${title}` : `Expand ${title}`}>
                  <ExpandMore fontSize="small" sx={{ transform: isOpen ? 'none' : 'rotate(-90deg)', transition: 'transform .15s' }} />
                </IconButton>
                <Checkbox
                  size="small"
                  checked={nSel === cols.length}
                  indeterminate={nSel > 0 && nSel < cols.length}
                  onClick={e => e.stopPropagation()}
                  onChange={() => setGroup(cols, nSel < cols.length)}
                  inputProps={{ 'aria-label': `Select all ${title}` }}
                />
                <Typography variant="body2" sx={{ fontWeight: 600, flex: 1 }}>{title}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ pr: 1.5 }}>
                  {nSel}/{cols.length}
                </Typography>
              </Stack>
              <Collapse in={isOpen} unmountOnExit>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, p: 1 }}>
                  {shown.map(col => {
                    const on = selected.has(col);
                    const cov = coverage?.get(col);
                    const dupOf = duplicateOf?.get(col);
                    const low = cov !== undefined && key !== 'otherNumeric' && cov < lowCoverage;
                    const tip = [
                      cov !== undefined ? `${col}: values in ${(cov * 100).toFixed(cov < 0.1 ? 1 : 0)}% of rows` : col,
                      low ? 'Low coverage: every row without it is left out of the transform.' : '',
                      dupOf ? `Same assay as ${dupOf} in another unit or form. Selecting both counts this element twice.` : '',
                    ].filter(Boolean).join(' ');
                    return (
                      <Tooltip key={col} title={tip} enterDelay={400}>
                        <Chip
                          label={
                            <span>
                              {col}
                              {cov !== undefined && (
                                <Box component="span" sx={{ ml: 0.75, opacity: 0.75, fontSize: '0.85em' }}>
                                  {cov >= 0.995 ? '100%' : `${(cov * 100).toFixed(cov < 0.1 ? 1 : 0)}%`}
                                </Box>
                              )}
                              {dupOf && <Box component="span" sx={{ ml: 0.5, fontSize: '0.85em' }}>= {dupOf}</Box>}
                            </span>
                          }
                          size="small"
                          clickable
                          color={on ? (dupOf || low ? 'warning' : 'primary') : 'default'}
                          variant={on ? 'filled' : 'outlined'}
                          onClick={() => toggleColumn(col)}
                          aria-pressed={on}
                          sx={{
                            ...(dupOf ? { borderStyle: 'dashed' } : {}),
                            ...(on ? {} : {
                              color: low || dupOf ? 'text.disabled' : 'text.secondary',
                              '&:hover': { bgcolor: t => alpha(t.palette.primary.main, 0.08) },
                            }),
                          }}
                        />
                      </Tooltip>
                    );
                  })}
                </Box>
              </Collapse>
            </Box>
          );
        })}
        {q && SECTIONS.every(s => visible(categorized[s.key]).length === 0) && (
          <Typography variant="body2" color="text.secondary" sx={{ p: 1.5 }}>No columns match "{query}"</Typography>
        )}
      </Box>
      {summary && <Box sx={{ mt: 1 }}>{summary}</Box>}
    </Box>
  );
};
