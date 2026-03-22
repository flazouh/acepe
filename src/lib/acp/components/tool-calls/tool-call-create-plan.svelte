<script lang="ts">
import {
	BuildIcon,
	EmbeddedPanelHeader,
	HeaderActionCell,
	HeaderTitleCell,
	PlanIcon,
	TextShimmer,
} from "@acepe/ui";
import type { PlanCardStatus } from "@acepe/ui/plan-card";
import { PlanCard } from "@acepe/ui/plan-card";
import { CheckCircle, XCircle } from "phosphor-svelte";
import * as m from "$lib/paraglide/messages.js";
import { usePlanInline } from "../../hooks/use-plan-inline.svelte.js";
import { useSessionContext } from "../../hooks/use-session-context.js";

import {
	findPendingQuestionForToolCall,
	resolveDisplayQuestions,
} from "../../store/question-selectors.js";
import {
	type AnsweredQuestion,
	getQuestionStore,
} from "../../store/question-store.svelte.js";
import type { TurnState } from "../../store/types.js";
import type { ToolCall } from "../../types/tool-call.js";
import { COLOR_NAMES, Colors } from "../../utils/colors.js";
import { getToolStatus } from "../../utils/tool-state-utils.js";
import PlanDialog from "../plan-dialog.svelte";
import { ToolCallThinkState } from "./tool-call-think/state/tool-call-think-state.svelte.js";
import ToolCard from "./tool-card.svelte";

interface Props {
	toolCall: ToolCall;
	turnState?: TurnState;
	projectPath?: string;
	elapsedLabel?: string | null;
}

const { toolCall, turnState }: Props = $props();

const questionStore = getQuestionStore();
const sessionContext = useSessionContext();

const inline = usePlanInline(() => turnState);

const thinkState = new ToolCallThinkState(
	() => toolCall,
	() => turnState,
);

const pendingQuestion = $derived.by(() => {
	return findPendingQuestionForToolCall(
		questionStore.pending.values(),
		toolCall.id,
		sessionContext?.sessionId,
	);
});

const displayQuestions = $derived.by(() => {
	return (
		resolveDisplayQuestions(thinkState.questions, pendingQuestion) ??
		answeredQuestion?.questions ??
		null
	);
});

const answeredQuestion = $derived.by((): AnsweredQuestion | undefined => {
	const fromStore = questionStore.getAnswered(toolCall.id);
	if (fromStore) return fromStore;

	if (!toolCall.questionAnswer) return undefined;

	return {
		questions: toolCall.questionAnswer.questions,
		answers: toolCall.questionAnswer.answers as AnsweredQuestion["answers"],
		answeredAt: 0,
	};
});

const isInteractive = $derived(pendingQuestion !== undefined);
const isAnswered = $derived(answeredQuestion !== undefined && !isInteractive);

const answeredLabel = $derived.by((): string | null => {
	if (!answeredQuestion || !displayQuestions?.[0]) return null;
	const answer = answeredQuestion.answers[displayQuestions[0].question];
	if (Array.isArray(answer)) return answer[0] ?? null;
	return answer ?? null;
});

const isApproved = $derived(answeredLabel === "Approve");

function handleApprove() {
	if (!pendingQuestion || !displayQuestions?.[0]) return;
	const answers = [{ questionIndex: 0, answers: ["Approve"] }];
	questionStore.reply(pendingQuestion.id, answers, displayQuestions);
}

function handleReject() {
	if (!pendingQuestion || !displayQuestions?.[0]) return;
	const answers = [{ questionIndex: 0, answers: ["Reject"] }];
	questionStore.reply(pendingQuestion.id, answers, displayQuestions);
}

const toolStatus = $derived(getToolStatus(toolCall, turnState));

// Show loading state when the tool is pending/in-progress but no question or answer yet
const isCreating = $derived(
	toolStatus.isPending && !isInteractive && !isAnswered,
);

const greenColor = Colors[COLOR_NAMES.GREEN];
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
	<!-- Inline mode: PlanCard with markdown preview -->
	{#if isCreating && !inline.planContent}
		<ToolCard>
			<EmbeddedPanelHeader>
				<HeaderTitleCell compactPadding>
					<PlanIcon size="sm" class="shrink-0 mr-1" style="color: {Colors[COLOR_NAMES.ORANGE]}" />
					<TextShimmer class="inline-flex h-4 m-0 items-center text-xs leading-none">
						{m.tool_create_plan_running()}
					</TextShimmer>
				</HeaderTitleCell>
			</EmbeddedPanelHeader>
		</ToolCard>
	{:else}
		<PlanCard
			content={inline.debouncedContent}
			title={inline.plan?.title ?? "Plan"}
			status={cardStatus}
			actionsDisabled={!inline.canAct}
			onViewFull={inline.handleViewFull}
			onBuild={isInteractive ? handleApprove : undefined}
			onReview={inline.handleReview}
			onDeepen={inline.handleDeepen}
		/>
	{/if}

	{#if inline.plan}
		<PlanDialog
			plan={inline.plan}
			open={inline.showPlanDialog}
			onOpenChange={(open) => (inline.showPlanDialog = open)}
		/>
	{/if}
{:else if isCreating}
	<!-- Sidebar mode: original loading shimmer -->
	<ToolCard>
		<EmbeddedPanelHeader>
			<HeaderTitleCell compactPadding>
				<PlanIcon size="sm" class="shrink-0 mr-1" style="color: {Colors[COLOR_NAMES.ORANGE]}" />
				<TextShimmer class="inline-flex h-4 m-0 items-center text-xs leading-none">
					{m.tool_create_plan_running()}
				</TextShimmer>
			</HeaderTitleCell>
		</EmbeddedPanelHeader>
	</ToolCard>
{:else if isInteractive}
	<!-- Sidebar mode: original interactive card -->
	<ToolCard>
		<EmbeddedPanelHeader class="bg-accent/40">
			<HeaderTitleCell compactPadding>
				<PlanIcon size="sm" class="shrink-0 mr-1" style="color: {Colors[COLOR_NAMES.ORANGE]}" />
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
				{displayQuestions?.[0]?.question ?? m.tool_create_plan_running()}
			</span>
		</div>
	</ToolCard>
{:else if isAnswered}
	<!-- Sidebar mode: original answered card -->
	<ToolCard>
		<EmbeddedPanelHeader>
			<HeaderTitleCell compactPadding>
				<PlanIcon size="sm" class="shrink-0 mr-1" style="color: {Colors[COLOR_NAMES.ORANGE]}" />
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
	</ToolCard>
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
