import { describe, expect, it } from 'vitest';
import { parseAIResponse } from '@/lib/ai/response-parser';

describe('parseAIResponse', () => {
    it('rejects responses that fail the shared schema', () => {
        const points = ['1', '2', '3', '4', '5', '6'].join(',');
        expect(() => parseAIResponse(`
            <question_text>question</question_text>
            <answer_text>answer</answer_text>
            <analysis>analysis</analysis>
            <subject>数学</subject>
            <knowledge_points>${points}</knowledge_points>
        `)).toThrow('AI_RESPONSE_ERROR');
    });
});
