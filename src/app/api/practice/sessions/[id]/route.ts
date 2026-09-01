import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { badRequest, conflict, internalError, notFound, unauthorized } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { nextMasteryLevel, serializePracticeSession } from "@/lib/practice";
import { prisma } from "@/lib/prisma";

const logger = createLogger("api:practice:sessions:item");
const paperResultsSchema = z.object({
    paperResults: z.array(z.object({
        itemId: z.string().min(1),
        isCorrect: z.boolean(),
    })).min(1).max(20),
});

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return unauthorized();

    try {
        const { id } = await params;
        const practiceSession = await prisma.practiceSession.findFirst({
            where: { id, userId: session.user.id },
            include: { items: { include: { record: true } } },
        });
        if (!practiceSession) return notFound("Practice session not found");
        const includeAnswers = new URL(req.url).searchParams.get("includeAnswers") === "1";
        return NextResponse.json(serializePracticeSession(practiceSession, includeAnswers));
    } catch (error) {
        logger.error({ error }, "Failed to load practice session");
        return internalError("Failed to load practice session");
    }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return unauthorized();
    const userId = session.user.id;

    try {
        const { id } = await params;
        const parsed = paperResultsSchema.safeParse(await req.json());
        if (!parsed.success) return badRequest("Mark every paper answer", parsed.error.flatten());

        const resultById = new Map(parsed.data.paperResults.map((result) => [result.itemId, result.isCorrect]));
        if (resultById.size !== parsed.data.paperResults.length) return badRequest("Duplicate practice question");

        const result = await prisma.$transaction(async (tx) => {
            const practiceSession = await tx.practiceSession.findFirst({
                where: { id, userId },
                include: {
                    items: {
                        include: { record: true, errorItem: { select: { masteryLevel: true } } },
                    },
                },
            });
            if (!practiceSession) return "notFound" as const;
            if (practiceSession.endedAt || practiceSession.items.some((item) => item.record)) return "finished" as const;
            if (practiceSession.items.length !== resultById.size
                || practiceSession.items.some((item) => !resultById.has(item.id))) return "incomplete" as const;

            for (const item of practiceSession.items) {
                const isCorrect = resultById.get(item.id)!;
                await tx.practiceRecord.create({
                    data: {
                        userId,
                        sessionItemId: item.id,
                        errorItemId: item.errorItemId,
                        subject: item.subjectName,
                        isCorrect,
                        answerInput: null,
                    },
                });
                if (item.errorItemId && item.errorItem) {
                    await tx.errorItem.update({
                        where: { id: item.errorItemId, userId },
                        data: { masteryLevel: nextMasteryLevel(item.errorItem.masteryLevel, isCorrect) },
                    });
                }
            }

            await tx.practiceSession.update({ where: { id }, data: { endedAt: new Date() } });
            return tx.practiceSession.findFirst({
                where: { id, userId },
                include: { items: { include: { record: true } } },
            });
        });

        if (result === "notFound" || !result) return notFound("Practice session not found");
        if (result === "finished") return conflict("This practice session is already finished");
        if (result === "incomplete") return badRequest("Mark every paper answer exactly once");
        return NextResponse.json(serializePracticeSession(result));
    } catch (error) {
        logger.error({ error }, "Failed to save paper practice results");
        return internalError("Failed to save paper practice results");
    }
}
