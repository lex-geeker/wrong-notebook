import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    get: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
    apiClient: { get: mocks.get },
}));

import { TagInput } from "@/components/tag-input";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("TagInput suggestions", () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(async () => {
        vi.useFakeTimers();
        mocks.get.mockResolvedValue({ suggestions: [], total: 0 });
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
        await act(async () => root.render(<TagInput value={[]} onChange={vi.fn()} />));
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
        vi.useRealTimers();
    });

    const enter = async (value: string) => {
        const input = container.querySelector("input")!;
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
    };

    it("debounces requests and aborts the previous one when input changes", async () => {
        await enter("方");
        await act(async () => vi.advanceTimersByTimeAsync(249));
        expect(mocks.get).not.toHaveBeenCalled();

        await act(async () => vi.advanceTimersByTimeAsync(1));
        expect(mocks.get).toHaveBeenCalledOnce();
        const firstSignal = mocks.get.mock.calls[0][1].signal as AbortSignal;

        await enter("方程");
        expect(firstSignal.aborted).toBe(true);
        await act(async () => vi.advanceTimersByTimeAsync(249));
        expect(mocks.get).toHaveBeenCalledOnce();

        await act(async () => vi.advanceTimersByTimeAsync(1));
        expect(mocks.get).toHaveBeenCalledTimes(2);
        expect(mocks.get.mock.calls[1][0]).toContain("q=%E6%96%B9%E7%A8%8B");
    });
});
