import { getAppConfig } from '../config';
import { normalizeMistakeStatusForSave } from '../mistake-status';
import { generateAnalyzePrompt } from './prompts';
import { extractXmlTag } from './response-parser';
import { getMathTagsFromDB, getTagsFromDB } from './tag-service';
import type { GeogebraAnalysisResult, ReanswerQuestionResult } from './types';

export async function buildAnalyzePrompt(
    language: 'zh' | 'en',
    grade: 7 | 8 | 9 | 10 | 11 | 12 | null | undefined,
    subject: string | null | undefined,
    gradeSemester: string | null | undefined,
) {
    const [math, physics, chemistry, biology, english] = await Promise.all([
        subject === '数学' || !subject ? getMathTagsFromDB(grade ?? null) : [],
        subject === '物理' || !subject ? getTagsFromDB('physics') : [],
        subject === '化学' || !subject ? getTagsFromDB('chemistry') : [],
        subject === '生物' || !subject ? getTagsFromDB('biology') : [],
        subject === '英语' || !subject ? getTagsFromDB('english') : [],
    ]);

    return generateAnalyzePrompt(language, grade, subject, {
        customTemplate: getAppConfig().prompts?.analyze,
        prefetchedMathTags: math,
        prefetchedPhysicsTags: physics,
        prefetchedChemistryTags: chemistry,
        prefetchedBiologyTags: biology,
        prefetchedEnglishTags: english,
    }, gradeSemester);
}

export function parseReanswerResponse(text: string): ReanswerQuestionResult {
    const answerText = extractXmlTag(text, 'answer_text') || '';
    const analysis = extractXmlTag(text, 'analysis') || '';
    const knowledgePoints = (extractXmlTag(text, 'knowledge_points') || '')
        .split(/[,，\n]/)
        .map(value => value.trim())
        .filter(Boolean);
    const wrongAnswerText = extractXmlTag(text, 'wrong_answer_text') || '';

    return {
        answerText,
        analysis,
        knowledgePoints,
        wrongAnswerText,
        mistakeAnalysis: extractXmlTag(text, 'mistake_analysis') || '',
        mistakeStatus: normalizeMistakeStatusForSave(extractXmlTag(text, 'mistake_status'), wrongAnswerText),
    };
}

export function parseGeogebraResponse(text: string): GeogebraAnalysisResult {
    const codeBlock = text.trim().match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = codeBlock?.[1].trim() ?? text.trim();
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    const parsed = JSON.parse(start >= 0 && end >= start ? candidate.slice(start, end + 1) : candidate);

    return {
        suitable: Boolean(parsed.suitable),
        commands: Array.isArray(parsed.commands) ? parsed.commands : [],
        description: parsed.description || '',
    };
}

export function mapAIError(error: unknown): Error {
    if (!(error instanceof Error)) return new Error('AI_UNKNOWN_ERROR');

    const existingCode = error.message.match(/^(AI_[A-Z_]+)/)?.[1];
    if (existingCode) return new Error(existingCode);

    const message = error.message.toLowerCase();
    if (message.includes('fetch failed') || message.includes('network') || message.includes('connect')) return new Error('AI_CONNECTION_FAILED');
    if (message.includes('timeout') || message.includes('timed out') || message.includes('aborted') || message.includes('408')) return new Error('AI_TIMEOUT_ERROR');
    if (message.includes('quota') || message.includes('额度') || message.includes('rate limit') || message.includes('429') || message.includes('too many')) return new Error('AI_QUOTA_EXCEEDED');
    if (message.includes('403') || message.includes('forbidden') || message.includes('permission')) return new Error('AI_PERMISSION_DENIED');
    if (message.includes('404') || message.includes('not found') || message.includes('does not exist')) return new Error('AI_NOT_FOUND');
    if (['500', '502', '503', '504', '无可用', 'overloaded', 'unavailable'].some(value => message.includes(value))) return new Error('AI_SERVICE_UNAVAILABLE');
    if (message.includes('invalid json') || message.includes('parse')) return new Error('AI_RESPONSE_ERROR');
    if (message.includes('api key') || message.includes('unauthorized') || message.includes('401')) return new Error('AI_AUTH_ERROR');
    return new Error('AI_UNKNOWN_ERROR');
}
