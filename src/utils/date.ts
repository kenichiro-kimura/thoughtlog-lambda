import type { Payload } from "../types";

/** UTC offset in milliseconds for JST (UTC+9). */
export const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function nowEpoch(): number {
    return Math.floor(Date.now() / 1000);
}

/**
 * Returns the current date and time in JST (UTC+9) as a "YYYY-MM-DD HH:mm" string.
 */
export function nowJstDateTime(): string {
    const jstMs = Date.now() + JST_OFFSET_MS;
    const d = new Date(jstMs);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const min = String(d.getUTCMinutes()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

/**
 * Returns the "night owl" threshold hour (0–12) from the environment variable
 * NIGHT_OWL_THRESHOLD_HOURS. JST times before this hour are attributed to the
 * previous calendar day. Defaults to 3.
 */
export function getNightOwlThresholdHour(): number {
    const raw = process.env.NIGHT_OWL_THRESHOLD_HOURS;
    if (raw === undefined || raw === "") return 3;
    const parsed = parseInt(raw, 10);
    if (isNaN(parsed) || parsed < 0 || parsed > 12) return 3;
    return parsed;
}

/**
 * Returns a YYYY-MM-DD date key in JST (UTC+9) for the payload's captured_at timestamp.
 * Falls back to the current time when captured_at is absent.
 * Times before the night owl threshold hour (NIGHT_OWL_THRESHOLD_HOURS, default 3)
 * are attributed to the previous calendar day.
 */
export function getDateKeyJst(payload: Payload): string {
    const captured = payload?.captured_at ? new Date(payload.captured_at) : new Date();
    const jstMs = captured.getTime() + JST_OFFSET_MS;
    const d = new Date(jstMs);
    const threshold = getNightOwlThresholdHour();

    // Times before the threshold belong to the previous calendar day.
    const effectiveMs = d.getUTCHours() < threshold ? jstMs - 24 * 60 * 60 * 1000 : jstMs;
    const e = new Date(effectiveMs);
    const yyyy = e.getUTCFullYear();
    const mm = String(e.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(e.getUTCDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}
