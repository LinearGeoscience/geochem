/**
 * Map raw backend/network errors to geologist-actionable messages (Phase 9).
 *
 * The backend's failure detail is often a raw Python exception string
 * (pandas ParserError, KeyError, ...) — useful for debugging, useless in a
 * snackbar. Recognize the common cases; fall back to the raw detail.
 */

export function friendlyError(err: any, context?: string): string {
    const prefix = context ? `${context}: ` : '';
    const detail: string =
        err?.response?.data?.detail ?? err?.message ?? String(err ?? 'Unknown error');
    const status: number | undefined = err?.response?.status;

    // Network-level failures (backend down / unreachable)
    if (err?.code === 'ERR_NETWORK' || /Network Error|Failed to fetch/i.test(detail)) {
        return `${prefix}Can't reach the backend — is the server running? (npm run dev starts it)`;
    }
    if (err?.code === 'ECONNABORTED' || /timeout/i.test(detail)) {
        return `${prefix}The server took too long to respond — very large files can take a few minutes.`;
    }

    if (status === 413 || /too large/i.test(detail)) {
        return `${prefix}File is too large (500 MB limit). Split it or remove unused columns.`;
    }

    // Parse/encoding failures surface as raw pandas/Python exceptions
    if (/ParserError|tokenizing|codec can't decode|invalid start byte|not a valid ZIP/i.test(detail)) {
        return `${prefix}Couldn't read that file — check it's a valid CSV or Excel export (re-saving from Excel as CSV UTF-8 usually fixes this).`;
    }
    if (/read_excel|openpyxl|xlrd|Excel file format/i.test(detail)) {
        return `${prefix}Couldn't read that Excel file — try re-saving it as .xlsx or CSV.`;
    }

    // Already-friendly backend messages pass through (with any "500: " noise stripped)
    return prefix + detail.replace(/^\d{3}:\s*/, '');
}
