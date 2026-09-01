import { NextResponse } from "next/server";
import { getAppConfig, updateAppConfig } from "@/lib/config";
import { internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { OpenAIInstance } from "@/types/api";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/auth-utils";
import { forbidden, unauthorized } from "@/lib/api-errors";

const logger = createLogger('api:settings');

export const dynamic = 'force-dynamic';

function maskConfig(config: ReturnType<typeof getAppConfig>) {
    return {
        ...config,
        gemini: config.gemini ? { ...config.gemini, apiKey: config.gemini.apiKey ? "********" : "" } : config.gemini,
        openai: config.openai ? {
            ...config.openai,
            instances: (config.openai.instances || []).map((instance) => ({
                ...instance,
                apiKey: instance.apiKey ? "********" : "",
            })),
        } : config.openai,
        azure: config.azure ? { ...config.azure, apiKey: config.azure.apiKey ? "********" : "" } : config.azure,
    };
}

async function authorizeAdmin() {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return unauthorized();
    if (!isAdmin(session.user)) return forbidden();
    return session;
}

export async function GET() {
    const authorization = await authorizeAdmin();
    if (authorization instanceof NextResponse) return authorization;
    return NextResponse.json(maskConfig(getAppConfig()));
}

export async function POST(req: Request) {
    const authorization = await authorizeAdmin();
    if (authorization instanceof NextResponse) return authorization;

    try {
        const body = await req.json();
        const currentConfig = getAppConfig();

        // Don't save masked keys if they somehow get sent back (for Gemini)
        if (body.gemini?.apiKey === '********') {
            // 保留原有的 API Key
            body.gemini.apiKey = currentConfig.gemini?.apiKey;
        }

        // For OpenAI instances, preserve original keys for masked entries
        if (body.openai?.instances) {
            const currentInstances = currentConfig.openai?.instances || [];
            body.openai.instances = body.openai.instances.map((instance: OpenAIInstance) => {
                if (instance.apiKey === '********') {
                    // 查找原有实例并保留其 API Key
                    const originalInstance = currentInstances.find((i: OpenAIInstance) => i.id === instance.id);
                    return {
                        ...instance,
                        apiKey: originalInstance?.apiKey || '',
                    };
                }
                return instance;
            });
        }

        // For Azure, preserve original key if masked
        if (body.azure?.apiKey === '********') {
            body.azure.apiKey = currentConfig.azure?.apiKey;
        }

        const updatedConfig = updateAppConfig(body);
        return NextResponse.json(maskConfig(updatedConfig));
    } catch (error) {
        logger.error({ error }, 'Failed to update settings');
        return internalError("Failed to update settings");
    }
}


