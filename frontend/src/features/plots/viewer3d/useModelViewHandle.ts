/**
 * A 3D view puts itself in the view registry (features/model/viewRegistry):
 * its status as it changes, and its actions, always the latest.
 */
import { useEffect, useRef } from 'react';
import { registerView, setViewStatus, unregisterView, type ViewActions, type ViewStatus } from '../../model/viewRegistry';

export function useModelViewHandle(status: ViewStatus, actions: ViewActions): void {
    const ref = useRef(actions);
    ref.current = actions;
    const id = status.plotId;
    useEffect(() => {
        registerView(id, ref);
        return () => unregisterView(id, ref);
    }, [id]);
    // Compared field by field in the registry: an unchanged status changes nothing
    useEffect(() => { setViewStatus(id, status); });
}
