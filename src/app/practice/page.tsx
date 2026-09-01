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
    RotateCcw,
    Sparkles,
    Target,
    XCircle,
} from "lucide-react";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
    answer: NonNullable<PracticeSessionData["items"][number]["answer"]>;
    masteryLevel: number | null;
    endedAt: string | null;
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
    const { t, language } = useLanguage();
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
    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [showReview, setShowReview] = useState(false);
    const [error, setError] = useState("");

    const refreshHistory = () => apiClient.get<PracticeSessionSummary[]>("/api/practice/sessions")
        .then(setHistory)
        .catch(() => setHistory([]));

    useEffect(() => {
        Promise.all([
            apiClient.get<Notebook[]>("/api/notebooks").then(setNotebooks),
            refreshHistory(),
        ]).catch(() => undefined);
    }, []);

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
        knowledge: copy.legacyKnowledge,
    };

    async function startPractice() {
        setLoading(true);
        setError("");
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
            setError(hasErrorReason(cause, "NO_DUE_REVIEWS") ? copy.noDue : apiMessage(cause, copy.createError));
        } finally {
            setLoading(false);
        }
    }

    async function openSession(id: string) {
        setLoading(true);
        setError("");
        try {
            const data = await apiClient.get<PracticeSessionData>(`/api/practice/sessions/${id}`);
            setSession(data);
            const next = data.items.findIndex((item) => !item.answer);
            setActiveIndex(next < 0 ? 0 : next);
            setShowReview(false);
        } catch (cause: unknown) {
            setError(apiMessage(cause, copy.loadError));
        } finally {
            setLoading(false);
        }
    }

    async function submitAnswer() {
        if (!session || !currentItem || !currentAnswer.trim() || currentItem.answer) return;
        setSubmitting(true);
        setError("");
        try {
            const result = await apiClient.post<AnswerResponse>(
                `/api/practice/sessions/${session.id}/answer`,
                { itemId: currentItem.id, answerInput: currentAnswer },
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
            setError(apiMessage(cause, copy.submitError));
        } finally {
            setSubmitting(false);
        }
    }

    function leaveSession() {
        setSession(null);
        setShowReview(false);
        setError("");
        refreshHistory();
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
                        <Link href="/">
                            <Button variant="ghost" size="icon" title={copy.home}>
                                <House className="h-5 w-5" />
                            </Button>
                        </Link>
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
                        <Link href="/">
                            <Button variant="ghost" size="icon" title={copy.home}>
                                <House className="h-5 w-5" />
                            </Button>
                        </Link>
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
                                            : item.answer
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
                        <Card className={`gap-0 ${answered.isCorrect
                            ? "border-green-300 bg-green-50/60 dark:border-green-900 dark:bg-green-950/40"
                            : "border-red-300 bg-red-50/60 dark:border-red-900 dark:bg-red-950/40"}`}>
                            <CardContent className="px-5 py-5">
                                <div className="flex items-center gap-2 font-semibold">
                                    {answered.isCorrect
                                        ? <CheckCircle2 className="h-5 w-5 text-green-700 dark:text-green-300" />
                                        : <XCircle className="h-5 w-5 text-red-700 dark:text-red-300" />}
                                    {answered.isCorrect ? copy.correct : copy.incorrect}
                                </div>
                                <div className="mt-4 border-t border-border pt-4">
                                    <p className="mb-2 text-xs font-semibold text-muted-foreground">{copy.expectedAnswer}</p>
                                    <MarkdownRenderer content={answered.expectedAnswer} />
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

                    <footer className="flex items-center justify-between border-t pt-5">
                        <Button variant="ghost" onClick={() => setActiveIndex((index) => index - 1)} disabled={activeIndex === 0}>
                            <ChevronLeft className="mr-1 h-4 w-4" />{copy.previous}
                        </Button>
                        {answered && (
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

                            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
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
                                    onClick={() => openSession(item.id)}
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
