/** Drill tracking worked out from the store (utils/drillTrackRun), once for each change */
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useDrillTrackingStore } from '../../store/drillTrackingStore';
import { runTracking, type TrackingResult } from '../../utils/drillTrackRun';
import type { PlannedProgram } from '../../utils/plannedPrograms';

export interface Tracking extends TrackingResult {
    program: PlannedProgram | null;
}

export function useTracking(): Tracking {
    const { programs, live, tracking } = useDrillTrackingStore(useShallow(s => ({ programs: s.programs, live: s.live, tracking: s.tracking })));
    return useMemo(() => {
        const program = programs.find(p => p.id === tracking.programId) ?? null;
        const r = runTracking({
            program, live, manualLinks: tracking.manualLinks, activeOverride: tracking.activeOverride, custom: tracking.custom, rules: tracking.rules,
        });
        return { ...r, program };
    }, [programs, live, tracking]);
}
