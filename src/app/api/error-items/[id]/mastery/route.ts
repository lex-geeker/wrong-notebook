import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { unauthorized, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { z } from "zod";

const logger = createLogger('api:error-items:mastery');

export async function PATCH(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const session = await getServerSession(authOptions);

    try {
        let user;
        if (session?.user?.email) {
            user = await prisma.user.findUnique({
                where: { email: session.user.email },
            });
        }

        if (!user) {
            return unauthorized("Authentication required");
        }

        const parsed = z.object({ masteryLevel: z.number().int().min(0).max(2) }).safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: "masteryLevel must be 0, 1, or 2" }, { status: 400 });
        }
        const { masteryLevel } = parsed.data;

        // Verify ownership before update
        const existingItem = await prisma.errorItem.findFirst({
            where: { id, userId: user.id },
            select: { id: true },
        });

        if (!existingItem) {
            return NextResponse.json({ message: "Item not found" }, { status: 404 });
        }

        const errorItem = await prisma.errorItem.update({
            where: { id, userId: user.id },
            data: {
                masteryLevel,
            },
        });

        return NextResponse.json(errorItem);
    } catch (error) {
        logger.error({ error }, 'Error updating item');
        return internalError("Failed to update error item");
    }
}
