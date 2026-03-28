import { describe, it, expect, vi, afterEach } from "vitest";
import { getDateKeyJst, getNightOwlThresholdHour, nowEpoch, nowJstDateTime } from "./date";

describe("nowEpoch", () => {
    it("returns the current Unix timestamp (seconds)", () => {
        const before = Math.floor(Date.now() / 1000);
        const result = nowEpoch();
        const after = Math.floor(Date.now() / 1000);
        expect(result).toBeGreaterThanOrEqual(before);
        expect(result).toBeLessThanOrEqual(after);
    });
});

describe("getNightOwlThresholdHour", () => {
    const originalNightOwlThresholdHours = process.env.NIGHT_OWL_THRESHOLD_HOURS;

    afterEach(() => {
        if (originalNightOwlThresholdHours === undefined) {
            delete process.env.NIGHT_OWL_THRESHOLD_HOURS;
        } else {
            process.env.NIGHT_OWL_THRESHOLD_HOURS = originalNightOwlThresholdHours;
        }
    });

    it("returns 3 by default when env var is unset", () => {
        expect(getNightOwlThresholdHour()).toBe(3);
    });

    it("returns the value set in the env var", () => {
        process.env.NIGHT_OWL_THRESHOLD_HOURS = "5";
        expect(getNightOwlThresholdHour()).toBe(5);
    });

    it("returns 3 for an empty env var", () => {
        process.env.NIGHT_OWL_THRESHOLD_HOURS = "";
        expect(getNightOwlThresholdHour()).toBe(3);
    });

    it("returns 3 for a non-numeric env var", () => {
        process.env.NIGHT_OWL_THRESHOLD_HOURS = "abc";
        expect(getNightOwlThresholdHour()).toBe(3);
    });

    it("returns 3 for a value greater than 12", () => {
        process.env.NIGHT_OWL_THRESHOLD_HOURS = "13";
        expect(getNightOwlThresholdHour()).toBe(3);
    });

    it("returns 0 when the env var is set to 0 (threshold disabled)", () => {
        process.env.NIGHT_OWL_THRESHOLD_HOURS = "0";
        expect(getNightOwlThresholdHour()).toBe(0);
    });
});

describe("getDateKeyJst", () => {
    const originalNightOwlThresholdHours = process.env.NIGHT_OWL_THRESHOLD_HOURS;

    afterEach(() => {
        if (originalNightOwlThresholdHours === undefined) {
            delete process.env.NIGHT_OWL_THRESHOLD_HOURS;
        } else {
            process.env.NIGHT_OWL_THRESHOLD_HOURS = originalNightOwlThresholdHours;
        }
    });

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

    it("attributes 02:15 JST to the previous day with default threshold (3)", () => {
        // 2026-04-09T17:15:00Z + 9h = 2026-04-10T02:15:00+09:00 → previous day "2026-04-09"
        expect(getDateKeyJst({ captured_at: "2026-04-09T17:15:00Z" })).toBe("2026-04-09");
    });

    it("attributes 00:00 JST to the previous day with default threshold (3)", () => {
        // 2026-04-09T15:00:00Z + 9h = 2026-04-10T00:00:00+09:00 → previous day "2026-04-09"
        expect(getDateKeyJst({ captured_at: "2026-04-09T15:00:00Z" })).toBe("2026-04-09");
    });

    it("keeps 03:00 JST on the current day with default threshold (3)", () => {
        // 2026-04-09T18:00:00Z + 9h = 2026-04-10T03:00:00+09:00 → current day "2026-04-10"
        expect(getDateKeyJst({ captured_at: "2026-04-09T18:00:00Z" })).toBe("2026-04-10");
    });

    it("respects a custom threshold from NIGHT_OWL_THRESHOLD_HOURS", () => {
        process.env.NIGHT_OWL_THRESHOLD_HOURS = "5";
        // 04:00 JST with threshold=5 → previous day
        // 2026-04-09T19:00:00Z + 9h = 2026-04-10T04:00:00+09:00 → previous day "2026-04-09"
        expect(getDateKeyJst({ captured_at: "2026-04-09T19:00:00Z" })).toBe("2026-04-09");
    });

    it("treats threshold=0 as no adjustment (00:00 stays on the current day)", () => {
        process.env.NIGHT_OWL_THRESHOLD_HOURS = "0";
        // 2026-04-09T15:00:00Z + 9h = 2026-04-10T00:00:00+09:00 → current day "2026-04-10"
        expect(getDateKeyJst({ captured_at: "2026-04-09T15:00:00Z" })).toBe("2026-04-10");
    });
});

describe("nowJstDateTime", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("returns a YYYY-MM-DD HH:mm string", () => {
        const result = nowJstDateTime();
        expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    });

    it("converts UTC midnight to JST 09:00 of the same day", () => {
        // 2024-01-14T00:00:00Z + 9h = 2024-01-14T09:00+09:00
        vi.spyOn(Date, "now").mockReturnValue(new Date("2024-01-14T00:00:00Z").getTime());
        expect(nowJstDateTime()).toBe("2024-01-14 09:00");
    });
});
