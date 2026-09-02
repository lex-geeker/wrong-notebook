import { describe, expect, it, vi } from 'vitest';
import {
    getPrintPreviewCountLabel,
    getPrintPreviewEmptyState,
    getPracticePrintItems,
    getSelectedPrintItems,
    loadAllPages,
    shouldReserveAnswerSpace,
} from '@/lib/print-preview';

describe('print preview helpers', () => {
    const items = [
        { id: 'item-1', questionText: '题目 1' },
        { id: 'item-2', questionText: '题目 2' },
        { id: 'item-3', questionText: '题目 3' },
    ];

    it('只返回当前选中的题目，并保持原顺序', () => {
        const selected = getSelectedPrintItems(items, new Set(['item-3', 'item-1']));

        expect(selected.map((item) => item.id)).toEqual(['item-1', 'item-3']);
    });

    it('只在开启留白且答案和解析都不显示时预留作答空间', () => {
        expect(shouldReserveAnswerSpace(false, false, true)).toBe(true);
        expect(shouldReserveAnswerSpace(false, false, false)).toBe(false);
        expect(shouldReserveAnswerSpace(true, false, true)).toBe(false);
        expect(shouldReserveAnswerSpace(false, true, true)).toBe(false);
        expect(shouldReserveAnswerSpace(true, true, true)).toBe(false);
    });

    it('局部选择时显示已选数量和总数量', () => {
        expect(getPrintPreviewCountLabel(88, 88)).toBe('88');
        expect(getPrintPreviewCountLabel(88, 2)).toBe('2/88');
    });

    it('分页加载超过 200 条打印数据且不静默截断', async () => {
        const fetchPage = vi.fn(async (page: number) => ({
            items: Array.from({ length: page === 3 ? 51 : 100 }, (_, index) => ({ id: `${page}-${index}` })),
            totalPages: 3,
        }));

        const loaded = await loadAllPages(fetchPage);

        expect(loaded).toHaveLength(251);
        expect(fetchPage.mock.calls.map(([page]) => page)).toEqual([1, 2, 3]);
    });

    it('区分无匹配题目和有题但未选择', () => {
        expect(getPrintPreviewEmptyState(0, 0)).toBe('noItems');
        expect(getPrintPreviewEmptyState(88, 0)).toBe('noSelection');
        expect(getPrintPreviewEmptyState(88, 2)).toBeNull();
    });

    it('maps practice questions in order and only exposes answers after completion', () => {
        const session = {
            itemCount: 2,
            answeredCount: 1,
            items: [
                {
                    id: 'practice-1',
                    position: 0,
                    errorItemId: 'error-1',
                    questionText: 'variant question',
                    generationMode: 'variant' as const,
                    purpose: 'review' as const,
                    answer: {
                        answerInput: '4',
                        expectedAnswer: '4',
                        isCorrect: true,
                        matchType: 'exact' as const,
                    },
                },
                {
                    id: 'practice-2',
                    position: 1,
                    errorItemId: 'error-2',
                    questionText: 'original question',
                    generationMode: 'original' as const,
                    purpose: 'correction' as const,
                },
            ],
        };

        expect(getPracticePrintItems(session)).toEqual([
            { id: 'practice-1', questionText: 'variant question' },
            { id: 'practice-2', questionText: 'original question' },
        ]);
        expect(getPracticePrintItems({ ...session, answeredCount: 2, items: session.items.map((item) => ({
            ...item,
            answer: item.answer || {
                answerInput: 'answer',
                expectedAnswer: 'reference answer',
                isCorrect: false,
                matchType: 'manual' as const,
            },
        })) })).toEqual([
            { id: 'practice-1', questionText: 'variant question', answerText: '4' },
            { id: 'practice-2', questionText: 'original question', answerText: 'reference answer' },
        ]);
    });
});
