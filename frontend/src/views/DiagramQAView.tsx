/**
 * Dev-only diagram QA sheet: `?qa=diagrams` (see main.tsx).
 *
 * Renders built-in diagrams as static Plotly cards so they can be reviewed
 * side by side and screenshotted by scripts/qa/renderDiagrams.mjs.
 *
 * Query parameters:
 *   page, per      paging (default 0, 12)
 *   cols, w, h     grid columns and card size in px (3, 520, 440)
 *   ids            comma-separated diagram ids (overrides paging)
 *   q              substring filter on id/name
 *   style          color | bw | minimal
 *   grid, ref      1 to show the grid / reference caption
 *
 * Exposes window.__qaReady (true when every card has rendered),
 * window.__qaIds (the ids on the page) and window.__qaImage(id, w, h, format)
 * → data URL, used for gallery thumbnails.
 */
import React, { useEffect, useRef, useState } from 'react';
import Plotly from 'plotly.js';
import type { Diagram, DiagramLibrary } from '../types/diagram';
import { buildDiagramLayer, DEFAULT_LAYER_OPTIONS, DiagramLayerOptions } from '../features/plots/classification/buildDiagramLayer';

declare global {
    interface Window {
        __qaReady?: boolean;
        __qaIds?: string[];
        __qaImage?: (id: string, w: number, h: number, format?: 'png' | 'webp' | 'svg', scale?: number) => Promise<string>;
    }
}

const params = new URLSearchParams(window.location.search);
const num = (k: string, dflt: number) => (params.has(k) ? Number(params.get(k)) : dflt);

function figure(d: Diagram, opts: DiagramLayerOptions) {
    const layer = buildDiagramLayer(d, opts);
    return {
        data: [...layer.background, ...layer.foreground],
        layout: { ...layer.layout, annotations: layer.annotations },
    };
}

const Card: React.FC<{ d: Diagram; w: number; h: number; opts: DiagramLayerOptions; onDone: (id: string) => void }> = ({ d, w, h, opts, onDone }) => {
    const ref = useRef<HTMLDivElement>(null);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        try {
            const f = figure(d, opts);
            Plotly.newPlot(el, f.data as any, { ...f.layout, width: w, height: h } as any, { staticPlot: true, displayModeBar: false })
                .then(() => onDone(d.id), (e: unknown) => { setError(String(e)); onDone(d.id); });
        } catch (e) {
            setError(String(e));
            onDone(d.id);
        }
        return () => { Plotly.purge(el); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [d, w, h]);
    return (
        <div style={{ border: '1px solid #ccc', background: '#fff' }}>
            <div ref={ref} style={{ width: w, height: h }} />
            <div style={{ font: '11px monospace', padding: '2px 4px', background: error ? '#fdd' : '#f4f4f4', color: '#333', width: w - 8, overflow: 'hidden', whiteSpace: 'nowrap' }}>
                {d.id}{error ? ` — ERROR ${error}` : ''}
            </div>
        </div>
    );
};

const DiagramQAView: React.FC = () => {
    const [diagrams, setDiagrams] = useState<Diagram[] | null>(null);
    const done = useRef(new Set<string>());

    const opts: DiagramLayerOptions = {
        ...DEFAULT_LAYER_OPTIONS,
        style: (params.get('style') as DiagramLayerOptions['style']) || 'color',
        showGrid: params.get('grid') === '1',
        showReference: params.get('ref') === '1',
    };

    useEffect(() => {
        import('../data/classificationDiagrams.json').then(mod => {
            const lib = ((mod as any).default ?? mod) as DiagramLibrary;
            const all = lib.diagrams.filter(d => d.kind !== 'builtin');
            const byId = new Map(all.map(d => [d.id, d]));
            window.__qaImage = async (id, w, h, format = 'png', scale = 1) => {
                const d = byId.get(id);
                if (!d) throw new Error(`unknown diagram ${id}`);
                const f = figure(d, { ...opts, fontScale: params.has('fs') ? Number(params.get('fs')) : 1 });
                const div = document.createElement('div');
                document.body.appendChild(div);
                try {
                    await Plotly.newPlot(div, f.data as any, { ...f.layout, width: w, height: h } as any, { staticPlot: true });
                    return await Plotly.toImage(div, { format, width: w, height: h, scale } as any);
                } finally {
                    Plotly.purge(div);
                    div.remove();
                }
            };
            let list = all;
            if (params.get('ids')) {
                const ids = params.get('ids')!.split(',');
                list = ids.map(id => byId.get(id)).filter((d): d is Diagram => !!d);
            } else {
                const q = params.get('q')?.toLowerCase();
                if (q) list = list.filter(d => d.id.includes(q) || d.name.toLowerCase().includes(q));
                const per = num('per', 12), page = num('page', 0);
                if (per > 0) list = list.slice(page * per, (page + 1) * per);
            }
            window.__qaIds = list.map(d => d.id);
            if (!list.length) window.__qaReady = true;
            setDiagrams(list);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (!diagrams) return <div style={{ padding: 16 }}>Loading diagrams…</div>;
    const w = num('w', 520), h = num('h', 440), cols = num('cols', 3);
    const onDone = (id: string) => {
        done.current.add(id);
        if (done.current.size >= diagrams.length) window.__qaReady = true;
    };
    return (
        <div id="qa-sheet" style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, ${w + 2}px)`, gap: 6, padding: 6, background: '#ddd', width: 'max-content' }}>
            {diagrams.map(d => <Card key={d.id} d={d} w={w} h={h} opts={opts} onDone={onDone} />)}
        </div>
    );
};

export default DiagramQAView;
