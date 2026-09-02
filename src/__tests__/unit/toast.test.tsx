import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/LanguageContext", () => ({
    useLanguage: () => ({ language: "en" }),
}));

import { ToastProvider, useToast } from "@/components/ui/toast";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Triggers() {
    const { showToast } = useToast();
    return (
        <>
            <button data-toast="info" onClick={() => showToast("Notice", "info")}>Info</button>
            <button data-toast="success" onClick={() => showToast("Saved", "success")}>Success</button>
            <button data-toast="error" onClick={() => showToast("Failed", "error")}>Error</button>
        </>
    );
}

describe("ToastProvider", () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(async () => {
        vi.useFakeTimers();
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
        await act(async () => root.render(<ToastProvider><Triggers /></ToastProvider>));
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
        vi.useRealTimers();
    });

    const click = async (variant: "info" | "success" | "error") => {
        await act(async () => {
            container.querySelector<HTMLButtonElement>(`[data-toast="${variant}"]`)?.click();
        });
    };

    it("stacks newest messages first with accessible roles", async () => {
        await click("info");
        await click("success");
        await click("error");

        expect([...container.querySelectorAll('[role="alert"], [role="status"]')].map(node => node.textContent)).toEqual([
            "FailedClose",
            "SavedClose",
            "NoticeClose",
        ]);
        expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
        expect(container.querySelectorAll('[role="status"]')).toHaveLength(2);
        expect(container.querySelector('[role="alert"]')?.parentElement?.className).toContain("fixed");
    });

    it("dismisses each message three seconds after it was shown", async () => {
        await click("info");
        await act(async () => vi.advanceTimersByTimeAsync(1000));
        await click("error");
        await act(async () => vi.advanceTimersByTimeAsync(2000));

        expect(container.textContent).not.toContain("Notice");
        expect(container.textContent).toContain("Failed");

        await act(async () => vi.advanceTimersByTimeAsync(1000));
        expect(container.querySelector('[role="alert"]')).toBeNull();
    });

    it("allows one message to be closed without removing the stack", async () => {
        const clearTimeout = vi.spyOn(window, "clearTimeout");
        await click("info");
        await click("error");

        await act(async () => {
            container.querySelector<HTMLElement>('[role="alert"] button')?.click();
        });

        expect(container.textContent).not.toContain("Failed");
        expect(container.textContent).toContain("Notice");
        expect(clearTimeout).toHaveBeenCalled();
    });
});
