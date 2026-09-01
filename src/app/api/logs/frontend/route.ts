import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';

const logger = createLogger('frontend-logs');

export const runtime = 'nodejs';

const entrySchema = z.object({
  level: z.enum(['info', 'warn', 'error']),
  prefix: z.string().max(200),
  message: z.string().max(2_000),
  context: z.record(z.string(), z.unknown()).optional().refine(
    (value) => !value || JSON.stringify(value).length <= 5_000,
    'Log context is too large',
  ),
  timestamp: z.string().max(100),
  url: z.string().max(2_000).optional(),
  userAgent: z.string().max(1_000).optional(),
});

/**
 * POST /api/logs/frontend
 *
 * Receives frontend logs and writes them to backend logger
 * Supports both single log and batch log formats.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ success: false }, { status: 401 });

    const body = await request.json();

    // 支持批量日志格式 { logs: [...] } 和单条日志格式
    const parsed = z.array(entrySchema).max(20).safeParse(Array.isArray(body.logs) ? body.logs : [body]);
    if (!parsed.success) return NextResponse.json({ success: false }, { status: 400 });
    const logs = parsed.data;

    for (const entry of logs) {
      const { level, prefix, message, context = {}, timestamp, url, userAgent } = entry;

      // Build log context
      const logContext = {
        source: 'frontend',
        prefix,
        url: url || request.headers.get('referer'),
        userAgent: userAgent || request.headers.get('user-agent'),
        clientTime: timestamp,
        ...context,
      };

      // Log to backend using appropriate level
      switch (level) {
        case 'error':
          logger.error(logContext, message);
          break;
        case 'warn':
          logger.warn(logContext, message);
          break;
        case 'info':
        default:
          logger.info(logContext, message);
          break;
      }
    }

    return NextResponse.json({ success: true, count: logs.length });
  } catch (error) {
    logger.error({ error }, 'Failed to process frontend log');
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
