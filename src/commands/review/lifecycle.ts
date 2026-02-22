import { teardownSessionAuth } from "../../agents/runtime/registry.js";
import {
  flushReviewRecordBuffer,
  rewriteReviewRecord,
} from "../../reviews/records/persistence.js";
import type { ReviewStatus } from "../../status/index.js";
import { toErrorMessage } from "../../utils/errors.js";

export const REVIEW_ABORT_DETAIL = "Review aborted before reviewer completed.";

interface ActiveReviewContext {
  root: string;
  reviewsFilePath: string;
  reviewId: string;
  reviewerAgentIds: readonly string[];
}

let activeReview: ActiveReviewContext | undefined;
let terminationInFlight = false;

export function registerActiveReview(context: ActiveReviewContext): void {
  activeReview = context;
}

export function clearActiveReview(reviewId: string): void {
  if (activeReview?.reviewId !== reviewId) {
    return;
  }
  if (!terminationInFlight) {
    activeReview = undefined;
  }
}

export async function terminateActiveReview(
  status: Extract<ReviewStatus, "failed" | "aborted">,
): Promise<void> {
  if (!activeReview || terminationInFlight) {
    return;
  }

  terminationInFlight = true;
  const context = activeReview;
  let persistenceError: Error | undefined;

  try {
    await rewriteReviewRecord({
      root: context.root,
      reviewsFilePath: context.reviewsFilePath,
      sessionId: context.reviewId,
      mutate: (existing) => {
        const failedAt = new Date().toISOString();
        const detail =
          status === "aborted" ? REVIEW_ABORT_DETAIL : "Review failed.";

        const reviewers = existing.reviewers.map((reviewer) => {
          if (reviewer.status !== "running") {
            return reviewer;
          }
          return {
            ...reviewer,
            status,
            completedAt: reviewer.completedAt ?? failedAt,
            error: reviewer.error ?? detail,
          };
        });

        const sessionStatus =
          existing.status === "running" ? status : existing.status;
        const sessionCompletedAt =
          existing.status === "running"
            ? (existing.completedAt ?? failedAt)
            : existing.completedAt;

        if (
          sessionStatus === existing.status &&
          sessionCompletedAt === existing.completedAt &&
          reviewers.every(
            (reviewer, index) => reviewer === existing.reviewers[index],
          )
        ) {
          return existing;
        }

        return {
          ...existing,
          status: sessionStatus,
          completedAt: sessionCompletedAt,
          error: existing.error ?? detail,
          reviewers,
        };
      },
      forceFlush: true,
    });
    await flushReviewRecordBuffer({
      reviewsFilePath: context.reviewsFilePath,
      sessionId: context.reviewId,
    });
  } catch (error) {
    persistenceError =
      error instanceof Error ? error : new Error(toErrorMessage(error));
    console.error(
      `[voratiq] Failed to finalize review ${context.reviewId}: ${toErrorMessage(error)}`,
    );
  } finally {
    try {
      await teardownSessionAuth(context.reviewId);
    } finally {
      terminationInFlight = false;
      activeReview = undefined;
    }
  }

  if (persistenceError) {
    throw persistenceError;
  }
}
