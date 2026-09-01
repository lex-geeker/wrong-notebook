import type { Prisma } from "@prisma/client";
import { calculateNextReviewDate } from "@/lib/scheduler";

export const PRACTICE_MODES = ["random", "unmastered", "ebbinghaus"] as const;
export const PRACTICE_SOURCES = ["original", "variant"] as const;
export const PRACTICE_COUNTS = [5, 10, 20] as const;

export type PracticeMode = typeof PRACTICE_MODES[number];
export type PracticeSource = typeof PRACTICE_SOURCES[number];
export type PracticeCount = typeof PRACTICE_COUNTS[number];
export type MasteryFilter = "all" | "new" | "reviewing" | "mastered";

export interface PracticeFilters {
    subjectId?: string;
    gradeSemester?: string;
    chapter?: string;
    tag?: string;
    mastery?: MasteryFilter;
    timeRange?: "all" | "week" | "month";
}

export interface PracticeAnswerResult {
    isCorrect: boolean;
    matchType: "exact" | "choice" | "contains" | "mismatch";
}

type PracticeSessionWithItems = Prisma.PracticeSessionGetPayload<{
    include: { items: { include: { record: true } } };
}>;

const normalizeAnswer = (value: string) =>
    value.normalize("NFKC").trim().toLowerCase().replace(/[\s.,;:!?，。；：！？]/g, "");

export function judgePracticeAnswer(input: string, expected: string): PracticeAnswerResult {
    const normalizedInput = normalizeAnswer(input);
    const normalizedExpected = normalizeAnswer(expected);

    if (normalizedInput === normalizedExpected) return { isCorrect: true, matchType: "exact" };
    if (/^[a-d]$/.test(normalizedInput) && normalizedExpected.startsWith(normalizedInput)) {
        return { isCorrect: true, matchType: "choice" };
    }
    if (normalizedInput.length > 1 && normalizedExpected.includes(normalizedInput)) {
        return { isCorrect: true, matchType: "contains" };
    }
    return { isCorrect: false, matchType: "mismatch" };
}

export function nextMasteryLevel(current: number, isCorrect: boolean) {
    if (!isCorrect) return 0;
    return Math.min(2, Math.max(0, current) + 1);
}

export function getNextReviewDate(
    createdAt: Date,
    records: Array<{ createdAt: Date; isCorrect: boolean | null }>,
) {
    const latestFirst = [...records].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    let correctStreak = 0;
    while (latestFirst[correctStreak]?.isCorrect === true) correctStreak++;
    return calculateNextReviewDate(correctStreak, latestFirst[0]?.createdAt || createdAt);
}

export function isReviewDue(
    createdAt: Date,
    records: Array<{ createdAt: Date; isCorrect: boolean | null }>,
    now = new Date(),
) {
    return getNextReviewDate(createdAt, records).getTime() <= now.getTime();
}

export function pickRandom<T>(items: T[], count: number): T[] {
    const shuffled = [...items];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled.slice(0, count);
}

export function serializePracticeSession(session: PracticeSessionWithItems) {
    const items = [...session.items]
        .sort((a, b) => a.position - b.position)
        .map((item) => ({
            id: item.id,
            position: item.position,
            errorItemId: item.errorItemId,
            questionText: item.questionText,
            generationMode: item.generationMode,
            ...(item.record ? {
                answer: {
                    answerInput: item.record.answerInput || "",
                    expectedAnswer: item.answerText,
                    isCorrect: item.record.isCorrect === true,
                    matchType: judgePracticeAnswer(item.record.answerInput || "", item.answerText).matchType,
                },
            } : {}),
        }));

    return {
        id: session.id,
        mode: session.mode,
        questionSource: session.questionSource,
        startedAt: session.startedAt.toISOString(),
        endedAt: session.endedAt?.toISOString() || null,
        itemCount: items.length,
        answeredCount: items.filter((item) => item.answer).length,
        correctCount: items.filter((item) => item.answer?.isCorrect).length,
        items,
    };
}
