import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import { createErrorResponse, ErrorCode } from "@/lib/api-errors";
import { calculateGrade } from "@/lib/grade-calculator";
import { inferSubjectFromName } from "@/lib/knowledge-tags";
import { resolveKnowledgeTagConnections } from "@/lib/tag-recognition";
import { parseImagePayload } from "@/lib/image-payload";
import { ERROR_SOURCES, ERROR_TYPES, type ErrorSource, type ErrorType } from "@/lib/error-metadata";
import { compare } from "bcryptjs";
import { z } from "zod";

const logger = createLogger('api:openclaw:batch-upload');

const MAX_IMAGES = 20;
const uploadRequestSchema = z.object({
    username: z.string().min(1).optional(),
    password: z.string().min(1).optional(),
    userEmail: z.string().email().optional(),
    subjectId: z.string().min(1).optional(),
    images: z.array(z.object({
        base64: z.string(),
        mimeType: z.string(),
        filename: z.string().min(1),
    })).min(1).max(MAX_IMAGES),
});
const sourceSchema = z.unknown().optional().transform((value): ErrorSource =>
    typeof value === 'string' && ERROR_SOURCES.includes(value as ErrorSource) ? value as ErrorSource : 'other'
);
const errorTypeSchema = z.unknown().optional().transform((value): ErrorType | undefined =>
    value == null
        ? undefined
        : typeof value === 'string' && ERROR_TYPES.includes(value as ErrorType)
            ? value as ErrorType
            : 'other'
);
const openclawResponseSchema = z.object({
    success: z.boolean(),
    data: z.object({
        questionText: z.string(),
        answerText: z.string(),
        analysis: z.string(),
        knowledgePoints: z.array(z.string()),
        subject: z.string().optional(),
        errorType: errorTypeSchema,
        source: sourceSchema,
    }).optional(),
    error: z.string().optional(),
});
type OpenclawResponse = z.infer<typeof openclawResponseSchema>;

