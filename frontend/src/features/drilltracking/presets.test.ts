import { describe, expect, it } from 'vitest';
import { TRACK_DEFAULTS } from '../../utils/drillTrackSurveys';
import { defaultRules, RULE_PRESETS } from './presets';

// The presets shipped in ./presets/ (each site's own codes; none in the code; there may be none)
describe('rule presets', () => {
    it('reads every preset file with a name and rules', () => {
        for (const p of RULE_PRESETS) {
            expect(typeof p.name).toBe('string');
            expect(p.rules).toBeTruthy();
        }
        expect(RULE_PRESETS.filter(p => p.default).length).toBeLessThanOrEqual(1);
    });

    it('starts new projects from the default preset, keeping the neutral window and limits', () => {
        const preset = RULE_PRESETS.find(p => p.default);
        const r = defaultRules();
        expect(r.window).toBe(TRACK_DEFAULTS.window);
        expect(r.missLimit).toBe(TRACK_DEFAULTS.missLimit);
        if (preset) {
            for (const [k, v] of Object.entries(preset.rules)) expect((r as unknown as Record<string, unknown>)[k]).toEqual(v);
        } else {
            expect(r).toEqual(TRACK_DEFAULTS);
        }
    });
});
