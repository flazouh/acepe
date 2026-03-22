/**
 * Shared composable for inline plan display mode.
 *
 * Encapsulates plan data derivations, debounced streaming content,
 * action handlers (review/deepen/view full), and double-submit prevention.
 * Used by both tool-call-create-plan and tool-call-exit-plan-mode.
 */

import { getPlanPreferenceStore } from "../store/plan-preference-store.svelte.js";
import { getPlanStore } from "../store/plan-store.svelte.js";
import { getSessionStore } from "../store/session-store.svelte.js";
import type { TurnState } from "../store/types.js";
import { createLogger } from "../utils/logger.js";
import { useSessionContext } from "./use-session-context.js";

const logger = createLogger("use-plan-inline");

const DEBOUNCE_MS = 250;
const MAX_PREVIEW_LINES = 40;

/** Truncate content to a max number of lines for the inline preview. */
function truncateForPreview(content: string): string {
	const lines = content.split("\n");
	if (lines.length <= MAX_PREVIEW_LINES) return content;
	return lines.slice(0, MAX_PREVIEW_LINES).join("\n") + "\n\n…";
}

export function usePlanInline(getTurnState: () => TurnState | undefined) {
	const planPrefs = getPlanPreferenceStore();
	const planStore = getPlanStore();
	const sessionStore = getSessionStore();
	const sessionContext = useSessionContext();

	const sessionId = $derived(sessionContext?.sessionId);
	const useInline = $derived(planPrefs.preferInline);
	const plan = $derived(sessionId ? planStore.getPlan(sessionId) : undefined);
	const isStreaming = $derived(
		sessionId ? planStore.isStreaming(sessionId) : false,
	);
	const planContent = $derived(plan?.content ?? "");

	// Debounced + truncated content for markdown rendering during streaming
	let debouncedContent = $state("");

	$effect(() => {
		const content = planContent;
		const streaming = isStreaming;

		if (streaming) {
			// Leading edge: show content immediately if we have nothing yet
			if (!debouncedContent && content) {
				debouncedContent = truncateForPreview(content);
			}
			const timer = setTimeout(() => {
				debouncedContent = truncateForPreview(content);
			}, DEBOUNCE_MS);
			return () => clearTimeout(timer);
		} else {
			debouncedContent = truncateForPreview(content);
		}
	});

	// Actions disabled when turn is active or a send is in flight
	let actionPending = $state(false);
	const canAct = $derived(!actionPending && getTurnState() === "idle");

	// Plan dialog state
	let showPlanDialog = $state(false);

	function handleViewFull() {
		showPlanDialog = true;
	}

	async function handleReview() {
		if (!sessionId || !canAct) return;
		actionPending = true;
		await sessionStore.sendMessage(sessionId, "/plan_review").match(
			() => {},
			(err) => logger.warn("Failed to send /plan_review", { error: err }),
		);
		actionPending = false;
	}

	async function handleDeepen() {
		if (!sessionId || !canAct) return;
		actionPending = true;
		await sessionStore.sendMessage(sessionId, "/deepen_plan").match(
			() => {},
			(err) => logger.warn("Failed to send /deepen_plan", { error: err }),
		);
		actionPending = false;
	}

	return {
		get sessionId() {
			return sessionId;
		},
		get useInline() {
			return useInline;
		},
		get plan() {
			return plan;
		},
		get isStreaming() {
			return isStreaming;
		},
		get planContent() {
			return planContent;
		},
		get debouncedContent() {
			return debouncedContent;
		},
		get canAct() {
			return canAct;
		},
		get showPlanDialog() {
			return showPlanDialog;
		},
		set showPlanDialog(v: boolean) {
			showPlanDialog = v;
		},
		handleViewFull,
		handleReview,
		handleDeepen,
	};
}
