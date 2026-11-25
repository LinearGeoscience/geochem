/**
 * The 3D viewer's clip box and slices while they are being changed.
 *
 * Dragging a slice's scrubber or stepping it with the wheel changes it on every
 * frame. Held in React state at the top of the viewer, each change re-rendered
 * the whole toolbar (tens of milliseconds); held here, a change reaches only
 * the listeners that need it: the viewport (a few uniforms) and the slice bar.
 * The viewer itself follows the `outline`, which changes only when a slice is
 * added or removed, slicing is switched, or the clip box changes.
 */
import { useSyncExternalStore } from 'react';
import { ClipSettings } from './slices';

/** What the viewer's toolbar and settings show; a new object only when one of these changes. */
export interface ClipOutline {
    boxEnabled: boolean;
    box: ClipSettings['box'];
    slicing: boolean;
    sliceCount: number;
}

const outlineOf = (c: ClipSettings): ClipOutline => ({
    boxEnabled: c.boxEnabled, box: c.box, slicing: c.slicing && c.slices.length > 0, sliceCount: c.slices.length,
});

export class LiveClip {
    private value: ClipSettings;
    private outline: ClipOutline;
    private readonly listeners = new Set<() => void>();

    constructor(initial: ClipSettings) {
        this.value = initial;
        this.outline = outlineOf(initial);
    }

    readonly get = (): ClipSettings => this.value;
    readonly getOutline = (): ClipOutline => this.outline;

    set(next: ClipSettings) {
        if (next === this.value) return;
        this.value = next;
        const o = outlineOf(next), p = this.outline;
        if (o.boxEnabled !== p.boxEnabled || o.box !== p.box || o.slicing !== p.slicing || o.sliceCount !== p.sliceCount) this.outline = o;
        for (const fn of [...this.listeners]) fn();
    }

    readonly subscribe = (fn: () => void): (() => void) => {
        this.listeners.add(fn);
        return () => { this.listeners.delete(fn); };
    };
}

/** Every change (the slice bar). */
export const useLiveClip = (clip: LiveClip): ClipSettings => useSyncExternalStore(clip.subscribe, clip.get);
/** Only the outline (the viewer's toolbar). */
export const useClipOutline = (clip: LiveClip): ClipOutline => useSyncExternalStore(clip.subscribe, clip.getOutline);
