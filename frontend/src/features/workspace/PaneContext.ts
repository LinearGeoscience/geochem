/**
 * Set by a dock pane around its content so components inside can maximise
 * the pane (ExpandablePlotWrapper) and size themselves to it (useFillHeight).
 */
import { createContext, useContext } from 'react';

export interface PaneControls {
    maximize: () => void;
    restore: () => void;
    isMaximized: () => boolean;
}

export interface PaneInfo extends PaneControls {
    /** The pane's scrolling body element. */
    body: HTMLElement | null;
    width: number;
    height: number;
}

export const PaneContext = createContext<PaneInfo | null>(null);

export const usePane = () => useContext(PaneContext);

/** Panes shorter than this (tiled plots) fold the axis pickers away so the chart keeps the room */
export const COMPACT_PANE_HEIGHT = 480;
export const isCompactPane = (pane: PaneInfo | null) => !!pane && pane.height > 0 && pane.height < COMPACT_PANE_HEIGHT;
