import type { Payload } from "../types";
import { JST_OFFSET_MS, getNightOwlThresholdHour } from "./date";

export function parseLabels(defaultLabelsCsv: string, payloadLabels: unknown): string[] {
    const base = (defaultLabelsCsv || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

    const extra = Array.isArray(payloadLabels)
        ? payloadLabels.map((s) => String(s).trim()).filter(Boolean)
        : [];

    // dedupe
    return [...new Set([...base, ...extra])];
}

/** Formats a log entry as Markdown (time heading + optional kind prefix + raw text). */
export function formatEntry(payload: Payload): string {
    const captured = payload?.captured_at ? new Date(payload.captured_at) : new Date();
    const jst = new Date(captured.getTime() + JST_OFFSET_MS);
    const hour = jst.getUTCHours();
    const mi = String(jst.getUTCMinutes()).padStart(2, "0");

    const threshold = getNightOwlThresholdHour();
    const displayHour = hour < threshold ? hour + 24 : hour;
    const hh = String(displayHour).padStart(2, "0");

    const raw = (payload?.raw ?? "").toString().trim();
    const kind = (payload?.kind ?? "").toString().trim();
    const prefix = kind ? `**[${kind}]** ` : "";

    return `## ${hh}:${mi}\n${prefix}${raw}\n`;
}
