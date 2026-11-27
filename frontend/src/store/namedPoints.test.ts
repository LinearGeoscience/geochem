import { describe, it, expect, beforeEach } from 'vitest';
import { readScene, useModelStore, EMPTY_SCENE } from './modelStore';
import { padSetsOf, roleSetsOf } from '../features/plots/viewer3d/planner/usePlans';

// Made-up coordinates only
describe('sets of named points with a role (drill pads, target points)', () => {
    beforeEach(() => useModelStore.setState({ scene: { ...EMPTY_SCENE, inputs: [] } }));

    it('keep their names, role and mark when saved and read again', () => {
        const id = useModelStore.getState().addNamedPoints({ name: 'Pads', role: 'pads', color: '#6d4c41' }, [
            { p: [500000, 6500000, 400], name: 'PAD_01' }, { p: [500100, 6500050, 401], name: 'PAD_02' },
        ]);
        useModelStore.getState().setPointSetMark(id, 'cross');
        const back = readScene(JSON.parse(JSON.stringify(useModelStore.getState().scene)));
        const pads = padSetsOf(back.inputs);
        expect(pads).toHaveLength(1);
        expect(pads[0].folder).toBeNull();
        expect(pads[0].mark).toBe('cross');
        expect(pads[0].points.map(q => q.name)).toEqual(['PAD_01', 'PAD_02']);
    });

    it('a targets file imported again replaces its set (same object, its colour kept)', () => {
        const add = (n: number) => useModelStore.getState().addNamedPoints(
            { name: 'Targets: T', role: 'targets', color: '#7b1fa2' },
            Array.from({ length: n }, (_, i) => ({ p: [500000 + i, 6500000, 0] as [number, number, number], name: `T${i}` })),
            { replace: true },
        );
        const first = add(3);
        useModelStore.getState().updateInputSet(first, { color: '#000000' });
        expect(add(5)).toBe(first);
        const sets = roleSetsOf(useModelStore.getState().scene.inputs, 'targets');
        expect(sets).toHaveLength(1);
        expect(sets[0].points).toHaveLength(5);
        expect(sets[0].color).toBe('#000000');
    });
});
