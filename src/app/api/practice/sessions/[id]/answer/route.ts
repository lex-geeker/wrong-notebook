import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { badRequest, conflict, internalError, notFound, unauthorized } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { judgePracticeAnswer, nextMasteryLevel } from "@/lib/practice";
import { prisma } from "@/lib/prisma";

const logger = createLogger("api:practice:sessions:answer");
const answerSchema = z.discriminatedUnion("action", [
    z.object({
        action: z.literal("submit"),
        itemId: z.string().min(1),
        answerInput: z.string().trim().min(1).max(5000),
    }),
    z.object({
        action: z.literal("assess"),
        itemId: z.string().min(1),
        isCorrect: z.boolean(),
    }),
]);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return unauthorized();
    const userId = session.user.id;

    try {
        const { id } = await params;
        const parsed = answerSchema.safeParse(await req.json());
        if (!parsed.success) return badRequest("Enter an answer", parsed.error.flatten());

        const result = await prisma.$transaction(async (tx) => {
            const item = await tx.practiceSessionItem.findFirst({
                where: { id: parsed.data.itemId, sessionId: id, session: { userId } },
                include: { record: true, errorItem: { select: { masteryLevel: true } } },
            });
            if (!item) return null;
            let answerInput: string;
            let isCorrect: boolean;
            let matchType: "exact" | "choice" | "self_assessment";

            if (parsed.data.action === "submit") {
                if (item.record) return "answered" as const;
                const answer = judgePracticeAnswer(parsed.data.answerInput, item.answerText);
                await tx.practiceRecord.create({
                    data: {
                        userId,
                        sessionItemId: item.id,
                        errorItemId: item.errorItemId,
                        subject: item.subjectName,
                        isCorrect: answer.isCorrect,
                        answerInput: parsed.data.answerInput,
                    },
                });
                if (answer.isCorrect === null) {
                    return {
                        status: "needs_self_assessment" as const,
                        answer: {
                            answerInput: parsed.data.answerInput,
                            expectedAnswer: item.answerText,
                            isCorrect: null,
                            matchType: answer.matchType,
                        },
                        masteryLevel: null,
                        endedAt: null,
                    };
                }
                answerInput = parsed.data.answerInput;
                isCorrect = answer.isCorrect;
                matchType = answer.matchType;
            } else {
                if (!item.record) return "unsubmitted" as const;
                if (item.record.isCorrect !== null) return "answered" as const;
                await tx.practiceRecord.update({
                    where: { id: item.record.id },
                    data: { isCorrect: parsed.data.isCorrect },
                });
                answerInput = item.record.answerInput || "";
                isCorrect = parsed.data.isCorrect;
                matchType = "self_assessment";
            }

            let masteryLevel: number | null = null;
            if (item.errorItemId && item.errorItem) {
                masteryLevel = nextMasteryLevel(item.errorItem.masteryLevel, isCorrect);
                await tx.errorItem.update({ where: { id: item.errorItemId, userId }, data: { masteryLevel } });
            }

            const unanswered = await tx.practiceSessionItem.count({
                where: {
                    sessionId: id,
                    OR: [
                        { record: null },
                        { record: { is: { isCorrect: null } } },
                    ],
                },
            });
            const endedAt = unanswered === 0 ? new Date() : null;
            if (endedAt) await tx.practiceSession.update({ where: { id }, data: { endedAt } });

            return {
                status: "graded" as const,
                answer: {
                    answerInput,
                    expectedAnswer: item.answerText,
                    isCorrect,
                    matchType,
                },
                masteryLevel,
                endedAt: endedAt?.toISOString() || null,
            };
        });

        if (!result) return notFound("Practice question not found");
        if (result === "answered") return conflict("This question was already answered");
        if (result === "unsubmitted") return badRequest("Submit an answer before assessing it");
        return NextResponse.json(result);
    } catch (error) {
        logger.error({ error }, "Failed to save practice answer");
        return internalError("Failed to save answer");
    }
}
