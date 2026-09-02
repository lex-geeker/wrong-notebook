import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getServerSession: vi.fn(),
    findItems: vi.fn(),
    findActiveSession: vi.fn(),
    findCompletedSessions: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({
    prisma: {
        errorItem: { findMany: mocks.findItems },
        practiceSession: { findFirst: mocks.findActiveSession, findMany: mocks.findCompletedSessions },
    },
}));

import { GET } from "@/app/api/learning-overview/route";

describe("GET /api/learning-overview", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-09-02T04:00:00Z"));
        mocks.getServerSession.mockResolvedValue({ user: { id: "user-1" } });
        mocks.findActiveSession.mockResolvedValue({
            id: "daily-1",
            userId: "user-1",
            mode: "daily",
            questionSource: "variant",
            language: "zh",
            startedAt: new Date("2026-09-02T00:00:00Z"),
            endedAt: null,
            items: [{
                id: "session-item-1",
                sessionId: "daily-1",
                errorItemId: "pending",
                position: 0,
                subjectName: "数学",
                gradeSemester: null,
                knowledgePoints: "[]",
                sourceQuestionText: "1+1",
                sourceAnswerText: "2",
                questionText: "1+1",
                answerText: "2",
                generationMode: "original",
                record: null,
            }],
        });
        mocks.findCompletedSessions.mockResolvedValue([{ endedAt: new Date("2026-09-01T16:30:00Z") }]);
        mocks.findItems.mockResolvedValue([
            { createdAt: new Date("2026-09-02T04:00:00Z"), errorType: null, tags: [], practiceRecords: [] },
            {
                createdAt: new Date("2026-09-01T00:00:00Z"),
                errorType: "method",
                tags: [{ name: "两位数加法" }],
                practiceRecords: [
                    { createdAt: new Date("2026-09-01T01:00:00Z"), isCorrect: true },
                    { createdAt: new Date("2026-09-02T01:00:00Z"), isCorrect: false },
                ],
            },
            { createdAt: new Date("2020-01-01T00:00:00Z"), errorType: "reading", tags: [], practiceRecords: [] },
        ]);
    });

    afterEach(() => vi.useRealTimers());

    it("returns actionable counts and seven-day metrics in China dates", async () => {
        const response = await GET();
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.today).toEqual({ dueReviewCount: 1, unfinishedCount: 1 });
        expect(body.activeSession).toMatchObject({ id: "daily-1", items: [{ id: "session-item-1" }] });
        expect(body.week).toMatchObject({
            completionDays: ["2026-09-02"],
            reviewedCount: 2,
            correctCount: 1,
            accuracy: 50,
            wrongCount: 1,
            topErrorTypes: [{ name: "method", count: 1 }],
            weakTags: [{ name: "两位数加法", count: 1 }],
        });
    });

    it("isolates overview data by the authenticated user", async () => {
        await GET();
        expect(mocks.findItems).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: "user-1" }) }));
        expect(mocks.findActiveSession).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: "user-1" }) }));
    });
});
