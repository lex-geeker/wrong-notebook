import type { Prisma, PrismaClient } from '@prisma/client';
import {
    BIOLOGY_CURRICULUM,
    BIOLOGY_GRADE_ORDER,
    CHEMISTRY_CURRICULUM,
    CHEMISTRY_GRADE_ORDER,
    CHINESE_CURRICULUM,
    CHINESE_GRADE_ORDER,
    ENGLISH_CURRICULUM,
    ENGLISH_GRADE_ORDER,
    GEOGRAPHY_CURRICULUM,
    GEOGRAPHY_GRADE_ORDER,
    HISTORY_CURRICULUM,
    HISTORY_GRADE_ORDER,
    MATH_CURRICULUM,
    MATH_GRADE_ORDER,
    PHYSICS_CURRICULUM,
    PHYSICS_GRADE_ORDER,
    POLITICS_CURRICULUM,
    POLITICS_GRADE_ORDER,
} from './tag-data';

type GradeOrder = Record<string, number>;
type MathCurriculum = Record<string, readonly {
    chapter: string;
    sections: readonly { section: string; tags: readonly string[] }[];
}[]>;
type StandardCurriculum = Record<string, readonly {
    chapter: string;
    tags: readonly string[];
}[]>;

const STANDARD_CURRICULA: readonly [string, StandardCurriculum, GradeOrder][] = [
    ['physics', PHYSICS_CURRICULUM, PHYSICS_GRADE_ORDER],
    ['english', ENGLISH_CURRICULUM, ENGLISH_GRADE_ORDER],
    ['chemistry', CHEMISTRY_CURRICULUM, CHEMISTRY_GRADE_ORDER],
    ['biology', BIOLOGY_CURRICULUM, BIOLOGY_GRADE_ORDER],
    ['chinese', CHINESE_CURRICULUM, CHINESE_GRADE_ORDER],
    ['history', HISTORY_CURRICULUM, HISTORY_GRADE_ORDER],
    ['geography', GEOGRAPHY_CURRICULUM, GEOGRAPHY_GRADE_ORDER],
    ['politics', POLITICS_CURRICULUM, POLITICS_GRADE_ORDER],
];

export interface RebuildSystemTagsResult {
    count: number;
    associationsRestored: number;
    customTagsCreated: number;
}

async function seedMath(tx: Prisma.TransactionClient, curriculum: MathCurriculum, gradeOrder: GradeOrder) {
    let count = 0;
    for (const [gradeSemester, chapters] of Object.entries(curriculum)) {
        const grade = await tx.knowledgeTag.create({
            data: { name: gradeSemester, subject: 'math', parentId: null, isSystem: true, order: gradeOrder[gradeSemester] ?? 99 },
        });
        count++;

        for (const [chapterIndex, chapter] of chapters.entries()) {
            const chapterTag = await tx.knowledgeTag.create({
                data: { name: chapter.chapter, subject: 'math', parentId: grade.id, isSystem: true, order: chapterIndex + 1 },
            });
            count++;

            for (const [sectionIndex, section] of chapter.sections.entries()) {
                const sectionTag = await tx.knowledgeTag.create({
                    data: { name: section.section, subject: 'math', parentId: chapterTag.id, isSystem: true, order: sectionIndex + 1 },
                });
                count++;

                for (const [tagIndex, name] of section.tags.entries()) {
                    await tx.knowledgeTag.create({
                        data: { name, subject: 'math', parentId: sectionTag.id, isSystem: true, order: tagIndex + 1 },
                    });
                    count++;
                }
            }
        }
    }
    return count;
}

async function seedStandardSubject(
    tx: Prisma.TransactionClient,
    subject: string,
    curriculum: StandardCurriculum,
    gradeOrder: GradeOrder,
) {
    let count = 0;
    for (const [gradeSemester, chapters] of Object.entries(curriculum)) {
        const grade = await tx.knowledgeTag.create({
            data: { name: gradeSemester, subject, parentId: null, isSystem: true, order: gradeOrder[gradeSemester] ?? 99 },
        });
        count++;

        for (const [chapterIndex, chapter] of chapters.entries()) {
            const chapterTag = await tx.knowledgeTag.create({
                data: { name: chapter.chapter, subject, parentId: grade.id, isSystem: true, order: chapterIndex + 1 },
            });
            count++;

            for (const [tagIndex, name] of chapter.tags.entries()) {
                await tx.knowledgeTag.create({
                    data: { name, subject, parentId: chapterTag.id, isSystem: true, order: tagIndex + 1 },
                });
                count++;
            }
        }
    }
    return count;
}

export async function rebuildSystemTags(prisma: PrismaClient): Promise<RebuildSystemTagsResult> {
    return prisma.$transaction(async (tx) => {
        const items = await tx.errorItem.findMany({
            select: {
                id: true,
                userId: true,
                tags: {
                    where: { isSystem: true },
                    select: { name: true, subject: true, parent: { select: { name: true } } },
                },
            },
        });
        const associations = items.flatMap(item => item.tags.map(tag => ({
            errorItemId: item.id,
            userId: item.userId,
            tagName: tag.name,
            subject: tag.subject,
            parentName: tag.parent?.name ?? null,
        })));

        await tx.knowledgeTag.deleteMany({ where: { isSystem: true } });
        let count = await seedMath(tx, MATH_CURRICULUM, MATH_GRADE_ORDER);
        for (const [subject, curriculum, gradeOrder] of STANDARD_CURRICULA) {
            count += await seedStandardSubject(tx, subject, curriculum, gradeOrder);
        }

        let associationsRestored = 0;
        let customTagsCreated = 0;
        const associationsByItem = new Map<string, typeof associations>();
        for (const association of associations) {
            const itemAssociations = associationsByItem.get(association.errorItemId) ?? [];
            itemAssociations.push(association);
            associationsByItem.set(association.errorItemId, itemAssociations);
        }

        for (const [errorItemId, itemAssociations] of associationsByItem) {
            const newTagIds: string[] = [];
            for (const association of itemAssociations) {
                let tag = await tx.knowledgeTag.findFirst({
                    where: {
                        name: association.tagName,
                        subject: association.subject,
                        isSystem: true,
                        userId: null,
                        parent: association.parentName ? { name: association.parentName } : null,
                    },
                    select: { id: true },
                });

                if (!tag) {
                    const parent = association.parentName
                        ? await tx.knowledgeTag.findFirst({
                            where: { name: association.parentName, subject: association.subject, isSystem: true },
                            select: { id: true },
                        })
                        : null;
                    tag = await tx.knowledgeTag.findFirst({
                        where: {
                            name: association.tagName,
                            subject: association.subject,
                            userId: association.userId,
                            parentId: parent?.id ?? null,
                            isSystem: false,
                        },
                        select: { id: true },
                    });
                    if (!tag) {
                        tag = await tx.knowledgeTag.create({
                            data: {
                                name: association.tagName,
                                subject: association.subject,
                                userId: association.userId,
                                parentId: parent?.id ?? null,
                                isSystem: false,
                            },
                            select: { id: true },
                        });
                        customTagsCreated++;
                    }
                }

                newTagIds.push(tag.id);
                associationsRestored++;
            }

            if (newTagIds.length > 0) {
                await tx.errorItem.update({
                    where: { id: errorItemId },
                    data: { tags: { connect: newTagIds.map(id => ({ id })) } },
                });
            }
        }

        return { count, associationsRestored, customTagsCreated };
    }, { timeout: 120_000 });
}
