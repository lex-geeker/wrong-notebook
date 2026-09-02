"use client";

import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { CheckCircle2, Eye, EyeOff, Loader2, Plus, Trash2, XCircle, Zap } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ModelSelector } from "@/components/ui/model-selector";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { TabsContent } from "@/components/ui/tabs";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient } from "@/lib/api-client";
import { AppConfig, MAX_OPENAI_INSTANCES, OpenAIInstance } from "@/types/api";

interface TestResult {
    success: boolean;
    textSupport: boolean;
    visionSupport: boolean;
    textError?: string;
    visionError?: string;
    modelInfo?: string;
}

interface AiSettingsSectionProps {
    config: AppConfig;
    setConfig: Dispatch<SetStateAction<AppConfig>>;
    loading: boolean;
    saving: boolean;
    onSave: () => void | Promise<void>;
}

export function AiSettingsSection({ config, setConfig, loading, saving, onSave }: AiSettingsSectionProps) {
    const { t, language } = useLanguage();
    const [showApiKey, setShowApiKey] = useState(false);
    const [selectedInstanceId, setSelectedInstanceId] = useState<string>();
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<TestResult | null>(null);

    useEffect(() => {
        setSelectedInstanceId(config.openai?.activeInstanceId);
    }, [config.openai?.activeInstanceId]);

    const instances = config.openai?.instances || [];
    const activeInstanceId = selectedInstanceId || config.openai?.activeInstanceId;
    const selectedInstance = instances.find(instance => instance.id === activeInstanceId);

    const updateOpenAIInstance = (key: keyof OpenAIInstance, value: string) => {
        setConfig(prev => ({
            ...prev,
            openai: {
                ...prev.openai,
                instances: (prev.openai?.instances || []).map(instance =>
                    instance.id === activeInstanceId ? { ...instance, [key]: value } : instance
                ),
            },
        }));
    };

    const addOpenAIInstance = () => {
        if (instances.length >= MAX_OPENAI_INSTANCES) return;

        const instance: OpenAIInstance = {
            id: crypto.randomUUID(),
            name: `Instance ${instances.length + 1}`,
            apiKey: "",
            baseUrl: "https://api.openai.com/v1",
            model: "gpt-4o",
        };

        setConfig(prev => ({
            ...prev,
            openai: {
                instances: [...(prev.openai?.instances || []), instance],
                activeInstanceId: instance.id,
            },
        }));
        setSelectedInstanceId(instance.id);
    };

    const deleteOpenAIInstance = () => {
        if (!activeInstanceId) return;
        const remaining = instances.filter(instance => instance.id !== activeInstanceId);
        const nextId = remaining[0]?.id;
        setConfig(prev => ({
            ...prev,
            openai: { instances: remaining, activeInstanceId: nextId },
        }));
        setSelectedInstanceId(nextId);
    };

    const setActiveOpenAIInstance = (instanceId: string) => {
        setSelectedInstanceId(instanceId);
        setConfig(prev => ({
            ...prev,
            openai: { ...prev.openai, activeInstanceId: instanceId },
        }));
    };

    const updateGemini = (key: string, value: string) => {
        setConfig(prev => ({
            ...prev,
            gemini: { ...prev.gemini, [key]: value },
        }));
    };

    const handleTestConnection = async () => {
        setTesting(true);
        setTestResult(null);
        try {
            let requestBody: Record<string, unknown>;
            if (config.aiProvider === "openai") {
                if (!selectedInstance?.apiKey) {
                    setTestResult({ success: false, textSupport: false, visionSupport: false, textError: t.settings?.ai?.validationApiKeyRequired || "API Key is required" });
                    return;
                }
                requestBody = {
                    provider: "openai",
                    apiKey: selectedInstance.apiKey,
                    baseUrl: selectedInstance.baseUrl,
                    model: selectedInstance.model,
                    language,
                };
            } else if (config.aiProvider === "gemini") {
                if (!config.gemini?.apiKey) {
                    setTestResult({ success: false, textSupport: false, visionSupport: false, textError: t.settings?.ai?.validationApiKeyRequired || "API Key is required" });
                    return;
                }
                requestBody = {
                    provider: "gemini",
                    apiKey: config.gemini.apiKey,
                    baseUrl: config.gemini.baseUrl,
                    model: config.gemini.model,
                    language,
                };
            } else {
                if (!config.azure?.apiKey || !config.azure.endpoint || !config.azure.deploymentName) {
                    setTestResult({ success: false, textSupport: false, visionSupport: false, textError: t.settings?.ai?.validationAzureEndpointRequired || "Azure config is incomplete" });
                    return;
                }
                requestBody = {
                    provider: "azure",
                    apiKey: config.azure.apiKey,
                    endpoint: config.azure.endpoint,
                    deploymentName: config.azure.deploymentName,
                    apiVersion: config.azure.apiVersion,
                    model: config.azure.model,
                    language,
                };
            }

            setTestResult(await apiClient.post<TestResult>("/api/ai/test", requestBody));
        } catch (error) {
            console.error("[AiSettingsSection] AI connection test failed", error);
            setTestResult({
                success: false,
                textSupport: false,
                visionSupport: false,
                textError: error instanceof Error ? error.message : String(error),
            });
        } finally {
            setTesting(false);
        }
    };

    const translateError = (error: string) =>
        (t.settings?.ai?.errors as Record<string, string>)?.[error] || error.replace("UNKNOWN:", "");

    return (
        <TabsContent value="ai" className="space-y-4 py-4">
            {loading ? (
                <div className="flex justify-center py-4">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
            ) : (
                <div className="space-y-4 border rounded-lg p-4 bg-muted/30">
                    <div className="space-y-2">
                        <Label>{t.settings?.tabs?.ai || "AI Provider"}</Label>
                        <Select
                            value={config.aiProvider}
                            onValueChange={(aiProvider: AppConfig["aiProvider"]) => setConfig(prev => ({ ...prev, aiProvider }))}
                        >
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="gemini">Google Gemini</SelectItem>
                                <SelectItem value="openai">OpenAI / Compatible</SelectItem>
                                <SelectItem value="azure">Azure OpenAI</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {config.aiProvider === "openai" && (
                        <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <Label>{t.settings?.ai?.instances || "Instance"}</Label>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={addOpenAIInstance}
                                        disabled={instances.length >= MAX_OPENAI_INSTANCES}
                                        className="h-7 px-2 text-xs"
                                    >
                                        <Plus className="h-3 w-3 mr-1" />
                                        {t.settings?.ai?.addInstance || "Add"}
                                    </Button>
                                </div>
                                {instances.length > 0 ? (
                                    <div className="flex gap-2">
                                        <Select value={activeInstanceId || ""} onValueChange={setActiveOpenAIInstance}>
                                            <SelectTrigger className="flex-1">
                                                <SelectValue placeholder={t.settings?.ai?.selectInstance || "Select Instance"} />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {instances.map(instance => (
                                                    <SelectItem key={instance.id} value={instance.id}>{instance.name}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        {instances.length > 1 && (
                                            <ConfirmDialog
                                                title={t.common.delete}
                                                description={t.settings?.ai?.confirmDelete || "Delete this instance?"}
                                                onConfirm={deleteOpenAIInstance}
                                            >
                                                <Button type="button" variant="outline" size="icon" className="h-10 w-10 text-destructive hover:text-destructive">
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </ConfirmDialog>
                                        )}
                                    </div>
                                ) : (
                                    <p className="text-sm text-muted-foreground">
                                        {t.settings?.ai?.noInstances || "No instances configured. Click 'Add' to create one."}
                                    </p>
                                )}
                                {instances.length >= MAX_OPENAI_INSTANCES && (
                                    <p className="text-xs text-amber-600">
                                        {t.settings?.ai?.maxInstancesReached || "Maximum instances reached (10)"}
                                    </p>
                                )}
                            </div>

                            {selectedInstance && (
                                <div className="space-y-3 p-3 border rounded-md bg-background">
                                    <div className="space-y-2">
                                        <Label>{t.settings?.ai?.instanceName || "Instance Name"} <span className="text-destructive">*</span></Label>
                                        <Input
                                            value={selectedInstance.name}
                                            onChange={event => updateOpenAIInstance("name", event.target.value)}
                                            placeholder="e.g. 智谱 GLM-4V"
                                            className={!selectedInstance.name.trim() ? "border-destructive" : ""}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>API Key <span className="text-destructive">*</span></Label>
                                        <div className="relative">
                                            <Input
                                                type={showApiKey ? "text" : "password"}
                                                value={selectedInstance.apiKey}
                                                onChange={event => updateOpenAIInstance("apiKey", event.target.value)}
                                                placeholder="sk-..."
                                                className={`pr-10 ${!selectedInstance.apiKey.trim() ? "border-destructive" : ""}`}
                                            />
                                            <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent" onClick={() => setShowApiKey(value => !value)}>
                                                {showApiKey ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                                            </Button>
                                        </div>
                                    </div>
                                    <div className="space-y-2 pt-4 border-t">
                                        <Label>Base URL <span className="text-destructive">*</span></Label>
                                        <Input
                                            value={selectedInstance.baseUrl}
                                            onChange={event => updateOpenAIInstance("baseUrl", event.target.value)}
                                            placeholder="https://api.openai.com/v1"
                                            className={!selectedInstance.baseUrl.trim() ? "border-destructive" : ""}
                                        />
                                    </div>
                                    <ModelSelector
                                        provider="openai"
                                        apiKey={selectedInstance.apiKey}
                                        baseUrl={selectedInstance.baseUrl}
                                        currentModel={selectedInstance.model}
                                        onModelChange={model => updateOpenAIInstance("model", model)}
                                    />
                                </div>
                            )}
                        </div>
                    )}

                    {config.aiProvider === "gemini" && (
                        <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
                            <div className="space-y-2">
                                <Label>API Key</Label>
                                <div className="relative">
                                    <Input
                                        type={showApiKey ? "text" : "password"}
                                        value={config.gemini?.apiKey || ""}
                                        onChange={event => updateGemini("apiKey", event.target.value)}
                                        placeholder="AIza..."
                                        className="pr-10"
                                    />
                                    <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent" onClick={() => setShowApiKey(value => !value)}>
                                        {showApiKey ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                                    </Button>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label>Base URL (Optional)</Label>
                                <Input
                                    value={config.gemini?.baseUrl || ""}
                                    onChange={event => updateGemini("baseUrl", event.target.value)}
                                    placeholder="https://generativelanguage.googleapis.com"
                                />
                            </div>
                            <ModelSelector
                                provider="gemini"
                                apiKey={config.gemini?.apiKey}
                                baseUrl={config.gemini?.baseUrl}
                                currentModel={config.gemini?.model}
                                onModelChange={model => updateGemini("model", model)}
                            />
                        </div>
                    )}

                    {config.aiProvider === "azure" && (
                        <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
                            <div className="space-y-2">
                                <Label>{t.settings?.ai?.azureEndpoint || "Azure Endpoint"} <span className="text-destructive">*</span></Label>
                                <Input
                                    value={config.azure?.endpoint || ""}
                                    onChange={event => setConfig(prev => ({ ...prev, azure: { ...prev.azure, endpoint: event.target.value } }))}
                                    placeholder={t.settings?.ai?.azureEndpointPlaceholder || "https://your-resource.openai.azure.com"}
                                    className={!config.azure?.endpoint?.trim() ? "border-destructive" : ""}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>{t.settings?.ai?.azureDeployment || "Deployment Name"} <span className="text-destructive">*</span></Label>
                                <Input
                                    value={config.azure?.deploymentName || ""}
                                    onChange={event => setConfig(prev => ({ ...prev, azure: { ...prev.azure, deploymentName: event.target.value } }))}
                                    placeholder={t.settings?.ai?.azureDeploymentPlaceholder || "gpt-4o-deployment"}
                                    className={!config.azure?.deploymentName?.trim() ? "border-destructive" : ""}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>API Key <span className="text-destructive">*</span></Label>
                                <div className="relative">
                                    <Input
                                        type={showApiKey ? "text" : "password"}
                                        value={config.azure?.apiKey || ""}
                                        onChange={event => setConfig(prev => ({ ...prev, azure: { ...prev.azure, apiKey: event.target.value } }))}
                                        placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                                        className={`pr-10 ${!config.azure?.apiKey?.trim() ? "border-destructive" : ""}`}
                                    />
                                    <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent" onClick={() => setShowApiKey(value => !value)}>
                                        {showApiKey ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                                    </Button>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label>{t.settings?.ai?.azureApiVersion || "API Version"}</Label>
                                <Input
                                    value={config.azure?.apiVersion || ""}
                                    onChange={event => setConfig(prev => ({ ...prev, azure: { ...prev.azure, apiVersion: event.target.value } }))}
                                    placeholder={t.settings?.ai?.azureApiVersionPlaceholder || "2024-02-15-preview"}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>{t.settings?.ai?.azureModel || "Model Display Name"}</Label>
                                <Input
                                    value={config.azure?.model || ""}
                                    onChange={event => setConfig(prev => ({ ...prev, azure: { ...prev.azure, model: event.target.value } }))}
                                    placeholder="gpt-4o"
                                />
                            </div>
                        </div>
                    )}

                    <div className="space-y-3 pt-3 border-t">
                        <div className="flex gap-2">
                            <Button type="button" variant="outline" onClick={handleTestConnection} disabled={testing || saving} className="flex-1">
                                {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}
                                {testing ? (t.settings?.ai?.testing || "Testing...") : (t.settings?.ai?.testConnection || "Test Connection")}
                            </Button>
                            <Button onClick={onSave} disabled={saving || testing} className="flex-1">
                                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                {t.settings?.ai?.save || "Save AI Settings"}
                            </Button>
                        </div>

                        {testResult && (
                            <div className={`p-3 rounded-md text-sm ${testResult.success ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"}`}>
                                <div className="flex items-center gap-2 font-medium mb-2">
                                    {testResult.success ? (
                                        <>
                                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                                            <span className="text-green-700">{t.settings?.ai?.testSuccess || "Connection successful"}</span>
                                            {testResult.modelInfo && <span className="text-green-600 text-xs">({testResult.modelInfo})</span>}
                                        </>
                                    ) : (
                                        <>
                                            <XCircle className="h-4 w-4 text-red-600" />
                                            <span className="text-red-700">{t.settings?.ai?.testFailed || "Connection failed"}</span>
                                        </>
                                    )}
                                </div>
                                {testResult.success && (
                                    <div className="space-y-1 text-xs">
                                        <div className="flex items-center gap-2">
                                            <span className="text-muted-foreground">{t.settings?.ai?.textSupport || "Text generation"}:</span>
                                            <span className="text-green-600">{t.settings?.ai?.supported || "Supported"}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-muted-foreground">{t.settings?.ai?.visionSupport || "Vision"}:</span>
                                            <span className={testResult.visionSupport ? "text-green-600" : "text-amber-600"}>
                                                {testResult.visionSupport
                                                    ? (t.settings?.ai?.supported || "Supported")
                                                    : (testResult.visionError ? translateError(testResult.visionError) : (t.settings?.ai?.notSupported || "Not supported"))}
                                            </span>
                                        </div>
                                    </div>
                                )}
                                {!testResult.success && testResult.textError && (
                                    <p className="text-red-600 text-xs mt-1">{translateError(testResult.textError)}</p>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </TabsContent>
    );
}
