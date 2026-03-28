import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { parseLabels, formatEntry } from "./format";

describe("parseLabels", () => {
    it("parses a CSV of default labels", () => {
        expect(parseLabels("foo,bar", [])).toEqual(["foo", "bar"]);
    });

    it("trims whitespace from label strings", () => {
        expect(parseLabels(" foo , bar ", [])).toEqual(["foo", "bar"]);
    });

    it("filters out empty strings", () => {
        expect(parseLabels(",foo,,", [])).toEqual(["foo"]);
    });

    it("merges and deduplicates payload labels", () => {
        expect(parseLabels("foo", ["foo", "bar"])).toEqual(["foo", "bar"]);
    });

    it("returns only payload labels when default is empty", () => {
        expect(parseLabels("", ["baz"])).toEqual(["baz"]);
    });

    it("returns only default labels when payload labels is not an array", () => {
        expect(parseLabels("foo", null)).toEqual(["foo"]);
        expect(parseLabels("foo", "bar")).toEqual(["foo"]);
        expect(parseLabels("foo", undefined)).toEqual(["foo"]);
    });

});

describe("formatEntry", () => {
    beforeEach(() => {
        delete process.env.NIGHT_OWL_THRESHOLD_HOURS;
    });

    afterEach(() => {
        delete process.env.NIGHT_OWL_THRESHOLD_HOURS;
    });

    it("formats entry with kind prefix", () => {
        // 10:30 UTC + 9h offset = 19:30 JST
        const entry = formatEntry({ raw: "hello", kind: "idea", captured_at: "2024-01-15T10:30:00Z" });
        expect(entry).toBe("## 19:30\n**[idea]** hello\n");
    });

    it("formats entry without kind prefix", () => {
        const entry = formatEntry({ raw: "hello", captured_at: "2024-01-15T10:30:00Z" });
        expect(entry).toBe("## 19:30\nhello\n");
    });

    it("trims the raw text", () => {
        const entry = formatEntry({ raw: "  hello  ", captured_at: "2024-01-15T10:30:00Z" });
        expect(entry).toBe("## 19:30\nhello\n");
    });

    it("handles missing raw as empty string", () => {
        const entry = formatEntry({ captured_at: "2024-01-15T10:30:00Z" });
        expect(entry).toBe("## 19:30\n\n");
    });

    it("displays 02:15 JST as 26:15 with default threshold (3)", () => {
        // 2026-04-09T17:15:00Z + 9h = 2026-04-10T02:15:00+09:00 → displayed as 26:15
        const entry = formatEntry({ raw: "night owl", captured_at: "2026-04-09T17:15:00Z" });
        expect(entry).toBe("## 26:15\nnight owl\n");
    });

    it("displays 00:00 JST as 24:00 with default threshold (3)", () => {
        // 2026-04-09T15:00:00Z + 9h = 2026-04-10T00:00:00+09:00 → displayed as 24:00
        const entry = formatEntry({ raw: "midnight", captured_at: "2026-04-09T15:00:00Z" });
        expect(entry).toBe("## 24:00\nmidnight\n");
    });

    it("displays 01:00 JST as 25:00 with default threshold (3)", () => {
        // 2026-04-09T16:00:00Z + 9h = 2026-04-10T01:00:00+09:00 → displayed as 25:00
        const entry = formatEntry({ raw: "late", captured_at: "2026-04-09T16:00:00Z" });
        expect(entry).toBe("## 25:00\nlate\n");
    });

    it("displays 03:00 JST as 03:00 with default threshold (3)", () => {
        // Exactly at threshold: not before it, so no adjustment
        // 2026-04-09T18:00:00Z + 9h = 2026-04-10T03:00:00+09:00 → displayed as 03:00
        const entry = formatEntry({ raw: "early bird", captured_at: "2026-04-09T18:00:00Z" });
        expect(entry).toBe("## 03:00\nearly bird\n");
    });

    it("respects a custom threshold from NIGHT_OWL_THRESHOLD_HOURS", () => {
        process.env.NIGHT_OWL_THRESHOLD_HOURS = "5";
        // 04:00 JST with threshold=5 → displayed as 28:00
        // 2026-04-09T19:00:00Z + 9h = 2026-04-10T04:00:00+09:00 → displayed as 28:00
        const entry = formatEntry({ raw: "custom", captured_at: "2026-04-09T19:00:00Z" });
        expect(entry).toBe("## 28:00\ncustom\n");
    });
});
