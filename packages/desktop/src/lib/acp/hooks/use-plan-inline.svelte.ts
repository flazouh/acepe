/**
 * Shared composable for inline plan display mode.
 *
 * Encapsulates plan data derivations, debounced streaming content,
 * view-full behavior, and double-submit prevention.
 * Used by both tool-call-create-plan and tool-call-exit-plan-mode.
 */

import { getPlanPreferenceStore } from "../store/plan-preference-store.svelte.js";
import { getPlanStore } from "../store/plan-store.svelte.js";
import type { TurnState } from "../store/types.js";
import { useSessionContext } from "./use-session-context.js";

const DEBOUNCE_MS = 250;
const MAX_PREVIEW_LINES = 40;

/** Truncate content to a max number of lines for the inline preview. */
function truncateForPreview(content: string): string {
	const lines = content.split("\n");
	if (lines.length <= MAX_PREVIEW_LINES) return content;
	return `${lines.slice(0, MAX_PREVIEW_LINES).join("\n")}\n\n…`;
}

export interface PlanInlineOptions {
	getTurnState: () => TurnState | undefined;
	getAwaitingPlanApproval: () => boolean;
}

export function usePlanInline(opts: PlanInlineOptions) {
	const { getTurnState, getAwaitingPlanApproval } = opts;

	const planPrefs = getPlanPreferenceStore();
	const planStore = getPlanStore();
	const sessionContext = useSessionContext();

	const sessionId = $derived(sessionContext?.sessionId);
	const useInline = $derived(planPrefs.preferInline);
	const plan = $derived(sessionId ? planStore.getPlan(sessionId) : undefined);
	const isStreaming = $derived(sessionId ? planStore.isStreaming(sessionId) : false);
	const planContent = $derived(plan?.content || "");

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

	const turnIsIdle = $derived(getTurnState() === "idle");
	const isAwaitingApproval = $derived(getAwaitingPlanApproval());
	const canAct = $derived(turnIsIdle || isAwaitingApproval);

	// Plan dialog state
	let showPlanDialog = $state(false);

	function handleViewFull() {
		showPlanDialog = true;
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
	};
}
