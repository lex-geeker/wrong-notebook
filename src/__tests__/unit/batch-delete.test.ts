import { describe, expect, it, vi } from "vitest";
import { deleteIdsInBatches } from "@/lib/batch-delete";

describe("deleteIdsInBatches", () => {
    const ids = Array.from({ length: 201 }, (_, index) => `item-${index + 1}`);

    it("deletes sequential batches of at most 100 items", async () => {
        const deleteBatch = vi.fn(async (batch: string[]) => ({ deleted: batch.length, failed: [] }));

        const result = await deleteIdsInBatches(ids, deleteBatch);

        expect(deleteBatch.mock.calls.map(([batch]) => batch.length)).toEqual([100, 100, 1]);
        expect(result).toEqual({ deletedCount: 201, remainingIds: [] });
    });

    it("keeps every id selected when the first batch fails", async () => {
        const error = new Error("request failed");
        const result = await deleteIdsInBatches(ids, vi.fn().mockRejectedValue(error));

        expect(result).toEqual({ deletedCount: 0, remainingIds: ids, error });
    });

    it("keeps only unprocessed ids selected after a later batch fails", async () => {
        const error = new Error("request failed");
        const deleteBatch = vi.fn()
            .mockResolvedValueOnce({ deleted: 100, failed: [] })
            .mockRejectedValueOnce(error);

        const result = await deleteIdsInBatches(ids, deleteBatch);

        expect(result).toEqual({ deletedCount: 100, remainingIds: ids.slice(100), error });
    });
});
