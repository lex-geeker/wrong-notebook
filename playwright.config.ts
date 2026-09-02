import { defineConfig, devices } from '@playwright/test';

process.env.NO_PROXY = '127.0.0.1,localhost';
process.env.no_proxy = process.env.NO_PROXY;
const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
    testDir: './e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: 1,
    reporter: [['html', { host: '0.0.0.0' }]],
    use: {
        baseURL: 'http://127.0.0.1:3217',
        trace: 'on-first-retry',
    },
    webServer: {
        command: 'sh scripts/start-e2e-server.sh',
        url: 'http://127.0.0.1:3217',
        reuseExistingServer: false,
        timeout: 120 * 1000,
    },
    projects: [
        {
            name: 'chromium',
            use: {
                ...devices['Desktop Chrome'],
                launchOptions: chromiumExecutable ? { executablePath: chromiumExecutable } : undefined,
            },
        },
    ],
});
