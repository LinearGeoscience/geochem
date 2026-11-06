/**
 * Settings: data handling (below-detection substitution), project autosave
 * display preferences and updates. Data/project settings are saved with the project.
 */
import React, { useMemo } from 'react';
import {
    Box, Paper, Typography, FormControl, InputLabel, Select, MenuItem,
    Switch, FormControlLabel, TextField, Stack, Button, Link,
} from '@mui/material';
import { useUpdateStore } from '../store/updateStore';
import { useAppStore } from '../store/appStore';
import { useProjectStore } from '../store/projectStore';
import { useUIStore } from '../store/uiStore';
import { BDL_FACTOR_OPTIONS, censorableColumns, countCensored } from '../utils/censoring';

const Section: React.FC<{ title: string; description?: string; children: React.ReactNode }> = ({ title, description, children }) => (
    <Paper sx={{ p: 2.5 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{title}</Typography>
        {description && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{description}</Typography>
        )}
        <Stack spacing={2}>{children}</Stack>
    </Paper>
);

const SettingsView: React.FC = () => {
    const bdlFactor = useAppStore(s => s.bdlFactor);
    const setBdlFactor = useAppStore(s => s.setBdlFactor);
    const columnarData = useAppStore(s => s.columnarData);
    const geochemMappings = useAppStore(s => s.geochemMappings);
    const tooltipMode = useAppStore(s => s.tooltipMode);
    const setTooltipMode = useAppStore(s => s.setTooltipMode);
    const autosaveEnabled = useProjectStore(s => s.autosaveEnabled);
    const autosaveIntervalMinutes = useProjectStore(s => s.autosaveIntervalMinutes);
    const setAutosaveEnabled = useProjectStore(s => s.setAutosaveEnabled);
    const setAutosaveInterval = useProjectStore(s => s.setAutosaveInterval);
    const themeMode = useUIStore(s => s.themeMode);
    const toggleThemeMode = useUIStore(s => s.toggleThemeMode);
    const updateCheckEnabled = useUIStore(s => s.updateCheckEnabled);
    const setUpdateCheckEnabled = useUIStore(s => s.setUpdateCheckEnabled);

    // How many below-detection values the current dataset holds
    const censoredSummary = useMemo(() => {
        let values = 0;
        let columns = 0;
        for (const name of censorableColumns(geochemMappings)) {
            const n = countCensored(columnarData.columns.get(name));
            if (n > 0) { values += n; columns++; }
        }
        return { values, columns };
    }, [columnarData, geochemMappings]);

    const bdlKey = bdlFactor === null ? 'missing' : String(bdlFactor);

    return (
        <Box sx={{ maxWidth: 760 }}>
            <Typography variant="h5" sx={{ mb: 2 }}>Settings</Typography>
            <Stack spacing={2}>
                <Section
                    title="Below-detection values"
                    description={'Values reported as "<DL" are stored as the negative detection limit (e.g. <0.01 → -0.01), as in the reference software. ' +
                        'Statistics, plots, transforms and calculations use the substitute below; the data grid, exports and saved projects keep the stored value.'}
                >
                    <FormControl size="small" sx={{ maxWidth: 320 }}>
                        <InputLabel>Substitute with</InputLabel>
                        <Select
                            label="Substitute with"
                            value={bdlKey}
                            onChange={(e) => setBdlFactor(e.target.value === 'missing' ? null : Number(e.target.value))}
                        >
                            {BDL_FACTOR_OPTIONS.map(o => (
                                <MenuItem key={String(o.value)} value={o.value === null ? 'missing' : String(o.value)}>
                                    {o.label}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <Typography variant="body2" color="text.secondary">
                        {columnarData.rowCount === 0
                            ? 'No data loaded.'
                            : censoredSummary.values === 0
                                ? 'The current dataset has no below-detection values in element columns.'
                                : `${censoredSummary.values.toLocaleString()} below-detection values in ${censoredSummary.columns} element column${censoredSummary.columns === 1 ? '' : 's'}.`}
                    </Typography>
                </Section>

                <Section title="Project" description="Autosave writes to the project file when it has one, otherwise to a recovery copy in the browser.">
                    <FormControlLabel
                        control={<Switch checked={autosaveEnabled} onChange={(e) => setAutosaveEnabled(e.target.checked)} />}
                        label="Autosave"
                    />
                    <TextField
                        size="small"
                        type="number"
                        label="Autosave interval (minutes)"
                        value={autosaveIntervalMinutes}
                        disabled={!autosaveEnabled}
                        onChange={(e) => setAutosaveInterval(Number(e.target.value))}
                        inputProps={{ min: 1, max: 30 }}
                        sx={{ maxWidth: 240 }}
                    />
                </Section>

                <Section title="Display">
                    <FormControlLabel
                        control={<Switch checked={themeMode === 'dark'} onChange={toggleThemeMode} />}
                        label="Dark mode"
                    />
                    <FormControlLabel
                        control={<Switch checked={tooltipMode === 'detailed'} onChange={(e) => setTooltipMode(e.target.checked ? 'detailed' : 'compact')} />}
                        label="Detailed plot tooltips"
                    />
                </Section>

                <UpdatesSection enabled={updateCheckEnabled} setEnabled={setUpdateCheckEnabled} />
            </Stack>
        </Box>
    );
};

/** Installed version, what's new, and the update check (Phase 81). */
const UpdatesSection: React.FC<{ enabled: boolean; setEnabled: (v: boolean) => void }> = ({ enabled, setEnabled }) => {
    const info = useUpdateStore(s => s.info);
    const check = useUpdateStore(s => s.check);
    const checking = useUpdateStore(s => s.checking);
    const checkForUpdate = useUpdateStore(s => s.checkForUpdate);
    const setDialog = useUpdateStore(s => s.setDialog);

    let status: React.ReactNode = null;
    if (checking) status = 'Checking…';
    else if (check?.error) status = check.error;
    else if (check?.updateAvailable) status = (
        <>
            GeoChem {check.latest} is available.{' '}
            <Link component="button" variant="body2" onClick={() => setDialog('update')}>See what's new and update</Link>
        </>
    );
    else if (check) status = `You have the latest version (checked ${new Date(check.checkedAt * 1000).toLocaleTimeString()}).`;

    return (
        <Section
            title="Updates"
            description="GeoChem can check GitHub for a newer version when it starts. Only the published version number and release notes are downloaded; nothing about you or your data is sent."
        >
            <Stack direction="row" spacing={2} alignItems="center">
                <Typography variant="body2">
                    Installed version: <strong>{info?.version ?? '…'}</strong>
                </Typography>
                <Link component="button" variant="body2" onClick={() => setDialog('current')} disabled={!info}>
                    What's new
                </Link>
            </Stack>
            <FormControlLabel
                control={<Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />}
                label="Check for updates when GeoChem starts"
            />
            <Stack direction="row" spacing={2} alignItems="center">
                <Button size="small" variant="outlined" onClick={() => void checkForUpdate(true)} disabled={checking}>
                    Check now
                </Button>
                {status && <Typography variant="body2" color="text.secondary">{status}</Typography>}
            </Stack>
        </Section>
    );
};

export default SettingsView;
