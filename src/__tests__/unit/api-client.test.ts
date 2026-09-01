import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiClient } from '@/lib/api-client';

describe('api client', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('preserves a non-JSON error body after reading the response once', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('upstream failed', {
            status: 502,
            statusText: 'Bad Gateway',
        })));

        await expect(apiClient.get('/api/test')).rejects.toMatchObject({
            status: 502,
            data: 'upstream failed',
        });
    });

    it('keeps caller cancellation distinct from request timeout', async () => {
        const controller = new AbortController();
        const reason = new DOMException('cancelled by caller', 'AbortError');
        vi.stubGlobal('fetch', vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
        })));

        const pending = apiClient.get('/api/test', { signal: controller.signal });
        controller.abort(reason);

        await expect(pending).rejects.toBe(reason);
        expect(reason).not.toBeInstanceOf(ApiError);
    });
});
