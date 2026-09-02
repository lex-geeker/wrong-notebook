"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/components/ui/toast";

interface ConfirmDialogProps {
    children: ReactNode;
    title: string;
    description: string;
    onConfirm: () => void | Promise<void>;
    confirmLabel?: string;
    verificationText?: string;
}

export function ConfirmDialog({ children, title, description, onConfirm, confirmLabel, verificationText }: ConfirmDialogProps) {
    const { t } = useLanguage();
    const { showToast } = useToast();
    const [open, setOpen] = useState(false);
    const [pending, setPending] = useState(false);
    const [verification, setVerification] = useState("");

    const handleConfirm = async () => {
        setPending(true);
        try {
            await onConfirm();
            setOpen(false);
        } catch (cause) {
            showToast(cause instanceof Error ? cause.message : t.common.error, "error");
        } finally {
            setPending(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(nextOpen) => {
            setOpen(nextOpen);
            if (!nextOpen) {
                setVerification("");
            }
        }}>
            <DialogTrigger asChild>{children}</DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>
                {verificationText && (
                    <Input
                        value={verification}
                        onChange={event => setVerification(event.target.value)}
                        placeholder={verificationText}
                        autoComplete="off"
                    />
                )}
                <DialogFooter>
                    <DialogClose asChild>
                        <Button variant="outline" disabled={pending}>{t.common.cancel}</Button>
                    </DialogClose>
                    <Button
                        variant="destructive"
                        disabled={pending || (!!verificationText && verification !== verificationText)}
                        onClick={handleConfirm}
                    >
                        {pending ? t.common.pleaseWait : confirmLabel || t.common.confirm}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
