export const ERROR_SOURCES = ["homework", "quiz", "exam", "other"] as const;
export const ERROR_TYPES = ["knowledge", "reading", "method", "calculation_writing", "omission", "other"] as const;

export type ErrorSource = typeof ERROR_SOURCES[number];
export type ErrorType = typeof ERROR_TYPES[number];

export const ERROR_SOURCE_LABELS: Record<ErrorSource, { zh: string; en: string }> = {
    homework: { zh: "作业", en: "Homework" },
    quiz: { zh: "小测", en: "Quiz" },
    exam: { zh: "考试", en: "Exam" },
    other: { zh: "其他", en: "Other" },
};

export const ERROR_TYPE_LABELS: Record<ErrorType, { zh: string; en: string }> = {
    knowledge: { zh: "知识点没掌握", en: "Knowledge gap" },
    reading: { zh: "审题不清", en: "Misread question" },
    method: { zh: "方法不对", en: "Wrong method" },
    calculation_writing: { zh: "计算或书写错误", en: "Calculation or writing" },
    omission: { zh: "漏题漏步骤", en: "Omission" },
    other: { zh: "其他", en: "Other" },
};

export function metadataLabel(
    value: string | null | undefined,
    labels: Record<string, { zh: string; en: string }>,
    language: string,
) {
    return value ? labels[value]?.[language === "zh" ? "zh" : "en"] || value : "";
}
