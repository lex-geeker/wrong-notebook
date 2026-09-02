import { expect, test } from "@playwright/test";

test("daily task notice is top-centered, temporary, and does not shift layout", async ({ page }) => {
    await page.route("**/api/learning-overview", route => route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
            today: { dueReviewCount: 0, unfinishedCount: 0 },
            activeSession: null,
            week: {
                completionDays: [],
                reviewedCount: 0,
                correctCount: 0,
                accuracy: 0,
                wrongCount: 0,
                topErrorTypes: [],
                weakTags: [],
            },
        }),
    }));
    await page.route("**/api/practice/sessions", async route => {
        if (route.request().method() !== "POST") return route.continue();
        await route.fulfill({
            status: 400,
            contentType: "application/json",
            body: JSON.stringify({ message: "No tasks are due today", details: { reason: "NO_DAILY_TASKS" } }),
        });
    });

    await page.goto("/login");
    await page.getByLabel(/邮箱|Email/).fill("admin@localhost");
    await page.getByLabel(/^密码$|^Password$/).fill("123456");
    await page.getByRole("button", { name: /登录|Login/ }).click();
    await page.waitForURL("**/");

    const task = page.locator('section[aria-labelledby="due-review-title"]');
    await expect(task.getByRole("button")).toBeEnabled();
    const heightBefore = await task.evaluate(element => element.getBoundingClientRect().height);

    await task.getByRole("button").click();
    const notice = page.getByRole("status").filter({ hasText: /今天没有到期的复习题|No reviews are due today/ });
    await expect(notice).toBeVisible();
    await expect(notice.locator("xpath=..")).toHaveClass(/fixed.*items-center/);
    await expect(task.getByRole("button")).toBeEnabled();
    expect(await task.evaluate(element => element.getBoundingClientRect().height)).toBe(heightBefore);
    await expect(notice).not.toBeVisible({ timeout: 4000 });
});
