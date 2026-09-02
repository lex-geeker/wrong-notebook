import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getServerSession: vi.fn(),
    findUser: vi.fn(),
    findUsers: vi.fn(),
    findSubjects: vi.fn(),
    findTags: vi.fn(),
    findErrorItems: vi.fn(),
    findSessions: vi.fn(),
    findSessionItems: vi.fn(),
    findRecords: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({
    prisma: {
        user: { findUnique: mocks.findUser, findMany: mocks.findUsers },
        subject: { findMany: mocks.findSubjects },
        knowledgeTag: { findMany: mocks.findTags },
        errorItem: { findMany: mocks.findErrorItems },
        practiceSession: { findMany: mocks.findSessions },
        practiceSessionItem: { findMany: mocks.findSessionItems },
        practiceRecord: { findMany: mocks.findRecords },
    },
}));

import { GET } from "@/app/api/export/route";

describe("GET /api/export", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getServerSession.mockResolvedValue({ user: { id: "admin", role: "admin" } });
        mocks.findUser.mockResolvedValue({ id: "admin", email: "admin@localhost", password: "hash" });
        mocks.findUsers.mockResolvedValue([{ id: "admin", email: "admin@localhost", password: "hash" }]);
        mocks.findSubjects.mockResolvedValue([]);
        mocks.findTags.mockResolvedValue([]);
        mocks.findErrorItems.mockResolvedValue([]);
        mocks.findSessions.mockResolvedValue([{ id: "session-1", userId: "admin" }]);
        mocks.findSessionItems.mockResolvedValue([{ id: "item-1", sessionId: "session-1" }]);
        mocks.findRecords.mockResolvedValue([{ id: "record-1", sessionItemId: "item-1" }]);
    });

    it("exports a non-cacheable version 5 full backup", async () => {
        const response = await GET(new Request("http://localhost/api/export?all=true"));
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(body).toMatchObject({
            version: 5,
            scope: "all",
            users: [{ password: "hash" }],
            practiceSessions: [{ id: "session-1" }],
            practiceSessionItems: [{ id: "item-1" }],
            practiceRecords: [{ id: "record-1" }],
        });
    });
});
