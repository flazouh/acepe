<script lang="ts">
import type { PlanCardStatus } from "@acepe/ui/plan-card";
import { BuildIcon, PlanIcon } from "@acepe/ui/icons";
import { EmbeddedPanelHeader, HeaderActionCell, HeaderTitleCell } from "@acepe/ui/panel-header";
import { PlanCard } from "@acepe/ui/plan-card";
import { TextShimmer } from "@acepe/ui/text-shimmer";
import { Result } from "neverthrow";
import { CheckCircle, XCircle } from "phosphor-svelte";
import * as m from "$lib/paraglide/messages.js";
import type { AcpError } from "../../errors/index.js";
import { usePlanInline } from "../../hooks/use-plan-inline.svelte.js";
import { useSessionContext } from "../../hooks/use-session-context.js";
import { replyToPlanApprovalRequest } from "../../logic/interaction-reply.js";
import { getInteractionStore } from "../../store/interaction-store.svelte.js";
import type { TurnState } from "../../store/types.js";
import { buildPlanApprovalInteractionId } from "../../types/interaction.js";
import type { ToolCall } from "../../types/tool-call.js";
import { COLOR_NAMES, Colors } from "../../utils/colors.js";
import { getToolStatus } from "../../utils/tool-state-utils.js";
import { ToolCallThinkState } from "./tool-call-think/state/tool-call-think-state.svelte.js";

interface Props {
	toolCall: ToolCall;
	turnState?: TurnState;
	projectPath?: string;
	elapsedLabel?: string | null;
}

let { toolCall, turnState }: Props = $props();

const sessionContext = useSessionContext();
const interactionStore = getInteractionStore();

// Local state to track approval decision after responding (optimistic update).
// `null` = not yet answered, `true` = approved, `false` = rejected.
let localApproval = $state<boolean | null>(null);

const thinkState = new ToolCallThinkState(
	() => toolCall,
	() => turnState
);

const planApprovalId = $derived.by(() => {
	const sessionId = sessionContext?.sessionId;
	const requestId = toolCall.planApprovalRequestId;
	if (!sessionId || requestId == null) {
		return null;
	}

	return buildPlanApprovalInteractionId(sessionId, toolCall.id, requestId);
});
const planApprovalEntry = $derived.by(() => {
	if (planApprovalId) {
		const legacyEntry = interactionStore.planApprovalsPending.get(planApprovalId);
		if (legacyEntry !== undefined) {
			return legacyEntry;
		}
	}

	const sessionId = sessionContext?.sessionId;
	if (!sessionId) {
		return null;
	}

	for (const approval of interactionStore.planApprovalsPending.values()) {
		if (approval.sessionId !== sessionId) {
			continue;
		}

		if (approval.tool.callID !== toolCall.id) {
			continue;
		}

		return approval;
	}

	return null;
});
const pendingPlanApproval = $derived(
	planApprovalEntry?.status === "pending" ? planApprovalEntry : null
);
const approvalFromStore = $derived.by((): boolean | null => {
	if (planApprovalEntry?.status === "approved") {
		return true;
	}
	if (planApprovalEntry?.status === "rejected") {
		return false;
	}
	return null;
});
const isInteractive = $derived(
	(localApproval === null && pendingPlanApproval !== null) ||
		(localApproval === null && planApprovalEntry === null && toolCall.awaitingPlanApproval)
);
const inline = usePlanInline({
	getTurnState: () => turnState,
	getAwaitingPlanApproval: () =>
		localApproval === null && (pendingPlanApproval !== null || toolCall.awaitingPlanApproval),
});

// After the tool call result arrives from the backend, read the answer from it.
// The result field is set by the Rust adapter once the agent responds to the approval.
const safeJsonParse = Result.fromThrowable(
	(v: string) => JSON.parse(v) as Record<string, unknown>,
	() => new Error("Invalid JSON")
);

