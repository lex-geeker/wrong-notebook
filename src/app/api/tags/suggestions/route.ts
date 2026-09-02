import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { createLogger } from "@/lib/logger";
import type { Prisma } from "@prisma/client";
import { unauthorized } from "@/lib/api-errors";

const logger = createLogger('api:tags:suggestions');

const STAGE_GRADES: Record<string, string[]> = {
    primary: ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级'],
    junior_high: ['七年级', '八年级', '九年级'],
    senior_high: ['高一', '高二', '高三'],
};

async function findStageSystemTagIds(stage: string | undefined, subject: string | undefined) {
    const grades = stage ? STAGE_GRADES[stage] : undefined;
    if (!grades) return undefined;

    let frontier = (await prisma.knowledgeTag.findMany({
        where: {
            isSystem: true,
            userId: null,
            parentId: null,
            ...(subject ? { subject } : {}),
            OR: grades.map(name => ({ name: { contains: name } })),
        },
        select: { id: true },
    })).map(tag => tag.id);
    const ids = new Set(frontier);

    while (frontier.length > 0) {
        const children = await prisma.knowledgeTag.findMany({
            where: {
                isSystem: true,
                userId: null,
                parentId: { in: frontier },
                ...(subject ? { subject } : {}),
            },
            select: { id: true },
        });
        frontier = children.map(tag => tag.id).filter(id => !ids.has(id));
        frontier.forEach(id => ids.add(id));
    }

    return [...ids];
}

/**
 * GET /api/tags/suggestions
 * 获取标签建议（支持搜索）
 * Query params: 
 *   - q: 搜索词
 *   - subject: 学科 (可选, e.g., 'math')
 *   - stage: 学段 (可选)
 * 
 * 现在从数据库 KnowledgeTag 表查询，包含系统标签和用户的自定义标签
 */
export async function GET(req: Request) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) return unauthorized();
        const { searchParams } = new URL(req.url);
        const query = searchParams.get("q")?.trim() || "";
        const subject = searchParams.get("subject") || undefined;
        const stage = searchParams.get("stage") || undefined;
        const stageSystemTagIds = await findStageSystemTagIds(stage, subject);

        const whereCondition: Prisma.KnowledgeTagWhereInput = {
            ...(subject ? { subject } : {}),
            ...(query ? { name: { contains: query } } : {}),
            children: { none: {} },
            OR: [
                {
                    isSystem: true,
                    userId: null,
                    ...(stageSystemTagIds ? { id: { in: stageSystemTagIds } } : {}),
                },
                { isSystem: false, userId: session.user.id },
            ]
        };

        const [suggestions, total] = await Promise.all([
            prisma.knowledgeTag.findMany({
                where: whereCondition,
                select: { name: true },
                take: 30,
            }),
            prisma.knowledgeTag.count({ where: whereCondition }),
        ]);

        return NextResponse.json({
            suggestions: suggestions.map(tag => tag.name),
            total,
        });
    } catch (error) {
        logger.error({ error }, 'Error getting tag suggestions');
        return NextResponse.json(
            { message: "Failed to get tag suggestions" },
            { status: 500 }
        );
    }
}
