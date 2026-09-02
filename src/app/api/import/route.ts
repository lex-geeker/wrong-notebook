import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { unauthorized, internalError, badRequest, forbidden } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { inferSubjectFromName } from "@/lib/knowledge-tags";

const logger = createLogger('api:import');

interface ImportData {
    version: number;
    exportedAt: string;
    scope?: string;
    user: {
        id: string;
        email: string;
        name: string | null;
        educationStage: string | null;
        enrollmentYear: number | null;
        role: string;
    };
    subjects: Array<{
        id: string;
        name: string;
        userId: string;
        createdAt: string;
        updatedAt: string;
    }>;
    customTags: Array<{
        id: string;
        name: string;
        subject: string;
        parentId: string | null;
        order: number;
        code: string | null;
        isSystem: boolean;
        userId: string;
        createdAt: string;
        updatedAt: string;
    }>;
    errorItems: Array<{
        id: string;
        userId: string;
        subjectId: string | null;
        originalImageUrl: string;
        ocrText: string | null;
        questionText: string | null;
        answerText: string | null;
        analysis: string | null;
        wrongAnswerText: string | null;
        mistakeAnalysis: string | null;
        mistakeStatus: string | null;
        knowledgePoints?: string | null;
        source: string | null;
        errorType: string | null;
        correctedAt: string | null;
        userNotes: string | null;
        masteryLevel: number;
        gradeSemester: string | null;
        paperLevel: string | null;
        createdAt: string;
        updatedAt: string;
        tags: Array<{
            id: string;
            name: string;
            subject: string;
            parentId?: string | null;
            userId?: string | null;
            isSystem?: boolean;
        }>;
    }>;
    reviewSchedules?: Array<{
        id: string;
        errorItemId: string;
        scheduledFor: string;
        completedAt: string | null;
        isCorrect: boolean | null;
        createdAt: string;
    }>;
    practiceRecords: Array<{
        id: string;
        userId: string;
        errorItemId?: string | null;
        subject: string | null;
        difficulty: string | null;
        isCorrect: boolean | null;
        answerInput?: string | null;
        createdAt: string;
    }>;
}

/** Validate and parse a date string, returning undefined if invalid */
function safeParseDate(dateStr: string | undefined | null): Date | undefined {
    if (!dateStr) return undefined;
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? undefined : d;
}

/** Validate masteryLevel is an integer in range [0, 2] */
function safeMasteryLevel(val: unknown): number {
    const n = typeof val === 'number' ? val : parseInt(String(val), 10);
    if (!Number.isInteger(n) || n < 0 || n > 2) return 0;
    return n;
}

function parseLegacyTagNames(value: string | null | undefined): string[] {
    if (!value) return [];
    try {
        const parsed: unknown = JSON.parse(value);
        return Array.isArray(parsed)
            ? parsed.filter((name): name is string => typeof name === 'string' && name.length <= 100).slice(0, 20)
            : [];
    } catch {
        return [];
    }
}

