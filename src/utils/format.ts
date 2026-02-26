import type { Payload } from "../types";
import { JST_OFFSET_MS } from "./date";

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
    const hh = String(jst.getUTCHours()).padStart(2, "0");
    const mi = String(jst.getUTCMinutes()).padStart(2, "0");

    const raw = (payload?.raw ?? "").toString().trim();
    const kind = (payload?.kind ?? "").toString().trim();
    const prefix = kind ? `**[${kind}]** ` : "";

    return `## ${hh}:${mi}\n${prefix}${raw}\n`;
}
