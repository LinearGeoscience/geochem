import { StyleRule, StyleAttribute } from '../store/styleStore';

/**
 * Style template that can be saved and reused across different datasets.
 * Templates preserve the original ranges/categories and apply them to new attributes.
 */
export interface StyleTemplate {
    // Metadata
    name: string;
    version: string;
    author?: string;
    created: string;
    description?: string;

    // The style rule configuration
    attribute: StyleAttribute;
    type: 'numeric' | 'categorical';

    // For numeric fields
    method?: 'manual' | 'equal' | 'quantile' | 'jenks';
    numClasses?: number;
    palette?: string;
    ranges?: Array<{
        min: number;
        max: number;
        label: string;
        color?: string;
        shape?: string;
        size?: number;
    }>;

    // For categorical fields
    categories?: Array<{
        value: string;
        label: string;
        color?: string;
        shape?: string;
        size?: number;
    }>;

    // Metadata about original field for reference
    metadata?: {
        originalField?: string;
        originalMin?: number;
        originalMax?: number;
        hint?: string;
    };
}

/**
 * Collection of style templates saved together
 */
export interface StyleTemplateLibrary {
    name: string;
    version: string;
    author?: string;
    created: string;
    description?: string;
    templates: StyleTemplate[];
}

/**
 * Convert a StyleRule to a StyleTemplate
 */
export function styleRuleToTemplate(
    rule: StyleRule,
    templateName: string,
    author?: string,
    description?: string
): StyleTemplate {
    const template: StyleTemplate = {
        name: templateName,
        version: '1.0',
        author,
        created: new Date().toISOString(),
        description,
        attribute: rule.attribute,
        type: rule.type,
    };

    if (rule.type === 'numeric') {
        template.method = rule.method;
        template.numClasses = rule.numClasses;
        template.palette = rule.palette;
        template.ranges = rule.ranges;

        // Add metadata
        if (rule.ranges && rule.ranges.length > 0) {
            template.metadata = {
                originalField: rule.field,
                originalMin: Math.min(...rule.ranges.map(r => r.min)),
                originalMax: Math.max(...rule.ranges.map(r => r.max)),
            };
        }
    } else {
        template.categories = rule.categories;
        template.metadata = {
            originalField: rule.field,
        };
    }

    return template;
}

/**
 * Apply a StyleTemplate to create a StyleRule for a specific field
 */
export function applyTemplateToField(
    template: StyleTemplate,
    field: string
): StyleRule {
    const rule: StyleRule = {
        field,
        attribute: template.attribute,
        type: template.type,
    };

    if (template.type === 'numeric') {
        rule.method = template.method;
        rule.numClasses = template.numClasses;
        rule.palette = template.palette;
        // Keep original ranges - don't recalculate
        rule.ranges = template.ranges;
    } else {
        // For categorical, keep original categories
        rule.categories = template.categories;
    }

    return rule;
}
