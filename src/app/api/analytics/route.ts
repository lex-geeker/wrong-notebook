import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { format, subDays } from "date-fns";
import { unauthorized, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";

const logger = createLogger('api:analytics');

export async function GET(request: Request) {
    void request;
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
        return unauthorized();
    }

    const userId = session.user.id;

    try {
        const [totalErrors, masteredCount, errorItemsWithSubject] = await Promise.all([
            prisma.errorItem.count({ where: { userId } }),
            prisma.errorItem.count({ where: { userId, masteryLevel: 2 } }),
            prisma.errorItem.findMany({
                where: { userId },
                select: { createdAt: true, subject: { select: { name: true } } },
            }),
        ]);

        // 3. Mastery Rate
        const masteryRate = totalErrors > 0 ? ((masteredCount / totalErrors) * 100).toFixed(1) : 0;

        const subjectMap = new Map<string, number>();
        errorItemsWithSubject.forEach(item => {
            const subjectName = item.subject?.name || 'Unknown';
            subjectMap.set(subjectName, (subjectMap.get(subjectName) || 0) + 1);
        });

        const subjectStats = Array.from(subjectMap.entries()).map(([name, value]) => ({
            name,
            value
        }));

        const activityCounts = new Map<string, number>();
        for (const item of errorItemsWithSubject) {
            if (!item.createdAt) continue;
            const key = format(item.createdAt, 'yyyy-MM-dd');
            activityCounts.set(key, (activityCounts.get(key) || 0) + 1);
        }
        const activityData = [];
        for (let i = 6; i >= 0; i--) {
            const targetDate = subDays(new Date(), i);
            activityData.push({
                date: format(targetDate, 'MM-dd'),
                count: activityCounts.get(format(targetDate, 'yyyy-MM-dd')) || 0,
            });
        }

        return NextResponse.json({
            totalErrors,
            masteredCount,
            masteryRate,
            subjectStats,
            activityData
        });

    } catch (error) {
        logger.error({ error }, 'Error fetching analytics');
        return internalError("Failed to fetch analytics");
    }
}
