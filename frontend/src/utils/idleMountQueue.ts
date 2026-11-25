/**
 * Builds heavy charts one at a time, and only while the user is not
 * scrolling. A Plotly chart takes 100-400 ms to build; building every chart
 * as it scrolled into view made scrolling a long grid stall.
 */
const QUIET_MS = 150;

interface Job { run: () => void; cancelled: boolean }

const queue: Job[] = [];
let lastScroll = -Infinity;
let listening = false;
let timer: ReturnType<typeof setTimeout> | null = null;

const markScroll = () => { lastScroll = Date.now(); };

function pump() {
    timer = null;
    while (queue.length && queue[0].cancelled) queue.shift();
    if (!queue.length) return;
    const wait = lastScroll + QUIET_MS - Date.now();
    if (wait > 0) {
        timer = setTimeout(pump, wait);
        return;
    }
    queue.shift()!.run();
    // Give the browser a frame (and a chance to see new scrolling) before the next chart
    timer = setTimeout(pump, 16);
}

/** Queue `run` (which should build its chart synchronously); returns a cancel function */
export function requestMount(run: () => void): () => void {
    if (!listening && typeof document !== 'undefined') {
        // Capture: scrolling inside any pane counts, not only the window
        document.addEventListener('scroll', markScroll, { capture: true, passive: true });
        document.addEventListener('wheel', markScroll, { capture: true, passive: true });
        listening = true;
    }
    const job: Job = { run, cancelled: false };
    queue.push(job);
    if (!timer) timer = setTimeout(pump, 0);
    return () => { job.cancelled = true; };
}

/** Test hook: note a scroll now */
export const _markScrollForTest = markScroll;
