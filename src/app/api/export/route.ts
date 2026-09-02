import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { unauthorized, internalError, forbidden } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";

const logger = createLogger('api:export');

export async function GET(req: Request) {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
        return unauthorized("Not authenticated");
    }

    const user = await prisma.user.findUnique({
        where: { id: session.user.id },
    });

    if (!user) {
        return unauthorized("User not found");
    }

    const { searchParams } = new URL(req.url);
    const exportAll = searchParams.get('all') === 'true';

    // 只有管理员可以导出全部数据
    if (exportAll && session.user.role !== 'admin') {
        return forbidden("Admin role required");
    }

    try {
        const userFilter = exportAll ? {} : { userId: user.id };

        const [users, subjects, customTags, errorItems, practiceSessions, practiceRecords] = await Promise.all([
            exportAll ? prisma.user.findMany() : Promise.resolve([user]),
            prisma.subject.findMany({ where: userFilter }),
            prisma.knowledgeTag.findMany({
                where: { ...userFilter, isSystem: false },
                include: { parent: true },
            }),
            prisma.errorItem.findMany({ where: userFilter, include: { tags: true } }),
            prisma.practiceSession.findMany({ where: userFilter }),
            prisma.practiceRecord.findMany({ where: userFilter }),
        ]);
        const practiceSessionItems = await prisma.practiceSessionItem.findMany({
            where: exportAll ? {} : { session: { userId: user.id } },
        });

        const exportData = {
            version: 5,
            exportedAt: new Date().toISOString(),
            scope: exportAll ? 'all' : 'user',
            users,
            subjects,
            customTags,
            errorItems,
            practiceSessions,
            practiceSessionItems,
            practiceRecords,
        };

        logger.info({
            userId: user.id,
            scope: exportAll ? 'all' : 'user',
            usersCount: users.length,
            subjectsCount: subjects.length,
            customTagsCount: customTags.length,
            errorItemsCount: errorItems.length,
            practiceSessionsCount: practiceSessions.length,
            practiceRecordsCount: practiceRecords.length,
        }, 'Data export completed');

        const jsonString = JSON.stringify(exportData, null, 2);
        const filename = exportAll
            ? `wrong-notebook-export-all-${new Date().toISOString().slice(0, 10)}.json`
            : `wrong-notebook-export-${new Date().toISOString().slice(0, 10)}.json`;

        return new NextResponse(jsonString, {
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Disposition': `attachment; filename="${filename}"`,
                'Cache-Control': 'no-store',
            },
        });
    } catch (error) {
        logger.error({ error, userId: user.id }, 'Export failed');
        return internalError("Failed to export data");
    }
}
