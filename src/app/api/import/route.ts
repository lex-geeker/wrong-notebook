import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { badRequest, forbidden, internalError, unauthorized } from "@/lib/api-errors";
import { inferSubjectFromName } from "@/lib/knowledge-tags";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

const logger = createLogger("api:import");
const idSchema = z.string().min(1).max(200);
const dateSchema = z.string().refine(value => Number.isFinite(new Date(value).getTime()), "Invalid date");
const nullableString = z.string().nullable();

const userSchema = z.object({
    id: idSchema,
    email: z.string().max(254).regex(/^[^\s@]+@[^\s@]+$/, "Invalid email format"),
    password: z.string().min(1).max(1000),
    name: z.string().max(200).nullable(),
    educationStage: z.string().max(50).nullable(),
    enrollmentYear: z.number().int().min(1900).max(3000).nullable(),
    role: z.enum(["admin", "user"]),
    isActive: z.boolean(),
    createdAt: dateSchema,
    updatedAt: dateSchema,
});

const legacyUserSchema = userSchema.omit({ password: true, isActive: true, createdAt: true, updatedAt: true });

const subjectSchema = z.object({
    id: idSchema,
    name: z.string().min(1).max(200),
    userId: idSchema,
    createdAt: dateSchema,
    updatedAt: dateSchema,
});

const tagRefSchema = z.object({
    id: idSchema,
    name: z.string().min(1).max(100),
    subject: z.string().min(1).max(50),
    parentId: idSchema.nullish(),
    userId: idSchema.nullish(),
    isSystem: z.boolean().optional(),
});

const customTagSchema = tagRefSchema.extend({
    parentId: idSchema.nullable(),
    order: z.number().int(),
    code: z.string().max(100).nullable(),
    isSystem: z.literal(false),
    userId: idSchema,
    createdAt: dateSchema,
    updatedAt: dateSchema,
    parent: tagRefSchema.nullable().optional(),
});

const errorItemSchema = z.object({
    id: idSchema,
    userId: idSchema,
    subjectId: idSchema.nullable(),
    originalImageUrl: z.string(),
    ocrText: nullableString,
    questionText: nullableString,
    answerText: nullableString,
    analysis: nullableString,
    wrongAnswerText: nullableString,
    mistakeAnalysis: nullableString,
    mistakeStatus: nullableString,
    geogebraCommands: nullableString.optional(),
    knowledgePoints: nullableString.optional(),
    source: nullableString,
    errorType: nullableString,
    userNotes: nullableString,
    masteryLevel: z.number().int().min(0).max(2),
    gradeSemester: nullableString,
    paperLevel: nullableString,
    createdAt: dateSchema,
    updatedAt: dateSchema,
    tags: z.array(tagRefSchema),
});

const practiceSessionSchema = z.object({
    id: idSchema,
    userId: idSchema,
    mode: z.string().min(1).max(50),
    questionSource: z.string().min(1).max(50),
    language: z.string().min(1).max(10),
    startedAt: dateSchema,
    endedAt: dateSchema.nullable(),
});

const practiceSessionItemSchema = z.object({
    id: idSchema,
    sessionId: idSchema,
    errorItemId: idSchema.nullable(),
    position: z.number().int().min(0),
    subjectName: nullableString,
    gradeSemester: nullableString,
    knowledgePoints: nullableString,
    sourceQuestionText: z.string(),
    sourceAnswerText: z.string(),
    questionText: z.string(),
    answerText: z.string(),
    generationMode: z.string().min(1).max(50),
});

const practiceRecordSchema = z.object({
    id: idSchema,
    userId: idSchema,
    sessionItemId: idSchema.nullish(),
    errorItemId: idSchema.nullish(),
    subject: nullableString,
    difficulty: nullableString,
    isCorrect: z.boolean().nullable(),
    answerInput: nullableString.optional(),
    createdAt: dateSchema,
});

