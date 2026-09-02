import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    findMany: vi.fn(),
    createSession: vi.fn(),
    getAIService: vi.fn(),
    generateSimilarQuestion: vi.fn(),
    getServerSession: vi.fn(),
    findSession: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/ai", () => ({ getAIService: mocks.getAIService }));
vi.mock("@/lib/prisma", () => ({
    prisma: {
        errorItem: { findMany: mocks.findMany },
        practiceSession: { findFirst: mocks.findSession, create: mocks.createSession },
    },
}));

import { POST } from "@/app/api/practice/sessions/route";

const candidate = (id: string, createdAt: string) => ({
    id,
    createdAt: new Date(createdAt),
    questionText: `question-${id}`,
    answerText: `answer-${id}`,
    gradeSemester: null,
    tags: [],
    subject: { name: "Math" },
    practiceRecords: [],
});

const request = (body: Record<string, unknown>) => new Request("http://localhost/api/practice/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
        mode: "random",
        questionSource: "original",
        count: 5,
        language: "en",
        ...body,
    }),
});

describe("POST /api/practice/sessions", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getServerSession.mockResolvedValue({ user: { id: "user-1" } });
        mocks.findSession.mockResolvedValue(null);
        mocks.getAIService.mockReturnValue({ generateSimilarQuestion: mocks.generateSimilarQuestion });
        mocks.createSession.mockImplementation(({ data }) => Promise.resolve({
            id: "session-1",
            userId: data.userId,
            mode: data.mode,
            questionSource: data.questionSource,
            language: data.language,
            startedAt: new Date("2026-01-01T00:00:00Z"),
            endedAt: null,
            items: data.items.create.map((item: Record<string, unknown>, index: number) => ({
                ...item,
                id: `session-item-${index}`,
                sessionId: "session-1",
                record: null,
            })),
        }));
    });

    it("selects only due questions in oldest-due order without filling the requested count", async () => {
        mocks.findMany.mockResolvedValue([
            candidate("future", "2099-01-01T00:00:00Z"),
            candidate("later", "2021-01-01T00:00:00Z"),
            candidate("earlier", "2020-01-01T00:00:00Z"),
        ]);

        const response = await POST(request({ mode: "ebbinghaus" }));
        const createdItems = mocks.createSession.mock.calls[0][0].data.items.create;

        expect(response.status).toBe(201);
        expect(createdItems).toHaveLength(2);
        expect(createdItems.map((item: { errorItemId: string }) => item.errorItemId)).toEqual(["earlier", "later"]);
    });

    it.each([1, 2, 3, 4, 5])("creates exactly %i questions when that many are due", async (dueCount) => {
        mocks.findMany.mockResolvedValue(Array.from({ length: dueCount }, (_, index) =>
            candidate(`due-${index}`, `2020-01-${String(index + 1).padStart(2, "0")}T00:00:00Z`)));

        const response = await POST(request({ mode: "ebbinghaus", filters: { subjectId: "math" } }));
        const createdItems = mocks.createSession.mock.calls[0][0].data.items.create;

        expect(response.status).toBe(201);
        expect(createdItems).toHaveLength(dueCount);
        expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ subjectId: "math" }),
        }));
    });

    it("returns a structured empty-due response", async () => {
        mocks.findMany.mockResolvedValue([candidate("future", "2099-01-01T00:00:00Z")]);

        const response = await POST(request({ mode: "ebbinghaus" }));

        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ details: { reason: "NO_DUE_REVIEWS" } });
        expect(mocks.createSession).not.toHaveBeenCalled();
    });

    it("reuses an unfinished daily session without selecting or generating again", async () => {
        mocks.findSession.mockResolvedValue({
            id: "active",
            userId: "user-1",
            mode: "daily",
            questionSource: "variant",
            language: "zh",
            startedAt: new Date("2026-01-01T00:00:00Z"),
            endedAt: null,
            items: [],
        });

        const response = await POST(request({ mode: "daily", questionSource: "variant" }));

        expect(response.status).toBe(200);
        expect((await response.json()).id).toBe("active");
        expect(mocks.findMany).not.toHaveBeenCalled();
        expect(mocks.createSession).not.toHaveBeenCalled();
    });

    it("orders due reviews by date, skips future items, and caps daily work at five", async () => {
        mocks.findMany.mockResolvedValue([
            candidate("later", "2020-01-02T00:00:00Z"),
            candidate("future", "2099-01-01T00:00:00Z"),
            candidate("earlier", "2020-01-01T00:00:00Z"),
            candidate("third", "2020-01-03T00:00:00Z"),
            candidate("fourth", "2020-01-04T00:00:00Z"),
            candidate("fifth", "2020-01-05T00:00:00Z"),
            candidate("sixth", "2020-01-06T00:00:00Z"),
        ]);
        mocks.generateSimilarQuestion.mockImplementation((question: string) => Promise.resolve({
            questionText: `variant-${question}`,
            answerText: "variant-answer",
        }));

        const response = await POST(request({ mode: "daily", questionSource: "variant" }));
        const createdItems = mocks.createSession.mock.calls[0][0].data.items.create;

        expect(response.status).toBe(201);
        expect(createdItems).toHaveLength(5);
        expect(createdItems.map((item: { errorItemId: string }) => item.errorItemId)).toEqual([
            "earlier", "later", "third", "fourth", "fifth",
        ]);
        expect(createdItems.every((item: { generationMode: string }) => item.generationMode === "variant")).toBe(true);
        expect(mocks.generateSimilarQuestion).toHaveBeenCalledTimes(5);
    });

    it("tries every selected variant and falls back only failed questions", async () => {
        mocks.findMany.mockResolvedValue([
            candidate("one", "2020-01-01T00:00:00Z"),
            candidate("two", "2020-01-02T00:00:00Z"),
        ]);
        mocks.generateSimilarQuestion.mockImplementation((question: string) => question === "question-one"
            ? Promise.resolve({ questionText: "variant-one", answerText: "variant-answer-one" })
            : Promise.reject(new Error("generation failed")));

        const response = await POST(request({ questionSource: "variant" }));
        const createdItems = mocks.createSession.mock.calls[0][0].data.items.create;

        expect(response.status).toBe(201);
        expect(mocks.generateSimilarQuestion).toHaveBeenCalledTimes(2);
        expect(createdItems.map((item: { generationMode: string }) => item.generationMode).sort()).toEqual(["fallback", "variant"]);
    });

    it("falls back all questions when the variant service cannot initialize", async () => {
        mocks.findMany.mockResolvedValue([candidate("one", "2020-01-01T00:00:00Z")]);
        mocks.getAIService.mockImplementation(() => { throw new Error("not configured"); });

        const response = await POST(request({ questionSource: "variant" }));
        const createdItems = mocks.createSession.mock.calls[0][0].data.items.create;

        expect(response.status).toBe(201);
        expect(createdItems[0].generationMode).toBe("fallback");
        expect(mocks.generateSimilarQuestion).not.toHaveBeenCalled();
    });

    it("rejects legacy mode and source values for new sessions", async () => {
        const knowledgeResponse = await POST(request({ mode: "knowledge" }));
        const mixedResponse = await POST(request({ questionSource: "mixed" }));

        expect(knowledgeResponse.status).toBe(400);
        expect(mixedResponse.status).toBe(400);
        expect(mocks.findMany).not.toHaveBeenCalled();
    });
});
