/**
 * Publication legend for the legend export dialog: the shared legend model
 * (class names as renamed, visible row counts) drawn by AttributeLegend.
 */
import { forwardRef, useMemo } from 'react';
import { AttributeLegend } from '../AttributeLegend';
import { buildLegendModel, LegendTab } from '../../utils/legendModel';
import { useStyleInputs } from '../../hooks/useStyleInputs';
import { useAppStore } from '../../store/appStore';

export interface LegendExportConfig {
    showColor: boolean;
    showShape: boolean;
    showSize: boolean;
    title?: string;
    orientation: 'horizontal' | 'vertical';
    fontSize: number;
    symbolSize: number;
    showCounts: boolean;
    /** Colour, shape and size in one list when the tabs share a field */
    combinedMode: boolean;
}

export const LegendExport = forwardRef<HTMLDivElement, { config: LegendExportConfig }>(({ config }, ref) => {
    const inputs = useStyleInputs();
    const columns = useAppStore(s => s.columns);
    const sections = useMemo(() => {
        void inputs; void columns;
        const tabs: LegendTab[] = [];
        if (config.showColor) tabs.push('color');
        if (config.showShape) tabs.push('shape');
        if (config.showSize) tabs.push('size');
        return buildLegendModel({ tabs, combined: config.combinedMode, counts: config.showCounts, hideEmpty: true });
    }, [inputs, columns, config.showColor, config.showShape, config.showSize, config.combinedMode, config.showCounts]);
    return (
        <AttributeLegend
            ref={ref}
            print
            sections={sections}
            title={config.title}
            orientation={config.orientation}
            fontSize={config.fontSize}
            symbolSize={config.symbolSize}
            scaleBySize={config.showSize}
        />
    );
});
LegendExport.displayName = 'LegendExport';

export default LegendExport;
