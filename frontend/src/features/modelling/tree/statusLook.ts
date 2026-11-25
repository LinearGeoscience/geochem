/**
 * How the state of an object is shown wherever it is listed (the project
 * tree, the Scene tab): an icon and its colour. What it says in words is
 * `statusTip` (features/model/treeRules).
 */
import { ErrorOutline, HourglassEmpty, Update, WarningAmber } from '@mui/icons-material';
import type { NodeStatus } from '../../model/projectTree';

export const STATUS: Record<NodeStatus, { color: string; Icon: typeof ErrorOutline }> = {
    fitting: { color: 'text.secondary', Icon: HourglassEmpty },
    failed: { color: 'error.main', Icon: ErrorOutline },
    empty: { color: 'warning.main', Icon: WarningAmber },
    missing: { color: 'error.main', Icon: WarningAmber },
    stale: { color: 'info.main', Icon: Update },
    problem: { color: 'warning.main', Icon: WarningAmber },
};
