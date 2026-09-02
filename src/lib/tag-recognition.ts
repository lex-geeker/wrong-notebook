
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export async function findParentTagIdForGrade(gradeSemester: string | null | undefined, subjectKey: string): Promise<string | null> {
    if (!gradeSemester || !subjectKey) return null;

    // Fetch all system root tags for the subject (which are typically Grades)
    // We filter by parentId: null to get only the top level (Grades)
    const rootTags = await prisma.knowledgeTag.findMany({
        where: {
            subject: subjectKey,
            isSystem: true,
            parentId: null
        },
        select: { id: true, name: true }
    });

    if (rootTags.length === 0) return null;

    const normalizedInput = gradeSemester.trim();

    // 1. Try Exact Match
    const exactMatch = rootTags.find(t => t.name === normalizedInput);
    if (exactMatch) return exactMatch.id;

    // 2. Try Mapped Match (Text Heuristics)
    // Convert input specifically to match the likely seed data format (e.g. "七年级上")
    // Input might be "初一，上期", "Grade 7, 1st Semester", etc.

    // Helper map for Chinese Grade names
    const gradeLevelMap: Record<string, string> = {
        "一年级": "一年级", "Grade 1": "一年级",
        "二年级": "二年级", "Grade 2": "二年级",
        "三年级": "三年级", "Grade 3": "三年级",
        "四年级": "四年级", "Grade 4": "四年级",
        "五年级": "五年级", "Grade 5": "五年级",
        "六年级": "六年级", "Grade 6": "六年级",
        "初一": "七年级", "Grade 7": "七年级", "七年级": "七年级",
        "初二": "八年级", "Grade 8": "八年级", "八年级": "八年级",
        "初三": "九年级", "Grade 9": "九年级", "九年级": "九年级",
        "高一": "高一", "Grade 10": "高一", "Senior 1": "高一",
        "高二": "高二", "Grade 11": "高二", "Senior 2": "高二",
        "高三": "高三", "Grade 12": "高三", "Senior 3": "高三",
    };

    let targetGradePrefix = "";
    for (const [key, value] of Object.entries(gradeLevelMap)) {
        if (normalizedInput.includes(key)) {
            targetGradePrefix = value;
            break; // Found the grade level
        }
    }

    if (!targetGradePrefix) return null; // Couldn't identify grade level

    // Special case: "高三" in seed data often doesn't have semesters (based on previous check)
    // But let's check what root tags are available.

    // Determine Semester
    let targetSemester = "";
    if (normalizedInput.includes("上") || normalizedInput.includes("1st") || normalizedInput.includes("First")) {
        targetSemester = "上";
    } else if (normalizedInput.includes("下") || normalizedInput.includes("2nd") || normalizedInput.includes("Second")) {
        targetSemester = "下";
    }

    // Construct candidates
    // Candidate 1: Grade + Semester (e.g. "七年级上")
    // Candidate 2: Grade (e.g. "一年级", or "高三")

    const candidates = [];
    if (targetSemester) {
        candidates.push(`${targetGradePrefix}${targetSemester}`); // e.g. "七年级上"
    }
    candidates.push(targetGradePrefix); // e.g. "一年级", "高三"

    for (const candidate of candidates) {
        const match = rootTags.find(t => t.name === candidate);
        if (match) return match.id;
    }



    return null;
}

export async function resolveKnowledgeTagConnections({
    userId,
    gradeSemester,
    subjectKey,
    tagNames,
}: {
    userId: string;
    gradeSemester?: string | null;
    subjectKey: string;
    tagNames: string[];
}): Promise<{ id: string }[]> {
    const names = [...new Set(tagNames.map(name => name.trim()).filter(Boolean))];
    if (names.length === 0) return [];

    const parentId = await findParentTagIdForGrade(gradeSemester, subjectKey);
    const scope: Prisma.KnowledgeTagWhereInput = {
        subject: subjectKey,
        parentId,
        OR: [
            { isSystem: true, userId: null },
            { isSystem: false, userId },
        ],
    };
    const existingTags = await prisma.knowledgeTag.findMany({
        where: { ...scope, name: { in: names } },
        select: { id: true, name: true },
    });
    const tagsByName = new Map(existingTags.map(tag => [tag.name, tag]));

    for (const name of names) {
        if (tagsByName.has(name)) continue;

        try {
            const tag = await prisma.knowledgeTag.create({
                data: {
                    name,
                    subject: subjectKey,
                    isSystem: false,
                    userId,
                    parentId,
                },
                select: { id: true, name: true },
            });
            tagsByName.set(name, tag);
        } catch (error) {
            if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;

            const tag = await prisma.knowledgeTag.findFirst({
                where: { ...scope, name },
                select: { id: true, name: true },
            });
            if (!tag) throw error;
            tagsByName.set(name, tag);
        }
    }

    return names.map(name => ({ id: tagsByName.get(name)!.id }));
}
