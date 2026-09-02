import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { unauthorized, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";

const logger = createLogger('api:stats:practice');

export async function GET(request: Request) {
    void request;
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
        return unauthorized();
    }

    const userId = session.user.id;

    try {
        const [subjectStats, totalRecords, correctRecords] = await Promise.all([
            prisma.practiceRecord.groupBy({ by: ['subject'], where: { userId }, _count: { id: true } }),
            prisma.practiceRecord.count({ where: { userId } }),
            prisma.practiceRecord.count({ where: { userId, isCorrect: true } }),
        ]);

        return NextResponse.json({
            subjectStats: subjectStats.map(s => ({ name: s.subject || 'Unknown', value: s._count.id })),
            overallStats: {
                total: totalRecords,
                correct: correctRecords,
                rate: totalRecords > 0 ? (correctRecords / totalRecords * 100).toFixed(1) : 0
            }
        });

    } catch (error) {
        logger.error({ error }, 'Error fetching practice stats');
        return internalError("Failed to fetch stats");
    }
}
