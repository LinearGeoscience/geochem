import { describe, expect, it } from 'vitest';
import { parseCsv } from './drillholePlanIO';
import {
    ACQUIRE_LIVE_DEFAULTS, acquireLiveRequest, columnsByIndex, columnsByName, dateOf, guessCollarColumns, guessSurveyColumns, missingCollarFields, pulledColumns,
    readLiveCollars, readLiveSurveys,
} from './drillTrackImport';

// Made-up holes and coordinates
const COLLARS = [
    '"HOLEID","EAST","NORTH","RL","Max_Depth","East_20","North_20","RL_20","DateStart","DateFini","HoleStatus","PlanHoleID","Depth_Current","Depth_Date"',
    '"XX001",,,,250.5,1000,2000,300,"9-Apr-2018","12-Apr-2018","Complete","P01",,',
    '"XX002",,,,120,1010,2005,301,"14-Apr-2018",,"InProgress","P02",134.2,"15/04/2018"',
    '"XX002",,,,120,1010,2005,301,"14-Apr-2018",,"InProgress","P02",,',
    '"XX003",,,,0,,,,"15-Apr-2018",,,,,',
    ',,,,,,,,,,,,,',
].join('\r\n');

const SURVEYS = [
    'HOLEID,Project,DEPTH,AZIMUTH,DIP,SurvMeth,Grid_ID',
    'XX001,ZZ,0,90,-60,SOH,GRID_50',
    'XX001,ZZ,30,90.5,-59.8,GYRO_CONT,GRID_50',
    'XX001,ZZ,x,90.5,-59.8,GYRO_CONT,GRID_50',
    'XX001,ZZ,60,91,-95,GYRO_CONT,GRID_50',
    ',ZZ,60,91,-59,GYRO_CONT,GRID_50',
].join('\n');

describe('guessing columns', () => {
    it('takes the _20 coordinates of an Acquire export before the plain ones', () => {
        const cols = guessCollarColumns(parseCsv(COLLARS)[0]);
        expect(cols.hole).toBe(0);
        expect(cols.e).toBe(5);
        expect(cols.n).toBe(6);
        expect(cols.rl).toBe(7);
        expect(cols.maxDepth).toBe(4);
        expect(cols.planId).toBe(11);
        expect(cols.liveDepth).toBe(12);
        expect(cols.liveDepthDate).toBe(13);
        expect(cols.holeType).toBeNull();
        expect(missingCollarFields(cols)).toEqual([]);
    });

    it('finds the survey columns and says which required ones are missing', () => {
        const cols = guessSurveyColumns(parseCsv(SURVEYS)[0]);
        expect(cols).toEqual({ hole: 0, depth: 2, dip: 4, azi: 3, method: 5, grid: 6 });
        expect(missingCollarFields(guessCollarColumns(['HOLEID', 'Foo']))).toEqual(['e', 'n', 'rl']);
    });
});

describe('dateOf', () => {
    it('reads the forms dates come in, day first', () => {
        expect(dateOf('9-Apr-2018')).toBe('2018-04-09');
        expect(dateOf('09-April-18')).toBe('2018-04-09');
        expect(dateOf('2018-04-09')).toBe('2018-04-09');
        expect(dateOf('2018-04-09T08:00:00')).toBe('2018-04-09');
        expect(dateOf('15/04/2018')).toBe('2018-04-15');
        expect(dateOf('15/04/2018 07:30')).toBe('2018-04-15');
    });

    it('gives null for what is not a date', () => {
        expect(dateOf('')).toBeNull();
        expect(dateOf('9.0')).toBeNull();
        expect(dateOf('31-Feb-2018')).toBeNull();
        expect(dateOf('04/15/2018')).toBeNull();
    });
});

