/**
 * Saved classes: named class schemes of one Attribute Manager tab (breaks or
 * category values with their colours / shapes / sizes, names and visibility).
 * Kept in the browser across projects and datasets, so grade bins or
 * lithology colours made once can be put back on any dataset; also moved
 * between machines as a .json file. No row indices: a scheme describes
 * classes, not rows.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AttributeEntry, AttributeType, ClassificationMethod } from './attributeStore';

export interface ClassScheme {
    id: string;
    name: string;
    created: string;
    tab: AttributeType;
    /** range: numeric breaks; category: one class per value */
    kind: 'range' | 'category';
    /** Field the classes were made on (applied to it when the dataset has it) */
    field: string;
    additionalFields: string[];
    method: ClassificationMethod;
    numClasses: number;
    palette: string;
    reversed?: boolean;
    sizeRange?: [number, number];
    /** The Default row and the classes, in legend order */
    entries: AttributeEntry[];
}

interface ClassSchemeState {
    schemes: ClassScheme[];
    /** Add a scheme; one with the same name on the same tab is replaced */
    save: (scheme: ClassScheme) => void;
    remove: (id: string) => void;
    /** Add schemes from a file (same name + tab replaces); returns how many were read */
    importSchemes: (json: string) => number;
    exportSchemes: () => string;
}

const FILE_KIND = 'geochem-class-schemes';

function isScheme(s: any): s is ClassScheme {
    return !!s && typeof s.name === 'string' && typeof s.field === 'string'
        && ['color', 'shape', 'size', 'filter'].includes(s.tab)
        && (s.kind === 'range' || s.kind === 'category')
        && Array.isArray(s.entries) && s.entries.every((e: any) => e && typeof e.name === 'string' && typeof e.type === 'string');
}

const replaceByName = (list: ClassScheme[], s: ClassScheme) =>
    [...list.filter(x => !(x.tab === s.tab && x.name === s.name)), s];

export const useClassSchemeStore = create<ClassSchemeState>()(
    persist(
        (set, get) => ({
            schemes: [],
            save: (scheme) => set({ schemes: replaceByName(get().schemes, scheme) }),
            remove: (id) => set({ schemes: get().schemes.filter(s => s.id !== id) }),
            importSchemes: (json) => {
                let data: any;
                try { data = JSON.parse(json); } catch { return 0; }
                if (!data || data.kind !== FILE_KIND || !Array.isArray(data.schemes)) return 0;
                const read: ClassScheme[] = data.schemes.filter(isScheme);
                if (!read.length) return 0;
                set({ schemes: read.reduce(replaceByName, get().schemes) });
                return read.length;
            },
            exportSchemes: () => JSON.stringify({ kind: FILE_KIND, version: 1, schemes: get().schemes }, null, 2),
        }),
        { name: 'class-schemes', version: 1 },
    ),
);
