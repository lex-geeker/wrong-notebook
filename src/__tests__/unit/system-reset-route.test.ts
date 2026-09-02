import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getServerSession: vi.fn(),
    transaction: vi.fn(),
    tx: {
        practiceRecord: { deleteMany: vi.fn() },
        practiceSession: { deleteMany: vi.fn() },
        errorItem: { deleteMany: vi.fn() },
        subject: { deleteMany: vi.fn() },
        knowledgeTag: { deleteMany: vi.fn() },
        user: { deleteMany: vi.fn() },
    },
}));

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));

import { POST } from "@/app/api/admin/system-reset/route";

describe("POST /api/admin/system-reset", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getServerSession.mockResolvedValue({ user: { id: "admin", email: "admin@localhost", role: "admin" } });
        mocks.transaction.mockImplementation(callback => callback(mocks.tx));
    });

    it("deletes practice sessions inside the reset transaction", async () => {
        const response = await POST(new Request("http://localhost/api/admin/system-reset", { method: "POST" }));

        expect(response.status).toBe(200);
        expect(mocks.tx.practiceRecord.deleteMany).toHaveBeenCalledWith({});
        expect(mocks.tx.practiceSession.deleteMany).toHaveBeenCalledWith({});
    });
});
