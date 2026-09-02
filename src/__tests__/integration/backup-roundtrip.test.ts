import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("version 5 backup round trip", () => {
    const getServerSession = vi.fn();
    const tempDir = mkdtempSync(join(tmpdir(), "wrong-notebook-backup-"));
    const databaseUrl = `file:${join(tempDir, "roundtrip.db")}`;
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    let exportBackup: (request: Request) => Promise<Response>;
    let importBackup: (request: Request) => Promise<Response>;
    let backup: Record<string, unknown>;

    beforeAll(async () => {
        execFileSync("npx", ["prisma", "db", "push", "--skip-generate"], {
            cwd: process.cwd(),
            env: { ...process.env, DATABASE_URL: databaseUrl },
            stdio: "pipe",
        });

        vi.doMock("next-auth", () => ({ getServerSession }));
        vi.doMock("@/lib/auth", () => ({ authOptions: {} }));
        vi.doMock("@/lib/prisma", () => ({ prisma }));
        ({ GET: exportBackup } = await import("@/app/api/export/route"));
        ({ POST: importBackup } = await import("@/app/api/import/route"));

        getServerSession.mockResolvedValue({
            user: { id: "admin", email: "admin@localhost", role: "admin" },
        });

        await prisma.user.createMany({
            data: [
                { id: "admin", email: "admin@localhost", password: "admin-hash", name: "Admin", role: "admin" },
                { id: "student", email: "student@example.com", password: "student-hash", name: "Student" },
            ],
        });
        await prisma.subject.create({ data: { id: "subject", name: "Math", userId: "student" } });
        await prisma.knowledgeTag.create({
            data: {
                id: "tag-parent",
                name: "Algebra",
                subject: "math",
                userId: "student",
                children: {
                    create: { id: "tag-child", name: "Linear equations", subject: "math", userId: "student" },
                },
            },
        });
        await prisma.errorItem.create({
            data: {
                id: "error",
                userId: "student",
                subjectId: "subject",
                originalImageUrl: "",
                questionText: "x + 1 = 2",
                answerText: "x = 1",
                tags: { connect: { id: "tag-child" } },
            },
        });
        await prisma.practiceSession.create({
            data: {
                id: "session",
                userId: "student",
                mode: "daily",
                questionSource: "original",
                items: {
                    create: {
                        id: "session-item",
                        errorItemId: "error",
                        position: 0,
                        sourceQuestionText: "x + 1 = 2",
                        sourceAnswerText: "x = 1",
                        questionText: "x + 1 = 2",
                        answerText: "x = 1",
                        record: {
                            create: { id: "record", userId: "student", errorItemId: "error", isCorrect: true },
                        },
                    },
                },
            },
        });
    }, 60_000);

    afterAll(async () => {
        await prisma.$disconnect();
        rmSync(tempDir, { recursive: true, force: true });
        vi.doUnmock("next-auth");
        vi.doUnmock("@/lib/auth");
        vi.doUnmock("@/lib/prisma");
    });

    it("exports, clears, and restores the complete entity graph", async () => {
        const exportResponse = await exportBackup(new Request("http://localhost/api/export?all=true"));
        expect(exportResponse.status).toBe(200);
        expect(exportResponse.headers.get("cache-control")).toBe("no-store");
        backup = await exportResponse.json();

        await prisma.user.deleteMany();
        const importResponse = await importBackup(new Request("http://localhost/api/import?all=true", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(backup),
        }));

        expect(importResponse.status).toBe(200);
        expect(await prisma.user.count()).toBe(2);
        expect(await prisma.subject.count()).toBe(1);
        expect(await prisma.knowledgeTag.count()).toBe(2);
        expect(await prisma.errorItem.count()).toBe(1);
        expect(await prisma.practiceSession.count()).toBe(1);
        expect(await prisma.practiceSessionItem.count()).toBe(1);
        expect(await prisma.practiceRecord.count()).toBe(1);

        const child = await prisma.knowledgeTag.findUnique({ where: { id: "tag-child" }, include: { parent: true } });
        expect(child?.parent?.id).toBe("tag-parent");
        const item = await prisma.errorItem.findUnique({ where: { id: "error" }, include: { user: true, subject: true, tags: true } });
        expect(item).toMatchObject({ user: { id: "student" }, subject: { id: "subject" }, tags: [{ id: "tag-child" }] });
        const sessionItem = await prisma.practiceSessionItem.findUnique({
            where: { id: "session-item" },
            include: { session: true, errorItem: true, record: true },
        });
        expect(sessionItem).toMatchObject({ session: { userId: "student" }, errorItem: { id: "error" }, record: { userId: "student" } });
        await expect(prisma.user.findUnique({ where: { id: "student" } })).resolves.toMatchObject({ password: "student-hash" });
    }, 60_000);

    it("rolls back every entity when a foreign key is unknown", async () => {
        await prisma.user.deleteMany();
        const invalid = structuredClone(backup) as { errorItems: Array<{ subjectId: string }> };
        invalid.errorItems[0].subjectId = "missing-subject";

        const response = await importBackup(new Request("http://localhost/api/import?all=true", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(invalid),
        }));

        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ message: expect.stringContaining("Unknown subject") });
        expect(await prisma.user.count()).toBe(0);
        expect(await prisma.subject.count()).toBe(0);
        expect(await prisma.knowledgeTag.count()).toBe(0);
    }, 60_000);
});
