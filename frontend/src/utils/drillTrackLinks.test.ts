import { describe, expect, it } from 'vitest';
import type { LiveCollar } from './drillTrackImport';
import { activeState, findWedges, linkHoles, sharedTo, trackedOf, type PlannedRef } from './drillTrackLinks';

// Made-up holes and coordinates
const collar = (hole: string, patch: Partial<LiveCollar> = {}): LiveCollar => ({
    hole, e: 1000, n: 2000, rl: 300, planId: null, status: null, holeType: 'DD', dateStart: null, dateFini: null,
    maxDepth: null, liveDepth: null, liveDepthDate: null, ...patch,
});

describe('activeState', () => {
    it('reads the status first, then the dates, and a setting by hand wins', () => {
        expect(activeState(collar('A', { status: 'InProgress' })).active).toBe(true);
        expect(activeState(collar('A', { status: 'Re-Entry', dateFini: '2026-01-01' })).active).toBe(true);
        expect(activeState(collar('A', { status: 'Complete', dateStart: '2026-01-01' })).active).toBe(false);
        expect(activeState(collar('A', { status: 'Abandoned' })).active).toBe(false);
        expect(activeState(collar('A', { dateStart: '2026-01-01' }))).toEqual({ active: true, why: 'started 2026-01-01, not finished' });
        expect(activeState(collar('A', { dateStart: '2026-01-01', dateFini: '2026-01-05' })).active).toBe(false);
        expect(activeState(collar('A')).why).toBe('not started');
        expect(activeState(collar('A', { status: 'Complete' }), 'on')).toEqual({ active: true, why: 'set by hand' });
        expect(activeState(collar('A', { status: 'InProgress' }), 'off').active).toBe(false);
    });

    it('reads a site\'s own statuses from the rules', () => {
        const rules = { activeStatuses: ['DRILLING'], finishedStatuses: ['DONE'] };
        expect(activeState(collar('A', { status: 'Drilling' }), null, rules).active).toBe(true);
        expect(activeState(collar('A', { status: 'InProgress', dateStart: '2026-01-01' }), null, rules).why).toBe('started 2026-01-01, not finished');
        expect(activeState(collar('A', { status: 'done', dateStart: '2026-01-01' }), null, rules)).toEqual({ active: false, why: 'status done' });
    });
});

describe('linkHoles', () => {
    const planned: PlannedRef[] = [
        { key: 'p1/a', name: 'P01', targetId: null },
        { key: 'p1/b', name: 'P02_W1', targetId: 'T07' },
        { key: 'p1/c', name: 'P03', targetId: 'T09' },
        { key: 'p1/d', name: 'P04', targetId: 'T09' },
    ];

    it('matches the planned-hole ID to a name, then to a target ID, without case', () => {
        const links = linkHoles([
            collar('D1', { planId: 'p01' }), collar('D2', { planId: 'T07' }), collar('D3', { planId: 'P02_W1' }),
            collar('D4', { planId: 'T09' }), collar('D5', { planId: 'Q99' }), collar('D6'),
        ], planned);
        expect(links.map(l => [l.hole, l.planned, l.how])).toEqual([
            ['D1', 'p1/a', 'name'], ['D2', 'p1/b', 'target'], ['D3', 'p1/b', 'name'],
            ['D4', null, 'ambiguous'], ['D5', null, 'unmatched'], ['D6', null, 'no-plan-id'],
        ]);
    });

    it('lets a choice by hand win, unless the planned hole has gone', () => {
        const links = linkHoles([collar('D1', { planId: 'P01' }), collar('D5', { planId: 'Q99' }), collar('D6', { planId: 'P01' })], planned,
            { D1: null, D5: 'p1/c', D6: 'gone/x' });
        expect(links.map(l => [l.planned, l.how])).toEqual([[null, 'none'], ['p1/c', 'manual'], ['p1/a', 'name']]);
    });
});

describe('trackedOf', () => {
    const holes = [collar('D1', { dateStart: '2026-03-01' }), collar('D1A', { dateStart: '2026-03-09' }), collar('D1B', { dateStart: '2026-03-05' })];

    it('tracks the hole being drilled, else the last started', () => {
        expect(trackedOf(holes, h => h === 'D1B')).toBe('D1B');
        expect(trackedOf(holes, () => false)).toBe('D1A');
        expect(trackedOf([], () => true)).toBeNull();
    });
});

describe('wedges', () => {
    const top = [{ depth: 0, dip: -70, azi: 180 }, { depth: 50, dip: -69, azi: 181 }, { depth: 100, dip: -68, azi: 182 }];
    const parent = [...top, { depth: 150, dip: -67, azi: 183 }, { depth: 200, dip: -66, azi: 184 }];
    const daughter = [...top, { depth: 130, dip: -66, azi: 186 }, { depth: 180, dip: -64, azi: 189 }];

    it('finds the deepest station two holes share from the top', () => {
        expect(sharedTo(parent, daughter)).toBe(100);
        expect(sharedTo(parent, [{ depth: 0, dip: -71, azi: 180 }, ...parent.slice(1)])).toBeNull();
        expect(sharedTo(parent, parent.slice(0, 1))).toBeNull();
    });

    it('pairs a parent and its daughter collared together, the parent started first', () => {
        const collars = [
            collar('W1', { dateStart: '2026-04-10', e: 1000.3 }), collar('PA', { dateStart: '2026-04-01' }),
            collar('FAR', { e: 1500, dateStart: '2026-04-20' }), collar('SAME', { e: 1000.1, dateStart: '2026-04-21' }),
        ];
        const stations = new Map([['PA', parent], ['W1', daughter], ['FAR', daughter], ['SAME', parent.slice(0, 3)]]);
        expect(findWedges(collars, stations)).toEqual([{ parent: 'PA', daughter: 'W1', kop: 100 }]);
    });
});
