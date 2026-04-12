<script lang="ts">
import type { Snippet } from "svelte";

import { AttentionQueueQuestionCard } from "../attention-queue/index.js";

import KanbanBoard from "./kanban-board.svelte";
import KanbanCard from "./kanban-card.svelte";
import KanbanSceneMenu from "./kanban-scene-menu.svelte";
import KanbanScenePlanApprovalFooter from "./kanban-scene-plan-approval-footer.svelte";

import type { KanbanCardData } from "./types.js";
import type {
	KanbanSceneCardData,
	KanbanSceneColumnGroup,
	KanbanScenePermissionFooterData,
	KanbanScenePlanApprovalFooterData,
	KanbanSceneQuestionFooterData,
	KanbanSceneFooterData,
	KanbanSceneMenuAction,
} from "./kanban-scene-types.js";

interface Props {
	groups: readonly KanbanSceneColumnGroup[];
	emptyHint?: string;
	todoSectionRenderer?: Snippet<[KanbanSceneCardData]>;
	permissionFooterRenderer?: Snippet<[KanbanSceneCardData, KanbanScenePermissionFooterData]>;
	onCardClick?: (cardId: string) => void;
	onCardClose?: (cardId: string) => void;
	onMenuAction?: (cardId: string, actionId: string) => void;
	onQuestionOptionSelect?: (
		cardId: string,
		currentQuestionIndex: number,
		optionLabel: string
	) => void;
	onQuestionOtherInput?: (cardId: string, currentQuestionIndex: number, value: string) => void;
	onQuestionOtherKeydown?: (cardId: string, currentQuestionIndex: number, key: string) => void;
	onQuestionSubmit?: (cardId: string) => void;
	onQuestionPrev?: (cardId: string, currentQuestionIndex: number) => void;
	onQuestionNext?: (cardId: string, currentQuestionIndex: number, totalQuestions: number) => void;
	onPlanApprove?: (cardId: string) => void;
	onPlanReject?: (cardId: string) => void;
}

let {
	groups,
	emptyHint,
	todoSectionRenderer,
	permissionFooterRenderer,
	onCardClick,
	onCardClose,
	onMenuAction = () => {},
	onQuestionOptionSelect = () => {},
	onQuestionOtherInput = () => {},
	onQuestionOtherKeydown = () => {},
	onQuestionSubmit = () => {},
	onQuestionPrev = () => {},
	onQuestionNext = () => {},
	onPlanApprove = () => {},
	onPlanReject = () => {},
}: Props = $props();

function resolveSceneCard(card: KanbanCardData): KanbanSceneCardData | null {
	if (
		!("footer" in card) ||
		!("menuActions" in card) ||
		!("showCloseAction" in card) ||
		!("hideBody" in card) ||
		!("flushFooter" in card)
	) {
		return null;
	}

	const footer = card.footer;
	const menuActions = card.menuActions;
	const showCloseAction = card.showCloseAction;
	const hideBody = card.hideBody;
	const flushFooter = card.flushFooter;

	if (!Array.isArray(menuActions)) {
		return null;
	}

	if (
		typeof showCloseAction !== "boolean" ||
		typeof hideBody !== "boolean" ||
		typeof flushFooter !== "boolean"
	) {
		return null;
	}

	return {
		id: card.id,
		title: card.title,
		agentIconSrc: card.agentIconSrc,
		agentLabel: card.agentLabel,
		isAutoMode: card.isAutoMode,
		projectName: card.projectName,
		projectColor: card.projectColor,
		activityText: card.activityText,
		isStreaming: card.isStreaming,
		modeId: card.modeId,
		diffInsertions: card.diffInsertions,
		diffDeletions: card.diffDeletions,
		errorText: card.errorText,
		todoProgress: card.todoProgress,
		taskCard: card.taskCard,
		latestTool: card.latestTool,
		hasUnseenCompletion: card.hasUnseenCompletion,
		sequenceId: card.sequenceId,
		footer: footer as KanbanSceneFooterData | null,
		menuActions: menuActions as readonly KanbanSceneMenuAction[],
		showCloseAction,
		hideBody,
		flushFooter,
	};
}

function resolveQuestionFooter(card: KanbanSceneCardData): KanbanSceneQuestionFooterData | null {
	if (!card.footer || card.footer.kind !== "question") {
		return null;
	}

	return card.footer;
}

