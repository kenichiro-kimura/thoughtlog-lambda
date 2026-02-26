import { describe, it, expect } from "vitest";
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
});
