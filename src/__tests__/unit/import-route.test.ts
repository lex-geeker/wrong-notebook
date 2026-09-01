import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getServerSession: vi.fn(),
    findUser: vi.fn(),
    transaction: vi.fn(),
    findTags: vi.fn(),
}));

vi.mock('next-auth', () => ({ getServerSession: mocks.getServerSession }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/prisma', () => ({
    prisma: {
        user: { findUnique: mocks.findUser },
        $transaction: mocks.transaction,
    },
}));

import { POST } from '@/app/api/import/route';

describe('POST /api/import', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getServerSession.mockResolvedValue({ user: { email: 'user@example.com', role: 'user' } });
        mocks.findUser.mockResolvedValue({ id: 'user-1', email: 'user@example.com' });
        mocks.findTags.mockResolvedValue([]);
        mocks.transaction.mockImplementation((callback) => callback({
            knowledgeTag: { findMany: mocks.findTags },
        }));
    });

    it('ignores legacy review schedules and reports their count', async () => {
        const response = await POST(new Request('http://localhost/api/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                version: 1,
                user: { email: 'user@example.com' },
                subjects: [],
                customTags: [],
                errorItems: [],
                practiceRecords: [],
                reviewSchedules: [{ id: 'one' }, { id: 'two' }],
            }),
        }));

        expect(response.status).toBe(200);
        expect((await response.json()).stats).toMatchObject({ reviewSchedulesIgnored: 2 });
    });
});
