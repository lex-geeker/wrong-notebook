import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findUnique: vi.fn() }));

vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: mocks.findUnique } } }));
vi.mock('next-auth/providers/credentials', () => ({ default: vi.fn((options) => options) }));
vi.mock('@/lib/logger', () => ({
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { authOptions } from '@/lib/auth';

describe('NextAuth session refresh', () => {
    beforeEach(() => vi.clearAllMocks());

    it('refreshes role and active state from the database on every JWT parse', async () => {
        mocks.findUnique.mockResolvedValue({ role: 'admin', isActive: true });

        const token = await authOptions.callbacks!.jwt!({ token: { id: 'user-1', role: 'user' } } as never);

        expect(token).toMatchObject({ id: 'user-1', role: 'admin', isActive: true });
        expect(mocks.findUnique).toHaveBeenCalledWith({
            where: { id: 'user-1' },
            select: { role: true, isActive: true },
        });
    });

    it('removes disabled users from server sessions', async () => {
        mocks.findUnique.mockResolvedValue({ role: 'user', isActive: false });
        const token = await authOptions.callbacks!.jwt!({ token: { id: 'user-1' } } as never);

        const session = await authOptions.callbacks!.session!({
            session: { user: { name: 'Disabled' }, expires: '2099-01-01' },
            token,
        } as never);

        expect(session.user).toBeUndefined();
    });
});
