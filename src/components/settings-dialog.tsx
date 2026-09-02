"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Settings, Loader2, AlertTriangle, Eye, EyeOff, Languages, User, Bot, Shield, BarChart3 } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { UserManagement } from "@/components/admin/user-management";
import { apiClient, ApiError } from "@/lib/api-client";
import { AppConfig, UserProfile, UpdateUserProfileRequest } from "@/types/api";
import { PromptSettings } from "@/components/settings/prompt-settings";
import { AiSettingsSection } from "@/components/settings/ai-settings-section";
import { DangerSettingsSection } from "@/components/settings/danger-settings-section";

import { MessageSquareText, Info, ExternalLink, Github, ScrollText } from "lucide-react";

interface ProfileFormState {
    name: string;
    email: string;
    educationStage: string;
    enrollmentYear: string | number;
    password: string;
}

export function SettingsDialog() {
    const { data: session } = useSession();
    const { t, language, setLanguage } = useLanguage();
    const [open, setOpen] = useState(false);
    const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
    const dialogContentRef = useRef<HTMLDivElement>(null);
    const [saving, setSaving] = useState(false);
    const [loading, setLoading] = useState(false);
    const [version, setVersion] = useState<string>("");
    const [config, setConfig] = useState<AppConfig>({ aiProvider: 'gemini' });

    // Profile State
    const [profile, setProfile] = useState<ProfileFormState>({
        name: "",
        email: "",
        educationStage: "",
        enrollmentYear: "",
        password: ""
    });
    const [confirmPassword, setConfirmPassword] = useState("");
    const [profileLoading, setProfileLoading] = useState(false);
    const [profileSaving, setProfileSaving] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);

    const router = useRouter();

    useEffect(() => {
        if (open) {
            fetchSettings();
            fetchProfile();
        }
        // 获取版本号
        fetch("/api/version")
            .then((res) => res.json())
            .then((data) => setVersion(data.version))
            .catch(() => {});
    }, [open]);

    const fetchSettings = async () => {
        setLoading(true);
        try {
            const data = await apiClient.get<AppConfig>("/api/settings");
            setConfig(data);
        } catch (error) {
            console.error('[SettingsDialog] Failed to fetch settings', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchProfile = async () => {
        setProfileLoading(true);
        try {
            const data = await apiClient.get<UserProfile>("/api/user");
            setProfile({
                name: data.name || "",
                email: data.email || "",
                educationStage: data.educationStage || "",
                enrollmentYear: data.enrollmentYear || "",
                password: ""
            });
        } catch (error) {
            console.error('[SettingsDialog] Failed to fetch profile', error);
        } finally {
            setProfileLoading(false);
        }
    };

    // 验证 OpenAI 实例必填字段
    const validateOpenAIInstances = (): string | null => {
        if (config.aiProvider !== 'openai') return null;
        const instances = config.openai?.instances || [];
        for (const instance of instances) {
            if (!instance.name?.trim()) {
                return t.settings?.ai?.validationNameRequired || '实例名称不能为空';
            }
            if (!instance.apiKey?.trim()) {
                return t.settings?.ai?.validationApiKeyRequired || 'API Key 不能为空';
            }
            if (!instance.baseUrl?.trim()) {
                return t.settings?.ai?.validationBaseUrlRequired || 'Base URL 不能为空';
            }
            if (!instance.model?.trim()) {
                return t.settings?.ai?.validationModelRequired || '模型名称不能为空';
            }
        }
        return null;
    };

    // 验证 Azure OpenAI 必填字段
    const validateAzureConfig = (): string | null => {
        if (config.aiProvider !== 'azure') return null;
        if (!config.azure?.endpoint?.trim()) {
            return t.settings?.ai?.validationAzureEndpointRequired || 'Azure Endpoint is required';
        }
        if (!config.azure?.deploymentName?.trim()) {
            return t.settings?.ai?.validationAzureDeploymentRequired || 'Deployment Name is required';
        }
        if (!config.azure?.apiKey?.trim()) {
            return t.settings?.ai?.validationApiKeyRequired || 'API Key is required';
        }
        return null;
    };

    const handleSaveSettings = async () => {
        // 验证 OpenAI 实例必填字段
        const openaiValidationError = validateOpenAIInstances();
        if (openaiValidationError) {
            setFeedback({ type: "error", message: openaiValidationError });
            return;
        }

        // 验证 Azure 必填字段
        const azureValidationError = validateAzureConfig();
        if (azureValidationError) {
            setFeedback({ type: "error", message: azureValidationError });
            return;
        }

        setSaving(true);
        try {
            await apiClient.post("/api/settings", config);
            setFeedback({ type: "success", message: t.settings?.messages?.saved || "Settings saved" });
            // 保存成功后滚动到顶部，方便关闭对话框
            dialogContentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (error) {
            console.error('[SettingsDialog] Failed to save settings', error);
            setFeedback({ type: "error", message: t.settings?.messages?.saveFailed || "Failed to save" });
        } finally {
            setSaving(false);
        }
    };

    const handleSaveProfile = async () => {
        setProfileSaving(true);
        try {
            // 验证密码一致性（如果用户输入了密码）
            if (profile.password && profile.password !== confirmPassword) {
                setFeedback({ type: "error", message: t.settings?.messages?.passwordMismatch || "Passwords do not match" });
                setProfileSaving(false);
                return;
            }

            const payload: UpdateUserProfileRequest = {
                name: profile.name,
                email: profile.email,
                educationStage: profile.educationStage,
            };

            if (profile.enrollmentYear) {
                payload.enrollmentYear = parseInt(profile.enrollmentYear.toString());
            }

            if (profile.password) {
                payload.password = profile.password;
            }

            await apiClient.patch("/api/user", payload);

            setFeedback({ type: "success", message: t.settings?.messages?.profileUpdated || "Profile updated" });
            setProfile(prev => ({ ...prev, password: "" })); // Clear password field
            setConfirmPassword(""); // Clear confirm password field
            setShowPassword(false);
            setShowConfirmPassword(false);
            window.location.reload(); // Reload to update user name in UI
        } catch (error: unknown) {
            const data = error instanceof ApiError ? error.data : null;
            const apiMessage = data && typeof data === "object" && "message" in data && typeof data.message === "string" ? data.message : null;
            console.error('[SettingsDialog] Failed to update profile', error);
            const message = apiMessage || (t.settings?.messages?.updateFailed || "Update failed");
            setFeedback({ type: "error", message });
        } finally {
            setProfileSaving(false);
        }
    };

    const updatePrompts = (type: 'analyze' | 'similar', value: string) => {
        setConfig(prev => ({
            ...prev,
            prompts: {
                ...prev.prompts,
                [type]: value
            }
        }));
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-full">
                    <Settings className="h-5 w-5" />
                    <span className="sr-only">{t.settings?.title || "Settings"}</span>
                </Button>
            </DialogTrigger>
            <DialogContent ref={dialogContentRef} className="w-[calc(100vw-2rem)] sm:max-w-[900px] max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{t.settings?.title || "Settings"}</DialogTitle>
                    <DialogDescription>
                        {t.settings?.desc || 'Manage your preferences and data.'}
                    </DialogDescription>
                </DialogHeader>
                {feedback && (
                    <p
                        className={feedback.type === "error" ? "rounded-md bg-destructive/10 p-3 text-sm text-destructive" : "rounded-md bg-green-50 p-3 text-sm text-green-800"}
                        role={feedback.type === "error" ? "alert" : "status"}
                    >
                        {feedback.message}
                    </p>
                )}

                <Tabs defaultValue="general" className="w-full">
                    <TabsList className={`grid w-full grid-cols-4 ${session?.user?.role === 'admin' ? 'sm:grid-cols-7' : 'sm:grid-cols-4'} gap-1 h-auto`}>
                        <TabsTrigger value="general" className="px-2 sm:px-3">
                            <Languages className="h-4 w-4 sm:mr-2" />
                            <span className="hidden sm:inline">{t.settings?.tabs?.general || "General"}</span>
                        </TabsTrigger>
                        <TabsTrigger value="account" className="px-2 sm:px-3">
                            <User className="h-4 w-4 sm:mr-2" />
                            <span className="hidden sm:inline">{t.settings?.tabs?.account || "Account"}</span>
                        </TabsTrigger>
                        {session?.user?.role === 'admin' && (
                            <>
                                <TabsTrigger value="ai" className="px-2 sm:px-3">
                                    <Bot className="h-4 w-4 sm:mr-2" />
                                    <span className="hidden sm:inline">{t.settings?.tabs?.ai || "AI Provider"}</span>
                                </TabsTrigger>
                                <TabsTrigger value="prompts" className="px-2 sm:px-3">
                                    <MessageSquareText className="h-4 w-4 sm:mr-2" />
                                    <span className="hidden sm:inline">{t.settings?.tabs?.prompts || "Prompts"}</span>
                                </TabsTrigger>
                                <TabsTrigger value="admin" className="px-2 sm:px-3">
                                    <Shield className="h-4 w-4 sm:mr-2" />
                                    <span className="hidden sm:inline">{t.settings?.tabs?.admin || "User Management"}</span>
                                </TabsTrigger>
                            </>
                        )}
                        <TabsTrigger value="danger" className="px-2 sm:px-3">
                            <AlertTriangle className="h-4 w-4 sm:mr-2" />
                            <span className="hidden sm:inline">{t.settings?.tabs?.danger || "Danger"}</span>
                        </TabsTrigger>
                        <TabsTrigger value="about" className="px-2 sm:px-3">
                            <Info className="h-4 w-4 sm:mr-2" />
                            <span className="hidden sm:inline">{t.settings?.tabs?.about || "About"}</span>
                        </TabsTrigger>
                    </TabsList>

                    {/* General Tab */}
                    <TabsContent value="general" className="space-y-4 py-4">
                        <div className="space-y-4 border rounded-lg p-4 bg-muted/30">
                            <div className="space-y-2">
                                <Label>{t.settings?.language || "Language"}</Label>
                                <Select
                                    value={language}
                                    onValueChange={(val: 'zh' | 'en') => setLanguage(val)}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="zh">中文 (Chinese)</SelectItem>
                                        <SelectItem value="en">English</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2 pt-4 border-t">
                                <Label>{t.settings?.general?.timeoutLabel || "AI Analysis Timeout (Seconds)"}</Label>
                                <Input
                                    type="number"
                                    value={config.timeouts?.analyze ? config.timeouts.analyze / 1000 : ''}
                                    onChange={(e) => {
                                        const val = e.target.value === '' ? 0 : parseInt(e.target.value);
                                        // Allow typing, validate later
                                        setConfig(prev => ({
                                            ...prev,
                                            timeouts: {
                                                ...prev.timeouts,
                                                analyze: isNaN(val) ? 0 : val * 1000
                                            }
                                        }));
                                    }}
                                    onBlur={() => {
                                        const currentVal = (config.timeouts?.analyze || 0) / 1000;
                                        // Valid range 120-600, default 120
                                        let safeVal = currentVal;
                                        if (safeVal < 120) safeVal = 120;
                                        if (safeVal > 600) safeVal = 600;

                                        if (safeVal !== currentVal) {
                                            setConfig(prev => ({
                                                ...prev,
                                                timeouts: {
                                                    ...prev.timeouts,
                                                    analyze: safeVal * 1000
                                                }
                                            }));
                                        }
                                    }}
                                    min={120}
                                    max={600}
                                />
                                <p className="text-xs text-muted-foreground">
                                    {t.settings?.general?.timeoutDesc || "Increase this value if you experience frequent timeouts during AI analysis."}
                                </p>
                            </div>
                        </div>
                        <Button onClick={handleSaveSettings} disabled={saving} className="w-full">
                            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {t.settings?.save || "Save Settings"}
                        </Button>
                    </TabsContent>

                    {/* Account Tab */}
                    <TabsContent value="account" className="space-y-4 py-4">
                        {profileLoading ? (
                            <div className="flex justify-center py-8">
                                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                            </div>
                        ) : (
                            <div className="space-y-4 border rounded-lg p-4 bg-muted/30">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>{t.auth?.name || "Name"}</Label>
                                        <Input
                                            value={profile.name || ""}
                                            onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>{t.auth?.email || "Email"}</Label>
                                        <Input
                                            value={profile.email || ""}
                                            onChange={(e) => setProfile({ ...profile, email: e.target.value })}
                                            type="email"
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>{t.auth?.educationStage || "Education Stage"}</Label>
                                        <Select
                                            value={profile.educationStage || ""}
                                            onValueChange={(val) => setProfile({ ...profile, educationStage: val })}
                                        >
                                            <SelectTrigger>
                                                <SelectValue placeholder={t.auth?.selectStage || "Select Stage"} />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="primary">{t.auth?.primary || 'Primary School'}</SelectItem>
                                                <SelectItem value="junior_high">{t.auth?.juniorHigh || 'Junior High'}</SelectItem>
                                                <SelectItem value="senior_high">{t.auth?.seniorHigh || 'Senior High'}</SelectItem>
                                                <SelectItem value="university">{t.auth?.university || 'University'}</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>{t.auth?.enrollmentYear || "Enrollment Year"}</Label>
                                        <Input
                                            type="number"
                                            value={profile.enrollmentYear || ""}
                                            onChange={(e) => setProfile({ ...profile, enrollmentYear: e.target.value })}
                                            placeholder="YYYY"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-3 pt-2 border-t">
                                    <div className="space-y-2">
                                        <Label>{t.settings?.account?.changePassword || "Change Password (Leave empty to keep)"}</Label>
                                        <div className="relative">
                                            <Input
                                                type={showPassword ? "text" : "password"}
                                                value={profile.password}
                                                onChange={(e) => setProfile({ ...profile, password: e.target.value })}
                                                placeholder="******"
                                                minLength={6}
                                                className="pr-10"
                                            />
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                                                onClick={() => setShowPassword(!showPassword)}
                                                tabIndex={-1}
                                            >
                                                {showPassword ? (
                                                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                                                ) : (
                                                    <Eye className="h-4 w-4 text-muted-foreground" />
                                                )}
                                            </Button>
                                        </div>
                                    </div>
                                    {profile.password && (
                                        <div className="space-y-2">
                                            <Label>{t.auth?.confirmPassword || "Confirm Password"}</Label>
                                            <div className="relative">
                                                <Input
                                                    type={showConfirmPassword ? "text" : "password"}
                                                    value={confirmPassword}
                                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                                    placeholder="******"
                                                    minLength={6}
                                                    className="pr-10"
                                                />
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                                                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                                    tabIndex={-1}
                                                >
                                                    {showConfirmPassword ? (
                                                        <EyeOff className="h-4 w-4 text-muted-foreground" />
                                                    ) : (
                                                        <Eye className="h-4 w-4 text-muted-foreground" />
                                                    )}
                                                </Button>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <Button onClick={handleSaveProfile} disabled={profileSaving} className="w-full">
                                    {profileSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    {t.settings?.account?.update || "Update Profile"}
                                </Button>
                            </div>
                        )}
                    </TabsContent>

                    {/* AI Tab */}
                    <AiSettingsSection
                        config={config}
                        setConfig={setConfig}
                        loading={loading}
                        saving={saving}
                        onSave={handleSaveSettings}
                    />

                    {/* Prompts Tab */}
                    <TabsContent value="prompts" className="space-y-4 py-4">
                        <PromptSettings config={config} onUpdate={updatePrompts} />
                        <Button onClick={handleSaveSettings} disabled={saving} className="w-full">
                            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {t.settings?.prompts?.save || "Save Prompt Settings"}
                        </Button>
                    </TabsContent>

                    {/* Admin Tab */}
                    {
                        session?.user?.role === 'admin' && (
                            <TabsContent value="admin" className="space-y-4 py-4">
                                <Button
                                    variant="outline"
                                    className="w-full justify-start gap-2"
                                    onClick={() => {
                                        setOpen(false)
                                        router.push("/admin")
                                    }}
                                >
                                    <BarChart3 className="h-4 w-4" />
                                    {t.admin?.dashboard?.title || "Admin Dashboard"}
                                </Button>
                                <div className="border-t pt-4">
                                    <UserManagement />
                                </div>
                            </TabsContent>
                        )
                    }

                    {/* Danger Zone Tab */}
                    <DangerSettingsSection
                        isAdmin={session?.user?.role === "admin"}
                        onFeedback={setFeedback}
                        onClose={() => setOpen(false)}
                    />

                    {/* About Tab */}
                    <TabsContent value="about" className="space-y-4 py-4">
                        <div className="flex flex-col items-center justify-center space-y-6 py-8 text-center bg-muted/30 rounded-lg border">
                            <div className="space-y-2">
                                <h3 className="text-2xl font-bold">{t.app?.title || "Smart Error Notebook"}</h3>
                                <p className="text-muted-foreground">
                                    {t.settings?.about?.desc || "AI-powered learning assistant"}
                                </p>
                            </div>

                            <div className="flex items-center space-x-2 text-sm text-muted-foreground border px-4 py-2 rounded-full bg-background">
                                <Info className="h-4 w-4" />
                                <span>{t.settings?.about?.version || "Version"}: v{version || "unknown"}</span>
                            </div>

                            <div className="flex flex-col sm:flex-row flex-wrap justify-center gap-4 w-full sm:w-auto px-4 sm:px-0">
                                <Button variant="outline" asChild className="gap-2 w-full sm:w-auto">
                                    <a href="https://github.com/wttwins/wrong-notebook" target="_blank" rel="noopener noreferrer">
                                        <Github className="h-4 w-4" />
                                        {t.settings?.about?.github || "GitHub Repository"}
                                        <ExternalLink className="h-3 w-3 ml-1 opacity-50" />
                                    </a>
                                </Button>

                                <Button variant="outline" asChild className="gap-2 w-full sm:w-auto">
                                    <a href="https://github.com/wttwins/wrong-notebook/releases" target="_blank" rel="noopener noreferrer">
                                        <ScrollText className="h-4 w-4" />
                                        {t.settings?.about?.releaseNotes || "Release Notes"}
                                        <ExternalLink className="h-3 w-3 ml-1 opacity-50" />
                                    </a>
                                </Button>

                                <Button variant="outline" asChild className="gap-2 w-full sm:w-auto">
                                    <a href="https://github.com/wttwins/wrong-notebook/issues" target="_blank" rel="noopener noreferrer">
                                        <MessageSquareText className="h-4 w-4" />
                                        {t.settings?.about?.feedback || "Feedback"}
                                        <ExternalLink className="h-3 w-3 ml-1 opacity-50" />
                                    </a>
                                </Button>
                            </div>

                            <p className="text-xs text-muted-foreground mt-8">
                                {t.settings?.about?.copyright || "© 2025 Wttwins. All rights reserved."}
                            </p>
                        </div>
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    );
}
