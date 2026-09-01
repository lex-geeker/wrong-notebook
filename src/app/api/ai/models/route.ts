import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { isAdmin } from '@/lib/auth-utils';
import { forbidden, unauthorized } from '@/lib/api-errors';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:ai:models');

interface ModelInfo {
    id: string;
    name: string;
    owned_by?: string;
}

const requestSchema = z.object({
    provider: z.enum(['gemini', 'openai']),
    apiKey: z.string().trim().min(1).max(10_000),
    baseUrl: z.string().trim().max(2_000).optional(),
});

function validateBaseUrl(value: string) {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('Base URL must use HTTP or HTTPS');
    }
    return url.toString().replace(/\/$/, '');
}

// 从模型 ID 中提取短名称
function extractModelName(modelId: string): string {
    // models/gemini-2.0-flash -> gemini-2.0-flash
    return modelId.replace(/^models\//, '');
}

async function fetchGeminiModels(apiKey: string, baseUrl: string): Promise<ModelInfo[]> {
    const url = `${baseUrl}/v1beta/models`;

    const response = await fetch(url, {
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    });

    if (!response.ok) {
        const errorText = await response.text();
        logger.error({ status: response.status, errorText }, 'Gemini models API error');
        throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json() as { models?: Array<{ name: string }> };
    return (data.models || [])
        .map((m) => {
            const id = extractModelName(m.name);
            return {
                id,
                name: id,
                owned_by: 'Google',
            };
        });
}

async function fetchOpenAIModels(apiKey: string, baseUrl: string): Promise<ModelInfo[]> {
    const url = `${baseUrl}/models`;

    const response = await fetch(url, {
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
    });

    if (!response.ok) {
        logger.error({ statusText: response.statusText }, 'OpenAI models API error');
        throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json() as { data?: Array<{ id: string; owned_by?: string }> };

    return (data.data || [])
        .map((model) => ({
            id: model.id,
            name: model.id,
            owned_by: model.owned_by,
        }));
}

export async function POST(req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) return unauthorized();
        if (!isAdmin(session.user)) return forbidden();

        const parsed = requestSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json(
                { error: 'Invalid model request' },
                { status: 400 }
            );
        }
        const { provider, apiKey, baseUrl } = parsed.data;

        let effectiveBaseUrl: string;
        try {
            effectiveBaseUrl = validateBaseUrl(baseUrl || (provider === 'gemini'
                ? 'https://generativelanguage.googleapis.com'
                : 'https://api.openai.com/v1'));
        } catch {
            return NextResponse.json({ error: 'Base URL must use HTTP or HTTPS' }, { status: 400 });
        }

        let models: ModelInfo[] = [];

        if (provider === 'gemini') {
            models = await fetchGeminiModels(apiKey, effectiveBaseUrl);
        } else {
            // OpenAI-compatible
            models = await fetchOpenAIModels(apiKey, effectiveBaseUrl);
        }

        return NextResponse.json({ models });

    } catch (error: unknown) {
        logger.error({ error }, 'Error fetching models');
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Internal server error', models: [] },
            { status: 200 } // Return 200 with empty models to allow manual input
        );
    }
}
