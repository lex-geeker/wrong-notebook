import { expect, test } from '@playwright/test';

test('Filtered error data survives a full backup and daily sessions only resume today', async ({ page }) => {
    test.setTimeout(60_000);
    const marker = `e2e-backup-${Date.now()}`;

    const csrfResponse = await page.request.get('/api/auth/csrf');
    const { csrfToken } = await csrfResponse.json() as { csrfToken: string };
    const loginResponse = await page.request.post('/api/auth/callback/credentials', {
        form: { csrfToken, email: 'admin@localhost', password: '123456', callbackUrl: '/' },
    });
    expect(loginResponse.ok()).toBeTruthy();

    const notebooksResponse = await page.request.get('/api/notebooks');
    expect(notebooksResponse.ok()).toBeTruthy();
    const notebooks = await notebooksResponse.json() as Array<{ id: string; name: string }>;
    const notebook = notebooks[0];

    const createResponse = await page.request.post('/api/error-items', {
        data: {
            questionText: marker,
            answerText: '42',
            analysis: 'E2E backup analysis',
            knowledgePoints: [marker],
            originalImageUrl: '',
            subjectId: notebook.id,
            gradeSemester: 'E2E',
            paperLevel: 'a',
            source: 'homework',
        },
    });
    expect(createResponse.status()).toBe(201);
    const created = await createResponse.json() as { id: string; tags: Array<{ id: string }> };

    const filteredResponse = await page.request.get(`/api/error-items/list?query=${marker}&mastery=0&timeRange=week&paperLevel=a&page=1&pageSize=20`);
    expect(filteredResponse.ok()).toBeTruthy();
    expect(await filteredResponse.json()).toMatchObject({ total: 1, items: [{ id: created.id }] });

    const exportResponse = await page.request.get('/api/export?all=true');
    expect(exportResponse.ok()).toBeTruthy();
    const backup = await exportResponse.json() as {
        errorItems: Array<{ id: string; createdAt: string; updatedAt: string }>;
    };
    const exportedItem = backup.errorItems.find(item => item.id === created.id);
    expect(exportedItem).toBeDefined();
    exportedItem!.createdAt = '2026-01-01T00:00:00.000Z';
    exportedItem!.updatedAt = exportedItem!.createdAt;

    expect((await page.request.delete(`/api/error-items/${created.id}`)).ok()).toBeTruthy();
    expect((await page.request.post('/api/import?all=true', { data: backup })).ok()).toBeTruthy();

    const restoredResponse = await page.request.get(`/api/error-items/list?query=${marker}&page=1&pageSize=20`);
    expect(await restoredResponse.json()).toMatchObject({ total: 1, items: [{ id: created.id }] });

    const dailySettings = { mode: 'daily', questionSource: 'original', count: 5, language: 'zh' };
    const firstDaily = await page.request.post('/api/practice/sessions', { data: dailySettings });
    expect(firstDaily.status()).toBe(201);
    const firstSession = await firstDaily.json() as { id: string };
    const resumedDaily = await page.request.post('/api/practice/sessions', { data: dailySettings });
    expect(resumedDaily.status()).toBe(200);
    expect(await resumedDaily.json()).toMatchObject({ id: firstSession.id });

    await page.request.delete('/api/stats/practice/clear');
    await page.request.delete(`/api/error-items/${created.id}`);
    await page.request.delete(`/api/tags?id=${created.tags[0].id}`);
});
