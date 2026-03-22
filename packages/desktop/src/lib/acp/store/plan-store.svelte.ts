/**
 * Plan Store - Manages plan data for sessions.
 *
 * Supports two modes:
 * 1. Streaming: Plans arrive via Plan events with content field populated.
 *    The plan shows immediately and updates as content streams.
 * 2. Disk-based: Fallback for historical sessions - loads plan from disk.
 */

import { getContext, setContext } from "svelte";
import { SvelteMap, SvelteSet } from "svelte/reactivity";

import type { PlanData, SessionPlanResponse } from "../../services/converted-session-types.js";

import { tauriClient } from "../../utils/tauri-client.js";
import { createLogger } from "../utils/logger.js";

const PLAN_STORE_KEY = Symbol("plan-store");
const logger = createLogger({ id: "plan-store", name: "PlanStore" });

/** State for streaming plans received via Plan events. */
interface StreamingPlanState {
	content: string;
	title: string | null;
	filePath: string | null;
	isStreaming: boolean;
	derivedFromSteps: boolean;
	source: "deterministic" | "heuristic" | null;
	confidence: "high" | "medium" | null;
	hasPlan: boolean;
	updatedAt: number | null;
}

export class PlanStore {
	// Map<sessionId, plan> - disk-based plans (historical sessions)
	plans = $state(new SvelteMap<string, SessionPlanResponse | null>());

	// Map<sessionId, state> - streaming plans from live Plan events
	streamingPlans = $state(new SvelteMap<string, StreamingPlanState>());

	// Set<sessionId> - tracks which sessions are currently loading from disk
	loading = $state(new SvelteSet<string>());

	/**
	 * Update plan from a Plan event.
	 * This is the primary path for live sessions - plan content streams directly.
	 */
	updateFromEvent(sessionId: string, planData: PlanData): void {
		const source = planData.source ?? null;
		const confidence = planData.confidence ?? null;
		const normalizedContent = this.getNormalizedContent(planData);
		const hasPlan =
			planData.hasPlan === true || normalizedContent !== null || planData.streaming === true;
		const updatedAt = planData.updatedAt ?? null;
		const incomingRank = this.sourceRank(source, confidence);
		const existing = this.streamingPlans.get(sessionId);
		const existingRank = existing ? this.sourceRank(existing.source, existing.confidence) : -1;

		// Deterministic signals always win over heuristic signals.
		if (incomingRank < existingRank) {
			return;
		}

		if (normalizedContent === null && !hasPlan) {
			return;
		}

		// Check if incoming event has actual file content vs generated from steps
		const incomingHasFileContent =
			typeof planData.contentMarkdown === "string" || typeof planData.content === "string";
		const derivedFromSteps = !incomingHasFileContent && planData.steps.length > 0;

		// Don't let steps-only events overwrite existing file content.
		// Steps-only events (e.g., from TodoWrite) should not replace actual plan file content.
		if (existing?.content && !incomingHasFileContent && planData.steps.length > 0) {
			logger.debug("Skipping steps-only plan update - preserving existing file content", {
				sessionId,
				existingContentLength: existing.content.length,
				incomingStepsCount: planData.steps.length,
			});
			return;
		}

		logger.debug("Plan event received", {
			sessionId,
			streaming: planData.streaming,
			hasContent: normalizedContent !== null,
			title: planData.title,
			source,
			confidence,
		});

		// Update streaming plan state
		this.streamingPlans.set(sessionId, {
			content: normalizedContent ?? existing?.content ?? "",
			title: planData.title ?? null,
			filePath: planData.filePath ?? null,
			isStreaming: planData.streaming ?? false,
			derivedFromSteps,
			source,
			confidence,
			hasPlan,
			updatedAt,
		});

		// When streaming is complete, also update the disk-based plan store
		// so that getPlan always has the final content
		if (!planData.streaming && normalizedContent) {
			this.plans.set(sessionId, {
				slug: this.extractSlug(planData.filePath ?? null),
				content: normalizedContent,
				title: planData.title ?? "Plan",
				summary: null,
				filePath: planData.filePath ?? null,
			});
		}
	}