async function callOpenclawAgent(imageBase64: string, mimeType: string, timeout: number): Promise<OpenclawResponse> {
    const openclawUrl = process.env.OPENCLAW_API_URL || 'http://localhost:8080';
    const openclawApiKey = process.env.OPENCLAW_API_KEY || '';

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(`${openclawUrl}/api/recognize`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(openclawApiKey ? { 'Authorization': `Bearer ${openclawApiKey}` } : {}),
            },
            body: JSON.stringify({
                image: imageBase64,
                mimeType: mimeType,
            }),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            logger.error({ status: response.status, error: errorText }, 'Openclaw agent error');
            return {
                success: false,
                error: `识别服务异常: HTTP ${response.status}`,
            };
        }

        const parsed = openclawResponseSchema.safeParse(await response.json());
        if (!parsed.success) {
            logger.error({ issues: parsed.error.issues }, 'Invalid Openclaw agent response');
            return { success: false, error: '识别服务返回无效数据' };
        }
        return parsed.data;
    } catch (error: unknown) {
        clearTimeout(timeoutId);

        if (error instanceof Error && error.name === 'AbortError') {
            logger.error('Openclaw agent timeout');
            return {
                success: false,
                error: '识别服务超时',
            };
        }
        
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Openclaw agent request failed');
        return {
            success: false,
            error: `识别服务请求失败: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

async function createErrorItem(
    userId: string,
    imageDataUrl: string,
    parsedData: OpenclawResponse['data'],
    subjectId?: string
) {
    const { questionText, answerText, analysis, knowledgePoints, errorType, source } = parsedData || {};

    const tagNames: string[] = Array.isArray(knowledgePoints) ? knowledgePoints : [];

    const subject = subjectId ? await prisma.subject.findFirst({ where: { id: subjectId, userId } }) : null;
    if (subjectId && !subject) throw new Error('Invalid subject');
    const subjectKey = subject ? inferSubjectFromName(subject.name) : null;

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { educationStage: true, enrollmentYear: true }
    });

    let finalGradeSemester: string | null = null;
    if (user?.educationStage && user?.enrollmentYear) {
        finalGradeSemester = calculateGrade(user.educationStage, user.enrollmentYear);
    }

    const tagConnections = await resolveKnowledgeTagConnections({
        userId,
        gradeSemester: finalGradeSemester,
        subjectKey: subjectKey || 'other',
        tagNames,
    });

    const errorItem = await prisma.errorItem.create({
        data: {
            userId: userId,
            subjectId: subjectId || undefined,
            originalImageUrl: imageDataUrl,
            ocrText: questionText || null,
            questionText: questionText || null,
            answerText: answerText || null,
            analysis: analysis || null,
            gradeSemester: finalGradeSemester,
            paperLevel: null,
            errorType: errorType || null,
            source: source || 'other',
            masteryLevel: 0,
            tags: {
                connect: tagConnections,
            },
        },
        include: {
            tags: true,
            subject: true,
        },
    });

    return errorItem;
}

export async function POST(req: Request) {
    logger.info('POST /api/openclaw/batch-upload called');

    // 获取请求头中的 API Key
    const apiKey = req.headers.get('x-api-key');
    // 从环境变量获取配置的 API Key
    const expectedApiKey = process.env.OPENCLAW_INTEGRATION_API_KEY;
    // 认证模式：credentials（用户名密码，默认）或 apikey（API Key）
    const authMode = process.env.OPENCLAW_AUTH_MODE || 'credentials';

    let user = null;
    let userEmail = null;
    let subjectId = null;

    try {
        const parsedRequest = uploadRequestSchema.safeParse(await req.json().catch(() => undefined));
        if (!parsedRequest.success) {
            return createErrorResponse('无效请求数据', 400, ErrorCode.BAD_REQUEST, 'Invalid request data');
        }
        const requestData = parsedRequest.data;

        // 根据认证模式选择验证方式
        if (authMode === 'apikey' && expectedApiKey) {
            // API Key 认证模式
            if (!apiKey) {
                logger.warn('Missing API key in request');
                return createErrorResponse(
                    '未提供API密钥',
                    401,
                    ErrorCode.UNAUTHORIZED,
                    'Missing API key'
                );
            }

            if (apiKey !== expectedApiKey) {
                logger.warn('Invalid API key provided');
                return createErrorResponse(
                    'API密钥无效',
                    401,
                    ErrorCode.UNAUTHORIZED,
                    'Invalid API key'
                );
            }

            userEmail = requestData.userEmail;
            subjectId = requestData.subjectId;
            if (!userEmail) {
                return createErrorResponse('请提供用户邮箱', 400, ErrorCode.BAD_REQUEST, 'Missing user email');
            }
        } else {
            // 用户名密码认证模式（默认）
            const { username, password } = requestData;

            if (!username || !password) {
                return createErrorResponse(
                    '请提供用户名和密码',
                    401,
                    ErrorCode.UNAUTHORIZED,
                    'Missing username or password'
                );
            }

            // 从数据库查找用户（支持邮箱或用户名登录）
            user = await prisma.user.findFirst({
                where: {
                    OR: [
                        { email: username },
                        { name: username }
                    ]
                }
            });

            if (!user) {
                logger.warn({ username }, 'User not found');
                return createErrorResponse(
                    '用户不存在',
                    404,
                    ErrorCode.USER_NOT_FOUND,
                    'User not found'
                );
            }

            if (!user.isActive) {
                return createErrorResponse('Account is disabled', 403, ErrorCode.FORBIDDEN);
            }

            // 验证密码（使用 bcrypt 比对）
            const isPasswordValid = await compare(password, user.password);
            if (!isPasswordValid) {
                logger.warn({ username }, 'Invalid password');
                return createErrorResponse(
                    '密码错误',
                    401,
                    ErrorCode.UNAUTHORIZED,
                    'Invalid password'
                );
            }

            userEmail = user.email;
            subjectId = requestData.subjectId;
            logger.info({ userId: user.id, email: user.email }, 'User authenticated via credentials');
        }

        const { images } = requestData;

        // 获取用户信息（API Key模式需要单独查询）
        let dbUser = user;
        if (!dbUser) {
            dbUser = await prisma.user.findUnique({
                where: { email: userEmail },
            });
        }

        if (!dbUser) {
            logger.warn({ userEmail }, 'User not found');
            return createErrorResponse(
                '用户不存在',
                404,
                ErrorCode.USER_NOT_FOUND,
                'User not found'
            );
        }

        if (!dbUser.isActive) {
            return createErrorResponse('Account is disabled', 403, ErrorCode.FORBIDDEN);
        }

        const timeout = parseInt(process.env.OPENCLAW_TIMEOUT || '30000', 10);
        const singleImageTimeout = Math.min(3000, timeout / images.length);
        const results: Array<{
            success: boolean;
            index: number;
            errorItemId?: string;
            error?: string;
        }> = [];

        for (let i = 0; i < images.length; i++) {
            const imageData = images[i];
            const { base64, mimeType, filename } = imageData;

            let parsedImage;
            try {
                parsedImage = parseImagePayload(base64, mimeType);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                logger.warn({ index: i, filename, error: message }, 'Image validation failed');
                results.push({
                    success: false,
                    index: i,
                    error: message,
                });
                continue;
            }

            const openclawResponse = await callOpenclawAgent(parsedImage.base64, parsedImage.mimeType, singleImageTimeout);

            if (!openclawResponse.success || !openclawResponse.data) {
                logger.error({ index: i, error: openclawResponse.error }, 'Openclaw recognition failed');
                results.push({
                    success: false,
                    index: i,
                    error: openclawResponse.error || '识别失败',
                });
                continue;
            }

            try {
                const errorItem = await createErrorItem(
                    dbUser.id,
                    parsedImage.dataUrl,
                    openclawResponse.data,
                    subjectId
                );

                results.push({
                    success: true,
                    index: i,
                    errorItemId: errorItem.id,
                });

                logger.info({ index: i, errorItemId: errorItem.id }, 'Error item created successfully');
            } catch (dbError: unknown) {
                const message = dbError instanceof Error ? dbError.message : String(dbError);
                logger.error({ index: i, error: message }, 'Failed to create error item');
                results.push({
                    success: false,
                    index: i,
                    error: `数据库写入失败: ${message}`,
                });
            }
        }

        const successCount = results.filter(r => r.success).length;
        const failCount = results.length - successCount;

        logger.info({ 
            total: results.length, 
            success: successCount, 
            failed: failCount 
        }, 'Batch upload completed');

        const statusCode = failCount === 0 ? 201 : 207;

        return NextResponse.json({
            success: failCount === 0,
            total: results.length,
            successCount,
            failCount,
            results,
        }, { status: statusCode });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error({ error: message, stack: error instanceof Error ? error.stack : undefined }, 'Batch upload error');
        return createErrorResponse(
            message || '批量上传失败',
            500,
            ErrorCode.INTERNAL_ERROR,
            message
        );
    }
}
