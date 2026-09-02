import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-dropzone", () => ({
    useDropzone: () => ({
        getRootProps: () => ({}),
        getInputProps: () => ({}),
        isDragActive: false,
    }),
}));

vi.mock("@/contexts/LanguageContext", () => ({
    useLanguage: () => ({
        language: "en",
        t: {
            app: { analyzing: "Analyzing", dragDrop: "Drop" },
            common: { pleaseWait: "Wait" },
            upload: {
                analyze: "Upload",
                support: "Images",
                screenshot: "Screenshot",
                screenshotDesc: "Capture screen",
                screenshotNotSupported: "Unsupported",
                screenshotPermissionDenied: "Denied",
                screenshotFailed: "Failed",
            },
        },
    }),
}));

import { UploadZone } from "@/components/upload-zone";
import { ToastProvider } from "@/components/ui/toast";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("UploadZone screenshot cleanup", () => {
    let container: HTMLDivElement;
    let root: Root;
    const stop = vi.fn();
    const originalCreateElement = document.createElement.bind(document);

    beforeEach(async () => {
        vi.useFakeTimers();
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
        Object.defineProperty(navigator, "mediaDevices", {
            configurable: true,
            value: {
                getDisplayMedia: vi.fn().mockResolvedValue({
                    getVideoTracks: () => [{ getSettings: () => ({}) }],
                    getTracks: () => [{ stop }],
                }),
            },
        });
        await act(async () => root.render(
            <ToastProvider><UploadZone onImageSelect={vi.fn()} isAnalyzing={false} /></ToastProvider>,
        ));
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it.each(["video", "canvas", "blob"] as const)("stops all tracks after a %s failure", async failure => {
        vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => {
            if (tagName === "video") {
                const video = {
                    videoWidth: 100,
                    videoHeight: 100,
                    play: vi.fn().mockImplementation(() => failure === "video" ? Promise.reject(new Error("video failed")) : Promise.resolve()),
                    set onloadedmetadata(handler: (() => void) | null) {
                        if (handler) queueMicrotask(handler);
                    },
                };
                return video as unknown as HTMLVideoElement;
            }
            if (tagName === "canvas") {
                return {
                    width: 0,
                    height: 0,
                    getContext: () => failure === "canvas" ? null : { drawImage: vi.fn() },
                    toBlob: (callback: BlobCallback) => callback(null),
                } as unknown as HTMLCanvasElement;
            }
            return originalCreateElement(tagName);
        }) as typeof document.createElement);

        const button = container.querySelector("button");
        expect(button).not.toBeNull();
        await act(async () => {
            button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            await Promise.resolve();
            await vi.advanceTimersByTimeAsync(600);
        });

        expect(stop).toHaveBeenCalledOnce();
        expect(container.querySelector('[role="alert"]')?.textContent).toContain("Failed");
    });
});
