import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { unauthorized } from "@/lib/api-errors";
import { getAppConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return unauthorized();

    const { timeouts } = getAppConfig();
    return NextResponse.json({ timeouts: { analyze: timeouts?.analyze } });
}
