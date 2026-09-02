import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getServerSession: vi.fn(),
    transaction: vi.fn(),
    tx: {
        user: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
        subject: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
        knowledgeTag: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
        errorItem: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
        practiceSession: { findUnique: vi.fn(), create: vi.fn() },
        practiceSessionItem: { findUnique: vi.fn(), create: vi.fn() },
        practiceRecord: { findUnique: vi.fn(), create: vi.fn() },
    },
}));

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));

import { POST } from "@/app/api/import/route";

const now = "2026-09-02T00:00:00.000Z";

function v4Backup(overrides: Record<string, unknown> = {}) {
    return {
        version: 4,
        exportedAt: now,
        scope: "user",
        user: {
            id: "old-user",
            email: "user@example.com",
            name: "User",
            educationStage: null,
            enrollmentYear: null,
            role: "user",
        },
        subjects: [],
        customTags: [],
        errorItems: [],
        practiceRecords: [],
        ...overrides,
    };
}

function v5Backup(overrides: Record<string, unknown> = {}) {
    return {
        version: 5,
        exportedAt: now,
        scope: "all",
        users: [{
            id: "user-1",
            email: "user@example.com",
            password: "$2b$12$hash",
            name: "User",
            educationStage: "junior_high",
            enrollmentYear: 2025,
            role: "user",
            isActive: true,
            createdAt: now,
            updatedAt: now,
        }],
        subjects: [{ id: "subject-1", name: "Math", userId: "user-1", createdAt: now, updatedAt: now }],
        customTags: [
            { id: "tag-parent", name: "Algebra", subject: "math", parentId: null, order: 0, code: null, isSystem: false, userId: "user-1", createdAt: now, updatedAt: now },
            { id: "tag-child", name: "Linear", subject: "math", parentId: "tag-parent", order: 1, code: null, isSystem: false, userId: "user-1", createdAt: now, updatedAt: now },
        ],
        errorItems: [{
            id: "error-1",
            userId: "user-1",
            subjectId: "subject-1",
            originalImageUrl: "",
            ocrText: null,
            questionText: "1 + 1",
            answerText: "2",
            analysis: null,
            wrongAnswerText: null,
            mistakeAnalysis: null,
            mistakeStatus: "unknown",
            geogebraCommands: null,
            source: null,
            errorType: null,
            userNotes: null,
            masteryLevel: 0,
            gradeSemester: null,
            paperLevel: null,
            createdAt: now,
            updatedAt: now,
            tags: [{ id: "tag-child", name: "Linear", subject: "math", parentId: "tag-parent", userId: "user-1", isSystem: false }],
        }],
        practiceSessions: [{ id: "session-1", userId: "user-1", mode: "daily", questionSource: "original", language: "zh", startedAt: now, endedAt: null }],
        practiceSessionItems: [{
            id: "session-item-1",
            sessionId: "session-1",
            errorItemId: "error-1",
            position: 0,
            subjectName: "Math",
            gradeSemester: null,
            knowledgePoints: "[]",
            sourceQuestionText: "1 + 1",
            sourceAnswerText: "2",
            questionText: "1 + 1",
            answerText: "2",
            generationMode: "original",
        }],
        practiceRecords: [{
            id: "record-1",
            userId: "user-1",
            sessionItemId: "session-item-1",
            errorItemId: "error-1",
            subject: "Math",
            difficulty: null,
            isCorrect: true,
            answerInput: null,
            createdAt: now,
        }],
        ...overrides,
    };
}

function request(body: unknown, all = false) {
    return new Request(`http://localhost/api/import${all ? "?all=true" : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

describe("POST /api/import", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getServerSession.mockResolvedValue({ user: { id: "current-user", email: "user@example.com", role: "admin" } });
        mocks.transaction.mockImplementation(callback => callback(mocks.tx));
        for (const model of Object.values(mocks.tx) as Array<Record<string, ReturnType<typeof vi.fn>>>) {
            model.findUnique?.mockResolvedValue(null);
            model.findFirst?.mockResolvedValue(null);
            model.create?.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve(data));
            model.update?.mockImplementation(({ data, where }: { data: Record<string, unknown>; where: { id: string } }) => Promise.resolve({ id: where.id, ...data }));
        }
    });

    it("accepts a version 4 single-user content backup", async () => {
        const response = await POST(request(v4Backup()));

        expect(response.status).toBe(200);
        expect(mocks.transaction).toHaveBeenCalledOnce();
    });

    it("rejects version 4 full restore", async () => {
        const response = await POST(request(v4Backup({ scope: "all" }), true));

        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ message: expect.stringContaining("Version 4") });
        expect(mocks.transaction).not.toHaveBeenCalled();
    });

    it("restores the complete version 5 graph in dependency order", async () => {
        const response = await POST(request(v5Backup(), true));
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.stats).toMatchObject({
            usersCreated: 1,
            subjectsCreated: 1,
            tagsCreated: 2,
            errorItemsCreated: 1,
            practiceSessionsCreated: 1,
            practiceSessionItemsCreated: 1,
            practiceRecordsCreated: 1,
        });
        expect(mocks.tx.knowledgeTag.update).toHaveBeenCalledWith({ where: { id: "tag-child" }, data: { parentId: "tag-parent" } });
        expect(mocks.tx.practiceRecord.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ sessionItemId: "session-item-1", errorItemId: "error-1" }),
        }));
    });

    it("rejects malformed backups before opening a transaction", async () => {
        const response = await POST(request({ version: 5, scope: "all", users: [] }, true));

        expect(response.status).toBe(400);
        expect(mocks.transaction).not.toHaveBeenCalled();
    });

    it("rejects unknown foreign keys and rolls the transaction back", async () => {
        const backup = v5Backup();
        backup.errorItems[0].subjectId = "missing-subject";

        const response = await POST(request(backup, true));

        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ message: expect.stringContaining("Unknown subject") });
    });
});
