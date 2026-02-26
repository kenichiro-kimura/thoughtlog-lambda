import type { Payload } from "../types";

/** UTC offset in milliseconds for JST (UTC+9). */
export const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function nowEpoch(): number {
    return Math.floor(Date.now() / 1000);
}

/**
 * Returns a YYYY-MM-DD date key in JST (UTC+9) for the payload's captured_at timestamp.
 * Falls back to the current time when captured_at is absent.
 */
export function getDateKeyJst(payload: Payload): string {
    const captured = payload?.captured_at ? new Date(payload.captured_at) : new Date();
    const jstMs = captured.getTime() + JST_OFFSET_MS;
    const d = new Date(jstMs);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}
