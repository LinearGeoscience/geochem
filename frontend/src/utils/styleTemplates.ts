import { StyleTemplate, StyleTemplateLibrary } from '../types/styleTemplate';
import { StyleRule } from '../store/styleStore';

/**
 * Export a style template to a JSON file
 */
export function exportTemplateToFile(template: StyleTemplate): void {
    const json = JSON.stringify(template, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `${template.name.replace(/\s+/g, '_')}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

/**
 * Export multiple templates as a library
 */
export function exportLibraryToFile(library: StyleTemplateLibrary): void {
    const json = JSON.stringify(library, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `${library.name.replace(/\s+/g, '_')}_library.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

/**
 * Import a template from a JSON file
 */
export function importTemplateFromFile(): Promise<StyleTemplate> {
    return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';

        input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) {
                reject(new Error('No file selected'));
                return;
            }

            try {
                const text = await file.text();
                const template = JSON.parse(text) as StyleTemplate;

                // Validate template structure
                if (!template.name || !template.attribute || !template.type) {
                    throw new Error('Invalid template file');
                }

                resolve(template);
            } catch (error) {
                reject(error);
            }
        };

        input.click();
    });
}

/**
 * Import a library from a JSON file
 */
export function importLibraryFromFile(): Promise<StyleTemplateLibrary> {
    return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';

        input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) {
                reject(new Error('No file selected'));
                return;
            }

            try {
                const text = await file.text();
                const data = JSON.parse(text);

                // Check if it's a library or single template
                if (data.templates && Array.isArray(data.templates)) {
                    resolve(data as StyleTemplateLibrary);
                } else if (data.name && data.attribute) {
                    // Single template, wrap in library
                    resolve({
                        name: 'Imported Templates',
                        version: '1.0',
                        created: new Date().toISOString(),
                        templates: [data as StyleTemplate]
                    });
                } else {
                    throw new Error('Invalid file format');
                }
            } catch (error) {
                reject(error);
            }
        };

        input.click();
    });
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

/**
 * Default "Gold Standard" template for gold exploration
 */
export const GOLD_STANDARD_TEMPLATE: StyleTemplate = {
    name: 'Gold Standard',
    version: '1.0',
    author: 'Linear Geoscience',
    created: '2025-11-20T18:34:00Z',
    description: 'Standard color scheme for gold assays and exploration',
    attribute: 'color',
    type: 'numeric',
    method: 'manual',
    numClasses: 6,
    palette: 'Custom',
    ranges: [
        {
            min: 0,
            max: 0.5,
            label: '< 0.5',
            color: '#0000FF' // Blue
        },
        {
            min: 0.5,
            max: 1,
            label: '0.5 - 1',
            color: '#00FF00' // Green
        },
        {
            min: 1,
            max: 3,
            label: '1 - 3',
            color: '#FFFF00' // Yellow
        },
        {
            min: 3,
            max: 5,
            label: '3 - 5',
            color: '#FF8800' // Orange
        },
        {
            min: 5,
            max: 10,
            label: '5 - 10',
            color: '#FF0000' // Red
        },
        {
            min: 10,
            max: 1000,
            label: '> 10',
            color: '#FF00FF' // Magenta
        }
    ],
    metadata: {
        originalField: 'Au_ppm',
        originalMin: 0,
        originalMax: 1000,
        hint: 'Standard ranges for gold concentrations in ppm'
    }
};