export async function POST(req: Request) {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id || !session.user.email) {
        return unauthorized("Not authenticated");
    }

    const user = { id: session.user.id, email: session.user.email };

    const { searchParams } = new URL(req.url);
    const importAll = searchParams.get('all') === 'true';

    // 只有管理员可以导入全部数据
    if (importAll && session.user.role !== 'admin') {
        return forbidden("Admin role required");
    }

    try {
        const contentLength = req.headers.get('content-length');
        if (contentLength && parseInt(contentLength, 10) > 50 * 1024 * 1024) {
            return badRequest("Request body too large (max 50MB)");
        }

        const body = await req.json() as ImportData;

        // 验证数据格式
        if (body.version < 3 || !body.user || !Array.isArray(body.errorItems)) {
            return badRequest("Invalid import data format");
        }

        // 非管理员模式：验证导出数据属于当前用户
        if (!importAll && body.user.email !== user.email) {
            return badRequest("Import data does not belong to current user");
        }

        const stats = {
            subjectsCreated: 0,
            tagsCreated: 0,
            errorItemsCreated: 0,
            reviewSchedulesIgnored: body.reviewSchedules?.length || 0,
            practiceRecordsCreated: 0,
            tagsLinked: 0,
        };

        // 使用事务确保数据一致性
        await prisma.$transaction(async (tx) => {
            // 1. 导入 subjects
            const subjectIdMap = new Map<string, string>();
            const subjectNameMap = new Map<string, string>();
            for (const subject of (body.subjects || [])) {
                subjectNameMap.set(subject.id, subject.name);
                const targetUserId = importAll ? subject.userId : user.id;
                const existing = await tx.subject.findFirst({
                    where: { name: subject.name, userId: targetUserId },
                });
                if (existing) {
                    subjectIdMap.set(subject.id, existing.id);
                } else {
                    const created = await tx.subject.create({
                        data: {
                            name: subject.name,
                            userId: targetUserId,
                        },
                    });
                    subjectIdMap.set(subject.id, created.id);
                    stats.subjectsCreated++;
                }
            }

            // 2. 导入 custom tags
            const tagIdMap = new Map<string, string>();
            for (const tag of (body.customTags || [])) {
                const targetUserId = importAll ? tag.userId : user.id;
                const newParentId = tag.parentId ? tagIdMap.get(tag.parentId) : undefined;
                const existing = await tx.knowledgeTag.findFirst({
                    where: {
                        name: tag.name,
                        subject: tag.subject,
                        userId: targetUserId,
                        parentId: newParentId || null,
                        isSystem: false,
                    },
                });
                if (existing) {
                    tagIdMap.set(tag.id, existing.id);
                } else {
                    const created = await tx.knowledgeTag.create({
                        data: {
                            name: tag.name,
                            subject: tag.subject,
                            isSystem: false,
                            userId: targetUserId,
                            parentId: newParentId,
                            order: tag.order || 0,
                            code: tag.code,
                        },
                    });
                    tagIdMap.set(tag.id, created.id);
                    stats.tagsCreated++;
                }
            }

            // 3. 预加载所有需要的 tags（批量查询，避免 N+1）
            const allTagNames = new Set<string>();
            for (const item of body.errorItems) {
                if (item.tags) {
                    for (const tag of item.tags) {
                        allTagNames.add(tag.name);
                    }
                }
            }
            // 批量查询：系统 tag + 所有用户的自定义 tag
            const preloadedTags = await tx.knowledgeTag.findMany({
                where: {
                    name: { in: Array.from(allTagNames) },
                    OR: [
                        { isSystem: true },
                        ...(importAll ? [] : [{ userId: user.id }]),
                    ],
                },
            });
            const tagNameMap = new Map<string, string>();
            for (const tag of preloadedTags) {
                const key = `${tag.subject}\0${tag.name}\0${tag.userId || ''}\0${tag.parentId || ''}`;
                tagNameMap.set(key, tag.id);
            }

            // 4. 导入 error items
            const errorItemIdMap = new Map<string, string>();
            for (const item of body.errorItems) {
                const targetUserId = importAll ? item.userId : user.id;
                const newSubjectId = item.subjectId ? subjectIdMap.get(item.subjectId) : undefined;

                // 去重：同一用户 + 同一科目 + 相同题目文本视为重复
                if (item.questionText) {
                    const existing = await tx.errorItem.findFirst({
                        where: {
                            userId: targetUserId,
                            subjectId: newSubjectId || null,
                            questionText: item.questionText,
                        },
                    });
                    if (existing) {
                        // 跳过重复，但保留练习记录所需的 ID 映射
                        errorItemIdMap.set(item.id, existing.id);
                        continue;
                    }
                }

                const created = await tx.errorItem.create({
                    data: {
                        userId: targetUserId,
                        subjectId: newSubjectId || undefined,
                        originalImageUrl: item.originalImageUrl || '',
                        ocrText: item.ocrText,
                        questionText: item.questionText,
                        answerText: item.answerText,
                        analysis: item.analysis,
                        wrongAnswerText: item.wrongAnswerText,
                        mistakeAnalysis: item.mistakeAnalysis,
                        mistakeStatus: item.mistakeStatus,
                        source: item.source,
                        errorType: item.errorType,
                        correctedAt: safeParseDate(item.correctedAt),
                        userNotes: item.userNotes,
                        masteryLevel: safeMasteryLevel(item.masteryLevel),
                        gradeSemester: item.gradeSemester,
                        paperLevel: item.paperLevel,
                        createdAt: safeParseDate(item.createdAt),
                    },
                });
                errorItemIdMap.set(item.id, created.id);
                stats.errorItemsCreated++;

                // 关联 tags
                const importedTags = item.tags?.length
                    ? item.tags
                    : parseLegacyTagNames(item.knowledgePoints).map(name => ({
                        id: '',
                        name,
                        subject: inferSubjectFromName(item.subjectId ? subjectNameMap.get(item.subjectId) || null : null) || 'other',
                        parentId: null,
                        userId: targetUserId,
                        isSystem: false,
                    }));
                if (importedTags.length > 0) {
                    const tagConnections: { id: string }[] = [];
                    for (const tag of importedTags) {
                        if (tagIdMap.has(tag.id)) {
                            tagConnections.push({ id: tagIdMap.get(tag.id)! });
                        } else {
                            const ownerId = tag.isSystem ? null : targetUserId;
                            const parentId = tag.parentId ? tagIdMap.get(tag.parentId) || tag.parentId : null;
                            const key = `${tag.subject}\0${tag.name}\0${ownerId || ''}\0${parentId || ''}`;
                            let tagId = tagNameMap.get(key);
                            if (!tagId) {
                                const fallbackKey = `${tag.subject}\0${tag.name}\0${targetUserId}\0`;
                                const existing = await tx.knowledgeTag.findFirst({
                                    where: {
                                        name: tag.name,
                                        subject: tag.subject,
                                        parentId: null,
                                        userId: targetUserId,
                                        isSystem: false,
                                    },
                                });
                                const created = existing || await tx.knowledgeTag.create({
                                    data: { name: tag.name, subject: tag.subject, userId: targetUserId, parentId: null, isSystem: false },
                                });
                                tagId = created.id;
                                tagNameMap.set(fallbackKey, tagId);
                                if (!existing) stats.tagsCreated++;
                            }
                            tagConnections.push({ id: tagId });
                        }
                    }

                    if (tagConnections.length > 0) {
                        await tx.errorItem.update({
                            where: { id: created.id, userId: targetUserId },
                            data: {
                                tags: { connect: tagConnections },
                            },
                        });
                        stats.tagsLinked += tagConnections.length;
                    }
                }
            }

            // 5. 导入 practice records
            for (const record of (body.practiceRecords || [])) {
                const targetUserId = importAll ? record.userId : user.id;
                await tx.practiceRecord.create({
                    data: {
                        userId: targetUserId,
                        errorItemId: record.errorItemId ? errorItemIdMap.get(record.errorItemId) : undefined,
                        subject: record.subject,
                        difficulty: record.difficulty,
                        isCorrect: record.isCorrect,
                        answerInput: record.answerInput,
                        createdAt: safeParseDate(record.createdAt),
                    },
                });
                stats.practiceRecordsCreated++;
            }
        }, {
            timeout: 60000,
        });

        logger.info({
            userId: user.id,
            scope: importAll ? 'all' : 'user',
            ...stats,
        }, 'Data import completed');

        return NextResponse.json({
            success: true,
            stats,
        });
    } catch (error) {
        logger.error({ error, userId: user.id }, 'Import failed');
        return internalError("Failed to import data");
    }
}
