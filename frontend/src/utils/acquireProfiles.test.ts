import { describe, it, expect, beforeEach } from 'vitest';
import {
    AcquireProfile, connectionKey, databaseProblem, fieldMapProblems, formatRenames, lastProfile, parseRenames,
    profileNameProblem, readyToImport, rememberProfile, roles, serverProblem, splitList, withObject, withRole,
} from './acquireProfiles';

// A made-up company, never a real one
function profile(): AcquireProfile {
    return {
        name: 'Company A', server: 'sql.example.test', database: 'EXAMPLE_DB',
        field_map: {
            collar: { object: 'DH_COLLAR', columns: { hole_id: 'HoleID', easting: 'E', northing: 'N', rl: 'Z' } },
            survey: { object: 'DH_SURVEY', columns: { hole_id: 'HoleID', depth: 'Depth', dip: 'Dip', azimuth: 'Azi' } },
            assay: { layout: 'wide', object: 'DH_ASSAY', columns: { hole_id: 'HoleID', from: 'From', to: 'To' } },
            filters: { project: 'Project', drilled: 'Drilled' },
        },
    };
}

describe('server and database checks', () => {
    it('accepts host names, IPs, instances and ports', () => {
        for (const s of ['sqlserver', 'sql.example.com', '10.0.0.5', 'sqlserver\\INSTANCE', 'sql.example.com,1433', 'sql\\SQL2019,14330']) {
            expect(serverProblem(s), s).toBeNull();
        }
    });

    it('refuses injection attempts and malformed names', () => {
        for (const s of ['', 'host;Trusted_Connection=no', 'host}', '{host', 'host=1', 'ho st', '"host"', "host'", 'host\t', 'host,99999', '-host', 'host\\']) {
            expect(serverProblem(s), JSON.stringify(s)).not.toBeNull();
        }
        expect(serverProblem('host;x')).toMatch(/can't contain ;/);
        expect(serverProblem('ho st')).toMatch(/spaces/);
    });

    it('checks database names the same way', () => {
        expect(databaseProblem('EXAMPLE_DB')).toBeNull();
        expect(databaseProblem('Acquire-Prod')).toBeNull();
        for (const d of ['', 'db;DROP', 'db}', 'my db', "'db'", 'x'.repeat(129)]) expect(databaseProblem(d), d).not.toBeNull();
    });
});

describe('profile names', () => {
    it('allows simple names and refuses paths, reserved names and duplicates', () => {
        expect(profileNameProblem('Company A')).toBeNull();
        for (const n of ['', '../x', 'a/b', 'con', 'LPT1', '.x', 'x'.repeat(61), 'name.']) expect(profileNameProblem(n), n).not.toBeNull();
        expect(profileNameProblem('company a', ['Company A'])).toMatch(/already exists/);
    });
});

describe('field map completeness', () => {
    it('a complete wide map has no problems', () => {
        expect(fieldMapProblems(profile().field_map)).toEqual([]);
    });

    it('lists the missing roles', () => {
        const p = withRole(profile(), 'survey', 'dip', '');
        expect(fieldMapProblems(p.field_map)).toEqual(['survey: choose the Dip column']);
    });

    it('needs the extra roles of the long layouts', () => {
        const p = profile();
        p.field_map.assay.layout = 'long';
        expect(fieldMapProblems(p.field_map)).toEqual([
            'assay: choose the Element / analyte column', 'assay: choose the Value column']);
        p.field_map.assay.layout = 'long_joined';
        const problems = fieldMapProblems(p.field_map);
        expect(problems).toContain('assay: choose the Sample ID column');
        expect(problems).toContain('samples: not set');
        expect(roles('assay', 'long_joined')).toEqual({ required: ['sample_id', 'element', 'value'], optional: ['unit'] });
    });

    it('checks the optional rules once they are switched on', () => {
        const p = profile();
        p.field_map.assay.preferred = { rule: 'lowest', column: null };
        p.field_map.assay.qaqc = { column: 'SampleType', exclude: [] };
        expect(fieldMapProblems(p.field_map)).toHaveLength(2);
    });
});

describe('editing helpers', () => {
    it('changing a table keeps only the columns the new table has', () => {
        const p = withObject(profile(), 'collar', 'dbo', 'OTHER', ['HoleID', 'Project', 'e']);
        expect(p.field_map.collar.object).toBe('OTHER');
        expect(p.field_map.collar.columns).toEqual({ hole_id: 'HoleID', easting: 'E' });
        expect(p.field_map.filters).toEqual({ project: 'Project', drilled: null });
        expect(profile().field_map.collar.object).toBe('DH_COLLAR'); // the original is untouched
    });

    it('sets the samples table of the joined layout', () => {
        const p = withRole(profile(), 'samples', 'sample_id', 'SampNo');
        expect(p.field_map.assay.samples).toEqual({ object: '', columns: { sample_id: 'SampNo' } });
    });

    it('lists and renames', () => {
        expect(splitList(' A, B\nC ,, ')).toEqual(['A', 'B', 'C']);
        expect(parseRenames('SGReading=SG, bad, X = Y')).toEqual({ SGReading: 'SG', X: 'Y' });
        expect(formatRenames({ SGReading: 'SG' })).toBe('SGReading=SG');
    });
});

describe('readiness', () => {
    const ok = { ok: true, message: '', map_problems: [], incomplete: [] };

    it('needs a saved, unchanged profile that passed its test', () => {
        const key = connectionKey(profile());
        expect(readyToImport({ saved: true, dirty: false, test: ok, testKey: key, key })).toBe(true);
        expect(readyToImport({ saved: false, dirty: false, test: ok, testKey: key, key })).toBe(false);
        expect(readyToImport({ saved: true, dirty: true, test: ok, testKey: key, key })).toBe(false);
        expect(readyToImport({ saved: true, dirty: false, test: { ...ok, ok: false }, testKey: key, key })).toBe(false);
        expect(readyToImport({ saved: true, dirty: false, test: { ...ok, map_problems: ['x'] }, testKey: key, key })).toBe(false);
        const changed = connectionKey({ ...profile(), database: 'OTHER' });
        expect(readyToImport({ saved: true, dirty: false, test: ok, testKey: key, key: changed })).toBe(false);
    });
});

describe('remembered profile', () => {
    beforeEach(() => { try { localStorage.clear(); } catch { /* none */ } });

    it('survives without storage and remembers when it can', () => {
        rememberProfile('Company A');
        const got = lastProfile();
        expect(got === 'Company A' || got === null).toBe(true);
        rememberProfile(null);
        expect(lastProfile()).toBeNull();
    });
});
