import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    userFindFirst: vi.fn(),
    userFindUnique: vi.fn(),
    subjectFindFirst: vi.fn(),
    errorItemCreate: vi.fn(),
    compare: vi.fn(),
    resolveTags: vi.fn(),
    fetch: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        user: { findFirst: mocks.userFindFirst, findUnique: mocks.userFindUnique },
        subject: { findFirst: mocks.subjectFindFirst },
        errorItem: { create: mocks.errorItemCreate },
    },
}));
vi.mock("bcryptjs", () => ({ compare: mocks.compare }));
vi.mock("@/lib/tag-recognition", () => ({ resolveKnowledgeTagConnections: mocks.resolveTags }));

import { POST } from "@/app/api/openclaw/batch-upload/route";

const recognized = (overrides: Record<string, unknown> = {}) => new Response(JSON.stringify({
    success: true,
    data: {
        questionText: "题目",
        answerText: "答案",
        analysis: "解析",
        knowledgePoints: [],
        ...overrides,
    },
}), { status: 200, headers: { "Content-Type": "application/json" } });

const request = (images: unknown[]) => new Request("http://localhost/api/openclaw/batch-upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "user@example.com", password: "secret", images }),
});

const image = { base64: "dGVzdA==", mimeType: "image/png", filename: "test.png" };

describe("POST /api/openclaw/batch-upload", () => {
    beforeEach(() => {
        vi.stubEnv("OPENCLAW_AUTH_MODE", "credentials");
        vi.stubGlobal("fetch", mocks.fetch);
        mocks.userFindFirst.mockResolvedValue({
            id: "user-1",
            email: "user@example.com",
            password: "hash",
            isActive: true,
        });
        mocks.userFindUnique.mockResolvedValue({ educationStage: null, enrollmentYear: null });
        mocks.subjectFindFirst.mockResolvedValue(null);
        mocks.errorItemCreate.mockResolvedValue({ id: "item-1" });
        mocks.compare.mockResolvedValue(true);
        mocks.resolveTags.mockResolvedValue([]);
        mocks.fetch.mockResolvedValue(recognized());
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    });

    it("rejects an invalid request before authentication", async () => {
        const response = await POST(new Request("http://localhost/api/openclaw/batch-upload", {
            method: "POST",
            body: JSON.stringify({ username: "user@example.com", password: "secret" }),
        }));

        expect(response.status).toBe(400);
        expect(mocks.userFindFirst).not.toHaveBeenCalled();
        expect(mocks.fetch).not.toHaveBeenCalled();
    });

    it("reports unsupported and oversized images without calling the agent", async () => {
        const oversized = Buffer.alloc(2 * 1024 * 1024 + 1).toString("base64");
        const response = await POST(request([
            { ...image, mimeType: "image/gif" },
            { ...image, base64: oversized },
        ]));
        const data = await response.json();

        expect(response.status).toBe(207);
        expect(data.results[0].error).toContain("Unsupported image type");
        expect(data.results[1].error).toContain("2MB");
        expect(mocks.fetch).not.toHaveBeenCalled();
    });

    it("treats an invalid agent response as an item failure", async () => {
        mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ success: true, data: { questionText: 1 } })));

        const response = await POST(request([image]));
        const data = await response.json();

        expect(response.status).toBe(207);
        expect(data.results[0].error).toContain("无效数据");
        expect(mocks.errorItemCreate).not.toHaveBeenCalled();
    });

    it("normalizes unknown metadata and preserves missing error type", async () => {
        mocks.fetch
            .mockResolvedValueOnce(recognized({ source: "Openclaw", errorType: "unexpected" }))
            .mockResolvedValueOnce(recognized());
        mocks.errorItemCreate
            .mockResolvedValueOnce({ id: "item-1" })
            .mockResolvedValueOnce({ id: "item-2" });

        const response = await POST(request([image, { ...image, filename: "second.png" }]));
        const data = await response.json();

        expect(response.status).toBe(201);
        expect(data.successCount).toBe(2);
        expect(mocks.errorItemCreate.mock.calls[0][0].data).toMatchObject({ source: "other", errorType: "other" });
        expect(mocks.errorItemCreate.mock.calls[1][0].data).toMatchObject({ source: "other", errorType: null });
        expect(mocks.errorItemCreate.mock.calls[0][0].data.originalImageUrl).toBe("data:image/png;base64,dGVzdA==");
    });

    it("returns 207 when valid and invalid images are mixed", async () => {
        const response = await POST(request([image, { ...image, mimeType: "image/gif" }]));
        const data = await response.json();

        expect(response.status).toBe(207);
        expect(data).toMatchObject({ success: false, successCount: 1, failCount: 1 });
        expect(mocks.errorItemCreate).toHaveBeenCalledOnce();
    });
});
