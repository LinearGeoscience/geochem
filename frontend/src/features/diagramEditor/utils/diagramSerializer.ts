/**
 * JSON import/export for classification diagrams
 */

import { ClassificationDiagram } from '../../../types/classificationDiagram';

/**
 * Export a diagram as a JSON file download
 */
export function exportDiagramJson(diagram: ClassificationDiagram): void {
    const json = JSON.stringify(
        { diagrams: [diagram], totalDiagrams: 1 },
        null,
        2
    );
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `${diagram.name.replace(/[^a-zA-Z0-9]/g, '_')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Import a diagram from JSON string.
 * Returns null if invalid.
 */
export function importDiagramJson(json: string): ClassificationDiagram | null {
    try {
        const parsed = JSON.parse(json);

        // Support both single diagram and array format
        let diagram: ClassificationDiagram;
        if (parsed.diagrams && Array.isArray(parsed.diagrams) && parsed.diagrams.length > 0) {
            diagram = parsed.diagrams[0];
        } else if (parsed.id && parsed.name && parsed.type) {
            diagram = parsed;
        } else {
            return null;
        }

        // Validate minimum required fields
        if (!diagram.name || !diagram.type || !diagram.polygons) {
            return null;
        }

        if (diagram.type !== 'ternary' && diagram.type !== 'xy') {
            return null;
        }

        return diagram;
    } catch {
        return null;
    }
}

/**
 * Export multiple diagrams as a JSON file download
 */
export function exportMultipleDiagramsJson(diagrams: ClassificationDiagram[]): void {
    const json = JSON.stringify(
        { diagrams, totalDiagrams: diagrams.length },
        null,
        2
    );
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'custom_classification_diagrams.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
