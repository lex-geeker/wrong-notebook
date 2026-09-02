import { addDays } from "date-fns";

// Ebbinghaus intervals in days: 1, 2, 4, 7, 15, 30
export const REVIEW_INTERVALS = [1, 2, 4, 7, 15, 30] as const;

export function calculateNextReviewDate(currentStage: number, from = new Date()): Date {
    const interval = REVIEW_INTERVALS[currentStage] || 30; // Default to 30 if stage exceeds
    return addDays(from, interval);
}
