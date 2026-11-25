/**
 * What a view of the model colours its samples and its logging tables by,
 * and how wide it draws each table: read and written the same way by the
 * Scene list and by the properties, so the two always agree.
 */
import { useCallback, useMemo } from 'react';
import { usePlotSetting } from '../../hooks/usePlotSetting';
import { useAppStore } from '../../store/appStore';
import { useModelStore } from '../../store/modelStore';
import type { HoleTable } from '../model/drillholes';
import { colourChoices, colouringOf, tableWidthOf, type ColourChoice } from '../model/loggingDisplay';
import { readSampleColouring, SAMPLE_COLOUR_SETTING, sampleColumnChoices, type SampleColouring, type SampleColumnChoice } from '../model/sampleColour';
import type { UnitMap } from '../model/types';
import { LOG_BESIDE_SETTING, LOG_COLOURS_SETTING, LOG_WIDTH_SETTING, LOG_WIDTHS_SETTING } from '../plots/viewer3d/useLoggingLayers';

const NO_MAPS: UnitMap[] = [];
const NO_COLOURS: Record<string, string> = {};
const NO_WIDTHS: Record<string, number | null> = {};
const NO_BESIDE: Record<string, boolean> = {};

/** What a view colours its samples by (null: as in the Attributes pane), and the setter */
export function useSampleColouring(viewId: string): [SampleColouring | null, (next: SampleColouring | null) => void] {
    const [saved, setSaved] = usePlotSetting<unknown>(viewId, SAMPLE_COLOUR_SETTING, null);
    const key = JSON.stringify(saved ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- by value
    const colouring = useMemo(() => readSampleColouring(saved), [key]);
    const set = useCallback((next: SampleColouring | null) => setSaved(next), [setSaved]);
    return [colouring, set];
}

/** The dataset's columns the samples can be coloured by */
export function useSampleColumnChoices(): SampleColumnChoice[] {
    const columns = useAppStore(s => s.columns);
    const mappings = useAppStore(s => s.geochemMappings);
    return useMemo(() => sampleColumnChoices(columns, mappings), [columns, mappings]);
}

/** What a view colours a table by (`units:<id>` or `column:<name>`), what it can be coloured by, and the setter */
export function useTableColouring(viewId: string, table: HoleTable): { value: string; choices: ColourChoice[]; set: (value: string) => void } {
    const maps = useModelStore(s => s.scene.unitMaps) ?? NO_MAPS;
    const [asked, setAsked] = usePlotSetting<Record<string, string>>(viewId, LOG_COLOURS_SETTING, NO_COLOURS);
    const choices = useMemo(() => colourChoices(table, maps), [table, maps]);
    const value = colouringOf(table, maps, asked[table.id]) ?? '';
    const set = useCallback((v: string) => setAsked(prev => ({ ...prev, [table.id]: v })), [setAsked, table.id]);
    return { value, choices, set };
}

/** How wide a view draws a table, m (null: automatic), and the setter (null: automatic for this table) */
export function useTableWidth(viewId: string, tableId: string): [number | null, (width: number | null) => void] {
    const [all] = usePlotSetting<number | null>(viewId, LOG_WIDTH_SETTING, null);
    const [widths, setWidths] = usePlotSetting<Record<string, number | null>>(viewId, LOG_WIDTHS_SETTING, NO_WIDTHS);
    const set = useCallback((w: number | null) => setWidths(prev => ({ ...prev, [tableId]: w })), [setWidths, tableId]);
    return [tableWidthOf(widths, all, tableId), set];
}

/** Whether a view draws a table beside the holes, clear of the samples (not round them), and the setter */
export function useTableBeside(viewId: string, tableId: string): [boolean, (beside: boolean) => void] {
    const [besides, setBesides] = usePlotSetting<Record<string, boolean>>(viewId, LOG_BESIDE_SETTING, NO_BESIDE);
    const set = useCallback((b: boolean) => setBesides(prev => ({ ...prev, [tableId]: b })), [setBesides, tableId]);
    return [besides[tableId] === true, set];
}
