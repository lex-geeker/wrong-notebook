import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { getAIService } from "@/lib/ai";
import { badRequest, internalError, unauthorized } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import {
    PRACTICE_COUNTS,
    PRACTICE_MODES,
    PRACTICE_SOURCES,
    getNextReviewDate,
    getReviewRecords,
    isReviewDue,
    pickRandom,
    serializePracticeSession,
} from "@/lib/practice";
import { prisma } from "@/lib/prisma";

const logger = createLogger("api:practice:sessions");

const filtersSchema = z.object({
    subjectId: z.string().trim().min(1).optional(),
    gradeSemester: z.string().trim().min(1).max(100).optional(),
    chapter: z.string().trim().min(1).max(100).optional(),
    tag: z.string().trim().min(1).max(100).optional(),
    mastery: z.enum(["all", "new", "reviewing", "mastered"]).optional(),
    timeRange: z.enum(["all", "week", "month"]).optional(),
}).optional();

const createSessionSchema = z.object({
    mode: z.enum(PRACTICE_MODES),
    questionSource: z.enum(PRACTICE_SOURCES),
    count: z.number().int().refine((value) => PRACTICE_COUNTS.includes(value as never)),
    language: z.enum(["zh", "en"]).default("zh"),
    filters: filtersSchema,
    errorItemId: z.string().trim().min(1).optional(),
});

export async function GET(req: Request) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return unauthorized();

    try {
        const limit = Math.min(20, Math.max(1, Number(new URL(req.url).searchParams.get("limit")) || 6));
        const sessions = await prisma.practiceSession.findMany({
            where: { userId: session.user.id },
            orderBy: { startedAt: "desc" },
            take: limit,
            include: { items: { select: { record: { select: { isCorrect: true } } } } },
        });

        return NextResponse.json(sessions.map((practiceSession) => ({
            id: practiceSession.id,
            mode: practiceSession.mode,
            questionSource: practiceSession.questionSource,
            startedAt: practiceSession.startedAt.toISOString(),
            endedAt: practiceSession.endedAt?.toISOString() || null,
            itemCount: practiceSession.items.length,
            answeredCount: practiceSession.items.filter((item) => item.record?.isCorrect !== null && item.record?.isCorrect !== undefined).length,
            correctCount: practiceSession.items.filter((item) => item.record?.isCorrect).length,
        })));
    } catch (error) {
        logger.error({ error }, "Failed to list practice sessions");
        return internalError("Failed to load practice history");
    }
}

