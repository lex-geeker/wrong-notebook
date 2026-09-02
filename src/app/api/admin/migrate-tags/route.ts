import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { forbidden, internalError, unauthorized } from '@/lib/api-errors';
import { createLogger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { rebuildSystemTags } from '@/lib/rebuild-system-tags';

const logger = createLogger('api:admin:migrate-tags');

export async function POST() {
    const session = await getServerSession(authOptions);
    if (!session?.user) return unauthorized();
    if (session.user.role !== 'admin') return forbidden('Admin access required for tag migration');

    try {
        logger.info({ userId: session.user.id }, 'Tag migration initiated');
        const result = await rebuildSystemTags(prisma);
        logger.info({ ...result }, 'Tag migration completed');

        return NextResponse.json({
            success: true,
            ...result,
            message: 'Tag migration complete with associations preserved',
        });
    } catch (error) {
        logger.error({ error }, 'Tag migration error');
        return internalError('Failed to migrate tags');
    }
}
