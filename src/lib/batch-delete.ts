export type BatchDeleteResponse = {
    deleted: number;
    failed: string[];
};

export type BatchDeleteResult = {
    deletedCount: number;
    remainingIds: string[];
    error?: unknown;
};

export async function deleteIdsInBatches(
    ids: string[],
    deleteBatch: (ids: string[]) => Promise<BatchDeleteResponse>,
    batchSize = 100,
): Promise<BatchDeleteResult> {
    const remaining = new Set(ids);
    let deletedCount = 0;

    try {
        for (let index = 0; index < ids.length; index += batchSize) {
            const batch = ids.slice(index, index + batchSize);
            const result = await deleteBatch(batch);
            const failed = new Set(result.failed);
            batch.forEach((id) => {
                if (!failed.has(id)) remaining.delete(id);
            });
            deletedCount += result.deleted;
        }
        return { deletedCount, remainingIds: ids.filter((id) => remaining.has(id)) };
    } catch (error) {
        return { deletedCount, remainingIds: ids.filter((id) => remaining.has(id)), error };
    }
}
