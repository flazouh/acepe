/**
 * Shared composable for inline plan display mode.
 *
 * Encapsulates plan data derivations, debounced streaming content,
 * action handlers (review/deepen/view full), and double-submit prevention.
 * Used by both tool-call-create-plan and tool-call-exit-plan-mode.
 *
 * Review and Deepen buttons implement a "reject-then-command" flow:
 * 1. Reject the pending plan approval (refuse the plan)
 * 2. Send the appropriate compound engineering slash command
 *    (/ce:review for Review, /deepen-plan for Deepen)
 * 3. If the skills aren't installed, auto-install from GitHub first
 */

import { okAsync, type ResultAsync } from "neverthrow";

import type { AppError } from "../errors/app-error.js";
import { respondToPlanApproval } from "../logic/inbound-request-handler.js";

import { getPlanPreferenceStore } from "../store/plan-preference-store.svelte.js";
import { getPlanStore } from "../store/plan-store.svelte.js";
import { getSessionStore } from "../store/session-store.svelte.js";
import type { TurnState } from "../store/types.js";
import { createLogger } from "../utils/logger.js";
import { usePlanSkills } from "./use-plan-skills.svelte.js";
import { useSessionContext } from "./use-session-context.js";

const logger = createLogger({ id: "use-plan-inline", name: "UsePlanInline" });

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
	getAgentId: () => string | undefined;
	getPlanApprovalRequestId: () => number | undefined;
	getAwaitingPlanApproval: () => boolean;
}

export function usePlanInline(opts: PlanInlineOptions) {
	const { getTurnState, getAgentId, getPlanApprovalRequestId, getAwaitingPlanApproval } = opts;

	const planPrefs = getPlanPreferenceStore();
	const planStore = getPlanStore();
	const sessionStore = getSessionStore();
	const sessionContext = useSessionContext();
	const planSkills = usePlanSkills(getAgentId);

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

	// Actions disabled during streaming or when a send is in flight.
	// During plan approval, we allow actions because the reject-then-command
	// flow first rejects (which transitions state) then sends the command.
	let actionPending = $state(false);
	const turnIsIdle = $derived(getTurnState() === "idle");
	const isAwaitingApproval = $derived(getAwaitingPlanApproval());
	const canAct = $derived(!actionPending && (turnIsIdle || isAwaitingApproval));

	// Plan dialog state
	let showPlanDialog = $state(false);

	function handleViewFull() {
		showPlanDialog = true;
	}

	/**
	 * Reject the plan, then send a command as a new message.
	 * Used by both Review and Deepen buttons.
	 */
	function rejectAndSendCommand(command: string): ResultAsync<void, AppError> {
		const sid = sessionId;
		if (!sid) return okAsync(undefined);

		const requestId = getPlanApprovalRequestId();

		// If we have a pending plan approval, reject it first
		const maybeReject =
			requestId != null && isAwaitingApproval
				? respondToPlanApproval(sid, requestId, false).orElse((err) => {
						logger.warn("Failed to reject plan before sending command", {
							error: err,
							command,
						});
						// Don't abort — try sending the command anyway.
						// The user's intent is clear: they want review/deepen.
						return okAsync(undefined);
					})
				: okAsync(undefined);

		// Chain: reject → send slash command
		return maybeReject.andThen(() =>
			sessionStore.sendMessage(sid, command).mapErr((err) => {
				logger.warn("Failed to send command", { command, error: err });
				return err;
			})
		);
	}

	/**
	 * Handle Review button click.
	 * If the /ce:review skill is not installed, auto-install from GitHub first.
	 * Then reject the plan and send /ce:review.
	 */
	function handleReview(): void {
		if (!sessionId || !canAct) return;
		actionPending = true;

		// Auto-install if needed
		const maybeInstall = !planSkills.hasReview
			? planSkills.installReview().orElse((err) => {
					logger.warn("Failed to auto-install review skill", { error: err });
					// Continue anyway — the command will just not be a recognized skill
					return okAsync(undefined);
				})
			: okAsync(undefined);

		// Chain: maybe-install → reject → send command → reset actionPending
		maybeInstall
			.andThen(() => rejectAndSendCommand("/ce:review"))
			.match(
				() => {
					actionPending = false;
				},
				() => {
					actionPending = false;
				}
			);
	}

	/**
	 * Handle Deepen button click.
	 * If the /deepen-plan skill is not installed, auto-install from GitHub first.
	 * Then reject the plan and send /deepen-plan.
	 */
	function handleDeepen(): void {
		if (!sessionId || !canAct) return;
		actionPending = true;

		// Auto-install if needed
		const maybeInstall = !planSkills.hasDeepen
			? planSkills.installDeepen().orElse((err) => {
					logger.warn("Failed to auto-install deepen skill", { error: err });
					return okAsync(undefined);
				})
			: okAsync(undefined);

		// Chain: maybe-install → reject → send command → reset actionPending
		maybeInstall
			.andThen(() => rejectAndSendCommand("/deepen-plan"))
			.match(
				() => {
					actionPending = false;
				},
				() => {
					actionPending = false;
				}
			);
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
		/** Skill state for UI rendering (install badges, etc.) */
		get planSkills() {
			return planSkills;
		},
		handleViewFull,
		handleReview,
		handleDeepen,
	};
}
