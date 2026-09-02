import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { unauthorized, internalError } from "@/lib/api-errors";
import { chinaDateKey, chinaDayStart } from "@/lib/china-date";
import { createLogger } from "@/lib/logger";
import { isReviewDue, serializePracticeSession } from "@/lib/practice";
import { prisma } from "@/lib/prisma";

const logger = createLogger("api:learning-overview");

function topThree(values: Array<{ name: string; count: number }>) {
    return values.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 3);
}

export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return unauthorized();

    try {
        const userId = session.user.id;
        const now = new Date();
        const todayStart = chinaDayStart(now);
        const weekStart = chinaDayStart(new Date(), 6);
        const [items, activeSession, completedDailySessions] = await Promise.all([
            prisma.errorItem.findMany({
                where: {
                    userId,
                    questionText: { not: null },
                    answerText: { not: null },
                    NOT: [{ questionText: "" }, { answerText: "" }],
                },
                select: {
                    createdAt: true,
                    errorType: true,
                    tags: { select: { name: true } },
                    practiceRecords: {
                        where: { isCorrect: { not: null } },
                        select: {
                            createdAt: true,
                            isCorrect: true,
                        },
                    },
                },
            }),
            prisma.practiceSession.findFirst({
                where: {
                    userId,
                    mode: "daily",
                    endedAt: null,
                    startedAt: { gte: todayStart, lt: chinaDayStart(now, -1) },
                },
                orderBy: { startedAt: "desc" },
                include: { items: { include: { record: true } } },
            }),
            prisma.practiceSession.findMany({
                where: { userId, mode: "daily", endedAt: { gte: weekStart } },
                select: { endedAt: true },
            }),
        ]);

        const reviewRecords = items.flatMap((item) => item.practiceRecords);
        const recentReviews = reviewRecords.filter((record) => record.createdAt >= weekStart);
        const errorTypeCounts = new Map<string, number>();
        const tagCounts = new Map<string, number>();

        for (const item of items) {
            const recentWrongCount = item.practiceRecords.filter((record) => record.createdAt >= weekStart && record.isCorrect === false).length;
            if (!recentWrongCount) continue;
            if (item.errorType) errorTypeCounts.set(item.errorType, (errorTypeCounts.get(item.errorType) || 0) + recentWrongCount);
            for (const tag of item.tags) tagCounts.set(tag.name, (tagCounts.get(tag.name) || 0) + recentWrongCount);
        }

        return NextResponse.json({
            today: {
                dueReviewCount: items.filter((item) => isReviewDue(item.createdAt, item.practiceRecords, now)).length,
                unfinishedCount: activeSession
                    ? activeSession.items.filter((item) => !item.record || item.record.isCorrect === null).length
                    : 0,
            },
            activeSession: activeSession ? serializePracticeSession(activeSession) : null,
            week: {
                completionDays: [...new Set(completedDailySessions
                    .flatMap((practiceSession) => practiceSession.endedAt ? [chinaDateKey(practiceSession.endedAt)] : []))].sort(),
                reviewedCount: recentReviews.length,
                correctCount: recentReviews.filter((record) => record.isCorrect === true).length,
                accuracy: recentReviews.length
                    ? Math.round(recentReviews.filter((record) => record.isCorrect === true).length / recentReviews.length * 100)
                    : 0,
                wrongCount: recentReviews.filter((record) => record.isCorrect === false).length,
                topErrorTypes: topThree([...errorTypeCounts].map(([name, count]) => ({ name, count }))),
                weakTags: topThree([...tagCounts].map(([name, count]) => ({ name, count }))),
            },
        });
    } catch (error) {
        logger.error({ error }, "Failed to load learning overview");
        return internalError("Failed to load learning overview");
    }
}
