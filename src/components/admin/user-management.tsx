"use client";

import { useCallback, useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Trash2, Ban, CheckCircle, Loader2 } from "lucide-react";
import { apiClient, ApiError } from "@/lib/api-client";
import { AdminUser, AppConfig } from "@/types/api";
import { ConfirmDialog } from "@/components/confirm-dialog";

export function UserManagement() {
    const { data: session } = useSession();
    const { t } = useLanguage();
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [loading, setLoading] = useState(true);
    const [allowRegistration, setAllowRegistration] = useState(true);
    const [savingRegistration, setSavingRegistration] = useState(false);
    const [feedback, setFeedback] = useState<{ role: "status" | "alert"; message: string } | null>(null);

    const fetchConfig = useCallback(async () => {
        try {
            const data = await apiClient.get<AppConfig>("/api/settings");
            setAllowRegistration(data.allowRegistration !== false);
        } catch (error) {
            console.error("Failed to fetch config", error);
            setFeedback({ role: "alert", message: t.common.error });
        }
    }, [t.common.error]);

    const handleToggleRegistration = async (checked: boolean) => {
        setSavingRegistration(true);
        try {
            await apiClient.post("/api/settings", { allowRegistration: checked });
            setAllowRegistration(checked);
            setFeedback({ role: "status", message: t.common.messages?.saveSuccess || "Saved successfully" });
        } catch (error) {
            console.error("Failed to update registration setting", error);
            setFeedback({ role: "alert", message: t.common.error });
        } finally {
            setSavingRegistration(false);
        }
    };

    const fetchUsers = useCallback(async () => {
        setLoading(true);
        try {
            const data = await apiClient.get<AdminUser[]>("/api/admin/users");
            setUsers(data);
        } catch (error) {
            console.error("Failed to fetch users", error);
            setFeedback({ role: "alert", message: t.common.error });
        } finally {
            setLoading(false);
        }
    }, [t.common.error]);

    useEffect(() => {
        fetchUsers();
        fetchConfig();
    }, [fetchConfig, fetchUsers]);

    const handleToggleStatus = async (user: AdminUser) => {
        try {
            await apiClient.patch(`/api/admin/users/${user.id}`, { isActive: !user.isActive });
            await fetchUsers();
            setFeedback({ role: "status", message: t.common.messages?.saveSuccess || "Saved successfully" });
        } catch (error) {
            console.error("Failed to update user status", error);
            setFeedback({ role: "alert", message: t.common.error });
        }
    };

    const handleDelete = async (user: AdminUser) => {
        try {
            await apiClient.delete(`/api/admin/users/${user.id}`);
            await fetchUsers();
            setFeedback({ role: "status", message: t.common.messages?.deleteSuccess || "Deleted successfully" });
        } catch (error: unknown) {
            console.error("Failed to delete user", error);
            const data = error instanceof ApiError ? error.data : null;
            const text = data && typeof data === "object" && "message" in data && typeof data.message === "string" ? data.message : t.common.error;
            setFeedback({ role: "alert", message: text });
        }
    };

    if (loading) {
        return <div className="flex justify-center py-8"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
    }

    return (
        <div className="space-y-4">
            {feedback && (
                <p role={feedback.role} className={`rounded-md border p-3 text-sm ${feedback.role === "alert" ? "border-destructive/30 bg-destructive/5 text-destructive" : "border-green-600/30 bg-green-50 text-green-800 dark:bg-green-950/30 dark:text-green-300"}`}>
                    {feedback.message}
                </p>
            )}
            {/* 注册开关 */}
            <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/30">
                <div className="space-y-0.5">
                    <Label className="text-base">
                        {t.admin?.allowRegistration || "Allow New Registrations"}
                    </Label>
                    <p className="text-sm text-muted-foreground">
                        {t.admin?.allowRegistrationDesc || "When disabled, new users cannot register"}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {savingRegistration && <Loader2 className="h-4 w-4 animate-spin" />}
                    <Switch
                        checked={allowRegistration}
                        onCheckedChange={handleToggleRegistration}
                        disabled={savingRegistration}
                    />
                </div>
            </div>

            {/* 移动端卡片视图 */}
            <div className="sm:hidden space-y-3">
                {users.map((user) => (
                    <div key={user.id} className="border rounded-lg p-4 bg-card space-y-3">
                        <div className="flex justify-between items-start">
                            <div>
                                <div className="font-medium">{user.name || "N/A"}</div>
                                <div className="text-sm text-muted-foreground">{user.email}</div>
                            </div>
                            <Badge variant={user.role === "admin" ? "default" : "secondary"}>
                                {user.role === "admin" ? t.admin.admin : t.admin.user}
                            </Badge>
                        </div>
                        <div className="flex justify-between text-sm">
                            <div className="text-muted-foreground">
                                {t.admin.errors}: {user._count.errorItems} | {t.admin.practiceCount}: {user._count.practiceRecords}
                            </div>
                            <Badge variant={user.isActive ? "default" : "destructive"} className="text-xs">
                                {user.isActive ? t.admin.active : t.admin.disabled}
                            </Badge>
                        </div>
                        <div className="flex justify-between items-center pt-2 border-t">
                            <div className="text-xs text-muted-foreground">
                                {new Date(user.createdAt).toLocaleDateString()}
                            </div>
                            <div className="flex gap-2">
                                <ConfirmDialog
                                    title={user.isActive ? t.admin.disable : t.admin.enable}
                                    description={user.isActive ? t.admin.confirmDisable : t.admin.confirmEnable}
                                    onConfirm={() => handleToggleStatus(user)}
                                >
                                    <Button variant="ghost" size="sm" disabled={user.id === session?.user?.id}>
                                        {user.isActive ? <Ban className="h-4 w-4 text-orange-500" /> : <CheckCircle className="h-4 w-4 text-green-500" />}
                                    </Button>
                                </ConfirmDialog>
                                <ConfirmDialog title={t.admin.delete} description={t.admin.confirmDelete} onConfirm={() => handleDelete(user)}>
                                    <Button variant="ghost" size="sm" disabled={user.id === session?.user?.id}>
                                        <Trash2 className="h-4 w-4 text-destructive" />
                                    </Button>
                                </ConfirmDialog>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* 桌面端表格视图 */}
            <div className="hidden sm:block border rounded-lg overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>{t.admin.nameEmail}</TableHead>
                            <TableHead>{t.admin.role}</TableHead>
                            <TableHead>{t.admin.stats}</TableHead>
                            <TableHead>{t.admin.createdAt}</TableHead>
                            <TableHead>{t.admin.status}</TableHead>
                            <TableHead className="text-right">{t.admin.actions}</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {users.map((user) => (
                            <TableRow key={user.id}>
                                <TableCell>
                                    <div className="font-medium">{user.name || "N/A"}</div>
                                    <div className="text-sm text-muted-foreground">{user.email}</div>
                                </TableCell>
                                <TableCell>
                                    <Badge variant={user.role === "admin" ? "default" : "secondary"}>
                                        {user.role === "admin" ? t.admin.admin : t.admin.user}
                                    </Badge>
                                </TableCell>
                                <TableCell>
                                    <div className="text-sm">
                                        {t.admin.errors}: {user._count.errorItems}
                                    </div>
                                    <div className="text-sm">
                                        {t.admin.practiceCount}: {user._count.practiceRecords}
                                    </div>
                                </TableCell>
                                <TableCell>
                                    {new Date(user.createdAt).toLocaleDateString()}
                                </TableCell>
                                <TableCell>
                                    <Badge variant={user.isActive ? "default" : "destructive"}>
                                        {user.isActive ? t.admin.active : t.admin.disabled}
                                    </Badge>
                                </TableCell>
                                <TableCell className="text-right space-x-2">
                                    <ConfirmDialog
                                        title={user.isActive ? t.admin.disable : t.admin.enable}
                                        description={user.isActive ? t.admin.confirmDisable : t.admin.confirmEnable}
                                        onConfirm={() => handleToggleStatus(user)}
                                    >
                                        <Button variant="ghost" size="sm" disabled={user.id === session?.user?.id} title={user.isActive ? t.admin.disable : t.admin.enable}>
                                            {user.isActive ? <Ban className="h-4 w-4 text-orange-500" /> : <CheckCircle className="h-4 w-4 text-green-500" />}
                                        </Button>
                                    </ConfirmDialog>
                                    <ConfirmDialog title={t.admin.delete} description={t.admin.confirmDelete} onConfirm={() => handleDelete(user)}>
                                        <Button variant="ghost" size="sm" disabled={user.id === session?.user?.id} title={t.admin.delete}>
                                            <Trash2 className="h-4 w-4 text-destructive" />
                                        </Button>
                                    </ConfirmDialog>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
