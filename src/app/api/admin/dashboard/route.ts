import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth-utils"
import { forbidden, internalError } from "@/lib/api-errors"
import { createLogger } from "@/lib/logger"

const logger = createLogger('api:admin:dashboard')

export async function GET() {
    const session = await getServerSession(authOptions)

    if (!requireAdmin(session)) {
        return forbidden("Admin access required")
    }

    try {
        const now = new Date()
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        const [
            totalUsers,
            totalErrorItems,
            totalPracticeRecords,
            totalSubjects,
            userStats,
            subjectDistribution,
            recentErrorItems,
            masteryStats,
        ] = await Promise.all([
            prisma.user.count(),
            prisma.errorItem.count(),
            prisma.practiceRecord.count(),
            prisma.subject.count(),
            prisma.user.findMany({
            orderBy: {
                createdAt: 'desc'
            },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                isActive: true,
                createdAt: true,
                educationStage: true,
                enrollmentYear: true,
                _count: {
                    select: {
                        errorItems: true,
                        practiceRecords: true,
                        subjects: true,
                    }
                }
            }
            }),
            prisma.subject.findMany({
            select: {
                name: true,
                _count: {
                    select: {
                        errorItems: true
                    }
                }
            },
            orderBy: {
                errorItems: {
                    _count: 'desc'
                }
            }
            }),
            prisma.errorItem.findMany({
            where: {
                createdAt: {
                    gte: sevenDaysAgo
                }
            },
                select: { createdAt: true },
            }),
            prisma.errorItem.groupBy({
                by: ['masteryLevel'],
                _count: { id: true },
            }),
        ])

        // 按日期聚合最近 7 天数据
        const dailyTrend: { date: string; count: number }[] = []
        for (let i = 6; i >= 0; i--) {
            const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000)
            const dateStr = d.toISOString().split('T')[0]
            dailyTrend.push({ date: dateStr, count: 0 })
        }
        for (const item of recentErrorItems) {
            const dateStr = new Date(item.createdAt).toISOString().split('T')[0]
            const found = dailyTrend.find(d => d.date === dateStr)
            if (found) {
                found.count++
            }
        }

        const masteryDistribution = {
            new: masteryStats.find(m => m.masteryLevel === 0)?._count.id || 0,
            reviewing: masteryStats.find(m => m.masteryLevel === 1)?._count.id || 0,
            mastered: masteryStats.find(m => m.masteryLevel === 2)?._count.id || 0,
        }

        return NextResponse.json({
            overview: {
                totalUsers,
                totalErrorItems,
                totalPracticeRecords,
                totalSubjects,
            },
            userStats: userStats.map(u => ({
                id: u.id,
                name: u.name,
                email: u.email,
                role: u.role,
                isActive: u.isActive,
                createdAt: u.createdAt,
                educationStage: u.educationStage,
                enrollmentYear: u.enrollmentYear,
                errorCount: u._count.errorItems,
                practiceCount: u._count.practiceRecords,
                notebookCount: u._count.subjects,
            })),
            subjectDistribution: subjectDistribution.map(s => ({
                name: s.name,
                count: s._count.errorItems,
            })),
            dailyTrend,
            masteryDistribution,
        })
    } catch (error) {
        logger.error({ error }, 'Error fetching dashboard data');
        return internalError("Failed to fetch dashboard data")
    }
}