const commonCollections = {
    subjects: z.array(subjectSchema),
    customTags: z.array(customTagSchema),
    errorItems: z.array(errorItemSchema),
    practiceRecords: z.array(practiceRecordSchema),
};

const v4Schema = z.object({
    version: z.literal(4),
    exportedAt: dateSchema,
    scope: z.enum(["user", "all"]).default("user"),
    user: legacyUserSchema,
    ...commonCollections,
});

const v5Schema = z.object({
    version: z.literal(5),
    exportedAt: dateSchema,
    scope: z.enum(["user", "all"]),
    users: z.array(userSchema).min(1),
    ...commonCollections,
    practiceSessions: z.array(practiceSessionSchema),
    practiceSessionItems: z.array(practiceSessionItemSchema),
});

const backupSchema = z.discriminatedUnion("version", [v4Schema, v5Schema]);
type Backup = z.infer<typeof backupSchema>;

class InvalidBackupError extends Error { }

function asDate(value: string) {
    return new Date(value);
}

function requiredMapping(map: Map<string, string>, id: string, relation: string) {
    const mapped = map.get(id);
    if (!mapped) throw new InvalidBackupError(`Unknown ${relation}: ${id}`);
    return mapped;
}

function requireOwner(actual: string, expected: string, relation: string) {
    if (actual !== expected) throw new InvalidBackupError(`Cross-user ${relation} is not allowed`);
}

function parseLegacyTagNames(value: string | null | undefined): string[] {
    if (!value) return [];
    try {
        const parsed: unknown = JSON.parse(value);
        return Array.isArray(parsed)
            ? parsed.filter((name): name is string => typeof name === "string" && name.length <= 100).slice(0, 20)
            : [];
    } catch {
        return [];
    }
}

