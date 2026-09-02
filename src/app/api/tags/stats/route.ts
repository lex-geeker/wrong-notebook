import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { unauthorized } from "@/lib/api-errors";

const logger = createLogger('api:tags:stats');

export const dynamic = "force-dynamic";


/**
 * GET /api/tags/stats
 * 获取标签使用频率统计
 */
export async function GET(request?: Request) {
    void request;
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return unauthorized();

    try {
        // 获取所有错题的知识点
        const errorItems = await prisma.errorItem.findMany({
            where: { userId: session.user.id },
            select: {
                tags: { select: { name: true } },
            },
        });

        // 统计标签使用频率
        const tagStats: Record<string, number> = {};

        errorItems.forEach((item) => {
            item.tags.forEach(({ name }) => {
                tagStats[name] = (tagStats[name] || 0) + 1;
            });
        });

        // 转换为数组并按使用次数排序
        const sortedStats = Object.entries(tagStats)
            .map(([tag, count]) => ({ tag, count }))
            .sort((a, b) => b.count - a.count);

        return NextResponse.json({
            stats: sortedStats,
            total: errorItems.length,
            uniqueTags: sortedStats.length,
        });
    } catch (error) {
        logger.error({ error }, 'Error getting tag stats');
        return NextResponse.json(
            { message: "Failed to get tag statistics" },
            { status: 500 }
        );
    }
}
