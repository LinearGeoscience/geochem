/**
 * attribute legends (.gat, Attribute Manager > Load / Save Attributes):
 * named colour, shape and size groups with no rows. Loading one gives an
 * empty group per name to paint into; with a legend loaded, Auto-Attribute
 * on a text column takes the legend's colours for matching names
 * ("use existing legend").
 */
import type { AttributeEntry, AttributeType } from '../store/attributeStore';
import { interopShape, interopSize } from './interopAttributes';

export interface LegendEntry {
    name: string;
    hex?: string;
    shape?: string;
    size?: number;
    visible: boolean;
}

export interface Legend {
    name: string;
    color: LegendEntry[];
    shape: LegendEntry[];
    size: LegendEntry[];
}

const text = (el: Element, tag: string) => el.getElementsByTagName(tag)[0]?.textContent?.trim() ?? '';
const signedToHex = (v: number) => `#${((v >>> 0) & 0xffffff).toString(16).padStart(6, '0')}`;
const hexToSigned = (hex: string) => (parseInt(hex.replace('#', ''), 16) | 0xff000000) | 0;

/** Parse a .gat file. Default entries are kept first in each list. */
export function parseGat(xml: string, name = 'Legend'): Legend {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror')[0] || doc.documentElement.tagName !== 'GASAttributeData') {
        throw new Error('Not a attribute legend (.gat)');
    }
    const list = (group: string, item: string, read: (el: Element) => Partial<LegendEntry>) =>
        Array.from(doc.getElementsByTagName(group)[0]?.getElementsByTagName(item) ?? []).map(el => ({
            name: text(el, 'name'),
            visible: text(el, 'visible') !== 'false',
            ...read(el),
        })).filter(e => e.name);
    return {
        name,
        color: list('colourAttributes', 'colourAttribute', el => ({ hex: signedToHex(Number(text(el, 'colour')) || 0) })),
        shape: list('shapeAttributes', 'shapeAttribute', el => ({ shape: interopShape(Number(text(el, 'shape')) || 0) })),
        size: list('sizeAttributes', 'sizeAttribute', el => ({ size: interopSize(Number(text(el, 'size')) || 4) })),
    };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const SHAPES = ['circle', 'square', 'triangle-up', 'triangle-down', 'diamond', 'cross', 'x', 'star', 'pentagon', 'hexagon', 'triangle-left', 'triangle-right', 'hourglass'];

/** Current Attribute Manager rows as a .gat file can load. */
export function toGat(entries: Partial<Record<AttributeType, AttributeEntry[]>>): string {
    const block = (group: string, item: string, list: AttributeEntry[] | undefined, body: (e: AttributeEntry) => string) =>
        `   <${group}>\n      <title></title>\n${(list ?? []).map(e =>
            `      <${item}>\n         <name>${esc(e.name)}</name>\n${body(e)}         <visible>${e.visible !== false}</visible>\n      </${item}>\n`).join('')}   </${group}>\n`;
    return '<?xml version="1.0" encoding="UTF-8"?>\n<GASAttributeData>\n'
        + block('colourAttributes', 'colourAttribute', entries.color, e => `         <colour>${hexToSigned(e.color ?? '#000000')}</colour>\n`)
        + block('shapeAttributes', 'shapeAttribute', entries.shape, e => {
            const k = Math.max(0, SHAPES.indexOf(e.shape ?? 'circle'));
            return `         <shape>${k}</shape>\n         <filled>true</filled>\n         <shapeCode>${k}</shapeCode>\n`;
        })
        + block('sizeAttributes', 'sizeAttribute', entries.size, e => `         <size>${Math.max(1, Math.round((e.size ?? 8) / 2))}</size>\n`)
        + '</GASAttributeData>\n';
}

const key = (s: string) => s.trim().toLowerCase();

/** Restyle entries whose names are in the legend (default entries match "Default ..."). */
export function applyLegendStyles(tab: AttributeType, entries: AttributeEntry[], legend: Legend | null): AttributeEntry[] {
    if (!legend || tab === 'filter') return entries;
    const byName = new Map(legend[tab].map(e => [key(e.name), e]));
    const def = legend[tab].find(e => /^default/i.test(e.name));
    return entries.map(e => {
        const l = e.isDefault ? def : byName.get(key(e.name));
        if (!l) return e;
        if (tab === 'color' && l.hex) return { ...e, color: l.hex };
        if (tab === 'shape' && l.shape) return { ...e, shape: l.shape };
        if (tab === 'size' && l.size) return { ...e, size: l.size };
        return e;
    });
}
