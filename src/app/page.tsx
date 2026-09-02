"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signOut } from "next-auth/react";
import { BarChart3, BookOpen, BrainCircuit, CalendarClock, CheckCircle2, Loader2, LogOut, Printer, Tags, Upload } from "lucide-react";
import { BroadcastNotification } from "@/components/broadcast-notification";
import { ErrorEntryFlow } from "@/components/error-entry-flow";
import { SettingsDialog } from "@/components/settings-dialog";
import { UserWelcome } from "@/components/user-welcome";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient, ApiError } from "@/lib/api-client";
import type { LearningOverview, PracticeSessionData } from "@/types/api";

function HomeContent() {
    const { t, language } = useLanguage();
    const router = useRouter();
    const initialNotebookId = useSearchParams().get("notebook");
    const [overview, setOverview] = useState<LearningOverview | null>(null);
    const [reviewLoading, setReviewLoading] = useState(false);
    const [reviewError, setReviewError] = useState("");

    useEffect(() => {
        apiClient.get<LearningOverview>("/api/learning-overview")
            .then(setOverview)
            .catch(() => setOverview(null));
    }, []);

    const createDailyTask = async () => {
        setReviewLoading(true);
        setReviewError("");
        try {
            const session = await apiClient.post<PracticeSessionData>("/api/practice/sessions", {
                mode: "daily",
                questionSource: "variant",
                count: 5,
                language,
            });
            router.push(`/print-preview?sessionId=${session.id}&paper=1`);
        } catch (error) {
            const details = error instanceof ApiError && error.data && typeof error.data === "object" && "details" in error.data
                ? error.data.details
                : null;
            const noTask = details && typeof details === "object" && "reason" in details && details.reason === "NO_DAILY_TASKS";
            setReviewError(noTask
                ? (language === "zh" ? "今天没有到期的复习题。" : "No reviews are due today.")
                : t.practice.batch.createError);
        } finally {
            setReviewLoading(false);
        }
    };

    const navItems = [
        ["/notebooks", BookOpen, t.app.viewNotebook],
        ["/tags", Tags, t.app.tags || "Tags"],
        ["/stats", BarChart3, t.app.stats || "Stats"],
        ["/practice", BrainCircuit, t.practice.title],
    ] as const;

    return (
        <main className="min-h-screen bg-background">
            <div className="container mx-auto space-y-8 p-4 pb-20">
                <div className="flex items-start justify-between gap-4">
                    <UserWelcome />
                    <div className="flex shrink-0 items-center gap-2 rounded-lg border bg-card p-2 shadow-sm">
                        <BroadcastNotification />
                        <SettingsDialog />
                        <Button
                            variant="ghost"
                            size="icon"
                            className="rounded-full text-muted-foreground hover:text-destructive"
                            onClick={() => signOut({ callbackUrl: "/login" })}
                            title={t.app.logout || "Logout"}
                        >
                            <LogOut className="h-5 w-5" />
                        </Button>
                    </div>
                </div>

                {!initialNotebookId && (
                    <section aria-labelledby="due-review-title" className="border-y bg-muted/30 px-4 py-5 sm:px-6">
                        <div className="grid gap-5 lg:grid-cols-[minmax(220px,1fr)_minmax(0,2fr)_auto] lg:items-center">
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-background text-primary">
                                    <CalendarClock className="h-5 w-5" />
                                </div>
                                <div>
                                    <h2 id="due-review-title" className="text-lg font-semibold">{language === "zh" ? "今日任务" : "Today's task"}</h2>
                                    <p className="text-sm text-muted-foreground">{language === "zh" ? "每天复习最多 5 题" : "Review up to five questions a day"}</p>
                                </div>
                            </div>
                            <div className="grid grid-cols-3 divide-x text-center">
                                <div><strong className="block text-2xl">{overview?.today.dueReviewCount ?? "-"}</strong><span className="text-xs text-muted-foreground">{language === "zh" ? "到期复习" : "Due reviews"}</span></div>
                                <div><strong className="block text-2xl">{overview?.today.unfinishedCount ?? "-"}</strong><span className="text-xs text-muted-foreground">{language === "zh" ? "任务未完成" : "Unfinished"}</span></div>
                                <div><strong className="block text-2xl">{overview?.week.completionDays.length ?? "-"}</strong><span className="text-xs text-muted-foreground">{language === "zh" ? "本周完成" : "Days this week"}</span></div>
                            </div>
                            <Button onClick={createDailyTask} disabled={reviewLoading || !overview} className="h-11 whitespace-nowrap px-5">
                                {reviewLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : overview?.activeSession ? <Printer className="mr-2 h-4 w-4" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                                {reviewLoading
                                    ? t.practice.batch.starting
                                    : overview?.activeSession
                                        ? (language === "zh" ? "继续并打印今日复习" : "Continue and print")
                                        : (language === "zh" ? "生成并打印今日复习" : "Create and print today's review")}
                            </Button>
                        </div>
                        {reviewError && <p className="mt-3 text-sm text-destructive" role="alert">{reviewError}</p>}
                    </section>
                )}

                <div className={initialNotebookId ? "flex justify-center" : "grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5"}>
                    <a href="#error-entry" className={initialNotebookId ? "w-full max-w-md" : "w-full"}>
                        <Button size="lg" className="h-auto w-full py-4 text-base shadow-sm">
                            <Upload className="mr-2 h-5 w-5" />
                            {t.app.uploadNew}
                        </Button>
                    </a>
                    {!initialNotebookId && navItems.map(([href, Icon, label]) => (
                        <Link key={href} href={href} className="w-full">
                            <Button variant="outline" size="lg" className="h-auto w-full py-4 text-base shadow-sm hover:border-primary/50 hover:bg-accent/50">
                                <Icon className="mr-2 h-5 w-5" />
                                {label}
                            </Button>
                        </Link>
                    ))}
                </div>

                <ErrorEntryFlow
                    fixedNotebookId={initialNotebookId}
                    onSaved={subjectId => subjectId && router.push(`/notebooks/${subjectId}`)}
                />
            </div>
        </main>
    );
}

export default function Home() {
    return <Suspense fallback={<div>Loading...</div>}><HomeContent /></Suspense>;
}