const resultApproved = $derived.by((): boolean | null => {
	if (toolCall.result == null) return null;
	const raw =
		typeof toolCall.result === "string"
			? safeJsonParse(toolCall.result).unwrapOr(null)
			: toolCall.result;
	if (
		raw != null &&
		typeof raw === "object" &&
		!Array.isArray(raw) &&
		typeof (raw as Record<string, unknown>).approved === "boolean"
	) {
		return (raw as Record<string, unknown>).approved as boolean;
	}
	return null;
});

// Effective answer: prefer local optimistic state, fall back to result from backend.
const effectiveApproval = $derived(
	localApproval != null
		? localApproval
		: approvalFromStore != null
			? approvalFromStore
			: resultApproved
);
const isAnswered = $derived(effectiveApproval !== null && !isInteractive);
const isApproved = $derived(effectiveApproval === true);

function handleApprove() {
	const approval = pendingPlanApproval;
	const requestId = toolCall.planApprovalRequestId;
	const sessionId = sessionContext?.sessionId;
	if (approval == null && (requestId == null || !sessionId)) return;
	localApproval = true;
	if (approval) {
		interactionStore.setPlanApprovalStatus(approval.id, "approved");
	}

	const replyResult =
		approval !== null
			? replyToPlanApprovalRequest(approval, true, false)
			: requestId != null && sessionId != null
				? replyToPlanApprovalRequest(sessionId, requestId, true)
				: null;
	if (replyResult === null) return;

	replyResult.match(
		() => {},
		(err: AcpError) => {
			// Roll back optimistic update on failure
			localApproval = null;
			if (approval) {
				interactionStore.setPlanApprovalStatus(approval.id, "pending");
			}
			console.error("Failed to approve plan", err);
		}
	);
}

function handleReject() {
	const approval = pendingPlanApproval;
	const requestId = toolCall.planApprovalRequestId;
	const sessionId = sessionContext?.sessionId;
	if (approval == null && (requestId == null || !sessionId)) return;
	localApproval = false;
	if (approval) {
		interactionStore.setPlanApprovalStatus(approval.id, "rejected");
	}

	const replyResult =
		approval !== null
			? replyToPlanApprovalRequest(approval, false, false)
			: requestId != null && sessionId != null
				? replyToPlanApprovalRequest(sessionId, requestId, false)
				: null;
	if (replyResult === null) return;

	replyResult.match(
		() => {},
		(err: AcpError) => {
			// Roll back optimistic update on failure
			localApproval = null;
			if (approval) {
				interactionStore.setPlanApprovalStatus(approval.id, "pending");
			}
			console.error("Failed to reject plan", err);
		}
	);
}

const toolStatus = $derived(getToolStatus(toolCall, turnState));

// Show loading state when the tool is pending/in-progress but no approval state yet
const isCreating = $derived(toolStatus.isPending && !isInteractive && !isAnswered);

const greenColor = "var(--success)";
const redColor = Colors[COLOR_NAMES.RED];

// PlanCard status derivation
const cardStatus = $derived.by((): PlanCardStatus => {
	if (inline.isStreaming) return "streaming";
	if (isApproved && isAnswered) return "approved";
	if (isAnswered && !isApproved) return "rejected";
	if (isInteractive) return "interactive";
	return "streaming"; // still loading
});
</script>