function resolvePermissionFooter(
	card: KanbanSceneCardData
): KanbanScenePermissionFooterData | null {
	if (!card.footer || card.footer.kind !== "permission") {
		return null;
	}

	return card.footer;
}

function resolvePlanApprovalFooter(
	card: KanbanSceneCardData
): KanbanScenePlanApprovalFooterData | null {
	if (!card.footer || card.footer.kind !== "plan_approval") {
		return null;
	}

	return card.footer;
}
</script>

<KanbanBoard {groups} {emptyHint}>
	{#snippet cardRenderer(card: KanbanCardData)}
		{@const sceneCard = resolveSceneCard(card)}
		{#if sceneCard}
			{@const questionFooterData = resolveQuestionFooter(sceneCard)}
			{@const permissionFooterData = resolvePermissionFooter(sceneCard)}
			{@const planApprovalFooterData = resolvePlanApprovalFooter(sceneCard)}
			<KanbanCard
				card={sceneCard}
				onclick={onCardClick ? () => onCardClick(sceneCard.id) : undefined}
				onClose={sceneCard.showCloseAction && onCardClose ? () => onCardClose(sceneCard.id) : undefined}
				showMenu={sceneCard.menuActions.length > 0}
				showFooter={sceneCard.footer !== null}
				flushFooter={sceneCard.flushFooter}
				hideBody={sceneCard.hideBody}
			>
				{#if todoSectionRenderer}
					{#snippet todoSection()}
						{@render todoSectionRenderer(sceneCard)}
					{/snippet}
				{/if}

				{#snippet menu()}
					{#if sceneCard.menuActions.length > 0}
						<KanbanSceneMenu
							menuActions={sceneCard.menuActions}
							onMenuAction={(actionId: string) => onMenuAction(sceneCard.id, actionId)}
						/>
					{/if}
				{/snippet}

				{#snippet footer()}
					{#if questionFooterData}
						<AttentionQueueQuestionCard
							currentQuestion={questionFooterData.currentQuestion}
							totalQuestions={questionFooterData.totalQuestions}
							hasMultipleQuestions={questionFooterData.hasMultipleQuestions}
							currentQuestionIndex={questionFooterData.currentQuestionIndex}
							questionId={questionFooterData.questionId}
							questionProgress={questionFooterData.questionProgress}
							currentQuestionAnswered={questionFooterData.currentQuestionAnswered}
							currentQuestionOptions={questionFooterData.currentQuestionOptions}
							otherText={questionFooterData.otherText}
							otherPlaceholder={questionFooterData.otherPlaceholder}
							showOtherInput={questionFooterData.showOtherInput}
							showSubmitButton={questionFooterData.showSubmitButton}
							canSubmit={questionFooterData.canSubmit}
							submitLabel={questionFooterData.submitLabel}
							onOptionSelect={(optionLabel: string) =>
								onQuestionOptionSelect(sceneCard.id, questionFooterData.currentQuestionIndex, optionLabel)}
							onOtherInput={(value: string) =>
								onQuestionOtherInput(sceneCard.id, questionFooterData.currentQuestionIndex, value)}
							onOtherKeydown={(key: string) =>
								onQuestionOtherKeydown(sceneCard.id, questionFooterData.currentQuestionIndex, key)}
							onSubmitAll={() => onQuestionSubmit(sceneCard.id)}
							onPrevQuestion={() => onQuestionPrev(sceneCard.id, questionFooterData.currentQuestionIndex)}
							onNextQuestion={() =>
								onQuestionNext(sceneCard.id, questionFooterData.currentQuestionIndex, questionFooterData.totalQuestions)}
						/>
					{:else if permissionFooterData}
						{#if permissionFooterRenderer}
							{@render permissionFooterRenderer(sceneCard, permissionFooterData)}
						{/if}
					{:else if planApprovalFooterData}
						<KanbanScenePlanApprovalFooter
							prompt={planApprovalFooterData.prompt}
							approveLabel={planApprovalFooterData.approveLabel}
							rejectLabel={planApprovalFooterData.rejectLabel}
							onApprove={() => onPlanApprove(sceneCard.id)}
							onReject={() => onPlanReject(sceneCard.id)}
						/>
					{/if}
				{/snippet}
			</KanbanCard>
		{/if}
	{/snippet}
</KanbanBoard>
