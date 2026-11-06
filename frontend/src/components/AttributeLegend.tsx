/**
 * Legend renderer shared by the legend export, the on-plot legend and the
 * report: draws a buildLegendModel() result. Plain DOM + SVG so it captures
 * cleanly to PNG/SVG.
 */
import { forwardRef } from 'react';
import { Box } from '@mui/material';
import { ShapeMarker } from './ShapeMarker';
import type { LegendSection } from '../utils/legendModel';

export interface AttributeLegendProps {
    sections: LegendSection[];
    title?: string;
    orientation?: 'vertical' | 'horizontal';
    fontSize?: number;
    symbolSize?: number;
    /** Scale symbols by their class size */
    scaleBySize?: boolean;
    /** Paper look for export (white, Arial) vs. theme colours on screen */
    print?: boolean;
}

export const AttributeLegend = forwardRef<HTMLDivElement, AttributeLegendProps>(({
    sections, title, orientation = 'vertical', fontSize = 12, symbolSize = 14, scaleBySize = true, print = false,
}, ref) => {
    const horizontal = orientation === 'horizontal';
    const font = print ? 'Arial, sans-serif' : undefined;
    const ink = print ? '#222' : 'text.primary';
    const muted = print ? '#666' : 'text.secondary';
    return (
        <Box ref={ref} sx={{ display: 'inline-block', bgcolor: print ? '#fff' : 'transparent', p: print ? 2 : 0, fontFamily: font, color: ink }}>
            {title && <Box sx={{ fontSize: fontSize * 1.2, fontWeight: 700, mb: 1 }}>{title}</Box>}
            <Box sx={{ display: 'flex', flexDirection: horizontal ? 'row' : 'column', gap: horizontal ? 3 : 1.25, flexWrap: 'wrap' }}>
                {sections.map(s => (
                    <Box key={s.key}>
                        {(sections.length > 1 || !title) && (
                            <Box sx={{ fontSize, fontWeight: 700, mb: 0.5, pb: 0.25, borderBottom: '1px solid', borderColor: print ? '#ccc' : 'divider' }}>
                                {s.title}
                            </Box>
                        )}
                        {s.ramp && (
                            <Box sx={{ mb: 0.5 }}>
                                <Box sx={{ height: symbolSize * 0.8, width: Math.max(120, symbolSize * 10), background: `linear-gradient(to right, ${s.ramp.colors.join(', ')})` }} />
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: fontSize * 0.85, color: muted }}>
                                    <span>{s.ramp.min}</span><span>{s.ramp.max}</span>
                                </Box>
                            </Box>
                        )}
                        <Box sx={{ display: 'flex', flexDirection: horizontal && sections.length === 1 ? 'row' : 'column', flexWrap: 'wrap', columnGap: 1.5, rowGap: `${fontSize * 0.35}px` }}>
                            {!s.ramp && s.items.map(it => {
                                const sz = scaleBySize && it.size ? Math.max(6, Math.min(symbolSize * 2, symbolSize * (it.size / 8))) : symbolSize;
                                return (
                                    <Box key={it.id} sx={{ display: 'flex', alignItems: 'center', gap: `${fontSize * 0.5}px`, fontSize, lineHeight: 1.2 }}>
                                        <Box sx={{ width: Math.max(symbolSize, sz), display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                                            <ShapeMarker shape={it.shape ?? 'circle'} color={it.color ?? '#808080'} size={sz} />
                                        </Box>
                                        <span style={{ whiteSpace: 'nowrap' }}>{it.label}</span>
                                        {it.count !== undefined && (
                                            <Box component="span" sx={{ color: muted, fontSize: fontSize * 0.85, fontVariantNumeric: 'tabular-nums' }}>
                                                ({it.count.toLocaleString()})
                                            </Box>
                                        )}
                                    </Box>
                                );
                            })}
                        </Box>
                    </Box>
                ))}
            </Box>
        </Box>
    );
});
AttributeLegend.displayName = 'AttributeLegend';
