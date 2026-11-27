/**
 * Putting the drilled holes into drill tracking, from CSV files or from
 * Acquire (SQL) through the Acquire import's connection profiles.
 *
 * - `pullFromAcquire` asks the backend (POST /api/drilltracking/acquire) for
 *   the collars and surveys of the holes started in the last N days and / or
 *   listed by ID, and lays them out as the CSV files would be, with their
 *   columns: those chosen last time (by name), else guessed; the profile's own
 *   hole / coordinate / survey columns always win.
 * - `applyLive` reads either into drill tracking's snapshot and says what it
 *   read, warning of holes on track to miss their targets.
 * - `refreshFromAcquire` does both with the settings kept with the project.
 * Every Acquire read writes its pull record to the processing log.
 */
import { useAuditStore } from '../../store/auditStore';
import { useDrillTrackingStore } from '../../store/drillTrackingStore';
import { notify } from '../../store/notificationStore';
import { drillTrackingApi, type AcquireLivePull } from '../../services/drillTrackingApi';
import { runTracking } from '../../utils/drillTrackRun';
import {
    acquireLiveRequest, columnsByName, guessCollarColumns, guessSurveyColumns, localTime, pulledColumns, readLiveCollars, readLiveSurveys,
    type AcquireLiveSettings, type CollarColumns, type SurveyColumns,
} from '../../utils/drillTrackImport';
import { friendlyError } from '../../utils/friendlyError';

export interface CsvFile { name: string; rows: string[][] }

export interface PulledFiles {
    collar: CsvFile;
    survey: CsvFile;
    collarCols: CollarColumns;
    surveyCols: SurveyColumns;
    pull: AcquireLivePull;
}

const today = () => localTime(new Date().toISOString()).slice(0, 10);

/** The collars and surveys from Acquire, laid out as files with their columns */
export async function pullFromAcquire(s: AcquireLiveSettings): Promise<PulledFiles> {
    const body = acquireLiveRequest(s, today());
    if (!body) throw new Error('Give a number of days, or paste hole IDs, to say which holes to read.');
    const pull = await drillTrackingApi.acquire(body);
    const c = pull.columns.collar, v = pull.columns.survey;
    const collarHead = pull.collar.columns, surveyHead = pull.survey.columns;
    return {
        pull,
        collar: { name: `Acquire collars (${pull.profile})`, rows: [collarHead, ...pull.collar.rows] },
        survey: { name: `Acquire surveys (${pull.profile})`, rows: [surveyHead, ...pull.survey.rows] },
        collarCols: pulledColumns(collarHead, guessCollarColumns(collarHead), s.collarColumns, { hole: c.hole_id, e: c.easting, n: c.northing, rl: c.rl }),
        surveyCols: pulledColumns(surveyHead, guessSurveyColumns(surveyHead), s.surveyColumns, { hole: v.hole_id, depth: v.depth, dip: v.dip, azi: v.azimuth }),
    };
}

/** Reads the drilled holes into drill tracking; returns the notice to give */
export function applyLive(collar: CsvFile, survey: CsvFile, cc: CollarColumns, sc: SurveyColumns, source: { collarFile: string; surveyFile: string }) {
    const c = readLiveCollars(collar.rows, cc), s = readLiveSurveys(survey.rows, sc);
    const problems = [...c.problems, ...s.problems];
    const store = useDrillTrackingStore.getState();
    store.setLive({ collars: c.collars, surveys: s.surveys, problems, source: { ...source, readAt: new Date().toISOString() } });
    // Holes on track to miss their targets by more than the limit are said straight away
    const t = useDrillTrackingStore.getState();
    const r = runTracking({ program: t.programs.find(p => p.id === t.tracking.programId) ?? null, live: t.live, ...t.tracking });
    const off = r.reports.filter(x => x.forecast?.flagged);
    const offText = off.length ? ` WARNING: ${off.map(x => `${x.hole} on track to pass ${x.forecast!.distance.toFixed(1)} m`).join(', ')} from ${off.length === 1 ? 'its' : 'their'} target (more than ${off[0].forecast!.limit} m).` : '';
    const text = `Read ${c.collars.length.toLocaleString()} drilled holes and ${s.surveys.length.toLocaleString()} survey stations${problems.length ? `; ${problems.length} note${problems.length === 1 ? '' : 's'} (see Drilled holes in the project tree)` : ''}.${offText}`;
    return { text, severity: (off.length ? 'error' : problems.length ? 'warning' : 'success') as 'error' | 'warning' | 'success', holes: c.collars.length };
}

/** The Acquire source as drill tracking shows it */
export const acquireSource = (pull: AcquireLivePull) => ({
    collarFile: `Acquire (profile ${pull.profile}: ${pull.pull_record.database} on ${pull.pull_record.server}, queries ${pull.pull_record.query_version})`,
    surveyFile: '',
});

/** The pull record in the processing log */
export function recordPull(pull: AcquireLivePull, s: AcquireLiveSettings) {
    const r = pull.pull_record;
    useAuditStore.getState().recordAudit({
        category: 'import',
        operation: 'Acquire pull (drill tracking)',
        description: `Read ${r.holes} hole${r.holes === 1 ? '' : 's'} being tracked from Acquire${s.days ? ` (started in the last ${s.days} days)` : ''}${s.holeIds.length ? ` (${s.holeIds.length} listed)` : ''}`,
        details: `Profile ${r.profile}: ${r.rows.collar} collar and ${r.rows.survey} survey rows read from ${r.server}/${r.database} by ${r.user} at ${r.pulled_at} `
            + `(queries ${r.query_version}, field map v${r.mapping_version ?? '?'}). Collars and surveys only, for drill tracking; the dataset is not changed. SHA-256 ${r.sha256}`,
        parameters: { ...r } as Record<string, unknown>,
        rowsAffected: 0,
    });
}

/** Keeps how the holes were read (columns by name), for the next refresh */
export function keepAcquireSettings(s: AcquireLiveSettings, files: PulledFiles, cc: CollarColumns, sc: SurveyColumns) {
    useDrillTrackingStore.getState().setTracking({
        acquire: { ...s, profile: s.profile ?? files.pull.profile, collarColumns: columnsByName(files.collar.rows[0] ?? [], cc), surveyColumns: columnsByName(files.survey.rows[0] ?? [], sc) },
    });
}

/** Reads the latest from Acquire with the settings kept with the project */
export async function refreshFromAcquire(): Promise<boolean> {
    const s = useDrillTrackingStore.getState().tracking.acquire;
    if (!s) return false;
    try {
        const files = await pullFromAcquire(s);
        const out = applyLive(files.collar, files.survey, files.collarCols, files.surveyCols, acquireSource(files.pull));
        recordPull(files.pull, s);
        keepAcquireSettings(s, files, files.collarCols, files.surveyCols);
        notify(`From Acquire (${files.pull.profile}): ${out.text}`, out.severity);
        return true;
    } catch (err) {
        notify(friendlyError(err, 'Reading from Acquire failed'), 'error');
        return false;
    }
}
