"use client";

import { useState, useEffect } from "react";
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
import { useToast } from "@/components/ui/toast";

interface RenameNotebookDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    currentName: string;
    onRename: (name: string) => Promise<void>;
}

export function RenameNotebookDialog({ open, onOpenChange, currentName, onRename }: RenameNotebookDialogProps) {
    const [name, setName] = useState(currentName);
    const [loading, setLoading] = useState(false);
    const { t } = useLanguage();
    const { showToast } = useToast();

    useEffect(() => {
        setName(currentName);
    }, [currentName]);

    const handleRename = async () => {
        if (!name.trim()) {
            showToast(t.notebooks?.renameDialog?.enterName || "Please enter notebook name", "error");
            return;
        }

        setLoading(true);
        try {
            await onRename(name.trim());
            onOpenChange(false);
        } catch (error) {
            console.error(error);
            showToast(error instanceof Error ? error.message : t.common.error, "error");
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t.notebooks?.renameDialog?.title || "Rename Notebook"}</DialogTitle>
                    <DialogDescription className="sr-only">
                        Enter a new name for this notebook.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <div className="space-y-2">
                        <Label htmlFor="rename-name">{t.notebooks?.renameDialog?.nameLabel || "New Name"}</Label>
                        <Input
                            id="rename-name"
                            placeholder={t.notebooks?.renameDialog?.placeholder || "Enter new notebook name"}
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleRename()}
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        {t.common.cancel}
                    </Button>
                    <Button onClick={handleRename} disabled={loading || !name.trim()}>
                        {loading ? (t.notebooks?.renameDialog?.renaming || "Renaming...") : (t.notebooks?.renameDialog?.rename || "Rename")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
