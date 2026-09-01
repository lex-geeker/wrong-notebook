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
        const user = session?.user?.email
            ? await prisma.user.findUnique({ where: { email: session.user.email } })
            : null;

        if (!user) return unauthorized("Authentication required");
        if (!subjectId) return badRequest("subjectId is required");

        const items = await prisma.errorItem.findMany({
            where: { userId: user.id, subjectId },
            select: {
                gradeSemester: true,
                tags: { select: { name: true } },
            },
        });

        const grades = new Set<string>();
        const tags = new Set<string>();

        for (const item of items) {
            if (item.gradeSemester?.trim()) grades.add(item.gradeSemester);

            item.tags.forEach(({ name }) => name.trim() && tags.add(name));
        }

        return NextResponse.json({
            grades: [...grades].sort((a, b) => a.localeCompare(b, "zh-CN")),
            tags: [...tags].sort((a, b) => a.localeCompare(b, "zh-CN")),
        });
    } catch (error) {
        logger.error({ error }, "Failed to fetch filter options");
        return internalError("Failed to fetch filter options");
    }
}
