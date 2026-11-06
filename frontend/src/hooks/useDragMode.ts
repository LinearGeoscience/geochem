/** The app-wide plot drag tool (lasso / box / zoom / pan), set from the workspace toolbar or L/B/Z/P. */
import { useUIStore } from '../store/uiStore';

export const useDragMode = () => useUIStore(s => s.dragMode);