export async function POST(req: Request) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return unauthorized();

    try {
        const parsed = createSessionSchema.safeParse(await req.json());
        if (!parsed.success) return badRequest("Invalid practice settings", parsed.error.flatten());

        const { mode, questionSource, count, language, filters = {}, errorItemId } = parsed.data;
        if (mode === "daily") {
            const active = await prisma.practiceSession.findFirst({
                where: { userId: session.user.id, mode: "daily", endedAt: null },
                orderBy: { startedAt: "desc" },
                include: { items: { include: { record: true } } },
            });
            if (active) return NextResponse.json(serializePracticeSession(active));
        }
        const and: Prisma.ErrorItemWhereInput[] = [
            { questionText: { not: null } },
            { answerText: { not: null } },
            { NOT: { questionText: "" } },
            { NOT: { answerText: "" } },
        ];
        if (filters.tag) and.push({ tags: { some: { name: filters.tag } } });
        if (filters.chapter) {
            and.push({ tags: { some: { OR: [{ name: filters.chapter }, { parent: { name: filters.chapter } }] } } });
        }

        const where: Prisma.ErrorItemWhereInput = {
            userId: session.user.id,
            ...(mode === "daily" ? {} : { correctedAt: { not: null } }),
            ...(errorItemId ? { id: errorItemId } : {}),
            ...(filters.subjectId ? { subjectId: filters.subjectId } : {}),
            ...(filters.gradeSemester ? { gradeSemester: { contains: filters.gradeSemester } } : {}),
            AND: and,
        };
        if (mode === "unmastered") where.masteryLevel = { lt: 2 };
        if (filters.mastery === "new") where.masteryLevel = 0;
        if (filters.mastery === "reviewing") where.masteryLevel = 1;
        if (filters.mastery === "mastered") where.masteryLevel = 2;
        if (filters.timeRange && filters.timeRange !== "all") {
            const since = new Date();
            since.setDate(since.getDate() - (filters.timeRange === "week" ? 7 : 30));
            where.createdAt = { gte: since };
        }

        // ponytail: this loads matching question metadata; use database sampling if collections become large.
        const candidates = await prisma.errorItem.findMany({
            where,
            select: {
                id: true,
                createdAt: true,
                correctedAt: true,
                questionText: true,
                answerText: true,
                gradeSemester: true,
                tags: { select: { name: true } },
                subject: { select: { name: true } },
                practiceRecords: {
                    where: { isCorrect: { not: null } },
                    select: {
                        createdAt: true,
                        isCorrect: true,
                        sessionItem: { select: { purpose: true } },
                    },
                },
            },
        });
        const reviewRecords = (item: (typeof candidates)[number]) => getReviewRecords(item.practiceRecords);
        const reviewCandidates = candidates.filter((item) => item.correctedAt !== null);
        const selected = mode === "daily"
            ? [
                ...candidates
                    .filter((item) => item.correctedAt === null)
                    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
                    .slice(0, Math.min(5, count))
                    .map((item) => ({ item, purpose: "correction" as const })),
                ...reviewCandidates
                    .filter((item) => isReviewDue(item.correctedAt!, reviewRecords(item)))
                    .sort((a, b) => getNextReviewDate(a.correctedAt!, reviewRecords(a)).getTime()
                        - getNextReviewDate(b.correctedAt!, reviewRecords(b)).getTime())
                    .slice(0, Math.max(0, Math.min(5, count) - candidates.filter((item) => item.correctedAt === null).length))
                    .map((item) => ({ item, purpose: "review" as const })),
            ]
            : (mode === "ebbinghaus"
                ? reviewCandidates
                    .filter((item) => isReviewDue(item.correctedAt!, reviewRecords(item)))
                    .sort((a, b) => getNextReviewDate(a.correctedAt!, reviewRecords(a)).getTime()
                        - getNextReviewDate(b.correctedAt!, reviewRecords(b)).getTime())
                    .slice(0, errorItemId ? 1 : count)
                : pickRandom(reviewCandidates, errorItemId ? 1 : count))
                .map((item) => ({ item, purpose: "review" as const }));
        if (!selected.length) {
            return mode === "ebbinghaus"
                ? badRequest(language === "zh" ? "当前没有到期的复习题" : "No review questions are due", { reason: "NO_DUE_REVIEWS" })
                : badRequest(
                    mode === "daily"
                        ? (language === "zh" ? "今天没有待完成的题目" : "No tasks are due today")
                        : (language === "zh" ? "没有符合条件的题目" : "No questions match these settings"),
                    mode === "daily" ? { reason: "NO_DAILY_TASKS" } : undefined,
                );
        }

        let aiService: ReturnType<typeof getAIService> | null = null;
        if (questionSource === "variant") {
            try {
                aiService = getAIService();
            } catch (error) {
                logger.warn({ error }, "Variant service unavailable; using original questions");
            }
        }
        const createItem = async ({ item, purpose }: (typeof selected)[number], position: number) => {
            const knowledgePoints = item.tags.map((tag) => tag.name);
            const base = {
                errorItemId: item.id,
                position,
                subjectName: item.subject?.name,
                gradeSemester: item.gradeSemester,
                knowledgePoints: JSON.stringify(knowledgePoints),
                sourceQuestionText: item.questionText!,
                sourceAnswerText: item.answerText!,
                questionText: item.questionText!,
                answerText: item.answerText!,
                generationMode: "original",
                purpose,
            };

            if (questionSource === "original" || purpose === "correction") return base;
            if (!aiService) return { ...base, generationMode: "fallback" };
            try {
                const variant = await aiService.generateSimilarQuestion(
                    item.questionText!,
                    knowledgePoints,
                    language,
                    "medium",
                    item.gradeSemester,
                );
                if (!variant.questionText || !variant.answerText) return { ...base, generationMode: "fallback" };
                return {
                    ...base,
                    questionText: variant.questionText,
                    answerText: variant.answerText,
                    generationMode: "variant",
                };
            } catch (error) {
                logger.warn({ error, errorItemId: item.id }, "Variant generation failed; using original");
                return { ...base, generationMode: "fallback" };
            }
        };
        const items: Awaited<ReturnType<typeof createItem>>[] = [];
        for (let index = 0; index < selected.length; index += 3) {
            const batch = selected.slice(index, index + 3);
            items.push(...await Promise.all(batch.map((item, offset) => createItem(item, index + offset))));
        }

        const practiceSession = await prisma.practiceSession.create({
            data: {
                userId: session.user.id,
                mode,
                questionSource,
                language,
                items: { create: items },
            },
            include: { items: { include: { record: true } } },
        });

        return NextResponse.json(serializePracticeSession(practiceSession), { status: 201 });
    } catch (error) {
        logger.error({ error }, "Failed to create practice session");
        return internalError("Failed to create practice session");
    }
}
