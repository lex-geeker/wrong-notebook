"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signOut } from "next-auth/react";
import { BarChart3, BookOpen, BrainCircuit, CalendarClock, Loader2, LogOut, Printer, Tags, Upload } from "lucide-react";
import { BroadcastNotification } from "@/components/broadcast-notification";
import { ErrorEntryFlow } from "@/components/error-entry-flow";
import { SettingsDialog } from "@/components/settings-dialog";
import { UserWelcome } from "@/components/user-welcome";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient, ApiError } from "@/lib/api-client";
import type { PracticeSource } from "@/lib/practice";
import type { Notebook, PracticeSessionData } from "@/types/api";

function HomeContent() {
    const { t, language } = useLanguage();
    const router = useRouter();
    const initialNotebookId = useSearchParams().get("notebook");
    const [notebooks, setNotebooks] = useState<Notebook[]>([]);
    const [reviewSubjectId, setReviewSubjectId] = useState("all");
    const [reviewSource, setReviewSource] = useState<PracticeSource>("variant");
    const [reviewLoading, setReviewLoading] = useState(false);
    const [reviewError, setReviewError] = useState("");

    useEffect(() => {
        apiClient.get<Notebook[]>("/api/notebooks")
            .then(setNotebooks)
            .catch(() => setNotebooks([]));
    }, []);

    const createDueReview = async () => {
        setReviewLoading(true);
        setReviewError("");
        try {
            const session = await apiClient.post<PracticeSessionData>("/api/practice/sessions", {
                mode: "ebbinghaus",
                questionSource: reviewSource,
                count: 5,
                language,
                filters: { subjectId: reviewSubjectId === "all" ? undefined : reviewSubjectId },
            });
            router.push(`/print-preview?sessionId=${session.id}&paper=1`);
        } catch (error) {
            const details = error instanceof ApiError && error.data && typeof error.data === "object" && "details" in error.data
                ? error.data.details
                : null;
            const noDue = details && typeof details === "object" && "reason" in details && details.reason === "NO_DUE_REVIEWS";
            setReviewError(noDue ? t.practice.batch.noDueSubject : t.practice.batch.createError);
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
                        <div className="grid gap-5 lg:grid-cols-[minmax(190px,1fr)_minmax(0,2fr)] lg:items-end">
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-background text-primary">
                                    <CalendarClock className="h-5 w-5" />
                                </div>
                                <div>
                                    <h2 id="due-review-title" className="text-lg font-semibold">{t.practice.batch.todayDue}</h2>
                                    <p className="text-sm text-muted-foreground">{t.practice.batch.todayDueCount}</p>
                                </div>
                            </div>
                            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
                                <div className="space-y-2">
                                    <Label htmlFor="due-review-subject">{t.practice.batch.subject}</Label>
                                    <Select value={reviewSubjectId} onValueChange={setReviewSubjectId}>
                                        <SelectTrigger id="due-review-subject"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">{t.practice.batch.allSubjects}</SelectItem>
                                            {notebooks.map(notebook => <SelectItem key={notebook.id} value={notebook.id}>{notebook.name}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="due-review-source">{t.practice.batch.source}</Label>
                                    <Select value={reviewSource} onValueChange={value => setReviewSource(value as PracticeSource)}>
                                        <SelectTrigger id="due-review-source"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="variant">{t.practice.batch.variant}</SelectItem>
                                            <SelectItem value="original">{t.practice.batch.original}</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <Button onClick={createDueReview} disabled={reviewLoading} className="h-10 sm:px-5">
                                    {reviewLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2 h-4 w-4" />}
                                    {reviewLoading ? t.practice.batch.starting : t.practice.batch.printToday}
                                </Button>
                            </div>
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
