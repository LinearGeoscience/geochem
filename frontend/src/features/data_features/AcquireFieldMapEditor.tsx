import React from 'react';
import {
    Alert, Autocomplete, Box, Button, Chip, CircularProgress, MenuItem, Paper, Table, TableBody, TableCell,
    TableContainer, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import { AutoFixHigh, TableRows } from '@mui/icons-material';
import type { CatalogObject, DetectResult, SampleRows } from '../../services/acquireApi';
import {
    AcquireProfile, AssayLayout, BdlWrite, DipConvention, FILTER_FIELDS, FILTER_LABELS, FilterField, PreferredRule,
    ROLE_LABELS, TableKey, formatRenames, parseRenames, roles, splitList, withObject, withRole,
} from '../../utils/acquireProfiles';

interface Props {
    profile: AcquireProfile;
    onChange: (p: AcquireProfile) => void;
    objects: CatalogObject[] | null;
    loadingObjects: boolean;
    detect: DetectResult | null;
    detecting: boolean;
    onDetect: () => void;
    canConnect: boolean;
    samples: Partial<Record<TableKey, SampleRows>>;
    sampling: TableKey | null;
    onSample: (table: TableKey) => void;
}

const TABLE_LABELS: Record<TableKey, string> = {
    collar: 'Collars', survey: 'Surveys', assay: 'Assays', samples: 'Samples (hole, from, to for each sample ID)',
};

function clone(p: AcquireProfile): AcquireProfile {
    return JSON.parse(JSON.stringify(p));
}

function Confidence({ value }: { value?: number }) {
    if (value === undefined) return null;
    const color = value >= 90 ? 'success' : value >= 60 ? 'warning' : 'default';
    return <Chip size="small" variant="outlined" color={color} label={`${Math.round(value)}%`} sx={{ ml: 1 }} />;
}

function ColumnPick({ label, value, columns, onChange, confidence, required, disabled }: {
    label: string; value: string; columns: string[]; onChange: (v: string) => void;
    confidence?: number; required?: boolean; disabled?: boolean;
}) {
    return (
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Autocomplete
                size="small" fullWidth disabled={disabled}
                options={columns}
                value={value || null}
                onChange={(_, v) => onChange(v ?? '')}
                renderInput={params => (
                    <TextField {...params} label={label + (required ? ' *' : '')}
                        error={!!required && !value} />
                )}
            />
            <Confidence value={value ? confidence : undefined} />
        </Box>
    );
}

function SampleTable({ sample }: { sample: SampleRows }) {
    if (!sample.rows.length) return <Typography variant="caption" color="text.secondary">No rows.</Typography>;
    return (
        <TableContainer sx={{ maxHeight: 220, mt: 1, border: 1, borderColor: 'divider', borderRadius: 1 }}>
            <Table size="small" stickyHeader>
                <TableHead>
                    <TableRow>{sample.columns.map(c => <TableCell key={c} sx={{ whiteSpace: 'nowrap' }}>{c}</TableCell>)}</TableRow>
                </TableHead>
                <TableBody>
                    {sample.rows.map((r, i) => (
                        <TableRow key={i}>
                            {sample.columns.map(c => (
                                <TableCell key={c} sx={{ whiteSpace: 'nowrap' }}>{r[c] === null || r[c] === undefined ? '' : String(r[c])}</TableCell>
                            ))}
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </TableContainer>
    );
}

/**
 * The field map of an Acquire connection profile: for collars, surveys and
 * assays, the table or view and the column holding each role, plus the
 * assay layout and rules, the filter columns and the dip convention.
 * Names only, never SQL; the backend checks every name against the database.
 */
export const AcquireFieldMapEditor: React.FC<Props> = (props) => {
    const { profile, onChange, objects, loadingObjects, detect, detecting, onDetect, canConnect, samples, sampling, onSample } = props;
    const fm = profile.field_map;
    const layout = fm.assay.layout;
    const conf = detect?.confidence ?? {};

    const objectOf = (table: TableKey) => {
        const spec = table === 'samples' ? fm.assay.samples : fm[table];
        if (!spec?.object || !objects) return null;
        const schema = (spec.schema || fm.schema || 'dbo').toLowerCase();
        return objects.find(o => o.name.toLowerCase() === spec.object.toLowerCase() && o.schema.toLowerCase() === schema) ?? null;
    };
    const columnsOf = (table: TableKey): string[] => {
        const o = objectOf(table);
        if (o) return o.columns;
        const spec = table === 'samples' ? fm.assay.samples : fm[table];
        return Object.values(spec?.columns ?? {}).filter(Boolean) as string[];
    };
    const label = (o: CatalogObject) => (o.schema.toLowerCase() === 'dbo' ? o.name : `${o.schema}.${o.name}`);

    const tableBlock = (table: TableKey) => {
        const spec = table === 'samples' ? fm.assay.samples : fm[table];
        const { required, optional } = table === 'assay' ? roles('assay', layout) : roles(table);
        const cols = columnsOf(table);
        const confKey = table === 'samples' ? 'samples' : table;
        const current = objectOf(table);
        return (
            <Paper variant="outlined" sx={{ p: 2 }} key={table}>
                <Typography variant="subtitle2" gutterBottom>{TABLE_LABELS[table]}</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                    <Autocomplete
                        size="small" fullWidth
                        options={objects ?? []}
                        loading={loadingObjects}
                        value={current}
                        getOptionLabel={label}
                        isOptionEqualToValue={(a, b) => a.schema === b.schema && a.name === b.name}
                        onChange={(_, o) => onChange(o ? withObject(profile, table, o.schema, o.name, o.columns)
                            : withObject(profile, table, fm.schema || 'dbo', '', []))}
                        renderInput={params => (
                            <TextField {...params} label="Table or view *" error={!spec?.object}
                                placeholder={spec?.object || ''}
                                helperText={!objects && spec?.object ? `${spec.object} (test the connection to list tables)` : ' '} />
                        )}
                    />
                    <Confidence value={spec?.object ? conf[`${confKey}.object`] : undefined} />
                    <Button size="small" startIcon={sampling === table ? <CircularProgress size={14} /> : <TableRows />}
                        disabled={!spec?.object || !canConnect || sampling !== null} onClick={() => onSample(table)}
                        sx={{ whiteSpace: 'nowrap', mb: 2.5 }}>
                        First 5 rows
                    </Button>
                </Box>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
                    {[...required, ...optional].map(role => (
                        <ColumnPick key={role} label={ROLE_LABELS[role] ?? role} required={required.includes(role)}
                            value={spec?.columns?.[role] ?? ''} columns={cols}
                            confidence={conf[`${confKey}.${role}`]}
                            onChange={v => onChange(withRole(profile, table, role, v))} />
                    ))}
                </Box>
                {samples[table] && <SampleTable sample={samples[table]!} />}
            </Paper>
        );
    };

    const update = (fn: (p: AcquireProfile) => void) => {
        const next = clone(profile);
        fn(next);
        onChange(next);
    };

    const assayCols = columnsOf('assay');
    const qaqcCols = columnsOf(layout === 'long_joined' ? 'samples' : 'assay');
    const collarCols = columnsOf('collar');
    const rules = fm.assay.column_rules ?? {};
    const pref = fm.assay.preferred ?? { rule: 'none' as PreferredRule, column: null };

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                <Button variant="outlined" startIcon={detecting ? <CircularProgress size={16} /> : <AutoFixHigh />}
                    disabled={!canConnect || detecting} onClick={onDetect}>
                    Detect fields
                </Button>
                <Typography variant="body2" color="text.secondary">
                    Looks through the database's tables and views and suggests the map below. Check each choice before saving.
                </Typography>
            </Box>
            {detect?.hints.length ? (
                <Alert severity="info">
                    {detect.hints.map((h, i) => <div key={i}>{h}</div>)}
                </Alert>
            ) : null}

            {tableBlock('collar')}
            {tableBlock('survey')}
            <Paper variant="outlined" sx={{ p: 2, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
                <Typography variant="subtitle2" sx={{ gridColumn: '1 / -1' }}>Survey rules</Typography>
                <TextField select size="small" label="Dip convention" value={fm.dip ?? 'negative_down'}
                    onChange={e => update(p => { p.field_map.dip = e.target.value as DipConvention; })}>
                    <MenuItem value="negative_down">Downward holes have negative dips</MenuItem>
                    <MenuItem value="positive_down">Downward holes have positive dips</MenuItem>
                </TextField>
                <ColumnPick label="Several readings at one depth: keep the lowest of" value={fm.survey.priority?.column ?? ''}
                    columns={columnsOf('survey')}
                    onChange={v => update(p => { p.field_map.survey.priority = v ? { column: v, keep: 'lowest' } : null; })} />
            </Paper>

            <TextField select size="small" label="Assay layout" value={layout}
                onChange={e => update(p => {
                    p.field_map.assay.layout = e.target.value as AssayLayout;
                    if (e.target.value === 'long_joined' && !p.field_map.assay.samples) p.field_map.assay.samples = { object: '', columns: {} };
                })}
                helperText="Wide: one row per sample interval, one column per analyte. Long: one row per result (element and value columns)."
            >
                <MenuItem value="wide">Wide (one column per analyte)</MenuItem>
                <MenuItem value="long">Long, one table (hole, from, to, element, value)</MenuItem>
                <MenuItem value="long_joined">Long, results joined to a samples table by sample ID</MenuItem>
            </TextField>
            {tableBlock('assay')}
            {layout === 'long_joined' && tableBlock('samples')}

            <Paper variant="outlined" sx={{ p: 2, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
                <Typography variant="subtitle2" sx={{ gridColumn: '1 / -1' }}>Assay rules</Typography>
                {layout !== 'wide' && (
                    <>
                        <TextField select size="small" label="Several results for one analyte" value={pref.rule}
                            onChange={e => update(p => {
                                const rule = e.target.value as PreferredRule;
                                p.field_map.assay.preferred = { rule, column: rule === 'lowest' || rule === 'highest' ? pref.column : null };
                            })}>
                            <MenuItem value="none">Stop the import (there shouldn't be any)</MenuItem>
                            <MenuItem value="lowest">Keep the lowest priority value</MenuItem>
                            <MenuItem value="highest">Keep the highest priority value</MenuItem>
                            <MenuItem value="first">Keep the first one</MenuItem>
                        </TextField>
                        <ColumnPick label="Priority column" value={pref.column ?? ''} columns={assayCols}
                            required={pref.rule === 'lowest' || pref.rule === 'highest'}
                            disabled={!(pref.rule === 'lowest' || pref.rule === 'highest')}
                            onChange={v => update(p => { p.field_map.assay.preferred = { rule: pref.rule, column: v || null }; })} />
                        <ColumnPick label="Below-detection flag column" value={fm.assay.bdl?.column ?? ''} columns={assayCols}
                            onChange={v => update(p => {
                                p.field_map.assay.bdl = v ? { column: v, values: fm.assay.bdl?.values ?? ['<'], write_as: fm.assay.bdl?.write_as ?? 'half' } : null;
                            })} />
                        <Box sx={{ display: 'flex', gap: 1 }}>
                            <TextField size="small" label="Flag values" disabled={!fm.assay.bdl}
                                value={(fm.assay.bdl?.values ?? []).join(', ')}
                                onChange={e => update(p => { if (p.field_map.assay.bdl) p.field_map.assay.bdl.values = splitList(e.target.value); })} />
                            <TextField select size="small" label="Write as" disabled={!fm.assay.bdl} sx={{ minWidth: 130 }}
                                value={fm.assay.bdl?.write_as ?? 'half'}
                                onChange={e => update(p => { if (p.field_map.assay.bdl) p.field_map.assay.bdl.write_as = e.target.value as BdlWrite; })}>
                                <MenuItem value="half">Half the value</MenuItem>
                                <MenuItem value="negative">Negative</MenuItem>
                                <MenuItem value="as_is">As stored</MenuItem>
                            </TextField>
                        </Box>
                    </>
                )}
                <ColumnPick label="QAQC column (leave out blanks, standards...)" value={fm.assay.qaqc?.column ?? ''} columns={qaqcCols}
                    onChange={v => update(p => { p.field_map.assay.qaqc = v ? { column: v, exclude: fm.assay.qaqc?.exclude ?? [] } : null; })} />
                <TextField size="small" label="QAQC values to leave out" disabled={!fm.assay.qaqc}
                    value={(fm.assay.qaqc?.exclude ?? []).join(', ')}
                    error={!!fm.assay.qaqc && !fm.assay.qaqc.exclude.length}
                    onChange={e => update(p => { if (p.field_map.assay.qaqc) p.field_map.assay.qaqc.exclude = splitList(e.target.value); })}
                    helperText="Separated by commas" />
                <TextField size="small" label="Drop columns" value={(rules.drop_columns ?? []).join(', ')}
                    onChange={e => update(p => { (p.field_map.assay.column_rules ??= {}).drop_columns = splitList(e.target.value); })} />
                <TextField size="small" label="Drop columns ending in" value={(rules.drop_suffixes ?? []).join(', ')}
                    onChange={e => update(p => { (p.field_map.assay.column_rules ??= {}).drop_suffixes = splitList(e.target.value); })} />
                <TextField size="small" label="Remove name endings" value={(rules.strip_suffixes ?? []).join(', ')}
                    onChange={e => update(p => { (p.field_map.assay.column_rules ??= {}).strip_suffixes = splitList(e.target.value); })}
                    helperText="e.g. a suffix after each analyte name" />
                <TextField size="small" label="Rename (Old=New)" value={formatRenames(rules.rename)}
                    onChange={e => update(p => { (p.field_map.assay.column_rules ??= {}).rename = parseRenames(e.target.value); })} />
            </Paper>

            <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="subtitle2" gutterBottom>Filter columns (on the collar table; leave one empty to hide that filter)</Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
                    {FILTER_FIELDS.map((k: FilterField) => (
                        <ColumnPick key={k} label={FILTER_LABELS[k]} value={fm.filters?.[k] ?? ''} columns={collarCols}
                            confidence={conf[`filters.${k}`]}
                            onChange={v => update(p => { p.field_map.filters = { ...p.field_map.filters, [k]: v || null }; })} />
                    ))}
                </Box>
            </Paper>
        </Box>
    );
};
