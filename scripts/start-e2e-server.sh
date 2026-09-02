#!/bin/sh
set -eu

E2E_DATA_DIR="/tmp/wrong-notebook-e2e"
SERVER_PID=""

cleanup() {
    if [ -n "$SERVER_PID" ]; then
        kill "$SERVER_PID" 2>/dev/null || true
        wait "$SERVER_PID" 2>/dev/null || true
    fi
    if [ -d "$E2E_DATA_DIR" ]; then
        find "$E2E_DATA_DIR" -depth -delete
    fi
}
trap cleanup EXIT INT TERM

if [ -d "$E2E_DATA_DIR" ]; then
    find "$E2E_DATA_DIR" -depth -delete
fi
mkdir -p "$E2E_DATA_DIR"

export DATABASE_URL="file:$E2E_DATA_DIR/e2e.db"
export APP_CONFIG_PATH="$E2E_DATA_DIR/app-config.json"
export NEXTAUTH_URL="http://127.0.0.1:3217"
export NEXTAUTH_SECRET="e2e-only-secret"

npx prisma db push --skip-generate
node scripts/seed-admin.js

if [ "${CI:-}" = "true" ]; then
    npm run start -- -p 3217 &
else
    npm run dev -- -p 3217 &
fi
SERVER_PID=$!
wait "$SERVER_PID"
