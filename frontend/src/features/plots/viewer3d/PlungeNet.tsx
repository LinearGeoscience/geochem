/**
 * One net of the plunge scan drawn as a stereonet (equal area, lower
 * hemisphere, north up). Bright: looking down that way, the highs of
 * different holes stack on top of each other more than the drilling alone
 * would make them; grey: the drilling cannot see that way. The scan's answer
 * is ringed; the line the view looks along now is a cross. Clicking a place
 * looks down it.
 */
import React, { useMemo, useState } from 'react';
import { greatCircle, netDirection, netPoint, plungeOf, scanDirections, type PlungeNet as Net, type Vec3 } from '../../model/plungeScan';

/** Viridis, dark to bright */
const STOPS = [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]];
function netColour(t: number): string {
    const x = Math.min(0.9999, Math.max(0, t)) * 4, k = Math.floor(x), f = x - k;
    return `rgb(${[0, 1, 2].map(c => Math.round(STOPS[k][c] + (STOPS[k + 1][c] - STOPS[k][c]) * f)).join(',')})`;
}
const BLIND = '#6b6b6b';
export const ANSWER = '#ff3d7f';

/** The range of the colours: from the usual (or 1, chance) to the peak */
function netRange(net: Net): [number, number] {
    const lo = Math.min(net.rest, 1);
    return [lo, Math.max(net.peak, net.rest * 2, 2)];
}

const bearing = (t: number) => String(Math.round(t) % 360).padStart(3, '0');

interface Props {
    net: Net;
    size: number;
    /** The line the view looks along now (pointing down), or null */
    looking?: Vec3 | null;
    /** Draw the plane the bright band follows, when it is a band */
    showBand?: boolean;
    /** Looked down this way (clicked) */
    onPick?: (direction: Vec3) => void;
    /** Thin outline (small nets) or none */
    ring?: string;
    title?: string;
}

export const PlungeNet: React.FC<Props> = ({ net, size, looking = null, showBand = false, onPick, ring = '#888', title }) => {
    const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);
    const R = size / 2 - 3, c = size / 2;
    const id = useMemo(() => `net${Math.random().toString(36).slice(2)}`, []);
    const dots = useMemo(() => {
        const [lo, hi] = netRange(net);
        const r = Math.max(1.2, size * 0.019);
        return scanDirections().map((d, i) => {
            const [x, y] = netPoint(d);
            return <circle key={i} cx={(c + x * R).toFixed(1)} cy={(c + y * R).toFixed(1)} r={r.toFixed(2)} fill={net.seen[i] ? netColour((net.ratio[i] - lo) / (hi - lo)) : BLIND} />;
        });
    }, [net, size, c, R]);
    const band = useMemo(() => {
        if (!showBand || !net.pole || net.band < 0.5) return null;
        return greatCircle(net.pole).map(([x, y], i) => `${i ? 'L' : 'M'}${(c + x * R).toFixed(1)},${(c + y * R).toFixed(1)}`).join(' ');
    }, [showBand, net, c, R]);
    const mark = (v: Vec3 | null) => (v ? netPoint(v) : null);
    const answer = mark(net.axis), now = mark(looking);

    const where = (e: React.MouseEvent<SVGSVGElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = (e.clientX - rect.left - c) / R, y = (e.clientY - rect.top - c) / R;
        return { x, y, dir: netDirection(x, y), px: e.clientX - rect.left, py: e.clientY - rect.top };
    };
    const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
        const w = where(e);
        if (!w.dir) { setHover(null); return; }
        const { plunge, trend } = plungeOf(w.dir);
        // The value of the nearest direction
        let best = 0, bestDot = -1;
        scanDirections().forEach((d, i) => { const v = Math.abs(d[0] * w.dir![0] + d[1] * w.dir![1] + d[2] * w.dir![2]); if (v > bestDot) { bestDot = v; best = i; } });
        const value = net.seen[best] ? `${net.ratio[best].toFixed(1)}× chance` : 'the drilling cannot see this way';
        setHover({ x: w.px, y: w.py, text: `${Math.round(plunge)}° → ${bearing(trend)}° · ${value}` });
    };

    return (
        <span style={{ position: 'relative', display: 'inline-block', width: size, height: size }} title={title}>
            <svg
                width={size} height={size} viewBox={`0 0 ${size} ${size}`} role={onPick ? 'button' : 'img'}
                aria-label={title ?? 'Stereonet of the plunge scan'}
                style={{ cursor: onPick ? 'crosshair' : undefined, display: 'block' }}
                onMouseMove={onPick ? onMove : undefined} onMouseLeave={() => setHover(null)}
                onClick={onPick ? (e) => { const w = where(e); if (w.dir) onPick(w.dir); } : undefined}
            >
                <clipPath id={id}><circle cx={c} cy={c} r={R} /></clipPath>
                <g clipPath={`url(#${id})`}><rect width={size} height={size} fill={BLIND} />{dots}</g>
                <circle cx={c} cy={c} r={R} fill="none" stroke={ring} strokeWidth={ring === '#888' ? 1 : 2} />
                {size >= 120 && <text x={c} y={11} fontSize={10} textAnchor="middle" fill="#bbb" style={{ pointerEvents: 'none' }}>N</text>}
                {band && <path d={band} fill="none" stroke="#fff" strokeWidth={1} strokeDasharray="4 3" opacity={0.8} clipPath={`url(#${id})`} />}
                {answer && <circle data-testid="net-answer" cx={c + answer[0] * R} cy={c + answer[1] * R} r={Math.max(3, size * 0.035)} fill="none" stroke={ANSWER} strokeWidth={size >= 120 ? 2.2 : 1.4} />}
                {now && (
                    <g data-testid="net-looking" stroke="#fff" strokeWidth={1.6} style={{ pointerEvents: 'none' }}>
                        <line x1={c + now[0] * R - 6} y1={c + now[1] * R} x2={c + now[0] * R + 6} y2={c + now[1] * R} />
                        <line x1={c + now[0] * R} y1={c + now[1] * R - 6} x2={c + now[0] * R} y2={c + now[1] * R + 6} />
                    </g>
                )}
            </svg>
            {hover && (
                <span style={{ position: 'absolute', left: Math.min(hover.x + 10, size - 150), top: hover.y + 12, background: 'rgba(20,20,20,0.88)', color: '#fff', fontSize: 11, padding: '2px 6px', borderRadius: 4, whiteSpace: 'nowrap', pointerEvents: 'none' }}>
                    {hover.text}
                </span>
            )}
        </span>
    );
};
