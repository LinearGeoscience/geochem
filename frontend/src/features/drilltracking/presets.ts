/**
 * Survey rule presets: a site's own survey codes, hole statuses and grid zone
 * for drill tracking, one JSON file per site in ./presets/ ({ name, notes,
 * default, rules }). The code has no site's codes in it: with no preset the
 * rules are neutral (utils/drillTrackSurveys TRACK_DEFAULTS); a preset marked
 * "default" is what new projects start with. The Survey rules dialog applies
 * any preset, and every rule can be changed by hand.
 */
import { presetRules, TRACK_DEFAULTS, type RulesPreset, type TrackRules } from '../../utils/drillTrackSurveys';

const files = import.meta.glob<{ default: RulesPreset }>('./presets/*.json', { eager: true });

/** The presets shipped, by name */
export const RULE_PRESETS: readonly RulesPreset[] = Object.values(files)
    .map(m => m.default)
    .filter((p): p is RulesPreset => !!p && typeof p.name === 'string' && !!p.rules)
    .sort((a, b) => a.name.localeCompare(b.name));

/** The rules a new project starts with: the default preset's, else neutral */
export function defaultRules(): TrackRules {
    const preset = RULE_PRESETS.find(p => p.default);
    return preset ? presetRules({ ...TRACK_DEFAULTS }, preset) : { ...TRACK_DEFAULTS };
}
