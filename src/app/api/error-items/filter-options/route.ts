import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { badRequest, internalError, unauthorized } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

const logger = createLogger("api:error-items:filter-options");

export async function GET(req: Request) {
    const session = await getServerSession(authOptions);
    const subjectId = new URL(req.url).searchParams.get("subjectId")?.trim();

    try {
        if (!session?.user?.id) return unauthorized("Authentication required");
        if (!subjectId) return badRequest("subjectId is required");

        const [gradeRows, tagRows] = await Promise.all([
            prisma.errorItem.findMany({
                where: { userId: session.user.id, subjectId },
                select: { gradeSemester: true },
                distinct: ["gradeSemester"],
            }),
            prisma.knowledgeTag.findMany({
                where: { errorItems: { some: { userId: session.user.id, subjectId } } },
                select: { name: true },
                distinct: ["name"],
            }),
        ]);

        const grades = new Set(gradeRows.map(({ gradeSemester }) => gradeSemester?.trim()).filter(Boolean) as string[]);
        const tags = new Set(tagRows.map(({ name }) => name.trim()).filter(Boolean));

        return NextResponse.json({
            grades: [...grades].sort((a, b) => a.localeCompare(b, "zh-CN")),
            tags: [...tags].sort((a, b) => a.localeCompare(b, "zh-CN")),
        });
    } catch (error) {
        logger.error({ error }, "Failed to fetch filter options");
        return internalError("Failed to fetch filter options");
    }
}
