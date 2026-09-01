const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export interface ParsedImagePayload {
    base64: string;
    mimeType: string;
    dataUrl: string;
}

export function parseImagePayload(value: unknown, declaredMimeType?: unknown): ParsedImagePayload {
    if (typeof value !== 'string' || !value) throw new Error('Missing image data');

    const match = value.match(/^data:([^;]+);base64,(.+)$/);
    const mimeType = match?.[1] || (typeof declaredMimeType === 'string' ? declaredMimeType : '');
    const base64 = match?.[2] || value;

    if (!ALLOWED_MIME_TYPES.has(mimeType)) throw new Error('Unsupported image type');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error('Invalid Base64 image data');
    if (Buffer.byteLength(base64, 'base64') > MAX_IMAGE_BYTES) throw new Error('Image exceeds the 2MB limit');

    return { base64, mimeType, dataUrl: `data:${mimeType};base64,${base64}` };
}

export function parseOptionalImagePayload(value: unknown, declaredMimeType?: unknown) {
    return value ? parseImagePayload(value, declaredMimeType) : null;
}