	shouldAutoOpen(sessionId: string, preferInline: boolean): boolean {
		if (preferInline) return false;

		const state = this.streamingPlans.get(sessionId);
		if (!state) return false;
		if (state.isStreaming) return true;
		if (!state.hasPlan) return false;
		if (!state.derivedFromSteps) return true;
		return state.source === "deterministic";
	}

	/**
	 * Load a plan from disk for a session.
	 * Used as fallback for historical sessions that don't have streaming events.
	 */
	loadPlan(sessionId: string, projectPath: string, agentId: string): void {
		// Skip if we already have streaming content
		if (this.streamingPlans.has(sessionId)) {
			return;
		}

		// Skip if already loaded from disk
		if (this.plans.has(sessionId)) {
			return;
		}

		logger.debug("Loading plan from disk", { sessionId, projectPath, agentId });

		// Mark as loading
		this.loading.add(sessionId);

		// Single attempt to load from disk (no retry - streaming is the primary path)
		tauriClient.history.getUnifiedPlan(sessionId, projectPath, agentId).match(
			(plan) => {
				this.plans.set(sessionId, plan);
				this.clearLoading(sessionId);
				if (plan) {
					logger.debug("Plan loaded from disk", { sessionId, title: plan.title });
				}
			},
			(error) => {
				this.plans.set(sessionId, null);
				this.clearLoading(sessionId);
				logger.debug("Plan load failed", { sessionId, error: error.message });
			}
		);
	}

	/**
	 * Get the plan for a session.
	 * Prefers streaming content over disk-based content.
	 * Returns undefined if not yet loaded, null if loaded but no plan exists.
	 */
	getPlan(sessionId: string): SessionPlanResponse | null | undefined {
		// Prefer streaming content (live plan writing)
		const streaming = this.streamingPlans.get(sessionId);
		if (streaming) {
			return {
				slug: this.extractSlug(streaming.filePath),
				content: streaming.content,
				title: streaming.title ?? "Plan",
				summary: null,
				filePath: streaming.filePath,
			};
		}

		// Fall back to disk-based plan
		return this.plans.get(sessionId);
	}

	/**
	 * Check if a plan is currently being streamed (actively written).
	 */
	isStreaming(sessionId: string): boolean {
		return this.streamingPlans.get(sessionId)?.isStreaming ?? false;
	}

	/**
	 * Check if a session's plan is currently loading from disk.
	 */
	isLoading(sessionId: string): boolean {
		return this.loading.has(sessionId);
	}

	/**
	 * Clear plan data for a session.
	 */
	clear(sessionId: string): void {
		this.plans.delete(sessionId);
		this.streamingPlans.delete(sessionId);
		this.clearLoading(sessionId);
	}

	private clearLoading(sessionId: string): void {
		this.loading.delete(sessionId);
	}

	private extractSlug(filePath: string | null): string {
		if (!filePath) return "plan";
		const match = filePath.match(/([^/]+)\.md$/);
		return match?.[1] ?? "plan";
	}

	private getNormalizedContent(planData: PlanData): string | null {
		if (typeof planData.contentMarkdown === "string") {
			return planData.contentMarkdown;
		}
		if (typeof planData.content === "string") {
			return planData.content;
		}
		if (planData.steps.length === 0) {
			return null;
		}

		const lines = planData.steps.map((step) => {
			const prefix =
				step.status === "completed"
					? "[x]"
					: step.status === "in_progress"
						? "[-]"
						: step.status === "failed"
							? "[!]"
							: "[ ]";
			return `- ${prefix} ${step.description}`;
		});

		return `# Plan\n\n${lines.join("\n")}`;
	}

	private sourceRank(
		source: "deterministic" | "heuristic" | null,
		confidence: "high" | "medium" | null
	): number {
		if (source === "deterministic") return 20;
		if (source === "heuristic" && confidence === "high") return 15;
		if (source === "heuristic") return 10;
		if (confidence === "high") return 5;
		return 0;
	}
}

/**
 * Create and set the plan store in Svelte context.
 */
export function createPlanStore(): PlanStore {
	const store = new PlanStore();
	setContext(PLAN_STORE_KEY, store);
	return store;
}

/**
 * Get the plan store from Svelte context.
 */
export function getPlanStore(): PlanStore {
	return getContext<PlanStore>(PLAN_STORE_KEY);
}
