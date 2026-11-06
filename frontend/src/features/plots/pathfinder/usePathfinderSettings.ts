/**
 * Persisted PathfinderMap settings (one usePlotSetting per key).
 *
 * Key names and defaults match the pre-refactor component exactly, because
 * saved projects store these settings. Default arrays/objects are module
 * constants so unset settings keep a stable identity across renders.
 */
import { usePlotSetting } from '../../../hooks/usePlotSetting';
import { useDragMode } from '../../../hooks/useDragMode';
import type { MapViewStyle } from '../../../utils/basemapUtils';
import type { AxisModes, SliceConfig } from '../../../components/AxisRangeControl';
import type { PathfinderElement, AnomalyClass } from '../../../utils/calculations/pathfinderConstants';
import type { ReferenceStandardId } from '../../../utils/calculations/elementBackgroundConstants';
import type {
    NormalizationType, MapMode, DragMode, ElementColumnMapping, ExtendedElementColumnMapping, AxisRanges3D,
} from './types';

const NO_ELEMENTS: PathfinderElement[] = [];
const NO_STRINGS: string[] = [];
const DEFAULT_VISIBLE_CLASSES: AnomalyClass[] = ['background', '2x', '3x', '5x', '10x'];
const NO_MAPPING: ElementColumnMapping = {};
const NO_EXTENDED_MAPPING: ExtendedElementColumnMapping = {};
const NO_BACKGROUNDS: Record<string, number> = {};
const DEFAULT_AXIS_MODES: AxisModes = { x: 'range', y: 'range', z: 'range' };
const ZERO_SLICE: SliceConfig = { x: 0, y: 0, z: 0 };

export function usePathfinderSettings(plotId: string) {
    const [xAxis, setXAxis] = usePlotSetting<string>(plotId, 'xAxis', '');
    const [yAxis, setYAxis] = usePlotSetting<string>(plotId, 'yAxis', '');
    const [zAxis, setZAxis] = usePlotSetting<string>(plotId, 'zAxis', '');
    const [is3D, setIs3D] = usePlotSetting<boolean>(plotId, 'is3D', false);
    const [equalAxes, setEqualAxes] = usePlotSetting<boolean>(plotId, 'equalAxes', true);
    const [selectedElements, setSelectedElements] = usePlotSetting<PathfinderElement[]>(plotId, 'selectedElements', NO_ELEMENTS);
    const [normalization, setNormalization] = usePlotSetting<NormalizationType>(plotId, 'normalization', 'none');
    const [visibleClasses, setVisibleClasses] = usePlotSetting<AnomalyClass[]>(plotId, 'visibleClasses', DEFAULT_VISIBLE_CLASSES);
    const [controlsExpanded, setControlsExpanded] = usePlotSetting<boolean>(plotId, 'controlsExpanded', true);
    const [showProbabilityPlots, setShowProbabilityPlots] = usePlotSetting<boolean>(plotId, 'showProbabilityPlots', true);

    // Column mappings
    const [elementColumnMapping, setElementColumnMapping] = usePlotSetting<ElementColumnMapping>(plotId, 'elementColumnMapping', NO_MAPPING);
    const [scColumn, setScColumn] = usePlotSetting<string>(plotId, 'scColumn', '');
    const [kColumn, setKColumn] = usePlotSetting<string>(plotId, 'kColumn', '');

    // Basemap / view
    const [mapViewStyle, setMapViewStyle] = usePlotSetting<MapViewStyle>(plotId, 'mapViewStyle', 'normal');
    const [epsgCode, setEpsgCode] = usePlotSetting<string>(plotId, 'epsgCode', '');
    const [basemapOpacity, setBasemapOpacity] = usePlotSetting<number>(plotId, 'basemapOpacity', 0.7);
    // The workspace toolbar's tool unless this plot picked its own
    const globalDragMode = useDragMode();
    const [plotDragMode, setDragMode] = usePlotSetting<DragMode | null>(plotId, 'dragMode', null);
    const dragMode: DragMode = plotDragMode ?? globalDragMode;
    const [basePointSize, setBasePointSize] = usePlotSetting<number>(plotId, 'basePointSize', 6);

    // 3D axis range controls
    const [axisRanges3D, setAxisRanges3D] = usePlotSetting<AxisRanges3D | null>(plotId, 'axisRanges3D', null);
    const [axisModes3D, setAxisModes3D] = usePlotSetting<AxisModes>(plotId, 'axisModes3D', DEFAULT_AXIS_MODES);
    const [sliceWidths3D, setSliceWidths3D] = usePlotSetting<SliceConfig>(plotId, 'sliceWidths3D', ZERO_SLICE);
    const [slicePositions3D, setSlicePositions3D] = usePlotSetting<SliceConfig>(plotId, 'slicePositions3D', ZERO_SLICE);
    const [rangeControlsExpanded, setRangeControlsExpanded] = usePlotSetting<boolean>(plotId, 'rangeControlsExpanded', true);

    // Extended element mode
    const [mapMode, setMapMode] = usePlotSetting<MapMode>(plotId, 'mapMode', 'pathfinder');
    const [referenceStandard, setReferenceStandard] = usePlotSetting<ReferenceStandardId>(plotId, 'referenceStandard', 'ucc-rudnick-gao-2003');
    const [selectedExtendedElements, setSelectedExtendedElements] = usePlotSetting<string[]>(plotId, 'selectedExtendedElements', NO_STRINGS);
    const [customBackgrounds, setCustomBackgrounds] = usePlotSetting<Record<string, number>>(plotId, 'customBackgrounds', NO_BACKGROUNDS);
    // Read-only for now (reserved for a future extended column-mapping UI)
    const [extendedColumnMapping] = usePlotSetting<ExtendedElementColumnMapping>(plotId, 'extendedColumnMapping', NO_EXTENDED_MAPPING);

    return {
        xAxis, setXAxis, yAxis, setYAxis, zAxis, setZAxis,
        is3D, setIs3D, equalAxes, setEqualAxes,
        selectedElements, setSelectedElements,
        normalization, setNormalization,
        visibleClasses, setVisibleClasses,
        controlsExpanded, setControlsExpanded,
        showProbabilityPlots, setShowProbabilityPlots,
        elementColumnMapping, setElementColumnMapping,
        scColumn, setScColumn, kColumn, setKColumn,
        mapViewStyle, setMapViewStyle, epsgCode, setEpsgCode,
        basemapOpacity, setBasemapOpacity, dragMode, setDragMode,
        basePointSize, setBasePointSize,
        axisRanges3D, setAxisRanges3D, axisModes3D, setAxisModes3D,
        sliceWidths3D, setSliceWidths3D, slicePositions3D, setSlicePositions3D,
        rangeControlsExpanded, setRangeControlsExpanded,
        mapMode, setMapMode, referenceStandard, setReferenceStandard,
        selectedExtendedElements, setSelectedExtendedElements,
        customBackgrounds, setCustomBackgrounds,
        extendedColumnMapping,
    };
}

export type PathfinderSettings = ReturnType<typeof usePathfinderSettings>;
