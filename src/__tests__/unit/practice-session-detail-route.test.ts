import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getServerSession: vi.fn(),
    findSession: vi.fn(),
    transaction: vi.fn(),
    txFindSession: vi.fn(),
    createRecord: vi.fn(),
    updateErrorItem: vi.fn(),
    updateSession: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({
    prisma: {
        practiceSession: { findFirst: mocks.findSession },
        $transaction: mocks.transaction,
    },
}));

import { GET, PATCH } from "@/app/api/practice/sessions/[id]/route";

const baseItem = {
    sessionId: "session-1",
    subjectName: "Math",
    gradeSemester: null,
    knowledgePoints: "[]",
    sourceQuestionText: "source question",
    sourceAnswerText: "source answer",
    generationMode: "variant",
};

const session = {
    id: "session-1",
    userId: "user-1",
    mode: "ebbinghaus",
    questionSource: "variant",
    language: "en",
    startedAt: new Date("2026-01-01T00:00:00Z"),
    endedAt: null,
    items: [
        {
            ...baseItem,
            id: "item-1",
            errorItemId: "error-1",
            position: 0,
            questionText: "question one",
            answerText: "answer one",
            record: null,
        },
        {
            ...baseItem,
            id: "item-2",
            errorItemId: "error-2",
            position: 1,
            questionText: "question two",
            answerText: "answer two",
            record: null,
        },
    ],
};

const context = { params: Promise.resolve({ id: "session-1" }) };

function patchRequest(paperResults: Array<{ itemId: string; isCorrect: boolean }>) {
    return new Request("http://localhost/api/practice/sessions/session-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paperResults }),
    });
}

describe("/api/practice/sessions/[id]", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getServerSession.mockResolvedValue({ user: { id: "user-1" } });
        const tx = {
            practiceSession: { findFirst: mocks.txFindSession, update: mocks.updateSession },
            practiceRecord: { create: mocks.createRecord },
            errorItem: { update: mocks.updateErrorItem },
        };
        mocks.transaction.mockImplementation((callback) => callback(tx));
    });

    it("only includes reference answers when the owner explicitly requests them", async () => {
        mocks.findSession.mockResolvedValue(session);

        const hidden = await GET(new Request("http://localhost/api/practice/sessions/session-1"), context);
        const visible = await GET(new Request("http://localhost/api/practice/sessions/session-1?includeAnswers=1"), context);

        expect((await hidden.json()).items[0]).not.toHaveProperty("expectedAnswer");
        expect((await visible.json()).items[0]).toMatchObject({ expectedAnswer: "answer one" });
        expect(mocks.findSession).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: "session-1", userId: "user-1" },
        }));
    });

    it("does not expose another user's practice session", async () => {
        mocks.findSession.mockResolvedValue(null);

        const response = await GET(new Request("http://localhost/api/practice/sessions/session-1?includeAnswers=1"), context);

        expect(response.status).toBe(404);
    });

    it("saves a complete paper result set and updates mastery in one transaction", async () => {
        const loaded = {
            ...session,
            items: session.items.map((item, index) => ({
                ...item,
                errorItem: { masteryLevel: index + 1 },
            })),
        };
        const completed = {
            ...session,
            endedAt: new Date("2026-01-02T00:00:00Z"),
            items: session.items.map((item, index) => ({
                ...item,
                record: {
                    id: `record-${index}`,
                    userId: "user-1",
                    sessionItemId: item.id,
                    errorItemId: item.errorItemId,
                    subject: "Math",
                    difficulty: null,
                    isCorrect: index === 0,
                    answerInput: null,
                    createdAt: new Date("2026-01-02T00:00:00Z"),
                },
            })),
        };
        mocks.txFindSession.mockResolvedValueOnce(loaded).mockResolvedValueOnce(completed);

        const response = await PATCH(patchRequest([
            { itemId: "item-1", isCorrect: true },
            { itemId: "item-2", isCorrect: false },
        ]), context);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(mocks.transaction).toHaveBeenCalledOnce();
        expect(mocks.createRecord).toHaveBeenCalledTimes(2);
        expect(mocks.createRecord).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ sessionItemId: "item-1", isCorrect: true, answerInput: null }),
        }));
        expect(mocks.updateErrorItem.mock.calls.map(([input]) => input.data.masteryLevel)).toEqual([2, 0]);
        expect(mocks.updateSession).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "session-1" } }));
        expect(body.items.map((item: { answer: { matchType: string } }) => item.answer.matchType)).toEqual(["manual", "manual"]);
    });

    it("rejects missing results before writing any records", async () => {
        mocks.txFindSession.mockResolvedValue({
            ...session,
            items: session.items.map((item) => ({ ...item, errorItem: { masteryLevel: 0 } })),
        });

        const response = await PATCH(patchRequest([{ itemId: "item-1", isCorrect: true }]), context);

        expect(response.status).toBe(400);
        expect(mocks.createRecord).not.toHaveBeenCalled();
        expect(mocks.updateSession).not.toHaveBeenCalled();
    });

    it("does not close the session when a paper record write fails", async () => {
        mocks.txFindSession.mockResolvedValue({
            ...session,
            items: session.items.map((item) => ({ ...item, errorItem: { masteryLevel: 0 } })),
        });
        mocks.createRecord.mockRejectedValueOnce(new Error("write failed"));

        const response = await PATCH(patchRequest([
            { itemId: "item-1", isCorrect: true },
            { itemId: "item-2", isCorrect: true },
        ]), context);

        expect(response.status).toBe(500);
        expect(mocks.updateSession).not.toHaveBeenCalled();
    });
});
