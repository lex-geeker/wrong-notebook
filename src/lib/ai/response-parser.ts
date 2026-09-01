import { normalizeMistakeStatusForSave } from '../mistake-status';
import { safeParseParsedQuestion } from './schema';
import type { ParsedQuestion } from './types';

const VALID_SUBJECTS = new Set<ParsedQuestion['subject']>([
    '数学', '物理', '化学', '生物', '英语', '语文', '历史', '地理', '政治', '其他',
]);

export function extractXmlTag(text: string, tagName: string): string | null {
    const startTag = `<${tagName}>`;
    const endTag = `</${tagName}>`;
    const startIndex = text.indexOf(startTag);
    const endIndex = text.lastIndexOf(endTag);
    if (startIndex === -1 || endIndex === -1 || startIndex + startTag.length >= endIndex) return null;
    return text.substring(startIndex + startTag.length, endIndex).trim();
}

export function parseAIResponse(text: string): ParsedQuestion {
    const questionText = extractXmlTag(text, 'question_text');
    const answerText = extractXmlTag(text, 'answer_text');
    const analysis = extractXmlTag(text, 'analysis');
    if (!questionText || !answerText || !analysis) {
        throw new Error('AI_RESPONSE_ERROR: Missing critical XML tags');
    }

    const subjectRaw = extractXmlTag(text, 'subject');
    const wrongAnswerText = extractXmlTag(text, 'wrong_answer_text') || '';
    const result = {
        questionText,
        answerText,
        analysis,
        wrongAnswerText,
        mistakeAnalysis: extractXmlTag(text, 'mistake_analysis') || '',
        mistakeStatus: normalizeMistakeStatusForSave(extractXmlTag(text, 'mistake_status'), wrongAnswerText),
        subject: subjectRaw && VALID_SUBJECTS.has(subjectRaw as ParsedQuestion['subject'])
            ? subjectRaw as ParsedQuestion['subject']
            : '其他' as const,
        knowledgePoints: (extractXmlTag(text, 'knowledge_points') || '')
            .split(/[,，\n]/)
            .map(point => point.trim())
            .filter(Boolean),
        requiresImage: extractXmlTag(text, 'requires_image')?.toLowerCase() === 'true',
    };
    const validation = safeParseParsedQuestion(result);
    if (!validation.success) throw new Error('AI_RESPONSE_ERROR: Response schema validation failed');
    return validation.data;
}