{#if inline.useInline && (inline.planContent || isCreating)}
	<!-- Inline mode: PlanCard with markdown preview (no card wrapper) -->
	{#if isCreating && !inline.planContent}
		<div class="flex items-center shrink-0">
			<EmbeddedPanelHeader>
				<HeaderTitleCell compactPadding>
					<PlanIcon size="sm" class="shrink-0 mr-1" />
					<TextShimmer class="inline-flex h-4 m-0 items-center text-xs leading-none">
						{m.tool_create_plan_running()}
					</TextShimmer>
				</HeaderTitleCell>
			</EmbeddedPanelHeader>
		</div>
	{:else}
		<PlanCard
			content={inline.debouncedContent}
			title={inline.plan?.title || "Plan"}
			status={cardStatus}
			actionsDisabled={!inline.canAct}
			onViewFull={inline.handleViewFull}
			onBuild={isInteractive ? handleApprove : undefined}
			onCancel={isInteractive ? handleReject : undefined}
		/>
	{/if}

	{#if inline.plan}
		{#await import("../plan-dialog.svelte") then module}
			{@const PlanDialog = module.default}
			<PlanDialog
				plan={inline.plan}
				open={inline.showPlanDialog}
				onOpenChange={(open) => (inline.showPlanDialog = open)}
			/>
		{/await}
	{/if}
{:else if isCreating}
	<!-- Sidebar mode: original loading shimmer (no card wrapper) -->
	<div class="flex items-center shrink-0">
		<EmbeddedPanelHeader>
			<HeaderTitleCell compactPadding>
				<PlanIcon size="sm" class="shrink-0 mr-1" />
				<TextShimmer class="inline-flex h-4 m-0 items-center text-xs leading-none">
					{m.tool_create_plan_running()}
				</TextShimmer>
			</HeaderTitleCell>
		</EmbeddedPanelHeader>
	</div>
{:else if isInteractive}
	<!-- Sidebar mode: interactive approval (no card wrapper) -->
	<div class="flex flex-col shrink-0">
		<EmbeddedPanelHeader class="bg-accent/40">
			<HeaderTitleCell compactPadding>
				<PlanIcon size="sm" class="shrink-0 mr-1" />
				<span class="text-[11px] font-semibold font-mono text-foreground select-none leading-none">
					Plan
				</span>
			</HeaderTitleCell>
			<HeaderActionCell>
				<button type="button" class="plan-action-btn" onclick={handleReject}>
					<XCircle weight="fill" class="size-3 shrink-0" style="color: {redColor}" />
					Cancel
				</button>
			</HeaderActionCell>
			<HeaderActionCell>
				<button type="button" class="plan-action-btn" onclick={handleApprove}>
					<BuildIcon size="sm" />
					{m.plan_sidebar_build()}
				</button>
			</HeaderActionCell>
		</EmbeddedPanelHeader>
		<div class="plan-title-area">
			<span class="text-xs text-muted-foreground leading-snug">
				{thinkState.questions?.[0]?.question || m.tool_create_plan_running()}
			</span>
		</div>
	</div>
{:else if isAnswered}
	<!-- Sidebar mode: answered (no card wrapper) -->
	<div class="flex items-center shrink-0">
		<EmbeddedPanelHeader>
			<HeaderTitleCell compactPadding>
				<PlanIcon size="sm" class="shrink-0 mr-1" />
				{#if isApproved}
					<CheckCircle weight="fill" class="size-3 shrink-0 mr-1" style="color: {greenColor}" />
					<span
						class="text-[10px] font-mono text-muted-foreground select-none truncate leading-none"
					>
						Plan approved
					</span>
				{:else}
					<XCircle weight="fill" class="size-3 shrink-0 mr-1" style="color: {redColor}" />
					<span
						class="text-[10px] font-mono text-muted-foreground select-none truncate leading-none"
					>
						Plan rejected
					</span>
				{/if}
			</HeaderTitleCell>
		</EmbeddedPanelHeader>
	</div>
{/if}

<style>
	.plan-title-area {
		padding: 8px 12px;
	}

	.plan-action-btn {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 0 8px;
		height: 100%;
		font: inherit;
		font-size: 0.625rem;
		font-weight: 500;
		font-family: var(--font-mono, ui-monospace, monospace);
		color: var(--muted-foreground);
		background: transparent;
		border: none;
		cursor: pointer;
		transition:
			color 0.15s ease,
			background-color 0.15s ease;
	}

	.plan-action-btn:hover {
		color: var(--foreground);
		background: color-mix(in srgb, var(--accent) 50%, transparent);
	}
</style>
