import { describe, expect, it } from "vitest";
import {
    getNextReviewDate,
    getReviewRecords,
    isReviewDue,
    judgePracticeAnswer,
    nextMasteryLevel,
    pickRandom,
    PRACTICE_MODES,
    PRACTICE_SOURCES,
} from "@/lib/practice";

describe("practice session helpers", () => {
    it("judges normalized answers and updates mastery", () => {
        expect(judgePracticeAnswer(" Ａ。 ", "A. 选项内容")).toEqual({ isCorrect: true, matchType: "choice" });
        expect(judgePracticeAnswer("linear equation", "A linear equation")).toEqual({ isCorrect: null, matchType: "self_assessment" });
        expect(judgePracticeAnswer("4", "5")).toEqual({ isCorrect: null, matchType: "self_assessment" });
        expect(judgePracticeAnswer("A", "Apple")).toEqual({ isCorrect: null, matchType: "self_assessment" });
        expect(nextMasteryLevel(1, true)).toBe(2);
        expect(nextMasteryLevel(2, true)).toBe(2);
        expect(nextMasteryLevel(2, false)).toBe(0);
    });

    it("selects unique questions without mutating the source", () => {
        const source = [1, 2, 3, 4, 5];
        const selected = pickRandom(source, 3);
        expect(selected).toHaveLength(3);
        expect(new Set(selected).size).toBe(3);
        expect(source).toEqual([1, 2, 3, 4, 5]);
    });

    it("schedules the first review one day after correction", () => {
        const createdAt = new Date("2026-01-01T00:00:00Z");
        const records = [{ createdAt: new Date("2026-01-02T00:00:00Z"), isCorrect: true }];
        expect(getNextReviewDate(createdAt, [])).toEqual(new Date("2026-01-02T00:00:00Z"));
        expect(getNextReviewDate(createdAt, records)).toEqual(new Date("2026-01-04T00:00:00Z"));
        expect(isReviewDue(createdAt, records, new Date("2026-01-03T23:59:59Z"))).toBe(false);
        expect(isReviewDue(createdAt, records, new Date("2026-01-04T00:00:00Z"))).toBe(true);
    });

    it("does not count initial correction records toward the review streak", () => {
        const records = [
            { createdAt: new Date("2026-01-02T00:00:00Z"), isCorrect: true, sessionItem: { purpose: "correction" } },
            { createdAt: new Date("2026-01-03T00:00:00Z"), isCorrect: true, sessionItem: { purpose: "review" } },
        ];
        expect(getNextReviewDate(new Date("2026-01-02T00:00:00Z"), getReviewRecords(records)))
            .toEqual(new Date("2026-01-05T00:00:00Z"));
    });

    it("resets incorrect answers and keeps a 30-day maintenance interval", () => {
        const createdAt = new Date("2026-01-01T00:00:00Z");
        const resetRecords = [
            { createdAt: new Date("2026-01-04T00:00:00Z"), isCorrect: true },
            { createdAt: new Date("2026-01-08T00:00:00Z"), isCorrect: false },
        ];
        const maintenanceRecords = Array.from({ length: 6 }, (_, index) => ({
            createdAt: new Date(Date.UTC(2026, 0, index + 1)),
            isCorrect: true,
        }));

        expect(getNextReviewDate(createdAt, resetRecords)).toEqual(new Date("2026-01-09T00:00:00Z"));
        expect(getNextReviewDate(createdAt, maintenanceRecords)).toEqual(new Date("2026-02-05T00:00:00Z"));
    });

    it("exposes only current practice modes and sources", () => {
        expect(PRACTICE_MODES).toEqual(["random", "unmastered", "ebbinghaus", "daily"]);
        expect(PRACTICE_SOURCES).toEqual(["original", "variant"]);
    });
});
