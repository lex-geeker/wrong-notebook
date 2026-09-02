import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("docker entrypoint", () => {
    it("stops startup when prisma migrate deploy fails", () => {
        const directory = mkdtempSync(join(tmpdir(), "wrong-notebook-entrypoint-"));
        const binDirectory = join(directory, "bin");
        const callLog = join(directory, "calls.log");

        try {
            mkdirSync(binDirectory);
            mkdirSync(join(directory, "data"));
            mkdirSync(join(directory, "config"));
            writeFileSync(join(directory, "VERSION"), "2.0.0\n");
            const entrypoint = join(directory, "docker-entrypoint.sh");
            writeFileSync(
                entrypoint,
                readFileSync(resolve("docker-entrypoint.sh"), "utf8").replaceAll("/app", directory)
            );
            writeFileSync(join(binDirectory, "chown"), "#!/bin/sh\nexit 0\n");
            writeFileSync(join(binDirectory, "node"), `#!/bin/sh
printf '%s\\n' "$*" >> "$ENTRYPOINT_CALL_LOG"
case "$*" in
    *"migrate deploy"*) exit 23 ;;
esac
`);
            chmodSync(entrypoint, 0o755);
            chmodSync(join(binDirectory, "chown"), 0o755);
            chmodSync(join(binDirectory, "node"), 0o755);

            const result = spawnSync("sh", [entrypoint, "app-command"], {
                encoding: "utf8",
                env: {
                    ...process.env,
                    PATH: `${binDirectory}:${process.env.PATH}`,
                    ENTRYPOINT_CALL_LOG: callLog,
                    HTTPS_ENABLED: "false",
                },
            });
            const calls = readFileSync(callLog, "utf8");

            expect(result.status).toBe(23);
            expect(result.stdout).toContain("Running database migrations");
            expect(result.stdout).not.toContain("Migrations completed successfully");
            expect(calls).toContain("migrate deploy");
            expect(calls).not.toContain("-p");
            expect(calls).not.toContain("seed-admin.js");
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });
});
