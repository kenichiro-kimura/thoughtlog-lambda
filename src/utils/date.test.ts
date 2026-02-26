import { describe, it, expect } from "vitest";
import { getDateKeyJst, nowEpoch } from "./date";

describe("nowEpoch", () => {
    it("returns the current Unix timestamp (seconds)", () => {
        const before = Math.floor(Date.now() / 1000);
        const result = nowEpoch();
        const after = Math.floor(Date.now() / 1000);
        expect(result).toBeGreaterThanOrEqual(before);
        expect(result).toBeLessThanOrEqual(after);
    });
});

describe("getDateKeyJst", () => {
    it("converts a UTC timestamp to a JST YYYY-MM-DD key", () => {
        // 2024-01-14T20:00:00Z + 9h = 2024-01-15T05:00:00+09:00 → "2024-01-15"
        expect(getDateKeyJst({ captured_at: "2024-01-14T20:00:00Z" })).toBe("2024-01-15");
    });

    it("stays on the same day when UTC time is before midnight JST", () => {
        // 2024-06-01T10:00:00Z + 9h = 2024-06-01T19:00:00+09:00 → "2024-06-01"
        expect(getDateKeyJst({ captured_at: "2024-06-01T10:00:00Z" })).toBe("2024-06-01");
    });

    it("returns a YYYY-MM-DD string when captured_at is absent", () => {
        const key = getDateKeyJst({});
        expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
});
