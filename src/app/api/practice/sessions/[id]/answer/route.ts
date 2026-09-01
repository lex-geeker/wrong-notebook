import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { badRequest, conflict, internalError, notFound, unauthorized } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { judgePracticeAnswer, nextMasteryLevel } from "@/lib/practice";
import { prisma } from "@/lib/prisma";

const logger = createLogger("api:practice:sessions:answer");
const answerSchema = z.object({
    itemId: z.string().min(1),
    answerInput: z.string().trim().min(1).max(5000),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return unauthorized();

    try {
        const { id } = await params;
        const parsed = answerSchema.safeParse(await req.json());
        if (!parsed.success) return badRequest("Enter an answer", parsed.error.flatten());

        const result = await prisma.$transaction(async (tx) => {
            const item = await tx.practiceSessionItem.findFirst({
                where: { id: parsed.data.itemId, sessionId: id, session: { userId: session.user.id } },
                include: { record: true, errorItem: { select: { masteryLevel: true } } },
            });
            if (!item) return null;
            if (item.record) return "answered" as const;

            const answer = judgePracticeAnswer(parsed.data.answerInput, item.answerText);
            await tx.practiceRecord.create({
                data: {
                    userId: session.user.id,
                    sessionItemId: item.id,
                    errorItemId: item.errorItemId,
                    subject: item.subjectName,
                    isCorrect: answer.isCorrect,
                    answerInput: parsed.data.answerInput,
                },
            });

            let masteryLevel: number | null = null;
            if (item.errorItemId && item.errorItem) {
                masteryLevel = nextMasteryLevel(item.errorItem.masteryLevel, answer.isCorrect);
                await tx.errorItem.update({ where: { id: item.errorItemId }, data: { masteryLevel } });
            }

            const unanswered = await tx.practiceSessionItem.count({
                where: { sessionId: id, record: null },
            });
            const endedAt = unanswered === 0 ? new Date() : null;
            if (endedAt) await tx.practiceSession.update({ where: { id }, data: { endedAt } });

            return {
                answer: {
                    answerInput: parsed.data.answerInput,
                    expectedAnswer: item.answerText,
                    ...answer,
                },
                masteryLevel,
                endedAt: endedAt?.toISOString() || null,
            };
        });

        if (!result) return notFound("Practice question not found");
        if (result === "answered") return conflict("This question was already answered");
        return NextResponse.json(result);
    } catch (error) {
        logger.error({ error }, "Failed to save practice answer");
        return internalError("Failed to save answer");
    }
}
