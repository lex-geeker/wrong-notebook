import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth-utils"
import { forbidden, notFound, internalError } from "@/lib/api-errors"
import { createLogger } from "@/lib/logger"

const logger = createLogger('api:admin:users:id:detail')

export async function GET(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const session = await getServerSession(authOptions)

    if (!requireAdmin(session)) {
        return forbidden("Admin access required")
    }

    try {
        // 获取用户基本信息
        const user = await prisma.user.findUnique({
            where: { id },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                isActive: true,
                createdAt: true,
                educationStage: true,
                enrollmentYear: true,
            }
        })

        if (!user) {
            return notFound("User not found")
        }

        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        const [notebooks, errorCount, practiceCount, recent7DaysCount, masteryStats, subjectErrorCounts, recentErrorItems] = await Promise.all([
            prisma.subject.findMany({
                where: { userId: id },
                select: {
                    id: true,
                    name: true,
                    _count: { select: { errorItems: true } }
                },
                orderBy: { createdAt: 'asc' }
            }),
            prisma.errorItem.count({ where: { userId: id } }),
            prisma.practiceRecord.count({ where: { userId: id } }),
            prisma.errorItem.count({
                where: { userId: id, createdAt: { gte: sevenDaysAgo } }
            }),
            prisma.errorItem.groupBy({
                by: ['masteryLevel'],
                where: { userId: id },
                _count: { id: true }
            }),
            prisma.errorItem.groupBy({
                by: ['subjectId'],
                where: { userId: id },
                _count: { id: true }
            }),
            prisma.errorItem.findMany({
                where: { userId: id },
                select: {
                    id: true,
                    questionText: true,
                    ocrText: true,
                    masteryLevel: true,
                    createdAt: true,
                    subject: { select: { name: true } }
                },
                orderBy: { createdAt: 'desc' },
                take: 20
            }),
        ])

        const notebookCount = notebooks.length
        const masteryDistribution = {
            new: masteryStats.find(m => m.masteryLevel === 0)?._count.id || 0,
            reviewing: masteryStats.find(m => m.masteryLevel === 1)?._count.id || 0,
            mastered: masteryStats.find(m => m.masteryLevel === 2)?._count.id || 0,
        }

        const subjectIds = subjectErrorCounts.map(s => s.subjectId).filter(Boolean) as string[]
        const subjectNames = await prisma.subject.findMany({
            where: { id: { in: subjectIds } },
            select: { id: true, name: true }
        })
        const subjectNameMap = new Map(subjectNames.map(s => [s.id, s.name]))
        const subjectDistribution = subjectErrorCounts
            .filter(s => s.subjectId)
            .map(s => ({
                name: subjectNameMap.get(s.subjectId!) || "未知",
                count: s._count.id
            }))

        return NextResponse.json({
            user,
            notebooks: notebooks.map(nb => ({
                id: nb.id,
                name: nb.name,
                errorCount: nb._count.errorItems,
            })),
            errorCount,
            practiceCount,
            notebookCount,
            recent7DaysCount,
            masteryDistribution,
            subjectDistribution,
            recentErrorItems: recentErrorItems.map(item => ({
                id: item.id,
                questionText: item.questionText,
                ocrText: item.ocrText,
                masteryLevel: item.masteryLevel,
                createdAt: item.createdAt,
                subject: item.subject,
            })),
        })
    } catch (error) {
        logger.error({ error, userId: id }, 'Error fetching user detail');
        return internalError("Failed to fetch user detail")
    }
}
