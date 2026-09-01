import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { unauthorized, forbidden, notFound, internalError, badRequest } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { findParentTagIdForGrade } from "@/lib/tag-recognition";
import { normalizeMistakeStatusForSave } from "@/lib/mistake-status";
import { inferSubjectFromName } from "@/lib/knowledge-tags";

const logger = createLogger('api:error-items:id');

export async function GET(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const session = await getServerSession(authOptions);

    try {
        let user;
        if (session?.user?.email) {
            user = await prisma.user.findUnique({
                where: { email: session.user.email },
            });
        }

        if (!user) {
            return unauthorized("Authentication required");
        }

        const errorItem = await prisma.errorItem.findUnique({
            where: {
                id: id,
            },
            include: {
                subject: true,
                tags: true, // 包含标签关联
            },
        });

        if (!errorItem) {
            return notFound("Item not found");
        }

        // Ensure the user owns this item
        if (errorItem.userId !== user.id) {
            return forbidden("Not authorized to access this item");
        }

        return NextResponse.json(errorItem);
    } catch (error) {
        logger.error({ error }, 'Error fetching item');
        return internalError("Failed to fetch error item");
    }
}

export async function PUT(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const session = await getServerSession(authOptions);

    try {
        let user;
        if (session?.user?.email) {
            user = await prisma.user.findUnique({
                where: { email: session.user.email },
            });
        }

        if (!user) {
            return unauthorized("Authentication required");
        }

        const body = await req.json();
        const { knowledgePoints, gradeSemester, paperLevel, questionText, answerText, analysis, subjectId,  wrongAnswerText, mistakeAnalysis, mistakeStatus, geogebraCommands } = body;

        const errorItem = await prisma.errorItem.findFirst({
            where: { id, userId: user.id },
            include: { subject: true },
        });

        if (!errorItem) {
            return notFound("Item not found");
        }

        // 构建更新数据
        const updateData: Prisma.ErrorItemUpdateInput = {};
        for (const value of [questionText, answerText, analysis, wrongAnswerText, mistakeAnalysis, geogebraCommands]) {
            if (value !== undefined && value !== null && (typeof value !== 'string' || value.length > 50_000)) {
                return badRequest('Invalid text field');
            }
        }
        for (const value of [gradeSemester, paperLevel]) {
            if (value !== undefined && value !== null && (typeof value !== 'string' || value.length > 200)) {
                return badRequest('Invalid metadata field');
            }
        }
        if (gradeSemester !== undefined) updateData.gradeSemester = gradeSemester;
        if (paperLevel !== undefined) updateData.paperLevel = paperLevel;
        if (questionText !== undefined) updateData.questionText = questionText;
        if (answerText !== undefined) updateData.answerText = answerText;
        if (analysis !== undefined) updateData.analysis = analysis;
        if (wrongAnswerText !== undefined) updateData.wrongAnswerText = wrongAnswerText || null;
        if (mistakeAnalysis !== undefined) updateData.mistakeAnalysis = mistakeAnalysis || null;
        let tagSubject = errorItem.subject;
        if (subjectId !== undefined) {
            if (subjectId === "") {
                tagSubject = null;
                updateData.subject = { disconnect: true };
            } else {
                const targetSubject = await prisma.subject.findFirst({ where: { id: subjectId, userId: user.id } });
                if (!targetSubject) return forbidden("Not authorized to move to this notebook");
                tagSubject = targetSubject;
                updateData.subject = { connect: { id: subjectId } };
            }
        }
        if (mistakeStatus !== undefined || wrongAnswerText !== undefined || mistakeAnalysis !== undefined) {
            const nextWrongAnswerText = wrongAnswerText !== undefined ? wrongAnswerText : errorItem.wrongAnswerText;
            updateData.mistakeStatus = normalizeMistakeStatusForSave(
                mistakeStatus,
                nextWrongAnswerText
            );
        }
        if (geogebraCommands !== undefined) updateData.geogebraCommands = geogebraCommands || null;

        // 处理 knowledgePoints (标签)
        if (knowledgePoints !== undefined) {
            let tagNames: unknown = knowledgePoints;
            if (typeof knowledgePoints === 'string') {
                try {
                    tagNames = JSON.parse(knowledgePoints);
                } catch {
                    return badRequest('Invalid knowledge points');
                }
            }
            if (!Array.isArray(tagNames) || tagNames.length > 20 || tagNames.some(name => typeof name !== 'string' || name.length > 100)) {
                return badRequest('Invalid knowledge points');
            }

            // 推断学科
            const subjectKey = inferSubjectFromName(tagSubject?.name ?? null) || 'other';
            const contextGrade = gradeSemester !== undefined ? gradeSemester : errorItem.gradeSemester;
            const parentId = await findParentTagIdForGrade(contextGrade, subjectKey);

            const tagConnections: { id: string }[] = [];
            for (const tagName of tagNames) {
                let tag = await prisma.knowledgeTag.findFirst({
                    where: {
                        name: tagName,
                        subject: subjectKey,
                        parentId,
                        OR: [
                            { isSystem: true, userId: null },
                            { isSystem: false, userId: user.id },
                        ],
                    },
                });

                if (!tag) {
                    tag = await prisma.knowledgeTag.create({
                        data: {
                            name: tagName,
                            subject: subjectKey,
                            isSystem: false,
                            userId: user.id,
                            parentId,
                        },
                    });
                }
                tagConnections.push({ id: tag.id });
            }

            // 更新标签关联: 先断开所有，再连接新的
            updateData.tags = {
                set: [], // 先清空
                connect: tagConnections,
            };

        }

        logger.info({ id }, 'Updating error item');

        const updated = await prisma.errorItem.update({
            where: { id, userId: user.id },
            data: updateData,
            include: { tags: true },
        });

        return NextResponse.json(updated);
    } catch (error) {
        logger.error({ error }, 'Error updating item');
        return internalError("Failed to update error item");
    }
}
