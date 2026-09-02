"use client";

import { useEffect, useState } from "react";
import { Upload, PenLine, FilePenLine } from "lucide-react";
import { UploadZone } from "@/components/upload-zone";
import { CorrectionEditor } from "@/components/correction-editor";
import { ImageCropper } from "@/components/image-cropper";
import { TextInputZone } from "@/components/text-input-zone";
import { DirectTextEditor } from "@/components/direct-text-editor";
import { ProgressFeedback, type ProgressStatus } from "@/components/ui/progress-feedback";
import { useToast } from "@/components/ui/toast";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient, ApiError } from "@/lib/api-client";
import type { ParsedQuestion } from "@/lib/ai";
import { processImageFile } from "@/lib/image-utils";
import { normalizeMistakeStatusForSave } from "@/lib/mistake-status";
import type { AnalyzeResponse, AppConfig, Notebook } from "@/types/api";
import type { ErrorSource, ErrorType } from "@/lib/error-metadata";

type InputMode = "image" | "text" | "direct";
type SaveData = ParsedQuestion & {
    subjectId?: string;
    gradeSemester?: string;
    paperLevel?: string;
    source?: ErrorSource;
    errorType?: ErrorType;
};
type DirectSaveData = {
    questionText: string;
    answerText: string;
    analysis: string;
    wrongAnswerText: string;
    mistakeAnalysis: string;
    mistakeStatus: string;
    knowledgePoints: string[];
    subjectId: string;
    gradeSemester?: string;
    paperLevel?: string;
    source: ErrorSource;
    errorType?: ErrorType;
};

interface ErrorEntryFlowProps {
    fixedNotebookId?: string | null;
    onSaved: (subjectId?: string) => void;
}

