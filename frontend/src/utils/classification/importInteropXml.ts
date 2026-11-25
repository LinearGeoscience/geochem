/**
 * Import user diagram XML files as custom diagrams. The v3 original is
 * kept on the diagram (curves, labels, expression chains) next to the legacy
 * fields the diagram editor understands.
 */
import type { ClassificationDiagram } from '../../types/classificationDiagram';
import { decodeInteropXml, parseInteropDiagram } from './interopXml';
import { toLegacyDiagram } from './legacyAdapter';

export interface XmlImportResult {
    imported: ClassificationDiagram[];
    errors: string[];
}

export function customDiagramFromXml(xml: string, fileName: string): ClassificationDiagram {
    const v3 = parseInteropDiagram(xml, { sourceFile: fileName, category: ['Imported'] });
    if (v3.kind === 'builtin') throw new Error(`${fileName}: built-in plots (${v3.builtin ?? 'action'}) cannot be imported`);
    const id = `custom-xml-${v3.id}`;
    const diagram = { ...v3, id, category: ['Imported'] };
    const legacy = toLegacyDiagram(diagram);
    if (!legacy) throw new Error(`${fileName}: unsupported diagram`);
    return { ...legacy, id, category: 'Imported', v3: diagram };
}

export async function importInteropXmlFiles(files: File[]): Promise<XmlImportResult> {
    const imported: ClassificationDiagram[] = [];
    const errors: string[] = [];
    for (const f of files) {
        try {
            const xml = decodeInteropXml(await f.arrayBuffer());
            imported.push(customDiagramFromXml(xml, f.name));
        } catch (e) {
            errors.push(e instanceof Error ? e.message : `${f.name}: ${String(e)}`);
        }
    }
    return { imported, errors };
}
