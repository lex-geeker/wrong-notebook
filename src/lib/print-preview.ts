import type { ErrorItem, PracticeSessionData } from "@/types/api";

export type PrintPreviewItem = Pick<ErrorItem, "id"> & Partial<Omit<ErrorItem, "id">>;

type PrintSelectableItem = {
    id: string;
};

export async function loadAllPages<T>(
    fetchPage: (page: number) => Promise<{ items: T[]; totalPages: number }>,
): Promise<T[]> {
    const first = await fetchPage(1);
    const items = [...first.items];
    for (let page = 2; page <= first.totalPages; page++) items.push(...(await fetchPage(page)).items);
    return items;
}

export function getPracticePrintItems(
    session: Pick<PracticeSessionData, "answeredCount" | "itemCount" | "items">,
): PrintPreviewItem[] {
    const completed = session.answeredCount === session.itemCount;
    return session.items.map((item) => ({
        id: item.id,
        questionText: item.questionText,
        ...(completed && item.answer ? { answerText: item.answer.expectedAnswer } : {}),
    }));
}

export function getSelectedPrintItems<T extends PrintSelectableItem>(
    items: T[],
    selectedIds: Set<string>,
): T[] {
    return items.filter((item) => selectedIds.has(item.id));
}

export function shouldReserveAnswerSpace(
    showAnswers: boolean,
    showAnalysis: boolean,
    reserveAnswerSpace: boolean,
): boolean {
    return reserveAnswerSpace && !showAnswers && !showAnalysis;
}

export function getPrintPreviewCountLabel(totalCount: number, selectedCount: number): string {
    return selectedCount === totalCount
        ? String(totalCount)
        : `${selectedCount}/${totalCount}`;
}

export function getPrintPreviewEmptyState(
    totalCount: number,
    selectedCount: number,
): 'noItems' | 'noSelection' | null {
    if (totalCount === 0) return 'noItems';
    if (selectedCount === 0) return 'noSelection';
    return null;
}
