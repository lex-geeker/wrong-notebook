import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { internalError, notFound, unauthorized } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { serializePracticeSession } from "@/lib/practice";
import { prisma } from "@/lib/prisma";

const logger = createLogger("api:practice:sessions:item");

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return unauthorized();

    try {
        const { id } = await params;
        const practiceSession = await prisma.practiceSession.findFirst({
            where: { id, userId: session.user.id },
            include: { items: { include: { record: true } } },
        });
        if (!practiceSession) return notFound("Practice session not found");
        return NextResponse.json(serializePracticeSession(practiceSession));
    } catch (error) {
        logger.error({ error }, "Failed to load practice session");
        return internalError("Failed to load practice session");
    }
}
