"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";

export type ToastVariant = "info" | "success" | "error";

interface ToastItem {
    id: number;
    message: string;
    variant: ToastVariant;
}

interface ToastContextValue {
    showToast: (message: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const variants = {
    info: { icon: Info, className: "border-border", iconClassName: "text-foreground" },
    success: { icon: CheckCircle2, className: "border-green-600/30", iconClassName: "text-green-600" },
    error: { icon: CircleAlert, className: "border-destructive/40", iconClassName: "text-destructive" },
} satisfies Record<ToastVariant, { icon: typeof Info; className: string; iconClassName: string }>;

export function ToastProvider({ children }: { children: ReactNode }) {
    const { language } = useLanguage();
    const [toasts, setToasts] = useState<ToastItem[]>([]);
    const nextId = useRef(1);
    const timers = useRef(new Map<number, number>());

    const dismissToast = useCallback((id: number) => {
        const timer = timers.current.get(id);
        if (timer) window.clearTimeout(timer);
        timers.current.delete(id);
        setToasts(current => current.filter(toast => toast.id !== id));
    }, []);

    const showToast = useCallback((message: string, variant: ToastVariant = "info") => {
        if (!message) return;
        const id = nextId.current++;
        setToasts(current => [{ id, message, variant }, ...current]);
        timers.current.set(id, window.setTimeout(() => {
            timers.current.delete(id);
            setToasts(current => current.filter(toast => toast.id !== id));
        }, 3000));
    }, []);

    useEffect(() => () => {
        timers.current.forEach(timer => window.clearTimeout(timer));
        timers.current.clear();
    }, []);

    const value = useMemo(() => ({ showToast }), [showToast]);

    return (
        <ToastContext.Provider value={value}>
            {children}
            <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex flex-col items-center gap-2 px-4 pt-[max(1rem,env(safe-area-inset-top))]">
                {toasts.map(toast => {
                    const style = variants[toast.variant];
                    const Icon = style.icon;
                    return (
                        <div
                            key={toast.id}
                            role={toast.variant === "error" ? "alert" : "status"}
                            aria-atomic="true"
                            className={cn(
                                "pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-md border bg-background px-4 py-3 text-foreground shadow-lg animate-in fade-in slide-in-from-top-2 duration-200",
                                style.className,
                            )}
                        >
                            <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", style.iconClassName)} />
                            <span className="min-w-0 flex-1 break-words text-sm">{toast.message}</span>
                            <button
                                type="button"
                                className="shrink-0 rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                onClick={() => dismissToast(toast.id)}
                                title={language === "zh" ? "关闭" : "Close"}
                            >
                                <X className="h-4 w-4" />
                                <span className="sr-only">{language === "zh" ? "关闭" : "Close"}</span>
                            </button>
                        </div>
                    );
                })}
            </div>
        </ToastContext.Provider>
    );
}

export function useToast() {
    const context = useContext(ToastContext);
    if (!context) throw new Error("useToast must be used within ToastProvider");
    return context;
}
