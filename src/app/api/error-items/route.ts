import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { calculateGrade } from "@/lib/grade-calculator";
import { badRequest, unauthorized, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { findParentTagIdForGrade } from "@/lib/tag-recognition";
import { inferSubjectFromName } from "@/lib/knowledge-tags";
import { normalizeMistakeStatusForSave } from "@/lib/mistake-status";
import { parseOptionalImagePayload } from "@/lib/image-payload";
import { ERROR_SOURCES, ERROR_TYPES } from "@/lib/error-metadata";

const logger = createLogger('api:error-items');

export async function POST(req: Request) {
    logger.info('POST /api/error-items called');

    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return unauthorized("Authentication required");

    try {
        const user = await prisma.user.findUnique({ where: { id: session.user.id } });
        if (!user) return unauthorized("No user found in DB");

        const body = await req.json();
        const {
            questionText,
            answerText,
            analysis,
            wrongAnswerText,
            mistakeAnalysis,
            mistakeStatus,
            knowledgePoints,
            originalImageUrl,
            subjectId,
            gradeSemester,
            paperLevel,
            geogebraCommands,
            source = "homework",
            errorType,
        } = body;

        if (!ERROR_SOURCES.includes(source)) return badRequest('Invalid source');
        if (errorType != null && !ERROR_TYPES.includes(errorType)) return badRequest('Invalid error type');

        for (const value of [questionText, answerText, analysis, wrongAnswerText, mistakeAnalysis, geogebraCommands]) {
            if (value !== undefined && value !== null && (typeof value !== 'string' || value.length > 50_000)) {
                return badRequest('Invalid text field');
            }
        }
        let validatedImageUrl = '';
        try {
            validatedImageUrl = parseOptionalImagePayload(originalImageUrl)?.dataUrl || '';
        } catch (error) {
            return badRequest(error instanceof Error ? error.message : 'Invalid image');
        }

        // 记录请求参数（不记录完整图片数据）
        logger.debug({
            hasQuestionText: !!questionText,
            questionTextLength: questionText?.length || 0,
            hasAnswerText: !!answerText,
            hasAnalysis: !!analysis,
            hasWrongAnswerText: !!wrongAnswerText,
            hasMistakeAnalysis: !!mistakeAnalysis,
            mistakeStatus,
            knowledgePointsCount: Array.isArray(knowledgePoints) ? knowledgePoints.length : 0,
            hasImage: !!originalImageUrl,
            imageSize: originalImageUrl?.length || 0,
            subjectId,
            gradeSemester,
            paperLevel,
            hasGeogebraCommands: !!geogebraCommands,
        }, 'Request parameters received');

        // 查找用户
        // ========== 去重检查：2秒内同一用户提交相同题目视为重复 ==========
        const DEDUP_WINDOW_MS = 2000; // 2秒去重窗口
        const questionTextPrefix = questionText?.substring(0, 100) || ''; // 取前100字符比较

        if (questionTextPrefix) {
            const recentDuplicate = await prisma.errorItem.findFirst({
                where: {
                    userId: user.id,
                    questionText: {
                        startsWith: questionTextPrefix,
                    },
                    createdAt: {
                        gte: new Date(Date.now() - DEDUP_WINDOW_MS),
                    },
                },
                include: {
                    tags: true,
                },
            });

            if (recentDuplicate) {
                logger.info({
                    existingId: recentDuplicate.id,
                    userId: user.id,
                    timeDiff: Date.now() - recentDuplicate.createdAt.getTime()
                }, 'Duplicate submission detected within dedup window, returning existing record');

                return NextResponse.json({
                    ...recentDuplicate,
                    duplicate: true, // 标记为重复提交
                }, { status: 200 }); // 返回 200 而非 201
            }
        }

        // 计算年级
        let finalGradeSemester = gradeSemester;
        if (!finalGradeSemester && user.educationStage && user.enrollmentYear) {
            finalGradeSemester = calculateGrade(user.educationStage, user.enrollmentYear);
            logger.debug({ finalGradeSemester, educationStage: user.educationStage, enrollmentYear: user.enrollmentYear }, 'Grade calculated');
        }

        // 处理知识点标签
        const rawTagNames = knowledgePoints ?? [];
        if (!Array.isArray(rawTagNames) || rawTagNames.length > 20 || rawTagNames.some(name => typeof name !== 'string' || name.length > 100)) {
            return badRequest('Invalid knowledge points');
        }
        const tagNames: string[] = rawTagNames;
        const tagConnections: { id: string }[] = [];

        // 推断学科
        const subject = subjectId
            ? await prisma.subject.findFirst({ where: { id: subjectId, userId: user.id } })
            : null;
        if (subjectId && !subject) return badRequest("Invalid subject");
        const subjectKey = inferSubjectFromName(subject?.name ?? null) || 'other';
        logger.debug({ subjectId, subjectName: subject?.name, subjectKey }, 'Subject inferred');

        // 处理每个标签
        for (const tagName of tagNames) {
            try {
                const parentId = await findParentTagIdForGrade(finalGradeSemester, subjectKey);
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
                    logger.debug({ tagName, parentId, subjectKey }, 'Creating new custom tag');

                    tag = await prisma.knowledgeTag.create({
                        data: {
                            name: tagName,
                            subject: subjectKey,
                            isSystem: false,
                            userId: user.id,
                            parentId: parentId,
                        },
                    });
                    logger.debug({ tagId: tag.id, tagName }, 'Custom tag created');
                } else {
                    logger.debug({ tagId: tag.id, tagName, isSystem: tag.isSystem }, 'Existing tag found');
                }

                tagConnections.push({ id: tag.id });
            } catch (tagError) {
                logger.error({ tagName, error: tagError }, 'Error processing tag');
                throw tagError;
            }
        }

        logger.info({ tagNames, tagConnectionsCount: tagConnections.length }, 'Creating ErrorItem with tags');

        // 创建错题记录
        try {
            const errorItem = await prisma.errorItem.create({
                data: {
                    userId: user.id,
                    subjectId: subjectId || undefined,
                    originalImageUrl: validatedImageUrl,
                    questionText,
                    answerText,
                    analysis,
                    wrongAnswerText: wrongAnswerText || null,
                    mistakeAnalysis: mistakeAnalysis || null,
                    mistakeStatus: normalizeMistakeStatusForSave(mistakeStatus, wrongAnswerText),
                    gradeSemester: finalGradeSemester,
                    paperLevel: paperLevel,
                    geogebraCommands: geogebraCommands || null,
                    source,
                    errorType: errorType || null,
                    masteryLevel: 0,
                    tags: {
                        connect: tagConnections,
                    },
                },
                include: {
                    tags: true,
                },
            });

            logger.info({ errorItemId: errorItem.id, tagsCount: errorItem.tags?.length || 0 }, 'ErrorItem created successfully');
            return NextResponse.json(errorItem, { status: 201 });
        } catch (dbError) {
            logger.error({
                error: dbError,
                userId: user.id,
                subjectId,
                tagConnectionsCount: tagConnections.length
            }, 'Database error creating ErrorItem');
            throw dbError;
        }
    } catch (error) {
        logger.error({
            error,
            errorMessage: error instanceof Error ? error.message : String(error),
            errorStack: error instanceof Error ? error.stack : undefined
        }, 'Error saving item');
        return internalError("Failed to save error item");
    }
}