describe('reading the files', () => {
    it('reads collars, keeps the first of a repeated hole and reports what is missing', () => {
        const rows = parseCsv(COLLARS);
        const { collars, problems } = readLiveCollars(rows, guessCollarColumns(rows[0]));
        expect(collars.map(c => c.hole)).toEqual(['XX001', 'XX002', 'XX003']);
        expect(collars[0]).toMatchObject({ e: 1000, n: 2000, rl: 300, maxDepth: 250.5, dateStart: '2018-04-09', dateFini: '2018-04-12', status: 'Complete', planId: 'P01', liveDepth: null });
        expect(collars[1]).toMatchObject({ dateFini: null, liveDepth: 134.2, liveDepthDate: '2018-04-15' });
        expect(collars[2]).toMatchObject({ e: null, planId: null, status: null });
        expect(problems.some(p => p.includes('XX002 is in the file twice'))).toBe(true);
        expect(problems.some(p => p.startsWith('XX003: no collar coordinates'))).toBe(true);
    });

    it('reads survey rows and leaves out bad ones', () => {
        const rows = parseCsv(SURVEYS);
        const { surveys, problems } = readLiveSurveys(rows, guessSurveyColumns(rows[0]));
        expect(surveys).toHaveLength(2);
        expect(surveys[1]).toEqual({ hole: 'XX001', depth: 30, dip: -59.8, azi: 90.5, method: 'GYRO_CONT', grid: 'GRID_50' });
        expect(problems).toEqual(['3 survey rows without a hole, depth, dip or azimuth (or out of range) left out.']);
    });

    it('reads nothing when a required column has none', () => {
        const rows = parseCsv(SURVEYS);
        const cols = { ...guessSurveyColumns(rows[0]), dip: null };
        expect(readLiveSurveys(rows, cols)).toEqual({ surveys: [], problems: ['The survey file has no column for: Dip.'] });
    });
});

describe('reading from Acquire', () => {
    it('asks for holes started in the last N days, and pasted holes', () => {
        const base = { profile: 'Company A', days: 30, holeIds: [], collarColumns: null, surveyColumns: null };
        expect(acquireLiveRequest(base, '2026-03-15')).toEqual({ profile: 'Company A', drilled_from: '2026-02-13' });
        expect(acquireLiveRequest({ ...base, days: null, holeIds: [' XX001 ', '', 'XX002'] }, '2026-03-15')).toEqual({ profile: 'Company A', hole_ids: ['XX001', 'XX002'] });
        expect(acquireLiveRequest({ ...base, days: null }, '2026-03-15')).toBeNull();
        expect(acquireLiveRequest({ ...ACQUIRE_LIVE_DEFAULTS }, '2026-01-01')).toEqual({ drilled_from: '2025-01-01' });
    });

    it('keeps column choices by name and finds them again', () => {
        const header = ['HOLEID', 'Best_East_D', 'PlanHoleID', 'HoleStatus'];
        const named = columnsByName(header, { hole: 0, e: 1, planId: 2, status: null });
        expect(named).toEqual({ hole: 'HOLEID', e: 'Best_East_D', planId: 'PlanHoleID', status: null });
        expect(columnsByIndex(['HoleStatus', 'HOLEID', 'PlanHoleID'], named)).toEqual({ hole: 1, e: null, planId: 2, status: null });
    });

    it('uses the kept choices, then the guess, with the profile\'s own columns winning', () => {
        const header = ['HOLEID', 'Best_East_D', 'Best_North_D', 'Best_RL_D', 'EAST', 'PlanHoleID', 'Status2'];
        const guessed = guessCollarColumns(header);
        expect(guessed.e).toBe(4); // the guess takes EAST
        const kept = { ...columnsByName(header, guessed), status: 'Status2', planId: 'GoneColumn' };
        const cols = pulledColumns(header, guessed, kept, { hole: 'HOLEID', e: 'Best_East_D', n: 'Best_North_D', rl: 'Best_RL_D' });
        expect(cols).toMatchObject({ hole: 0, e: 1, n: 2, rl: 3, status: 6, planId: 5 });
    });
});
