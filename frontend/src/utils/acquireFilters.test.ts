import { describe, it, expect } from 'vitest';
import {
    AcquireCombo, AcquirePullRecord, EMPTY_FILTERS, buildPreviewRequest, describeFilters, filterProblem,
    hasAnyFilter, holesMatchingLists, holesNotFound, optionLists, parseHoleList, pullRecordAudit, withSelected,
} from './acquireFilters';

// Made-up projects, prospects and holes only
const combos: AcquireCombo[] = [
    { project: 'TP', prospect: 'North', hole_type: 'DD', program: null, holes: 10, first_drilled: '2023-01-02', last_drilled: '2024-05-01' },
    { project: 'TP', prospect: 'North', hole_type: 'RC', program: 'P26', holes: 4, first_drilled: '2026-02-01', last_drilled: '2026-03-01' },
    { project: 'TP', prospect: 'South', hole_type: 'DD', program: 'P26', holes: 3, first_drilled: '2026-04-01', last_drilled: '2026-05-01' },
    { project: 'TQ', prospect: null, hole_type: 'DD', program: null, holes: 7, first_drilled: null, last_drilled: null },
];

describe('parseHoleList', () => {
    it('splits on any separator, strips quotes and drops duplicates in order', () => {
        const text = 'TDD001\r\nTDD002, TDD003;TDD001\t"TDD004"  \'TDD005\'\n\n';
        expect(parseHoleList(text)).toEqual({ ids: ['TDD001', 'TDD002', 'TDD003', 'TDD004', 'TDD005'], duplicates: 1 });
    });

    it('handles thousands of IDs', () => {
        const text = Array.from({ length: 5000 }, (_, i) => `H${i}`).join('\n');
        expect(parseHoleList(text).ids).toHaveLength(5000);
    });

    it('empty text gives no IDs', () => {
        expect(parseHoleList('  \n , ;')).toEqual({ ids: [], duplicates: 0 });
    });
});

describe('optionLists', () => {
    it('lists every non-blank value with hole counts when nothing is chosen', () => {
        const lists = optionLists(combos, EMPTY_FILTERS);
        expect(lists.project).toEqual([{ value: 'TP', holes: 17 }, { value: 'TQ', holes: 7 }]);
        expect(lists.prospect.map(o => o.value)).toEqual(['North', 'South']); // blank prospect not offered
        expect(lists.program).toEqual([{ value: 'P26', holes: 7 }]);
    });

    it('narrows each list by the other filters, not by itself', () => {
        const state = withSelected(EMPTY_FILTERS, 'prospect', ['North']);
        const lists = optionLists(combos, state);
        expect(lists.hole_type).toEqual([{ value: 'DD', holes: 10 }, { value: 'RC', holes: 4 }]);
        expect(lists.prospect.map(o => o.value)).toEqual(['North', 'South']);
        expect(lists.project).toEqual([{ value: 'TP', holes: 14 }]);
    });

    it('keeps a chosen value that other filters rule out', () => {
        let state = withSelected(EMPTY_FILTERS, 'project', ['TQ']);
        state = withSelected(state, 'program', ['P26']);
        expect(optionLists(combos, state).program).toEqual([{ value: 'P26', holes: 0 }]);
    });

    it('counts holes matching the list filters', () => {
        expect(holesMatchingLists(combos, EMPTY_FILTERS)).toBe(24);
        expect(holesMatchingLists(combos, withSelected(EMPTY_FILTERS, 'hole_type', ['DD']))).toBe(20);
    });
});

describe('filters -> request', () => {
    it('needs at least one filter', () => {
        expect(hasAnyFilter(EMPTY_FILTERS)).toBe(false);
        expect(filterProblem(EMPTY_FILTERS)).toMatch(/at least one/);
        expect(hasAnyFilter({ ...EMPTY_FILTERS, holeListText: ' X1 ' })).toBe(true);
        expect(hasAnyFilter({ ...EMPTY_FILTERS, drilledTo: '2026-01-31' })).toBe(true);
    });

    it('checks dates', () => {
        expect(filterProblem({ ...EMPTY_FILTERS, drilledFrom: '31/01/2026' })).toMatch(/date like/);
        expect(filterProblem({ ...EMPTY_FILTERS, drilledFrom: '2026-02-01', drilledTo: '2026-01-01' })).toMatch(/after/);
        expect(filterProblem({ ...EMPTY_FILTERS, drilledFrom: '2026-01-01', drilledTo: '2026-01-01' })).toBeNull();
        expect(filterProblem({ ...EMPTY_FILTERS, modifiedFrom: '2026-03-01', modifiedTo: '2026-02-01' })).toMatch(/Modified/);
        expect(hasAnyFilter({ ...EMPTY_FILTERS, modifiedFrom: '2026-01-01' })).toBe(true);
    });

    it('builds the /api/acquire/preview body', () => {
        const state = { ...EMPTY_FILTERS, projects: ['TP'], holeTypes: ['DD', 'RC'], drilledFrom: '2026-01-01', holeListText: 'A1\nA2\nA1' };
        expect(buildPreviewRequest(state, 'Company A')).toEqual({
            profile: 'Company A', projects: ['TP'], prospects: [], hole_types: ['DD', 'RC'], programs: [],
            drilled_from: '2026-01-01', drilled_to: null, modified_from: null, modified_to: null, hole_ids: ['A1', 'A2'],
        });
        expect(buildPreviewRequest(state)).not.toHaveProperty('profile'); // server mode: the admin's profile
    });

    it('describes the filters', () => {
        const req = buildPreviewRequest({ ...EMPTY_FILTERS, projects: ['TP'], drilledTo: '2026-06-30', holeListText: 'A1' });
        expect(describeFilters(req)).toBe('project TP; drilled … to 2026-06-30; 1 listed hole');
        const mod = buildPreviewRequest({ ...EMPTY_FILTERS, modifiedFrom: '2026-01-01' });
        expect(describeFilters(mod)).toBe('modified 2026-01-01 to …');
    });

    it('counts pasted holes not found only when the list is the only filter', () => {
        const listOnly = buildPreviewRequest({ ...EMPTY_FILTERS, holeListText: 'A1 A2 A3' });
        expect(holesNotFound(listOnly, 2)).toBe(1);
        expect(holesNotFound({ ...listOnly, projects: ['TP'] }, 2)).toBe(0);
    });
});

describe('pullRecordAudit', () => {
    it('records who, when, where, filters, versions, rows and checksum', () => {
        const record: AcquirePullRecord = {
            source: 'Acquire', pulled_at: '2026-11-26T03:00:00+00:00', user: 'DOMAIN\\someone', profile: 'Company A',
            server: 'sql.example.test', database: 'EXAMPLE_DB', filters: {}, query_version: 'acquire-1',
            mapping_version: 1, holes: 3, rows: { collar: 3, survey: 6, assay: 6 }, sha256: 'ab'.repeat(32),
        };
        const req = buildPreviewRequest({ ...EMPTY_FILTERS, projects: ['TP'] });
        const entry = pullRecordAudit(record, req, 6);
        expect(entry.category).toBe('import');
        expect(entry.description).toBe('Imported 3 holes from Acquire (project TP)');
        expect(entry.details).toContain('Profile Company A: 3 collar, 6 survey and 6 assay rows');
        expect(entry.details).toContain('sql.example.test/EXAMPLE_DB by DOMAIN\\someone');
        expect(entry.details).toContain('acquire-1');
        expect(entry.details).toContain('ab'.repeat(32));
        expect(entry.parameters.request).toEqual(req);
        expect(entry.rowsAffected).toBe(6);
    });
});