export function ErrorEntryFlow({ fixedNotebookId, onSaved }: ErrorEntryFlowProps) {
    const { t, language } = useLanguage();
    const { showToast } = useToast();
    const [step, setStep] = useState<"upload" | "review">("upload");
    const [inputMode, setInputMode] = useState<InputMode>("image");
    const [analysisStep, setAnalysisStep] = useState<ProgressStatus>("idle");
    const [progress, setProgress] = useState(0);
    const [parsedData, setParsedData] = useState<ParsedQuestion | null>(null);
    const [currentImage, setCurrentImage] = useState<string | null>(null);
    const [croppingImage, setCroppingImage] = useState<string | null>(null);
    const [isCropperOpen, setIsCropperOpen] = useState(false);
    const [notebooks, setNotebooks] = useState<Notebook[]>([]);
    const [autoSelectedNotebookId, setAutoSelectedNotebookId] = useState<string | null>(null);
    const [config, setConfig] = useState<AppConfig | null>(null);

    const selectedNotebookId = fixedNotebookId || autoSelectedNotebookId || undefined;
    const selectedNotebook = notebooks.find(({ id }) => id === selectedNotebookId);
    const aiTimeout = config?.timeouts?.analyze || 180_000;

    useEffect(() => {
        Promise.all([
            apiClient.get<Notebook[]>("/api/notebooks"),
            apiClient.get<AppConfig>("/api/client-config"),
        ]).then(([notebookData, configData]) => {
            setNotebooks(notebookData);
            setConfig(configData);
        }).catch(error => {
            console.error('[ErrorEntryFlow] Failed to load entry config', error);
            showToast(t.common.messages?.loadFailed || "Failed to load entry settings", "error");
        });
    }, [showToast, t.common.messages?.loadFailed]);

    useEffect(() => () => {
        if (croppingImage) URL.revokeObjectURL(croppingImage);
    }, [croppingImage]);

    useEffect(() => {
        if (analysisStep === "idle") return;
        setProgress(0);
        const interval = window.setInterval(() => setProgress(value => value >= 90 ? value : value + Math.random() * 10), 500);
        const timeout = window.setTimeout(() => setAnalysisStep("idle"), aiTimeout + 10_000);
        return () => {
            window.clearInterval(interval);
            window.clearTimeout(timeout);
        };
    }, [analysisStep, aiTimeout]);

    const showError = (error: unknown) => {
        const data = error instanceof ApiError ? error.data : null;
        const backendMessage = data && typeof data === "object" && "message" in data && typeof data.message === "string"
            ? data.message
            : null;
        const translated = backendMessage
            ? Object.entries(t.errors || {}).find(([key]) => key === backendMessage)?.[1]
            : null;
        showToast(
            typeof translated === "string" ? translated : backendMessage || t.common.messages?.analysisFailed || "Analysis failed",
            "error",
        );
    };

    const finishAnalysis = (data: ParsedQuestion, image: string | null) => {
        setCurrentImage(image);
        setParsedData(data);
        setProgress(100);
        setAnalysisStep("processing");
        setStep("review");
    };

    const handleAnalyze = async (file: File) => {
        try {
            setAnalysisStep("compressing");
            const imageBase64 = await processImageFile(file);
            setAnalysisStep("analyzing");
            const data = await apiClient.post<AnalyzeResponse>("/api/analyze", {
                imageBase64,
                language,
                subjectId: selectedNotebookId,
            }, { timeout: aiTimeout });
            if (data.subject && !fixedNotebookId) {
                const match = notebooks.find(({ name }) => name.includes(data.subject) || data.subject.includes(name));
                if (match) setAutoSelectedNotebookId(match.id);
            }
            finishAnalysis(data, imageBase64);
        } catch (error) {
            showError(error);
        } finally {
            setAnalysisStep("idle");
        }
    };

    const handleTextSubmit = async (questionText: string) => {
        try {
            setAnalysisStep("analyzing");
            const result = await apiClient.post<{
                answerText: string;
                analysis: string;
                knowledgePoints: string[];
                wrongAnswerText: string;
                mistakeAnalysis: string;
                mistakeStatus: string;
            }>("/api/reanswer", {
                questionText,
                language,
                subject: selectedNotebook?.name,
            }, { timeout: aiTimeout });
            finishAnalysis({
                questionText,
                answerText: result.answerText,
                analysis: result.analysis,
                knowledgePoints: result.knowledgePoints || [],
                wrongAnswerText: result.wrongAnswerText || "",
                mistakeAnalysis: result.mistakeAnalysis || "",
                mistakeStatus: normalizeMistakeStatusForSave(result.mistakeStatus, result.wrongAnswerText),
                subject: "其他",
                requiresImage: false,
            }, null);
        } catch (error) {
            showError(error);
        } finally {
            setAnalysisStep("idle");
        }
    };

    const save = async (data: SaveData, image: string | null) => {
        const subjectId = fixedNotebookId || data.subjectId;
        const result = await apiClient.post<{ duplicate?: boolean }>("/api/error-items", {
            ...data,
            subjectId,
            originalImageUrl: image || "",
        });
        if (result.duplicate) console.info('[ErrorEntryFlow] Duplicate submission reused');
        showToast(t.common.messages?.saveSuccess || "Saved successfully", "success");
        setParsedData(null);
        setCurrentImage(null);
        setStep("upload");
        onSaved(subjectId);
    };

    const handleSave = async (data: SaveData) => {
        try {
            await save(data, currentImage);
        } catch (error) {
            console.error('[ErrorEntryFlow] Save failed', error);
            showToast(t.common.messages?.saveFailed || "Save failed", "error");
        }
    };

    const handleDirectSave = async (data: DirectSaveData) => {
        try {
            setAnalysisStep("saving");
            await save({
                ...data,
                mistakeStatus: normalizeMistakeStatusForSave(data.mistakeStatus, data.wrongAnswerText),
                subject: "其他",
                requiresImage: false,
            }, null);
        } catch (error) {
            console.error('[ErrorEntryFlow] Direct save failed', error);
            showToast(t.common.messages?.saveFailed || "Save failed", "error");
        } finally {
            setAnalysisStep("idle");
        }
    };

    const progressMessage = analysisStep === "saving"
        ? "保存中..."
        : t.common.progress?.[analysisStep as keyof typeof t.common.progress] || "";

    return (
        <section id="error-entry" className="space-y-4">
            <ProgressFeedback status={analysisStep} progress={progress} message={progressMessage} />
            {step === "upload" && (
                <>
                    <div className="flex gap-2 border-b" role="tablist">
                        {([
                            ["image", Upload, t.app.uploadImage || "拍照上传"],
                            ["text", PenLine, t.app.manualInput || "AI 解题"],
                            ["direct", FilePenLine, "直接录入"],
                        ] as const).map(([mode, Icon, label]) => (
                            <button
                                key={mode}
                                type="button"
                                role="tab"
                                aria-selected={inputMode === mode}
                                className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${inputMode === mode ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                                onClick={() => setInputMode(mode)}
                            >
                                <Icon className="h-4 w-4" />
                                {label}
                            </button>
                        ))}
                    </div>
                    {inputMode === "image" ? (
                        <UploadZone
                            onImageSelect={file => {
                                setCroppingImage(URL.createObjectURL(file));
                                setIsCropperOpen(true);
                            }}
                            isAnalyzing={analysisStep !== "idle"}
                        />
                    ) : inputMode === "text" ? (
                        <TextInputZone onSubmit={handleTextSubmit} isAnalyzing={analysisStep !== "idle"} defaultNotebookName={selectedNotebook?.name} />
                    ) : (
                        <DirectTextEditor
                            key={selectedNotebookId || "unselected"}
                            onSubmit={handleDirectSave}
                            defaultNotebookId={selectedNotebookId}
                            notebooks={notebooks}
                            isSaving={analysisStep === "saving"}
                        />
                    )}
                </>
            )}
            {step === "review" && parsedData && (
                <CorrectionEditor
                    initialData={parsedData}
                    imagePreview={currentImage}
                    initialSubjectId={selectedNotebookId}
                    aiTimeout={aiTimeout}
                    notebooks={notebooks}
                    onSave={handleSave}
                    onCancel={() => setStep("upload")}
                />
            )}
            {croppingImage && (
                <ImageCropper
                    imageSrc={croppingImage}
                    open={isCropperOpen}
                    onClose={() => setIsCropperOpen(false)}
                    onCropComplete={blob => {
                        setIsCropperOpen(false);
                        void handleAnalyze(new File([blob], "cropped-image.jpg", { type: "image/jpeg" }));
                    }}
                />
            )}
        </section>
    );
}
