const CHINA_OFFSET_MS = 8 * 60 * 60 * 1000;

export function chinaDateKey(date: Date) {
    return new Date(date.getTime() + CHINA_OFFSET_MS).toISOString().slice(0, 10);
}

export function chinaDayStart(now = new Date(), daysAgo = 0) {
    const shifted = new Date(now.getTime() + CHINA_OFFSET_MS);
    return new Date(Date.UTC(
        shifted.getUTCFullYear(),
        shifted.getUTCMonth(),
        shifted.getUTCDate() - daysAgo,
    ) - CHINA_OFFSET_MS);
}
