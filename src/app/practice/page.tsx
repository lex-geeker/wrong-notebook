"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
    ArrowLeft,
    Check,
    CheckCircle2,
    ChevronLeft,
    ChevronRight,
    House,
    Loader2,
    Play,
    Printer,
    RotateCcw,
    Sparkles,
    Target,
    XCircle,
} from "lucide-react";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLanguage } from "@/contexts/LanguageContext";
import { ApiError, apiClient } from "@/lib/api-client";
import { PRACTICE_COUNTS, type PracticeCount, type PracticeMode, type PracticeSource } from "@/lib/practice";
import type { Notebook, PracticeSessionData, PracticeSessionSummary } from "@/types/api";

export const dynamic = "force-dynamic";

type AnswerResponse = {
    status: "graded" | "needs_self_assessment";
    answer: NonNullable<PracticeSessionData["items"][number]["answer"]>;
    masteryLevel: number | null;
    endedAt: string | null;
};

type PaperResult = {
    isCorrect?: boolean;
};

function apiMessage(cause: unknown, fallback: string) {
    if (cause instanceof ApiError && cause.data && typeof cause.data === "object" && "message" in cause.data) {
        return String(cause.data.message);
    }
    return fallback;
}

function hasErrorReason(cause: unknown, reason: string) {
    if (!(cause instanceof ApiError) || !cause.data || typeof cause.data !== "object" || !("details" in cause.data)) {
        return false;
    }
    const details = cause.data.details;
    return Boolean(details && typeof details === "object" && "reason" in details && details.reason === reason);
}

function PracticeContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const errorItemId = searchParams.get("id") || undefined;
    const paperSessionId = searchParams.get("sessionId") || undefined;
    const paperMode = searchParams.get("paper") === "1" && Boolean(paperSessionId);
    const { t, language } = useLanguage();
    const { showToast } = useToast();
    const copy = t.practice.batch;

    const [notebooks, setNotebooks] = useState<Notebook[]>([]);
    const [history, setHistory] = useState<PracticeSessionSummary[]>([]);
    const [mode, setMode] = useState<PracticeMode>("random");
    const [source, setSource] = useState<PracticeSource>(errorItemId ? "variant" : "original");
    const [count, setCount] = useState<PracticeCount>(5);
    const [subjectId, setSubjectId] = useState("all");
    const [session, setSession] = useState<PracticeSessionData | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const [answers, setAnswers] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(paperMode);
    const [submitting, setSubmitting] = useState(false);
    const [showReview, setShowReview] = useState(false);
    const [paperResults, setPaperResults] = useState<Record<string, PaperResult>>({});
    const [paperSaved, setPaperSaved] = useState(false);

    const refreshHistory = () => apiClient.get<PracticeSessionSummary[]>("/api/practice/sessions")
        .then(setHistory)
        .catch(() => setHistory([]));

    useEffect(() => {
        const requests: Promise<unknown>[] = [
            apiClient.get<Notebook[]>("/api/notebooks").then(setNotebooks),
            refreshHistory(),
        ];
        if (paperMode && paperSessionId) {
            requests.push(apiClient.get<PracticeSessionData>(`/api/practice/sessions/${paperSessionId}?includeAnswers=1`)
                .then((data) => {
                    setSession(data);
                    setPaperResults(Object.fromEntries(data.items
                        .filter((item) => item.answer?.isCorrect !== null && item.answer?.isCorrect !== undefined)
                        .map((item) => [item.id, { isCorrect: item.answer!.isCorrect! }] as const)));
                    setPaperSaved(Boolean(data.endedAt));
                })
                .catch((cause: unknown) => showToast(apiMessage(cause, language === "zh" ? "无法加载纸上练习。" : "Could not load paper practice."), "error"))
                .finally(() => setLoading(false)));
        }
        Promise.all(requests).catch(() => undefined);
    }, [language, paperMode, paperSessionId, showToast]);

    const currentItem = session?.items[activeIndex];
    const finished = Boolean(session && session.answeredCount === session.itemCount);
    const progress = session ? (session.answeredCount / session.itemCount) * 100 : 0;
    const currentAnswer = currentItem
        ? answers[currentItem.id] ?? currentItem.answer?.answerInput ?? ""
        : "";
    const modeLabels: Record<string, string> = {
        random: copy.random,
        unmastered: copy.unmastered,
        ebbinghaus: copy.ebbinghaus,
        daily: language === "zh" ? "今日任务" : "Daily task",
        knowledge: copy.legacyKnowledge,
    };

    async function startPractice() {
        setLoading(true);
        try {
            const data = await apiClient.post<PracticeSessionData>("/api/practice/sessions", {
                mode,
                questionSource: source,
                count,
                language,
                errorItemId,
                filters: {
                    subjectId: subjectId === "all" ? undefined : subjectId,
                    mastery: mode === "unmastered" ? "all" : undefined,
                },
            });
            setSession(data);
            setActiveIndex(0);
            setAnswers({});
            setShowReview(false);
        } catch (cause: unknown) {
            const noDue = hasErrorReason(cause, "NO_DUE_REVIEWS");
            showToast(noDue ? copy.noDue : apiMessage(cause, copy.createError), noDue ? "info" : "error");
        } finally {
            setLoading(false);
        }
    }

    async function openSession(id: string, includeAnswers = false) {
        setLoading(true);
        try {
            const data = await apiClient.get<PracticeSessionData>(`/api/practice/sessions/${id}${includeAnswers ? "?includeAnswers=1" : ""}`);
            setSession(data);
            if (includeAnswers) {
                setPaperResults(Object.fromEntries(data.items
                    .filter((item) => item.answer?.isCorrect !== null && item.answer?.isCorrect !== undefined)
                    .map((item) => [item.id, { isCorrect: item.answer!.isCorrect! }] as const)));
                setPaperSaved(Boolean(data.endedAt));
            }
            const next = data.items.findIndex((item) => !item.answer || item.answer.isCorrect === null);
            setActiveIndex(next < 0 ? 0 : next);
            setShowReview(false);
        } catch (cause: unknown) {
            showToast(apiMessage(cause, copy.loadError), "error");
        } finally {
            setLoading(false);
        }
    }

    async function savePaperResults() {
        if (!session || !session.items.every((item) => typeof paperResults[item.id]?.isCorrect === "boolean")) return;
        setSubmitting(true);
        try {
            const data = await apiClient.patch<PracticeSessionData>(`/api/practice/sessions/${session.id}`, {
                paperResults: session.items.map((item) => ({ itemId: item.id, ...paperResults[item.id] })),
            });
            setSession(data);
            setPaperSaved(true);
            refreshHistory();
        } catch (cause: unknown) {
            showToast(apiMessage(cause, copy.paperSaveError), "error");
        } finally {
            setSubmitting(false);
        }
    }

    async function submitAnswer() {
        if (!session || !currentItem || !currentAnswer.trim() || currentItem.answer) return;
        setSubmitting(true);
        try {
            const result = await apiClient.post<AnswerResponse>(
                `/api/practice/sessions/${session.id}/answer`,
                { action: "submit", itemId: currentItem.id, answerInput: currentAnswer },
            );
            const finalized = result.answer.isCorrect !== null;
            setSession((current) => current && ({
                ...current,
                endedAt: result.endedAt || current.endedAt,
                answeredCount: current.answeredCount + Number(finalized),
                correctCount: current.correctCount + Number(result.answer.isCorrect),
                items: current.items.map((item) => item.id === currentItem.id
                    ? { ...item, answer: result.answer }
                    : item),
            }));
            if (result.endedAt) refreshHistory();
        } catch (cause: unknown) {
            showToast(apiMessage(cause, copy.submitError), "error");
        } finally {
            setSubmitting(false);
        }
    }

    async function assessAnswer(isCorrect: boolean) {
        if (!session || !currentItem || currentItem.answer?.isCorrect !== null) return;
        setSubmitting(true);
        try {
            const result = await apiClient.post<AnswerResponse>(
                `/api/practice/sessions/${session.id}/answer`,
                { action: "assess", itemId: currentItem.id, isCorrect },
            );
            setSession((current) => current && ({
                ...current,
                endedAt: result.endedAt || current.endedAt,
                answeredCount: current.answeredCount + 1,
                correctCount: current.correctCount + Number(result.answer.isCorrect),
                items: current.items.map((item) => item.id === currentItem.id
                    ? { ...item, answer: result.answer }
                    : item),
            }));
            if (result.endedAt) refreshHistory();
        } catch (cause: unknown) {
            showToast(apiMessage(cause, copy.submitError), "error");
        } finally {
            setSubmitting(false);
        }
    }

    function leaveSession() {
        setSession(null);
        setShowReview(false);
        refreshHistory();
    }

    if (paperMode && !session) {
        return (
            <main className="flex min-h-screen items-center justify-center bg-background p-6">
                {loading
                    ? <Loader2 className="h-7 w-7 animate-spin" />
                    : <Link href="/"><Button><House className="mr-2 h-4 w-4" />{copy.backHome}</Button></Link>}
            </main>
        );
    }

    if (paperMode && session) {
        const markedCount = session.items.filter((item) => typeof paperResults[item.id]?.isCorrect === "boolean").length;
        const allMarked = session.items.every((item) => typeof paperResults[item.id]?.isCorrect === "boolean");
        const correctCount = Object.values(paperResults).filter((result) => result.isCorrect).length;

        if (paperSaved) {
            return (
                <main className="min-h-screen bg-background p-4 md:p-8">
                    <div className="mx-auto max-w-2xl border-y py-14 text-center">
                        <CheckCircle2 className="mx-auto h-12 w-12 text-green-600" />
                        <h1 className="mt-5 text-2xl font-bold">{copy.paperSaved}</h1>
                        <p className="mt-3 text-muted-foreground">{correctCount} / {session.itemCount} {copy.correctShort}</p>
                        <Link href="/" className="mt-8 inline-block">
                            <Button><House className="mr-2 h-4 w-4" />{copy.backHome}</Button>
                        </Link>
                    </div>
                </main>
            );
        }

        return (
            <main className="min-h-screen bg-background pb-24">
                <header className="border-b bg-card">
                    <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-4">
                        <Link href={`/print-preview?sessionId=${session.id}&paper=1`}>
                            <Button variant="ghost" size="icon" title={t.common.back || "Back"}>
                                <ArrowLeft className="h-5 w-5" />
                            </Button>
                        </Link>
                        <div className="min-w-0 flex-1">
                            <h1 className="text-xl font-bold">{copy.paperGradingTitle}</h1>
                            <p className="text-sm text-muted-foreground">
                                {copy.paperGradingProgress.replace("{marked}", String(markedCount)).replace("{total}", String(session.itemCount))}
                            </p>
                        </div>
                    </div>
                </header>

                <div className="mx-auto max-w-4xl divide-y border-b px-4">
                    {session.items.map((item, index) => {
                        const result = paperResults[item.id];
                        const marked = typeof result?.isCorrect === "boolean";
                        return (
                            <section key={item.id} className="py-7">
                                <div className="mb-4 flex items-center justify-between gap-3">
                                    <h2 className="font-semibold">{copy.question} {index + 1}</h2>
                                    {marked && (
                                        <Badge variant="outline" className={result.isCorrect ? "text-green-700" : "text-red-700"}>
                                            {result.isCorrect ? copy.paperCorrect : copy.paperIncorrect}
                                        </Badge>
                                    )}
                                </div>
                                <MarkdownRenderer content={item.questionText} className="leading-7" />
                                <div className="mt-5 rounded-md bg-muted px-4 py-4">
                                    <p className="mb-2 text-xs font-semibold text-muted-foreground">{copy.expectedAnswer}</p>
                                    <MarkdownRenderer content={item.expectedAnswer || item.answer?.expectedAnswer || ""} />
                                </div>
                                <div className="mt-4 grid grid-cols-2 gap-3" role="group" aria-label={`${copy.question} ${index + 1}`}>
                                    <Button
                                        type="button"
                                        variant={marked && result.isCorrect === false ? "destructive" : "outline"}
                                        aria-pressed={marked && result.isCorrect === false}
                                        onClick={() => setPaperResults((current) => ({ ...current, [item.id]: { ...current[item.id], isCorrect: false } }))}
                                    >
                                        <XCircle className="mr-2 h-4 w-4" />{copy.paperIncorrect}
                                    </Button>
                                    <Button
                                        type="button"
                                        variant={marked && result.isCorrect === true ? "default" : "outline"}
                                        aria-pressed={marked && result.isCorrect === true}
                                        onClick={() => setPaperResults((current) => ({ ...current, [item.id]: { ...current[item.id], isCorrect: true } }))}
                                    >
                                        <CheckCircle2 className="mr-2 h-4 w-4" />{copy.paperCorrect}
                                    </Button>
                                </div>
                            </section>
                        );
                    })}
                </div>

                <footer className="fixed inset-x-0 bottom-0 border-t bg-background/95 px-4 py-3 backdrop-blur">
                    <div className="mx-auto max-w-4xl">
                        <Button className="h-11 w-full" onClick={savePaperResults} disabled={!allMarked || submitting}>
                            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {submitting ? copy.submitting : copy.paperSave}
                        </Button>
                    </div>
                </footer>
            </main>
        );
    }

    if (session && finished && !showReview) {
        const percent = Math.round((session.correctCount / session.itemCount) * 100);
        return (
            <main className="min-h-screen bg-background p-4 md:p-8">
                <div className="mx-auto max-w-3xl space-y-6">
                    <header className="flex items-center justify-between">
                        <Button variant="ghost" size="icon" onClick={leaveSession} title={copy.again}>
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                        <div className="flex items-center gap-1">
                            <Link href={`/print-preview?sessionId=${session.id}`}>
                                <Button variant="ghost" size="icon" title={t.printPreview.printButton}>
                                    <Printer className="h-5 w-5" />
                                </Button>
                            </Link>
                            <Link href="/">
                                <Button variant="ghost" size="icon" title={copy.home}>
                                    <House className="h-5 w-5" />
                                </Button>
                            </Link>
                        </div>
                    </header>

                    <Card className="gap-0">
                        <CardContent className="px-6 py-10 text-center md:py-12">
                            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300">
                                <CheckCircle2 className="h-7 w-7" />
                            </div>
                            <p className="mb-2 text-sm font-medium text-green-700 dark:text-green-300">{copy.complete}</p>
                            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{copy.resultTitle}</h1>
                            <div className="mt-7 font-mono text-5xl font-semibold tabular-nums">
                                {percent}<span className="text-xl text-muted-foreground">%</span>
                            </div>
                            <p className="mt-2 text-sm text-muted-foreground">
                                {session.correctCount} / {session.itemCount} {copy.correctShort}
                            </p>
                        </CardContent>
                    </Card>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Button variant="outline" size="lg" onClick={() => setShowReview(true)}>
                            <Check className="mr-2 h-4 w-4" />{copy.review}
                        </Button>
                        <Button size="lg" onClick={leaveSession}>
                            <RotateCcw className="mr-2 h-4 w-4" />{copy.again}
                        </Button>
                    </div>
                </div>
            </main>
        );
    }

    if (session && currentItem) {
        const answered = currentItem.answer;
        const atLast = activeIndex === session.items.length - 1;
        return (
            <main className="min-h-screen bg-background">
                <header className="border-b bg-card">
                    <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-4">
                        <Button variant="ghost" size="icon" onClick={leaveSession} title={copy.exit}>
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                        <div className="min-w-0 flex-1">
                            <div className="mb-2 flex justify-between gap-4 text-xs font-medium text-muted-foreground">
                                <span>{copy.question} {activeIndex + 1} / {session.itemCount}</span>
                                <span>{session.answeredCount} {copy.answered}</span>
                            </div>
                            <Progress value={progress} className="h-2" />
                        </div>
                        <div className="flex items-center gap-1">
                            <Link href={`/print-preview?sessionId=${session.id}`}>
                                <Button variant="ghost" size="icon" title={t.printPreview.printButton}>
                                    <Printer className="h-5 w-5" />
                                </Button>
                            </Link>
                            <Link href="/">
                                <Button variant="ghost" size="icon" title={copy.home}>
                                    <House className="h-5 w-5" />
                                </Button>
                            </Link>
                        </div>
                    </div>
                </header>

                <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 md:py-10">
                    <nav className="flex flex-wrap gap-2" aria-label={copy.progress}>
                        {session.items.map((item, index) => (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() => setActiveIndex(index)}
                                className={`flex h-9 w-9 items-center justify-center rounded-md border text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                                    index === activeIndex
                                        ? "border-primary bg-primary text-primary-foreground"
                                        : item.answer?.isCorrect
                                            ? "border-green-300 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300"
                                        : item.answer?.isCorrect === false
                                                ? "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
                                                : "bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                                }`}
                                aria-current={index === activeIndex ? "step" : undefined}
                            >
                                {index + 1}
                            </button>
                        ))}
                    </nav>

                    <Card className="gap-0">
                        <CardHeader className="border-b">
                            <div className="flex items-center justify-between gap-3">
                                <Badge variant="outline" className="font-normal">
                                    {currentItem.generationMode === "variant" ? <Sparkles className="h-3 w-3" /> : null}
                                    {copy[currentItem.generationMode as "original" | "variant" | "fallback"] || copy.original}
                                </Badge>
                                <span className="font-mono text-xs text-muted-foreground">
                                    {String(activeIndex + 1).padStart(2, "0")}
                                </span>
                            </div>
                        </CardHeader>
                        <CardContent className="px-5 py-8 md:px-10 md:py-10">
                            <MarkdownRenderer content={currentItem.questionText} className="text-base leading-8 md:text-lg" />
                        </CardContent>
                    </Card>

                    <section className="space-y-2">
                        <Label htmlFor="practice-answer" className="font-semibold">{copy.yourAnswer}</Label>
                        <div className="flex flex-col gap-3 sm:flex-row">
                            <Input
                                id="practice-answer"
                                value={currentAnswer}
                                onChange={(event) => setAnswers((current) => ({ ...current, [currentItem.id]: event.target.value }))}
                                onKeyDown={(event) => { if (event.key === "Enter") submitAnswer(); }}
                                placeholder={copy.answerPlaceholder}
                                disabled={Boolean(answered) || submitting}
                                className="h-12 bg-card text-base"
                                autoFocus={!answered}
                            />
                            {!answered && (
                                <Button className="h-12 shrink-0 px-6" onClick={submitAnswer} disabled={!currentAnswer.trim() || submitting}>
                                    {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                                    {submitting ? copy.submitting : copy.submit}
                                </Button>
                            )}
                        </div>
                    </section>

                    {answered && (
                        <Card className={`gap-0 ${answered.isCorrect === null
                            ? "border-amber-300 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/40"
                            : answered.isCorrect
                            ? "border-green-300 bg-green-50/60 dark:border-green-900 dark:bg-green-950/40"
                            : "border-red-300 bg-red-50/60 dark:border-red-900 dark:bg-red-950/40"}`}>
                            <CardContent className="px-5 py-5">
                                {answered.isCorrect !== null && (
                                    <div className="flex items-center gap-2 font-semibold">
                                        {answered.isCorrect
                                            ? <CheckCircle2 className="h-5 w-5 text-green-700 dark:text-green-300" />
                                            : <XCircle className="h-5 w-5 text-red-700 dark:text-red-300" />}
                                        {answered.isCorrect ? copy.correct : copy.incorrect}
                                    </div>
                                )}
                                <div className="mt-4 border-t border-border pt-4">
                                    <p className="mb-2 text-xs font-semibold text-muted-foreground">{copy.expectedAnswer}</p>
                                    <MarkdownRenderer content={answered.expectedAnswer} />
                                </div>
                                {answered.isCorrect === null && (
                                    <div className="mt-4 grid grid-cols-2 gap-3">
                                        <Button variant="outline" onClick={() => assessAnswer(false)} disabled={submitting}>
                                            <XCircle className="mr-2 h-4 w-4" />{language === "zh" ? "答错了" : "I was wrong"}
                                        </Button>
                                        <Button onClick={() => assessAnswer(true)} disabled={submitting}>
                                            <CheckCircle2 className="mr-2 h-4 w-4" />{language === "zh" ? "答对了" : "I was correct"}
                                        </Button>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    )}

                    <footer className="flex items-center justify-between border-t pt-5">
                        <Button variant="ghost" onClick={() => setActiveIndex((index) => index - 1)} disabled={activeIndex === 0}>
                            <ChevronLeft className="mr-1 h-4 w-4" />{copy.previous}
                        </Button>
                        {answered && answered.isCorrect !== null && (
                            <Button
                                onClick={() => atLast ? setShowReview(false) : setActiveIndex((index) => index + 1)}
                                disabled={atLast && !finished}
                            >
                                {atLast ? copy.results : copy.next}
                                {!atLast && <ChevronRight className="ml-1 h-4 w-4" />}
                            </Button>
                        )}
                    </footer>
                </div>
            </main>
        );
    }

    const sourceSelect = (
        <div className="space-y-2">
            <Label htmlFor="practice-source">{copy.source}</Label>
            <Select value={source} onValueChange={(value) => setSource(value as PracticeSource)}>
                <SelectTrigger id="practice-source"><SelectValue /></SelectTrigger>
                <SelectContent>
                    <SelectItem value="original">{copy.original}</SelectItem>
                    <SelectItem value="variant">{copy.variant}</SelectItem>
                </SelectContent>
            </Select>
        </div>
    );

    return (
        <main className="min-h-screen bg-background p-4 md:p-8">
            <div className="mx-auto max-w-6xl space-y-8">
                <header className="flex items-start gap-4">
                    <Button variant="ghost" size="icon" onClick={() => router.back()} title={t.common.back || "Back"}>
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <div className="min-w-0 flex-1 space-y-1">
                        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t.practice.title}</h1>
                        <p className="text-sm text-muted-foreground sm:text-base">{t.practice.subtitle}</p>
                    </div>
                    <Link href="/">
                        <Button variant="ghost" size="icon" title={copy.home}>
                            <House className="h-5 w-5" />
                        </Button>
                    </Link>
                </header>

                <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
                    <Card>
                        <CardHeader>
                            <CardTitle>{copy.title}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            {errorItemId ? (
                                <>
                                    <div className="flex items-center gap-3 rounded-md border bg-muted px-4 py-3 text-sm font-medium">
                                        <Target className="h-5 w-5 shrink-0" />{copy.focused}
                                    </div>
                                    {sourceSelect}
                                </>
                            ) : (
                                <div className="grid gap-5 sm:grid-cols-2">
                                    <div className="space-y-2">
                                        <Label htmlFor="practice-mode">{copy.mode}</Label>
                                        <Select value={mode} onValueChange={(value) => setMode(value as PracticeMode)}>
                                            <SelectTrigger id="practice-mode"><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="random">{copy.random}</SelectItem>
                                                <SelectItem value="unmastered">{copy.unmastered}</SelectItem>
                                                <SelectItem value="ebbinghaus">{copy.ebbinghaus}</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    <div className="space-y-2">
                                        <Label htmlFor="practice-notebook">{copy.subject}</Label>
                                        <Select value={subjectId} onValueChange={setSubjectId}>
                                            <SelectTrigger id="practice-notebook"><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="all">{copy.allSubjects}</SelectItem>
                                                {notebooks.map((notebook) => (
                                                    <SelectItem key={notebook.id} value={notebook.id}>{notebook.name}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    <div className="space-y-2">
                                        <Label htmlFor="practice-count">{copy.count}</Label>
                                        <Select value={String(count)} onValueChange={(value) => setCount(Number(value) as PracticeCount)}>
                                            <SelectTrigger id="practice-count"><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                {PRACTICE_COUNTS.map((value) => (
                                                    <SelectItem key={value} value={String(value)}>{value}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    {sourceSelect}
                                </div>
                            )}

                            <Button size="lg" className="h-12 w-full" onClick={startPractice} disabled={loading}>
                                {loading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Play className="mr-2 h-5 w-5" />}
                                {loading ? copy.starting : copy.start}
                            </Button>
                        </CardContent>
                    </Card>

                    <Card className="self-start">
                        <CardHeader className="border-b">
                            <div className="flex items-center justify-between gap-3">
                                <CardTitle className="text-base">{copy.history}</CardTitle>
                                <span className="font-mono text-xs text-muted-foreground">{history.length}</span>
                            </div>
                        </CardHeader>
                        <CardContent className="divide-y p-0">
                            {history.length === 0 ? (
                                <p className="px-6 py-8 text-sm text-muted-foreground">{copy.noHistory}</p>
                            ) : history.map((item) => (
                                <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => item.mode === "daily" && !item.endedAt
                                        ? router.push(`/print-preview?sessionId=${item.id}&paper=1`)
                                        : openSession(item.id)}
                                    className="flex w-full items-center gap-3 px-6 py-4 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                                >
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-semibold">{modeLabels[item.mode] || item.mode}</p>
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            {new Date(item.startedAt).toLocaleDateString(language)} / {item.answeredCount}/{item.itemCount}
                                        </p>
                                    </div>
                                    <span className="font-mono text-sm">{item.correctCount}/{item.itemCount}</span>
                                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                                </button>
                            ))}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </main>
    );
}

export default function PracticePage() {
    return (
        <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-background"><Loader2 className="h-7 w-7 animate-spin" /></div>}>
            <PracticeContent />
        </Suspense>
    );
}
