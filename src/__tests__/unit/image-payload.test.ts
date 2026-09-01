import { describe, expect, it } from 'vitest';
import { parseImagePayload } from '@/lib/image-payload';

describe('image payload validation', () => {
    it.each(['image/jpeg', 'image/png', 'image/webp'])('accepts %s data URLs', (mimeType) => {
        expect(parseImagePayload(`data:${mimeType};base64,dGVzdA==`)).toMatchObject({ mimeType });
    });

    it('rejects unsupported types, invalid Base64, and decoded data over 2 MiB', () => {
        expect(() => parseImagePayload('data:image/gif;base64,dGVzdA==')).toThrow('Unsupported image type');
        expect(() => parseImagePayload('data:image/png;base64,not-base64!')).toThrow('Invalid Base64');
        const oversized = Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64');
        expect(() => parseImagePayload(`data:image/png;base64,${oversized}`)).toThrow('2MB');
    });
});
