/**
 * App-wide keyboard shortcuts. The browser reserves Ctrl+N/W/Tab/1-8, so
 * workspace commands use Alt. `resolveShortcut` is pure (tested); handlers
 * that need component state (save/open dialogs, inline rename) register
 * themselves with `registerShortcut`.
 */

export type ShortcutAction =
    | 'save' | 'saveAs' | 'open' | 'undo' | 'redo'
    | 'newPlot' | 'closePlot' | 'duplicatePlot' | 'nextPlot' | 'prevPlot' | 'renamePlot'
    | `activatePlot${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`
    | 'toggleGrid' | 'toggleAttributes' | 'toggleWorkflows' | 'addToReport'
    | 'toolLasso' | 'toolBox' | 'toolZoom' | 'toolPan'
    | 'clearSelection';

export interface KeyLike {
    key: string;
    code?: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
}

export function isTextInput(el: EventTarget | null): boolean {
    if (!el || !(el as HTMLElement).tagName) return false;
    const h = el as HTMLElement;
    const tag = h.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || h.isContentEditable;
}

/** Shortcuts that still fire while typing in a text field. */
const IN_INPUT_OK = new Set<ShortcutAction>(['save', 'saveAs', 'open']);

/**
 * Map a key event to an action. `inText` = focus is in a text input.
 * Returns null for keys that are not shortcuts (or must not fire there).
 */
export function resolveShortcut(e: KeyLike, inText = false): ShortcutAction | null {
    const ctrl = !!(e.ctrlKey || e.metaKey);
    const key = e.key.toLowerCase();
    const code = e.code ?? '';
    let action: ShortcutAction | null = null;

    if (ctrl && !e.altKey) {
        if (key === 's') action = e.shiftKey ? 'saveAs' : 'save';
        else if (key === 'o') action = 'open';
        else if (key === 'z') action = e.shiftKey ? 'redo' : 'undo';
        else if (key === 'y') action = 'redo';
    } else if (e.altKey && !ctrl) {
        // e.code: layout-independent and unaffected by Option on macOS
        const digit = /^Digit([1-9])$/.exec(code);
        if (code === 'KeyN') action = 'newPlot';
        else if (code === 'KeyW') action = 'closePlot';
        else if (code === 'KeyD') action = 'duplicatePlot';
        else if (code === 'BracketRight') action = 'nextPlot';
        else if (code === 'BracketLeft') action = 'prevPlot';
        else if (code === 'KeyG') action = 'toggleGrid';
        else if (code === 'KeyA') action = 'toggleAttributes';
        else if (code === 'KeyF') action = 'toggleWorkflows';
        else if (code === 'KeyR') action = 'addToReport';
        else if (digit) action = `activatePlot${Number(digit[1]) as 1}`;
    } else if (!ctrl && !e.altKey && !e.shiftKey) {
        if (key === 'f2') action = 'renamePlot';
        else if (key === 'escape') action = 'clearSelection';
        else if (key === 'l') action = 'toolLasso';
        else if (key === 'b') action = 'toolBox';
        else if (key === 'z') action = 'toolZoom';
        else if (key === 'p') action = 'toolPan';
    }
    if (action && inText && !IN_INPUT_OK.has(action)) return null;
    return action;
}

type Handler = () => void;
const registry = new Map<ShortcutAction, Handler[]>();

/** Register a handler (latest registration wins). Returns an unregister function. */
export function registerShortcut(action: ShortcutAction, handler: Handler): () => void {
    const list = registry.get(action) ?? [];
    list.push(handler);
    registry.set(action, list);
    return () => {
        const l = registry.get(action);
        if (!l) return;
        const k = l.lastIndexOf(handler);
        if (k >= 0) l.splice(k, 1);
    };
}

/** Run the registered handler for an action; false if none is registered. */
export function runRegisteredShortcut(action: ShortcutAction): boolean {
    const l = registry.get(action);
    const h = l?.[l.length - 1];
    if (!h) return false;
    h();
    return true;
}
