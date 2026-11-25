/**
 * Live Ctrl/Meta and Alt state from ONE pair of document listeners (shared
 * by every plot's selection handler instead of a pair per plot). Installed
 * lazily on first read; cleared on window blur so a key released outside the
 * window doesn't stick.
 */
const state = { ctrl: false, alt: false };
let installed = false;

function update(e: KeyboardEvent) {
    state.ctrl = e.ctrlKey || e.metaKey;
    state.alt = e.altKey;
}

function install() {
    if (installed || typeof document === 'undefined') return;
    installed = true;
    document.addEventListener('keydown', update);
    document.addEventListener('keyup', update);
    window.addEventListener('blur', () => { state.ctrl = false; state.alt = false; });
}

export function getModifiers(): Readonly<{ ctrl: boolean; alt: boolean }> {
    install();
    return state;
}
