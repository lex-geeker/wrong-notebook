import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { unauthorized, internalError, badRequest } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MIN_PAGE_SIZE } from "@/lib/constants/pagination";

const logger = createLogger('api:error-items:list');
const querySchema = z.object({
    subjectId: z.string().trim().min(1).max(200).optional(),
    query: z.string().trim().min(1).max(500).optional(),
    mastery: z.enum(["0", "1", "2"]).optional(),
    timeRange: z.enum(["all", "week", "month"]).default("all"),
    tag: z.string().trim().min(1).max(100).optional(),
    view: z.enum(["summary", "print"]).default("summary"),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(MIN_PAGE_SIZE).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
    gradeSemester: z.string().trim().min(1).max(100).optional(),
    paperLevel: z.enum(["all", "a", "b", "other", "A", "B", "Other"]).default("all"),
});

export async function GET(req: Request) {
    const session = await getServerSession(authOptions);

    try {
        if (!session?.user?.id) {
            return unauthorized("Authentication required");
        }
        const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
        if (!parsed.success) return badRequest("Invalid list filters", parsed.error.flatten());
        const { subjectId, query, mastery, timeRange, tag, view, page, pageSize, gradeSemester, paperLevel } = parsed.data;

        const whereClause: Prisma.ErrorItemWhereInput = {
            userId: session.user.id,
        };

        if (subjectId) {
            whereClause.subjectId = subjectId;
        }

        // 搜索条件需要使用 AND 包装，避免与其他 OR 条件冲突
        // 最终的 whereClause.AND 会包含所有需要同时满足的条件
        const andConditions: Prisma.ErrorItemWhereInput[] = [];

        if (query) {
            // 搜索条件：在题目、解析、知识点中任一匹配即可
            andConditions.push({
                OR: [
                    { questionText: { contains: query } },
                    { analysis: { contains: query } },
                    { wrongAnswerText: { contains: query } },
                    { mistakeAnalysis: { contains: query } },
                    { tags: { some: { name: { contains: query } } } },
                ]
            });
        }

        // Mastery filter
        if (mastery) {
            whereClause.masteryLevel = Number(mastery);
        }

        // Time range filter
        if (timeRange && timeRange !== "all") {
            const now = new Date();
            const startDate = new Date();

            if (timeRange === "week") {
                startDate.setDate(now.getDate() - 7);
            } else if (timeRange === "month") {
                startDate.setMonth(now.getMonth() - 1);
            }

            whereClause.createdAt = {
                gte: startDate,
            };
        }

        if (tag) {
            andConditions.push({
                tags: { some: { name: tag } },
            });
        }

        if (gradeSemester) {
            whereClause.gradeSemester = gradeSemester;
        }

        // Paper Level filter
        if (paperLevel !== "all") {
            whereClause.paperLevel = paperLevel;
        }

        // 将所有 AND 条件合并到 whereClause
        if (andConditions.length > 0) {
            whereClause.AND = andConditions;
        }

        // 获取总数
        const totalPromise = prisma.errorItem.count({ where: whereClause });

        // 分页查询
        const pagination = {
            where: whereClause,
            orderBy: { createdAt: "desc" } as const,
            skip: (page - 1) * pageSize,
            take: pageSize,
        };
        const itemsPromise = view === "print"
            ? prisma.errorItem.findMany({ ...pagination, include: { subject: true, tags: true } })
            : prisma.errorItem.findMany({
                ...pagination,
                select: {
                    id: true,
                    questionText: true,
                    masteryLevel: true,
                    mistakeStatus: true,
                    createdAt: true,
                    tags: { select: { id: true, name: true } },
                },
            });
        const [total, errorItems] = await Promise.all([totalPromise, itemsPromise]);

        const totalPages = Math.ceil(total / pageSize);

        return NextResponse.json({
            items: errorItems,
            total,
            page,
            pageSize,
            totalPages,
        });
    } catch (error) {
        logger.error({ error }, 'Error fetching items');
        return internalError("Failed to fetch error items");
    }
}
