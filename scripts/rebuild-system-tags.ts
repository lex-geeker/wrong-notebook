import { PrismaClient } from '@prisma/client';
import { rebuildSystemTags } from '../src/lib/rebuild-system-tags';

const prisma = new PrismaClient();

rebuildSystemTags(prisma)
    .then(result => console.log('[RebuildTags] Completed:', result))
    .catch(error => {
        console.error('[RebuildTags] Error:', error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
