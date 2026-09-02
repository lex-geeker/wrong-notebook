/**
 * /api/tags API 集成测试
 * 测试标签统计和标签建议接口
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted to ensure mocks are initialized before module imports
const mocks = vi.hoisted(() => ({
    mockPrismaErrorItem: {
        findMany: vi.fn(),
    },
    mockPrismaKnowledgeTag: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
    },
    mockGetServerSession: vi.fn(),
}));

// Mock Prisma client
vi.mock('@/lib/prisma', () => ({
    prisma: {
        errorItem: mocks.mockPrismaErrorItem,
        knowledgeTag: mocks.mockPrismaKnowledgeTag,
    },
}));

// Mock next-auth
vi.mock('next-auth', () => ({
    getServerSession: mocks.mockGetServerSession,
}));

// Mock auth options
vi.mock('@/lib/auth', () => ({
    authOptions: {},
}));

// Import after mocks
import { GET as GET_STATS } from '@/app/api/tags/stats/route';
import { GET as GET_SUGGESTIONS } from '@/app/api/tags/suggestions/route';
import { POST as CREATE_TAG } from '@/app/api/tags/route';
import { NextRequest } from 'next/server';

describe('/api/tags', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.mockGetServerSession.mockResolvedValue({ user: { id: 'user-1' } });
    });

    describe('POST /api/tags', () => {
        it('拒绝把其他用户的标签设为父标签', async () => {
            mocks.mockPrismaKnowledgeTag.findFirst.mockResolvedValue(null);

            const response = await CREATE_TAG(new NextRequest('http://localhost/api/tags', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: '自定义标签', subject: 'math', parentId: 'other-parent' }),
            }));

            expect(response.status).toBe(400);
            expect(mocks.mockPrismaKnowledgeTag.findFirst).toHaveBeenCalledWith({
                where: {
                    id: 'other-parent',
                    subject: 'math',
                    OR: [
                        { isSystem: true, userId: null },
                        { isSystem: false, userId: 'user-1' },
                    ],
                },
            });
            expect(mocks.mockPrismaKnowledgeTag.create).not.toHaveBeenCalled();
        });
    });

    describe('GET /api/tags/stats (标签统计)', () => {
        it('应该返回标签使用频率统计', async () => {
            const errorItems = [
                { tags: [{ name: '一元一次方程' }, { name: '移项' }] },
                { tags: [{ name: '一元一次方程' }, { name: '函数' }] },
                { tags: [{ name: '函数' }, { name: '图像' }] },
            ];
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue(errorItems);

            const request = new Request('http://localhost/api/tags/stats');
            const response = await GET_STATS(request);
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.stats).toBeDefined();
            expect(data.total).toBe(3);
            expect(data.uniqueTags).toBeGreaterThan(0);

            // 验证排序（按使用次数降序）
            const stats = data.stats;
            for (let i = 1; i < stats.length; i++) {
                expect(stats[i - 1].count).toBeGreaterThanOrEqual(stats[i].count);
            }
        });

        it('应该正确统计每个标签的使用次数', async () => {
            const errorItems = [
                { tags: [{ name: '一元一次方程' }] },
                { tags: [{ name: '一元一次方程' }] },
                { tags: [{ name: '一元一次方程' }] },
                { tags: [{ name: '函数' }] },
            ];
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue(errorItems);

            const request = new Request('http://localhost/api/tags/stats');
            const response = await GET_STATS(request);
            const data = await response.json();

            expect(response.status).toBe(200);

            const equationStat = data.stats.find((s: { tag: string }) => s.tag === '一元一次方程');
            expect(equationStat).toBeDefined();
            expect(equationStat.count).toBe(3);

            const functionStat = data.stats.find((s: { tag: string }) => s.tag === '函数');
            expect(functionStat).toBeDefined();
            expect(functionStat.count).toBe(1);
        });

        it('应该处理空的错题列表', async () => {
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);

            const request = new Request('http://localhost/api/tags/stats');
            const response = await GET_STATS(request);
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.stats).toEqual([]);
            expect(data.total).toBe(0);
            expect(data.uniqueTags).toBe(0);
        });

        it('应该处理没有标签的错题', async () => {
            const errorItems = [
                { tags: [] },
                { tags: [{ name: '有效标签' }] },
            ];
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue(errorItems);

            const request = new Request('http://localhost/api/tags/stats');
            const response = await GET_STATS(request);
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.stats.length).toBe(1);
            expect(data.stats[0].tag).toBe('有效标签');
        });

        it('应该处理多个空标签关系', async () => {
            const errorItems = [
                { tags: [] },
                { tags: [] },
                { tags: [{ name: '有效标签' }] },
            ];
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue(errorItems);

            const request = new Request('http://localhost/api/tags/stats');
            const response = await GET_STATS(request);
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.total).toBe(3);
            expect(data.uniqueTags).toBe(1);
        });

        it('应该统计关系标签', async () => {
            const errorItems = [
                { tags: [{ name: '有效标签' }] },
            ];
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue(errorItems);

            const request = new Request('http://localhost/api/tags/stats');
            const response = await GET_STATS(request);
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.stats.length).toBe(1);
            expect(data.stats[0].tag).toBe('有效标签');
        });

        it('应该处理数据库错误', async () => {
            mocks.mockPrismaErrorItem.findMany.mockRejectedValue(
                new Error('Database connection failed')
            );

            const request = new Request('http://localhost/api/tags/stats');
            const response = await GET_STATS(request);
            const data = await response.json();

            expect(response.status).toBe(500);
            expect(data.message).toBe('Failed to get tag statistics');
        });
    });

    describe('GET /api/tags/suggestions (标签建议)', () => {
        // Helper to create mock tag data (simulates KnowledgeTag from DB)
        const createMockTag = (name: string, isSystem = true, hasChildren = false) => ({
            id: `tag-${name}`,
            name,
            parentId: null,
            userId: null,
            isSystem,
            children: hasChildren ? [{ id: 'child' }] : [],
        });

        beforeEach(() => {
            // Default: return empty tags
            mocks.mockPrismaKnowledgeTag.findMany.mockResolvedValue([]);
        });

        it('应该返回所有叶子标签建议（无搜索词）', async () => {
            const mockTags = [
                createMockTag('一元一次方程'),
                createMockTag('二元一次方程'),
                createMockTag('父节点', true, true), // 有子节点，不应返回
            ];
            mocks.mockPrismaKnowledgeTag.findMany.mockResolvedValue(mockTags);

            const request = new Request('http://localhost/api/tags/suggestions');
            const response = await GET_SUGGESTIONS(request);
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.suggestions).toBeDefined();
            expect(Array.isArray(data.suggestions)).toBe(true);
            expect(data.suggestions).toContain('一元一次方程');
            expect(data.suggestions).toContain('二元一次方程');
            expect(data.suggestions).not.toContain('父节点');
        });

        it('应该根据搜索词过滤标签', async () => {
            const mockTags = [
                createMockTag('一元一次方程'),
                createMockTag('二元一次方程'),
                createMockTag('函数'),
            ];
            mocks.mockPrismaKnowledgeTag.findMany.mockResolvedValue(mockTags);

            const request = new Request('http://localhost/api/tags/suggestions?q=方程');
            const response = await GET_SUGGESTIONS(request);
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.suggestions).toContain('一元一次方程');
            expect(data.suggestions).toContain('二元一次方程');
            expect(data.suggestions).not.toContain('函数');
        });

        it('应该支持大小写不敏感搜索', async () => {
            const mockTags = [
                createMockTag('Function'),
                createMockTag('Array'),
            ];
            mocks.mockPrismaKnowledgeTag.findMany.mockResolvedValue(mockTags);

            const request = new Request('http://localhost/api/tags/suggestions?q=function');
            const response = await GET_SUGGESTIONS(request);
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.suggestions).toContain('Function');
        });

        it('应该返回系统标签和用户自定义标签', async () => {
            mocks.mockGetServerSession.mockResolvedValue({
                user: { id: 'user-1' }
            });

            const mockTags = [
                createMockTag('系统标签', true),
                { ...createMockTag('自定义标签', false), userId: 'user-1' },
            ];
            mocks.mockPrismaKnowledgeTag.findMany.mockResolvedValue(mockTags);

            const request = new Request('http://localhost/api/tags/suggestions');
            const response = await GET_SUGGESTIONS(request);
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.suggestions).toContain('系统标签');
            expect(data.suggestions).toContain('自定义标签');
        });

        it('应该限制返回结果数量（最多 30 个）', async () => {
            // 创建超过 30 个标签
            const manyTags = Array.from({ length: 50 }, (_, i) =>
                createMockTag(`标签${i + 1}`)
            );
            mocks.mockPrismaKnowledgeTag.findMany.mockResolvedValue(manyTags);

            const request = new Request('http://localhost/api/tags/suggestions');
            const response = await GET_SUGGESTIONS(request);
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.suggestions.length).toBeLessThanOrEqual(30);
        });

        it('应该处理空搜索词', async () => {
            const mockTags = [createMockTag('测试标签')];
            mocks.mockPrismaKnowledgeTag.findMany.mockResolvedValue(mockTags);

            const request = new Request('http://localhost/api/tags/suggestions?q=');
            const response = await GET_SUGGESTIONS(request);
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.suggestions.length).toBeGreaterThan(0);
        });

        it('应该处理无匹配结果', async () => {
            const mockTags = [createMockTag('一元一次方程')];
            mocks.mockPrismaKnowledgeTag.findMany.mockResolvedValue(mockTags);

            const request = new Request('http://localhost/api/tags/suggestions?q=不存在的标签xyz');
            const response = await GET_SUGGESTIONS(request);
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.suggestions).toEqual([]);
            expect(data.total).toBe(0);
        });

        it('应该处理数据库错误', async () => {
            mocks.mockPrismaKnowledgeTag.findMany.mockRejectedValue(
                new Error('Database connection failed')
            );

            const request = new Request('http://localhost/api/tags/suggestions');
            const response = await GET_SUGGESTIONS(request);
            const data = await response.json();

            expect(response.status).toBe(500);
            expect(data.message).toBe('Failed to get tag suggestions');
        });

        it('应该支持部分匹配', async () => {
            const mockTags = [
                createMockTag('一元一次方程'),
                createMockTag('二元一次方程'),
                createMockTag('一元二次方程'),
                createMockTag('函数'),
            ];
            mocks.mockPrismaKnowledgeTag.findMany.mockResolvedValue(mockTags);

            const request = new Request('http://localhost/api/tags/suggestions?q=一次');
            const response = await GET_SUGGESTIONS(request);
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.suggestions).toContain('一元一次方程');
            expect(data.suggestions).toContain('二元一次方程');
            expect(data.suggestions).not.toContain('函数');
        });
    });
});
