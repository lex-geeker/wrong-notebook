import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { unauthorized, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MIN_PAGE_SIZE } from "@/lib/constants/pagination";

const logger = createLogger('api:error-items:list');

export async function GET(req: Request) {
    const session = await getServerSession(authOptions);

    const { searchParams } = new URL(req.url);
    const subjectId = searchParams.get("subjectId");
    const query = searchParams.get("query");
    const mastery = searchParams.get("mastery");
    const timeRange = searchParams.get("timeRange");
    const tag = searchParams.get("tag");
    const view = searchParams.get("view") === "print" ? "print" : "summary";

    // 分页参数
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, parseInt(searchParams.get("pageSize") || String(DEFAULT_PAGE_SIZE), 10)));

    try {
        let user;
        if (session?.user?.email) {
            user = await prisma.user.findUnique({
                where: { email: session.user.email },
            });
        }

        if (!user) {
            return unauthorized("Authentication required");
        }

        const whereClause: Prisma.ErrorItemWhereInput = {
            userId: user.id,
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
        if (mastery && ["0", "1", "2"].includes(mastery)) {
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

        const gradeSemester = searchParams.get("gradeSemester");
        if (gradeSemester) {
            whereClause.gradeSemester = gradeSemester;
        }

        // Paper Level filter
        const paperLevel = searchParams.get("paperLevel");
        if (paperLevel && paperLevel !== "all") {
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
