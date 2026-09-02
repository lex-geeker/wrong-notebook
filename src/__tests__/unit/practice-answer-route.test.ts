import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getServerSession: vi.fn(),
    transaction: vi.fn(),
    findItem: vi.fn(),
    createRecord: vi.fn(),
    updateRecord: vi.fn(),
    updateErrorItem: vi.fn(),
    countItems: vi.fn(),
    updateSession: vi.fn(),
}));

vi.mock('next-auth', () => ({ getServerSession: mocks.getServerSession }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: mocks.transaction } }));

import { POST } from '@/app/api/practice/sessions/[id]/answer/route';

const context = { params: Promise.resolve({ id: 'session-1' }) };
const item = {
    id: 'item-1',
    sessionId: 'session-1',
    errorItemId: 'error-1',
    subjectName: 'Math',
    answerText: '4',
    record: null,
    errorItem: { masteryLevel: 1 },
};
const request = (body: Record<string, unknown>) => new Request('http://localhost/api/practice/sessions/session-1/answer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
});

describe('POST /api/practice/sessions/[id]/answer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getServerSession.mockResolvedValue({ user: { id: 'user-1' } });
        mocks.countItems.mockResolvedValue(0);
        mocks.transaction.mockImplementation((callback) => callback({
            practiceSessionItem: { findFirst: mocks.findItem, count: mocks.countItems },
            practiceRecord: { create: mocks.createRecord, update: mocks.updateRecord },
            errorItem: { update: mocks.updateErrorItem },
            practiceSession: { update: mocks.updateSession },
        }));
    });

    it('automatically grades exact answers and completes the session', async () => {
        mocks.findItem.mockResolvedValue(item);

        const response = await POST(request({ action: 'submit', itemId: 'item-1', answerInput: ' 4 ' }), context);
        const body = await response.json();

        expect(body).toMatchObject({ status: 'graded', masteryLevel: 2, answer: { isCorrect: true, matchType: 'exact' } });
        expect(mocks.createRecord).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ isCorrect: true, answerInput: '4' }),
        }));
        expect(mocks.updateErrorItem).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'error-1', userId: 'user-1' },
        }));
        expect(mocks.updateSession).toHaveBeenCalledOnce();
    });

    it('creates a pending record for answers that require self-assessment', async () => {
        mocks.findItem.mockResolvedValue({ ...item, answerText: 'A linear equation' });

        const response = await POST(request({ action: 'submit', itemId: 'item-1', answerInput: 'linear equation' }), context);
        const body = await response.json();

        expect(body).toMatchObject({
            status: 'needs_self_assessment',
            masteryLevel: null,
            answer: { expectedAnswer: 'A linear equation', isCorrect: null, matchType: 'self_assessment' },
        });
        expect(mocks.createRecord).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ isCorrect: null }),
        }));
        expect(mocks.updateErrorItem).not.toHaveBeenCalled();
        expect(mocks.updateSession).not.toHaveBeenCalled();
    });

    it('finishes self-assessment before updating mastery and session state', async () => {
        mocks.findItem.mockResolvedValue({
            ...item,
            record: { id: 'record-1', isCorrect: null, answerInput: 'my answer' },
        });

        const response = await POST(request({ action: 'assess', itemId: 'item-1', isCorrect: false }), context);
        const body = await response.json();

        expect(body).toMatchObject({ status: 'graded', masteryLevel: 0, answer: { isCorrect: false } });
        expect(mocks.updateRecord).toHaveBeenCalledWith({ where: { id: 'record-1' }, data: { isCorrect: false } });
        expect(mocks.updateErrorItem).toHaveBeenCalledWith(expect.objectContaining({ data: { masteryLevel: 0 } }));
        expect(mocks.updateSession).toHaveBeenCalledOnce();
    });

    it('rejects duplicate submissions without another write', async () => {
        mocks.findItem.mockResolvedValue({ ...item, record: { id: 'record-1', isCorrect: true } });

        const response = await POST(request({ action: 'submit', itemId: 'item-1', answerInput: '4' }), context);

        expect(response.status).toBe(409);
        expect(mocks.createRecord).not.toHaveBeenCalled();
        expect(mocks.updateErrorItem).not.toHaveBeenCalled();
    });
});
