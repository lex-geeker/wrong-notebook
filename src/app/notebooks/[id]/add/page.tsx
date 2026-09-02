"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, House } from "lucide-react";
import { ErrorEntryFlow } from "@/components/error-entry-flow";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";

export default function AddErrorPage() {
    const { id } = useParams<{ id: string }>();
    const router = useRouter();
    const { t } = useLanguage();

    return (
        <main className="min-h-screen bg-background">
            <div className="container mx-auto space-y-8 p-4 pb-20">
                <div className="flex items-center gap-4">
                    <Link href={`/notebooks/${id}`}>
                        <Button variant="ghost" size="icon" aria-label={t.common.back || "Back"}>
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                    </Link>
                    <h1 className="min-w-0 flex-1 text-2xl font-bold">{t.app.addError}</h1>
                    <Link href="/">
                        <Button variant="ghost" size="icon" title={t.practice.batch.home} aria-label={t.practice.batch.home}>
                            <House className="h-5 w-5" />
                        </Button>
                    </Link>
                </div>
                <ErrorEntryFlow fixedNotebookId={id} onSaved={() => router.push(`/notebooks/${id}`)} />
            </div>
        </main>
    );
}
