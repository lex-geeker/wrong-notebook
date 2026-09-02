import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { rebuildSystemTags } from '@/lib/rebuild-system-tags';

describe('rebuildSystemTags', () => {
    it('rebuilds tags and preserves missing associations as user tags', async () => {
        let nextId = 0;
        const tx = {
            errorItem: {
                findMany: vi.fn().mockResolvedValue([{
                    id: 'item-1',
                    userId: 'user-1',
                    tags: [{ name: 'legacy-tag', subject: 'math', parent: null }],
                }]),
                update: vi.fn().mockResolvedValue({}),
            },
            knowledgeTag: {
                deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
                findFirst: vi.fn().mockResolvedValue(null),
                create: vi.fn().mockImplementation(() => Promise.resolve({ id: `tag-${++nextId}` })),
            },
        };
        const prisma = {
            $transaction: vi.fn((callback) => callback(tx)),
        } as unknown as PrismaClient;

        const result = await rebuildSystemTags(prisma);

        expect(result.count).toBeGreaterThan(0);
        expect(result).toMatchObject({ associationsRestored: 1, customTagsCreated: 1 });
        expect(tx.knowledgeTag.deleteMany).toHaveBeenCalledWith({ where: { isSystem: true } });
        expect(tx.errorItem.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'item-1' } }));
    });
});
