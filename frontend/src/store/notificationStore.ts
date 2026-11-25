/**
 * Global notification system (Phase 9): one snackbar, FIFO queue.
 *
 * Use `notify(message, severity)` from anywhere (components, stores, api
 * layer). GlobalSnackbar (mounted once in App) renders the current entry.
 */
import { create } from 'zustand';

export type NotificationSeverity = 'success' | 'info' | 'warning' | 'error';

export interface NotificationAction {
    label: string;
    run: () => void;
}

export interface AppNotification {
    id: number;
    message: string;
    severity: NotificationSeverity;
    /** Optional button on the snackbar (e.g. "Open Data Doctor") */
    action?: NotificationAction;
}

interface NotificationState {
    current: AppNotification | null;
    queue: AppNotification[];
    notify: (message: string, severity?: NotificationSeverity, action?: NotificationAction) => void;
    dismiss: () => void;
}

let nextId = 0;

export const useNotificationStore = create<NotificationState>((set, get) => ({
    current: null,
    queue: [],

    notify: (message, severity = 'info', action) => {
        const entry: AppNotification = { id: nextId++, message, severity, ...(action ? { action } : {}) };
        const { current } = get();
        if (current === null) {
            set({ current: entry });
        } else {
            set((s) => ({ queue: [...s.queue, entry] }));
        }
    },

    dismiss: () => {
        set((s) => ({
            current: s.queue[0] ?? null,
            queue: s.queue.slice(1),
        }));
    },
}));

/** Convenience for non-component callers. */
export const notify = (message: string, severity: NotificationSeverity = 'info', action?: NotificationAction) =>
    useNotificationStore.getState().notify(message, severity, action);
