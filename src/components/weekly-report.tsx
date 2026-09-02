"use client";

import { useEffect, useState } from "react";
import { CalendarDays, Check, Loader2, Target } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient } from "@/lib/api-client";
import { chinaDateKey } from "@/lib/china-date";
import { ERROR_TYPE_LABELS, metadataLabel } from "@/lib/error-metadata";
import type { LearningOverview } from "@/types/api";

function praise(data: LearningOverview, language: string) {
    if (data.week.completionDays.length >= 5) return language === "zh" ? "这周坚持得很稳，表扬孩子按计划完成练习。" : "A steady week: praise the consistent daily practice.";
    if (data.week.completionDays.length >= 3) return language === "zh" ? "已经形成不错的节奏，继续守住每天 10 分钟。" : "A good rhythm is forming. Keep the daily ten minutes.";
    if (data.week.correctedCount > 0) return language === "zh" ? "这周认真完成了订正，先把错题弄懂就是进步。" : "Corrections were completed this week. Understanding mistakes is real progress.";
    return language === "zh" ? "从今天完成一组 5 题开始，重点是持续。" : "Start with one set of five today. Consistency matters most.";
}

export function WeeklyReport() {
    const { language } = useLanguage();
    const [data, setData] = useState<LearningOverview | null>(null);

    useEffect(() => {
        apiClient.get<LearningOverview>("/api/learning-overview").then(setData).catch(() => setData(null));
    }, []);

    if (!data) return <div className="flex min-h-24 items-center justify-center border-y"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

    const today = new Date();
    const days = Array.from({ length: 7 }, (_, index) => {
        const date = new Date(today.getTime() - (6 - index) * 24 * 60 * 60 * 1000);
        const key = chinaDateKey(date);
        return {
            key,
            label: new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en", { weekday: "short", timeZone: "Asia/Shanghai" }).format(date),
            completed: data.week.completionDays.includes(key),
        };
    });

    return (
        <section className="border-y bg-muted/20 py-6" aria-labelledby="weekly-report-title">
            <div className="mb-5 flex items-center gap-3">
                <CalendarDays className="h-5 w-5 text-primary" />
                <div>
                    <h2 id="weekly-report-title" className="text-lg font-semibold">{language === "zh" ? "本周学习报告" : "Weekly learning report"}</h2>
                    <p className="text-sm text-muted-foreground">{praise(data, language)}</p>
                </div>
            </div>

            <div className="grid grid-cols-2 divide-x border-y py-4 text-center sm:grid-cols-4">
                <div><strong className="block text-2xl">{data.week.completionDays.length}</strong><span className="text-xs text-muted-foreground">{language === "zh" ? "完成天数" : "Days completed"}</span></div>
                <div><strong className="block text-2xl">{data.week.reviewedCount}</strong><span className="text-xs text-muted-foreground">{language === "zh" ? "复习题数" : "Reviews"}</span></div>
                <div><strong className="block text-2xl">{data.week.accuracy}%</strong><span className="text-xs text-muted-foreground">{language === "zh" ? "复习正确率" : "Accuracy"}</span></div>
                <div><strong className="block text-2xl">{data.week.correctedCount}</strong><span className="text-xs text-muted-foreground">{language === "zh" ? "订正题数" : "Corrections"}</span></div>
            </div>

            <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]">
                <div>
                    <h3 className="mb-3 text-sm font-semibold">{language === "zh" ? "最近 7 天" : "Last 7 days"}</h3>
                    <div className="grid grid-cols-7 gap-2">
                        {days.map((day) => (
                            <div key={day.key} className="text-center">
                                <div className={`mx-auto flex h-9 w-9 items-center justify-center rounded-md border ${day.completed ? "border-green-600 bg-green-600 text-white" : "bg-background text-muted-foreground"}`}>
                                    {day.completed ? <Check className="h-4 w-4" /> : <span className="text-xs">-</span>}
                                </div>
                                <span className="mt-1 block text-xs text-muted-foreground">{day.label}</span>
                            </div>
                        ))}
                    </div>
                </div>
                <div>
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Target className="h-4 w-4" />{language === "zh" ? "常见错因" : "Common causes"}</h3>
                    <ol className="space-y-2 text-sm">
                        {data.week.topErrorTypes.length ? data.week.topErrorTypes.map((item) => <li key={item.name} className="flex justify-between gap-3"><span>{metadataLabel(item.name, ERROR_TYPE_LABELS, language)}</span><span className="text-muted-foreground">{item.count}</span></li>) : <li className="text-muted-foreground">{language === "zh" ? "暂无记录" : "No data"}</li>}
                    </ol>
                </div>
                <div>
                    <h3 className="mb-3 text-sm font-semibold">{language === "zh" ? "薄弱知识点" : "Weak topics"}</h3>
                    <ol className="space-y-2 text-sm">
                        {data.week.weakTags.length ? data.week.weakTags.map((item) => <li key={item.name} className="flex justify-between gap-3"><span className="truncate">{item.name}</span><span className="text-muted-foreground">{item.count}</span></li>) : <li className="text-muted-foreground">{language === "zh" ? "暂无记录" : "No data"}</li>}
                    </ol>
                </div>
            </div>
        </section>
    );
}
