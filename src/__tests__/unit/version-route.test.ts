import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    readFileSync: vi.fn(),
}));

vi.mock('fs', () => ({
    default: { readFileSync: mocks.readFileSync },
    readFileSync: mocks.readFileSync,
}));

import { GET } from '@/app/api/version/route';

describe('GET /api/version', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns the trimmed VERSION value', async () => {
        mocks.readFileSync.mockReturnValue('2.0.0\n');

        const response = await GET();

        expect(await response.json()).toEqual({ version: '2.0.0' });
        expect(mocks.readFileSync).toHaveBeenCalledWith(
            expect.stringMatching(/VERSION$/),
            'utf-8'
        );
    });

    it('returns unknown when VERSION cannot be read', async () => {
        mocks.readFileSync.mockImplementation(() => {
            throw new Error('missing');
        });

        const response = await GET();

        expect(await response.json()).toEqual({ version: 'unknown' });
    });
});
