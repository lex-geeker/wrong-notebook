"use client";

import { useEffect, useState, useRef } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Search, Filter, CheckCircle, Clock, ChevronDown, Printer, ListChecks, Trash2, X, RefreshCw, CheckCheck, ListX } from "lucide-react";
import Link from "next/link";
import { format } from "date-fns";
import { useLanguage } from "@/contexts/LanguageContext";
import { useRouter } from "next/navigation";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { KnowledgeFilter } from "@/components/knowledge-filter";
import { ErrorItemSummary, PaginatedResponse } from "@/types/api";
import { apiClient } from "@/lib/api-client";
import { cleanMarkdown } from "@/lib/markdown-utils";
import { Pagination } from "@/components/ui/pagination";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@/lib/constants/pagination";
import { getMistakeStatusLabel } from "@/lib/mistake-status";
import { loadAllPages } from "@/lib/print-preview";
import { deleteIdsInBatches, type BatchDeleteResponse } from "@/lib/batch-delete";

interface ErrorListProps {
    subjectId: string;
}

type KnowledgeFilterChange = {
    gradeSemester?: string;
    tag?: string | null;
};

export function ErrorList({ subjectId }: ErrorListProps) {
    const [items, setItems] = useState<ErrorItemSummary[]>([]);
    const [, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [masteryFilter, setMasteryFilter] = useState<"all" | "new" | "reviewing" | "mastered">("all");
    const [timeFilter, setTimeFilter] = useState<"all" | "week" | "month">("all");
    const [gradeFilter, setGradeFilter] = useState("");
    const [paperLevelFilter, setPaperLevelFilter] = useState<"all" | "a" | "b" | "other">("all");
    const [selectedTag, setSelectedTag] = useState<string | null>(null);
    const [expandedTags, setExpandedTags] = useState<Set<string>>(new Set());
    // 分页状态
    const [page, setPage] = useState(1);
    const [pageSize] = useState(DEFAULT_PAGE_SIZE);
    const [total, setTotal] = useState(0);
    const [totalPages, setTotalPages] = useState(0);
    // 多选模式状态
    const [isSelectMode, setIsSelectMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isSelectingAll, setIsSelectingAll] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const { t, language } = useLanguage();
    const router = useRouter();
    const selectionRequestRef = useRef(0);

    const buildFilterParams = (query: string) => {
        const params = new URLSearchParams();
        if (subjectId) params.append("subjectId", subjectId);
        if (query) params.append("query", query);
        if (masteryFilter !== "all") {
            params.append("mastery", masteryFilter === "new" ? "0" : masteryFilter === "reviewing" ? "1" : "2");
        }
        if (timeFilter !== "all") params.append("timeRange", timeFilter);
        if (selectedTag) params.append("tag", selectedTag);
        if (gradeFilter) params.append("gradeSemester", gradeFilter);
        if (paperLevelFilter !== "all") params.append("paperLevel", paperLevelFilter);
        return params;
    };

    const handleExportPrint = () => {
        const params = buildFilterParams(search);
        router.push(`/print-preview?${params.toString()}`);
    };

    const handleTagClick = (tag: string) => {
        setSelectedTag(selectedTag === tag ? null : tag);
    };

    const handleFilterChange = ({ gradeSemester, tag }: KnowledgeFilterChange) => {
        setGradeFilter(gradeSemester || "");
        setSelectedTag(tag || null);
        setPage(1);
    };

    const filteredItems = items;

    const toggleTagsExpanded = (itemId: string, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setExpandedTags(prev => {
            const newSet = new Set(prev);
            if (newSet.has(itemId)) {
                newSet.delete(itemId);
            } else {
                newSet.add(itemId);
            }
            return newSet;
        });
    };

    // 多选模式相关函数
    const toggleSelectMode = () => {
        selectionRequestRef.current += 1;
        setIsSelectingAll(false);
        setIsSelectMode(!isSelectMode);
        setSelectedIds(new Set());
    };

    const toggleSelectItem = (id: string, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIds(prev => {
            const newSet = new Set(prev);
            if (newSet.has(id)) {
                newSet.delete(id);
            } else {
                newSet.add(id);
            }
            return newSet;
        });
    };

    const handleSelectAll = async () => {
        if (total === 0 || isSelectingAll) return;

        const requestId = ++selectionRequestRef.current;
        const params = buildFilterParams(debouncedSearch);
        params.set("pageSize", String(MAX_PAGE_SIZE));
        setIsSelectingAll(true);

        try {
            const allItems = await loadAllPages(async (nextPage) => {
                params.set("page", String(nextPage));
                return apiClient.get<PaginatedResponse<ErrorItemSummary>>(`/api/error-items/list?${params.toString()}`);
            });
            if (selectionRequestRef.current === requestId) {
                setSelectedIds(new Set(allItems.map((item) => item.id)));
            }
        } catch (error) {
            if (selectionRequestRef.current === requestId) {
                console.error(error);
                alert(t.notebook?.selectAllFailed || "Failed to select all items");
            }
        } finally {
            if (selectionRequestRef.current === requestId) setIsSelectingAll(false);
        }
    };

    const handleBatchDelete = async () => {
        if (selectedIds.size === 0) return;

        const confirmMsg = (t.notebook?.confirmBatchDelete || "Delete {count} items?")
            .replace("{count}", selectedIds.size.toString());
        if (!confirm(confirmMsg)) return;

        setIsDeleting(true);
        try {
            const ids = Array.from(selectedIds);
            const result = await deleteIdsInBatches(ids, (batch) =>
                apiClient.post<BatchDeleteResponse>("/api/error-items/batch-delete", { ids: batch }),
            );
            setSelectedIds(new Set(result.remainingIds));
            await fetchItems();

            if (result.error || result.remainingIds.length > 0) {
                if (result.error) console.error(result.error);
                alert((t.notebook?.batchDeletePartial || "Deleted {deleted}; {remaining} remain selected")
                    .replace("{deleted}", result.deletedCount.toString())
                    .replace("{remaining}", result.remainingIds.length.toString()));
                return;
            }

            alert(t.notebook?.batchDeleteSuccess || "Deleted successfully");
            setIsSelectMode(false);
            setSelectedIds(new Set());
        } catch (error) {
            console.error(error);
            alert(t.common?.messages?.deleteFailed || "Delete failed");
        } finally {
            setIsDeleting(false);
        }
    };

    // 追踪筛选条件是否变化（用于判断是否需要重置页码）
    const prevFiltersRef = useRef({ search, masteryFilter, timeFilter, selectedTag, subjectId, gradeFilter, paperLevelFilter });

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search), 250);
        return () => clearTimeout(timer);
    }, [search]);

    useEffect(() => {
        const prevFilters = prevFiltersRef.current;
        const filtersChanged =
            prevFilters.search !== debouncedSearch ||
            prevFilters.masteryFilter !== masteryFilter ||
            prevFilters.timeFilter !== timeFilter ||
            prevFilters.selectedTag !== selectedTag ||
            prevFilters.subjectId !== subjectId ||
            prevFilters.gradeFilter !== gradeFilter ||
            prevFilters.paperLevelFilter !== paperLevelFilter;

        // 更新 ref
        prevFiltersRef.current = { search: debouncedSearch, masteryFilter, timeFilter, selectedTag, subjectId, gradeFilter, paperLevelFilter };

        if (filtersChanged) {
            selectionRequestRef.current += 1;
            setIsSelectingAll(false);
            setSelectedIds(new Set());
        }

        if (filtersChanged && page !== 1) {
            // 筛选条件变化且不在第一页，重置到第一页（会再次触发此 effect）
            setPage(1);
            return;
        }

        // 正常请求数据
        const controller = new AbortController();
        fetchItems(controller.signal);
        return () => controller.abort();
    }, [page, debouncedSearch, masteryFilter, timeFilter, selectedTag, subjectId, gradeFilter, paperLevelFilter]);

    const fetchItems = async (signal?: AbortSignal) => {
        setLoading(true);
        try {
            const params = buildFilterParams(debouncedSearch);
            // 分页参数
            params.append("page", page.toString());
            params.append("pageSize", pageSize.toString());

            const response = await apiClient.get<PaginatedResponse<ErrorItemSummary>>(`/api/error-items/list?${params.toString()}`, { signal });
            setItems(response.items);
            setTotal(response.total);
            setTotalPages(response.totalPages);
        } catch (error) {
            if (signal?.aborted) return;
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className={`space-y-6 ${isSelectMode ? "pb-40 sm:pb-24" : ""}`}>
            <div className="flex flex-col sm:flex-row gap-4">
                <div className="relative w-full sm:flex-1">
                    <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder={t.notebook.search}
                        className="pl-9"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline">
                            <Filter className="mr-2 h-4 w-4" />
                            {t.notebook.filter}
                            <ChevronDown className="ml-2 h-4 w-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuLabel>{t.filter.masteryStatus || "Mastery Status"}</DropdownMenuLabel>
                        <DropdownMenuItem onClick={() => setMasteryFilter("all")}>
                            {masteryFilter === "all" && "✓ "}{t.filter.all || "All"}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setMasteryFilter("new")}>
                            {masteryFilter === "new" && "✓ "}{t.filter.review || "To Review"}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setMasteryFilter("reviewing")}>
                            {masteryFilter === "reviewing" && "✓ "}{t.filter.reviewing || "Reviewing"}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setMasteryFilter("mastered")}>
                            {masteryFilter === "mastered" && "✓ "}{t.filter.mastered || "Mastered"}
                        </DropdownMenuItem>

                        <DropdownMenuSeparator />

                        <DropdownMenuLabel>{t.filter.timeRange || "Time Range"}</DropdownMenuLabel>
                        <DropdownMenuItem onClick={() => setTimeFilter("all")}>
                            {timeFilter === "all" && "✓ "}{t.filter.allTime || "All Time"}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setTimeFilter("week")}>
                            {timeFilter === "week" && "✓ "}{t.filter.lastWeek || "Last Week"}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setTimeFilter("month")}>
                            {timeFilter === "month" && "✓ "}{t.filter.lastMonth || "Last Month"}
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
                <Button variant="outline" onClick={handleExportPrint}>
                    <Printer className="mr-2 h-4 w-4" />
                    {t.notebook?.exportPrint || "导出打印"}
                </Button>
                <Button
                    variant={isSelectMode ? "secondary" : "outline"}
                    onClick={toggleSelectMode}
                    disabled={isSelectingAll || isDeleting}
                >
                    <ListChecks className="mr-2 h-4 w-4" />
                    {isSelectMode ? (t.notebook?.cancelSelect || "取消") : (t.notebook?.selectMode || "多选")}
                </Button>
            </div>

            {/* Advanced Filters Row */}
            <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-center">
                <div className="w-full sm:w-auto">
                    <KnowledgeFilter
                        subjectId={subjectId}
                        gradeSemester={gradeFilter}
                        tag={selectedTag}
                        onFilterChange={handleFilterChange}
                    />
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button
                        variant={paperLevelFilter === "all" ? "secondary" : "outline"}
                        size="sm"
                        onClick={() => setPaperLevelFilter("all")}
                    >
                        {t.filter.all || "All"}
                    </Button>
                    <Button
                        variant={paperLevelFilter === "a" ? "secondary" : "outline"}
                        size="sm"
                        onClick={() => setPaperLevelFilter("a")}
                    >
                        {t.editor.paperLevels?.a || "Paper A"}
                    </Button>
                    <Button
                        variant={paperLevelFilter === "b" ? "secondary" : "outline"}
                        size="sm"
                        onClick={() => setPaperLevelFilter("b")}
                    >
                        {t.editor.paperLevels?.b || "Paper B"}
                    </Button>
                    <Button
                        variant={paperLevelFilter === "other" ? "secondary" : "outline"}
                        size="sm"
                        onClick={() => setPaperLevelFilter("other")}
                    >
                        {t.editor.paperLevels?.other || "Other"}
                    </Button>
                </div>
            </div>

            {selectedTag && (
                <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
                    <span className="text-sm text-muted-foreground">
                        {t.filter.filteringByTag || "Filtering by tag"}:
                    </span>
                    <Badge variant="secondary" className="cursor-pointer" onClick={() => setSelectedTag(null)}>
                        {selectedTag}
                        <span className="ml-1 text-xs">×</span>
                    </Badge>
                </div>
            )}

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {filteredItems.map((item) => {
                    const tags = item.tags.map((tag) => tag.name);
                    const mastered = item.masteryLevel === 2;
                    const reviewing = item.masteryLevel === 1;
                    return (
                        <div key={item.id} className="relative">
                            {/* 选择模式下的复选框 */}
                            {isSelectMode && (
                                <div
                                    className="absolute top-2 left-2 z-10"
                                    onClick={(e) => toggleSelectItem(item.id, e)}
                                >
                                    <Checkbox
                                        checked={selectedIds.has(item.id)}
                                        className="h-5 w-5 border-2 bg-background shadow-sm"
                                    />
                                </div>
                            )}
                            <Link href={isSelectMode ? "#" : `/error-items/${item.id}`} onClick={(e) => isSelectMode && e.preventDefault()}>
                                <Card className="h-full hover:border-primary/50 transition-colors cursor-pointer gap-2 pt-4">
                                    <CardHeader className="pb-0">
                                        <div className="flex justify-between items-start">
                                            <Badge
                                                variant={mastered ? "default" : reviewing ? "secondary" : "outline"}
                                                className={mastered ? "bg-green-600 hover:bg-green-700" : reviewing ? "text-amber-700 dark:text-amber-300" : ""}
                                            >
                                                {mastered ? (
                                                    <span className="flex items-center gap-1">
                                                        <CheckCircle className="h-3 w-3" /> {t.notebook.mastered}
                                                    </span>
                                                ) : reviewing ? (
                                                    <span className="flex items-center gap-1">
                                                        <RefreshCw className="h-3 w-3" /> {t.filter.reviewing}
                                                    </span>
                                                ) : (
                                                    <span className="flex items-center gap-1">
                                                        <Clock className="h-3 w-3" /> {t.notebook.review}
                                                    </span>
                                                )}
                                            </Badge>
                                            <span className="text-xs text-muted-foreground">
                                                {format(new Date(item.createdAt), "MM/dd")}
                                            </span>
                                        </div>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="text-sm line-clamp-3">
                                            {(() => {
                                                // 提取文本并清理 LaTeX/Markdown 格式
                                                const rawText = (item.questionText || "").split('\n\n')[0]; // 取第一段
                                                const cleanText = cleanMarkdown(rawText);

                                                return cleanText.length > 80
                                                    ? cleanText.substring(0, 80) + "..."
                                                    : cleanText;
                                            })()}
                                        </div>
                                        <div className="flex flex-wrap gap-2 mt-3">
                                            <Badge variant={item.mistakeStatus === "wrong_attempt" ? "default" : "secondary"} className="text-xs">
                                                {getMistakeStatusLabel(item.mistakeStatus, language)}
                                            </Badge>
                                        </div>
                                        <div className="flex flex-wrap gap-2 mt-3">
                                            {(expandedTags.has(item.id) ? tags : tags.slice(0, 3)).map((tag: string) => (
                                                <Badge
                                                    key={tag}
                                                    variant={selectedTag === tag ? "default" : "outline"}
                                                    className="text-xs cursor-pointer hover:bg-primary/10 transition-colors"
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        handleTagClick(tag);
                                                    }}
                                                >
                                                    {tag}
                                                </Badge>
                                            ))}
                                            {tags.length > 3 && (
                                                <Badge
                                                    variant="secondary"
                                                    className="text-xs cursor-pointer hover:bg-secondary/80 transition-colors"
                                                    title={expandedTags.has(item.id)
                                                        ? (t.notebooks?.collapseTagsTooltip || "Click to collapse")
                                                        : (t.notebooks?.expandTagsTooltip || "Click to expand {count} tags").replace("{count}", (tags.length - 3).toString())}
                                                    onClick={(e) => toggleTagsExpanded(item.id, e)}
                                                >
                                                    {expandedTags.has(item.id) ? (
                                                        <>{t.notebooks?.collapseTags || "Collapse"}</>
                                                    ) : (
                                                        <>{(t.notebooks?.expandTags || "+{count} more").replace("{count}", (tags.length - 3).toString())}</>
                                                    )}
                                                </Badge>
                                            )}
                                        </div>
                                    </CardContent>
                                </Card>
                            </Link>
                        </div>
                    );
                })}
            </div>

            {/* 分页器 */}
            <Pagination
                page={page}
                totalPages={totalPages}
                total={total}
                pageSize={pageSize}
                onPageChange={setPage}
            />

            {/* 多选模式底部操作栏 */}
            {isSelectMode && (
                <div className="fixed bottom-0 left-0 right-0 bg-background border-t shadow-lg p-4 z-50">
                    <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-3">
                        <span className="min-w-28 flex-1 text-sm text-muted-foreground">
                            {(t.notebook?.selectedCount || "{count} selected").replace("{count}", selectedIds.size.toString())}
                        </span>
                        <div className="flex w-full flex-wrap justify-end gap-2 sm:w-auto">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleSelectAll}
                                disabled={isSelectingAll || isDeleting || total === 0 || selectedIds.size === total}
                            >
                                {isSelectingAll ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <CheckCheck className="mr-2 h-4 w-4" />}
                                {isSelectingAll
                                    ? (t.notebook?.selectingAll || "Selecting...")
                                    : (t.notebook?.selectAll || "Select all {count}").replace("{count}", total.toString())}
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setSelectedIds(new Set())}
                                disabled={selectedIds.size === 0 || isSelectingAll || isDeleting}
                            >
                                <ListX className="mr-2 h-4 w-4" />
                                {t.notebook?.selectNone || "Select none"}
                            </Button>
                            <Button
                                variant="outline"
                                onClick={toggleSelectMode}
                                size="sm"
                                disabled={isSelectingAll || isDeleting}
                            >
                                <X className="mr-2 h-4 w-4" />
                                {t.notebook?.cancelSelect || "取消"}
                            </Button>
                            <Button
                                variant="destructive"
                                onClick={handleBatchDelete}
                                size="sm"
                                disabled={selectedIds.size === 0 || isSelectingAll || isDeleting}
                            >
                                {isDeleting ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                                {isDeleting ? t.common.loading : (t.notebook?.deleteSelected || "删除选中")}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
