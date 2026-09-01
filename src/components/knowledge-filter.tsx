"use client";

import { useEffect, useState } from "react";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { apiClient } from "@/lib/api-client";
import type { ErrorItemFilterOptions } from "@/types/api";

interface KnowledgeFilterProps {
    subjectId: string;
    gradeSemester?: string;
    tag?: string | null;
    onFilterChange: (filters: {
        gradeSemester?: string;
        tag?: string;
    }) => void;
    className?: string;
}

export function KnowledgeFilter({
    subjectId,
    gradeSemester,
    tag,
    onFilterChange,
    className,
}: KnowledgeFilterProps) {
    const [options, setOptions] = useState<ErrorItemFilterOptions>({ grades: [], tags: [] });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        apiClient
            .get<ErrorItemFilterOptions>(`/api/error-items/filter-options?subjectId=${encodeURIComponent(subjectId)}`)
            .then(setOptions)
            .catch((error) => {
                console.error("Failed to load filter options:", error);
                setOptions({ grades: [], tags: [] });
            })
            .finally(() => setLoading(false));
    }, [subjectId]);

    const handleGradeChange = (value: string) => {
        onFilterChange({
            gradeSemester: value === "all" ? undefined : value,
            tag: tag || undefined,
        });
    };

    const handleTagChange = (value: string) => {
        onFilterChange({
            gradeSemester: gradeSemester || undefined,
            tag: value === "all" ? undefined : value,
        });
    };

    return (
        <div className={`flex flex-wrap gap-2 ${className || ""}`}>
            <Select value={gradeSemester || "all"} onValueChange={handleGradeChange} disabled={loading}>
                <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder="年级/学期" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">全部年级</SelectItem>
                    {options.grades.map((grade) => (
                        <SelectItem key={grade} value={grade}>{grade}</SelectItem>
                    ))}
                </SelectContent>
            </Select>

            <Select value={tag || "all"} onValueChange={handleTagChange} disabled={loading}>
                <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder="知识点" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">全部知识点</SelectItem>
                    {options.tags.map((name) => (
                        <SelectItem key={name} value={name}>{name}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );
}
