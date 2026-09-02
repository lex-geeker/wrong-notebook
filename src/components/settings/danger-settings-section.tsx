"use client";

import { useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { AlertTriangle, CheckCircle2, Download, Loader2, RefreshCw, Trash2, Upload } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient } from "@/lib/api-client";

interface ImportResponse {
    stats: {
        usersCreated: number;
        subjectsCreated: number;
        tagsCreated: number;
        errorItemsCreated: number;
        practiceSessionsCreated: number;
        practiceSessionItemsCreated: number;
        practiceRecordsCreated: number;
    };
}

type DataScope = "user" | "all";
type Feedback = { type: "success" | "error"; message: string };

interface DangerSettingsSectionProps {
    isAdmin: boolean;
    onFeedback: (feedback: Feedback) => void;
    onClose: () => void;
}

export function DangerSettingsSection({ isAdmin, onFeedback, onClose }: DangerSettingsSectionProps) {
    const { t } = useLanguage();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [clearingPractice, setClearingPractice] = useState(false);
    const [clearingError, setClearingError] = useState(false);
    const [systemResetting, setSystemResetting] = useState(false);
    const [migratingTags, setMigratingTags] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [importing, setImporting] = useState(false);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);

    const reloadAfterClose = () => {
        onClose();
        window.location.reload();
    };

    const handleClearPractice = async () => {
        setClearingPractice(true);
        try {
            await apiClient.delete("/api/stats/practice/clear");
            onFeedback({ type: "success", message: t.settings?.clearSuccess || "Success" });
            reloadAfterClose();
        } catch (error) {
            console.error("[DangerSettingsSection] Failed to clear practice data", error);
            onFeedback({ type: "error", message: t.settings?.clearError || "Failed" });
        } finally {
            setClearingPractice(false);
        }
    };

    const handleClearErrors = async () => {
        setClearingError(true);
        try {
            await apiClient.delete("/api/error-items/clear");
            onFeedback({ type: "success", message: t.settings?.clearSuccess || "Success" });
            reloadAfterClose();
        } catch (error) {
            console.error("[DangerSettingsSection] Failed to clear error data", error);
            onFeedback({ type: "error", message: t.settings?.clearError || "Failed" });
        } finally {
            setClearingError(false);
        }
    };

    const handleSystemReset = async () => {
        setSystemResetting(true);
        try {
            await apiClient.post("/api/admin/system-reset", {});
            onFeedback({ type: "success", message: t.settings?.clearSuccess || "System reset complete" });
            reloadAfterClose();
        } catch (error) {
            console.error("[DangerSettingsSection] System reset failed", error);
            onFeedback({ type: "error", message: t.settings?.clearError || "Failed to reset system" });
        } finally {
            setSystemResetting(false);
        }
    };

    const handleExport = async (scope: DataScope) => {
        setExporting(true);
        try {
            const response = await fetch(`/api/export${scope === "all" ? "?all=true" : ""}`);
            if (!response.ok) {
                const data = await response.json().catch(() => null);
                throw new Error(data?.message || "Export failed");
            }

            const url = window.URL.createObjectURL(await response.blob());
            const link = document.createElement("a");
            link.href = url;
            const filename = response.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1];
            link.download = filename || `wrong-notebook-export${scope === "all" ? "-all" : ""}.json`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
            onFeedback({ type: "success", message: t.settings?.exportSuccess || "Export successful" });
        } catch (error) {
            console.error(`[DangerSettingsSection] ${scope} export failed`, error);
            onFeedback({ type: "error", message: t.settings?.exportFailed || "Export failed" });
        } finally {
            setExporting(false);
        }
    };

    const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
        setSelectedFile(event.target.files?.[0] || null);
    };

    const handleImport = async (scope: DataScope) => {
        if (!selectedFile) return;

        setImporting(true);
        try {
            const response = await apiClient.post<ImportResponse>(
                `/api/import${scope === "all" ? "?all=true" : ""}`,
                JSON.parse(await selectedFile.text())
            );
            const stats = response.stats;
            onFeedback({
                type: "success",
                message: (t.settings?.importResultDesc || "Imported {users} users, {subjects} notebooks, {tags} tags, {items} error items, {sessions} practice sessions and {records} practice records.")
                    .replace("{users}", String(stats.usersCreated))
                    .replace("{subjects}", String(stats.subjectsCreated))
                    .replace("{tags}", String(stats.tagsCreated))
                    .replace("{items}", String(stats.errorItemsCreated))
                    .replace("{sessions}", String(stats.practiceSessionsCreated))
                    .replace("{records}", String(stats.practiceRecordsCreated)),
            });
            setSelectedFile(null);
            reloadAfterClose();
        } catch (error) {
            console.error(`[DangerSettingsSection] ${scope} import failed`, error);
            onFeedback({ type: "error", message: t.settings?.importFailed || "Import failed" });
        } finally {
            setImporting(false);
        }
    };

    const handleMigrateTags = async () => {
        setMigratingTags(true);
        try {
            const response = await apiClient.post<{ count: number }>("/api/admin/migrate-tags", {});
            onFeedback({ type: "success", message: `${t.settings?.clearSuccess || "Success"}: ${response.count || 0} tags migrated.` });
        } catch (error) {
            console.error("[DangerSettingsSection] Tag migration failed", error);
            onFeedback({ type: "error", message: t.settings?.clearError || "Failed to migrate tags" });
        } finally {
            setMigratingTags(false);
        }
    };

    return (
        <TabsContent value="danger" className="space-y-4 py-4">
            <div className="space-y-3">
                <div className="p-4 border border-blue-200 rounded-lg bg-blue-50">
                    <h4 className="text-sm font-bold text-blue-900 mb-3">
                        {t.settings?.dataManagement || "Data Management"}
                    </h4>

                    <div className="mb-4">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-sm text-blue-800 font-medium">
                                {t.settings?.exportData || "Export Data"}
                            </span>
                            <div className="flex items-center gap-2">
                                <Button variant="outline" size="sm" onClick={() => handleExport("user")} disabled={exporting} className="bg-blue-100 hover:bg-blue-200 text-blue-900 border-blue-300">
                                    {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                                    {t.settings?.exportData || "Export"}
                                </Button>
                                {isAdmin && (
                                    <ConfirmDialog
                                        title={t.settings?.exportAllData || "Export All"}
                                        description={t.settings?.exportAllConfirm || "Export all users' data? This may take a while."}
                                        onConfirm={() => handleExport("all")}
                                    >
                                        <Button variant="outline" size="sm" disabled={exporting} className="border-orange-300 bg-orange-100 text-orange-900 hover:bg-orange-200">
                                            {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                                            {t.settings?.exportAllData || "Export All"}
                                        </Button>
                                    </ConfirmDialog>
                                )}
                            </div>
                        </div>
                        <p className="text-xs text-blue-700">
                            {t.settings?.exportDataDesc || "Export all data as JSON file."}
                        </p>
                    </div>

                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-sm text-blue-800 font-medium">
                                {t.settings?.importData || "Import Data"}
                            </span>
                            <div className="flex items-center gap-2">
                                <input ref={fileInputRef} type="file" accept=".json" onChange={handleFileChange} className="hidden" disabled={importing} />
                                <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={importing} className="bg-blue-100 hover:bg-blue-200 text-blue-900 border-blue-300">
                                    {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                                    {selectedFile?.name || t.settings?.selectFile || "Select File"}
                                </Button>
                                {selectedFile && (
                                    <ConfirmDialog
                                        title={t.settings?.importData || "Import"}
                                        description={t.settings?.importConfirm || "Are you sure you want to import?"}
                                        onConfirm={() => handleImport("user")}
                                    >
                                        <Button variant="outline" size="sm" disabled={importing} className="border-green-300 bg-green-100 text-green-900 hover:bg-green-200">
                                            {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                                            {t.settings?.importData || "Import"}
                                        </Button>
                                    </ConfirmDialog>
                                )}
                                {selectedFile && isAdmin && (
                                    <ConfirmDialog
                                        title={t.settings?.importAllData || "Import All"}
                                        description={t.settings?.importAllConfirm || "Import all users' data? This will restore data for all users from the export file."}
                                        onConfirm={() => handleImport("all")}
                                    >
                                        <Button variant="outline" size="sm" disabled={importing} className="border-orange-300 bg-orange-100 text-orange-900 hover:bg-orange-200">
                                            {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                                            {t.settings?.importAllData || "Import All"}
                                        </Button>
                                    </ConfirmDialog>
                                )}
                            </div>
                        </div>
                        <p className="text-xs text-blue-700">
                            {t.settings?.importDataDesc || "Import data from JSON file. Existing data will be skipped."}
                        </p>
                    </div>
                </div>

                {isAdmin && (
                    <div className="p-4 border border-blue-200 rounded-lg bg-blue-50">
                        <div className="flex items-center justify-between">
                            <span className="text-sm text-blue-900 font-bold flex items-center gap-2">
                                <RefreshCw className="h-4 w-4" />
                                {t.settings?.migrateTags || "Migrate Tags"}
                            </span>
                            <ConfirmDialog
                                title={t.settings?.migrateTags || "Migrate Tags"}
                                description={t.settings?.migrateTagsConfirm || "This will reset system tags. Confirm?"}
                                onConfirm={handleMigrateTags}
                            >
                                <Button variant="outline" size="sm" disabled={migratingTags} className="border-blue-300 bg-blue-100 text-blue-900 hover:bg-blue-200">
                                    {migratingTags ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                                </Button>
                            </ConfirmDialog>
                        </div>
                        <p className="text-xs text-blue-800 mt-2 font-medium">
                            {t.settings?.migrateTagsDesc || "Re-populates standard tags from file"}
                        </p>
                    </div>
                )}

                <div className="p-4 border border-red-200 rounded-lg bg-red-50">
                    <div className="flex items-center justify-between">
                        <span className="text-sm text-red-700 font-medium">{t.settings?.clearData || "Clear Practice Data"}</span>
                        <ConfirmDialog
                            title={t.settings?.clearData || "Clear Practice Data"}
                            description={t.settings?.clearDataConfirm || "Are you sure?"}
                            onConfirm={handleClearPractice}
                        >
                            <Button variant="destructive" size="sm" disabled={clearingPractice}>
                                {clearingPractice ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                            </Button>
                        </ConfirmDialog>
                    </div>
                    <p className="text-xs text-red-600 mt-2">
                        {t.settings?.clearDataDesc || "This will permanently delete all practice history. Irreversible."}
                    </p>
                </div>

                <div className="p-4 border border-red-200 rounded-lg bg-red-50">
                    <div className="flex items-center justify-between">
                        <span className="text-sm text-red-700 font-medium">{t.settings?.clearErrorData || "Clear Error Data"}</span>
                        <ConfirmDialog
                            title={t.settings?.clearErrorData || "Clear Error Data"}
                            description={t.settings?.clearErrorDataConfirm || "Are you sure?"}
                            onConfirm={handleClearErrors}
                        >
                            <Button variant="destructive" size="sm" disabled={clearingError}>
                                {clearingError ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                            </Button>
                        </ConfirmDialog>
                    </div>
                    <p className="text-xs text-red-600 mt-2">
                        {t.settings?.clearErrorDataDesc || "This will permanently delete all error items. Irreversible."}
                    </p>
                </div>

                {isAdmin && (
                    <div className="p-4 border border-red-600/50 rounded-lg bg-red-100/50">
                        <div className="flex items-center justify-between">
                            <span className="text-sm text-red-900 font-bold flex items-center gap-2">
                                <AlertTriangle className="h-4 w-4" />
                                {t.settings?.systemReset || "System Initialization"}
                            </span>
                            <ConfirmDialog
                                title={t.settings?.systemReset || "System Initialization"}
                                description={t.settings?.systemResetConfirm || "WARNING: Deleting ALL data. Undoing is impossible."}
                                verificationText="RESET"
                                onConfirm={handleSystemReset}
                            >
                                <Button variant="destructive" size="sm" disabled={systemResetting} className="bg-red-700 hover:bg-red-800">
                                    {systemResetting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                </Button>
                            </ConfirmDialog>
                        </div>
                        <p className="text-xs text-red-800 mt-2 font-medium">
                            {t.settings?.systemResetDesc || "Resets the system to factory state. Deletes ALL data."}
                        </p>
                    </div>
                )}
            </div>
        </TabsContent>
    );
}
