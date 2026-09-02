"use client";

import { useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { useLanguage } from "@/contexts/LanguageContext";

interface CreateNotebookDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCreate: (name: string) => Promise<void>;
}

export function CreateNotebookDialog({ open, onOpenChange, onCreate }: CreateNotebookDialogProps) {
    const [name, setName] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const { t } = useLanguage();

    const handleCreate = async () => {
        if (!name.trim()) {
            setError(t.notebooks?.dialog?.enterName || "Please enter notebook name");
            return;
        }

        setLoading(true);
        setError("");
        try {
            await onCreate(name.trim());
            setName("");
            onOpenChange(false);
        } catch (error) {
            console.error(error);
            setError(error instanceof Error ? error.message : t.common.error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(nextOpen) => {
            onOpenChange(nextOpen);
            if (!nextOpen) setError("");
        }}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t.notebooks?.dialog?.title || "Create New Notebook"}</DialogTitle>
                    <DialogDescription>
                        {t.notebooks?.dialog?.desc || "Create separate notebooks for different subjects or chapters"}
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <div className="space-y-2">
                        <Label htmlFor="name">{t.notebooks?.dialog?.nameLabel || "Notebook Name"}</Label>
                        <Input
                            id="name"
                            placeholder={t.notebooks?.dialog?.placeholder || "e.g. Math, Physics, Chemistry..."}
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                        />
                    </div>
                    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        {t.common.cancel}
                    </Button>
                    <Button onClick={handleCreate} disabled={loading || !name.trim()}>
                        {loading ? (t.notebooks?.dialog?.creating || "Creating...") : (t.notebooks?.dialog?.create || "Create")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