export async function POST(req: Request) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || !session.user.email) return unauthorized("Not authenticated");

    const currentUser = { id: session.user.id, email: session.user.email };
    const importAll = new URL(req.url).searchParams.get("all") === "true";
    if (importAll && session.user.role !== "admin") return forbidden("Admin role required");

    try {
        const contentLength = Number(req.headers.get("content-length"));
        if (Number.isFinite(contentLength) && contentLength > 50 * 1024 * 1024) {
            return badRequest("Request body too large (max 50MB)");
        }

        let json: unknown;
        try {
            json = await req.json();
        } catch {
            return badRequest("Invalid JSON");
        }

        const parsed = backupSchema.safeParse(json);
        if (!parsed.success) return badRequest("Invalid import data format", parsed.error.flatten());
        const body: Backup = parsed.data;

        if (body.version === 4 && (importAll || body.scope === "all")) {
            return badRequest("Version 4 full backups cannot restore all users; create a version 5 export");
        }
        if (body.version === 5 && ((importAll && body.scope !== "all") || (!importAll && body.scope !== "user"))) {
            return badRequest("Backup scope does not match the selected import scope");
        }

        const sourceUsers = body.version === 5 ? body.users : [body.user];
        if (!importAll && (sourceUsers.length !== 1 || sourceUsers[0].email !== currentUser.email)) {
            return badRequest("Import data does not belong to current user");
        }

        const stats = {
            usersCreated: 0,
            subjectsCreated: 0,
            tagsCreated: 0,
            errorItemsCreated: 0,
            practiceSessionsCreated: 0,
            practiceSessionItemsCreated: 0,
            practiceRecordsCreated: 0,
            tagsLinked: 0,
        };

        await prisma.$transaction(async tx => {
            const userIdMap = new Map<string, string>();
            if (importAll && body.version === 5) {
                for (const source of body.users) {
                    const byId = await tx.user.findUnique({ where: { id: source.id } });
                    if (byId && byId.email !== source.email) throw new InvalidBackupError(`Conflicting user ID: ${source.id}`);
                    const existing = byId || await tx.user.findUnique({ where: { email: source.email } });
                    const data = {
                        email: source.email,
                        password: source.password,
                        name: source.name,
                        educationStage: source.educationStage,
                        enrollmentYear: source.enrollmentYear,
                        role: source.role,
                        isActive: source.isActive,
                    };
                    const restored = existing
                        ? await tx.user.update({ where: { id: existing.id }, data })
                        : await tx.user.create({ data: { id: source.id, ...data, createdAt: asDate(source.createdAt) } });
                    if (!existing) stats.usersCreated++;
                    userIdMap.set(source.id, restored.id);
                }
            } else {
                userIdMap.set(sourceUsers[0].id, currentUser.id);
            }

            const subjectIdMap = new Map<string, string>();
            const subjectOwnerMap = new Map<string, string>();
            const subjectNameMap = new Map<string, string>();
            for (const source of body.subjects) {
                const targetUserId = requiredMapping(userIdMap, source.userId, "subject user");
                const byId = await tx.subject.findUnique({ where: { id: source.id } });
                if (byId) requireOwner(byId.userId, targetUserId, "subject");
                const existing = byId || await tx.subject.findFirst({ where: { name: source.name, userId: targetUserId } });
                const restored = existing || await tx.subject.create({
                    data: { id: source.id, name: source.name, userId: targetUserId, createdAt: asDate(source.createdAt) },
                });
                if (!existing) stats.subjectsCreated++;
                subjectIdMap.set(source.id, restored.id);
                subjectOwnerMap.set(source.id, targetUserId);
                subjectNameMap.set(source.id, source.name);
            }

            const tagIdMap = new Map<string, string>();
            const tagOwnerMap = new Map<string, string>();
            for (const source of body.customTags) {
                const targetUserId = requiredMapping(userIdMap, source.userId, "tag user");
                const byId = await tx.knowledgeTag.findUnique({ where: { id: source.id } });
                if (byId && (byId.userId !== targetUserId || byId.isSystem)) {
                    throw new InvalidBackupError(`Conflicting tag ID: ${source.id}`);
                }
                const existing = byId || (!source.parentId
                    ? await tx.knowledgeTag.findFirst({
                        where: { name: source.name, subject: source.subject, userId: targetUserId, parentId: null, isSystem: false },
                    })
                    : null);
                const restored = existing || await tx.knowledgeTag.create({
                    data: {
                        id: source.id,
                        name: source.name,
                        subject: source.subject,
                        isSystem: false,
                        userId: targetUserId,
                        order: source.order,
                        code: source.code,
                        createdAt: asDate(source.createdAt),
                    },
                });
                if (!existing) stats.tagsCreated++;
                tagIdMap.set(source.id, restored.id);
                tagOwnerMap.set(source.id, targetUserId);
            }

            for (const source of body.customTags) {
                if (!source.parentId) continue;
                const tagId = requiredMapping(tagIdMap, source.id, "tag");
                let parentId = tagIdMap.get(source.parentId);
                if (parentId) {
                    requireOwner(requiredMapping(tagOwnerMap, source.parentId, "parent tag owner"), requiredMapping(tagOwnerMap, source.id, "tag owner"), "tag hierarchy");
                } else if (source.parent?.isSystem) {
                    const systemParent = await tx.knowledgeTag.findFirst({
                        where: { name: source.parent.name, subject: source.parent.subject, isSystem: true, userId: null },
                    });
                    parentId = systemParent?.id;
                }
                if (!parentId) {
                    if (body.version === 4) continue;
                    throw new InvalidBackupError(`Unknown parent tag: ${source.parentId}`);
                }
                await tx.knowledgeTag.update({ where: { id: tagId }, data: { parentId } });
            }

            const errorItemIdMap = new Map<string, string>();
            const errorOwnerMap = new Map<string, string>();
            for (const source of body.errorItems) {
                const targetUserId = requiredMapping(userIdMap, source.userId, "error item user");
                const subjectId = source.subjectId ? requiredMapping(subjectIdMap, source.subjectId, "subject") : null;
                if (source.subjectId) requireOwner(requiredMapping(subjectOwnerMap, source.subjectId, "subject owner"), targetUserId, "error item subject");

                const byId = await tx.errorItem.findUnique({ where: { id: source.id } });
                if (byId) requireOwner(byId.userId, targetUserId, "error item");
                const existing = byId || (source.questionText
                    ? await tx.errorItem.findFirst({ where: { userId: targetUserId, subjectId, questionText: source.questionText } })
                    : null);
                const restored = existing || await tx.errorItem.create({
                    data: {
                        id: source.id,
                        userId: targetUserId,
                        subjectId,
                        originalImageUrl: source.originalImageUrl,
                        ocrText: source.ocrText,
                        questionText: source.questionText,
                        answerText: source.answerText,
                        analysis: source.analysis,
                        wrongAnswerText: source.wrongAnswerText,
                        mistakeAnalysis: source.mistakeAnalysis,
                        mistakeStatus: source.mistakeStatus,
                        geogebraCommands: source.geogebraCommands,
                        source: source.source,
                        errorType: source.errorType,
                        userNotes: source.userNotes,
                        masteryLevel: source.masteryLevel,
                        gradeSemester: source.gradeSemester,
                        paperLevel: source.paperLevel,
                        createdAt: asDate(source.createdAt),
                    },
                });
                if (!existing) stats.errorItemsCreated++;
                errorItemIdMap.set(source.id, restored.id);
                errorOwnerMap.set(source.id, targetUserId);

                const importedTags = source.tags.length
                    ? source.tags
                    : parseLegacyTagNames(source.knowledgePoints).map(name => ({
                        id: "",
                        name,
                        subject: inferSubjectFromName(source.subjectId ? subjectNameMap.get(source.subjectId) || null : null) || "other",
                        parentId: null,
                        userId: source.userId,
                        isSystem: false,
                    }));
                const tagConnections = new Set<string>();
                for (const tag of importedTags) {
                    let tagId = tagIdMap.get(tag.id);
                    if (tagId) {
                        requireOwner(requiredMapping(tagOwnerMap, tag.id, "tag owner"), targetUserId, "error item tag");
                    } else if (tag.isSystem) {
                        tagId = (await tx.knowledgeTag.findFirst({
                            where: { name: tag.name, subject: tag.subject, isSystem: true, userId: null },
                        }))?.id;
                    } else {
                        const existingTag = await tx.knowledgeTag.findFirst({
                            where: { name: tag.name, subject: tag.subject, parentId: null, userId: targetUserId, isSystem: false },
                        });
                        const restoredTag = existingTag || await tx.knowledgeTag.create({
                            data: { name: tag.name, subject: tag.subject, userId: targetUserId, parentId: null, isSystem: false },
                        });
                        if (!existingTag) stats.tagsCreated++;
                        tagId = restoredTag.id;
                    }
                    if (!tagId) throw new InvalidBackupError(`Unknown error item tag: ${tag.id}`);
                    tagConnections.add(tagId);
                }
                if (tagConnections.size) {
                    await tx.errorItem.update({
                        where: { id: restored.id },
                        data: { tags: { connect: [...tagConnections].map(id => ({ id })) } },
                    });
                    stats.tagsLinked += tagConnections.size;
                }
            }

            const practiceSessionIdMap = new Map<string, string>();
            const practiceSessionOwnerMap = new Map<string, string>();
            if (body.version === 5) {
                for (const source of body.practiceSessions) {
                    const targetUserId = requiredMapping(userIdMap, source.userId, "practice session user");
                    const byId = await tx.practiceSession.findUnique({ where: { id: source.id } });
                    if (byId) requireOwner(byId.userId, targetUserId, "practice session");
                    const restored = byId || await tx.practiceSession.create({
                        data: {
                            id: source.id,
                            userId: targetUserId,
                            mode: source.mode,
                            questionSource: source.questionSource,
                            language: source.language,
                            startedAt: asDate(source.startedAt),
                            endedAt: source.endedAt ? asDate(source.endedAt) : null,
                        },
                    });
                    if (!byId) stats.practiceSessionsCreated++;
                    practiceSessionIdMap.set(source.id, restored.id);
                    practiceSessionOwnerMap.set(source.id, targetUserId);
                }
            }

            const practiceSessionItemIdMap = new Map<string, string>();
            const practiceSessionItemOwnerMap = new Map<string, string>();
            if (body.version === 5) {
                for (const source of body.practiceSessionItems) {
                    const sessionId = requiredMapping(practiceSessionIdMap, source.sessionId, "practice session");
                    const ownerId = requiredMapping(practiceSessionOwnerMap, source.sessionId, "practice session owner");
                    const errorItemId = source.errorItemId ? requiredMapping(errorItemIdMap, source.errorItemId, "error item") : null;
                    if (source.errorItemId) requireOwner(requiredMapping(errorOwnerMap, source.errorItemId, "error item owner"), ownerId, "practice session item");
                    const byId = await tx.practiceSessionItem.findUnique({ where: { id: source.id } });
                    if (byId && byId.sessionId !== sessionId) throw new InvalidBackupError(`Conflicting practice item ID: ${source.id}`);
                    const restored = byId || await tx.practiceSessionItem.create({
                        data: {
                            id: source.id,
                            sessionId,
                            errorItemId,
                            position: source.position,
                            subjectName: source.subjectName,
                            gradeSemester: source.gradeSemester,
                            knowledgePoints: source.knowledgePoints,
                            sourceQuestionText: source.sourceQuestionText,
                            sourceAnswerText: source.sourceAnswerText,
                            questionText: source.questionText,
                            answerText: source.answerText,
                            generationMode: source.generationMode,
                        },
                    });
                    if (!byId) stats.practiceSessionItemsCreated++;
                    practiceSessionItemIdMap.set(source.id, restored.id);
                    practiceSessionItemOwnerMap.set(source.id, ownerId);
                }
            }

            for (const source of body.practiceRecords) {
                const targetUserId = requiredMapping(userIdMap, source.userId, "practice record user");
                const errorItemId = source.errorItemId ? requiredMapping(errorItemIdMap, source.errorItemId, "error item") : null;
                const sessionItemId = source.sessionItemId ? requiredMapping(practiceSessionItemIdMap, source.sessionItemId, "practice session item") : null;
                if (source.errorItemId) requireOwner(requiredMapping(errorOwnerMap, source.errorItemId, "error item owner"), targetUserId, "practice record error item");
                if (source.sessionItemId) requireOwner(requiredMapping(practiceSessionItemOwnerMap, source.sessionItemId, "practice session item owner"), targetUserId, "practice record session item");
                const existing = await tx.practiceRecord.findUnique({ where: { id: source.id } });
                if (existing) {
                    requireOwner(existing.userId, targetUserId, "practice record");
                    continue;
                }
                await tx.practiceRecord.create({
                    data: {
                        id: source.id,
                        userId: targetUserId,
                        sessionItemId,
                        errorItemId,
                        subject: source.subject,
                        difficulty: source.difficulty,
                        isCorrect: source.isCorrect,
                        answerInput: source.answerInput,
                        createdAt: asDate(source.createdAt),
                    },
                });
                stats.practiceRecordsCreated++;
            }
        }, { timeout: 60000 });

        logger.info({ userId: currentUser.id, scope: importAll ? "all" : "user", ...stats }, "Data import completed");
        return NextResponse.json({ success: true, stats });
    } catch (error) {
        if (error instanceof InvalidBackupError) return badRequest(error.message);
        logger.error({ error, userId: currentUser.id }, "Import failed");
        return internalError("Failed to import data");
    }
}
