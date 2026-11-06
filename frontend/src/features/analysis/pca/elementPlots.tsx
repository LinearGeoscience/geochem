import { ShowChart, Timeline, BarChart, GridOn } from '@mui/icons-material';
import type { PlotType } from '../../../store/appStore';

/** Plot types the picked elements can open in, with the setting that takes the columns */
export const ELEMENT_PLOTS: { type: PlotType; key: string; icon: JSX.Element }[] = [
    { type: 'spider', key: 'selectedElements', icon: <ShowChart fontSize="small" /> },
    { type: 'probability', key: 'selectedColumns', icon: <Timeline fontSize="small" /> },
    { type: 'histogram', key: 'selectedColumns', icon: <BarChart fontSize="small" /> },
    { type: 'splom', key: 'splomColumns', icon: <GridOn fontSize="small" /> },
];
